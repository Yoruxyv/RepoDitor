/** Native read-only projections using the production workspace presentation. */
import { useState, type KeyboardEvent } from "react";
import type { SaveSession } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { tauriReadApi } from "@/app/tauriReadApi";
import { PlayersView } from "@/features/players/PlayersView";
import { usePlayers } from "@/features/players/usePlayers";
import { UpgradesView } from "@/features/upgrades/UpgradesView";
import { useUpgrades } from "@/features/upgrades/useUpgrades";
import { ItemsView } from "@/features/items/ItemsView";
import { useItems } from "@/features/items/useItems";
import { RunView } from "@/features/run/RunView";
import { useRunState } from "@/features/run/useRunState";
import { MapsView } from "@/features/maps/MapsView";
import { useMaps } from "@/features/maps/useMaps";
import { OverviewView } from "./OverviewView";
import { SaveHeader } from "./SaveHeader";

const SECTIONS = ["overview", "players", "upgrades", "run", "items", "maps"] as const;
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
  const run = useRunState(session.id, null, tauriReadApi.run.get);
  const items = useItems(session.id, null, tauriReadApi.advanced.get);
  const maps = useMaps(null, tauriReadApi.maps.list);
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
              availableDestinations={["players", "upgrades", "run", "items"]}
              onNavigate={(destination) => {
                if (
                  destination === "players" ||
                  destination === "upgrades" ||
                  destination === "run" ||
                  destination === "items"
                )
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
          {section === "items" ? (
            <ItemsView
              advanced={items.advanced}
              loading={items.loading}
              error={items.error}
              pendingByItem={{}}
              onRefillAllToFull={null}
              onRefillToFull={null}
              onRevertRefill={null}
              onRetry={() => void items.reload()}
            />
          ) : null}
          {section === "run" ? (
            <RunView
              run={run.run}
              loading={run.loading}
              error={run.error}
              pendingByField={{}}
              onStatChange={null}
              onResumeChange={null}
              onRevert={null}
              onRetry={() => void run.reload()}
            />
          ) : null}
          {section === "maps" ? (
            <MapsView
              artworkAttempt={maps.artworkAttempt}
              discovery={maps.discovery}
              loading={maps.loading}
              error={maps.error}
              onRetry={() => void maps.reload()}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
