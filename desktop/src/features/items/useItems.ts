/** Owns renderer loading state for the evidence-backed advanced item projection. */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AdvancedItemDto,
  AdvancedSaveDto,
  DesktopOperationResult,
  RepoDitorApi,
  SaveCanonicalAdvanced,
} from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/i18n";
import type { AdvancedRefillEdit } from "@/features/pending-changes/pendingEdits";

interface State {
  advanced: AdvancedSaveDto | null;
  error: TranslationKey | null;
  loading: boolean;
}

const INITIAL_STATE: State = { advanced: null, error: null, loading: true };

const getDesktopItems: RepoDitorApi["advanced"]["get"] = (saveId) =>
  window.repoditor.advanced.get(saveId);

function initialState(result: DesktopOperationResult<AdvancedSaveDto> | null): State {
  if (result === null) return INITIAL_STATE;
  return result.ok
    ? { advanced: result.data, error: null, loading: false }
    : { advanced: null, error: operationErrorKey(result.error.code), loading: false };
}

export function refillEdit(item: AdvancedItemDto): AdvancedRefillEdit | null {
  if (
    !item.canRefillToFull ||
    item.rechargeCapability !== "rechargeable" ||
    item.chargeState !== "stored" ||
    item.storedCharge === null ||
    !Number.isSafeInteger(item.storedCharge)
  )
    return null;
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

export function useItems(
  saveId: string,
  initialResult: DesktopOperationResult<AdvancedSaveDto> | null = null,
  get: RepoDitorApi["advanced"]["get"] = getDesktopItems,
  loadInitially = true,
) {
  const { t } = usePreferences();
  const [state, setState] = useState<State>(() => initialState(initialResult));
  const needsInitialLoad = useRef(initialResult === null);
  const [pendingByItem, setPendingByItem] = useState<Record<string, AdvancedRefillEdit>>({});
  const mounted = useRef(false);
  const requestInFlight = useRef(false);
  const snapshotVersion = useRef(0);

  const load = useCallback(
    async (preserveExisting = false): Promise<boolean> => {
      if (requestInFlight.current) return false;
      needsInitialLoad.current = false;
      requestInFlight.current = true;
      const version = snapshotVersion.current;
      try {
        const result = await get(saveId);
        if (!mounted.current || version !== snapshotVersion.current) return result.ok;
        if (result.ok) {
          setState({ advanced: result.data, error: null, loading: false });
          return true;
        }
        setState((current) => ({
          advanced: preserveExisting ? current.advanced : null,
          error: operationErrorKey(result.error.code),
          loading: false,
        }));
        return false;
      } catch {
        if (mounted.current && version === snapshotVersion.current) {
          setState((current) => ({
            advanced: preserveExisting ? current.advanced : null,
            error: "error.service",
            loading: false,
          }));
        }
        return false;
      } finally {
        requestInFlight.current = false;
      }
    },
    [get, saveId],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!loadInitially || !needsInitialLoad.current) return;
    const request = window.setTimeout(() => {
      if (needsInitialLoad.current) void load(false);
    });
    return () => window.clearTimeout(request);
  }, [load, loadInitially]);

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

  function applyAfterSave(value: SaveCanonicalAdvanced): boolean {
    const current = state.advanced;
    if (current === null) return false;
    const bySaveKey = new Map(value.items.map((item) => [item.saveKey, item]));
    const currentCharge = current.domains.find((domain) => domain.key === "currentCharge");
    if (
      currentCharge === undefined ||
      value.items.some((item) => !current.items.some((entry) => entry.saveKey === item.saveKey))
    ) {
      return false;
    }
    const nextAdvanced = {
      ...current,
      domains: current.domains.map((domain) =>
        domain.key === "currentCharge"
          ? { ...domain, entryCount: value.currentChargeEntryCount }
          : domain,
      ),
      items: current.items.map((item) => {
        const canonical = bySaveKey.get(item.saveKey);
        return canonical === undefined
          ? item
          : {
              ...item,
              storedCharge: canonical.storedCharge,
              chargeState: canonical.chargeState,
              rechargeCapability: canonical.rechargeCapability,
              canRefillToFull: canonical.canRefillToFull,
            };
      }),
    };
    setState({ advanced: nextAdvanced, error: null, loading: false });
    return true;
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
    applyAfterSave,
    acceptSnapshot: (advanced: AdvancedSaveDto) => {
      needsInitialLoad.current = false;
      snapshotVersion.current += 1;
      setState({ advanced, error: null, loading: false });
    },
    reload: () => load(false),
    refreshAfterSave: () => load(true),
  };
}
