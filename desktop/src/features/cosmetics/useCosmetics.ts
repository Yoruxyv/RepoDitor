/**
 * Owns the independent MetaSave session, typed pending changes, and explicit writes.
 *
 * Python returns capabilities and canonical post-write state. The hook never infers
 * mutation authority from installed names, icons, or other presentation metadata.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { CosmeticsViewDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/translations";
import {
  toCosmeticChange,
  type CosmeticClearAllPresetsEdit,
  type CosmeticLockAllEdit,
  type CosmeticOwnershipEdit,
  type CosmeticPendingEdit,
  type CosmeticUnlockAllEdit,
} from "@/features/pending-changes/pendingEdits";

interface State {
  view: CosmeticsViewDto | null;
  loadError: TranslationKey | null;
  loading: boolean;
}

type CosmeticBulkEdit = CosmeticUnlockAllEdit | CosmeticLockAllEdit | CosmeticClearAllPresetsEdit;

const INITIAL_STATE: State = { view: null, loadError: null, loading: false };

function isBulkEdit(edit: CosmeticPendingEdit): edit is CosmeticBulkEdit {
  return edit.field !== "owned";
}

function projectedOwnershipState(known: boolean, owned: boolean): "owned" | "locked" | "unknown" {
  if (!known) return "unknown";
  return owned ? "owned" : "locked";
}

function projectIndividualOwnership(
  view: CosmeticsViewDto | null,
  pendingEdits: readonly CosmeticPendingEdit[],
  knownOwnedCount: number,
  knownLockedCount: number,
): CosmeticsViewDto | null {
  if (!view) return null;

  const ownershipById = new Map<string, boolean>();
  for (const edit of pendingEdits) {
    if (edit.field === "owned") ownershipById.set(edit.entity, edit.after);
  }
  if (ownershipById.size === 0) return view;

  return {
    ...view,
    knownOwnedCount,
    knownLockedCount,
    cosmetics: view.cosmetics.map((cosmetic) => {
      const owned = ownershipById.get(String(cosmetic.id));
      if (owned === undefined) return cosmetic;
      return {
        ...cosmetic,
        owned,
        state: projectedOwnershipState(cosmetic.known, owned),
      };
    }),
  };
}

/**
 * Own the independent MetaSave projection, pending cosmetic edits, and safe write.
 *
 * @param active - Whether Cosmetics is the visible top-level workspace.
 * @param recoveryGeneration - Increments after game-safety recovery to trigger a clean reload.
 * @returns The projected Cosmetics view, pending edits, safe-write state, and actions.
 */
export function useCosmetics(active: boolean, recoveryGeneration: number) {
  const { t } = usePreferences();
  const [state, setState] = useState<State>(INITIAL_STATE);
  const [pendingEdits, setPendingEdits] = useState<CosmeticPendingEdit[]>([]);
  const [writeError, setWriteError] = useState<TranslationKey | null>(null);
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
            : { view: null, loadError: operationErrorKey(result.error.code), loading: false },
        );
      }
    } catch {
      if (mounted.current) {
        setState({
          view: null,
          loadError: "error.service",
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

  const hasPending = pendingEdits.length > 0;
  const firstPending = pendingEdits[0] ?? null;
  const bulkPending = firstPending !== null && isBulkEdit(firstPending) ? firstPending : null;
  const hasBulkPending = bulkPending !== null;

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
    if (!state.view || state.view.knownLockedCount === 0 || hasPending) return;
    setPendingEdits([
      {
        feature: "cosmetics",
        entity: "known",
        field: "unlockAll",
        after: true,
        before: state.view.knownOwnedCount,
        label: "Known ownership",
        subject: "Cosmetics",
      },
    ]);
  }

  const lockAllBlockedReason =
    state.view?.cosmetics.find(
      (cosmetic) => cosmetic.known && cosmetic.owned && cosmetic.removalBlockedReason,
    )?.removalBlockedReason ?? null;

  function lockAll(): void {
    if (!state.view || state.view.knownOwnedCount === 0 || lockAllBlockedReason || hasPending)
      return;
    setPendingEdits([
      {
        feature: "cosmetics",
        entity: "known",
        field: "lockAll",
        after: false,
        before: state.view.knownOwnedCount,
        label: "Known ownership",
        subject: "Cosmetics",
      },
    ]);
  }

  function clearAllPresets(): void {
    if (!state.view || state.view.savedPresetCount === 0 || hasPending) return;
    setPendingEdits([
      {
        feature: "cosmetics",
        entity: "presets",
        field: "clearAll",
        after: true,
        before: state.view.savedPresetCount,
        label: "Saved presets",
        subject: "Cosmetics",
      },
    ]);
  }

  function unlockCosmetic(cosmeticId: number): void {
    if (
      writeInFlight.current ||
      !state.view ||
      hasBulkPending ||
      !state.view.capabilities.canUnlockCosmetic
    ) {
      return;
    }
    const cosmetic = state.view.cosmetics.find((entry) => entry.id === cosmeticId);
    if (
      !cosmetic ||
      !cosmetic.known ||
      cosmetic.owned ||
      cosmetic.state !== "locked" ||
      !cosmetic.mutationEligible
    ) {
      return;
    }

    const entity = String(cosmetic.id);
    const edit: CosmeticOwnershipEdit = {
      feature: "cosmetics",
      entity,
      field: "owned",
      after: true,
      before: false,
      label: "Ownership",
      subject: cosmetic.displayName,
    };
    setPendingEdits((current) => {
      if (
        current.some(isBulkEdit) ||
        current.some((pending) => pending.field === "owned" && pending.entity === entity)
      ) {
        return current;
      }
      return [...current, edit];
    });
  }

  function revertAll(): void {
    setPendingEdits([]);
  }

  let knownOwnedCount = state.view?.knownOwnedCount ?? 0;
  if (bulkPending?.field === "unlockAll") knownOwnedCount = state.view?.knownCatalogCount ?? 0;
  if (bulkPending?.field === "lockAll") knownOwnedCount = 0;
  for (const edit of pendingEdits) {
    if (edit.field === "owned" && edit.before !== edit.after) {
      knownOwnedCount += edit.after ? 1 : -1;
    }
  }
  const knownLockedCount = state.view ? state.view.knownCatalogCount - knownOwnedCount : 0;
  const savedPresetCount =
    bulkPending?.field === "clearAll" ? 0 : (state.view?.savedPresetCount ?? 0);
  const projectedView = projectIndividualOwnership(
    state.view,
    pendingEdits,
    knownOwnedCount,
    knownLockedCount,
  );

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
        setWriteError(operationErrorKey(result.error.code));
        return false;
      }
      setState({ view: result.data.cosmetics, loadError: null, loading: false });
      setBackupPath(result.data.backupPath);
      revertAll();
      return true;
    } catch {
      setWriteError("error.write");
      return false;
    } finally {
      writeInFlight.current = false;
      setSaving(false);
    }
  }

  return {
    ...state,
    view: projectedView,
    loadError: state.loadError ? t(state.loadError) : null,
    knownOwnedCount,
    knownLockedCount,
    savedPresetCount,
    hasPendingEdits: hasPending,
    hasBulkPending,
    unlockAllPending: bulkPending?.field === "unlockAll",
    lockAllPending: bulkPending?.field === "lockAll",
    clearAllPresetsPending: bulkPending?.field === "clearAll",
    lockAllBlockedReason,
    pendingEdits,
    writeError: writeError ? t(writeError) : null,
    backupPath,
    saving,
    unlockAll,
    unlockCosmetic,
    lockAll,
    clearAllPresets,
    revertAll,
    save,
    reload: load,
  };
}
