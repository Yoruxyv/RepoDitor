import { ClockIcon, FileIcon, HardDriveIcon } from "@phosphor-icons/react";

import type { SaveSummary } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { PathDetails } from "@/components/PathDetails";
import {
  formatDateTime,
  formatFileSize,
  formatRelativeTime,
} from "@/features/discovery/formatters";

interface LatestSaveProps {
  readonly save: SaveSummary;
  readonly isDisabled: boolean;
  readonly isOpening: boolean;
  readonly onOpen: (saveId: string) => void;
}

export function LatestSave({ save, isDisabled, isOpening, onOpen }: LatestSaveProps) {
  const { locale, t } = usePreferences();
  return (
    <section aria-labelledby="latest-save-title">
      <h2 className="text-base font-semibold text-ink" id="latest-save-title">
        {t("saves.latest")}
      </h2>

      <div className="mt-3 rounded-sm border border-line bg-surface">
        <button
          className="w-full border-l-2 border-accent p-5 text-left transition duration-150 hover:bg-raised active:translate-y-px disabled:cursor-wait disabled:opacity-70 sm:p-6"
          disabled={isDisabled}
          type="button"
          onClick={() => onOpen(save.id)}
        >
          <div className="flex items-start gap-4">
            <div className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-sm bg-accent-muted text-accent">
              <FileIcon aria-hidden="true" size={21} weight="regular" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-3xl font-semibold uppercase leading-none tracking-[-0.01em] text-ink sm:text-4xl">
                {save.name}
              </p>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-secondary">
                <span className="inline-flex items-center gap-2">
                  <ClockIcon aria-hidden="true" size={15} weight="regular" />
                  <span>{formatRelativeTime(save.modifiedAt, locale, t)}</span>
                </span>
                <span className="inline-flex items-center gap-2">
                  <HardDriveIcon aria-hidden="true" size={15} weight="regular" />
                  <span>{formatFileSize(save.sizeBytes, locale)}</span>
                </span>
              </div>
              <p className="mt-2 text-xs text-muted">{formatDateTime(save.modifiedAt, locale)}</p>
              <p className="mt-4 text-sm font-semibold text-accent">
                {t(isOpening ? "saves.openingSave" : "saves.openWorkspace")}
              </p>
            </div>
          </div>
        </button>

        <div className="border-t border-line px-5 py-3 sm:px-6">
          <PathDetails label={t("workspace.source")} testId="latest-save-path" value={save.path} />
        </div>
      </div>
    </section>
  );
}
