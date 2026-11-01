import { ArrowCounterClockwiseIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { useI18n } from "@/app/i18n/context";
import type { PendingEdit } from "@/features/save-file/pendingEdits";

export type WorkspaceExportState =
  | { readonly status: "idle" }
  | { readonly status: "preparing" }
  | { readonly status: "error" }
  | { readonly fileName: string; readonly status: "success" };

interface PendingChangesBarProps {
  readonly busy: boolean;
  readonly edits: readonly PendingEdit[];
  readonly exportState: WorkspaceExportState;
  readonly onDownload: () => void;
  readonly onReset: () => void;
}

function ExportFeedback({ state }: { readonly state: WorkspaceExportState }) {
  const { t } = useI18n();
  if (state.status === "idle") {
    return null;
  }
  if (state.status === "preparing") {
    return (
      <output aria-live="polite" className="text-xs/5 text-secondary">
        {t("save.pending.encrypting")}
      </output>
    );
  }
  return (
    <output
      aria-live={state.status === "error" ? "assertive" : "polite"}
      className="text-xs/5 text-secondary"
    >
      {state.status === "success"
        ? t("save.pending.exportSuccess", { fileName: state.fileName })
        : t("save.pending.exportError")}
    </output>
  );
}

export function PendingChangesBar({
  busy,
  edits,
  exportState,
  onDownload,
  onReset,
}: PendingChangesBarProps) {
  const [reviewing, setReviewing] = useState(false);
  const { formatNumber, t } = useI18n();

  useEffect(() => {
    if (edits.length === 0) {
      setReviewing(false);
    }
  }, [edits.length]);

  return (
    <footer className="mt-8 py-3">
      {edits.length > 0 ? (
        <section
          aria-label={t("save.pending.reviewLabel")}
          className="mb-3 border-b border-line pb-3"
          data-testid="pending-changes-review"
          hidden={!reviewing}
          id="pending-changes-review"
        >
          <ul className="grid gap-3">
            {edits.map((edit) => (
              <li
                className="grid min-w-0 gap-1 border-l-2 border-accent pl-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-4"
                key={edit.id}
              >
                <span className="min-w-0 wrap-break-word text-secondary">
                  {edit.subject} · {edit.field}
                </span>
                <span className="break-all font-mono text-xs text-ink">
                  {typeof edit.before === "number" ? formatNumber(edit.before) : edit.before} →{" "}
                  {typeof edit.after === "number" ? formatNumber(edit.after) : edit.after}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <output
            aria-atomic="true"
            aria-live="polite"
            className={`block text-sm font-semibold ${edits.length > 0 ? "text-accent" : "text-ink"}`}
            data-testid="pending-change-count"
          >
            {edits.length === 0
              ? t("save.pending.clean")
              : t("save.pending.count", { count: edits.length }, edits.length)}
          </output>
          <ExportFeedback state={exportState} />
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row md:justify-end">
          {edits.length > 0 ? (
            <button
              aria-controls="pending-changes-review"
              aria-expanded={reviewing}
              className="rounded-sm border border-control px-3 py-2.5 text-sm font-semibold text-secondary transition-colors hover:border-accent hover:text-accent aria-expanded:border-accent aria-expanded:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              type="button"
              onClick={() => setReviewing((current) => !current)}
            >
              {t("save.pending.review")}
            </button>
          ) : null}
          <button
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-control px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || edits.length === 0}
            onClick={onReset}
            type="button"
          >
            <ArrowCounterClockwiseIcon aria-hidden="true" size={18} />
            {t("save.pending.discard")}
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink transition-colors hover:bg-focus disabled:cursor-wait disabled:opacity-60"
            disabled={busy}
            onClick={onDownload}
            type="button"
          >
            <DownloadSimpleIcon aria-hidden="true" size={18} weight="bold" />
            {exportState.status === "preparing"
              ? t("save.pending.preparing")
              : t("save.pending.download")}
          </button>
        </div>
      </div>
    </footer>
  );
}
