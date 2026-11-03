/**
 * Run-save workspace orchestrator and cross-feature pending-edit owner.
 *
 * Keeps feature modules shallow, preserves edits across section navigation, and sends
 * one typed change union through the session write boundary. It never derives game
 * mechanics or accesses raw save data.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type {
  AssetPreparationState,
  SaveChange,
  SaveSession,
  SaveWriteResult,
} from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { AssetPreparationNotice } from "@/features/assets/AssetPreparationView";
import { ItemsView } from "@/features/items/ItemsView";
import { useItems } from "@/features/items/useItems";
import { MapsView } from "@/features/maps/MapsView";
import { useMaps } from "@/features/maps/useMaps";
import { PlayersView } from "@/features/players/PlayersView";
import { usePlayerAvatars } from "@/features/players/usePlayerAvatars";
import { usePlayers } from "@/features/players/usePlayers";
import { RunView } from "@/features/run/RunView";
import { useRunState } from "@/features/run/useRunState";
import { UpgradesView } from "@/features/upgrades/UpgradesView";
import { useUpgrades } from "@/features/upgrades/useUpgrades";
import { OverviewView, type OverviewDestination } from "@/features/editor/OverviewView";
import { SaveHeader } from "./SaveHeader";
import type { RunEntryData } from "@/features/editor/runEntryPreparation";
import { PendingChangesBar } from "@/features/pending-changes/PendingChangesBar";
import { toSaveChange, type RunSavePendingEdit } from "@/features/pending-changes/pendingEdits";

const SECTIONS = ["overview", "players", "upgrades", "run", "items", "maps"] as const;
export type WorkspaceSection = (typeof SECTIONS)[number];

async function applyCanonicalOrRefresh<T>(
  canonical: T | undefined,
  apply: (value: T) => boolean,
  refresh: () => Promise<boolean>,
): Promise<boolean> {
  if (canonical !== undefined && apply(canonical)) {
    return true;
  }
  return refresh();
}

interface WorkspaceProps {
  readonly activeSection: WorkspaceSection;
  readonly assetState: AssetPreparationState;
  readonly session: SaveSession;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly backupPath: string | null;
  readonly initialEntryData: RunEntryData | null;
  readonly onPendingCountChange: (count: number) => void;
  readonly onActiveSectionChange: (section: WorkspaceSection) => void;
  readonly onClose: () => void;
  readonly onSave: (changes: SaveChange[]) => Promise<SaveWriteResult | null>;
}

export function Workspace({
  activeSection,
  assetState,
  session,
  saving,
  saveError,
  backupPath,
  initialEntryData,
  onPendingCountChange,
  onActiveSectionChange,
  onClose,
  onSave,
}: WorkspaceProps) {
  const [postSaveRefreshing, setPostSaveRefreshing] = useState(false);
  const warningScope = `${session.id}:${session.fingerprint}`;
  const warningStorageKey = `repoditor.dismissedArtworkWarning:${warningScope}`;
  const [dismissedWarning, setDismissedWarning] = useState(() => {
    try {
      return sessionStorage.getItem(warningStorageKey) === "1";
    } catch {
      return false;
    }
  });
  const [artworkDegraded, setArtworkDegraded] = useState(
    initialEntryData?.artworkDegraded ?? false,
  );
  const observedArtworkPreparation = useRef(false);
  const { t } = usePreferences();
  const [editVersion, setEditVersion] = useState(0);
  const players = usePlayers(session.id, initialEntryData?.players ?? null);
  const avatars = usePlayerAvatars(
    session.id,
    players.selectedPlayerId,
    initialEntryData?.avatarUrls ?? {},
  );
  const upgrades = useUpgrades(session.id, initialEntryData?.upgrades ?? null);
  const run = useRunState(session.id, initialEntryData?.run ?? null);
  const items = useItems(session.id, initialEntryData?.items ?? null);
  const maps = useMaps(initialEntryData?.maps ?? null);
  const runSavePendingEdits: RunSavePendingEdit[] = [
    ...players.pendingEdits,
    ...upgrades.pendingEdits,
    ...run.pendingEdits,
    ...items.pendingEdits,
  ];
  const pendingEdits: RunSavePendingEdit[] = runSavePendingEdits;
  const pendingBySection: Record<WorkspaceSection, number> = {
    overview: 0,
    players: players.pendingEdits.length,
    upgrades: upgrades.pendingEdits.length,
    run: run.pendingEdits.length,
    items: items.pendingEdits.length,
    maps: 0,
  };

  useEffect(() => {
    onPendingCountChange(pendingEdits.length);
    return () => onPendingCountChange(0);
  }, [onPendingCountChange, pendingEdits.length]);

  const assetPreparationActive = [
    "discovering",
    "validating",
    "indexing",
    "resolving",
    "decoding",
  ].includes(assetState.stage);

  useEffect(() => {
    if (assetPreparationActive) {
      observedArtworkPreparation.current = true;
      return;
    }
    if (!observedArtworkPreparation.current) return;
    observedArtworkPreparation.current = false;
    if (assetState.stage === "ready" || assetState.stage === "degraded") {
      setArtworkDegraded(assetState.degraded);
    }
  }, [assetPreparationActive, assetState.degraded, assetState.stage]);

  function dismissArtworkWarning(): void {
    setDismissedWarning(true);
    try {
      sessionStorage.setItem(warningStorageKey, "1");
    } catch {
      // Session persistence is optional; the visible workspace still dismisses it.
    }
  }

  function revertAll(): void {
    players.revertAll();
    upgrades.revertAll();
    run.revertAll();
    items.revertAll();
    setEditVersion((current) => current + 1);
  }

  async function saveAll(): Promise<void> {
    if (runSavePendingEdits.length === 0) return;

    const editsToSave = [...runSavePendingEdits];
    const affected = new Set(editsToSave.map((edit) => edit.feature));
    setPostSaveRefreshing(true);

    const saved = await onSave(editsToSave.map(toSaveChange));
    if (saved === null) {
      setPostSaveRefreshing(false);
      return;
    }

    const canonical =
      saved.canonical?.fingerprint === saved.session.fingerprint ? saved.canonical : undefined;

    try {
      await Promise.all([
        affected.has("players")
          ? applyCanonicalOrRefresh(
              canonical?.players,
              players.applyAfterSave,
              players.refreshAfterSave,
            )
          : Promise.resolve(true),
        affected.has("upgrades")
          ? applyCanonicalOrRefresh(
              canonical?.upgrades,
              upgrades.applyAfterSave,
              upgrades.refreshAfterSave,
            )
          : Promise.resolve(true),
        affected.has("run")
          ? applyCanonicalOrRefresh(canonical?.run, run.applyAfterSave, run.refreshAfterSave)
          : Promise.resolve(true),
        affected.has("advanced")
          ? applyCanonicalOrRefresh(
              canonical?.advanced,
              items.applyAfterSave,
              items.refreshAfterSave,
            )
          : Promise.resolve(true),
      ]);
    } finally {
      players.revertAll();
      upgrades.revertAll();
      run.revertAll();
      items.revertAll();
      setEditVersion((current) => current + 1);
      setPostSaveRefreshing(false);
    }
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let offset = 0;
    if (event.key === "ArrowRight") {
      offset = 1;
    } else if (event.key === "ArrowLeft") {
      offset = -1;
    }
    if (offset === 0) {
      return;
    }
    event.preventDefault();
    const nextIndex = (index + offset + SECTIONS.length) % SECTIONS.length;
    onActiveSectionChange(SECTIONS[nextIndex]!);
    document.getElementById(`workspace-tab-${nextIndex}`)?.focus();
  }

  function openSection(section: OverviewDestination): void {
    onActiveSectionChange(section);
    requestAnimationFrame(() => {
      document.getElementById(`workspace-tab-${SECTIONS.indexOf(section)}`)?.focus();
    });
  }

  const showArtworkWarning = artworkDegraded && !dismissedWarning;
  const noticeState =
    artworkDegraded && !assetPreparationActive
      ? { ...assetState, stage: "degraded" as const, degraded: true }
      : assetState;
  const noticeDismiss =
    artworkDegraded && !assetPreparationActive ? dismissArtworkWarning : undefined;

  return (
    <section aria-labelledby="workspace-title" className="pb-4" data-testid="workspace">
      {showArtworkWarning || assetPreparationActive ? (
        <AssetPreparationNotice
          state={noticeState}
          showPreparing={assetPreparationActive}
          onDismiss={noticeDismiss}
        />
      ) : null}
      <SaveHeader session={session} onClose={onClose} />

      <nav className="overflow-x-auto border-b border-line" aria-label={t("workspace.sections")}>
        <div className="flex min-w-max gap-1 py-2" role="tablist">
          {SECTIONS.map((section, index) => {
            const active = activeSection === section;
            const pendingCount = pendingBySection[section];
            return (
              <button
                aria-controls="workspace-panel"
                aria-describedby={pendingCount > 0 ? `workspace-tab-pending-${index}` : undefined}
                aria-label={t(`nav.${section}`)}
                aria-selected={active}
                className={`ui-feedback rounded-sm py-2.5 pr-1.5 pl-4 text-sm font-semibold ${
                  active
                    ? "bg-accent text-accent-ink"
                    : "text-secondary hover:bg-surface hover:text-ink"
                }`}
                id={`workspace-tab-${index}`}
                key={section}
                role="tab"
                tabIndex={active ? 0 : -1}
                type="button"
                onClick={() => onActiveSectionChange(section)}
                onKeyDown={(event) => moveTab(event, index)}
              >
                {t(`nav.${section}`)}
                <span aria-hidden="true" className="ml-1 inline-block size-1.5 align-middle">
                  {pendingCount > 0 ? (
                    <span
                      className={`block size-1.5 rounded-full ${
                        active ? "bg-accent-ink" : "bg-warning"
                      }`}
                      data-testid={`workspace-tab-pending-indicator-${section}`}
                    />
                  ) : null}
                </span>
                {pendingCount > 0 ? (
                  <span className="sr-only" id={`workspace-tab-pending-${index}`}>
                    {" "}
                    ·{" "}
                    {t(pendingCount === 1 ? "pending.one" : "pending.many", {
                      count: pendingCount,
                    })}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="pt-6">
        <div
          className="min-w-0"
          id="workspace-panel"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`workspace-tab-${SECTIONS.indexOf(activeSection)}`}
        >
          {activeSection === "overview" ? (
            <OverviewView session={session} onNavigate={openSection} />
          ) : null}
          {activeSection === "players" ? (
            <PlayersView
              avatarUrls={avatars.avatarUrls}
              error={players.error}
              loading={players.loading}
              pendingByPlayer={players.pendingByPlayer}
              players={players.players}
              selectedPlayerId={players.selectedPlayerId}
              onHealthChange={players.updateHealth}
              resetVersion={editVersion}
              onRejectAvatar={avatars.rejectAvatar}
              onRetry={players.reload}
              onRevertHealth={players.revertHealth}
              onSelect={(playerId) => {
                players.setSelectedPlayerId(playerId);
                void avatars.loadAvatar(playerId);
              }}
            />
          ) : null}
          {activeSection === "upgrades" ? (
            <UpgradesView
              error={upgrades.error}
              loading={upgrades.loading}
              pendingByUpgrade={upgrades.pendingByUpgrade}
              avatarUrls={avatars.avatarUrls}
              players={players.players}
              selectedPlayerId={players.selectedPlayerId}
              upgrades={upgrades.upgrades}
              onChange={upgrades.update}
              resetVersion={editVersion}
              onRejectAvatar={avatars.rejectAvatar}
              onRetry={() => void upgrades.reload()}
              onRevert={upgrades.revert}
              onSelectPlayer={(playerId) => {
                players.setSelectedPlayerId(playerId);
                void avatars.loadAvatar(playerId);
              }}
            />
          ) : null}
          {activeSection === "run" ? (
            <RunView
              key={`run-${editVersion}`}
              error={run.error}
              loading={run.loading}
              pendingByField={run.pendingByField}
              run={run.run}
              onResumeChange={run.updateResume}
              onRetry={() => void run.reload()}
              onRevert={run.revert}
              onStatChange={run.updateStat}
            />
          ) : null}
          {activeSection === "items" ? (
            <ItemsView
              advanced={items.advanced}
              error={items.error}
              loading={items.loading}
              pendingByItem={items.pendingByItem}
              onRefillAllToFull={items.refillAllToFull}
              onRefillToFull={items.refillToFull}
              onRetry={() => void items.reload()}
              onRevertRefill={items.revertRefill}
            />
          ) : null}
          {activeSection === "maps" ? (
            <MapsView
              artworkAttempt={maps.artworkAttempt}
              discovery={maps.discovery}
              error={maps.error}
              loading={maps.loading}
              onRetry={() => void maps.reload()}
            />
          ) : null}
        </div>
      </div>

      <PendingChangesBar
        backupPath={pendingEdits.length === 0 ? backupPath : null}
        edits={pendingEdits}
        error={saveError}
        saving={saving || postSaveRefreshing}
        onRevert={revertAll}
        onSave={() => void saveAll()}
      />
    </section>
  );
}
