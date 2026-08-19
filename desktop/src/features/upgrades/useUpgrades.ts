import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DesktopOperationResult,
  PlayerDto,
  PlayerUpgradeDto,
  SaveCanonicalUpgradeValue,
} from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/translations";
import type { UpgradeValueEdit } from "@/features/pending-changes/pendingEdits";

interface UpgradesState {
  upgrades: PlayerUpgradeDto[];
  error: TranslationKey | null;
  loading: boolean;
}

const INITIAL_STATE: UpgradesState = { upgrades: [], error: null, loading: true };

function editKey(playerId: string, upgradeKey: string): string {
  return `${playerId}:${upgradeKey}`;
}

function applyCanonicalUpgradeValues(
  current: readonly PlayerUpgradeDto[],
  values: readonly SaveCanonicalUpgradeValue[],
): PlayerUpgradeDto[] | null {
  const bySignature = new Map(
    values.map((value) => [editKey(value.playerId, value.key), value.value]),
  );

  if (
    bySignature.size !== values.length ||
    values.some(
      (value) =>
        !current.some(
          (upgrade) =>
            upgrade.key === value.key &&
            upgrade.values.some((entry) => entry.playerId === value.playerId),
        ),
    )
  ) {
    return null;
  }

  return current.map((upgrade) => ({
    ...upgrade,
    values: upgrade.values.map((entry) => {
      const key = editKey(entry.playerId, upgrade.key);
      return bySignature.has(key) ? { ...entry, value: bySignature.get(key)! } : entry;
    }),
  }));
}

export function useUpgrades(
  saveId: string,
  initialResult: DesktopOperationResult<PlayerUpgradeDto[]> | null = null,
) {
  const { t } = usePreferences();
  const [state, setState] = useState<UpgradesState>(() => {
    if (initialResult === null) return INITIAL_STATE;
    return initialResult.ok
      ? { upgrades: initialResult.data, error: null, loading: false }
      : { upgrades: [], error: operationErrorKey(initialResult.error.code), loading: false };
  });
  const [pendingByUpgrade, setPendingByUpgrade] = useState<Record<string, UpgradeValueEdit>>({});
  const mounted = useRef(false);
  const initialResultRef = useRef(initialResult);

  const load = useCallback(
    async (preserveExisting = false): Promise<boolean> => {
      try {
        const resolved = await window.repoditor.upgrades.list(saveId);
        if (!mounted.current) return resolved.ok;
        if (resolved.ok) {
          setState({ upgrades: resolved.data, error: null, loading: false });
          return true;
        }
        setState((current) => ({
          upgrades: preserveExisting ? current.upgrades : [],
          error: operationErrorKey(resolved.error.code),
          loading: false,
        }));
        return false;
      } catch {
        if (mounted.current) {
          setState((current) => ({
            upgrades: preserveExisting ? current.upgrades : [],
            error: "error.service",
            loading: false,
          }));
        }
        return false;
      }
    },
    [saveId],
  );

  useEffect(() => {
    mounted.current = true;
    if (initialResultRef.current === null) void load(false);
    return () => {
      mounted.current = false;
    };
  }, [load]);

  function update(upgrade: PlayerUpgradeDto, player: PlayerDto, value: number): void {
    const before = upgrade.values.find((item) => item.playerId === player.id)?.value ?? 0;
    const key = editKey(player.id, upgrade.key);
    setPendingByUpgrade((current) => {
      if (value === before) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return {
        ...current,
        [key]: {
          feature: "upgrades",
          entity: player.id,
          field: upgrade.key,
          before,
          after: value,
          label: upgrade.label,
          subject: player.name,
        },
      };
    });
  }

  function revert(playerId: string, upgradeKey: string): void {
    setPendingByUpgrade((current) => {
      const next = { ...current };
      delete next[editKey(playerId, upgradeKey)];
      return next;
    });
  }

  function applyAfterSave(values: readonly SaveCanonicalUpgradeValue[]): boolean {
    const nextUpgrades = applyCanonicalUpgradeValues(state.upgrades, values);
    if (nextUpgrades === null) return false;

    setState({ upgrades: nextUpgrades, error: null, loading: false });
    return true;
  }

  function revertAll(): void {
    setPendingByUpgrade({});
  }

  return {
    ...state,
    error: state.error ? t(state.error) : null,
    pendingByUpgrade,
    pendingEdits: Object.values(pendingByUpgrade),
    update,
    revert,
    revertAll,
    applyAfterSave,
    reload: () => load(false),
    refreshAfterSave: () => load(true),
  };
}
