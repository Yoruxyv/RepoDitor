import { Clock, File, HardDrive } from "@phosphor-icons/react";

import type { SaveSummary } from "../../../../electron/contracts.cts";
import {
  formatDateTime,
  formatFileSize,
  formatRelativeTime,
} from "../utils/formatters";

interface LatestSaveProps {
  save: SaveSummary;
}

export function LatestSave({ save }: LatestSaveProps) {
  return (
    <section aria-labelledby="latest-save-title">
      <h2 className="text-base font-semibold text-ink" id="latest-save-title">
        Latest save
      </h2>

      <div className="mt-3 rounded-sm border border-line bg-surface">
        <div className="border-l-2 border-accent p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-sm bg-accent-muted text-accent">
              <File aria-hidden="true" size={21} weight="regular" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-3xl font-semibold uppercase leading-none tracking-[-0.01em] text-ink sm:text-4xl">
                {save.name}
              </p>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-secondary">
                <span className="inline-flex items-center gap-2">
                  <Clock aria-hidden="true" size={15} weight="regular" />
                  <span>{formatRelativeTime(save.modifiedAt)}</span>
                </span>
                <span className="inline-flex items-center gap-2">
                  <HardDrive aria-hidden="true" size={15} weight="regular" />
                  <span>{formatFileSize(save.sizeBytes)}</span>
                </span>
              </div>
              <p className="mt-2 text-xs text-muted">{formatDateTime(save.modifiedAt)}</p>
            </div>
          </div>
        </div>

        <div className="border-t border-line px-5 py-3 sm:px-6">
          <p className="truncate font-mono text-[0.7rem] leading-5 text-muted" title={save.path}>
            {save.path}
          </p>
        </div>
      </div>
    </section>
  );
}
