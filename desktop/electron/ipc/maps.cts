import {
  type DesktopOperationResult,
  type InstalledMapDto,
  type InstalledMapsDto,
} from "../contracts.cjs";
import { type PythonClient } from "../python/client.cjs";
import {
  EditorProtocolError,
  failure,
  isRecord,
  parseError,
  readBoolean,
  readString,
} from "./protocol.cjs";

function parseMap(value: unknown): InstalledMapDto {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid installed map.");
  }
  return {
    internalName: readString(value.internalName, "map internal name"),
    displayName: readString(value.displayName, "map display name"),
    knownLabel: readBoolean(value.knownLabel, "known map label flag"),
  };
}

function parseMaps(value: unknown): DesktopOperationResult<InstalledMapsDto> {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid maps response.");
  }
  if (value.ok !== true) {
    return parseError(value);
  }
  const available = readBoolean(value.available, "map availability");
  if (!Array.isArray(value.maps)) {
    throw new EditorProtocolError("Invalid maps.");
  }
  let catalogPath: string | null;
  if (available) {
    catalogPath = readString(value.catalogPath, "map catalog path");
  } else {
    if (value.catalogPath !== null) {
      throw new EditorProtocolError("Invalid map catalog path.");
    }
    catalogPath = null;
  }
  return {
    ok: true,
    data: {
      available,
      catalogPath,
      maps: value.maps.map(parseMap),
    },
  };
}

export async function listMaps(
  client: PythonClient,
): Promise<DesktopOperationResult<InstalledMapsDto>> {
  try {
    return parseMaps(await client.run("maps-list"));
  } catch (error) {
    return failure("maps", error);
  }
}
