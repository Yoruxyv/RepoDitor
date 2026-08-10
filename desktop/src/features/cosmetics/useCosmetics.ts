import { useCallback, useEffect, useRef, useState } from "react";

import type { CosmeticsViewDto } from "@electron/contracts";
import {
  toCosmeticChange,
  type CosmeticClearAllPresetsEdit,
  type CosmeticLockAllEdit,
  type CosmeticPendingEdit,
  type CosmeticUnlockAllEdit,
} from "@/features/editor/pendingEdits";

interface State {
  view: CosmeticsViewDto | null;
  loadError: string | null;
  loading: boolean;
}

const INITIAL_STATE: State = { view: null, loadError: null, loading: false };

export function useCosmetics(active: boolean, recoveryGeneration: number) {
  const [state, setState] = useState<State>(INITIAL_STATE);
  const [bulkPending, setBulkPending] = useState<
    CosmeticUnlockAllEdit | CosmeticLockAllEdit | CosmeticClearAllPresetsEdit | null
  >(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false);
  const wasActive = useRef(false);
  const seenRecoveryGeneration = useRef(recoveryGeneration);
  const writeInFlight = useRef(false);

  const load = useCallback(async () => {
    if (mounted.current) {
      setState((current) => ({ ...current, loadError: null, loading: current.view === null }));
    }
    try {
      const result = await window.repoditor.cosmetics.get();
      if (mounted.current) {
        setState(
          result.ok
            ? { view: result.data, loadError: null, loading: false }
            : { view: null, loadError: result.error.message, loading: false },
        );
      }
    } catch {
      if (mounted.current) {
        setState({
          view: null,
          loadError: "The desktop cosmetics bridge is unavailable.",
          loading: false,
        });
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const hasPending = bulkPending !== null;

  useEffect(() => {
    const entered = active && !wasActive.current;
    wasActive.current = active;
    if (entered && !hasPending) void load();
  }, [active, hasPending, load]);

  useEffect(() => {
    const recovered = recoveryGeneration !== seenRecoveryGeneration.current;
    seenRecoveryGeneration.current = recoveryGeneration;
    if (recovered && active && !hasPending) void load();
  }, [active, hasPending, load, recoveryGeneration]);

  function unlockAll(): void {
    if (!state.view || state.view.knownLockedCount === 0) return;
    setBulkPending({
      feature: "cosmetics",
      entity: "known",
      field: "unlockAll",
      after: true,
      before: state.view.knownOwnedCount,
      label: "Known ownership",
      subject: "Cosmetics",
    });
  }

  const lockAllBlockedReason = state.view?.cosmetics.find(
    (cosmetic) => cosmetic.known && cosmetic.owned && cosmetic.removalBlockedReason,
  )?.removalBlockedReason ?? null;

  function lockAll(): void {
    if (!state.view || state.view.knownOwnedCount === 0 || lockAllBlockedReason) return;
    setBulkPending({
      feature: "cosmetics",
      entity: "known",
      field: "lockAll",
      after: false,
      before: state.view.knownOwnedCount,
      label: "Known ownership",
      subject: "Cosmetics",
    });
  }

  function clearAllPresets(): void {
    if (!state.view || state.view.savedPresetCount === 0) return;
    setBulkPending({
      feature: "cosmetics",
      entity: "presets",
      field: "clearAll",
      after: true,
      before: state.view.savedPresetCount,
      label: "Saved presets",
      subject: "Cosmetics",
    });
  }

  function revertAll(): void {
    setBulkPending(null);
  }

  const pendingEdits: CosmeticPendingEdit[] = bulkPending ? [bulkPending] : [];
  let knownOwnedCount = state.view?.knownOwnedCount ?? 0;
  if (bulkPending?.field === "unlockAll") knownOwnedCount = state.view?.knownCatalogCount ?? 0;
  if (bulkPending?.field === "lockAll") knownOwnedCount = 0;
  const savedPresetCount = bulkPending?.field === "clearAll" ? 0 : state.view?.savedPresetCount ?? 0;

  async function save(): Promise<boolean> {
    if (!state.view || pendingEdits.length === 0 || writeInFlight.current) return false;
    writeInFlight.current = true;
    setSaving(true);
    setWriteError(null);
    setBackupPath(null);
    try {
      const result = await window.repoditor.cosmetics.write(
        state.view.fingerprint,
        pendingEdits.map(toCosmeticChange),
      );
      if (!result.ok) {
        setWriteError(result.error.message);
        return false;
      }
      setState({ view: result.data.cosmetics, loadError: null, loading: false });
      setBackupPath(result.data.backupPath);
      revertAll();
      return true;
    } catch {
      setWriteError("The desktop cosmetics bridge is unavailable. Nothing was written.");
      return false;
    } finally {
      writeInFlight.current = false;
      setSaving(false);
    }
  }

  return {
    ...state,
    knownOwnedCount,
    knownLockedCount: state.view ? state.view.knownCatalogCount - knownOwnedCount : 0,
    savedPresetCount,
    unlockAllPending: bulkPending?.field === "unlockAll",
    lockAllPending: bulkPending?.field === "lockAll",
    clearAllPresetsPending: bulkPending?.field === "clearAll",
    lockAllBlockedReason,
    pendingEdits,
    writeError,
    backupPath,
    saving,
    unlockAll,
    lockAll,
    clearAllPresets,
    revertAll,
    save,
    reload: load,
  };
}
