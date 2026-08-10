import {
  ArrowLeftIcon,
  FolderOpenIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useState, type KeyboardEvent } from "react";

import type { SaveChange, SaveSession } from "@electron/contracts";
import { AdvancedView } from "@/features/advanced/AdvancedView";
import { useAdvanced } from "@/features/advanced/useAdvanced";
import { CosmeticsView } from "@/features/cosmetics/CosmeticsView";
import { useCosmetics } from "@/features/cosmetics/useCosmetics";
import { formatDateTime } from "@/features/discovery/formatters";
import { MapsView } from "@/features/maps/MapsView";
import { useMaps } from "@/features/maps/useMaps";
import { PlayersView } from "@/features/players/PlayersView";
import { usePlayers } from "@/features/players/usePlayers";
import { RunView } from "@/features/run/RunView";
import { useRunState } from "@/features/run/useRunState";
import { UpgradesView } from "@/features/upgrades/UpgradesView";
import { useUpgrades } from "@/features/upgrades/useUpgrades";
import { OverviewView } from "@/features/editor/OverviewView";
import { PendingChangesBar } from "@/features/editor/PendingChangesBar";
import {
  toSaveChange,
  type PendingEdit,
  type RunSavePendingEdit,
} from "@/features/editor/pendingEdits";

const SECTIONS = ["Overview", "Players", "Upgrades", "Run", "Items", "Cosmetics", "Maps"] as const;
type WorkspaceSection = (typeof SECTIONS)[number];

interface WorkspaceProps {
  readonly session: SaveSession;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly backupPath: string | null;
  readonly onClose: () => void;
  readonly onSave: (changes: SaveChange[]) => Promise<boolean>;
}

export function Workspace({
  session,
  saving,
  saveError,
  backupPath,
  onClose,
  onSave,
}: WorkspaceProps) {
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("Overview");
  const [editVersion, setEditVersion] = useState(0);
  const players = usePlayers(session.id);
  const upgrades = useUpgrades(session.id);
  const run = useRunState(session.id);
  const advanced = useAdvanced(session.id);
  const cosmetics = useCosmetics(session.id);
  const maps = useMaps();
  const runSavePendingEdits: RunSavePendingEdit[] = [
    ...players.pendingEdits,
    ...upgrades.pendingEdits,
    ...run.pendingEdits,
    ...advanced.pendingEdits,
  ];
  const pendingEdits: PendingEdit[] = [
    ...runSavePendingEdits,
    ...cosmetics.pendingEdits,
  ];

  function revertAll(): void {
    players.revertAll();
    upgrades.revertAll();
    run.revertAll();
    advanced.revertAll();
    cosmetics.revertAll();
    setEditVersion((current) => current + 1);
  }

  async function saveAll(): Promise<void> {
    if (cosmetics.pendingEdits.length > 0 && !(await cosmetics.save())) return;
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

  return (
    <section aria-labelledby="workspace-title" data-testid="workspace">
      <header className="grid gap-5 border-b border-line pb-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Selected save</p>
          <h1 className="font-display mt-3 truncate text-5xl font-semibold uppercase leading-[0.9] tracking-[-0.02em] text-ink sm:text-6xl" id="workspace-title" title={session.name}>
            {session.name}
          </h1>
          <p className="mt-4 text-sm text-secondary">Opened {formatDateTime(session.modifiedAt)}</p>
        </div>
        <button
          className="inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-sm border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition duration-150 hover:border-accent hover:text-accent active:translate-y-px"
          type="button"
          onClick={onClose}
        >
          <ArrowLeftIcon aria-hidden="true" size={17} weight="bold" />
          Change save
        </button>
      </header>

      <nav className="overflow-x-auto border-b border-line" aria-label="Workspace sections">
        <div className="flex min-w-max gap-1 py-2" role="tablist">
          {SECTIONS.map((section, index) => {
            const active = activeSection === section;
            return (
              <button
                aria-controls="workspace-panel"
                aria-selected={active}
                className={`rounded-sm px-4 py-2.5 text-sm font-semibold transition duration-150 active:translate-y-px ${
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
                {section}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="grid gap-8 pt-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-10">
        <div className="min-w-0" id="workspace-panel" role="tabpanel" tabIndex={0} aria-labelledby={`workspace-tab-${SECTIONS.indexOf(activeSection)}`}>
          {activeSection === "Overview" ? <OverviewView session={session} /> : null}
          {activeSection === "Players" ? (
            <PlayersView
              key={`players-${editVersion}`}
              avatarUrls={players.avatarUrls}
              error={players.error}
              loading={players.loading}
              pendingByPlayer={players.pendingByPlayer}
              players={players.players}
              selectedPlayerId={players.selectedPlayerId}
              onHealthChange={players.updateHealth}
              onLoadAvatar={(playerId) => void players.loadAvatar(playerId)}
              onRejectAvatar={players.rejectAvatar}
              onRetry={players.reload}
              onRevertHealth={players.revertHealth}
              onSelect={players.setSelectedPlayerId}
            />
          ) : null}
          {activeSection === "Upgrades" ? (
            <UpgradesView
              key={`upgrades-${editVersion}`}
              error={upgrades.error}
              loading={upgrades.loading}
              pendingByUpgrade={upgrades.pendingByUpgrade}
              players={players.players}
              selectedPlayerId={players.selectedPlayerId}
              upgrades={upgrades.upgrades}
              onChange={upgrades.update}
              onRetry={() => void upgrades.reload()}
              onRevert={upgrades.revert}
              onSelectPlayer={players.setSelectedPlayerId}
            />
          ) : null}
          {activeSection === "Run" ? (
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
          {activeSection === "Items" ? (
            <AdvancedView
              advanced={advanced.advanced}
              error={advanced.error}
              loading={advanced.loading}
              pendingByItem={advanced.pendingByItem}
              onRefillToFull={advanced.refillToFull}
              onRetry={() => void advanced.reload()}
              onRevertRefill={advanced.revertRefill}
            />
          ) : null}
          {activeSection === "Cosmetics" ? (
            <CosmeticsView
              cosmetics={cosmetics.cosmetics}
              error={cosmetics.loadError}
              knownLockedCount={cosmetics.knownLockedCount}
              knownOwnedCount={cosmetics.knownOwnedCount}
              loading={cosmetics.loading}
              pendingById={cosmetics.pendingById}
              unlockAllPending={cosmetics.unlockAllPending !== null}
              view={cosmetics.view}
              onOwnedChange={cosmetics.setOwned}
              onRetry={() => void cosmetics.reload()}
              onRevert={cosmetics.revert}
              onUnlockAll={cosmetics.unlockAll}
            />
          ) : null}
          {activeSection === "Maps" ? (
            <MapsView
              discovery={maps.discovery}
              error={maps.error}
              loading={maps.loading}
              onRetry={() => void maps.reload()}
            />
          ) : null}
        </div>

        <aside className="min-w-0 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0" data-testid="workspace-context" aria-label="Save context">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FolderOpenIcon aria-hidden="true" className="text-accent" size={18} />
            Source
          </div>
          <p className="mt-3 break-all font-mono text-[0.7rem]/5 text-muted" title={session.path}>
            {session.path}
          </p>
          <div className="mt-6 flex items-start gap-2 border-t border-line pt-5 text-xs/5 text-secondary">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 shrink-0 text-success" size={17} />
            <p>Validated locally. Raw decrypted data stays behind the Python boundary.</p>
          </div>
        </aside>
      </div>

      <PendingChangesBar
        backupPath={pendingEdits.length === 0 ? (backupPath ?? cosmetics.backupPath) : null}
        edits={pendingEdits}
        error={saveError ?? cosmetics.writeError}
        saving={saving || cosmetics.saving}
        onRevert={revertAll}
        onSave={() => void saveAll()}
      />
    </section>
  );
}
