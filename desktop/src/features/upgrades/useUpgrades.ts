import { useCallback, useEffect, useRef, useState } from "react";

import type { PlayerDto, PlayerUpgradeDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/translations";
import type { UpgradeValueEdit } from "@/features/editor/pendingEdits";

interface UpgradesState {
  upgrades: PlayerUpgradeDto[];
  error: TranslationKey | null;
  loading: boolean;
}

const INITIAL_STATE: UpgradesState = { upgrades: [], error: null, loading: true };

function editKey(playerId: string, upgradeKey: string): string {
  return `${playerId}:${upgradeKey}`;
}

export function useUpgrades(saveId: string) {
  const { t } = usePreferences();
  const [state, setState] = useState<UpgradesState>(INITIAL_STATE);
  const [pendingByUpgrade, setPendingByUpgrade] = useState<Record<string, UpgradeValueEdit>>({});
  const mounted = useRef(false);

  const load = useCallback(async () => {
    try {
      const result = await window.repoditor.upgrades.list(saveId);
      if (mounted.current) {
        setState(
          result.ok
            ? { upgrades: result.data, error: null, loading: false }
            : { upgrades: [], error: operationErrorKey(result.error.code), loading: false },
        );
      }
    } catch {
      if (mounted.current) {
        setState({
          upgrades: [],
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
    reload: load,
  };
}
