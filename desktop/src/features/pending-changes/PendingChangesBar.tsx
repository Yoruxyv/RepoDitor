import { useEffect, useState } from "react";

import { usePreferences } from "@/app/preferences";
import type { Translate } from "@/app/translations";
import type { PendingEdit } from "@/features/pending-changes/pendingEdits";

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
  if (edit.feature === "cosmetics") {
    return edit.field === "owned" ? edit.subject : t("app.cosmetics");
  }
  return edit.subject;
}

function displayLabel(edit: PendingEdit, t: Translate): string {
  if (edit.feature === "players") return t("pending.health");
  if (edit.feature === "advanced") return t("pending.storedCharge");
  if (edit.feature === "cosmetics") {
    if (edit.field === "clearAll") return t("cosmetics.savedPresets");
    return t(edit.field === "owned" ? "cosmetics.ownershipFilterLabel" : "pending.knownOwnership");
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
      <div aria-hidden="true" className="h-24" />
      <footer
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-app/95 px-5 py-3 text-sm shadow-[0_-8px_24px_var(--theme-overlay)] backdrop-blur-sm sm:px-8"
        data-pending-surface-active="true"
        data-testid={`${testIdPrefix}-action-bar`}
      >
        {saving ? (
          <div
            aria-label={t("status.savingSafely")}
            className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-accent-muted"
            data-testid={`${testIdPrefix}-saving-progress`}
            role="progressbar"
          >
            <span
              aria-hidden="true"
              className="save-progress-indicator block h-full w-1/3 bg-accent"
            />
          </div>
        ) : null}
        <div className="mx-auto w-full max-w-[1280px]">
          {edits.length > 0 ? (
            <section
              aria-label={t("pending.unsaved")}
              className="mb-3 border-b border-line pb-3"
              data-testid={`${testIdPrefix}-review`}
              hidden={!reviewing}
              id={`${testIdPrefix}-review`}
            >
              <ul className="grid max-h-[min(45dvh,24rem)] gap-3 overflow-y-auto overscroll-contain pr-1">
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
            </section>
          ) : null}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <output
                aria-atomic="true"
                aria-live="polite"
                className="block font-semibold text-ink"
                data-testid={`${testIdPrefix}-pending-edit-count`}
              >
                {saving ? t("status.savingSafely") : changeCount(edits.length, t)}
              </output>
              {error ? (
                <p className="mt-2 wrap-break-word text-xs text-danger" role="alert">
                  {error}
                </p>
              ) : null}
              {backupPath ? (
                <output
                  aria-atomic="true"
                  aria-live="polite"
                  className="mt-1 block text-xs text-success"
                >
                  {t("status.savedBackupCreated")}
                </output>
              ) : null}
            </div>
            {edits.length > 0 ? (
              <div className="flex flex-wrap gap-2 md:justify-end">
                <button
                  aria-controls={`${testIdPrefix}-review`}
                  aria-expanded={reviewing}
                  className="ui-feedback rounded-sm border border-control px-3 py-2 font-semibold text-secondary hover:border-accent hover:text-accent aria-expanded:border-accent aria-expanded:text-accent disabled:cursor-not-allowed disabled:opacity-50"
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
        </div>
      </footer>
    </>
  );
}
