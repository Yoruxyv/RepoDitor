/** Native workspace with shared synthetic health/upgrade transaction recovery. */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SaveOpenResult, SaveSession } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { tauriReadApi } from "@/app/tauriReadApi";
import { TauriPlayersView } from "@/features/players/TauriPlayersView";
import { usePlayers } from "@/features/players/usePlayers";
import { useTauriHealth } from "@/features/players/useTauriHealth";
import { TauriHealthControls } from "@/features/players/TauriHealthControls";
import { PendingChangesBar } from "@/features/pending-changes/PendingChangesBar";
import { TauriUpgradesView } from "@/features/upgrades/TauriUpgradesView";
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
  onCanonical = () => undefined,
  onHealthAvailability,
}: {
  readonly session: SaveSession;
  readonly onClose: () => void;
  readonly onCanonical?: (opened: SaveOpenResult) => void;
  readonly onHealthAvailability?: (enabled: boolean) => void;
}) {
  const { t } = usePreferences();
  const [section, setSection] = useState<Section>("overview");
  const players = usePlayers(session.id, null, tauriReadApi.players.list);
  const upgrades = useUpgrades(session.id, null, tauriReadApi.upgrades.list);
  const health = useTauriHealth(session, players.players, (projection) => {
    players.acceptSnapshot(projection.players);
    if (projection.upgrades) upgrades.acceptSnapshot(projection.upgrades);
    onCanonical(projection.opened);
  });
  const restoredSelection = useRef<string | null>(null);
  const visiblePlayers = players.players;
  const selectPlayer = players.setSelectedPlayerId;
  useEffect(() => {
    if (
      health.operationId &&
      health.restoredPlayerId &&
      restoredSelection.current !== health.operationId &&
      visiblePlayers.some((player) => player.id === health.restoredPlayerId)
    ) {
      restoredSelection.current = health.operationId;
      selectPlayer(health.restoredPlayerId);
    }
  }, [health.operationId, health.restoredPlayerId, visiblePlayers, selectPlayer]);
  useEffect(() => {
    onHealthAvailability?.(health.enabled);
    return () => onHealthAvailability?.(false);
  }, [health.enabled, onHealthAvailability]);
  const currentSession = health.canonical?.opened.session ?? session;
  const selectedPlayer =
    visiblePlayers.find((player) => player.id === players.selectedPlayerId) ?? null;
  const hasUpgradeDrafts = health.upgradeEdits.length > 0;
  const upgradeSaveUnavailable =
    hasUpgradeDrafts && (!!health.pending || !health.upgradeSession || !health.upgradeBatchFits);
  function revertUpgrades() {
    health.revertUpgrades();
  }
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
    <section
      aria-labelledby="workspace-title"
      className="pb-4"
      data-testid="workspace"
      data-session-fingerprint={currentSession.fingerprint}
    >
      <SaveHeader session={currentSession} onClose={onClose} />
      <TauriHealthControls health={health} player={selectedPlayer} />
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
              <span
                aria-hidden="true"
                className={`ml-1 inline-block size-1.5 rounded-full align-middle ${item === "upgrades" && hasUpgradeDrafts ? "bg-accent" : ""}`}
              />
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
              session={currentSession}
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
            <TauriPlayersView players={players} health={health} avatarUrls={avatarUrls} />
          ) : null}
          {section === "upgrades" ? (
            <TauriUpgradesView
              avatarUrls={avatarUrls}
              players={players}
              upgrades={upgrades}
              enabled={health.enabled}
              locked={health.locked}
              resetVersion={health.resetVersion}
              onRevertAll={revertUpgrades}
              transaction={health}
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
      {health.enabled ? (
        <PendingChangesBar
          edits={[...(health.pending ? [health.pending] : []), ...health.upgradeEdits]}
          saving={health.phase === "saving" || health.phase === "reconciling"}
          error={null}
          backupPath={null}
          blocked={health.locked}
          invalid={health.invalid}
          saveUnavailableReason={upgradeSaveUnavailable ? t("upgrades.saveUnavailable") : null}
          onRevert={() => {
            void health.revert();
          }}
          onSave={() => {
            if (!upgradeSaveUnavailable) void health.save();
          }}
        />
      ) : null}
    </section>
  );
}
