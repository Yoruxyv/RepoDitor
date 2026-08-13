import { ipcMain } from "electron";

import { IPC_CHANNELS } from "../channels.cjs";
import {
  type AdvancedCapabilitiesDto,
  type AdvancedDomainDto,
  type AdvancedDomainKey,
  type AdvancedEvidenceStatus,
  type AdvancedItemChargeState,
  type AdvancedItemRechargeCapability,
  type AdvancedItemDto,
  type AdvancedSaveDto,
  type DesktopOperationError,
  type DesktopOperationErrorCode,
  type DesktopOperationFailure,
  type DesktopOperationResult,
  type InstalledMapDto,
  type InstalledMapsDto,
  type PlayerUpgradeDto,
  type RunStateDto,
  type RunStatDto,
} from "../contracts.cjs";
import {
  PythonClientError,
  pythonClient,
  type PythonClient,
} from "../python/client.cjs";
import {
  localIconRegistry,
  readIconKey,
  type LocalIconRegistry,
} from "../icons/registry.cjs";

const SAVE_ID_PATTERN = /^REPO_SAVE_\d{4}(?:_\d{2}){5}$/;
const PLAYER_ID_PATTERN = /^\d{1,20}$/;
const RUN_STAT_KEYS = new Set<RunStatDto["key"]>([
  "level",
  "currency",
  "lives",
  "totalHaul",
]);
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
const EDITOR_ERROR_CODES = new Set<DesktopOperationErrorCode>([
  "invalid_request",
  "save_missing",
  "save_corrupt",
  "save_decrypt_failed",
  "save_unsupported",
  "backend_unavailable",
]);

class EditorProtocolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new EditorProtocolError(`Invalid ${field}.`);
  }
  return value;
}

function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new EditorProtocolError(`Invalid ${field}.`);
  }
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new EditorProtocolError(`Invalid ${field}.`);
  }
  return value;
}

function readNullableInteger(value: unknown, field: string): number | null {
  return value === null ? null : readInteger(value, field);
}

function parseError(value: unknown): DesktopOperationFailure {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) {
    throw new EditorProtocolError("Invalid editor response.");
  }
  const code = readString(value.error.code, "error code");
  if (!EDITOR_ERROR_CODES.has(code as DesktopOperationErrorCode)) {
    throw new EditorProtocolError("Invalid editor error code.");
  }
  return {
    ok: false,
    error: {
      code: code as DesktopOperationErrorCode,
      message: readString(value.error.message, "error message"),
    },
  };
}

function parseUpgrade(value: unknown): PlayerUpgradeDto {
  if (!isRecord(value) || !Array.isArray(value.values)) {
    throw new EditorProtocolError("Invalid upgrade.");
  }
  const key = readString(value.key, "upgrade key");
  if (!key.startsWith("playerUpgrade")) {
    throw new EditorProtocolError("Invalid upgrade key.");
  }
  return {
    key,
    label: readString(value.label, "upgrade label"),
    known: readBoolean(value.known, "known upgrade flag"),
    values: value.values.map((entry) => {
      if (!isRecord(entry)) {
        throw new EditorProtocolError("Invalid upgrade value.");
      }
      const playerId = readString(entry.playerId, "player ID");
      const upgradeValue = readInteger(entry.value, "upgrade value");
      if (!PLAYER_ID_PATTERN.test(playerId) || upgradeValue < 0) {
        throw new EditorProtocolError("Invalid upgrade value.");
      }
      return { playerId, value: upgradeValue };
    }),
  };
}

function parseUpgrades(value: unknown): DesktopOperationResult<PlayerUpgradeDto[]> {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid upgrades response.");
  }
  if (value.ok !== true) {
    return parseError(value);
  }
  if (!Array.isArray(value.upgrades)) {
    throw new EditorProtocolError("Invalid upgrades.");
  }
  return { ok: true, data: value.upgrades.map(parseUpgrade) };
}

function parseRunStat(value: unknown): RunStatDto {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid run stat.");
  }
  const key = readString(value.key, "run stat key");
  const statValue = readInteger(value.value, "run stat value");
  if (!RUN_STAT_KEYS.has(key as RunStatDto["key"]) || (key === "level" && statValue < 1)) {
    throw new EditorProtocolError("Invalid run stat.");
  }
  return {
    key: key as RunStatDto["key"],
    label: readString(value.label, "run stat label"),
    value: statValue,
  };
}

function parseRun(value: unknown): DesktopOperationResult<RunStateDto> {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid run response.");
  }
  if (value.ok !== true) {
    return parseError(value);
  }
  if (!isRecord(value.run) || !Array.isArray(value.run.stats)) {
    throw new EditorProtocolError("Invalid run state.");
  }
  const resume = value.run.resumeLocation;
  if (!isRecord(resume) || !Array.isArray(resume.options)) {
    throw new EditorProtocolError("Invalid resume location.");
  }
  const resumeValue = readString(resume.value, "resume location");
  const options = resume.options.map((option) => readString(option, "resume option"));
  if (!options.includes(resumeValue)) {
    throw new EditorProtocolError("Invalid resume location options.");
  }
  return {
    ok: true,
    data: {
      stats: value.run.stats.map(parseRunStat),
      resumeLocation: { value: resumeValue, options },
    },
  };
}

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
    capabilities: parseAdvancedCapabilities(
      value.capabilities,
      key as AdvancedDomainKey,
    ),
  };
}

interface ParsedAdvancedItem extends Omit<AdvancedItemDto, "iconToken"> {
  readonly iconKey: string | null;
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
  return {
    saveKey,
    name: readString(value.name, "item name"),
    instanceId,
    storedCharge,
    chargeState: chargeState as AdvancedItemChargeState,
    rechargeCapability: rechargeCapability as AdvancedItemRechargeCapability,
    canRefillToFull,
    iconKey,
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
  const tokens = icons.replace("item", parsedItems.map((item) => item.iconKey));
  return {
    ok: true,
    data: {
      domains,
      items: parsedItems.map(({ iconKey, ...item }) => ({
        ...item,
        iconToken: iconKey === null ? null : (tokens.get(iconKey) ?? null),
      })),
      unlinkedChargeEntryCount,
    },
  };
}

function parseMap(value: unknown): InstalledMapDto {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid installed map.");
  }
  return {
    internalName: readString(value.internalName, "map internal name"),
    displayName: readString(value.displayName, "map display name"),
    knownLabel: readBoolean(value.knownLabel, "known map label flag"),
  };
}

function parseMaps(value: unknown): DesktopOperationResult<InstalledMapsDto> {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid maps response.");
  }
  if (value.ok !== true) {
    return parseError(value);
  }
  const available = readBoolean(value.available, "map availability");
  if (!Array.isArray(value.maps)) {
    throw new EditorProtocolError("Invalid maps.");
  }
  let catalogPath: string | null;
  if (available) {
    catalogPath = readString(value.catalogPath, "map catalog path");
  } else {
    if (value.catalogPath !== null) {
      throw new EditorProtocolError("Invalid map catalog path.");
    }
    catalogPath = null;
  }
  return {
    ok: true,
    data: {
      available,
      catalogPath,
      maps: value.maps.map(parseMap),
    },
  };
}

function publicError(domain: string, error: unknown): DesktopOperationError {
  if (error instanceof PythonClientError) {
    const messages = {
      python_unavailable: `The Python ${domain} service is unavailable.`,
      process_failed: `The Python ${domain} service failed.`,
      process_timeout: `The Python ${domain} service timed out.`,
      empty_response: `The Python ${domain} service returned no data.`,
      malformed_response: `The Python ${domain} service returned malformed data.`,
    } as const;
    return { code: error.code, message: messages[error.code] };
  }
  if (error instanceof EditorProtocolError) {
    return {
      code: "invalid_response",
      message: `The Python ${domain} response did not match the desktop contract.`,
    };
  }
  return { code: "internal_error", message: `The desktop ${domain} bridge failed unexpectedly.` };
}

function failure(domain: string, error: unknown): DesktopOperationFailure {
  console.error(`${domain} request failed.`, error);
  return { ok: false, error: publicError(domain, error) };
}

function validSaveId(saveId: unknown): saveId is string {
  return typeof saveId === "string" && SAVE_ID_PATTERN.test(saveId);
}

export async function listUpgrades(
  client: PythonClient,
  saveId: unknown,
): Promise<DesktopOperationResult<PlayerUpgradeDto[]>> {
  if (!validSaveId(saveId)) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "A valid discovered save ID is required." },
    };
  }
  try {
    return parseUpgrades(await client.run("upgrades-list", [saveId]));
  } catch (error) {
    return failure("upgrades", error);
  }
}

export async function getRunState(
  client: PythonClient,
  saveId: unknown,
): Promise<DesktopOperationResult<RunStateDto>> {
  if (!validSaveId(saveId)) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "A valid discovered save ID is required." },
    };
  }
  try {
    return parseRun(await client.run("run-get", [saveId]));
  } catch (error) {
    return failure("run", error);
  }
}

export async function getAdvancedSave(
  client: PythonClient,
  saveId: unknown,
  icons: LocalIconRegistry = localIconRegistry,
): Promise<DesktopOperationResult<AdvancedSaveDto>> {
  if (!validSaveId(saveId)) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "A valid discovered save ID is required." },
    };
  }
  try {
    return parseAdvanced(await client.run("advanced-get", [saveId]), icons);
  } catch (error) {
    return failure("advanced data", error);
  }
}

export async function listMaps(
  client: PythonClient,
): Promise<DesktopOperationResult<InstalledMapsDto>> {
  try {
    return parseMaps(await client.run("maps-list"));
  } catch (error) {
    return failure("maps", error);
  }
}

export function registerEditorIpc(client: PythonClient = pythonClient): void {
  ipcMain.handle(IPC_CHANNELS.upgradesList, (_event, saveId: unknown) =>
    listUpgrades(client, saveId),
  );
  ipcMain.handle(IPC_CHANNELS.runGet, (_event, saveId: unknown) =>
    getRunState(client, saveId),
  );
  ipcMain.handle(IPC_CHANNELS.advancedGet, (_event, saveId: unknown) =>
    getAdvancedSave(client, saveId),
  );
  ipcMain.handle(IPC_CHANNELS.mapsList, () => listMaps(client));
}
