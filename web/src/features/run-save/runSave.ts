import { isInteger, LosslessNumber } from "lossless-json";

import {
  isSaveNumber,
  isSaveObject,
  parseSaveJson,
  type SaveObject,
} from "@/features/save-file/serialization";
import type { EditSession } from "@/features/save-file/session";

const RUN_SAVE_KEY = {
  level: "save level",
} as const;

const RUN_VALUE_LABEL = {
  currentHealth: "Current health",
  playerHealth: "Player health",
  resumeLocation: "Resume location",
  upgradeValue: "Upgrade value",
} as const;

export const SAVE_INT32_MIN = -2_147_483_648;
export const SAVE_INT32_MAX = 2_147_483_647;
export const DISPLAY_LEVEL_MAX = SAVE_INT32_MAX + 1;

const UPGRADE_PREFIX = "playerUpgrade";
const BASE_PLAYER_HEALTH = 100;
const HEALTH_PER_UPGRADE = 20;
const UPGRADE_LABELS: Readonly<Record<string, string>> = {
  playerUpgradeLaunch: "Tumble Launch",
  playerUpgradeSpeed: "Sprint Speed",
};

export type ResumeLocation = "normal" | "shop";

export const RESUME_LOCATION_LABELS: Readonly<Record<ResumeLocation, string>> = {
  normal: "Normal",
  shop: "Shop / Service Station",
};

export interface RunPlayer {
  readonly health: number;
  readonly id: string;
  readonly name: string;
}

export interface RunUpgrade {
  readonly key: string;
  readonly label: string;
  readonly values: ReadonlyMap<string, number>;
}

export interface RunSaveState {
  readonly currency: number;
  readonly level: number;
  readonly players: readonly RunPlayer[];
  readonly resumeLocation: ResumeLocation | null;
  readonly resumeValue: number;
  readonly upgrades: readonly RunUpgrade[];
}

export class RunEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunEditError";
  }
}

export class PendingHealthLimitError extends RunEditError {
  readonly maximum: number;

  constructor(maximum: number) {
    super(`Pending Health must be a whole number between 0 and ${maximum}.`);
    this.name = "PendingHealthLimitError";
    this.maximum = maximum;
  }
}

function typedObject(data: SaveObject, key: string, label: string): SaveObject {
  const entry = Object.hasOwn(data, key) ? data[key] : undefined;
  if (!isSaveObject(entry) || !Object.hasOwn(entry, "value") || !isSaveObject(entry.value)) {
    throw new RunEditError(`${label} is not a supported save dictionary.`);
  }
  return entry.value;
}

function dictionaries(data: SaveObject): SaveObject {
  return typedObject(data, "dictionaryOfDictionaries", "Run data");
}

function runStats(data: SaveObject): SaveObject {
  const values = dictionaries(data);
  const stats = Object.hasOwn(values, "runStats") ? values.runStats : undefined;
  if (!isSaveObject(stats)) {
    throw new RunEditError("Run stats are not a supported save dictionary.");
  }
  return stats;
}

function optionalObject(data: SaveObject, key: string, label: string): SaveObject | null {
  if (!Object.hasOwn(data, key)) {
    return null;
  }
  const value = data[key];
  if (!isSaveObject(value)) {
    throw new RunEditError(`${label} is not a supported save dictionary.`);
  }
  return value;
}

function storedInteger(data: SaveObject, key: string, fallback: number, label: string): number {
  if (!Object.hasOwn(data, key)) {
    return fallback;
  }
  const value = data[key];
  if (!isSaveNumber(value) || !isInteger(value.value)) {
    throw new RunEditError(`${label} is not stored as an integer.`);
  }
  const parsed = Number(value.value);
  if (!Number.isSafeInteger(parsed) || parsed < SAVE_INT32_MIN || parsed > SAVE_INT32_MAX) {
    throw new RunEditError(`${label} is outside the signed Int32 save range.`);
  }
  return parsed;
}

function editableInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RunEditError(
      `${label} must be a whole number between ${minimum.toLocaleString("en-US")} and ${maximum.toLocaleString("en-US")}.`,
    );
  }
  return value;
}

function writeInteger(
  data: SaveObject,
  key: string,
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): void {
  const next = editableInteger(value, minimum, maximum, label);
  storedInteger(data, key, next, label);
  data[key] = new LosslessNumber(String(next));
}

function playerNames(data: SaveObject): SaveObject {
  return typedObject(data, "playerNames", "Player names");
}

function requirePlayer(data: SaveObject, playerId: string): void {
  const names = playerNames(data);
  if (!Object.hasOwn(names, playerId) || typeof names[playerId] !== "string") {
    throw new RunEditError("The selected player does not exist in this save.");
  }
}

function upgradeLabel(key: string): string {
  const fallback = key
    .slice(UPGRADE_PREFIX.length)
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .trim();
  return (UPGRADE_LABELS[key] ?? fallback) || key;
}

function discoveredUpgrades(data: SaveObject): [string, SaveObject][] {
  return Object.entries(dictionaries(data))
    .filter(
      (entry): entry is [string, SaveObject] =>
        entry[0].startsWith(UPGRADE_PREFIX) &&
        entry[0] !== UPGRADE_PREFIX &&
        isSaveObject(entry[1]),
    )
    .sort(([left], [right]) => upgradeLabel(left).localeCompare(upgradeLabel(right)));
}

function resumeLocation(value: number): ResumeLocation | null {
  if (value === 0) {
    return "normal";
  }
  if (value === 1) {
    return "shop";
  }
  return null;
}

export function describeResumeLocation(value: ResumeLocation | null, raw: number): string {
  return value ? RESUME_LOCATION_LABELS[value] : `Unsupported saved value (${raw})`;
}

export function inspectRunSave(data: SaveObject): RunSaveState {
  const names = playerNames(data);
  const savedHealth =
    optionalObject(dictionaries(data), "playerHealth", RUN_VALUE_LABEL.playerHealth) ?? {};
  const players = Object.entries(names).map(([id, name]) => {
    if (typeof name !== "string") {
      throw new RunEditError(`Player '${id}' does not have a supported name.`);
    }
    return {
      health: storedInteger(savedHealth, id, 0, `Current health for ${name}`),
      id,
      name,
    };
  });
  const upgrades = discoveredUpgrades(data).map(([key, values]) => ({
    key,
    label: upgradeLabel(key),
    values: new Map(
      players.map((player) => [
        player.id,
        storedInteger(values, player.id, 0, `${upgradeLabel(key)} for ${player.name}`),
      ]),
    ),
  }));
  const stats = runStats(data);
  const resumeValue = storedInteger(stats, RUN_SAVE_KEY.level, 0, RUN_VALUE_LABEL.resumeLocation);

  return {
    currency: storedInteger(stats, "currency", 0, "Currency"),
    level: storedInteger(stats, "level", 0, "Run level") + 1,
    players,
    resumeLocation: resumeLocation(resumeValue),
    resumeValue,
    upgrades,
  };
}

export function getPlayerMaxHealth(data: SaveObject, playerId: string): number {
  const upgrades = dictionaries(data).playerUpgradeHealth;
  const count = isSaveObject(upgrades) ? storedInteger(upgrades, playerId, 0, "Health upgrade") : 0;
  return BASE_PLAYER_HEALTH + Math.max(count, 0) * HEALTH_PER_UPGRADE;
}

export function setPlayerHealth(data: SaveObject, playerId: string, value: unknown): void {
  requirePlayer(data, playerId);
  const maximum = Math.min(getPlayerMaxHealth(data, playerId), SAVE_INT32_MAX);
  const next = editableInteger(value, 0, maximum, RUN_VALUE_LABEL.currentHealth);
  const values = dictionaries(data);
  let health = optionalObject(values, "playerHealth", RUN_VALUE_LABEL.playerHealth);
  if (health) {
    storedInteger(health, playerId, next, RUN_VALUE_LABEL.currentHealth);
  } else {
    health = {};
    values.playerHealth = health;
  }
  health[playerId] = new LosslessNumber(String(next));
}

export function validatePendingHealthEdits(baseline: SaveObject, working: SaveObject): void {
  const health = dictionaries(working).playerHealth;
  if (!isSaveObject(health)) return;
  const originalHealth = dictionaries(baseline).playerHealth;
  for (const [playerId, value] of Object.entries(health)) {
    const before =
      isSaveObject(originalHealth) && Object.hasOwn(originalHealth, playerId)
        ? originalHealth[playerId]
        : undefined;
    // Only a numeric Health edit can be staged. Imported values may already exceed the cap.
    if (!isSaveNumber(value) || (isSaveNumber(before) && before.value === value.value)) continue;
    const maximum = Math.min(getPlayerMaxHealth(working, playerId), SAVE_INT32_MAX);
    const edited = storedInteger(health, playerId, 0, RUN_VALUE_LABEL.currentHealth);
    if (edited < 0 || edited > maximum) throw new PendingHealthLimitError(maximum);
  }
}

export function setPlayerUpgrade(
  data: SaveObject,
  playerId: string,
  key: string,
  value: unknown,
): void {
  const next = editableInteger(value, 0, SAVE_INT32_MAX, RUN_VALUE_LABEL.upgradeValue);
  requirePlayer(data, playerId);
  const values = dictionaries(data);
  const upgrade =
    Object.hasOwn(values, key) &&
    key.startsWith(UPGRADE_PREFIX) &&
    key !== UPGRADE_PREFIX &&
    isSaveObject(values[key])
      ? values[key]
      : null;
  if (!upgrade) {
    throw new RunEditError("This upgrade is not present as a supported field in the save.");
  }
  storedInteger(upgrade, playerId, next, RUN_VALUE_LABEL.upgradeValue);
  upgrade[playerId] = new LosslessNumber(String(next));
}

export function setCurrency(data: SaveObject, value: unknown): void {
  writeInteger(runStats(data), "currency", value, SAVE_INT32_MIN, SAVE_INT32_MAX, "Currency");
}

export function setRunLevel(session: EditSession, value: unknown): void {
  const next = editableInteger(value, 1, DISPLAY_LEVEL_MAX, "Run level") - 1;
  const stats = runStats(session.working);
  storedInteger(stats, "level", 0, "Run level");
  const original = runStats(parseSaveJson(session.baselineSource));

  if (next !== storedInteger(original, "level", 0, "Run level")) {
    stats.level = new LosslessNumber(String(next));
  } else if (Object.hasOwn(original, "level")) {
    stats.level = original.level;
  } else {
    Reflect.deleteProperty(stats, "level");
  }
}

export function setResumeLocation(data: SaveObject, value: unknown): void {
  if (value !== "normal" && value !== "shop") {
    throw new RunEditError(
      `Resume location must be ${RESUME_LOCATION_LABELS.normal} or ${RESUME_LOCATION_LABELS.shop}.`,
    );
  }
  writeInteger(
    runStats(data),
    RUN_SAVE_KEY.level,
    value === "normal" ? 0 : 1,
    0,
    1,
    RUN_VALUE_LABEL.resumeLocation,
  );
}
