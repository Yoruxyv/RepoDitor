import type { PlayerDto } from "@/app/tauri/desktopContracts";
import {
  type tauriHealthApi,
  mixedIntentFits,
  type MixedEdits,
  type HealthCanonical,
  type HealthState,
  upgradeIntentFits,
  runIntentFits,
  healthIntentFits,
  refillIntentFits,
} from "@/app/tauri/tauriHealthApi";
import type {
  PlayerHealthEdit,
  AdvancedRefillEdit,
  RunStatEdit,
  UpgradeValueEdit,
} from "@/features/pending-changes/pendingEdits";

export type HealthPhase =
  | "checking"
  | "disabled"
  | "editing"
  | "saving"
  | "reconciling"
  | "recovery"
  | "saved"
  | "rejected"
  | "unchanged"
  | "conflict";
export interface RunDraftState {
  enabled: boolean;
  draftOnly: boolean;
  production: boolean;
  domains: HealthState["domains"];
  compatibility?: HealthState["compatibility"];
  resumeAllowed?: HealthState["resumeAllowed"];
  phase: HealthPhase;
  healthEdits: PlayerHealthEdit[];
  refillEdits: AdvancedRefillEdit[];
  operationId: string | null;
  pendingOperationId: string | null;
  restoredPlayerId: string | null;
  canonical: HealthCanonical | null;
  reason: string | null;
  backupVerified: boolean;
  resetVersion: number;
  upgradeEdits: UpgradeValueEdit[];
  upgradeSession: string | null;
  runEdits: RunStatEdit[];
}

export function restorePending(
  current: RunDraftState,
  operation: NonNullable<HealthState["pending"]>,
): RunDraftState {
  const { intent, operationId } = operation;
  const hasDraft = [
    current.healthEdits,
    current.refillEdits,
    current.upgradeEdits,
    current.runEdits,
  ].some((edits) => edits.length > 0);
  let healthEdits = current.healthEdits;
  let refillEdits = current.refillEdits;
  let upgradeEdits = current.upgradeEdits;
  let runEdits = current.runEdits;
  let restoredPlayerId: string | null = null;
  const pending = hasDraft ? null : intent;
  const draft = pending && "mixed" in pending ? pending.mixed : pending;
  if (draft && "refillToFull" in draft) {
    refillEdits = draft.refillToFull.map((edit) => ({
      feature: "advanced",
      entity: edit.saveKey,
      field: "refillToFull",
      after: true,
      before: edit.before,
      label: "Stored charge",
      subject: edit.saveKey,
    }));
  }
  if (draft && "upgrades" in draft) {
    upgradeEdits = draft.upgrades.map((edit) => ({
      feature: "upgrades",
      entity: edit.playerId,
      field: edit.key,
      before: edit.before,
      after: edit.value,
      label: edit.key,
      subject: edit.playerId,
    }));
    restoredPlayerId = draft.upgrades[0]?.playerId ?? null;
  }
  if (draft && "run" in draft) {
    runEdits = draft.run.map(
      (edit) =>
        ({
          feature: "run",
          entity: "run",
          field: edit.field,
          before: edit.before,
          after: edit.value,
          label: edit.field,
          subject: "Run",
        }) as RunStatEdit,
    );
  }
  if (draft && "health" in draft) {
    const edits =
      "playerId" in draft
        ? [{ playerId: draft.playerId, before: draft.before, value: draft.health }]
        : draft.health;
    healthEdits = edits.map((edit) => ({
      feature: "players",
      entity: edit.playerId,
      field: "health",
      before: edit.before,
      after: edit.value,
      label: "Health",
      subject: edit.playerId,
    }));
    restoredPlayerId = edits[0]?.playerId ?? restoredPlayerId;
  }
  return {
    ...current,
    enabled: true,
    phase: "recovery",
    backupVerified: false,
    healthEdits,
    refillEdits,
    operationId,
    upgradeEdits,
    runEdits,
    pendingOperationId: hasDraft ? current.pendingOperationId : operationId,
    restoredPlayerId,
    resetVersion: current.resetVersion + 1,
  };
}

export function mixedEdits(state: RunDraftState): MixedEdits {
  return {
    health: healthIntent(state.healthEdits),
    upgrades: state.upgradeEdits.map((edit) => ({
      playerId: edit.entity,
      key: edit.field,
      before: edit.before,
      value: edit.after,
    })),
    run: runIntent(state.runEdits),
    refillToFull: refillIntent(state.refillEdits),
  };
}

export function domainCount(draft: MixedEdits): number {
  return Object.values(draft).filter((group) => group.length > 0).length;
}

export function domainEnabled(state: RunDraftState, domain: keyof MixedEdits): boolean {
  return state.enabled && (!state.production || state.domains?.includes(domain) === true);
}

export function validDraft(
  state: RunDraftState,
  players: PlayerDto[],
  api: Partial<typeof tauriHealthApi>,
): boolean {
  const draft = mixedEdits(state);
  const count = domainCount(draft);
  const mixed = count > 1;
  if (
    state.draftOnly ||
    !state.upgradeSession ||
    count === 0 ||
    (Object.keys(draft) as (keyof MixedEdits)[]).some(
      (domain) => draft[domain].length > 0 && !domainEnabled(state, domain),
    ) ||
    (mixed && (!api.writeMixed || !mixedIntentFits(draft)))
  )
    return false;
  return (
    (draft.refillToFull.length === 0 ||
      ((mixed || !!api.writeRefills) &&
        refillIntentFits(draft.refillToFull) &&
        (!state.canonical?.advanced ||
          state.refillEdits.every((edit) => {
            const item = refillValue(state.canonical!, edit);
            return item?.canRefillToFull && item.storedCharge === edit.before;
          })))) &&
    (draft.run.length === 0 || ((mixed || !!api.writeRun) && runIntentFits(draft.run))) &&
    (draft.health.length === 0 ||
      (healthIntentFits(draft.health) &&
        state.healthEdits.every((edit) => {
          const player = (state.canonical?.players ?? players).find((p) => p.id === edit.entity);
          return !!player && edit.after <= player.maxHealth;
        }))) &&
    (draft.upgrades.length === 0 ||
      ((mixed || !!api.writeUpgrades) && upgradeIntentFits(draft.upgrades)))
  );
}

function runIntent(edits: RunStatEdit[]) {
  return edits.map((edit) => ({ field: edit.field, before: edit.before, value: edit.after }));
}
function refillIntent(edits: AdvancedRefillEdit[]) {
  return edits.map((edit) => ({ saveKey: edit.entity, before: edit.before }));
}
function refillValue(projection: HealthCanonical, edit: AdvancedRefillEdit) {
  return projection.advanced?.items.find((item) => item.saveKey === edit.entity);
}
export function refillApplied(projection: HealthCanonical, edit: AdvancedRefillEdit) {
  const item = refillValue(projection, edit);
  return (
    !!item &&
    item.storedCharge === null &&
    item.chargeState === "default_full" &&
    item.rechargeCapability === "rechargeable" &&
    !item.canRefillToFull
  );
}
export function rebaseRefills(
  edits: AdvancedRefillEdit[],
  projection: HealthCanonical,
): AdvancedRefillEdit[] | null {
  if (!projection.advanced) return edits;
  if (edits.some((edit) => !refillValue(projection, edit))) return null;
  return edits.map((edit) => ({
    ...edit,
    before: refillValue(projection, edit)!.storedCharge ?? edit.before,
    subject: refillValue(projection, edit)!.name,
  }));
}
export function healthIntent(edits: PlayerHealthEdit[]) {
  return edits.map((edit) => ({ playerId: edit.entity, before: edit.before, value: edit.after }));
}
export function healthValue(
  projection: HealthCanonical,
  edit: PlayerHealthEdit,
): number | undefined {
  return projection.players.find((player) => player.id === edit.entity)?.health;
}
export function rebaseHealth(
  edits: PlayerHealthEdit[],
  projection: HealthCanonical,
): PlayerHealthEdit[] | null {
  if (edits.some((edit) => healthValue(projection, edit) === undefined)) return null;
  return edits.map((edit) => ({
    ...edit,
    before: healthValue(projection, edit)!,
    subject: projection.players.find((player) => player.id === edit.entity)!.name,
  }));
}
export function runValue(
  projection: HealthCanonical,
  edit: RunStatEdit,
): number | string | undefined {
  return edit.field === "resumeLocation"
    ? projection.run?.resumeLocation.value
    : projection.run?.stats.find((stat) => stat.key === edit.field)?.value;
}
export function rebaseRun(edits: RunStatEdit[], projection: HealthCanonical): RunStatEdit[] | null {
  if (edits.some((edit) => runValue(projection, edit) === undefined)) return null;
  return edits.map((edit) => ({ ...edit, before: runValue(projection, edit)! }));
}

export function upgradeValue(
  projection: HealthCanonical,
  edit: UpgradeValueEdit,
): number | undefined {
  return projection.upgrades
    ?.find((upgrade) => upgrade.key === edit.field)
    ?.values.find((value) => value.playerId === edit.entity)?.value;
}
export function rebaseUpgrades(
  edits: UpgradeValueEdit[],
  projection: HealthCanonical,
): UpgradeValueEdit[] | null {
  if (
    edits.some(
      (edit) =>
        upgradeValue(projection, edit) === undefined ||
        !projection.players.some((p) => p.id === edit.entity),
    )
  )
    return null;
  return edits.map((edit) => ({
    ...edit,
    before: upgradeValue(projection, edit)!,
    subject: projection.players.find((p) => p.id === edit.entity)!.name,
    label: projection.upgrades!.find((u) => u.key === edit.field)!.label,
  }));
}
