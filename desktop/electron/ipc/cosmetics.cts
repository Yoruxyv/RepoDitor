/**
 * Runtime-validated MetaSave/Cosmetics IPC boundary.
 *
 * Validates renderer changes and Python DTOs, adds opaque icon tokens, and delegates
 * ownership and safe-write semantics to Python. Presentation never grants authority.
 */
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
import { PythonClientError, pythonClient, type PythonClient } from "../python/client.cjs";
import { localIconRegistry, readIconKey, type LocalIconRegistry } from "../icons/registry.cjs";

const FINGERPRINT_PATTERN = /^[a-f\d]{64}$/;
// Mirrors the independently proven Python mutation trust boundary. This is not a
// catalog-size assumption: dynamic installed catalogs may be smaller or larger.
const PROVEN_MUTATION_ID_COUNT = 547;
const MAX_CHANGES = PROVEN_MUTATION_ID_COUNT;
const ERROR_CODES = new Set<DesktopOperationErrorCode>([
  "invalid_request",
  "game_running",
  "game_status_unknown",
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

function readNullableInteger(value: unknown, field: string): number | null {
  return value === null ? null : readInteger(value, field);
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

interface ParsedCosmetic extends Omit<CosmeticDto, "iconToken"> {
  readonly iconKey: string | null;
}

function readCosmetic(value: unknown): ParsedCosmetic {
  if (!isRecord(value)) {
    throw new CosmeticsProtocolError("Invalid cosmetic.");
  }
  const id = readInteger(value.id, "cosmetic ID");
  const displayName = readString(value.displayName, "cosmetic display name");
  const type = readNullableInteger(value.type, "cosmetic type");
  const rarity = readNullableInteger(value.rarity, "cosmetic rarity");
  const status = readNullableInteger(value.status, "cosmetic status");
  const known = readBoolean(value.known, "known cosmetic flag");
  const owned = readBoolean(value.owned, "cosmetic ownership");
  const mutationEligible = readBoolean(value.mutationEligible, "cosmetic mutation eligibility");
  const state = readString(value.state, "cosmetic state");
  if (state !== "owned" && state !== "locked" && state !== "unknown") {
    throw new CosmeticsProtocolError("Invalid cosmetic state.");
  }
  const removalBlockedReason =
    value.removalBlockedReason === null
      ? null
      : readString(value.removalBlockedReason, "cosmetic removal block reason");
  let iconKey: string | null;
  try {
    iconKey = readIconKey(value.iconKey);
  } catch {
    throw new CosmeticsProtocolError("Invalid cosmetic icon.");
  }

  if (known) {
    if (
      id < 0 ||
      type === null ||
      rarity === null ||
      status === null ||
      state !== (owned ? "owned" : "locked") ||
      mutationEligible !== id < PROVEN_MUTATION_ID_COUNT ||
      (!mutationEligible && removalBlockedReason === null)
    ) {
      throw new CosmeticsProtocolError("Invalid installed cosmetic projection.");
    }
  } else if (
    !owned ||
    displayName !== `Cosmetic #${id}` ||
    type !== null ||
    rarity !== null ||
    status !== null ||
    state !== "unknown" ||
    mutationEligible ||
    removalBlockedReason === null
  ) {
    throw new CosmeticsProtocolError("Invalid unknown cosmetic projection.");
  }

  return {
    id,
    displayName,
    type,
    rarity,
    status,
    owned,
    known,
    state,
    mutationEligible,
    removalBlockedReason,
    iconKey,
  };
}

function readView(value: unknown, icons: LocalIconRegistry): CosmeticsViewDto {
  if (
    !isRecord(value) ||
    !Array.isArray(value.cosmetics) ||
    !Array.isArray(value.unknownOwnedIds)
  ) {
    throw new CosmeticsProtocolError("Invalid cosmetics view.");
  }
  const catalogAvailable = readBoolean(value.catalogAvailable, "catalog availability");
  const knownCatalogCount = readInteger(value.knownCatalogCount, "known catalog count");
  const knownOwnedCount = readInteger(value.knownOwnedCount, "known owned count");
  const knownLockedCount = readInteger(value.knownLockedCount, "known locked count");
  const savedPresetCount = readInteger(value.savedPresetCount, "saved preset count");
  const cosmetics = value.cosmetics.map(readCosmetic);
  const unknownOwnedIds = value.unknownOwnedIds.map((id) => readInteger(id, "unknown cosmetic ID"));
  const capabilities = readCapabilities(value.capabilities);
  const known = cosmetics.filter((cosmetic) => cosmetic.known);
  const unknown = cosmetics.filter((cosmetic) => !cosmetic.known);
  const knownIds = known.map((cosmetic) => cosmetic.id);
  const allIds = new Set(cosmetics.map((cosmetic) => cosmetic.id));
  const projectedUnknownIds = unknown.map((cosmetic) => cosmetic.id);
  const mutationAvailable = known.some((cosmetic) => cosmetic.mutationEligible);

  if (
    knownCatalogCount < 0 ||
    knownOwnedCount < 0 ||
    knownLockedCount < 0 ||
    savedPresetCount < 0 ||
    knownOwnedCount + knownLockedCount !== knownCatalogCount ||
    known.length !== knownCatalogCount ||
    knownIds.some((id, position) => id !== position) ||
    known.filter((cosmetic) => cosmetic.owned).length !== knownOwnedCount ||
    known.filter((cosmetic) => !cosmetic.owned).length !== knownLockedCount ||
    allIds.size !== cosmetics.length ||
    new Set(unknownOwnedIds).size !== unknownOwnedIds.length ||
    projectedUnknownIds.join(",") !== unknownOwnedIds.join(",") ||
    catalogAvailable !== knownCatalogCount > 0 ||
    !capabilities.canReadCosmetics ||
    capabilities.canUnlockCosmetic !== mutationAvailable ||
    capabilities.canUnlockAll !== mutationAvailable ||
    capabilities.canRemoveOwnership !== mutationAvailable
  ) {
    throw new CosmeticsProtocolError("Invalid cosmetics catalog projection.");
  }
  const tokens = icons.replace(
    "cosmetic",
    cosmetics.map((cosmetic) => cosmetic.iconKey),
  );
  return {
    fingerprint: readFingerprint(value.fingerprint),
    catalogAvailable,
    knownCatalogCount,
    knownOwnedCount,
    knownLockedCount,
    savedPresetCount,
    unknownOwnedIds,
    capabilities,
    cosmetics: cosmetics.map(({ iconKey, ...cosmetic }) => ({
      ...cosmetic,
      iconToken: iconKey === null ? null : (tokens.get(iconKey) ?? null),
    })),
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

function readGetResponse(
  value: unknown,
  icons: LocalIconRegistry,
): DesktopOperationResult<CosmeticsViewDto> {
  if (!isRecord(value)) {
    throw new CosmeticsProtocolError("Invalid cosmetics response.");
  }
  return value.ok === true
    ? { ok: true, data: readView(value.cosmetics, icons) }
    : readError(value);
}

function hasExactChangeKeys(value: Record<string, unknown>): boolean {
  return (
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .join(",") === "after,entity,feature,field"
  );
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
  if (value.entity === "presets" && value.field === "clearAll" && value.after === true) {
    return { feature: "cosmetics", entity: "presets", field: "clearAll", after: true };
  }
  if (typeof value.entity !== "string" || !/^(?:0|[1-9]\d*)$/.test(value.entity)) {
    throw new CosmeticsProtocolError("Invalid cosmetic ID.");
  }
  const id = Number(value.entity);
  if (
    !Number.isSafeInteger(id) ||
    id < 0 ||
    id >= PROVEN_MUTATION_ID_COUNT ||
    value.field !== "owned" ||
    typeof value.after !== "boolean"
  ) {
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
    changes.length > 1 &&
    changes.some(
      (change) =>
        change.field === "unlockAll" || change.field === "lockAll" || change.field === "clearAll",
    )
  ) {
    throw new CosmeticsProtocolError("Bulk cosmetic actions must be submitted alone.");
  }
  const signatures = new Set(changes.map((change) => `${change.entity}:${change.field}`));
  if (signatures.size !== changes.length) {
    throw new CosmeticsProtocolError("Duplicate cosmetic changes.");
  }
  return changes;
}

function readWriteResponse(
  value: unknown,
  icons: LocalIconRegistry,
): DesktopOperationResult<CosmeticsWriteResult> {
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
      cosmetics: readView(value.result.cosmetics, icons),
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

export async function getCosmetics(
  client: PythonClient,
  icons: LocalIconRegistry = localIconRegistry,
): Promise<DesktopOperationResult<CosmeticsViewDto>> {
  try {
    return readGetResponse(await client.run("cosmetics-get"), icons);
  } catch (error) {
    return failure(error);
  }
}

export async function saveCosmetics(
  client: PythonClient,
  fingerprint: unknown,
  changes: unknown,
  icons: LocalIconRegistry = localIconRegistry,
): Promise<DesktopOperationResult<CosmeticsWriteResult>> {
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
      await client.run("cosmetics-write", [safeFingerprint, JSON.stringify(safeChanges)]),
      icons,
    );
  } catch (error) {
    return failure(error);
  }
}

export function registerCosmeticsIpc(client: PythonClient = pythonClient): void {
  ipcMain.handle(IPC_CHANNELS.cosmeticsGet, () => getCosmetics(client));
  ipcMain.handle(IPC_CHANNELS.cosmeticsWrite, (_event, fingerprint: unknown, changes: unknown) =>
    saveCosmetics(client, fingerprint, changes),
  );
}
