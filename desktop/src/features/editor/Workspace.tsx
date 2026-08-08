import {
  ArrowLeftIcon,
  FolderOpenIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useState, type KeyboardEvent } from "react";

import type { SaveSession } from "@electron/contracts";
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
import type { PendingEdit } from "@/features/editor/pendingEdits";

const SECTIONS = ["Overview", "Players", "Upgrades", "Run", "Maps"] as const;
type WorkspaceSection = (typeof SECTIONS)[number];

interface WorkspaceProps {
  readonly session: SaveSession;
  readonly onClose: () => void;
}

function formatPendingEditCount(count: number): string {
  if (count === 0) {
    return "No pending changes";
  }
  if (count === 1) {
    return "1 pending change";
  }
  return `${count} pending changes`;
}

export function Workspace({ session, onClose }: WorkspaceProps) {
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("Overview");
  const players = usePlayers(session.id);
  const upgrades = useUpgrades(session.id);
  const run = useRunState(session.id);
  const maps = useMaps();
  const pendingEdits: PendingEdit[] = [
    ...players.pendingEdits,
    ...upgrades.pendingEdits,
    ...run.pendingEdits,
  ];

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

      <footer className="mt-10 flex flex-col gap-3 border-t border-line pt-5 text-sm sm:flex-row sm:items-center sm:justify-between" data-testid="workspace-action-bar">
        <div>
          <p className="font-semibold text-ink">In-memory working copy</p>
          <p className="mt-1 text-xs text-muted" data-testid="pending-edit-count">
            {formatPendingEditCount(pendingEdits.length)}
          </p>
        </div>
        <p className="text-xs text-secondary">Nothing in this workspace is written to disk.</p>
      </footer>
    </section>
  );
}
