import { ipcMain } from "electron";

import { assetPreparationService, type AssetPreparationService } from "../assets/preparation.cjs";
import { IPC_CHANNELS } from "../channels.cjs";
import { readUpgradeVisualKey } from "../icons/registry.cjs";
import {
  type DesktopOperationError,
  type DesktopOperationErrorCode,
  type DesktopOperationFailure,
  type DesktopOperationResult,
  type SaveChange,
  type RunStatChange,
  type SaveCanonicalAdvanced,
  type SaveCanonicalAdvancedItem,
  type SaveCanonicalPlayerValue,
  type SaveCanonicalResult,
  type SaveCanonicalRun,
  type SaveCanonicalRunStatValue,
  type SaveCanonicalUpgradeValue,
  type SaveOpenResult,
  type SaveSession,
  type SaveWriteResult,
} from "../contracts.cjs";
import { PythonClientError, pythonClient, type PythonClient } from "../python/client.cjs";

const SAVE_ID_PATTERN = /^REPO_SAVE_\d{4}(?:_\d{2}){5}$/;
const FINGERPRINT_PATTERN = /^[a-f\d]{64}$/;
const PLAYER_ID_PATTERN = /^\d{1,20}$/;
const MAX_CHANGES = 512;
const MAX_REQUIRED_VISUAL_KEYS = 512;
const RUN_STAT_FIELDS = new Set(["level", "currency", "lives", "totalHaul"]);
const SAVE_ERROR_CODES = new Set<DesktopOperationErrorCode>([
  "invalid_request",
  "game_running",
  "game_status_unknown",
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

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new SaveProtocolError(`Invalid ${field}.`);
  }
  return value;
}

function readNullableInteger(value: unknown, field: string): number | null {
  if (value === null) return null;
  return readInteger(value, field);
}

function readRequiredUpgradeVisualKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_REQUIRED_VISUAL_KEYS) {
    throw new SaveProtocolError("Invalid required upgrade visuals.");
  }
  const keys = value.map((entry) => {
    const key = readUpgradeVisualKey(entry);
    if (key === null) throw new SaveProtocolError("Invalid required upgrade visual key.");
    return key;
  });
  if (new Set(keys).size !== keys.length) {
    throw new SaveProtocolError("Duplicate required upgrade visual key.");
  }
  return keys;
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

interface ParsedOpenResponse {
  readonly session: SaveSession;
  readonly requiredUpgradeVisualKeys: string[];
}

function parseOpenResponse(value: unknown): DesktopOperationResult<ParsedOpenResponse> {
  if (!isRecord(value)) {
    throw new SaveProtocolError("Invalid save response.");
  }
  if (value.ok === true) {
    return {
      ok: true,
      data: {
        session: parseSession(value.session),
        requiredUpgradeVisualKeys: readRequiredUpgradeVisualKeys(value.requiredUpgradeVisualKeys),
      },
    };
  }
  return parseError(value);
}

function hasExactChangeKeys(value: Record<string, unknown>): boolean {
  return (
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .join(",") === "after,entity,feature,field"
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
    feature === "advanced" &&
    /^Item .+\/\d+$/.test(entity) &&
    field === "refillToFull" &&
    value.after === true
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
  const signatures = new Set(
    changes.map((change) => `${change.feature}:${change.entity}:${change.field}`),
  );
  if (signatures.size !== changes.length) {
    throw new SaveProtocolError("Duplicate pending changes.");
  }
  return changes;
}

const CANONICAL_CHARGE_STATES = new Set(["stored", "default_full", "not_applicable", "unknown"]);
const CANONICAL_RECHARGE_CAPABILITIES = new Set(["rechargeable", "not_rechargeable", "unknown"]);

function exactStrings(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return (
    actualSet.size === actual.length && [...actualSet].every((value) => expectedSet.has(value))
  );
}

function parseCanonicalPlayers(
  value: unknown,
  changes: readonly SaveChange[],
): SaveCanonicalPlayerValue[] | undefined {
  const expected = changes
    .filter((change) => change.feature === "players")
    .map((change) => change.entity);
  if (expected.length === 0 || !Array.isArray(value) || value.length !== expected.length) {
    return undefined;
  }
  try {
    const parsed = value.map((entry) => {
      if (!isRecord(entry)) throw new SaveProtocolError("Invalid canonical player value.");
      const id = readString(entry.id, "canonical player ID");
      const health = readInteger(entry.health, "canonical player health");
      if (!PLAYER_ID_PATTERN.test(id) || health < 0) {
        throw new SaveProtocolError("Invalid canonical player value.");
      }
      return { id, health };
    });
    return exactStrings(
      parsed.map((entry) => entry.id),
      expected,
    )
      ? parsed
      : undefined;
  } catch (error) {
    if (error instanceof SaveProtocolError) return undefined;
    throw error;
  }
}

function parseCanonicalUpgrades(
  value: unknown,
  changes: readonly SaveChange[],
): SaveCanonicalUpgradeValue[] | undefined {
  const expected = changes
    .filter((change) => change.feature === "upgrades")
    .map((change) => `${change.entity}:${change.field}`);
  if (expected.length === 0 || !Array.isArray(value) || value.length !== expected.length) {
    return undefined;
  }
  try {
    const parsed = value.map((entry) => {
      if (!isRecord(entry)) throw new SaveProtocolError("Invalid canonical upgrade value.");
      const playerId = readString(entry.playerId, "canonical upgrade player ID");
      const key = readString(entry.key, "canonical upgrade key");
      const upgradeValue = readInteger(entry.value, "canonical upgrade value");
      if (
        !PLAYER_ID_PATTERN.test(playerId) ||
        !key.startsWith("playerUpgrade") ||
        upgradeValue < 0
      ) {
        throw new SaveProtocolError("Invalid canonical upgrade value.");
      }
      return { playerId, key, value: upgradeValue };
    });
    return exactStrings(
      parsed.map((entry) => `${entry.playerId}:${entry.key}`),
      expected,
    )
      ? parsed
      : undefined;
  } catch (error) {
    if (error instanceof SaveProtocolError) return undefined;
    throw error;
  }
}

function parseCanonicalRun(
  value: unknown,
  changes: readonly SaveChange[],
): SaveCanonicalRun | undefined {
  const expectedRun = changes.filter((change) => change.feature === "run");
  if (expectedRun.length === 0 || !isRecord(value) || !Array.isArray(value.stats)) {
    return undefined;
  }
  const expectedStats = expectedRun
    .filter((change) => change.field !== "resumeLocation")
    .map((change) => change.field);
  const expectsResume = expectedRun.some((change) => change.field === "resumeLocation");
  try {
    const stats: SaveCanonicalRunStatValue[] = value.stats.map((entry) => {
      if (!isRecord(entry)) throw new SaveProtocolError("Invalid canonical run stat.");
      const key = readString(entry.key, "canonical run key");
      const statValue = readInteger(entry.value, "canonical run value");
      if (!RUN_STAT_FIELDS.has(key) || (key === "level" && statValue < 1)) {
        throw new SaveProtocolError("Invalid canonical run stat.");
      }
      return { key: key as SaveCanonicalRunStatValue["key"], value: statValue };
    });
    if (
      !exactStrings(
        stats.map((entry) => entry.key),
        expectedStats,
      )
    )
      return undefined;
    const hasResume = Object.prototype.hasOwnProperty.call(value, "resumeLocation");
    if (hasResume !== expectsResume) return undefined;
    return {
      stats,
      ...(expectsResume
        ? { resumeLocation: readString(value.resumeLocation, "canonical resume location") }
        : {}),
    };
  } catch (error) {
    if (error instanceof SaveProtocolError) return undefined;
    throw error;
  }
}

function parseCanonicalAdvanced(
  value: unknown,
  changes: readonly SaveChange[],
): SaveCanonicalAdvanced | undefined {
  const expected = changes
    .filter((change) => change.feature === "advanced")
    .map((change) => change.entity);
  if (
    expected.length === 0 ||
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    value.items.length !== expected.length
  ) {
    return undefined;
  }
  try {
    const currentChargeEntryCount = readInteger(
      value.currentChargeEntryCount,
      "canonical current-charge entry count",
    );
    if (currentChargeEntryCount < 0) return undefined;
    const items: SaveCanonicalAdvancedItem[] = value.items.map((entry) => {
      if (!isRecord(entry)) throw new SaveProtocolError("Invalid canonical advanced item.");
      const saveKey = readString(entry.saveKey, "canonical item save key");
      const storedCharge = readNullableInteger(entry.storedCharge, "canonical stored charge");
      const chargeState = readString(entry.chargeState, "canonical charge state");
      const rechargeCapability = readString(
        entry.rechargeCapability,
        "canonical recharge capability",
      );
      const canRefillToFull = readBoolean(entry.canRefillToFull, "canonical refill eligibility");
      if (
        !CANONICAL_CHARGE_STATES.has(chargeState) ||
        !CANONICAL_RECHARGE_CAPABILITIES.has(rechargeCapability) ||
        (storedCharge !== null && storedCharge < 0) ||
        (chargeState === "stored") !== (storedCharge !== null) ||
        (chargeState === "default_full" && rechargeCapability !== "rechargeable") ||
        (chargeState === "not_applicable" && rechargeCapability !== "not_rechargeable") ||
        (canRefillToFull && (chargeState !== "stored" || rechargeCapability !== "rechargeable"))
      ) {
        throw new SaveProtocolError("Invalid canonical advanced item.");
      }
      return {
        saveKey,
        storedCharge,
        chargeState: chargeState as SaveCanonicalAdvancedItem["chargeState"],
        rechargeCapability: rechargeCapability as SaveCanonicalAdvancedItem["rechargeCapability"],
        canRefillToFull,
      };
    });
    return exactStrings(
      items.map((item) => item.saveKey),
      expected,
    )
      ? { items, currentChargeEntryCount }
      : undefined;
  } catch (error) {
    if (error instanceof SaveProtocolError) return undefined;
    throw error;
  }
}

function parseCanonicalResult(
  value: unknown,
  fingerprint: string,
  changes: readonly SaveChange[],
): SaveCanonicalResult | undefined {
  if (!isRecord(value)) return undefined;
  try {
    const canonicalFingerprint = readFingerprint(value.fingerprint);
    if (canonicalFingerprint !== fingerprint) return undefined;
    const canonical: SaveCanonicalResult = { fingerprint: canonicalFingerprint };
    const players = parseCanonicalPlayers(value.players, changes);
    const upgrades = parseCanonicalUpgrades(value.upgrades, changes);
    const run = parseCanonicalRun(value.run, changes);
    const advanced = parseCanonicalAdvanced(value.advanced, changes);
    if (players !== undefined) canonical.players = players;
    if (upgrades !== undefined) canonical.upgrades = upgrades;
    if (run !== undefined) canonical.run = run;
    if (advanced !== undefined) canonical.advanced = advanced;
    return canonical;
  } catch (error) {
    if (error instanceof SaveProtocolError) return undefined;
    throw error;
  }
}

function parseWriteResponse(
  value: unknown,
  changes: readonly SaveChange[],
): DesktopOperationResult<SaveWriteResult> {
  if (!isRecord(value)) throw new SaveProtocolError("Invalid save response.");
  if (value.ok !== true) return parseError(value);
  if (!isRecord(value.result)) throw new SaveProtocolError("Invalid save result.");
  const session = parseSession(value.result.session);
  const canonical = parseCanonicalResult(value.result.canonical, session.fingerprint, changes);
  return {
    ok: true,
    data: {
      backupPath: readString(value.result.backupPath, "backup path"),
      session,
      ...(canonical === undefined ? {} : { canonical }),
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
  preparation: Pick<
    AssetPreparationService,
    "checkUpgradeVisualReadiness"
  > = assetPreparationService,
): Promise<DesktopOperationResult<SaveOpenResult>> {
  if (typeof saveId !== "string" || !SAVE_ID_PATTERN.test(saveId)) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "A valid discovered save ID is required." },
    };
  }

  try {
    const result = parseOpenResponse(await client.run("saves-open", [saveId]));
    if (result.ok && result.data.session.id !== saveId) {
      throw new SaveProtocolError("Save response ID did not match the request.");
    }
    if (!result.ok) return result;
    return {
      ok: true,
      data: {
        session: result.data.session,
        requiredUpgradeVisualKeys: result.data.requiredUpgradeVisualKeys,
        presentationReadiness: await preparation.checkUpgradeVisualReadiness(
          result.data.requiredUpgradeVisualKeys,
        ),
      },
    };
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
    return {
      ok: false,
      error: { code: "invalid_request", message: "A valid save ID is required." },
    };
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
      safeChanges,
    );
    if (result.ok && result.data.session.id !== saveId) {
      throw new SaveProtocolError("Save response ID did not match the request.");
    }
    return result;
  } catch (error) {
    return failure(error);
  }
}

export function registerSaveIpc(
  client: PythonClient = pythonClient,
  preparation: Pick<
    AssetPreparationService,
    "checkUpgradeVisualReadiness"
  > = assetPreparationService,
): void {
  ipcMain.handle(IPC_CHANNELS.savesOpen, (_event, saveId: unknown) =>
    openSave(client, saveId, preparation),
  );
  ipcMain.handle(
    IPC_CHANNELS.savesWrite,
    (_event, saveId: unknown, fingerprint: unknown, changes: unknown) =>
      saveChanges(client, saveId, fingerprint, changes),
  );
}
