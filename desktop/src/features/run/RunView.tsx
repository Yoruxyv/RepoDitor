/** Stages supported Run fields without reproducing save representation semantics. */
import {
  ArrowClockwiseIcon,
  ArrowUpIcon,
  CoinsIcon,
  HeartIcon,
  MapPinIcon,
  PackageIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import type { RunStateDto, RunStatDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { Select } from "@/components/Select";
import { Skeleton, SkeletonRegion } from "@/components/Skeleton";
import {
  RUN_DISPLAY_LEVEL_MAX,
  SAVE_INT32_MAX,
  SAVE_INT32_MIN,
} from "@/features/editor/saveValueBounds";
import type { RunStatEdit } from "@/features/pending-changes/pendingEdits";

const RUN_STAT_ICONS = {
  level: ArrowUpIcon,
  currency: CoinsIcon,
  lives: HeartIcon,
  totalHaul: PackageIcon,
} as const;

interface RunViewProps {
  readonly run: RunStateDto | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly pendingByField: Record<string, RunStatEdit>;
  readonly onStatChange: (stat: RunStatDto, value: number) => void;
  readonly onResumeChange: (value: string) => void;
  readonly onRevert: (field: string) => void;
  readonly onRetry: () => void;
}

function RunSkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonRegion label={label} testId="run-skeleton">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-8 w-20" />
      <Skeleton className="mt-3 h-4 w-full max-w-lg" />
      <Skeleton className="mt-2 h-4 w-2/3 max-w-md" />

      <div className="mt-7 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {[0, 1, 2, 3].map((stat) => (
          <div className="border-t border-line pt-4" data-skeleton-kind="run-stat" key={stat}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-10 w-36" />
          </div>
        ))}
        <div className="border-t border-line pt-4 sm:col-span-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-3 h-10 w-56 max-w-full" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function RunView({
  run,
  loading,
  error,
  pendingByField,
  onStatChange,
  onResumeChange,
  onRevert,
  onRetry,
}: RunViewProps) {
  const { t } = usePreferences();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  if (loading && !run) return <RunSkeleton label={t("run.loading")} />;
  if (error) {
    return (
      <section aria-labelledby="run-error-title">
        <h2 className="text-xl font-semibold text-ink" id="run-error-title">
          {t("run.unavailable")}
        </h2>
        <p className="mt-2 text-sm text-secondary" role="alert">
          {error}
        </p>
        <button
          className="mt-5 inline-flex items-center gap-2 rounded-sm border border-control px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          type="button"
          onClick={onRetry}
        >
          <ArrowClockwiseIcon aria-hidden="true" size={16} /> {t("action.tryAgain")}
        </button>
      </section>
    );
  }
  if (!run) return null;

  return (
    <section aria-busy={loading} aria-labelledby="run-title">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
        {t("run.expedition")}
      </p>
      <h2 className="mt-1 text-2xl font-semibold text-ink" id="run-title">
        {t("nav.run")}
      </h2>
      <p className="mt-2 max-w-[58ch] text-sm/6 text-secondary">{t("run.description")}</p>
      <div className="mt-7 grid min-w-0 gap-x-8 gap-y-5 sm:grid-cols-2">
        {run.stats.map((stat) => {
          const StatIcon = RUN_STAT_ICONS[stat.key];
          const edit = pendingByField[stat.key];
          const input = inputs[stat.key] ?? String(edit?.after ?? stat.value);
          const parsed = Number(input);
          const minimum = stat.key === "level" ? 1 : SAVE_INT32_MIN;
          const maximum = stat.key === "level" ? RUN_DISPLAY_LEVEL_MAX : SAVE_INT32_MAX;
          const invalid =
            input.trim() === "" ||
            !Number.isSafeInteger(parsed) ||
            parsed < minimum ||
            parsed > maximum;
          const errorId = `run-${stat.key}-error`;
          const pendingId = `run-${stat.key}-pending`;
          const description =
            [invalid ? errorId : null, edit ? pendingId : null].filter(Boolean).join(" ") ||
            undefined;
          return (
            <div className="border-t border-line pt-4" key={stat.key}>
              <label
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink"
                htmlFor={`run-${stat.key}`}
              >
                <StatIcon aria-hidden="true" className="text-muted" size={15} />
                {stat.label}
              </label>
              <div className="mt-3 flex flex-wrap items-start gap-3">
                <input
                  aria-describedby={description}
                  aria-invalid={invalid ? "true" : undefined}
                  className="w-36 rounded-sm border border-control bg-surface px-3 py-2 font-mono text-sm text-ink focus:border-accent"
                  id={`run-${stat.key}`}
                  max={maximum}
                  min={minimum}
                  step="1"
                  type="number"
                  value={input}
                  onChange={(event) => {
                    const value = event.target.value;
                    setInputs((current) => ({ ...current, [stat.key]: value }));
                    const next = Number(value);
                    if (
                      value.trim() &&
                      Number.isSafeInteger(next) &&
                      next >= minimum &&
                      next <= maximum
                    ) {
                      onStatChange(stat, next);
                    } else {
                      onRevert(stat.key);
                    }
                  }}
                />
                {edit ? (
                  <button
                    className="rounded-sm border border-control px-3 py-2 text-sm font-semibold text-secondary hover:border-accent hover:text-accent"
                    type="button"
                    onClick={() => {
                      setInputs((current) => {
                        const next = { ...current };
                        delete next[stat.key];
                        return next;
                      });
                      onRevert(stat.key);
                    }}
                  >
                    {t("action.revert")}
                  </button>
                ) : null}
              </div>
              {invalid ? (
                <p className="mt-2 text-xs text-danger" id={errorId} role="alert">
                  {stat.key === "level"
                    ? t("run.levelError")
                    : t("run.valueError", { label: stat.label })}
                </p>
              ) : null}
              {edit ? (
                <p
                  className="mt-2 text-xs font-medium text-accent"
                  data-testid={`pending-run-${stat.key}`}
                  id={pendingId}
                >
                  {t("status.pending", { before: edit.before, after: edit.after })}
                </p>
              ) : null}
            </div>
          );
        })}
        <div className="border-t border-line pt-4 sm:col-span-2">
          <label
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink"
            htmlFor="run-resume-location"
          >
            <MapPinIcon aria-hidden="true" className="text-muted" size={15} />
            {t("run.resumeLocation")}
          </label>
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <Select<string>
              ariaLabel={t("run.resumeLocation")}
              className="min-w-56 max-w-full"
              id="run-resume-location"
              options={run.resumeLocation.options.map((option) => ({
                label: option,
                value: option,
              }))}
              value={String(pendingByField.resumeLocation?.after ?? run.resumeLocation.value)}
              onValueChange={onResumeChange}
            />
            {pendingByField.resumeLocation ? (
              <button
                className="rounded-sm border border-control px-3 py-2 text-sm font-semibold text-secondary hover:border-accent hover:text-accent"
                type="button"
                onClick={() => onRevert("resumeLocation")}
              >
                {t("action.revert")}
              </button>
            ) : null}
          </div>
          {pendingByField.resumeLocation ? (
            <p className="mt-2 text-xs font-medium text-accent" data-testid="pending-run-resume">
              {t("status.pending", {
                before: pendingByField.resumeLocation.before,
                after: pendingByField.resumeLocation.after,
              })}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
