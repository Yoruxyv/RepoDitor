import type { PendingEdit } from "@/features/editor/pendingEdits";

interface PendingChangesBarProps {
  readonly edits: PendingEdit[];
  readonly saving: boolean;
  readonly error: string | null;
  readonly backupPath: string | null;
  readonly onRevert: () => void;
  readonly onSave: () => void;
}

function changeCount(count: number): string {
  if (count === 0) return "No pending changes";
  return `${count} pending change${count === 1 ? "" : "s"}`;
}

function displayValue(edit: PendingEdit, value: PendingEdit["before"] | PendingEdit["after"]): string {
  if (edit.feature === "advanced" && value === true) return "Full / Default";
  if (edit.feature === "cosmetics" && edit.field === "unlockAll" && value === true) {
    return "All known";
  }
  if (edit.feature === "cosmetics" && typeof value === "boolean") {
    return value ? "Owned" : "Locked";
  }
  return String(value);
}

export function PendingChangesBar({
  edits,
  saving,
  error,
  backupPath,
  onRevert,
  onSave,
}: PendingChangesBarProps) {
  return (
    <footer
      className="mt-10 grid gap-5 border-t border-line pt-5 text-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
      data-testid="workspace-action-bar"
    >
      <div className="min-w-0">
        <p className="font-semibold text-ink" data-testid="pending-edit-count">
          {changeCount(edits.length)}
        </p>
        {edits.length > 0 ? (
          <ul className="mt-3 grid max-h-40 gap-2 overflow-y-auto pr-2" aria-label="Unsaved changes">
            {edits.map((edit) => (
              <li
                className="grid min-w-0 gap-1 border-l-2 border-accent pl-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-4"
                key={`${edit.feature}:${edit.entity}:${edit.field}`}
              >
                <span className="min-w-0 wrap-break-word text-secondary">
                  {edit.subject} · {edit.label}
                </span>
                <span className="break-all font-mono text-xs text-ink">
                  {displayValue(edit, edit.before)} → {displayValue(edit, edit.after)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p className="mt-3 text-xs text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {backupPath ? (
          <output className="mt-3 block break-all text-xs text-success">
            Saved safely. Backup: <span className="font-mono">{backupPath}</span>
          </output>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3 md:justify-end">
        <button
          className="rounded-sm border border-line-strong px-4 py-2.5 font-semibold text-secondary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={edits.length === 0 || saving}
          type="button"
          onClick={onRevert}
        >
          Revert all
        </button>
        <button
          className="rounded-sm bg-accent px-4 py-2.5 font-semibold text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={edits.length === 0 || saving}
          type="button"
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </footer>
  );
}
