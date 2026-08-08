import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../channels.cjs";
import {
  type DesktopOperationError,
  type DesktopOperationErrorCode,
  type DesktopOperationFailure,
  type DesktopOperationResult,
  type SaveSession,
} from "../contracts.cjs";
import {
  PythonClientError,
  pythonClient,
  type PythonClient,
} from "../python/client.cjs";

const SAVE_ID_PATTERN = /^REPO_SAVE_\d{4}(?:_\d{2}){5}$/;
const SAVE_ERROR_CODES = new Set<DesktopOperationErrorCode>([
  "save_missing",
  "save_corrupt",
  "save_decrypt_failed",
  "save_unsupported",
  "backend_unavailable",
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
    level,
    currency: readInteger(value.currency, "currency"),
    playerCount,
    resumeLocation: readString(value.resumeLocation, "resumeLocation"),
  };
}

function parseResponse(value: unknown): DesktopOperationResult<SaveSession> {
  if (!isRecord(value)) {
    throw new SaveProtocolError("Invalid save response.");
  }
  if (value.ok === true) {
    return { ok: true, data: parseSession(value.session) };
  }
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
  console.error("Open save failed.", error);
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
    const result = parseResponse(await client.run("saves-open", [saveId]));
    if (result.ok && result.data.id !== saveId) {
      throw new SaveProtocolError("Save response ID did not match the request.");
    }
    return result;
  } catch (error) {
    return failure(error);
  }
}

export function registerSaveIpc(client: PythonClient = pythonClient): void {
  ipcMain.handle(IPC_CHANNELS.savesOpen, (_event, saveId: unknown) => openSave(client, saveId));
}
