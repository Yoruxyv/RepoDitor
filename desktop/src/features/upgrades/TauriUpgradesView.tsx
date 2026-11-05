/** Bind the existing upgrade presentation to the synthetic transaction controller. */
import { usePreferences } from "@/app/preferences";
import type { usePlayers } from "@/features/players/usePlayers";
import type { useTauriHealth } from "@/features/players/useTauriHealth";
import { UpgradesView } from "./UpgradesView";
import type { useUpgrades } from "./useUpgrades";

export function TauriUpgradesView({
  players,
  upgrades,
  enabled,
  locked,
  avatarUrls,
  resetVersion,
  onRevertAll,
  transaction,
}: {
  readonly players: ReturnType<typeof usePlayers>;
  readonly upgrades: ReturnType<typeof useUpgrades>;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly avatarUrls: Record<string, string | null>;
  readonly resetVersion: number;
  readonly onRevertAll: () => void;
  readonly transaction: ReturnType<typeof useTauriHealth>;
}) {
  const { t } = usePreferences();
  return (
    <>
      {enabled ? (
        <div className="mb-5 border-l-2 border-accent pl-3 text-sm">
          <p id="upgrade-draft-notice">{t("upgrades.draftOnly")}</p>
          <button
            className="ui-feedback mt-2 rounded-sm border border-control px-3 py-2 font-semibold text-secondary hover:border-accent hover:text-accent disabled:opacity-50"
            disabled={locked}
            type="button"
            onClick={onRevertAll}
          >
            {t("upgrades.revertDrafts")}
          </button>
        </div>
      ) : null}
      <fieldset
        aria-describedby={enabled ? "upgrade-draft-notice" : undefined}
        className="min-w-0"
        disabled={enabled && locked}
      >
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
          onRejectAvatar={() => undefined}
          onRetry={() => {
            if (players.error) players.reload();
            else void upgrades.reload();
          }}
          onSelectPlayer={players.setSelectedPlayerId}
        />
      </fieldset>
    </>
  );
}
