import { useCallback, useEffect, useRef, useState } from "react";

import type { CosmeticsViewDto } from "@electron/contracts";
import {
  toCosmeticChange,
  type CosmeticLockAllEdit,
  type CosmeticPendingEdit,
  type CosmeticUnlockAllEdit,
} from "@/features/editor/pendingEdits";

interface State {
  view: CosmeticsViewDto | null;
  loadError: string | null;
  loading: boolean;
}

const INITIAL_STATE: State = { view: null, loadError: null, loading: true };

export function useCosmetics(saveId: string) {
  const [state, setState] = useState<State>(INITIAL_STATE);
  const [bulkPending, setBulkPending] = useState<
    CosmeticUnlockAllEdit | CosmeticLockAllEdit | null
  >(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false);
  const writeInFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const result = await window.repoditor.cosmetics.get(saveId);
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
  }, [saveId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

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

  function revertAll(): void {
    setBulkPending(null);
  }

  const pendingEdits: CosmeticPendingEdit[] = bulkPending ? [bulkPending] : [];
  let knownOwnedCount = state.view?.knownOwnedCount ?? 0;
  if (bulkPending?.field === "unlockAll") knownOwnedCount = state.view?.knownCatalogCount ?? 0;
  if (bulkPending?.field === "lockAll") knownOwnedCount = 0;

  async function save(): Promise<boolean> {
    if (!state.view || pendingEdits.length === 0 || writeInFlight.current) return false;
    writeInFlight.current = true;
    setSaving(true);
    setWriteError(null);
    setBackupPath(null);
    try {
      const result = await window.repoditor.cosmetics.write(
        saveId,
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
    unlockAllPending: bulkPending?.field === "unlockAll",
    lockAllPending: bulkPending?.field === "lockAll",
    lockAllBlockedReason,
    pendingEdits,
    writeError,
    backupPath,
    saving,
    unlockAll,
    lockAll,
    revertAll,
    save,
    reload: load,
  };
}
