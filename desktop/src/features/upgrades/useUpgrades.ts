import { useCallback, useEffect, useRef, useState } from "react";

import type { PlayerUpgradeDto } from "@electron/contracts";
import type { UpgradeValueEdit } from "@/features/editor/pendingEdits";

interface UpgradesState {
  upgrades: PlayerUpgradeDto[];
  error: string | null;
  loading: boolean;
}

const INITIAL_STATE: UpgradesState = { upgrades: [], error: null, loading: true };

function editKey(playerId: string, upgradeKey: string): string {
  return `${playerId}:${upgradeKey}`;
}

export function useUpgrades(saveId: string) {
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
            : { upgrades: [], error: result.error.message, loading: false },
        );
      }
    } catch {
      if (mounted.current) {
        setState({
          upgrades: [],
          error: "The desktop upgrades bridge is unavailable.",
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

  function update(upgrade: PlayerUpgradeDto, playerId: string, value: number): void {
    const before = upgrade.values.find((item) => item.playerId === playerId)?.value ?? 0;
    const key = editKey(playerId, upgrade.key);
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
          entity: playerId,
          field: upgrade.key,
          before,
          after: value,
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

  return {
    ...state,
    pendingByUpgrade,
    pendingEdits: Object.values(pendingByUpgrade),
    update,
    revert,
    reload: load,
  };
}
