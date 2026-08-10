import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../channels.cjs";
import {
  type CosmeticCapabilitiesDto,
  type CosmeticChange,
  type CosmeticDto,
  type CosmeticsViewDto,
  type CosmeticsWriteResult,
  type DesktopOperationError,
  type DesktopOperationErrorCode,
  type DesktopOperationFailure,
  type DesktopOperationResult,
} from "../contracts.cjs";
import {
  PythonClientError,
  pythonClient,
  type PythonClient,
} from "../python/client.cjs";

const SAVE_ID_PATTERN = /^REPO_SAVE_\d{4}(?:_\d{2}){5}$/;
const FINGERPRINT_PATTERN = /^[a-f\d]{64}$/;
const KNOWN_COSMETIC_COUNT = 547;
const MAX_CHANGES = KNOWN_COSMETIC_COUNT;
const ERROR_CODES = new Set<DesktopOperationErrorCode>([
  "invalid_request",
  "save_missing",
  "meta_missing",
  "save_decrypt_failed",
  "save_unsupported",
  "backend_unavailable",
  "save_stale",
  "save_validation_failed",
  "backup_failed",
  "save_write_failed",
  "save_verification_failed",
]);

class CosmeticsProtocolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CosmeticsProtocolError(`Invalid ${field}.`);
  }
  return value;
}

function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new CosmeticsProtocolError(`Invalid ${field}.`);
  }
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new CosmeticsProtocolError(`Invalid ${field}.`);
  }
  return value;
}

function readFingerprint(value: unknown): string {
  const fingerprint = readString(value, "MetaSave fingerprint");
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new CosmeticsProtocolError("Invalid MetaSave fingerprint.");
  }
  return fingerprint;
}

function readCapabilities(value: unknown): CosmeticCapabilitiesDto {
  if (!isRecord(value)) {
    throw new CosmeticsProtocolError("Invalid cosmetic capabilities.");
  }
  return {
    canReadCosmetics: readBoolean(value.canReadCosmetics, "cosmetics read capability"),
    canUnlockCosmetic: readBoolean(value.canUnlockCosmetic, "cosmetic unlock capability"),
    canUnlockAll: readBoolean(value.canUnlockAll, "cosmetics unlock-all capability"),
    canRemoveOwnership: readBoolean(value.canRemoveOwnership, "cosmetic removal capability"),
  };
}

function readCosmetic(value: unknown): CosmeticDto {
  if (!isRecord(value)) {
    throw new CosmeticsProtocolError("Invalid cosmetic.");
  }
  const id = readInteger(value.id, "cosmetic ID");
  const displayName = readString(value.displayName, "cosmetic display name");
  const known = readBoolean(value.known, "known cosmetic flag");
  const owned = readBoolean(value.owned, "cosmetic ownership");
  const removalBlockedReason =
    value.removalBlockedReason === null
      ? null
      : readString(value.removalBlockedReason, "cosmetic removal block reason");
  if (displayName !== `Cosmetic #${id}` || (known && (id < 0 || id >= KNOWN_COSMETIC_COUNT))) {
    throw new CosmeticsProtocolError("Invalid cosmetic identity.");
  }
  if (!known && (!owned || (id >= 0 && id < KNOWN_COSMETIC_COUNT))) {
    throw new CosmeticsProtocolError("Invalid unknown cosmetic.");
  }
  return { id, displayName, owned, known, removalBlockedReason };
}

function readView(value: unknown): CosmeticsViewDto {
  if (
    !isRecord(value)
    || !Array.isArray(value.cosmetics)
    || !Array.isArray(value.unknownOwnedIds)
  ) {
    throw new CosmeticsProtocolError("Invalid cosmetics view.");
  }
  const knownCatalogCount = readInteger(value.knownCatalogCount, "known catalog count");
  const knownOwnedCount = readInteger(value.knownOwnedCount, "known owned count");
  const knownLockedCount = readInteger(value.knownLockedCount, "known locked count");
  const savedPresetCount = readInteger(value.savedPresetCount, "saved preset count");
  const cosmetics = value.cosmetics.map(readCosmetic);
  const unknownOwnedIds = value.unknownOwnedIds.map((id) => readInteger(id, "unknown cosmetic ID"));
  const known = cosmetics.filter((cosmetic) => cosmetic.known);
  const knownIds = new Set(known.map((cosmetic) => cosmetic.id));
  const projectedUnknownIds = cosmetics.filter((cosmetic) => !cosmetic.known).map((cosmetic) => cosmetic.id);
  if (
    knownCatalogCount !== KNOWN_COSMETIC_COUNT
    || knownOwnedCount < 0
    || knownLockedCount < 0
    || savedPresetCount < 0
    || knownOwnedCount + knownLockedCount !== KNOWN_COSMETIC_COUNT
    || known.length !== KNOWN_COSMETIC_COUNT
    || knownIds.size !== KNOWN_COSMETIC_COUNT
    || [...knownIds].some((id) => id < 0 || id >= KNOWN_COSMETIC_COUNT)
    || known.filter((cosmetic) => cosmetic.owned).length !== knownOwnedCount
    || new Set(unknownOwnedIds).size !== unknownOwnedIds.length
    || projectedUnknownIds.join(",") !== unknownOwnedIds.join(",")
  ) {
    throw new CosmeticsProtocolError("Invalid cosmetics catalog projection.");
  }
  return {
    fingerprint: readFingerprint(value.fingerprint),
    knownCatalogCount,
    knownOwnedCount,
    knownLockedCount,
    savedPresetCount,
    unknownOwnedIds,
    capabilities: readCapabilities(value.capabilities),
    cosmetics,
  };
}

function readError(value: Record<string, unknown>): DesktopOperationFailure {
  if (value.ok !== false || !isRecord(value.error)) {
    throw new CosmeticsProtocolError("Invalid cosmetics response.");
  }
  const code = readString(value.error.code, "error code");
  if (!ERROR_CODES.has(code as DesktopOperationErrorCode)) {
    throw new CosmeticsProtocolError("Invalid cosmetics error code.");
  }
  return {
    ok: false,
    error: {
      code: code as DesktopOperationErrorCode,
      message: readString(value.error.message, "error message"),
    },
  };
}

function readGetResponse(value: unknown): DesktopOperationResult<CosmeticsViewDto> {
  if (!isRecord(value)) {
    throw new CosmeticsProtocolError("Invalid cosmetics response.");
  }
  return value.ok === true ? { ok: true, data: readView(value.cosmetics) } : readError(value);
}

function hasExactChangeKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).sort((left, right) => left.localeCompare(right)).join(",")
    === "after,entity,feature,field";
}

function readChange(value: unknown): CosmeticChange {
  if (!isRecord(value) || !hasExactChangeKeys(value) || value.feature !== "cosmetics") {
    throw new CosmeticsProtocolError("Invalid cosmetic change.");
  }
  if (value.entity === "known" && value.field === "unlockAll" && value.after === true) {
    return { feature: "cosmetics", entity: "known", field: "unlockAll", after: true };
  }
  if (value.entity === "known" && value.field === "lockAll" && value.after === false) {
    return { feature: "cosmetics", entity: "known", field: "lockAll", after: false };
  }
  if (typeof value.entity !== "string" || !/^(?:0|[1-9]\d{0,2})$/.test(value.entity)) {
    throw new CosmeticsProtocolError("Invalid cosmetic ID.");
  }
  const id = Number(value.entity);
  if (id >= KNOWN_COSMETIC_COUNT || value.field !== "owned" || typeof value.after !== "boolean") {
    throw new CosmeticsProtocolError("Unsupported cosmetic change.");
  }
  return { feature: "cosmetics", entity: value.entity, field: "owned", after: value.after };
}

function readChanges(value: unknown): CosmeticChange[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHANGES) {
    throw new CosmeticsProtocolError("Invalid cosmetic changes.");
  }
  const changes = value.map(readChange);
  if (
    changes.length > 1
    && changes.some((change) => change.field === "unlockAll" || change.field === "lockAll")
  ) {
    throw new CosmeticsProtocolError("Bulk cosmetic actions must be submitted alone.");
  }
  const signatures = new Set(changes.map((change) => `${change.entity}:${change.field}`));
  if (signatures.size !== changes.length) {
    throw new CosmeticsProtocolError("Duplicate cosmetic changes.");
  }
  return changes;
}

function readWriteResponse(value: unknown): DesktopOperationResult<CosmeticsWriteResult> {
  if (!isRecord(value)) {
    throw new CosmeticsProtocolError("Invalid cosmetics response.");
  }
  if (value.ok !== true) {
    return readError(value);
  }
  if (!isRecord(value.result)) {
    throw new CosmeticsProtocolError("Invalid cosmetics write result.");
  }
  return {
    ok: true,
    data: {
      backupPath: readString(value.result.backupPath, "MetaSave backup path"),
      cosmetics: readView(value.result.cosmetics),
    },
  };
}

function publicError(error: unknown): DesktopOperationError {
  if (error instanceof PythonClientError) {
    const messages = {
      python_unavailable: "The Python cosmetics service is unavailable.",
      process_failed: "The Python cosmetics service failed.",
      process_timeout: "The Python cosmetics service timed out.",
      empty_response: "The Python cosmetics service returned no data.",
      malformed_response: "The Python cosmetics service returned malformed data.",
    } as const;
    return { code: error.code, message: messages[error.code] };
  }
  if (error instanceof CosmeticsProtocolError) {
    return {
      code: "invalid_response",
      message: "The Python cosmetics response did not match the desktop contract.",
    };
  }
  return { code: "internal_error", message: "The cosmetics bridge failed unexpectedly." };
}

function failure(error: unknown): DesktopOperationFailure {
  console.error("Cosmetics operation failed.", error);
  return { ok: false, error: publicError(error) };
}

function validSaveId(value: unknown): value is string {
  return typeof value === "string" && SAVE_ID_PATTERN.test(value);
}

export async function getCosmetics(
  client: PythonClient,
  saveId: unknown,
): Promise<DesktopOperationResult<CosmeticsViewDto>> {
  if (!validSaveId(saveId)) {
    return { ok: false, error: { code: "invalid_request", message: "A valid save ID is required." } };
  }
  try {
    return readGetResponse(await client.run("cosmetics-get", [saveId]));
  } catch (error) {
    return failure(error);
  }
}

export async function saveCosmetics(
  client: PythonClient,
  saveId: unknown,
  fingerprint: unknown,
  changes: unknown,
): Promise<DesktopOperationResult<CosmeticsWriteResult>> {
  if (!validSaveId(saveId)) {
    return { ok: false, error: { code: "invalid_request", message: "A valid save ID is required." } };
  }
  let safeFingerprint: string;
  let safeChanges: CosmeticChange[];
  try {
    safeFingerprint = readFingerprint(fingerprint);
    safeChanges = readChanges(changes);
  } catch {
    return {
      ok: false,
      error: { code: "invalid_request", message: "The pending cosmetic changes are invalid." },
    };
  }
  try {
    return readWriteResponse(
      await client.run("cosmetics-write", [saveId, safeFingerprint, JSON.stringify(safeChanges)]),
    );
  } catch (error) {
    return failure(error);
  }
}

export function registerCosmeticsIpc(client: PythonClient = pythonClient): void {
  ipcMain.handle(IPC_CHANNELS.cosmeticsGet, (_event, saveId: unknown) =>
    getCosmetics(client, saveId),
  );
  ipcMain.handle(
    IPC_CHANNELS.cosmeticsWrite,
    (_event, saveId: unknown, fingerprint: unknown, changes: unknown) =>
      saveCosmetics(client, saveId, fingerprint, changes),
  );
}
