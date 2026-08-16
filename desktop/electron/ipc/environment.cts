import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../channels.cjs";
import {
  type DesktopOperationError,
  type DesktopOperationFailure,
  type DesktopOperationResult,
  type EnvironmentDiscovery,
  type GameDiscoveryStatus,
  type SaveRootStatus,
  type SaveSummary,
} from "../contracts.cjs";
import { PythonClientError, pythonClient, type PythonClient } from "../python/client.cjs";

class EnvironmentProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentProtocolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new EnvironmentProtocolError(`Invalid ${field}.`);
  }
  return value;
}

function readNonEmptyString(value: unknown, field: string): string {
  const text = readString(value, field);
  if (!text.trim()) {
    throw new EnvironmentProtocolError(`Invalid ${field}.`);
  }
  return text;
}

function readNullableNonEmptyString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return readNonEmptyString(value, field);
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new EnvironmentProtocolError(`Invalid ${field}.`);
  }
  return value;
}

function parseSaveSummary(value: unknown): SaveSummary {
  if (!isRecord(value)) {
    throw new EnvironmentProtocolError("Invalid save entry.");
  }

  const modifiedAt = readString(value.lastModified, "save lastModified");
  if (Number.isNaN(Date.parse(modifiedAt))) {
    throw new EnvironmentProtocolError("Invalid save lastModified.");
  }

  const sizeBytes = value.fileSize;
  if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new EnvironmentProtocolError("Invalid save fileSize.");
  }

  return {
    id: readNonEmptyString(value.id, "save id"),
    name: readNonEmptyString(value.displayName, "save displayName"),
    path: readNonEmptyString(value.path, "save path"),
    modifiedAt,
    sizeBytes,
  };
}

function parseSaveRootStatus(value: unknown): SaveRootStatus {
  if (typeof value !== "string" || !isSaveRootStatus(value)) {
    throw new EnvironmentProtocolError("Invalid saveRootStatus.");
  }
  return value;
}

function isSaveRootStatus(value: string): value is SaveRootStatus {
  return (
    value === "available" ||
    value === "missing" ||
    value === "unreadable" ||
    value === "unavailable"
  );
}

function parseGameStatus(value: unknown): GameDiscoveryStatus {
  if (typeof value !== "string" || !isGameDiscoveryStatus(value)) {
    throw new EnvironmentProtocolError("Invalid gameStatus.");
  }
  return value;
}

function isGameDiscoveryStatus(value: string): value is GameDiscoveryStatus {
  return (
    value === "found" ||
    value === "steam_not_found" ||
    value === "game_not_found" ||
    value === "discovery_error"
  );
}

function parseEnvironment(value: unknown): EnvironmentDiscovery {
  if (!isRecord(value) || value.ok !== true) {
    throw new EnvironmentProtocolError("Invalid environment response.");
  }

  if (!Array.isArray(value.saves)) {
    throw new EnvironmentProtocolError("Invalid saves collection.");
  }
  const saves = value.saves.map(parseSaveSummary);

  if (typeof value.saveCount !== "number" || value.saveCount !== saves.length) {
    throw new EnvironmentProtocolError("Invalid saveCount.");
  }

  const saveRoot = readNullableNonEmptyString(value.saveRoot, "saveRoot");
  const saveRootStatus = parseSaveRootStatus(value.saveRootStatus);
  if ((saveRootStatus === "unavailable") !== (saveRoot === null)) {
    throw new EnvironmentProtocolError("Inconsistent save-root path state.");
  }
  const saveRootDetected = readBoolean(value.saveRootDetected, "saveRootDetected");
  if (saveRootDetected !== (saveRootStatus === "available")) {
    throw new EnvironmentProtocolError("Inconsistent save-root state.");
  }
  if (saveRootStatus !== "available" && saves.length > 0) {
    throw new EnvironmentProtocolError("Unavailable save root returned saves.");
  }

  const gameRoot = readNullableNonEmptyString(value.gameRoot, "gameRoot");
  const gameStatus = parseGameStatus(value.gameStatus);
  const gameDetected = readBoolean(value.gameDetected, "gameDetected");
  if (gameDetected !== (gameStatus === "found") || gameDetected !== (gameRoot !== null)) {
    throw new EnvironmentProtocolError("Inconsistent game state.");
  }

  return {
    saveRoot,
    saveRootStatus,
    saveRootDetected,
    gameRoot,
    gameStatus,
    gameDetected,
    saves,
  };
}

function getPublicError(error: unknown): DesktopOperationError {
  if (error instanceof PythonClientError) {
    const messages = {
      python_unavailable: "The Python discovery service is unavailable.",
      process_failed: "The Python discovery service failed.",
      process_timeout: "The Python discovery service timed out.",
      empty_response: "The Python discovery service returned no data.",
      malformed_response: "The Python discovery service returned malformed data.",
    } as const;
    return {
      code: error.code,
      message: messages[error.code],
    };
  }

  if (error instanceof EnvironmentProtocolError) {
    return {
      code: "invalid_response",
      message: "The Python discovery response did not match the desktop contract.",
    };
  }

  return {
    code: "internal_error",
    message: "The desktop discovery bridge failed unexpectedly.",
  };
}

function failure(error: unknown): DesktopOperationFailure {
  console.error("Environment discovery failed.", error);
  return {
    ok: false,
    error: getPublicError(error),
  };
}

export async function detectEnvironment(
  client: PythonClient,
): Promise<DesktopOperationResult<EnvironmentDiscovery>> {
  try {
    const response = await client.run("environment");
    return {
      ok: true,
      data: parseEnvironment(response),
    };
  } catch (error) {
    return failure(error);
  }
}

async function listSaves(client: PythonClient): Promise<DesktopOperationResult<SaveSummary[]>> {
  const result = await detectEnvironment(client);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    data: result.data.saves,
  };
}

export function registerEnvironmentIpc(client: PythonClient = pythonClient): void {
  ipcMain.handle(IPC_CHANNELS.environmentDetect, () => detectEnvironment(client));
  ipcMain.handle(IPC_CHANNELS.savesList, () => listSaves(client));
}
