import {
  type AdvancedCapabilitiesDto,
  type AdvancedDomainDto,
  type AdvancedDomainKey,
  type AdvancedEvidenceStatus,
  type AdvancedItemChargeState,
  type AdvancedItemDto,
  type AdvancedItemRechargeCapability,
  type AdvancedSaveDto,
  type DesktopOperationResult,
} from "../contracts.cjs";
import {
  localIconRegistry,
  readIconKey,
  readUpgradeVisualKey,
  type LocalIconRegistry,
} from "../icons/registry.cjs";
import { type PythonClient } from "../python/client.cjs";
import {
  EditorProtocolError,
  failure,
  invalidSaveId,
  isRecord,
  parseError,
  readBoolean,
  readInteger,
  readNullableInteger,
  readString,
  validSaveId,
} from "./protocol.cjs";

const ADVANCED_DOMAIN_KEYS = new Set<AdvancedDomainKey>([
  "items",
  "currentCharge",
  "batteryUpgrades",
  "purchasedUpgrades",
  "purchasedItems",
  "purchasedItemsTotal",
]);
const ADVANCED_STATUSES = new Set<AdvancedEvidenceStatus>([
  "confirmed",
  "partially_confirmed",
  "unknown",
]);
const ADVANCED_ITEM_CHARGE_STATES = new Set<AdvancedItemChargeState>([
  "stored",
  "default_full",
  "not_applicable",
  "unknown",
]);
const ADVANCED_ITEM_RECHARGE_CAPABILITIES = new Set<AdvancedItemRechargeCapability>([
  "rechargeable",
  "not_rechargeable",
  "unknown",
]);

function parseAdvancedCapabilities(
  value: unknown,
  domainKey: AdvancedDomainKey,
): AdvancedCapabilitiesDto {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid advanced capabilities.");
  }
  const canRead = readBoolean(value.canRead, "advanced read capability");
  const canEdit = readBoolean(value.canEdit, "advanced edit capability");
  const canAdd = readBoolean(value.canAdd, "advanced add capability");
  const canDelete = readBoolean(value.canDelete, "advanced delete capability");
  const canDuplicate = readBoolean(value.canDuplicate, "advanced duplicate capability");
  const canRefillToFull = readBoolean(
    value.canRefillToFull,
    "advanced refill-to-full capability",
  );
  if (canEdit || canAdd || canDelete || canDuplicate) {
    throw new EditorProtocolError("Advanced mutation capabilities are not supported.");
  }
  if (canRefillToFull && domainKey !== "currentCharge") {
    throw new EditorProtocolError("Refill-to-full is only supported for stored charge.");
  }
  return {
    canRead,
    canEdit: false,
    canAdd: false,
    canDelete: false,
    canDuplicate: false,
    canRefillToFull,
  };
}

function parseAdvancedDomain(value: unknown): AdvancedDomainDto {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid advanced domain.");
  }
  const key = readString(value.key, "advanced domain key");
  const status = readString(value.status, "advanced evidence status");
  const entryCount = readNullableInteger(value.entryCount, "advanced entry count");
  if (
    !ADVANCED_DOMAIN_KEYS.has(key as AdvancedDomainKey)
    || !ADVANCED_STATUSES.has(status as AdvancedEvidenceStatus)
    || (entryCount !== null && entryCount < 0)
  ) {
    throw new EditorProtocolError("Invalid advanced domain.");
  }
  return {
    key: key as AdvancedDomainKey,
    label: readString(value.label, "advanced domain label"),
    status: status as AdvancedEvidenceStatus,
    entryCount,
    capabilities: parseAdvancedCapabilities(value.capabilities, key as AdvancedDomainKey),
  };
}

interface ParsedAdvancedItem extends Omit<AdvancedItemDto, "iconToken"> {
  readonly iconKey: string | null;
  readonly upgradeVisualKey: string | null;
}

function parseAdvancedItem(value: unknown): ParsedAdvancedItem {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid advanced item.");
  }
  const saveKey = readString(value.saveKey, "item save key");
  const instanceId = readString(value.instanceId, "item instance ID");
  const storedCharge = readNullableInteger(value.storedCharge, "stored item charge");
  const chargeState = readString(value.chargeState, "item charge state");
  const rechargeCapability = readString(
    value.rechargeCapability,
    "item recharge capability",
  );
  const canRefillToFull = readBoolean(
    value.canRefillToFull,
    "item refill-to-full eligibility",
  );
  const isUpgrade = readBoolean(value.isUpgrade, "item upgrade classification");
  if (
    !/^\d+$/.test(instanceId)
    || !saveKey.startsWith("Item ")
    || !saveKey.endsWith(`/${instanceId}`)
    || !ADVANCED_ITEM_CHARGE_STATES.has(chargeState as AdvancedItemChargeState)
    || !ADVANCED_ITEM_RECHARGE_CAPABILITIES.has(
      rechargeCapability as AdvancedItemRechargeCapability,
    )
    || ((chargeState === "stored") !== (storedCharge !== null))
    || (chargeState === "default_full" && rechargeCapability !== "rechargeable")
    || (chargeState === "not_applicable" && rechargeCapability !== "not_rechargeable")
    || (
      canRefillToFull
      && (chargeState !== "stored" || rechargeCapability !== "rechargeable")
    )
  ) {
    throw new EditorProtocolError("Invalid advanced item.");
  }
  let iconKey: string | null;
  try {
    iconKey = readIconKey(value.iconKey);
  } catch {
    throw new EditorProtocolError("Invalid advanced item icon.");
  }
  let upgradeVisualKey: string | null;
  try {
    upgradeVisualKey = readUpgradeVisualKey(value.upgradeVisualKey ?? null);
  } catch {
    throw new EditorProtocolError("Invalid advanced item upgrade visual.");
  }
  if (!isUpgrade && upgradeVisualKey !== null) {
    throw new EditorProtocolError("Non-upgrade item cannot request an upgrade visual.");
  }
  return {
    saveKey,
    name: readString(value.name, "item name"),
    instanceId,
    isUpgrade,
    storedCharge,
    chargeState: chargeState as AdvancedItemChargeState,
    rechargeCapability: rechargeCapability as AdvancedItemRechargeCapability,
    canRefillToFull,
    iconKey,
    upgradeVisualKey,
  };
}

function parseAdvanced(
  value: unknown,
  icons: LocalIconRegistry,
): DesktopOperationResult<AdvancedSaveDto> {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid advanced response.");
  }
  if (value.ok !== true) {
    return parseError(value);
  }
  if (
    !isRecord(value.advanced)
    || !Array.isArray(value.advanced.domains)
    || !Array.isArray(value.advanced.items)
  ) {
    throw new EditorProtocolError("Invalid advanced data.");
  }
  const domains = value.advanced.domains.map(parseAdvancedDomain);
  const domainKeys = new Set(domains.map((domain) => domain.key));
  const unlinkedChargeEntryCount = readInteger(
    value.advanced.unlinkedChargeEntryCount,
    "unlinked charge entry count",
  );
  if (
    domains.length !== ADVANCED_DOMAIN_KEYS.size
    || domainKeys.size !== ADVANCED_DOMAIN_KEYS.size
    || [...ADVANCED_DOMAIN_KEYS].some((key) => !domainKeys.has(key))
    || unlinkedChargeEntryCount < 0
  ) {
    throw new EditorProtocolError("Invalid advanced data.");
  }
  const parsedItems = value.advanced.items.map(parseAdvancedItem);
  const tokens = icons.replaceVisuals(
    "item",
    parsedItems.map((item) => ({
      cacheKey: item.iconKey,
      upgradeKey: item.upgradeVisualKey,
    })),
  );
  return {
    ok: true,
    data: {
      domains,
      items: parsedItems.map(({ iconKey: _iconKey, upgradeVisualKey: _upgradeVisualKey, ...item }, index) => ({
        ...item,
        iconToken: tokens[index] ?? null,
      })),
      unlinkedChargeEntryCount,
    },
  };
}

export async function getAdvancedSave(
  client: PythonClient,
  saveId: unknown,
  icons: LocalIconRegistry = localIconRegistry,
): Promise<DesktopOperationResult<AdvancedSaveDto>> {
  if (!validSaveId(saveId)) {
    return invalidSaveId();
  }
  try {
    return parseAdvanced(await client.run("advanced-get", [saveId]), icons);
  } catch (error) {
    return failure("advanced data", error);
  }
}
