import { resolveLocalizedMessage, type Translate } from "@/app/i18n/catalog";
import type { PendingEdit } from "@/features/save-file/session/pendingEdits";
import type { EditSession } from "@/features/save-file/session/session";
import { parseSaveJson } from "@/features/save-file/processing/serialization";
import { inspectRecharge } from "@/features/recharge/recharge";
import {
  inspectRunSave,
  RESUME_LOCATION_LABELS,
  type ResumeLocation,
} from "@/features/run-save/model/runSave";

function getUpgradeEdits(
  baseline: ReturnType<typeof inspectRunSave>,
  working: ReturnType<typeof inspectRunSave>,
): PendingEdit[] {
  const edits: PendingEdit[] = [];
  const baselineUpgrades = new Map(baseline.upgrades.map((upgrade) => [upgrade.key, upgrade]));
  for (const upgrade of working.upgrades) {
    const baselineUpgrade = baselineUpgrades.get(upgrade.key);
    if (!baselineUpgrade) {
      continue;
    }
    for (const player of working.players) {
      const before = baselineUpgrade.values.get(player.id) ?? 0;
      const after = upgrade.values.get(player.id) ?? 0;
      if (before !== after) {
        edits.push({
          after,
          before,
          field: upgrade.label,
          id: `upgrade:${player.id}:${upgrade.key}`,
          subject: player.name,
        });
      }
    }
  }
  return edits;
}

function rechargeStateLabel(
  needingRechargeCount: number,
  t: Translate,
  formatNumber: (value: number) => string,
): string {
  if (needingRechargeCount === 0) {
    return t("run.pending.allCharged");
  }
  return t("recharge.needed", { count: formatNumber(needingRechargeCount) }, needingRechargeCount);
}

function resumeLocationLabel(location: ResumeLocation | null, rawValue: number, t: Translate) {
  return location
    ? RESUME_LOCATION_LABELS[location]
    : t("run.run.unsupportedSpawn", { value: rawValue });
}

export function getRunPendingEdits(
  session: EditSession,
  t: Translate = (key, values, count) => resolveLocalizedMessage("en", key, values, count),
  formatNumber: (value: number) => string = String,
): PendingEdit[] {
  if (session.originalKind !== "run") {
    return [];
  }

  const baselineData = parseSaveJson(session.baselineSource);
  const baseline = inspectRunSave(baselineData);
  const working = inspectRunSave(session.working);
  const edits: PendingEdit[] = [];
  const runSubject = t("run.run.title");
  const baselinePlayers = new Map(baseline.players.map((player) => [player.id, player]));

  for (const player of working.players) {
    const before = baselinePlayers.get(player.id)?.health;
    if (before !== undefined && before !== player.health) {
      edits.push({
        after: player.health,
        before,
        field: t("run.players.currentHealth"),
        id: `player:${player.id}:health`,
        subject: player.name,
      });
    }
  }

  edits.push(...getUpgradeEdits(baseline, working));

  if (baseline.level !== working.level) {
    edits.push({
      after: working.level,
      before: baseline.level,
      field: t("run.run.level"),
      id: "run:level",
      subject: runSubject,
    });
  }
  if (baseline.currency !== working.currency) {
    edits.push({
      after: working.currency,
      before: baseline.currency,
      field: t("run.run.currency"),
      id: "run:currency",
      subject: runSubject,
    });
  }

  const beforeResume = resumeLocationLabel(baseline.resumeLocation, baseline.resumeValue, t);
  const afterResume = resumeLocationLabel(working.resumeLocation, working.resumeValue, t);
  if (beforeResume !== afterResume) {
    edits.push({
      after: afterResume,
      before: beforeResume,
      field: t("run.run.nextSpawn"),
      id: "run:resume-location",
      subject: runSubject,
    });
  }

  try {
    const baselineRecharge = inspectRecharge(baselineData);
    const workingRecharge = inspectRecharge(session.working);
    if (baselineRecharge.needingRechargeCount !== workingRecharge.needingRechargeCount) {
      edits.push({
        after: rechargeStateLabel(workingRecharge.needingRechargeCount, t, formatNumber),
        before: rechargeStateLabel(baselineRecharge.needingRechargeCount, t, formatNumber),
        field: t("run.pending.supportedItems"),
        id: "recharge:supported-items",
        subject: t("recharge.title"),
      });
    }
  } catch {
    // Malformed or unsupported item structures remain outside recharge editing.
  }

  return edits;
}
