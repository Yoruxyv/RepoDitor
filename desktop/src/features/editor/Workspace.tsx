import {
  ArrowLeftIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useEffect, useState, type KeyboardEvent } from "react";

import type { AssetPreparationState, SaveChange, SaveSession } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import {
  AssetPreparationNotice,
  AssetPreparationView,
} from "@/features/assets/AssetPreparationView";
import { PathDetails } from "@/components/PathDetails";
import { ItemsView } from "@/features/items/ItemsView";
import { useItems } from "@/features/items/useItems";
import { formatDateTime } from "@/features/discovery/formatters";
import { MapsView } from "@/features/maps/MapsView";
import { useMaps } from "@/features/maps/useMaps";
import { PlayersView } from "@/features/players/PlayersView";
import { usePlayers } from "@/features/players/usePlayers";
import { RunView } from "@/features/run/RunView";
import { useRunState } from "@/features/run/useRunState";
import { UpgradesView } from "@/features/upgrades/UpgradesView";
import { useUpgrades } from "@/features/upgrades/useUpgrades";
import {
  OverviewView,
  type OverviewDestination,
} from "@/features/editor/OverviewView";
import { PendingChangesBar } from "@/features/editor/PendingChangesBar";
import {
  toSaveChange,
  type RunSavePendingEdit,
} from "@/features/editor/pendingEdits";

const SECTIONS = ["overview", "players", "upgrades", "run", "items", "maps"] as const;
type WorkspaceSection = (typeof SECTIONS)[number];

interface WorkspaceProps {
  readonly assetState: AssetPreparationState;
  readonly session: SaveSession;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly backupPath: string | null;
  readonly onPendingCountChange: (count: number) => void;
  readonly onClose: () => void;
  readonly onSave: (changes: SaveChange[]) => Promise<boolean>;
}

export function Workspace({
  assetState,
  session,
  saving,
  saveError,
  backupPath,
  onPendingCountChange,
  onClose,
  onSave,
}: WorkspaceProps) {
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("overview");
  const [continueWithoutArtwork, setContinueWithoutArtwork] = useState(false);
  const { locale, t } = usePreferences();
  const [editVersion, setEditVersion] = useState(0);
  const players = usePlayers(session.id);
  const upgrades = useUpgrades(session.id);
  const run = useRunState(session.id);
  const items = useItems(session.id);
  const maps = useMaps();
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

  if (!continueWithoutArtwork && (upgrades.loading || assetPreparationActive)) {
    return (
      <AssetPreparationView
        state={assetState}
        waitingForUpgradeDiscovery={upgrades.loading && !assetPreparationActive}
        onContinue={() => setContinueWithoutArtwork(true)}
      />
    );
  }

  function revertAll(): void {
    players.revertAll();
    upgrades.revertAll();
    run.revertAll();
    items.revertAll();
    setEditVersion((current) => current + 1);
  }

  async function saveAll(): Promise<void> {
    if (runSavePendingEdits.length > 0) {
      await onSave(runSavePendingEdits.map(toSaveChange));
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
    setActiveSection(SECTIONS[nextIndex]!);
    document.getElementById(`workspace-tab-${nextIndex}`)?.focus();
  }

  function openSection(section: OverviewDestination): void {
    setActiveSection(section);
    requestAnimationFrame(() => {
      document.getElementById(`workspace-tab-${SECTIONS.indexOf(section)}`)?.focus();
    });
  }

  return (
    <section aria-labelledby="workspace-title" className="pb-4" data-testid="workspace">
      {assetState.degraded || (continueWithoutArtwork && assetPreparationActive) ? (
        <AssetPreparationNotice
          state={assetState}
          showPreparing={continueWithoutArtwork && assetPreparationActive}
        />
      ) : null}
      <header className="grid gap-4 border-b border-line pb-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{t("workspace.selectedSave")}</p>
          <h1 className="font-display mt-1 truncate text-4xl font-semibold uppercase leading-none tracking-[-0.02em] text-ink" id="workspace-title" title={session.name}>
            {session.name}
          </h1>
          <div
            className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-secondary"
            data-testid="selected-save-metadata"
          >
            <span>{t("workspace.modified", { date: formatDateTime(session.modifiedAt, locale) })}</span>
            <span className="inline-flex items-center gap-1.5 text-success">
              <ShieldCheckIcon aria-hidden="true" size={15} />
              {t("workspace.validatedShort")}
            </span>
          </div>
          <PathDetails
            className="mt-2 max-w-full"
            label={t("workspace.source")}
            testId="selected-save-path"
            value={session.path}
          />
        </div>
        <button
          className="ui-feedback inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-sm border border-control bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          type="button"
          onClick={onClose}
        >
          <ArrowLeftIcon aria-hidden="true" size={17} weight="bold" />
          {t("action.changeSave")}
        </button>
      </header>

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
                className={`ui-feedback rounded-sm px-4 py-2.5 text-sm font-semibold ${
                  active ? "bg-accent text-accent-ink" : "text-secondary hover:bg-surface hover:text-ink"
                }`}
                id={`workspace-tab-${index}`}
                key={section}
                role="tab"
                tabIndex={active ? 0 : -1}
                type="button"
                onClick={() => setActiveSection(section)}
                onKeyDown={(event) => moveTab(event, index)}
              >
                {t(`nav.${section}`)}
                {pendingCount > 0 ? (
                  <>
                    <span aria-hidden="true" className="ml-2 inline-block size-1.5 rounded-full bg-warning" />
                    <span className="sr-only" id={`workspace-tab-pending-${index}`}> · {t(pendingCount === 1 ? "pending.one" : "pending.many", { count: pendingCount })}</span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="pt-6">
        <div className="min-w-0" id="workspace-panel" role="tabpanel" tabIndex={0} aria-labelledby={`workspace-tab-${SECTIONS.indexOf(activeSection)}`}>
          {activeSection === "overview" ? (
            <OverviewView session={session} onNavigate={openSection} />
          ) : null}
          {activeSection === "players" ? (
            <PlayersView
              key={`players-${editVersion}`}
              avatarUrls={players.avatarUrls}
              error={players.error}
              loading={players.loading}
              pendingByPlayer={players.pendingByPlayer}
              players={players.players}
              selectedPlayerId={players.selectedPlayerId}
              onHealthChange={players.updateHealth}
              onRejectAvatar={players.rejectAvatar}
              onRetry={players.reload}
              onRevertHealth={players.revertHealth}
              onSelect={players.setSelectedPlayerId}
            />
          ) : null}
          {activeSection === "upgrades" ? (
            <UpgradesView
              key={`upgrades-${editVersion}`}
              error={upgrades.error}
              loading={upgrades.loading}
              pendingByUpgrade={upgrades.pendingByUpgrade}
              avatarUrls={players.avatarUrls}
              players={players.players}
              selectedPlayerId={players.selectedPlayerId}
              upgrades={upgrades.upgrades}
              onChange={upgrades.update}
              onRejectAvatar={players.rejectAvatar}
              onRetry={() => void upgrades.reload()}
              onRevert={upgrades.revert}
              onSelectPlayer={players.setSelectedPlayerId}
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
        saving={saving}
        onRevert={revertAll}
        onSave={() => void saveAll()}
      />
    </section>
  );
}
