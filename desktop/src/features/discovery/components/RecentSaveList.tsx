import { Clock, File } from "@phosphor-icons/react";

import type { SaveSummary } from "../../../../electron/contracts.cts";
import { formatDateTime, formatFileSize } from "../formatters";

interface RecentSaveListProps {
  saves: SaveSummary[];
  openingSaveId: string | null;
  onOpen: (saveId: string) => void;
}

export function RecentSaveList({ saves, openingSaveId, onOpen }: RecentSaveListProps) {
  const recentSaves = saves.slice(1, 6);

  return (
    <section aria-labelledby="recent-saves-title">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold text-ink" id="recent-saves-title">
          Recent saves
        </h2>
        <span className="text-xs text-muted">Newest first</span>
      </div>

      {recentSaves.length === 0 ? (
        <p className="mt-3 border-t border-line py-5 text-sm text-muted">
          No earlier saves were found in this folder.
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
                  <File
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-muted"
                    size={18}
                    weight="regular"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink" title={save.name}>
                      {save.name}
                    </p>
                    <p className="mt-1 truncate font-mono text-[0.68rem] leading-5 text-muted" title={save.path}>
                      {save.path}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 pl-7 text-xs text-secondary sm:pl-0">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Clock aria-hidden="true" size={14} weight="regular" />
                    {formatDateTime(save.modifiedAt)}
                  </span>
                  <span className="min-w-14 text-right font-mono text-muted">
                    {openingSaveId === save.id ? "Opening" : formatFileSize(save.sizeBytes)}
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
