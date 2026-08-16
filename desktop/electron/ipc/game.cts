import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../channels.cjs";
import {
  type DesktopOperationError,
  type DesktopOperationFailure,
  type DesktopOperationResult,
  type GameProcessState,
  type GameProcessStatus,
} from "../contracts.cjs";
import { PythonClientError, pythonClient, type PythonClient } from "../python/client.cjs";

class GameProtocolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStatus(value: unknown): GameProcessStatus {
  if (value === "running" || value === "not_running" || value === "unknown") {
    return value;
  }
  throw new GameProtocolError("Invalid game process status.");
}

function readResponse(value: unknown): GameProcessState {
  if (!isRecord(value) || value.ok !== true || typeof value.running !== "boolean") {
    throw new GameProtocolError("Invalid game process response.");
  }
  const status = readStatus(value.status);
  if (value.running !== (status === "running")) {
    throw new GameProtocolError("Inconsistent game process response.");
  }
  return { status, running: value.running };
}

function publicError(error: unknown): DesktopOperationError {
  if (error instanceof PythonClientError) {
    const messages = {
      python_unavailable: "The Python game-status service is unavailable.",
      process_failed: "The Python game-status service failed.",
      process_timeout: "The Python game-status service timed out.",
      empty_response: "The Python game-status service returned no data.",
      malformed_response: "The Python game-status service returned malformed data.",
    } as const;
    return { code: error.code, message: messages[error.code] };
  }
  if (error instanceof GameProtocolError) {
    return {
      code: "invalid_response",
      message: "The Python game-status response did not match the desktop contract.",
    };
  }
  return { code: "internal_error", message: "The game-status bridge failed unexpectedly." };
}

function failure(error: unknown): DesktopOperationFailure {
  console.error("Game-status operation failed.", error);
  return { ok: false, error: publicError(error) };
}

export async function getGameStatus(
  client: PythonClient,
): Promise<DesktopOperationResult<GameProcessState>> {
  try {
    return { ok: true, data: readResponse(await client.run("game-status")) };
  } catch (error) {
    return failure(error);
  }
}

export function registerGameIpc(client: PythonClient = pythonClient): void {
  ipcMain.handle(IPC_CHANNELS.gameStatus, () => getGameStatus(client));
}
