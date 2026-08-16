import { type DesktopOperationResult, type RunStateDto, type RunStatDto } from "../contracts.cjs";
import { type PythonClient } from "../python/client.cjs";
import {
  EditorProtocolError,
  failure,
  invalidSaveId,
  isRecord,
  parseError,
  readInteger,
  readString,
  validSaveId,
} from "./protocol.cjs";

const RUN_STAT_KEYS = new Set<RunStatDto["key"]>(["level", "currency", "lives", "totalHaul"]);

function parseRunStat(value: unknown): RunStatDto {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid run stat.");
  }
  const key = readString(value.key, "run stat key");
  const statValue = readInteger(value.value, "run stat value");
  if (!RUN_STAT_KEYS.has(key as RunStatDto["key"]) || (key === "level" && statValue < 1)) {
    throw new EditorProtocolError("Invalid run stat.");
  }
  return {
    key: key as RunStatDto["key"],
    label: readString(value.label, "run stat label"),
    value: statValue,
  };
}

function parseRun(value: unknown): DesktopOperationResult<RunStateDto> {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid run response.");
  }
  if (value.ok !== true) {
    return parseError(value);
  }
  if (!isRecord(value.run) || !Array.isArray(value.run.stats)) {
    throw new EditorProtocolError("Invalid run state.");
  }
  const resume = value.run.resumeLocation;
  if (!isRecord(resume) || !Array.isArray(resume.options)) {
    throw new EditorProtocolError("Invalid resume location.");
  }
  const resumeValue = readString(resume.value, "resume location");
  const options = resume.options.map((option) => readString(option, "resume option"));
  if (!options.includes(resumeValue)) {
    throw new EditorProtocolError("Invalid resume location options.");
  }
  return {
    ok: true,
    data: {
      stats: value.run.stats.map(parseRunStat),
      resumeLocation: { value: resumeValue, options },
    },
  };
}

export async function getRunState(
  client: PythonClient,
  saveId: unknown,
): Promise<DesktopOperationResult<RunStateDto>> {
  if (!validSaveId(saveId)) {
    return invalidSaveId();
  }
  try {
    return parseRun(await client.run("run-get", [saveId]));
  } catch (error) {
    return failure("run", error);
  }
}
