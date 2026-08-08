import {
  ArrowLeftIcon,
  CheckCircleIcon,
  FolderOpenIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useState, type KeyboardEvent } from "react";

import type { SaveSession } from "@electron/contracts";
import { formatDateTime } from "@/features/discovery/formatters";

const SECTIONS = ["Overview", "Players", "Upgrades", "Run", "Maps"] as const;
type WorkspaceSection = (typeof SECTIONS)[number];

interface WorkspaceProps {
  readonly session: SaveSession;
  readonly onClose: () => void;
}

function Overview({ session }: { readonly session: SaveSession }) {
  const metrics = [
    ["Level", session.level],
    ["Currency", session.currency.toLocaleString()],
    ["Players", session.playerCount],
    ["Resume at", session.resumeLocation],
  ];

  return (
    <div>
      <dl className="grid grid-cols-2 border-y border-line xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div className="min-w-0 px-4 py-5 first:pl-0 xl:border-r xl:border-line xl:last:border-r-0" key={label}>
            <dt className="text-xs font-medium text-muted">{label}</dt>
            <dd className="mt-2 truncate font-mono text-xl font-semibold text-ink" title={String(value)}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <section className="mt-8" aria-labelledby="session-ready-title">
        <CheckCircleIcon aria-hidden="true" className="text-success" size={27} weight="regular" />
        <h2 className="mt-4 text-xl font-semibold text-ink" id="session-ready-title">
          Save opened safely
        </h2>
        <p className="mt-2 max-w-[60ch] text-sm/6 text-secondary">
          Python decrypted and validated this save. This workspace is read-only in Phase 5.
        </p>
      </section>
    </div>
  );
}

function Placeholder({ section }: { readonly section: Exclude<WorkspaceSection, "Overview"> }) {
  return (
    <section aria-labelledby="placeholder-title">
      <h2 className="text-2xl font-semibold text-ink" id="placeholder-title">
        {section}
      </h2>
      <p className="mt-3 max-w-[58ch] text-sm/6 text-secondary">
        This section is reserved for a later phase. No save data can be changed here yet.
      </p>
    </section>
  );
}

export function Workspace({ session, onClose }: WorkspaceProps) {
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("Overview");

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
          {activeSection === "Overview" ? <Overview session={session} /> : <Placeholder section={activeSection} />}
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
          <p className="font-semibold text-ink">Read-only session</p>
          <p className="mt-1 text-xs text-muted">No pending changes</p>
        </div>
        <p className="text-xs text-secondary">Editing and save actions begin in a later phase.</p>
      </footer>
    </section>
  );
}
