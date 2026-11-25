/** Bind the existing upgrade presentation to the native transaction controller. */
import { usePreferences } from "@/app/preferences/preferences";
import type { usePlayers } from "@/features/players/usePlayers";
import type { useTauriHealth } from "@/features/editor/session/useTauriHealth";
import { UpgradesView } from "./UpgradesView";
import type { useUpgrades } from "./useUpgrades";

export function TauriUpgradesView({
  players,
  upgrades,
  enabled,
  locked,
  avatarUrls,
  onRejectAvatar,
  resetVersion,
  transaction,
}: {
  readonly players: ReturnType<typeof usePlayers>;
  readonly upgrades: ReturnType<typeof useUpgrades>;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly avatarUrls: Record<string, string | null>;
  readonly onRejectAvatar: (playerId: string, url: string) => void;
  readonly resetVersion: number;
  readonly transaction: ReturnType<typeof useTauriHealth>;
}) {
  const { t } = usePreferences();
  return (
    <fieldset className="min-w-0" disabled={enabled && locked}>
      <legend className="sr-only">{t("nav.upgrades")}</legend>
      <UpgradesView
        avatarUrls={avatarUrls}
        error={players.error ?? upgrades.error}
        loading={players.loading || upgrades.loading}
        pendingByUpgrade={Object.fromEntries(
          transaction.upgradeEdits.map((edit) => [`${edit.entity}:${edit.field}`, edit]),
        )}
        players={players.players}
        selectedPlayerId={players.selectedPlayerId}
        upgrades={upgrades.upgrades}
        resetVersion={resetVersion}
        onChange={enabled ? transaction.editUpgrade : null}
        onRevert={enabled ? transaction.revertUpgrade : null}
        onValidityChange={enabled ? transaction.setUpgradeInvalid : undefined}
        onRejectAvatar={onRejectAvatar}
        onRetry={() => {
          if (players.error) players.reload();
          else void upgrades.reload();
        }}
        onSelectPlayer={players.setSelectedPlayerId}
      />
    </fieldset>
  );
}
