import { useCallback, useEffect, useRef, useState } from "react";

import type { AdvancedItemDto, AdvancedSaveDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/translations";
import type { AdvancedRefillEdit } from "@/features/editor/pendingEdits";

interface State {
  advanced: AdvancedSaveDto | null;
  error: TranslationKey | null;
  loading: boolean;
}

const INITIAL_STATE: State = { advanced: null, error: null, loading: true };

function refillEdit(item: AdvancedItemDto): AdvancedRefillEdit | null {
  if (
    !item.canRefillToFull
    || item.chargeState !== "stored"
    || item.storedCharge === null
  ) return null;
  return {
    feature: "advanced",
    entity: item.saveKey,
    field: "refillToFull",
    after: true,
    before: item.storedCharge,
    label: "Stored charge",
    subject: item.name,
  };
}

export function useAdvanced(saveId: string) {
  const { t } = usePreferences();
  const [state, setState] = useState<State>(INITIAL_STATE);
  const [pendingByItem, setPendingByItem] = useState<Record<string, AdvancedRefillEdit>>({});
  const mounted = useRef(false);

  const load = useCallback(async () => {
    try {
      const result = await window.repoditor.advanced.get(saveId);
      if (mounted.current) {
        setState(
          result.ok
            ? { advanced: result.data, error: null, loading: false }
            : { advanced: null, error: operationErrorKey(result.error.code), loading: false },
        );
      }
    } catch {
      if (mounted.current) {
        setState({
          advanced: null,
          error: "error.service",
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

  function refillToFull(item: AdvancedItemDto): void {
    const edit = refillEdit(item);
    if (!edit) return;
    setPendingByItem((current) => ({
      ...current,
      [item.saveKey]: edit,
    }));
  }

  function refillAllToFull(): void {
    const canRefill = state.advanced?.domains.some(
      (domain) => domain.key === "currentCharge" && domain.capabilities.canRefillToFull,
    );
    const items = state.advanced?.items;
    if (!canRefill || !items) return;
    setPendingByItem((current) => {
      const next = { ...current };
      for (const item of items) {
        const edit = refillEdit(item);
        if (edit) next[item.saveKey] = edit;
      }
      return next;
    });
  }

  function revertRefill(saveKey: string): void {
    setPendingByItem((current) => {
      const next = { ...current };
      delete next[saveKey];
      return next;
    });
  }

  function revertAll(): void {
    setPendingByItem({});
  }

  return {
    ...state,
    error: state.error ? t(state.error) : null,
    pendingByItem,
    pendingEdits: Object.values(pendingByItem),
    refillAllToFull,
    refillToFull,
    revertRefill,
    revertAll,
    reload: load,
  };
}
