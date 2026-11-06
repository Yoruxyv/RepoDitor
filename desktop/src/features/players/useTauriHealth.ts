/** Shared synthetic domain drafts; durable identity and reconciliation remain Python-owned. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerDto, PlayerUpgradeDto, SaveSession } from "@electron/contracts";
import {
  tauriHealthApi,
  type HealthCanonical,
  type HealthState,
  type HealthTransaction,
  upgradeIntentFits,
  runIntentFits,
} from "@/app/tauriHealthApi";
import type {
  PlayerHealthEdit,
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
interface State {
  enabled: boolean;
  phase: HealthPhase;
  pending: PlayerHealthEdit | null;
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
const INITIAL: State = {
  enabled: false,
  phase: "checking",
  pending: null,
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

function restorePending(current: State, operation: NonNullable<HealthState["pending"]>): State {
  const { intent, operationId } = operation;
  const hasDraft =
    current.pending !== null || current.upgradeEdits.length > 0 || current.runEdits.length > 0;
  let upgradeEdits = current.upgradeEdits;
  let runEdits = current.runEdits;
  let restoredPlayerId: string | null = null;
  if (!hasDraft && intent) {
    if ("upgrades" in intent) {
      upgradeEdits = intent.upgrades.map((edit) => ({
        feature: "upgrades",
        entity: edit.playerId,
        field: edit.key,
        before: edit.before,
        after: edit.value,
        label: edit.key,
        subject: edit.playerId,
      }));
      restoredPlayerId = intent.upgrades[0]?.playerId ?? null;
    } else if ("run" in intent) {
      runEdits = intent.run.map(
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
    } else restoredPlayerId = intent.playerId;
  }
  const pending =
    current.pending ??
    (intent && !("upgrades" in intent) && !("run" in intent) && !hasDraft
      ? {
          feature: "players" as const,
          entity: intent.playerId,
          field: "health" as const,
          before: intent.before,
          after: intent.health,
          label: "Health",
          subject: intent.playerId,
        }
      : null);
  return {
    ...current,
    enabled: true,
    phase: "recovery",
    backupVerified: false,
    pending,
    operationId,
    upgradeEdits,
    runEdits,
    pendingOperationId: hasDraft ? current.pendingOperationId : operationId,
    restoredPlayerId,
    resetVersion: current.resetVersion + 1,
  };
}

function validDraft(state: State, players: PlayerDto[]): boolean {
  if (
    Number(!!state.pending) +
      Number(state.upgradeEdits.length > 0) +
      Number(state.runEdits.length > 0) !==
    1
  )
    return false;
  if (state.runEdits.length > 0)
    return !!state.upgradeSession && runIntentFits(runIntent(state.runEdits));
  if (state.pending) {
    const player = (state.canonical?.players ?? players).find(
      (p) => p.id === state.pending?.entity,
    );
    return state.upgradeEdits.length === 0 && !!player && state.pending.after <= player.maxHealth;
  }
  return (
    !!state.upgradeSession &&
    upgradeIntentFits(
      state.upgradeEdits.map((edit) => ({
        playerId: edit.entity,
        key: edit.field,
        before: edit.before,
        value: edit.after,
      })),
    )
  );
}

function runIntent(edits: RunStatEdit[]) {
  return edits.map((edit) => ({ field: edit.field, before: edit.before, value: edit.after }));
}
function runValue(projection: HealthCanonical, edit: RunStatEdit): number | string | undefined {
  return edit.field === "resumeLocation"
    ? projection.run?.resumeLocation.value
    : projection.run?.stats.find((stat) => stat.key === edit.field)?.value;
}
function rebaseRun(edits: RunStatEdit[], projection: HealthCanonical): RunStatEdit[] | null {
  if (edits.some((edit) => runValue(projection, edit) === undefined)) return null;
  return edits.map((edit) => ({ ...edit, before: runValue(projection, edit)! }));
}

function upgradeValue(projection: HealthCanonical, edit: UpgradeValueEdit): number | undefined {
  return projection.upgrades
    ?.find((upgrade) => upgrade.key === edit.field)
    ?.values.find((value) => value.playerId === edit.entity)?.value;
}
function rebaseUpgrades(
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

export function useTauriHealth(
  session: SaveSession,
  players: PlayerDto[],
  onCanonical: (projection: HealthCanonical) => void,
  api: Pick<typeof tauriHealthApi, "state" | "write" | "recover"> &
    Partial<Pick<typeof tauriHealthApi, "writeUpgrades" | "writeRun">> = tauriHealthApi,
) {
  const [state, setState] = useState<State>(INITIAL);
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
      setState((current) => {
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
        const pending = current.pending;
        const upgradeEdits = rebaseUpgrades(current.upgradeEdits, result.canonical);
        const runEdits = rebaseRun(current.runEdits, result.canonical);
        if (!upgradeEdits || !runEdits)
          return { ...current, phase: "conflict", backupVerified: false };
        const player = pending
          ? result.canonical.players.find((p) => p.id === pending.entity)
          : null;
        if (pending && !player)
          return { ...current, enabled: true, phase: "conflict", canonical: result.canonical };
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
          pending:
            pending && player ? { ...pending, before: player.health, subject: player.name } : null,
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
      inFlight.current ||
      LOCKED.includes(state.phase) ||
      !Number.isSafeInteger(health) ||
      health < 0 ||
      health > player.maxHealth
    )
      return;
    if (state.pending && state.pending.entity !== player.id) return;
    if (
      state.phase === "unchanged" &&
      health === player.health &&
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
      pending:
        health === player.health
          ? null
          : {
              feature: "players",
              entity: player.id,
              field: "health",
              before: player.health,
              after: health,
              label: "Health",
              subject: player.name,
            },
    }));
  }

  function editUpgrade(upgrade: PlayerUpgradeDto, player: PlayerDto, value: number) {
    if (
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
      state.phase === "unchanged" &&
      state.operationId &&
      !state.pending &&
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
      state.phase === "unchanged" &&
      state.operationId &&
      !state.pending &&
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
  function revertUpgrades() {
    if (inFlight.current || LOCKED.includes(state.phase)) return;
    if (
      state.phase === "unchanged" &&
      state.operationId &&
      !state.pending &&
      state.runEdits.length === 0
    ) {
      void revert();
      return;
    }
    setState((current) => ({
      ...current,
      upgradeEdits: [],
      pendingOperationId: null,
      resetVersion: current.resetVersion + 1,
    }));
    setInvalidUpgrades({});
  }
  const setUpgradeInvalid = useCallback((playerId: string, key: string, value: boolean) => {
    setInvalidUpgrades((current) =>
      (current[`${playerId}:${key}`] ?? false) === value
        ? current
        : { ...current, [`${playerId}:${key}`]: value },
    );
  }, []);
  function revertHealth() {
    if (inFlight.current || LOCKED.includes(state.phase)) return;
    if (
      state.phase === "unchanged" &&
      state.operationId &&
      state.upgradeEdits.length === 0 &&
      state.runEdits.length === 0
    ) {
      void revert();
      return;
    }
    setState((current) => ({
      ...current,
      pending: null,
      pendingOperationId: null,
      resetVersion: current.resetVersion + 1,
    }));
    setInvalid(false);
  }

  function editRun(edit: RunStatEdit) {
    if (inFlight.current || LOCKED.includes(state.phase)) return;
    if (
      edit.before === edit.after &&
      state.phase === "unchanged" &&
      state.operationId &&
      !state.pending &&
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
      state.phase === "unchanged" &&
      state.operationId &&
      !state.pending &&
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

  async function reconcile(
    operationId: string,
    acknowledge: boolean,
    ownRequest = state.pendingOperationId === operationId,
  ): Promise<HealthTransaction | null> {
    const result = await api.recover(session.id, operationId, acknowledge);
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
    const player = state.pending
      ? result.canonical.players.find((p) => p.id === state.pending?.entity)
      : null;
    if (state.pending && !player) {
      setState((current) => ({ ...current, phase: "conflict", backupVerified: false }));
      return null;
    }
    const upgraded = rebaseUpgrades(state.upgradeEdits, result.canonical);
    const runEdits = rebaseRun(state.runEdits, result.canonical);
    const own = ownRequest;
    if (
      !upgraded ||
      !runEdits ||
      (result.status === "applied" &&
        own &&
        ((state.pending && player?.health !== state.pending.after) ||
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
      pending:
        current.pending &&
        player &&
        (result.status !== "applied" || current.pendingOperationId !== operationId)
          ? { ...current.pending, before: player.health, subject: player.name }
          : current.pending,
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
          (!current.pending &&
            current.upgradeEdits.length === 0 &&
            current.runEdits.length === 0) ||
          current.pendingOperationId === operationId;
        return {
          ...current,
          phase: own ? "saved" : "unchanged",
          pending: own ? null : current.pending,
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
      !validDraft(state, players)
    )
      return;
    const pending = state.pending;
    const upgrades = state.upgradeEdits.map((edit) => ({
      playerId: edit.entity,
      key: edit.field,
      before: edit.before,
      value: edit.after,
    }));
    const run = runIntent(state.runEdits);
    if (!pending && (run.length > 0 ? !api.writeRun : !api.writeUpgrades)) return;
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
      if (pending) {
        result = await api.write({
          saveId: session.id,
          fingerprint: base.current.fingerprint,
          playerId: pending.entity,
          health: pending.after,
          operationId,
        });
      } else if (run.length > 0) {
        result = await api.writeRun!({
          saveId: session.id,
          fingerprint: base.current.fingerprint,
          operationId,
          session: state.upgradeSession!,
          run,
        });
      } else {
        result = await api.writeUpgrades!({
          saveId: session.id,
          fingerprint: base.current.fingerprint,
          operationId,
          session: state.upgradeSession!,
          upgrades,
        });
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

  async function applyWriteResult(result: HealthTransaction, operationId: string) {
    if (result.operationId !== operationId) {
      setState((current) => ({ ...current, phase: "recovery", backupVerified: false }));
    } else if (result.status === "applied") {
      const verified = await reconcile(operationId, false, true);
      if (verified?.status === "applied") await finishApplied(operationId, true);
      else if (verified)
        setState((current) => ({ ...current, phase: "conflict", backupVerified: false }));
    } else if (result.status === "rejected") {
      const status = await api.state(session.id);
      if (!mounted.current) return;
      if (status.enabled && status.state === "idle") {
        setState((current) => ({ ...current, phase: "rejected", reason: result.reason }));
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
        pending: null,
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
    pending: state.pending
      ? {
          ...state.pending,
          subject:
            (state.canonical?.players ?? players).find(
              (player) => player.id === state.pending?.entity,
            )?.name ?? state.pending.subject,
        }
      : null,
    invalid:
      invalid ||
      Object.values(invalidUpgrades).some(Boolean) ||
      Object.values(invalidRun).some(Boolean),
    setInvalid,
    locked: LOCKED.includes(state.phase),
    edit,
    save,
    recover,
    revert,
    refresh,
    editUpgrade,
    revertUpgrade,
    revertUpgrades,
    revertHealth,
    setUpgradeInvalid,
    editRun,
    revertRun,
    setRunInvalid,
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
