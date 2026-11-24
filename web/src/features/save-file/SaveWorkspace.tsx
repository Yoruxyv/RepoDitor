import { CheckCircleIcon, FileArrowUpIcon, XIcon } from "@phosphor-icons/react";
import type { ChangeEvent } from "react";

import { useI18n } from "@/app/i18n/context";
import { CosmeticsEditor } from "@/features/cosmetics/CosmeticsEditor";
import { getCosmeticPendingEdits } from "@/features/cosmetics/pendingEdits";
import {
  PendingChangesBar,
  type WorkspaceExportState,
} from "@/features/save-file/PendingChangesBar";
import type { EditSession } from "@/features/save-file/session";
import { getRunPendingEdits } from "@/features/run-save/pendingEdits";
import { RunEditor } from "@/features/run-save/RunEditor";

interface SaveWorkspaceProps {
  readonly busy: boolean;
  readonly exportState: WorkspaceExportState;
  readonly onClear: () => void;
  readonly onDownload: () => void;
  readonly onReset: () => void;
  readonly onSelectFile: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onSessionChange: (session: EditSession) => void;
  readonly session: EditSession;
}

export function SaveWorkspace({
  busy,
  exportState,
  onClear,
  onDownload,
  onReset,
  onSelectFile,
  onSessionChange,
  session,
}: SaveWorkspaceProps) {
  const { formatNumber, t } = useI18n();
  const edits =
    session.originalKind === "run"
      ? getRunPendingEdits(session, t, formatNumber)
      : getCosmeticPendingEdits(session, t, formatNumber);
  const saveKind = session.originalKind === "run" ? t("save.workspace.runSave") : "MetaSave";

  return (
    <section
      aria-busy={exportState.status === "preparing"}
      aria-labelledby="workspace-title"
      className="min-w-0 pb-4"
      data-testid="save-workspace"
    >
      <header className="grid gap-4 border-b border-line pb-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            {t("save.workspace.selected")}
          </p>
          <h1
            className="font-display mt-1 truncate text-4xl font-semibold uppercase leading-none tracking-[-0.02em] text-ink"
            id="workspace-title"
            title={session.originalFileName}
          >
            {session.originalFileName}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-secondary">
            <span>{saveKind}</span>
            <span className="inline-flex items-center gap-1.5 text-accent">
              <CheckCircleIcon aria-hidden="true" size={15} />
              {t("save.workspace.validated")}
            </span>
          </div>
          <p className="mt-2 text-xs/5 text-secondary">{t("save.workspace.compatibility")}</p>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <label className="relative inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-sm border border-control bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
            <input
              accept=".es3"
              className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait"
              disabled={busy}
              onChange={onSelectFile}
              type="file"
            />
            <FileArrowUpIcon aria-hidden="true" size={17} />
            {t("save.workspace.changeFile")}
          </label>
          <button
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-sm border border-control px-3 py-2.5 text-sm font-semibold text-secondary transition-colors hover:border-accent hover:text-ink disabled:cursor-wait disabled:opacity-60"
            disabled={busy}
            onClick={onClear}
            type="button"
          >
            <XIcon aria-hidden="true" size={17} />
            {t("save.workspace.clear")}
          </button>
        </div>
      </header>

      {session.originalKind === "run" ? (
        <RunEditor busy={busy} onSessionChange={onSessionChange} session={session} />
      ) : (
        <CosmeticsEditor busy={busy} onSessionChange={onSessionChange} session={session} />
      )}

      <PendingChangesBar
        busy={busy}
        edits={edits}
        exportState={exportState}
        onDownload={onDownload}
        onReset={onReset}
      />
    </section>
  );
}
