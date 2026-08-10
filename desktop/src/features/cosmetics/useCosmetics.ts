import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CosmeticDto, CosmeticsViewDto } from "@electron/contracts";
import {
  toCosmeticChange,
  type CosmeticOwnershipEdit,
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
  const [pendingById, setPendingById] = useState<Record<string, CosmeticOwnershipEdit>>({});
  const [unlockAllPending, setUnlockAllPending] = useState<CosmeticUnlockAllEdit | null>(null);
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

  function setOwned(cosmetic: CosmeticDto, owned: boolean): void {
    if (!cosmetic.known || unlockAllPending !== null || cosmetic.owned === owned) {
      setPendingById((current) => {
        const next = { ...current };
        delete next[String(cosmetic.id)];
        return next;
      });
      return;
    }
    setPendingById((current) => ({
      ...current,
      [cosmetic.id]: {
        feature: "cosmetics",
        entity: String(cosmetic.id),
        field: "owned",
        after: owned,
        before: cosmetic.owned,
        label: "Ownership",
        subject: cosmetic.displayName,
      },
    }));
  }

  function unlockAll(): void {
    if (!state.view || state.view.knownLockedCount === 0) return;
    setPendingById({});
    setUnlockAllPending({
      feature: "cosmetics",
      entity: "known",
      field: "unlockAll",
      after: true,
      before: state.view.knownOwnedCount,
      label: "Known ownership",
      subject: "Cosmetics",
    });
  }

  function revert(cosmeticId: number): void {
    setPendingById((current) => {
      const next = { ...current };
      delete next[String(cosmeticId)];
      return next;
    });
  }

  function revertAll(): void {
    setPendingById({});
    setUnlockAllPending(null);
  }

  const pendingEdits: CosmeticPendingEdit[] = unlockAllPending
    ? [unlockAllPending]
    : Object.values(pendingById);

  const cosmetics = useMemo(
    () =>
      state.view?.cosmetics.map((cosmetic) => ({
        ...cosmetic,
        owned: unlockAllPending && cosmetic.known
          ? true
          : (pendingById[cosmetic.id]?.after ?? cosmetic.owned),
      })) ?? [],
    [pendingById, state.view, unlockAllPending],
  );
  const knownOwnedCount = cosmetics.filter((cosmetic) => cosmetic.known && cosmetic.owned).length;

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
    cosmetics,
    knownOwnedCount,
    knownLockedCount: state.view ? state.view.knownCatalogCount - knownOwnedCount : 0,
    pendingById,
    unlockAllPending,
    pendingEdits,
    writeError,
    backupPath,
    saving,
    setOwned,
    unlockAll,
    revert,
    revertAll,
    save,
    reload: load,
  };
}
