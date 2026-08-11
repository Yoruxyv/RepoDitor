import { usePreferences } from "@/app/preferences";
import type { Translate } from "@/app/translations";
import type { PendingEdit } from "@/features/editor/pendingEdits";

interface PendingChangesBarProps {
  readonly edits: PendingEdit[];
  readonly saving: boolean;
  readonly error: string | null;
  readonly backupPath: string | null;
  readonly onRevert: () => void;
  readonly onSave: () => void;
  readonly testIdPrefix?: string;
}

function changeCount(count: number, t: Translate): string {
  if (count === 0) return t("pending.none");
  return t(count === 1 ? "pending.one" : "pending.many", { count });
}

function displayValue(
  edit: PendingEdit,
  value: PendingEdit["before"] | PendingEdit["after"],
  t: Translate,
): string {
  if (edit.feature === "advanced" && value === true) return t("status.fullDefault");
  if (edit.feature === "cosmetics" && edit.field === "unlockAll" && value === true) {
    return t("pending.allKnown");
  }
  if (edit.feature === "cosmetics" && edit.field === "clearAll" && value === true) return "0";
  if (edit.feature === "cosmetics" && typeof value === "boolean") {
    return value ? t("pending.owned") : t("pending.locked");
  }
  return String(value);
}

function displaySubject(edit: PendingEdit, t: Translate): string {
  if (edit.feature === "run") return t("nav.run");
  if (edit.feature === "cosmetics") return t("app.cosmetics");
  return edit.subject;
}

function displayLabel(edit: PendingEdit, t: Translate): string {
  if (edit.feature === "players") return t("pending.health");
  if (edit.feature === "advanced") return t("pending.storedCharge");
  if (edit.feature === "cosmetics") {
    return t(edit.field === "clearAll" ? "cosmetics.savedPresets" : "pending.knownOwnership");
  }
  if (edit.feature === "run") {
    const keys = {
      level: "overview.level",
      currency: "overview.currency",
      lives: "run.lives",
      totalHaul: "run.totalHaul",
      resumeLocation: "run.resumeLocation",
    } as const;
    return t(keys[edit.field]);
  }
  return edit.label;
}

export function PendingChangesBar({
  edits,
  saving,
  error,
  backupPath,
  onRevert,
  onSave,
  testIdPrefix = "workspace",
}: PendingChangesBarProps) {
  const { t } = usePreferences();
  return (
    <footer
      className="mt-10 grid gap-5 border-t border-line pt-5 text-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
      data-testid={`${testIdPrefix}-action-bar`}
    >
      <div className="min-w-0">
        <p className="font-semibold text-ink" data-testid={`${testIdPrefix}-pending-edit-count`}>
          {changeCount(edits.length, t)}
        </p>
        {edits.length > 0 ? (
          <ul className="mt-3 grid max-h-40 gap-2 overflow-y-auto pr-2" aria-label={t("pending.unsaved")}>
            {edits.map((edit) => (
              <li
                className="grid min-w-0 gap-1 border-l-2 border-accent pl-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-4"
                key={`${edit.feature}:${edit.entity}:${edit.field}`}
              >
                <span className="min-w-0 wrap-break-word text-secondary">
                  {displaySubject(edit, t)} · {displayLabel(edit, t)}
                </span>
                <span className="break-all font-mono text-xs text-ink">
                  {displayValue(edit, edit.before, t)} → {displayValue(edit, edit.after, t)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="mt-3 text-xs text-danger" role="alert">{error}</p> : null}
        {backupPath ? (
          <output className="mt-3 block break-all text-xs text-success">
            {t("status.savedSafely")} <span className="font-mono">{backupPath}</span>
          </output>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3 md:justify-end">
        <button
          className="ui-feedback rounded-sm border border-line-strong px-4 py-2.5 font-semibold text-secondary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={edits.length === 0 || saving}
          type="button"
          onClick={onRevert}
        >
          {t("action.revertAll")}
        </button>
        <button
          className="ui-feedback rounded-sm bg-accent px-4 py-2.5 font-semibold text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={edits.length === 0 || saving}
          type="button"
          onClick={onSave}
        >
          {t(saving ? "action.saving" : "action.saveChanges")}
        </button>
      </div>
    </footer>
  );
}
