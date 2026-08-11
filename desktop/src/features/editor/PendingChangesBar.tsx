import { useEffect, useState } from "react";

import { usePreferences } from "@/app/preferences";
import type { Translate } from "@/app/translations";
import { PathDetails } from "@/components/PathDetails";
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
  const [reviewing, setReviewing] = useState(false);
  const visible = edits.length > 0 || saving || error !== null || backupPath !== null;

  useEffect(() => {
    if (edits.length === 0) setReviewing(false);
  }, [edits.length]);

  if (!visible) {
    return (
      <output className="sr-only" data-testid={`${testIdPrefix}-pending-edit-count`}>
        {changeCount(0, t)}
      </output>
    );
  }

  return (
    <>
      <div aria-hidden="true" className={reviewing ? "h-72" : "h-24"} />
      <footer
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-app/95 px-5 py-3 text-sm shadow-[0_-8px_24px_var(--theme-overlay)] backdrop-blur-sm sm:px-8"
        data-pending-review={reviewing || undefined}
        data-pending-surface-active="true"
        data-testid={`${testIdPrefix}-action-bar`}
      >
        <div className="mx-auto grid w-full max-w-[1280px] gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0">
            <output
              aria-atomic="true"
              aria-live="polite"
              className="block font-semibold text-ink"
              data-testid={`${testIdPrefix}-pending-edit-count`}
            >
              {saving ? t("status.savingSafely") : changeCount(edits.length, t)}
            </output>
            {edits.length > 0 ? (
              <ul
                aria-label={t("pending.unsaved")}
                className="mt-3 grid max-h-40 gap-2 overflow-y-auto pr-2"
                hidden={!reviewing}
              >
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
            {error ? (
              <p className="mt-2 text-xs text-danger" role="alert">
                {error}
              </p>
            ) : null}
            {backupPath ? (
              <div className="mt-1 text-xs text-success">
                <output aria-atomic="true" aria-live="polite">
                  {t("status.savedBackupCreated")}
                </output>
                <PathDetails
                  className="ml-2 inline-block text-secondary"
                  label={t("pending.backupDetails")}
                  value={backupPath}
                />
              </div>
            ) : null}
          </div>
          {edits.length > 0 ? (
            <div className="flex flex-wrap gap-2 md:justify-end">
              <button
                aria-expanded={reviewing}
                className="ui-feedback rounded-sm border border-control px-3 py-2 font-semibold text-secondary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={saving}
                type="button"
                onClick={() => setReviewing((current) => !current)}
              >
                {t("action.review")}
              </button>
              <button
                className="ui-feedback rounded-sm border border-control px-3 py-2 font-semibold text-secondary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                disabled={saving}
                type="button"
                onClick={onRevert}
              >
                {t("action.revertAll")}
              </button>
              <button
                className="ui-feedback rounded-sm bg-accent px-3 py-2 font-semibold text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={saving}
                type="button"
                onClick={onSave}
              >
                {t(saving ? "action.saving" : "action.saveChanges")}
              </button>
            </div>
          ) : null}
        </div>
      </footer>
    </>
  );
}
