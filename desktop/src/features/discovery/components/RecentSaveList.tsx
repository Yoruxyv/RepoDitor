import { ClockIcon, FileIcon } from "@phosphor-icons/react";

import type { SaveSummary } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { formatDateTime, formatFileSize } from "@/features/discovery/formatters";

interface RecentSaveListProps {
  readonly saves: SaveSummary[];
  readonly openingSaveId: string | null;
  readonly onOpen: (saveId: string) => void;
}

export function RecentSaveList({ saves, openingSaveId, onOpen }: RecentSaveListProps) {
  const { locale, t } = usePreferences();
  const recentSaves = saves.slice(1, 6);

  return (
    <section aria-labelledby="recent-saves-title">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold text-ink" id="recent-saves-title">
          {t("saves.recent")}
        </h2>
        <span className="text-xs text-muted">{t("saves.newestFirst")}</span>
      </div>

      {recentSaves.length === 0 ? (
        <p className="mt-3 border-t border-line py-5 text-sm text-muted">
          {t("saves.noEarlier")}
        </p>
      ) : (
        <ol className="mt-3 border-t border-line">
          {recentSaves.map((save) => (
            <li className="border-b border-line py-4 last:border-b-0" key={save.id}>
              <button
                className="grid w-full gap-3 text-left transition duration-150 hover:text-accent active:translate-y-px disabled:cursor-wait disabled:opacity-60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                disabled={openingSaveId !== null}
                type="button"
                onClick={() => onOpen(save.id)}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <FileIcon
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-muted"
                    size={18}
                    weight="regular"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink" title={save.name}>
                      {save.name}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 pl-7 text-xs text-secondary sm:pl-0">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <ClockIcon aria-hidden="true" size={14} weight="regular" />
                    {formatDateTime(save.modifiedAt, locale)}
                  </span>
                  <span className="min-w-14 text-right font-mono text-muted">
                    {openingSaveId === save.id
                      ? t("saves.opening")
                      : formatFileSize(save.sizeBytes, locale)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
