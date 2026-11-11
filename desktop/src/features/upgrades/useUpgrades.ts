/** Owns renderer loading state for dynamically discovered player upgrades. */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DesktopOperationResult,
  PlayerDto,
  PlayerUpgradeDto,
  RepoDitorApi,
  SaveCanonicalUpgradeValue,
} from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/i18n";
import type { UpgradeValueEdit } from "@/features/pending-changes/pendingEdits";

interface UpgradesState {
  upgrades: PlayerUpgradeDto[];
  error: TranslationKey | null;
  loading: boolean;
}

const INITIAL_STATE: UpgradesState = { upgrades: [], error: null, loading: true };

const listDesktopUpgrades: RepoDitorApi["upgrades"]["list"] = (saveId) =>
  window.repoditor.upgrades.list(saveId);

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
  list: RepoDitorApi["upgrades"]["list"] = listDesktopUpgrades,
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
  const requestInFlight = useRef(false);
  const snapshotVersion = useRef(0);

  const load = useCallback(
    async (preserveExisting = false): Promise<boolean> => {
      if (requestInFlight.current) return false;
      requestInFlight.current = true;
      const version = snapshotVersion.current;
      try {
        const resolved = await list(saveId);
        if (!mounted.current || version !== snapshotVersion.current) return resolved.ok;
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
        if (mounted.current && version === snapshotVersion.current) {
          setState((current) => ({
            upgrades: preserveExisting ? current.upgrades : [],
            error: "error.service",
            loading: false,
          }));
        }
        return false;
      } finally {
        requestInFlight.current = false;
      }
    },
    [list, saveId],
  );

  useEffect(() => {
    mounted.current = true;
    const request =
      initialResultRef.current === null ? window.setTimeout(() => void load(false)) : undefined;
    return () => {
      mounted.current = false;
      if (request !== undefined) window.clearTimeout(request);
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

  function acceptSnapshot(upgrades: PlayerUpgradeDto[]): void {
    snapshotVersion.current += 1;
    const known = new Map(state.upgrades.map((upgrade) => [upgrade.key, upgrade]));
    setState({
      loading: false,
      error: null,
      upgrades: upgrades.map((upgrade) => {
        const presentation = known.get(upgrade.key);
        return presentation ? { ...presentation, values: upgrade.values } : upgrade;
      }),
    });
  }

  async function refreshArtwork(): Promise<void> {
    const version = snapshotVersion.current;
    const result = await list(saveId);
    if (!mounted.current || version !== snapshotVersion.current || !result.ok) return;
    const tokens = new Map(result.data.map((upgrade) => [upgrade.key, upgrade.iconToken]));
    setState((current) => ({
      ...current,
      upgrades: current.upgrades.map((upgrade) => ({
        ...upgrade,
        iconToken: tokens.get(upgrade.key) ?? null,
      })),
    }));
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
    acceptSnapshot,
    refreshArtwork,
    reload: () => load(false),
    refreshAfterSave: () => load(true),
  };
}
