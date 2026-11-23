import {
  installedWriteRestriction,
  type CompatibilityEnvironment,
} from "@/features/editor/compatibility";
/** Native workspace with shared Run-save recovery. */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { SaveOpenResult, SaveSession } from "@/app/desktopContracts";
import { usePreferences } from "@/app/preferences";
import { tauriHealthApi } from "@/app/tauriHealthApi";
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
import { GameCompatibilityNotice } from "./GameCompatibilityNotice";
import type { TauriEntrySnapshot } from "./tauriEntryPreparation";

const SECTIONS = ["overview", "players", "upgrades", "run", "items", "maps"] as const;
type Section = (typeof SECTIONS)[number];

function saveUnavailable(health: ReturnType<typeof useTauriHealth>) {
  if (health.draftOnly) return "health.draftOnly";
  const upgrades = health.upgradeEdits.length > 0;
  const run = health.runEdits.length > 0;
  const refills = health.refillEdits.length > 0;
  if (Number(health.healthEdits.length > 0) + Number(upgrades) + Number(run) + Number(refills) > 1)
    return health.mixedSaveAvailable ? null : "run.mixedDrafts";
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
  prepared,
  active = true,
  onClose,
  onCanonical = () => undefined,
  onHealthAvailability,
  compatibility,
}: {
  readonly session: SaveSession;
  readonly prepared?: TauriEntrySnapshot | null;
  readonly active?: boolean;
  readonly onClose: () => void;
  readonly onCanonical?: (opened: SaveOpenResult) => void;
  readonly onHealthAvailability?: (mode: "checking" | "readonly" | "test" | "production") => void;
  readonly compatibility?: CompatibilityEnvironment | null;
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
  const [initialHealthKnown, setInitialHealthKnown] = useState(false);
  const players = usePlayers(
    session.id,
    prepared?.players ?? null,
    tauriReadApi.players.list,
    initialHealthKnown,
  );
  const upgrades = useUpgrades(
    session.id,
    prepared?.upgrades ?? null,
    tauriReadApi.upgrades.list,
    initialHealthKnown && active,
    tauriReadApi.upgrades.prepare,
  );
  const run = useRunState(
    session.id,
    prepared?.run ?? null,
    tauriReadApi.run.get,
    section === "run",
  );
  const items = useItems(
    session.id,
    prepared?.items ?? null,
    tauriReadApi.advanced.get,
    section === "items",
  );
  const health = useTauriHealth(
    session,
    players.players,
    (projection) => {
      players.acceptSnapshot(projection.players);
      if (projection.upgrades)
        upgrades.acceptSnapshot(projection.upgrades, projection.upgradeArtworkRetained);
      if (projection.run) run.acceptSnapshot(projection.run);
      if (projection.advanced) items.acceptSnapshot(projection.advanced);
      else if (projection.upgradeArtworkRetained === false) items.clearUpgradeArtwork();
      onCanonical(projection.opened);
    },
    tauriHealthApi,
  );
  useEffect(() => {
    if (health.phase !== "checking") setInitialHealthKnown(true);
  }, [health.phase]);
  const canLoadMaps = health.phase !== "saving" && health.phase !== "reconciling";
  const maps = useMaps(
    prepared?.maps ?? null,
    tauriReadApi.maps.list,
    canLoadMaps && section === "maps",
  );
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
    const activeMode = health.production ? "production" : "test";
    const mode = health.enabled ? activeMode : "readonly";
    onHealthAvailability?.(health.phase === "checking" ? "checking" : mode);
    return () => onHealthAvailability?.("checking");
  }, [health.enabled, health.phase, health.production, onHealthAvailability]);
  const currentSession = health.canonical?.opened.session ?? session;
  const artworkFingerprint = useRef({ upgrades: session.fingerprint, items: session.fingerprint });
  const refreshUpgrades = upgrades.refreshArtwork;
  const refreshItems = items.refreshArtwork;
  const hasCanonicalItems = health.canonical?.advanced != null;
  const itemArtworkRetained = health.canonical?.itemArtworkRetained === true;
  const upgradeArtworkRetained = health.canonical?.upgradeArtworkRetained;
  useEffect(() => {
    if (health.locked) return;
    if (
      section === "upgrades" &&
      artworkFingerprint.current.upgrades !== currentSession.fingerprint
    ) {
      artworkFingerprint.current.upgrades = currentSession.fingerprint;
      if (upgradeArtworkRetained !== true) {
        void refreshUpgrades(
          upgradeArtworkRetained === false ? currentSession.fingerprint : undefined,
        );
      }
    }
    if (
      section === "items" &&
      (hasCanonicalItems || upgradeArtworkRetained === false) &&
      artworkFingerprint.current.items !== currentSession.fingerprint
    ) {
      artworkFingerprint.current.items = currentSession.fingerprint;
      if (!itemArtworkRetained || upgradeArtworkRetained === false)
        void refreshItems(currentSession.fingerprint);
    }
  }, [
    currentSession.fingerprint,
    hasCanonicalItems,
    health.locked,
    itemArtworkRetained,
    refreshItems,
    refreshUpgrades,
    section,
    upgradeArtworkRetained,
  ]);
  const pendingSections: Partial<Record<Section, number>> = {
    players: health.healthEdits.length,
    upgrades: health.upgradeEdits.length,
    run: health.runEdits.length,
    items: health.refillEdits.length,
  };
  const reason = saveUnavailable(health);
  const saveUnavailableReason = reason ? t(reason) : null;
  const avatars = usePlayerAvatars(
    session.id,
    players.selectedPlayerId,
    tauriReadApi.players.avatar,
    prepared?.avatarPrefetch,
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
  const domains = [
    ["nav.players", health.healthEnabled, prepared?.players],
    ["nav.upgrades", health.upgradesEnabled, prepared?.upgrades],
    ["nav.run", health.runEnabled, prepared?.run],
    ["nav.items", health.refillsEnabled, prepared?.items],
  ] as const;
  const incompatible = domains
    .filter(([, , dto]) => dto?.ok === false && dto.error.code === "save_unsupported")
    .map(([feature]) => feature);
  const restricted = domains
    .filter(([feature, enabled]) => !enabled && !incompatible.includes(feature))
    .map(([feature]) => feature);
  const build = compatibility?.healthWriteCompatibility?.buildId;
  return (
    <section
      aria-labelledby="workspace-title"
      className="pb-4"
      data-testid="workspace"
      data-session-fingerprint={currentSession.fingerprint}
      data-artwork-preparation={prepared ? "settled" : undefined}
    >
      <SaveHeader session={currentSession} onClose={onClose} />
      <TauriHealthControls health={health} />
      {active && incompatible.length > 0 ? (
        <GameCompatibilityNotice build={build} issue="incompatible" features={incompatible} />
      ) : null}
      {active &&
      compatibility &&
      (health.phase === "disabled" || health.production) &&
      restricted.length > 0 ? (
        <GameCompatibilityNotice
          build={build}
          issue={health.enabled ? "unknown" : installedWriteRestriction(compatibility)}
          features={restricted}
        />
      ) : null}
      {prepared &&
      Object.values(prepared.artwork).some(({ issues }) => Object.keys(issues).length > 0) ? (
        <output className="mb-4 block border-l-2 border-accent bg-accent-muted px-4 py-3 text-sm text-secondary">
          {(["upgrade", "item", "map"] as const)
            .filter((scope) => Object.keys(prepared.artwork[scope].issues).length > 0)
            .map((scope) => (
              <span className="block" key={scope}>
                {t(`nav.${scope}s`)} ·{" "}
                {t("entry.artworkDeferred", {
                  count: Object.values(prepared.artwork[scope].issues).reduce(
                    (total, count) => total + count,
                    0,
                  ),
                })}
              </span>
            ))}
        </output>
      ) : null}
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
              <span aria-hidden="true" className="ml-1 inline-block size-1.5 align-middle">
                {section !== item && pendingSections[item] ? (
                  <span
                    className="block size-1.5 rounded-full bg-accent"
                    data-testid={`workspace-tab-pending-indicator-${item}`}
                  />
                ) : null}
              </span>
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
              readOnly={!health.healthEnabled}
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
              enabled={health.upgradesEnabled}
              locked={health.locked}
              resetVersion={health.resetVersion}
              transaction={{ ...health, enabled: health.upgradesEnabled }}
            />
          ) : null}
          {section === "items" ? (
            <TauriItemsView
              items={items}
              transaction={{ ...health, enabled: health.refillsEnabled }}
            />
          ) : null}
          {section === "run" ? (
            <TauriRunView run={run} transaction={{ ...health, enabled: health.runEnabled }} />
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
          reviewPath={health.reviewPath}
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
