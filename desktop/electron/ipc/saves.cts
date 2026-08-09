import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../channels.cjs";
import {
  type DesktopOperationError,
  type DesktopOperationErrorCode,
  type DesktopOperationFailure,
  type DesktopOperationResult,
  type SaveChange,
  type RunStatChange,
  type SaveSession,
  type SaveWriteResult,
} from "../contracts.cjs";
import {
  PythonClientError,
  pythonClient,
  type PythonClient,
} from "../python/client.cjs";

const SAVE_ID_PATTERN = /^REPO_SAVE_\d{4}(?:_\d{2}){5}$/;
const FINGERPRINT_PATTERN = /^[a-f\d]{64}$/;
const PLAYER_ID_PATTERN = /^\d{1,20}$/;
const MAX_CHANGES = 512;
const RUN_STAT_FIELDS = new Set(["level", "currency", "lives", "totalHaul"]);
const SAVE_ERROR_CODES = new Set<DesktopOperationErrorCode>([
  "invalid_request",
  "save_missing",
  "save_corrupt",
  "save_decrypt_failed",
  "save_unsupported",
  "backend_unavailable",
  "save_stale",
  "save_validation_failed",
  "backup_failed",
  "save_write_failed",
  "save_verification_failed",
]);

class SaveProtocolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SaveProtocolError(`Invalid ${field}.`);
  }
  return value;
}

function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new SaveProtocolError(`Invalid ${field}.`);
  }
  return value;
}

function parseSession(value: unknown): SaveSession {
  if (!isRecord(value)) {
    throw new SaveProtocolError("Invalid save session.");
  }

  const modifiedAt = readString(value.lastModified, "lastModified");
  if (Number.isNaN(Date.parse(modifiedAt))) {
    throw new SaveProtocolError("Invalid lastModified.");
  }

  const level = readInteger(value.level, "level");
  const playerCount = readInteger(value.playerCount, "playerCount");
  if (level < 1 || playerCount < 0) {
    throw new SaveProtocolError("Invalid save session counts.");
  }

  return {
    id: readString(value.id, "id"),
    name: readString(value.displayName, "displayName"),
    path: readString(value.path, "path"),
    modifiedAt,
    fingerprint: readFingerprint(value.fingerprint),
    level,
    currency: readInteger(value.currency, "currency"),
    playerCount,
    resumeLocation: readString(value.resumeLocation, "resumeLocation"),
  };
}

function readFingerprint(value: unknown): string {
  const fingerprint = readString(value, "fingerprint");
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new SaveProtocolError("Invalid fingerprint.");
  }
  return fingerprint;
}

function parseError(value: Record<string, unknown>): DesktopOperationFailure {
  if (value.ok !== false || !isRecord(value.error)) {
    throw new SaveProtocolError("Invalid save response.");
  }
  const code = readString(value.error.code, "error code");
  if (!SAVE_ERROR_CODES.has(code as DesktopOperationErrorCode)) {
    throw new SaveProtocolError("Invalid save error code.");
  }
  return {
    ok: false,
    error: {
      code: code as DesktopOperationErrorCode,
      message: readString(value.error.message, "error message"),
    },
  };
}

function parseOpenResponse(value: unknown): DesktopOperationResult<SaveSession> {
  if (!isRecord(value)) {
    throw new SaveProtocolError("Invalid save response.");
  }
  if (value.ok === true) {
    return { ok: true, data: parseSession(value.session) };
  }
  return parseError(value);
}

function hasExactChangeKeys(value: Record<string, unknown>): boolean {
  return (
    Object.keys(value).sort((left, right) => left.localeCompare(right)).join(",") ===
    "after,entity,feature,field"
  );
}

function parseUpgradeChange(entity: string, field: string, afterValue: unknown): SaveChange {
  if (!PLAYER_ID_PATTERN.test(entity) || !field.startsWith("playerUpgrade")) {
    throw new SaveProtocolError("Invalid upgrade change.");
  }
  const after = readInteger(afterValue, "upgrade value");
  if (after < 0) throw new SaveProtocolError("Invalid upgrade value.");
  return { feature: "upgrades", entity, field, after };
}

function parseChange(value: unknown): SaveChange {
  if (!isRecord(value) || !hasExactChangeKeys(value)) {
    throw new SaveProtocolError("Invalid pending change.");
  }
  const feature = readString(value.feature, "change feature");
  const entity = readString(value.entity, "change entity");
  const field = readString(value.field, "change field");

  if (feature === "players" && PLAYER_ID_PATTERN.test(entity) && field === "health") {
    const after = readInteger(value.after, "health value");
    if (after < 0) throw new SaveProtocolError("Invalid health value.");
    return { feature, entity, field, after };
  }
  if (feature === "upgrades") {
    return parseUpgradeChange(entity, field, value.after);
  }
  if (feature === "run" && entity === "run" && RUN_STAT_FIELDS.has(field)) {
    const after = readInteger(value.after, "run value");
    if (field === "level" && after < 1) throw new SaveProtocolError("Invalid run level.");
    return { feature, entity, field: field as RunStatChange["field"], after };
  }
  if (feature === "run" && entity === "run" && field === "resumeLocation") {
    return { feature, entity, field, after: readString(value.after, "resume location") };
  }
  if (
    feature === "advanced"
    && /^Item .+\/\d+$/.test(entity)
    && field === "refillToFull"
    && value.after === true
  ) {
    return { feature, entity, field, after: true };
  }
  throw new SaveProtocolError("Unsupported pending change.");
}

function parseChanges(value: unknown): SaveChange[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHANGES) {
    throw new SaveProtocolError("Invalid pending changes.");
  }
  const changes = value.map(parseChange);
  const signatures = new Set(changes.map((change) => `${change.feature}:${change.entity}:${change.field}`));
  if (signatures.size !== changes.length) {
    throw new SaveProtocolError("Duplicate pending changes.");
  }
  return changes;
}

function parseWriteResponse(value: unknown): DesktopOperationResult<SaveWriteResult> {
  if (!isRecord(value)) throw new SaveProtocolError("Invalid save response.");
  if (value.ok !== true) return parseError(value);
  if (!isRecord(value.result)) throw new SaveProtocolError("Invalid save result.");
  return {
    ok: true,
    data: {
      backupPath: readString(value.result.backupPath, "backup path"),
      session: parseSession(value.result.session),
    },
  };
}

function publicError(error: unknown): DesktopOperationError {
  if (error instanceof PythonClientError) {
    const messages = {
      python_unavailable: "The Python save service is unavailable.",
      process_failed: "The Python save service failed.",
      process_timeout: "The Python save service timed out.",
      empty_response: "The Python save service returned no data.",
      malformed_response: "The Python save service returned malformed data.",
    } as const;
    return { code: error.code, message: messages[error.code] };
  }
  if (error instanceof SaveProtocolError) {
    return {
      code: "invalid_response",
      message: "The Python save response did not match the desktop contract.",
    };
  }
  return { code: "internal_error", message: "The desktop save bridge failed unexpectedly." };
}

function failure(error: unknown): DesktopOperationFailure {
  console.error("Save operation failed.", error);
  return { ok: false, error: publicError(error) };
}

export async function openSave(
  client: PythonClient,
  saveId: unknown,
): Promise<DesktopOperationResult<SaveSession>> {
  if (typeof saveId !== "string" || !SAVE_ID_PATTERN.test(saveId)) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "A valid discovered save ID is required." },
    };
  }

  try {
    const result = parseOpenResponse(await client.run("saves-open", [saveId]));
    if (result.ok && result.data.id !== saveId) {
      throw new SaveProtocolError("Save response ID did not match the request.");
    }
    return result;
  } catch (error) {
    return failure(error);
  }
}

export async function saveChanges(
  client: PythonClient,
  saveId: unknown,
  fingerprint: unknown,
  changes: unknown,
): Promise<DesktopOperationResult<SaveWriteResult>> {
  if (typeof saveId !== "string" || !SAVE_ID_PATTERN.test(saveId)) {
    return { ok: false, error: { code: "invalid_request", message: "A valid save ID is required." } };
  }
  let safeFingerprint: string;
  let safeChanges: SaveChange[];
  try {
    safeFingerprint = readFingerprint(fingerprint);
    safeChanges = parseChanges(changes);
  } catch {
    return {
      ok: false,
      error: { code: "invalid_request", message: "The pending save changes are invalid." },
    };
  }
  try {
    const result = parseWriteResponse(
      await client.run("saves-write", [saveId, safeFingerprint, JSON.stringify(safeChanges)]),
    );
    if (result.ok && result.data.session.id !== saveId) {
      throw new SaveProtocolError("Save response ID did not match the request.");
    }
    return result;
  } catch (error) {
    return failure(error);
  }
}

export function registerSaveIpc(client: PythonClient = pythonClient): void {
  ipcMain.handle(IPC_CHANNELS.savesOpen, (_event, saveId: unknown) => openSave(client, saveId));
  ipcMain.handle(
    IPC_CHANNELS.savesWrite,
    (_event, saveId: unknown, fingerprint: unknown, changes: unknown) =>
      saveChanges(client, saveId, fingerprint, changes),
  );
}
