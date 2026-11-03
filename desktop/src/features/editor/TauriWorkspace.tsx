/** Native read-only projections using the production workspace presentation. */
import { useState, type KeyboardEvent } from "react";
import type { SaveSession } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { tauriReadApi } from "@/app/tauriReadApi";
import { PlayersView } from "@/features/players/PlayersView";
import { usePlayers } from "@/features/players/usePlayers";
import { UpgradesView } from "@/features/upgrades/UpgradesView";
import { useUpgrades } from "@/features/upgrades/useUpgrades";
import { OverviewView } from "./OverviewView";
import { SaveHeader } from "./SaveHeader";

const SECTIONS = ["overview", "players", "upgrades"] as const;
type Section = (typeof SECTIONS)[number];

export function TauriWorkspace({
  session,
  onClose,
}: {
  readonly session: SaveSession;
  readonly onClose: () => void;
}) {
  const { t } = usePreferences();
  const [section, setSection] = useState<Section>("overview");
  const players = usePlayers(session.id, null, tauriReadApi.players.list);
  const upgrades = useUpgrades(session.id, null, tauriReadApi.upgrades.list);
  const avatarUrls = Object.fromEntries(players.players.map((player) => [player.id, null]));
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % SECTIONS.length;
    else if (event.key === "ArrowLeft") next = (index + SECTIONS.length - 1) % SECTIONS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = SECTIONS.length - 1;
    else return;
    event.preventDefault();
    setSection(SECTIONS[next]!);
    document.getElementById(`native-${SECTIONS[next]}-tab`)?.focus();
  }
  return (
    <section aria-labelledby="workspace-title" className="pb-4" data-testid="workspace">
      <SaveHeader session={session} onClose={onClose} />
      <nav className="overflow-x-auto border-b border-line" aria-label={t("workspace.sections")}>
        <div className="flex min-w-max gap-1 py-2" role="tablist">
          {SECTIONS.map((item, index) => (
            <button
              aria-controls="workspace-panel"
              aria-selected={section === item}
              className={`ui-feedback rounded-sm py-2.5 pr-1.5 pl-4 text-sm font-semibold ${section === item ? "bg-accent text-accent-ink" : "text-secondary hover:bg-surface hover:text-ink"}`}
              id={`native-${item}-tab`}
              key={item}
              role="tab"
              tabIndex={section === item ? 0 : -1}
              type="button"
              onClick={() => setSection(item)}
              onKeyDown={(event) => moveTab(event, index)}
            >
              {t(`nav.${item}`)}
              <span aria-hidden="true" className="ml-1 inline-block size-1.5 align-middle" />
            </button>
          ))}
        </div>
      </nav>
      <div className="pt-6">
        <div
          aria-labelledby={`native-${section}-tab`}
          className="min-w-0"
          id="workspace-panel"
          role="tabpanel"
          tabIndex={0}
        >
          {section === "overview" ? (
            <OverviewView
              session={session}
              availableDestinations={["players", "upgrades"]}
              onNavigate={(destination) => {
                if (destination === "players" || destination === "upgrades")
                  setSection(destination);
              }}
            />
          ) : null}
          {section === "players" ? (
            <PlayersView
              avatarUrls={avatarUrls}
              error={players.error}
              loading={players.loading}
              pendingByPlayer={{}}
              players={players.players}
              selectedPlayerId={players.selectedPlayerId}
              onHealthChange={null}
              onRevertHealth={null}
              onRejectAvatar={() => undefined}
              onRetry={players.reload}
              onSelect={players.setSelectedPlayerId}
            />
          ) : null}
          {section === "upgrades" ? (
            <UpgradesView
              avatarUrls={avatarUrls}
              error={players.error ?? upgrades.error}
              loading={players.loading || upgrades.loading}
              pendingByUpgrade={{}}
              players={players.players}
              selectedPlayerId={players.selectedPlayerId}
              upgrades={upgrades.upgrades}
              onChange={null}
              onRevert={null}
              onRejectAvatar={() => undefined}
              onRetry={() => {
                if (players.error) players.reload();
                else void upgrades.reload();
              }}
              onSelectPlayer={players.setSelectedPlayerId}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
