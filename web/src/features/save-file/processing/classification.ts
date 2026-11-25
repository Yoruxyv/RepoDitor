import { isInteger } from "lossless-json";

import { isSaveNumber, isSaveObject, type SaveObject } from "./serialization";

export type SaveKind = "run" | "meta";
export type SaveClassification = SaveKind | "unsupported";

function typedValue(data: SaveObject, key: string): unknown {
  const entry = Object.hasOwn(data, key) ? data[key] : undefined;
  return isSaveObject(entry) && Object.hasOwn(entry, "value") ? entry.value : undefined;
}

function isRunSave(data: SaveObject): boolean {
  const players = typedValue(data, "playerNames");
  const dictionaries = typedValue(data, "dictionaryOfDictionaries");
  const runStats =
    isSaveObject(dictionaries) && Object.hasOwn(dictionaries, "runStats")
      ? dictionaries.runStats
      : undefined;
  return isSaveObject(players) && isSaveObject(runStats);
}

function isIntegerValue(value: unknown): boolean {
  return isSaveNumber(value) && isInteger(value.value);
}

function hasIntegerList(data: SaveObject, key: string): boolean {
  const value = typedValue(data, key);
  return Array.isArray(value) && value.every(isIntegerValue);
}

function isMetaSave(data: SaveObject): boolean {
  return (
    hasIntegerList(data, "cosmeticHistory") &&
    hasIntegerList(data, "cosmeticUnlocks") &&
    Array.isArray(typedValue(data, "cosmeticPresets"))
  );
}

export function classifySave(data: SaveObject): SaveClassification {
  const run = isRunSave(data);
  const meta = isMetaSave(data);
  if (run === meta) return "unsupported";
  return run ? "run" : "meta";
}
