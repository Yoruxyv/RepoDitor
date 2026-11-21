import snapshot from "@/features/recharge/recharge-capabilities.v1.json";
import { classifySave } from "@/features/save-file/classification";
import { isSaveNumber, isSaveObject, type SaveObject } from "@/features/save-file/serialization";

const ITEM_KEY_PATTERN = /^(Item .+)\/(\d+)$/u;
const PLAIN_INTEGER_PATTERN = /^-?(?:0|[1-9]\d*)$/u;
const INT32_MIN = -2_147_483_648n;
const INT32_MAX = 2_147_483_647n;

export const SUPPORTED_RECHARGEABLE_ITEM_IDENTITIES: readonly string[] = Object.freeze([
  ...snapshot.rechargeableItemIdentities,
]);

const SUPPORTED_IDENTITIES = new Set(SUPPORTED_RECHARGEABLE_ITEM_IDENTITIES);

export const RECHARGE_CAPABILITY_SNAPSHOT = Object.freeze({
  compatibility: Object.freeze({ ...snapshot.compatibility }),
  fullChargeRepresentation: snapshot.fullChargeRepresentation,
  provenance: snapshot.provenance,
  snapshotVersion: snapshot.snapshotVersion,
});

export interface RechargeState {
  readonly needingRechargeCount: number;
  readonly supportedItemCount: number;
}

export class RechargeEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RechargeEditError";
  }
}

interface RechargeInspection extends RechargeState {
  readonly chargeEntries: SaveObject | null;
  readonly rechargeableKeys: readonly string[];
}

function requireDictionary(data: SaveObject, key: string, label: string): SaveObject {
  const value = Object.hasOwn(data, key) ? data[key] : undefined;
  if (!isSaveObject(value)) {
    throw new RechargeEditError(`${label} is not a supported save dictionary.`);
  }
  return value;
}

function runDictionaries(data: SaveObject): SaveObject {
  if (classifySave(data) !== "run") {
    throw new RechargeEditError("Recharge editing requires a supported Run save.");
  }
  const entry = requireDictionary(data, "dictionaryOfDictionaries", "Run data");
  if (!Object.hasOwn(entry, "value") || !isSaveObject(entry.value)) {
    throw new RechargeEditError("Run data is not a supported save dictionary.");
  }
  return entry.value;
}

function requireSignedInt32(value: unknown, label: string): void {
  if (!isSaveNumber(value) || !PLAIN_INTEGER_PATTERN.test(value.value)) {
    throw new RechargeEditError(`${label} is not stored as a signed Int32 integer.`);
  }
  const integer = BigInt(value.value);
  if (integer < INT32_MIN || integer > INT32_MAX) {
    throw new RechargeEditError(`${label} is outside the signed Int32 save range.`);
  }
}

function inspect(data: SaveObject): RechargeInspection {
  const values = runDictionaries(data);
  const itemEntries = requireDictionary(values, "item", "Item inventory");
  const chargeEntries = Object.hasOwn(values, "itemStatBattery")
    ? requireDictionary(values, "itemStatBattery", "itemStatBattery")
    : null;
  const rechargeableKeys: string[] = [];

  for (const [saveKey, value] of Object.entries(itemEntries)) {
    requireSignedInt32(value, "Item inventory data");
    const match = ITEM_KEY_PATTERN.exec(saveKey);
    if (!match) {
      throw new RechargeEditError("An item instance key does not match the supported format.");
    }
    if (SUPPORTED_IDENTITIES.has(match[1]!)) {
      rechargeableKeys.push(saveKey);
    }
  }

  for (const value of Object.values(chargeEntries ?? {})) {
    requireSignedInt32(value, "Stored charge data");
  }

  return {
    chargeEntries,
    needingRechargeCount: chargeEntries
      ? rechargeableKeys.filter((key) => Object.hasOwn(chargeEntries, key)).length
      : 0,
    rechargeableKeys,
    supportedItemCount: rechargeableKeys.length,
  };
}

export function inspectRecharge(data: SaveObject): RechargeState {
  const { needingRechargeCount, supportedItemCount } = inspect(data);
  return { needingRechargeCount, supportedItemCount };
}

export function rechargeAllSupportedItems(data: SaveObject): boolean {
  const { chargeEntries, rechargeableKeys } = inspect(data);
  if (!chargeEntries) return false;
  let changed = false;
  for (const saveKey of rechargeableKeys) {
    if (Object.hasOwn(chargeEntries, saveKey)) {
      Reflect.deleteProperty(chargeEntries, saveKey);
      changed = true;
    }
  }
  return changed;
}
