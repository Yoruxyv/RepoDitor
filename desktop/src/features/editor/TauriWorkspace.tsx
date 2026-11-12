/** Native workspace with shared synthetic Health/Upgrades/Run recovery. */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SaveOpenResult, SaveSession } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { tauriReadApi } from "@/app/tauriReadApi";
import { TauriPlayersView } from "@/features/players/TauriPlayersView";
import { usePlayers } from "@/features/players/usePlayers";
import { usePlayerAvatars } from "@/features/players/usePlayerAvatars";
import { useTauriHealth } from "@/features/players/useTauriHealth";
import { TauriHealthControls } from "@/features/players/TauriHealthControls";
import { PendingChangesBar } from "@/features/pending-changes/PendingChangesBar";
import { TauriUpgradesView } from "@/features/upgrades/TauriUpgradesView";
import { useUpgrades } from "@/features/upgrades/useUpgrades";
import { TauriItemsView } from "@/features/items/TauriItemsView";
import { useItems } from "@/features/items/useItems";
import { TauriRunView } from "@/features/run/TauriRunView";
import { useRunState } from "@/features/run/useRunState";
import { MapsView } from "@/features/maps/MapsView";
import { useMaps } from "@/features/maps/useMaps";
import { OverviewView } from "./OverviewView";
import { SaveHeader } from "./SaveHeader";

const SECTIONS = ["overview", "players", "upgrades", "run", "items", "maps"] as const;
type Section = (typeof SECTIONS)[number];

function saveUnavailable(health: ReturnType<typeof useTauriHealth>) {
  const upgrades = health.upgradeEdits.length > 0;
  const run = health.runEdits.length > 0;
  const refills = health.refillEdits.length > 0;
  if (Number(health.healthEdits.length > 0) + Number(upgrades) + Number(run) + Number(refills) > 1)
    return "run.mixedDrafts";
  if (refills && !health.refillSaveAvailable) return "items.saveUnavailable";
  if (health.healthEdits.length > 0 && (!health.upgradeSession || !health.healthBatchFits))
    return "health.saveUnavailable";
  if (upgrades && (!health.upgradeSession || !health.upgradeBatchFits))
    return "upgrades.saveUnavailable";
  if (run && !health.upgradeSession) return "run.saveUnavailable";
  return null;
}

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
  const tabFocus = useRef<Section | null>(null);
  useLayoutEffect(() => {
    if (tabFocus.current !== section) return;
    tabFocus.current = null;
    const tab = document.getElementById(`native-${section}-tab`);
    if (
      tab &&
      !tab.closest("[hidden], [inert]") &&
      tab.checkVisibility?.({ visibilityProperty: true }) !== false
    )
      tab.focus();
  }, [section]);
  const players = usePlayers(session.id, null, tauriReadApi.players.list);
  const upgrades = useUpgrades(session.id, null, tauriReadApi.upgrades.list);
  // Cold projections share the native worker with Save and its acknowledgement.
  const run = useRunState(session.id, null, tauriReadApi.run.get, section === "run");
  const items = useItems(session.id, null, tauriReadApi.advanced.get, section === "items");
  const health = useTauriHealth(session, players.players, (projection) => {
    players.acceptSnapshot(projection.players);
    if (projection.upgrades) upgrades.acceptSnapshot(projection.upgrades);
    if (projection.run) run.acceptSnapshot(projection.run);
    if (projection.advanced) items.acceptSnapshot(projection.advanced);
    onCanonical(projection.opened);
  });
  const canLoadMaps = health.phase !== "saving" && health.phase !== "reconciling";
  const maps = useMaps(null, tauriReadApi.maps.list, canLoadMaps && section === "maps");
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
  const artworkFingerprint = useRef(session.fingerprint);
  const refreshUpgrades = upgrades.refreshArtwork;
  useEffect(() => {
    // The list read shares a worker with the final transaction acknowledgement.
    if (!health.locked && artworkFingerprint.current !== currentSession.fingerprint) {
      artworkFingerprint.current = currentSession.fingerprint;
      void refreshUpgrades();
    }
  }, [currentSession.fingerprint, health.locked, refreshUpgrades]);
  const selectedPlayer =
    visiblePlayers.find((player) => player.id === players.selectedPlayerId) ?? null;
  const pendingSections: Partial<Record<Section, number>> = {
    players: health.healthEdits.length,
    upgrades: health.upgradeEdits.length,
    run: health.runEdits.length,
    items: health.refillEdits.length,
  };
  const reason = saveUnavailable(health);
  const saveUnavailableReason = reason ? t(reason) : null;
  function revertUpgrades() {
    health.revertUpgrades();
  }
  const avatars = usePlayerAvatars(
    session.id,
    players.selectedPlayerId,
    tauriReadApi.players.avatar,
  );
  const avatarUrls = avatars.avatarUrls;
  function selectTabWithFocus(next: Section) {
    if (next === section) return;
    tabFocus.current = next;
    setSection(next);
  }
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % SECTIONS.length;
    else if (event.key === "ArrowLeft") next = (index + SECTIONS.length - 1) % SECTIONS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = SECTIONS.length - 1;
    else return;
    event.preventDefault();
    selectTabWithFocus(SECTIONS[next]!);
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
              aria-describedby={pendingSections[item] ? `native-${item}-pending` : undefined}
              aria-label={t(`nav.${item}`)}
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
                className={`ml-1 inline-block size-1.5 rounded-full align-middle ${section === item ? "bg-accent-ink" : "bg-accent"} ${pendingSections[item] ? "" : "invisible"}`}
              />
              {pendingSections[item] ? (
                <span className="sr-only" id={`native-${item}-pending`}>
                  {t(pendingSections[item] === 1 ? "pending.one" : "pending.many", {
                    count: pendingSections[item],
                  })}
                </span>
              ) : null}
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
              readOnly={!health.enabled}
              session={currentSession}
              availableDestinations={["players", "upgrades", "run", "items"]}
              onNavigate={selectTabWithFocus}
            />
          ) : null}
          {section === "players" ? (
            <TauriPlayersView
              players={players}
              health={health}
              avatarUrls={avatarUrls}
              onRejectAvatar={avatars.rejectAvatar}
            />
          ) : null}
          {section === "upgrades" ? (
            <TauriUpgradesView
              avatarUrls={avatarUrls}
              onRejectAvatar={avatars.rejectAvatar}
              players={players}
              upgrades={upgrades}
              enabled={health.enabled}
              locked={health.locked}
              resetVersion={health.resetVersion}
              onRevertAll={revertUpgrades}
              transaction={health}
            />
          ) : null}
          {section === "items" ? <TauriItemsView items={items} transaction={health} /> : null}
          {section === "run" ? <TauriRunView run={run} transaction={health} /> : null}
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
          edits={[
            ...health.healthEdits,
            ...health.upgradeEdits,
            ...health.runEdits,
            ...health.refillEdits,
          ]}
          saving={health.phase === "saving" || health.phase === "reconciling"}
          error={null}
          backupPath={null}
          blocked={health.locked}
          invalid={health.invalid}
          saveUnavailableReason={saveUnavailableReason}
          onRevert={() => {
            void health.revert();
          }}
          onSave={() => {
            if (!saveUnavailableReason) void health.save();
          }}
        />
      ) : null}
    </section>
  );
}
