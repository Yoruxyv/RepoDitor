/** Shared Run-save drafts; durable identity and reconciliation remain Python-owned. */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdvancedItemDto,
  PlayerDto,
  PlayerUpgradeDto,
  SaveSession,
} from "@/app/tauri/desktopContracts";
import {
  tauriHealthApi,
  type HealthCanonical,
  type HealthState,
  type HealthTransaction,
  upgradeIntentFits,
  healthIntentFits,
} from "@/app/tauri/tauriHealthApi";
import type { AdvancedRefillEdit, RunStatEdit } from "@/features/pending-changes/pendingEdits";
import { refillEdit } from "@/features/items/useItems";
import {
  restorePending,
  mixedEdits,
  domainCount,
  domainEnabled,
  validDraft,
  refillApplied,
  rebaseRefills,
  healthIntent,
  healthValue,
  rebaseHealth,
  runValue,
  rebaseRun,
  upgradeValue,
  rebaseUpgrades,
  type HealthPhase,
  type RunDraftState,
} from "./runDrafts";
export type { HealthPhase } from "./runDrafts";

const INITIAL: RunDraftState = {
  enabled: false,
  draftOnly: false,
  production: false,
  domains: undefined,
  phase: "checking",
  healthEdits: [],
  refillEdits: [],
  operationId: null,
  pendingOperationId: null,
  restoredPlayerId: null,
  canonical: null,
  reason: null,
  backupVerified: false,
  resetVersion: 0,
  upgradeEdits: [],
  upgradeSession: null,
  runEdits: [],
};
const LOCKED: readonly HealthPhase[] = [
  "checking",
  "saving",
  "reconciling",
  "recovery",
  "conflict",
  "disabled",
];

export function useTauriHealth(
  session: SaveSession,
  players: PlayerDto[],
  onCanonical: (projection: HealthCanonical) => void,
  api: Pick<typeof tauriHealthApi, "state" | "writeHealthBatch" | "recover"> &
    Partial<
      Pick<typeof tauriHealthApi, "writeUpgrades" | "writeRun" | "writeRefills" | "writeMixed">
    > = tauriHealthApi,
) {
  const [state, setState] = useState<RunDraftState>(INITIAL);
  const [invalid, setInvalid] = useState(false);
  const [invalidUpgrades, setInvalidUpgrades] = useState<Record<string, boolean>>({});
  const [invalidRun, setInvalidRun] = useState<Record<string, boolean>>({});
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const base = useRef(session);
  const accept = useRef(onCanonical);
  useEffect(() => {
    accept.current = onCanonical;
  }, [onCanonical]);

  const publish = useCallback((value: HealthCanonical) => {
    base.current = value.opened.session;
    accept.current(value);
  }, []);

  const restore = useCallback(
    (result: HealthState) => {
      if (!mounted.current) return;
      setState((previous) => {
        const current = {
          ...previous,
          draftOnly: result.draftOnly ?? previous.draftOnly,
          production: result.production === true || previous.production,
          domains: result.domains ?? previous.domains,
        };
        if (!result.enabled) {
          return {
            ...current,
            phase: current.enabled ? "conflict" : "disabled",
            backupVerified: false,
          };
        }
        if (result.state === "busy")
          return { ...current, enabled: true, phase: "checking", backupVerified: false };
        if (result.state === "pending" && result.pending) {
          return {
            ...restorePending(current, result.pending),
            upgradeSession: result.upgradeSession ?? null,
          };
        }
        if (result.state !== "idle" || !result.canonical)
          return { ...current, enabled: true, phase: "conflict", backupVerified: false };
        const healthEdits = rebaseHealth(current.healthEdits, result.canonical);
        const refillEdits = rebaseRefills(current.refillEdits, result.canonical);
        const upgradeEdits = rebaseUpgrades(current.upgradeEdits, result.canonical);
        const runEdits = rebaseRun(current.runEdits, result.canonical);
        if (!healthEdits || !refillEdits || !upgradeEdits || !runEdits)
          return { ...current, phase: "conflict", backupVerified: false };
        return {
          ...current,
          enabled: true,
          phase: "editing",
          canonical: result.canonical,
          operationId: null,
          pendingOperationId: null,
          upgradeSession: result.upgradeSession ?? null,
          upgradeEdits,
          runEdits,
          healthEdits,
          refillEdits,
          reason: null,
          resetVersion: current.resetVersion + 1,
        };
      });
      if (result.enabled && result.state === "idle" && result.canonical) publish(result.canonical);
    },
    [publish],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [session.id]);

  const checking = state.phase === "checking";
  useEffect(() => {
    if (!checking) return;
    let timer: number | undefined;
    let cancelled = false;
    async function load() {
      const result = await api.state(session.id);
      if (cancelled) return;
      restore(result);
      if (result.enabled && result.state === "busy")
        timer = window.setTimeout(() => void load(), 1000);
    }
    void load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [api, session.id, restore, checking]);

  function edit(player: PlayerDto, health: number) {
    if (
      !domainEnabled(state, "health") ||
      inFlight.current ||
      LOCKED.includes(state.phase) ||
      !Number.isSafeInteger(health) ||
      health < 0 ||
      health > player.maxHealth
    )
      return;
    if (
      state.refillEdits.length === 0 &&
      state.phase === "unchanged" &&
      health === player.health &&
      state.healthEdits.length === 1 &&
      state.healthEdits[0]?.entity === player.id &&
      state.upgradeEdits.length === 0 &&
      state.runEdits.length === 0
    ) {
      void revert();
      return;
    }
    setState((current) => ({
      ...current,
      phase: current.phase === "unchanged" ? "unchanged" : "editing",
      pendingOperationId: null,
      restoredPlayerId: null,
      reason: null,
      backupVerified: false,
      healthEdits: [
        ...current.healthEdits.filter((edit) => edit.entity !== player.id),
        ...(health === player.health
          ? []
          : [
              {
                feature: "players" as const,
                entity: player.id,
                field: "health" as const,
                before: player.health,
                after: health,
                label: "Health",
                subject: player.name,
              },
            ]),
      ],
    }));
  }

  function editUpgrade(upgrade: PlayerUpgradeDto, player: PlayerDto, value: number) {
    if (
      !domainEnabled(state, "upgrades") ||
      inFlight.current ||
      LOCKED.includes(state.phase) ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 2_147_483_647
    )
      return;
    const before = upgrade.values.find((entry) => entry.playerId === player.id)?.value;
    if (before === undefined) return;
    if (
      value === before &&
      state.refillEdits.length === 0 &&
      state.phase === "unchanged" &&
      state.operationId &&
      state.healthEdits.length === 0 &&
      state.runEdits.length === 0 &&
      state.upgradeEdits.length === 1
    ) {
      void revert();
      return;
    }
    setState((current) => ({
      ...current,
      phase: current.phase === "unchanged" ? "unchanged" : "editing",
      reason: null,
      pendingOperationId: null,
      backupVerified: false,
      upgradeEdits: [
        ...current.upgradeEdits.filter(
          (edit) => edit.entity !== player.id || edit.field !== upgrade.key,
        ),
        ...(value === before
          ? []
          : [
              {
                feature: "upgrades" as const,
                entity: player.id,
                field: upgrade.key,
                before,
                after: value,
                label: upgrade.label,
                subject: player.name,
              },
            ]),
      ],
    }));
  }
  function revertUpgrade(playerId: string, key: string) {
    if (inFlight.current || LOCKED.includes(state.phase)) return;
    if (
      state.refillEdits.length === 0 &&
      state.phase === "unchanged" &&
      state.operationId &&
      state.healthEdits.length === 0 &&
      state.runEdits.length === 0 &&
      state.upgradeEdits.length === 1
    ) {
      void revert();
      return;
    }
    setState((current) => ({
      ...current,
      pendingOperationId: null,
      upgradeEdits: current.upgradeEdits.filter(
        (edit) => edit.entity !== playerId || edit.field !== key,
      ),
    }));
    setInvalidUpgrades((current) => {
      const next = { ...current };
      delete next[`${playerId}:${key}`];
      return next;
    });
  }
  const setUpgradeInvalid = useCallback((playerId: string, key: string, value: boolean) => {
    setInvalidUpgrades((current) =>
      (current[`${playerId}:${key}`] ?? false) === value
        ? current
        : { ...current, [`${playerId}:${key}`]: value },
    );
  }, []);
  function revertHealth(playerId: string) {
    if (inFlight.current || LOCKED.includes(state.phase)) return;
    if (
      state.refillEdits.length === 0 &&
      state.phase === "unchanged" &&
      state.operationId &&
      state.healthEdits.length === 1 &&
      state.healthEdits[0]?.entity === playerId &&
      state.upgradeEdits.length === 0 &&
      state.runEdits.length === 0
    ) {
      void revert();
      return;
    }
    setState((current) => ({
      ...current,
      healthEdits: current.healthEdits.filter((edit) => edit.entity !== playerId),
      pendingOperationId: null,
      resetVersion: current.resetVersion + 1,
    }));
    setInvalid(false);
  }

  function editRun(edit: RunStatEdit) {
    if (!domainEnabled(state, "run") || inFlight.current || LOCKED.includes(state.phase)) return;
    if (
      edit.before === edit.after &&
      state.refillEdits.length === 0 &&
      state.phase === "unchanged" &&
      state.operationId &&
      state.healthEdits.length === 0 &&
      state.upgradeEdits.length === 0 &&
      state.runEdits.length === 1
    ) {
      void revert();
      return;
    }
    setState((current) => ({
      ...current,
      phase: current.phase === "unchanged" ? "unchanged" : "editing",
      reason: null,
      pendingOperationId: null,
      backupVerified: false,
      runEdits: [
        ...current.runEdits.filter((entry) => entry.field !== edit.field),
        ...(edit.before === edit.after ? [] : [edit]),
      ],
    }));
  }
  function revertRun(field: string) {
    if (inFlight.current || LOCKED.includes(state.phase)) return;
    if (
      state.refillEdits.length === 0 &&
      state.phase === "unchanged" &&
      state.operationId &&
      state.healthEdits.length === 0 &&
      state.upgradeEdits.length === 0 &&
      state.runEdits.length === 1 &&
      state.runEdits[0]?.field === field
    ) {
      void revert();
      return;
    }
    setState((current) => ({
      ...current,
      pendingOperationId: null,
      runEdits: current.runEdits.filter((edit) => edit.field !== field),
    }));
    setInvalidRun((current) => ({ ...current, [field]: false }));
  }
  const setRunInvalid = useCallback((field: string, value: boolean) => {
    setInvalidRun((current) =>
      (current[field] ?? false) === value ? current : { ...current, [field]: value },
    );
  }, []);

  function stageRefills(items: readonly AdvancedItemDto[]) {
    if (!domainEnabled(state, "refillToFull") || inFlight.current || LOCKED.includes(state.phase))
      return;
    const edits = items.map(refillEdit).filter((edit): edit is AdvancedRefillEdit => edit !== null);
    if (edits.length === 0) return;
    const targets = new Set(edits.map((edit) => edit.entity));
    setState((current) => ({
      ...current,
      refillEdits: [...current.refillEdits.filter((edit) => !targets.has(edit.entity)), ...edits],
      phase: current.phase === "unchanged" ? "unchanged" : "editing",
      pendingOperationId: null,
      backupVerified: false,
      reason: null,
    }));
  }
  function revertRefill(saveKey: string) {
    if (inFlight.current || LOCKED.includes(state.phase)) return;
    if (
      state.phase === "unchanged" &&
      state.operationId &&
      state.refillEdits.length === 1 &&
      state.refillEdits[0]?.entity === saveKey &&
      state.healthEdits.length === 0 &&
      state.upgradeEdits.length === 0 &&
      state.runEdits.length === 0
    ) {
      void revert();
      return;
    }
    setState((current) => ({
      ...current,
      refillEdits: current.refillEdits.filter((edit) => edit.entity !== saveKey),
      pendingOperationId: null,
    }));
  }

  async function reconcile(
    operationId: string,
    acknowledge: boolean,
    ownRequest = state.pendingOperationId === operationId,
  ): Promise<HealthTransaction | null> {
    const result = await (state.production
      ? api.recover(session.id, operationId, acknowledge, true)
      : api.recover(session.id, operationId, acknowledge));
    if (!mounted.current) return null;
    if (
      result.operationId !== operationId ||
      !result.canonical ||
      !["applied", "unchanged", "rejected"].includes(result.status)
    ) {
      setState((current) => ({
        ...current,
        phase: result.status === "busy" ? "recovery" : "conflict",
        backupVerified: false,
        reason: result.reason,
      }));
      return null;
    }
    const healthEdits = rebaseHealth(state.healthEdits, result.canonical);
    const refillEdits = rebaseRefills(state.refillEdits, result.canonical);
    const upgraded = rebaseUpgrades(state.upgradeEdits, result.canonical);
    const runEdits = rebaseRun(state.runEdits, result.canonical);
    const own = ownRequest;
    if (
      !healthEdits ||
      !refillEdits ||
      !upgraded ||
      !runEdits ||
      (result.status === "applied" &&
        own &&
        (state.refillEdits.some((edit) => !refillApplied(result.canonical!, edit)) ||
          state.healthEdits.some((edit) => healthValue(result.canonical!, edit) !== edit.after) ||
          state.upgradeEdits.some((edit) => upgradeValue(result.canonical!, edit) !== edit.after) ||
          state.runEdits.some((edit) => runValue(result.canonical!, edit) !== edit.after)))
    ) {
      setState((current) => ({ ...current, phase: "conflict", backupVerified: false }));
      return null;
    }
    publish(result.canonical);
    setState((current) => ({
      ...current,
      canonical: result.canonical,
      backupVerified: result.backupAvailable,
      upgradeEdits: result.status !== "applied" || !own ? upgraded : current.upgradeEdits,
      runEdits: result.status !== "applied" || !own ? runEdits : current.runEdits,
      healthEdits: result.status !== "applied" || !own ? healthEdits : current.healthEdits,
      refillEdits: result.status !== "applied" || !own ? refillEdits : current.refillEdits,
      resetVersion: current.resetVersion + 1,
    }));
    return result;
  }

  async function finishApplied(
    operationId: string,
    ownRequest = state.pendingOperationId === operationId,
  ) {
    const result = await reconcile(operationId, true, ownRequest);
    if (result?.status === "applied") {
      setState((current) => {
        const own =
          (current.healthEdits.length === 0 &&
            current.refillEdits.length === 0 &&
            current.upgradeEdits.length === 0 &&
            current.runEdits.length === 0) ||
          current.pendingOperationId === operationId;
        return {
          ...current,
          phase: own ? "saved" : "unchanged",
          healthEdits: own ? [] : current.healthEdits,
          refillEdits: own ? [] : current.refillEdits,
          upgradeEdits: own ? [] : current.upgradeEdits,
          runEdits: own ? [] : current.runEdits,
          operationId: null,
          pendingOperationId: null,
          restoredPlayerId: null,
          reason: null,
          backupVerified: own && result.backupAvailable,
        };
      });
    } else if (result) {
      setState((current) => ({ ...current, phase: "conflict", backupVerified: false }));
    }
  }

  async function recover() {
    if (inFlight.current || !state.operationId) return;
    inFlight.current = true;
    setState((current) => ({ ...current, phase: "reconciling" }));
    try {
      const result = await reconcile(state.operationId, false);
      if (result?.status === "applied") await finishApplied(state.operationId);
      else if (result) setState((current) => ({ ...current, phase: "unchanged", reason: null }));
    } catch {
      if (mounted.current)
        setState((current) => ({ ...current, phase: "recovery", backupVerified: false }));
    } finally {
      inFlight.current = false;
    }
  }

  async function save() {
    if (
      inFlight.current ||
      invalid ||
      Object.values(invalidUpgrades).some(Boolean) ||
      Object.values(invalidRun).some(Boolean) ||
      LOCKED.includes(state.phase) ||
      !validDraft(state, players, api)
    )
      return;
    const draft = mixedEdits(state);
    const { health, upgrades, run, refillToFull } = draft;
    const productionArgs: [] | [true] = state.production ? [true] : [];
    inFlight.current = true;
    try {
      if (state.phase === "unchanged" && state.operationId) {
        setState((current) => ({ ...current, phase: "reconciling" }));
        const acknowledged = await reconcile(state.operationId, true);
        if (!acknowledged || !["unchanged", "rejected"].includes(acknowledged.status)) return;
      }
      const operationId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      setState((current) => ({
        ...current,
        phase: "saving",
        operationId,
        pendingOperationId: operationId,
        restoredPlayerId: null,
        reason: null,
        backupVerified: false,
      }));
      let result: HealthTransaction;
      if (domainCount(draft) > 1) {
        result = await api.writeMixed!(
          {
            saveId: session.id,
            fingerprint: base.current.fingerprint,
            operationId,
            session: state.upgradeSession!,
            mixed: draft,
          },
          ...productionArgs,
        );
      } else if (refillToFull.length > 0) {
        result = await api.writeRefills!(
          {
            saveId: session.id,
            fingerprint: base.current.fingerprint,
            operationId,
            session: state.upgradeSession!,
            refillToFull,
          },
          ...productionArgs,
        );
      } else if (health.length > 0) {
        const request = {
          saveId: session.id,
          fingerprint: base.current.fingerprint,
          health,
          session: state.upgradeSession!,
          operationId,
        };
        result = await api.writeHealthBatch(request, ...productionArgs);
      } else if (run.length > 0) {
        result = await api.writeRun!(
          {
            saveId: session.id,
            fingerprint: base.current.fingerprint,
            operationId,
            session: state.upgradeSession!,
            run,
          },
          ...productionArgs,
        );
      } else {
        result = await api.writeUpgrades!(
          {
            saveId: session.id,
            fingerprint: base.current.fingerprint,
            operationId,
            session: state.upgradeSession!,
            upgrades,
          },
          ...productionArgs,
        );
      }
      if (!mounted.current) return;
      await applyWriteResult(result, operationId);
    } catch {
      if (mounted.current)
        setState((current) => ({ ...current, phase: "recovery", backupVerified: false }));
    } finally {
      inFlight.current = false;
    }
  }

  async function verifyAppliedWrite(operationId: string) {
    // Production acknowledgement checks ciphertext, the backup, and canonical values itself.
    if (state.production) return finishApplied(operationId, true);
    const verified = await reconcile(operationId, false, true);
    if (verified?.status === "applied") await finishApplied(operationId, true);
    else if (verified)
      setState((current) => ({ ...current, phase: "conflict", backupVerified: false }));
  }

  async function applyWriteResult(result: HealthTransaction, operationId: string) {
    if (result.operationId !== operationId) {
      setState((current) => ({ ...current, phase: "recovery", backupVerified: false }));
    } else if (result.status === "applied") {
      await verifyAppliedWrite(operationId);
    } else if (result.status === "rejected") {
      const status = await api.state(session.id);
      if (!mounted.current) return;
      if (status.enabled && status.state === "idle") {
        setState((current) => ({ ...current, phase: "rejected", reason: result.reason }));
      } else if (state.production && !status.enabled && status.state === "disabled") {
        setState((current) => ({
          ...current,
          phase: "rejected",
          upgradeSession: null,
          reason: result.reason,
        }));
      } else restore(status);
    } else {
      setState((current) => ({
        ...current,
        phase: "recovery",
        backupVerified: false,
        reason: result.reason,
      }));
    }
  }

  async function revert() {
    if (inFlight.current || LOCKED.includes(state.phase)) return;
    inFlight.current = true;
    try {
      if (state.phase === "unchanged" && state.operationId) {
        setState((current) => ({ ...current, phase: "reconciling" }));
        const result = await reconcile(state.operationId, true);
        if (!result || !["unchanged", "rejected"].includes(result.status)) return;
      }
      setState((current) => ({
        ...current,
        phase: "editing",
        healthEdits: [],
        refillEdits: [],
        upgradeEdits: [],
        runEdits: [],
        operationId: null,
        pendingOperationId: null,
        reason: null,
        resetVersion: current.resetVersion + 1,
      }));
      setInvalid(false);
      setInvalidUpgrades({});
      setInvalidRun({});
    } catch {
      if (mounted.current)
        setState((current) => ({ ...current, phase: "recovery", backupVerified: false }));
    } finally {
      inFlight.current = false;
    }
  }

  function refresh() {
    if (inFlight.current) return;
    setState((current) => ({ ...current, phase: "checking", backupVerified: false }));
  }

  return {
    ...state,
    healthEdits: state.healthEdits.map((edit) => ({
      ...edit,
      subject:
        (state.canonical?.players ?? players).find((player) => player.id === edit.entity)?.name ??
        edit.subject,
    })),
    invalid:
      invalid ||
      Object.values(invalidUpgrades).some(Boolean) ||
      Object.values(invalidRun).some(Boolean),
    setInvalid,
    reviewPath: state.production
      ? (state.canonical?.opened.session.path ?? session.path)
      : undefined,
    locked: LOCKED.includes(state.phase),
    edit,
    save,
    recover,
    revert,
    refresh,
    editUpgrade,
    revertUpgrade,
    revertHealth,
    stageRefills,
    revertRefill,
    refillSaveAvailable: state.refillEdits.length === 0 || validDraft(state, players, api),
    mixedSaveAvailable: !!api.writeMixed && validDraft(state, players, api),
    setUpgradeInvalid,
    editRun,
    revertRun,
    setRunInvalid,
    healthEnabled: domainEnabled(state, "health"),
    upgradesEnabled: domainEnabled(state, "upgrades"),
    runEnabled: domainEnabled(state, "run"),
    refillsEnabled: domainEnabled(state, "refillToFull"),
    healthBatchFits:
      state.healthEdits.length === 0 || healthIntentFits(healthIntent(state.healthEdits)),
    upgradeBatchFits:
      state.upgradeEdits.length === 0 ||
      upgradeIntentFits(
        state.upgradeEdits.map((edit) => ({
          playerId: edit.entity,
          key: edit.field,
          before: edit.before,
          value: edit.after,
        })),
      ),
  };
}
