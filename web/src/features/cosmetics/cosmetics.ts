import { isInteger, LosslessNumber } from "lossless-json";

import snapshot from "@/features/cosmetics/known-cosmetics.v1.json";
import { classifySave } from "@/features/save-file/classification";
import { isSaveNumber, isSaveObject, type SaveObject } from "@/features/save-file/serialization";

export const KNOWN_COSMETIC_IDS: readonly number[] = Object.freeze([...snapshot.cosmeticIds]);

const KNOWN_COSMETIC_LEXEMES = new Set(KNOWN_COSMETIC_IDS.map(String));

export const COSMETIC_SNAPSHOT = Object.freeze({
  evidenceSha256: snapshot.evidenceSha256,
  gameCompatibility: snapshot.gameCompatibility,
  provenance: snapshot.provenance,
  snapshotVersion: snapshot.snapshotVersion,
});

export interface MetaCosmeticsState {
  readonly ownedSupportedCount: number;
  readonly remainingSupportedCount: number;
  readonly totalSupportedCount: number;
}

export class CosmeticEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CosmeticEditError";
  }
}

function ownershipList(data: SaveObject, key: string): LosslessNumber[] {
  const entry = Object.hasOwn(data, key) ? data[key] : undefined;
  const value = isSaveObject(entry) && Object.hasOwn(entry, "value") ? entry.value : undefined;
  if (
    !Array.isArray(value) ||
    !value.every((item) => isSaveNumber(item) && isInteger(item.value))
  ) {
    throw new CosmeticEditError(`'${key}.value' must contain only integer cosmetic IDs.`);
  }
  return value;
}

function requireSupportedMetaSave(data: SaveObject): {
  readonly history: LosslessNumber[];
  readonly unlocks: LosslessNumber[];
} {
  if (classifySave(data) !== "meta") {
    throw new CosmeticEditError("Cosmetics editing requires a supported MetaSave.");
  }
  return {
    history: ownershipList(data, "cosmeticHistory"),
    unlocks: ownershipList(data, "cosmeticUnlocks"),
  };
}

function ownedSupportedLexemes(unlocks: readonly LosslessNumber[]): Set<string> {
  return new Set(
    unlocks.map((item) => item.value).filter((value) => KNOWN_COSMETIC_LEXEMES.has(value)),
  );
}

export function inspectMetaCosmetics(data: SaveObject): MetaCosmeticsState {
  const { unlocks } = requireSupportedMetaSave(data);
  const ownedSupportedCount = ownedSupportedLexemes(unlocks).size;
  const totalSupportedCount = KNOWN_COSMETIC_IDS.length;
  return {
    ownedSupportedCount,
    remainingSupportedCount: totalSupportedCount - ownedSupportedCount,
    totalSupportedCount,
  };
}

export function unlockRemainingCosmetics(data: SaveObject): boolean {
  const { history, unlocks } = requireSupportedMetaSave(data);
  const owned = ownedSupportedLexemes(unlocks);
  const historyIds = new Set(history.map((item) => item.value));
  const missing = KNOWN_COSMETIC_IDS.filter((id) => !owned.has(String(id)));
  if (missing.length === 0) {
    return false;
  }

  for (const id of missing) {
    const value = String(id);
    if (!historyIds.has(value)) {
      history.push(new LosslessNumber(value));
      historyIds.add(value);
    }
    unlocks.push(new LosslessNumber(value));
  }
  return true;
}

function requireApprovedId(id: number): string {
  if (!Number.isSafeInteger(id) || !KNOWN_COSMETIC_LEXEMES.has(String(id))) {
    throw new CosmeticEditError("Cosmetic ID is outside the approved mutation policy.");
  }
  return String(id);
}

export function unlockCosmetic(data: SaveObject, id: number): boolean {
  const value = requireApprovedId(id);
  const { history, unlocks } = requireSupportedMetaSave(data);
  if (unlocks.some((entry) => entry.value === value)) return false;
  if (!history.some((entry) => entry.value === value)) history.push(new LosslessNumber(value));
  unlocks.push(new LosslessNumber(value));
  return true;
}

function containsId(value: unknown, id: number): boolean {
  if (isSaveNumber(value)) return Number(value.value) === id;
  if (Array.isArray(value)) return value.some((entry) => containsId(entry, id));
  if (isSaveObject(value)) return Object.values(value).some((entry) => containsId(entry, id));
  return false;
}

export type CosmeticRemovalBlock = "unverified" | "equipped" | "preset";

function removalReferenceBlock(data: SaveObject, id: number): CosmeticRemovalBlock | null {
  for (const [key, reason] of [
    ["cosmeticEquipped", "equipped"],
    ["cosmeticPresets", "preset"],
  ] as const) {
    const entry = data[key];
    if (
      !isSaveObject(entry) ||
      !Object.hasOwn(entry, "value") ||
      (!Array.isArray(entry.value) && !isSaveObject(entry.value))
    )
      return "unverified";
    if (containsId(entry.value, id)) return reason;
  }
  return null;
}

export function cosmeticRemovalBlockedReason(data: SaveObject, id: number): string | null {
  const reason = removalReferenceBlock(data, id);
  if (reason === "unverified")
    return "Removal unavailable because equipment and preset references could not be verified.";
  return reason ? "Removal unavailable while equipped or used by a preset." : null;
}

export interface CosmeticBulkLockState {
  readonly ownedIds: readonly number[];
  readonly preservedCount: number;
  readonly blockedReason: CosmeticRemovalBlock | null;
}

export function inspectCosmeticBulkLock(data: SaveObject): CosmeticBulkLockState {
  const { unlocks } = requireSupportedMetaSave(data);
  const owned = ownedSupportedLexemes(unlocks);
  const ownedIds = KNOWN_COSMETIC_IDS.filter((id) => owned.has(String(id)));
  const reasons = ownedIds.map((id) => removalReferenceBlock(data, id));
  return {
    ownedIds,
    preservedCount: new Set(
      unlocks.map((entry) => entry.value).filter((value) => !KNOWN_COSMETIC_LEXEMES.has(value)),
    ).size,
    blockedReason: reasons.find((reason) => reason !== null) ?? null,
  };
}

export function removeCosmeticOwnership(data: SaveObject, id: number): boolean {
  const value = requireApprovedId(id);
  const { history, unlocks } = requireSupportedMetaSave(data);
  if (!unlocks.some((entry) => entry.value === value)) return false;
  const reason = cosmeticRemovalBlockedReason(data, id);
  if (reason) throw new CosmeticEditError(reason);
  history.splice(0, history.length, ...history.filter((entry) => entry.value !== value));
  unlocks.splice(0, unlocks.length, ...unlocks.filter((entry) => entry.value !== value));
  return true;
}

export function lockAllCosmetics(data: SaveObject): boolean {
  const { unlocks } = requireSupportedMetaSave(data);
  const owned = ownedSupportedLexemes(unlocks);
  const ids = KNOWN_COSMETIC_IDS.filter((id) => owned.has(String(id)));
  for (const id of ids) {
    const reason = cosmeticRemovalBlockedReason(data, id);
    if (reason) throw new CosmeticEditError(reason);
  }
  let changed = false;
  for (const id of ids) changed = removeCosmeticOwnership(data, id) || changed;
  return changed;
}

export function approvedOwnedCosmeticIds(data: SaveObject): readonly number[] {
  const { unlocks } = requireSupportedMetaSave(data);
  const owned = ownedSupportedLexemes(unlocks);
  return KNOWN_COSMETIC_IDS.filter((id) => owned.has(String(id)));
}
