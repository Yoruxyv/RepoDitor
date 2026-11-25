/** Independent MetaSave drafts and durable, operation-bound reconciliation. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CosmeticsViewDto } from "@/app/tauri/desktopContracts";
import {
  disabledMeta,
  metaIntentFits,
  tauriMetaApi,
  type MetaAction,
  type MetaIntent,
  type MetaState,
  type MetaResult,
} from "@/app/tauri/tauriMetaApi";
import type { CosmeticPendingEdit } from "@/features/pending-changes/pendingEdits";

const KNOWN_OWNERSHIP_LABEL = "Known ownership";
const REJECTED = "health.rejected";
const CONFLICT = "health.conflict";

export function cosmeticEdits(
  view: CosmeticsViewDto | null,
  intent: MetaIntent | null,
): CosmeticPendingEdit[] {
  if (!view || !intent) return [];
  const value = intent.metaCosmetics;
  if (value.action === "unlockIds") {
    return value.ids.map<CosmeticPendingEdit>((id) => ({
      feature: "cosmetics",
      entity: String(id),
      field: "owned",
      after: true,
      before: false,
      label: "Ownership",
      subject: view.cosmetics.find((c) => c.id === id)?.displayName ?? `Cosmetic #${id}`,
    }));
  }
  if (value.action === "clearPresets")
    return [
      {
        feature: "cosmetics",
        entity: "presets",
        field: "clearAll",
        after: true,
        before: view.savedPresetCount,
        label: "Saved presets",
        subject: "Cosmetics",
      },
    ];
  if (value.action === "unlockAll")
    return [
      {
        feature: "cosmetics",
        entity: "known",
        field: "unlockAll",
        after: true,
        before: view.knownOwnedCount,
        label: KNOWN_OWNERSHIP_LABEL,
        subject: "Cosmetics",
      },
    ];
  return [
    {
      feature: "cosmetics",
      entity: "known",
      field: "lockAll",
      after: false,
      before: view.knownOwnedCount,
      label: KNOWN_OWNERSHIP_LABEL,
      subject: "Cosmetics",
    },
  ];
}

function projected(
  view: CosmeticsViewDto | null,
  intent: MetaIntent | null,
): CosmeticsViewDto | null {
  if (!view || !intent) return view;
  const action = intent.metaCosmetics;
  if (action.action === "clearPresets") return { ...view, savedPresetCount: 0 };
  const selected = action.action === "unlockIds" ? new Set(action.ids) : null;
  let knownOwnedCount = view.knownOwnedCount;
  const cosmetics = view.cosmetics.map((c) => {
    if (!c.mutationEligible || !c.known || (selected && !selected.has(c.id))) return c;
    const owned = action.action !== "lockAll";
    if (owned === c.owned) return c;
    knownOwnedCount += owned ? 1 : -1;
    return { ...c, owned, state: owned ? ("owned" as const) : ("locked" as const) };
  });
  return {
    ...view,
    cosmetics,
    knownOwnedCount,
    knownLockedCount: view.knownCatalogCount - knownOwnedCount,
  };
}

function appliedResult(result: MetaResult, operationId: string): boolean {
  const fingerprint = result.fingerprint;
  const view = result.view;
  if (!view || fingerprint === null) return false;
  return (
    result.operationId === operationId &&
    result.status === "applied" &&
    view.fingerprint === fingerprint
  );
}

function settledState(result: MetaResult, operationId: string): MetaState | undefined {
  const fresh = result.fresh;
  if (
    (result.status === "applied" || result.status === "unchanged") &&
    result.operationId === operationId &&
    fresh?.state === "idle" &&
    !fresh.pending &&
    !fresh.recoverySession &&
    fresh.view?.fingerprint &&
    fresh.view.fingerprint === result.fingerprint
  ) {
    return fresh;
  }
  return undefined;
}

function retargetIntent(intent: MetaIntent | null, admission: MetaState["admission"]) {
  return intent && admission
    ? { metaCosmetics: { ...intent.metaCosmetics, admission: admission.digest } }
    : intent;
}

function ownershipCount(view: CosmeticsViewDto, owned: boolean) {
  return view.cosmetics.filter(
    (item) => item.known && item.mutationEligible && item.owned === owned,
  ).length;
}

function canStageBulkAction(
  view: CosmeticsViewDto,
  action: Exclude<MetaAction["action"], "unlockIds">,
  lockBlocked: boolean,
) {
  switch (action) {
    case "unlockAll":
      return view.capabilities.canUnlockAll && ownershipCount(view, false) > 0;
    case "lockAll":
      return view.capabilities.canRemoveOwnership && !lockBlocked && ownershipCount(view, true) > 0;
    case "clearPresets":
      return view.capabilities.canClearPresets && view.savedPresetCount > 0;
  }
}

export function useTauriCosmetics(
  active: boolean,
  recoveryGeneration: number,
  api: Omit<typeof tauriMetaApi, "close"> &
    Partial<Pick<typeof tauriMetaApi, "close">> = tauriMetaApi,
) {
  const visit = useMemo(
    () => (active ? { recoveryGeneration } : null),
    [active, recoveryGeneration],
  );
  const [checkedVisit, setCheckedVisit] = useState<typeof visit>(null);
  const [state, setState] = useState<MetaState>(disabledMeta);
  const [loading, setLoading] = useState(true);
  const [intent, setIntent] = useState<MetaIntent | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"health.conflict" | "health.rejected" | null>(null);
  const [saved, setSaved] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const operation = useRef<string | null>(null);
  const inFlight = useRef(false);
  const inspection = useRef<Promise<void> | null>(null);
  const mounted = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current += 1;
    };
  }, []);
  const reload = useCallback(() => {
    if (inFlight.current) return inspection.current ?? Promise.resolve();
    inFlight.current = true;
    setLoading(true);
    const current = ++revision.current;
    async function inspect() {
      const result = await api.state(operation.current ?? undefined);
      if (mounted.current && revision.current === current) {
        setState(result);
        if (result.pending) {
          operation.current = result.pending.operationId;
          setRecovering(true);
          const restored = result.pending.intent;
          setIntent((current) => current ?? restored);
        }
      }
    }
    const pending = inspect().finally(() => {
      inspection.current = null;
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    });
    inspection.current = pending;
    return pending;
  }, [api]);
  useEffect(() => {
    if (!visit || visit === checkedVisit || (intent && !state.production)) return;
    let cancelled = false;
    async function checkVisit() {
      // An earlier visit may still be inspecting MetaSave, but cannot authorize this visit.
      await inspection.current;
      if (cancelled || (inFlight.current && !inspection.current)) return;
      await reload();
      if (!cancelled) setCheckedVisit(visit);
    }
    void checkVisit();
    return () => {
      cancelled = true;
    };
  }, [visit, checkedVisit, intent, reload, state.production]);
  useEffect(() => {
    if (!active) return;
    return () => {
      void api.close?.();
    };
  }, [active, api]);
  const locked =
    !active ||
    loading ||
    saving ||
    recovering ||
    state.state !== "idle" ||
    (state.production === true && visit !== checkedVisit);
  const lockAllBlockedReason =
    state.view?.cosmetics.find(
      (c) => c.known && c.mutationEligible && c.owned && c.removalBlockedReason,
    )?.removalBlockedReason ?? null;
  function stage(action: MetaAction["action"], id?: number) {
    if (locked || inFlight.current || !state.session || !state.admission || !state.view) return;
    let next: MetaAction;
    if (action === "unlockIds") {
      const item = state.view.cosmetics.find((c) => c.id === id);
      if (
        !item ||
        !item.known ||
        !item.mutationEligible ||
        item.owned ||
        (intent && intent.metaCosmetics.action !== "unlockIds")
      )
        return;
      const ids = intent?.metaCosmetics.action === "unlockIds" ? intent.metaCosmetics.ids : [];
      if (ids.includes(item.id)) return;
      next = { action, admission: state.admission.digest, ids: [...ids, item.id] };
    } else {
      if (intent || !canStageBulkAction(state.view, action, lockAllBlockedReason !== null)) return;
      next = { action, admission: state.admission.digest };
    }
    const value = { metaCosmetics: next };
    if (!metaIntentFits(value)) {
      setError(REJECTED);
      return;
    }
    revision.current += 1;
    setIntent(value);
    setSaved(false);
    setError(null);
  }
  async function reconcile(recoverySession?: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      let inspected: MetaState | undefined;
      if (!recoverySession || !operation.current) {
        inspected = await api.state(operation.current ?? undefined);
        if (!mounted.current) return;
        if (!inspected.pending || !inspected.recoverySession) {
          if (!operation.current) setState(inspected);
          setError(CONFLICT);
          return;
        }
        operation.current = inspected.pending.operationId;
        recoverySession = inspected.recoverySession;
      }
      const id = operation.current;
      const production = inspected?.production ?? state.production;
      const result = production
        ? await api.recover(id, recoverySession, true)
        : await api.recover(id, recoverySession);
      if (!mounted.current) return;
      const fresh = settledState(result, id);
      if (!fresh) {
        setState((previous) => inspected ?? previous);
        setError(CONFLICT);
        return;
      }
      operation.current = null;
      setRecovering(false);
      setState(production ? { ...fresh, production: true } : fresh);
      const retained = intent ?? inspected?.pending?.intent ?? null;
      const next = result.status === "unchanged" ? retained : null;
      setIntent(retargetIntent(next, fresh.admission));
      setSaved(result.status === "applied");
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  async function save() {
    if (locked || !intent || !state.session || !state.view || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    const id = crypto.randomUUID().replaceAll("-", "");
    operation.current = id;
    setRecovering(true);
    let delivered: MetaResult | undefined;
    let rejected = false;
    try {
      const request = {
        operationId: id,
        session: state.session,
        fingerprint: state.view.fingerprint,
        intent,
      };
      const result = state.production ? await api.write(request, true) : await api.write(request);
      if (appliedResult(result, id)) {
        delivered = result;
      }
      if (!mounted.current) return;
      if (result.status === "rejected") {
        rejected = true;
        operation.current = null;
        setRecovering(false);
        setError(REJECTED);
      } else {
        setState((current) => ({ ...current, state: "pending" }));
        setError(result.status === "applied" ? null : CONFLICT);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
    // A positive write still requires canonical reconciliation and explicit acknowledgement.
    if (!mounted.current) return;
    if (operation.current && delivered) await reconcile(delivered.recoverySession);
    if (rejected && state.production) await reload();
  }
  function revert() {
    if (locked || inFlight.current) return;
    revision.current += 1;
    setIntent(null);
    setError(null);
    setSaved(false);
  }
  const view = useMemo(() => projected(state.view, intent), [state.view, intent]);
  const action = intent?.metaCosmetics;
  let affectedOwnershipCount = 0;
  if (action?.action === "unlockIds") {
    affectedOwnershipCount = action.ids.length;
  } else if (state.view && (action?.action === "unlockAll" || action?.action === "lockAll")) {
    affectedOwnershipCount = ownershipCount(state.view, action.action === "lockAll");
  }
  return {
    state,
    view,
    loading,
    saving,
    locked,
    error,
    saved,
    intent,
    affectedOwnershipCount,
    stage,
    revert,
    save,
    reconcile,
    reload,
    lockAllBlockedReason,
    pendingEdits: cosmeticEdits(state.view, intent),
    recovery: recovering || state.state === "pending",
    enabled: state.state !== "disabled",
    authorizationPending: visit !== null && visit !== checkedVisit,
    readOnlyReady: visit !== null && visit === checkedVisit && state.state === "disabled",
  };
}
