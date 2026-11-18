import { describe, expect, it } from "vitest";

import type { LoadedSave } from "@/features/save-file/pipeline";
import { createEditSession, resetEditSession } from "@/features/save-file/session";
import { parseSaveJson } from "@/features/save-file/serialization";
import { rechargeAllSupportedItems } from "@/features/recharge/recharge";
import { getRunPendingEdits } from "@/features/run-save/pendingEdits";
import {
  setCurrency,
  setPlayerHealth,
  setPlayerUpgrade,
  setResumeLocation,
  setRunLevel,
} from "@/features/run-save/runSave";

const RUN_SOURCE = JSON.stringify({
  dictionaryOfDictionaries: {
    value: {
      playerHealth: { "111": 80 },
      playerUpgradeStrength: { "111": 2 },
      item: { "Item Gun Tranq/1": 15, "Item Melee Inflatable Hammer/2": 21 },
      itemStatBattery: { "Item Gun Tranq/1": 0, "Item Melee Inflatable Hammer/2": 20 },
      runStats: { currency: 12, level: 0, "save level": 0 },
    },
  },
  playerNames: { value: { "111": "Alpha" } },
});

function session() {
  const save: LoadedSave = {
    data: parseSaveJson(RUN_SOURCE),
    fileName: "REPO_SAVE.es3",
    kind: "run",
  };
  return createEditSession(save);
}

describe("pending Run edits", () => {
  it("projects supported mutations with user-facing labels", () => {
    const editSession = session();

    setPlayerHealth(editSession.working, "111", 95);
    setPlayerUpgrade(editSession.working, "111", "playerUpgradeStrength", 3);
    setCurrency(editSession.working, 67);
    setRunLevel(editSession, 5);
    setResumeLocation(editSession.working, "shop");

    expect(getRunPendingEdits(editSession)).toEqual([
      {
        after: 95,
        before: 80,
        field: "Current health",
        id: "player:111:health",
        subject: "Alpha",
      },
      {
        after: 3,
        before: 2,
        field: "Strength",
        id: "upgrade:111:playerUpgradeStrength",
        subject: "Alpha",
      },
      { after: 5, before: 1, field: "Run level", id: "run:level", subject: "Run" },
      { after: 67, before: 12, field: "Currency", id: "run:currency", subject: "Run" },
      {
        after: "Shop / Service Station",
        before: "Normal",
        field: "Next spawn",
        id: "run:resume-location",
        subject: "Run",
      },
    ]);
  });

  it("is clean initially and after a value is manually restored", () => {
    const editSession = session();

    expect(getRunPendingEdits(editSession)).toEqual([]);
    setPlayerHealth(editSession.working, "111", 95);
    expect(getRunPendingEdits(editSession)).toHaveLength(1);
    setPlayerHealth(editSession.working, "111", 80);
    expect(getRunPendingEdits(editSession)).toEqual([]);
  });

  it("keeps recharge as one semantic baseline-to-current edit and discard removes it", () => {
    const editSession = session();

    expect(rechargeAllSupportedItems(editSession.working)).toBe(true);
    expect(getRunPendingEdits(editSession)).toEqual([
      {
        after: "All supported items fully charged",
        before: "2 items need recharging",
        field: "Supported items",
        id: "recharge:supported-items",
        subject: "Recharge",
      },
    ]);
    expect(rechargeAllSupportedItems(editSession.working)).toBe(false);
    expect(getRunPendingEdits(editSession)).toHaveLength(1);

    expect(getRunPendingEdits(resetEditSession(editSession))).toEqual([]);
  });
});
