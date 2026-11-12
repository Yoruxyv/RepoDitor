/** Independent synthetic MetaSave drafts and durable, operation-bound reconciliation. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CosmeticsViewDto } from "@electron/contracts";
import {
  disabledMeta,
  metaIntentFits,
  tauriMetaApi,
  type MetaAction,
  type MetaIntent,
  type MetaState,
  type MetaResult,
} from "@/app/tauriMetaApi";
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
  const cosmetics = view.cosmetics.map((c) => {
    if (!c.mutationEligible || !c.known) return c;
    let owned = c.owned;
    if (
      action.action === "unlockAll" ||
      (action.action === "unlockIds" && action.ids.includes(c.id))
    )
      owned = true;
    if (action.action === "lockAll") owned = false;
    return { ...c, owned, state: owned ? ("owned" as const) : ("locked" as const) };
  });
  const knownOwnedCount = cosmetics.filter((c) => c.known && c.owned).length;
  return {
    ...view,
    cosmetics,
    knownOwnedCount,
    knownLockedCount: view.knownCatalogCount - knownOwnedCount,
    savedPresetCount: action.action === "clearPresets" ? 0 : view.savedPresetCount,
  };
}

function canonicalResult(result: MetaResult): boolean {
  const fingerprint = result.fingerprint;
  const view = result.view;
  if (!view || fingerprint === null) return false;
  return view.fingerprint === fingerprint;
}

export function useTauriCosmetics(active: boolean, recoveryGeneration: number, api = tauriMetaApi) {
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
    if (!visit || intent) return;
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
  }, [visit, intent, reload]);
  const locked = loading || saving || recovering || state.state !== "idle";
  const lockAllBlockedReason =
    state.view?.cosmetics.find(
      (c) => c.known && c.mutationEligible && c.owned && c.removalBlockedReason,
    )?.removalBlockedReason ?? null;
  function stage(action: MetaAction["action"], id?: number) {
    const presetsDenied = action === "clearPresets" && !state.view?.capabilities.canClearPresets;
    if (
      locked ||
      inFlight.current ||
      !state.session ||
      !state.admission ||
      !state.view ||
      presetsDenied
    )
      return;
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
      if (intent || (action === "lockAll" && lockAllBlockedReason)) return;
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
  async function reconcile() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const pending = await api.state(operation.current ?? undefined);
      if (!mounted.current) return;
      if (!pending.pending || !pending.recoverySession) {
        setState(pending);
        setError(CONFLICT);
        return;
      }
      operation.current = pending.pending.operationId;
      const result = await api.recover(pending.pending.operationId, pending.recoverySession);
      if (!mounted.current) return;
      if (!["applied", "unchanged"].includes(result.status) || !canonicalResult(result)) {
        setState(pending);
        setError(CONFLICT);
        return;
      }
      const fresh = await api.state();
      if (!mounted.current) return;
      if (fresh.state !== "idle" || !fresh.view) {
        setState(pending);
        setError(CONFLICT);
        return;
      }
      operation.current = null;
      setRecovering(false);
      setState(fresh);
      const retained = intent ?? pending.pending.intent;
      const next = result.status === "unchanged" ? retained : null;
      setIntent(
        next && fresh.admission
          ? { metaCosmetics: { ...next.metaCosmetics, admission: fresh.admission.digest } }
          : next,
      );
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
    let delivered = false;
    try {
      const result = await api.write({
        operationId: id,
        session: state.session,
        fingerprint: state.view.fingerprint,
        intent,
      });
      delivered = result.status === "applied" && canonicalResult(result);
      if (mounted.current) {
        if (result.status === "rejected") {
          operation.current = null;
          setRecovering(false);
          setError(REJECTED);
        } else {
          setState((current) => ({ ...current, state: "pending" }));
          setError(result.status === "applied" ? null : CONFLICT);
        }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
    // A positive write still requires canonical reconciliation and explicit acknowledgement.
    if (mounted.current && operation.current && delivered) await reconcile();
  }
  function revert() {
    if (locked || inFlight.current) return;
    revision.current += 1;
    setIntent(null);
    setError(null);
    setSaved(false);
  }
  const view = projected(state.view, intent);
  return {
    state,
    view,
    loading,
    saving,
    locked,
    error,
    saved,
    intent,
    stage,
    revert,
    save,
    reconcile,
    reload,
    lockAllBlockedReason,
    pendingEdits: cosmeticEdits(state.view, intent),
    recovery: recovering || state.state === "pending",
    enabled: state.state !== "disabled",
    readOnlyReady: visit !== null && visit === checkedVisit && state.state === "disabled",
  };
}
