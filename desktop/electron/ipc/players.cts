import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../channels.cjs";
import {
  type DesktopOperationError,
  type DesktopOperationErrorCode,
  type DesktopOperationFailure,
  type DesktopOperationResult,
  type PlayerAvatar,
  type PlayerDto,
} from "../contracts.cjs";
import { PythonClientError, pythonClient, type PythonClient } from "../python/client.cjs";

const SAVE_ID_PATTERN = /^REPO_SAVE_\d{4}(?:_\d{2}){5}$/;
const PLAYER_ID_PATTERN = /^\d{1,20}$/;
const STEAM_AVATAR_HOSTS = new Set([
  "avatars.akamai.steamstatic.com",
  "avatars.fastly.steamstatic.com",
]);
const PLAYER_ERROR_CODES = new Set<DesktopOperationErrorCode>([
  "invalid_request",
  "save_missing",
  "save_corrupt",
  "save_decrypt_failed",
  "save_unsupported",
  "backend_unavailable",
]);

class PlayerProtocolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PlayerProtocolError(`Invalid ${field}.`);
  }
  return value;
}

function parseError(value: unknown): DesktopOperationFailure {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) {
    throw new PlayerProtocolError("Invalid player response.");
  }
  const code = readString(value.error.code, "error code");
  if (!PLAYER_ERROR_CODES.has(code as DesktopOperationErrorCode)) {
    throw new PlayerProtocolError("Invalid player error code.");
  }
  return {
    ok: false,
    error: {
      code: code as DesktopOperationErrorCode,
      message: readString(value.error.message, "error message"),
    },
  };
}

function parsePlayer(value: unknown): PlayerDto {
  if (!isRecord(value)) {
    throw new PlayerProtocolError("Invalid player.");
  }
  const health = value.health;
  if (typeof health !== "number" || !Number.isSafeInteger(health) || health < 0) {
    throw new PlayerProtocolError("Invalid player health.");
  }
  const maxHealth = value.maxHealth;
  if (typeof maxHealth !== "number" || !Number.isSafeInteger(maxHealth) || maxHealth < 100) {
    throw new PlayerProtocolError("Invalid player max health.");
  }
  const id = readString(value.id, "player ID");
  if (!PLAYER_ID_PATTERN.test(id)) {
    throw new PlayerProtocolError("Invalid player ID.");
  }
  return {
    id,
    name: readString(value.name, "player name"),
    health,
    maxHealth,
  };
}

function parsePlayers(value: unknown): DesktopOperationResult<PlayerDto[]> {
  if (!isRecord(value)) {
    throw new PlayerProtocolError("Invalid player response.");
  }
  if (value.ok !== true) {
    return parseError(value);
  }
  if (!Array.isArray(value.players)) {
    throw new PlayerProtocolError("Invalid players.");
  }
  return { ok: true, data: value.players.map(parsePlayer) };
}

function parseAvatarUrl(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  const url = new URL(readString(value, "avatar URL"));
  if (
    url.protocol !== "https:" ||
    !STEAM_AVATAR_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new PlayerProtocolError("Invalid avatar URL.");
  }
  return url.href;
}

function parseAvatar(value: unknown): DesktopOperationResult<PlayerAvatar> {
  if (!isRecord(value)) {
    throw new PlayerProtocolError("Invalid avatar response.");
  }
  if (value.ok !== true) {
    return parseError(value);
  }
  if (!isRecord(value.avatar)) {
    throw new PlayerProtocolError("Invalid avatar.");
  }
  return {
    ok: true,
    data: {
      playerId: readString(value.avatar.playerId, "player ID"),
      avatarUrl: parseAvatarUrl(value.avatar.avatarUrl),
    },
  };
}

function publicError(error: unknown): DesktopOperationError {
  if (error instanceof PythonClientError) {
    const messages = {
      python_unavailable: "The Python player service is unavailable.",
      process_failed: "The Python player service failed.",
      process_timeout: "The Python player service timed out.",
      empty_response: "The Python player service returned no data.",
      malformed_response: "The Python player service returned malformed data.",
    } as const;
    return { code: error.code, message: messages[error.code] };
  }
  if (error instanceof PlayerProtocolError || error instanceof TypeError) {
    return {
      code: "invalid_response",
      message: "The Python player response did not match the desktop contract.",
    };
  }
  return { code: "internal_error", message: "The desktop player bridge failed unexpectedly." };
}

function failure(label: string, error: unknown): DesktopOperationFailure {
  console.error(`${label} failed.`, error);
  return { ok: false, error: publicError(error) };
}

function validSaveId(saveId: unknown): saveId is string {
  return typeof saveId === "string" && SAVE_ID_PATTERN.test(saveId);
}

function validPlayerId(playerId: unknown): playerId is string {
  return typeof playerId === "string" && PLAYER_ID_PATTERN.test(playerId);
}

export async function listPlayers(
  client: PythonClient,
  saveId: unknown,
): Promise<DesktopOperationResult<PlayerDto[]>> {
  if (!validSaveId(saveId)) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "A valid discovered save ID is required." },
    };
  }
  try {
    return parsePlayers(await client.run("players-list", [saveId]));
  } catch (error) {
    return failure("List players", error);
  }
}

export async function getPlayerAvatar(
  client: PythonClient,
  saveId: unknown,
  playerId: unknown,
): Promise<DesktopOperationResult<PlayerAvatar>> {
  if (!validSaveId(saveId) || !validPlayerId(playerId)) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "Valid save and player IDs are required." },
    };
  }
  try {
    const result = parseAvatar(await client.run("players-avatar", [saveId, playerId]));
    if (result.ok && result.data.playerId !== playerId) {
      throw new PlayerProtocolError("Avatar player ID did not match the request.");
    }
    return result;
  } catch (error) {
    return failure("Get player avatar", error);
  }
}

export function registerPlayerIpc(client: PythonClient = pythonClient): void {
  ipcMain.handle(IPC_CHANNELS.playersList, (_event, saveId: unknown) =>
    listPlayers(client, saveId),
  );
  ipcMain.handle(IPC_CHANNELS.playersAvatar, (_event, saveId: unknown, playerId: unknown) =>
    getPlayerAvatar(client, saveId, playerId),
  );
}
