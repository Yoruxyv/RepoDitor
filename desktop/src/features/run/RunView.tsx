import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useState } from "react";

import type { RunStateDto, RunStatDto } from "@electron/contracts";
import type { RunStatEdit } from "@/features/editor/pendingEdits";

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

export function RunView({ run, loading, error, pendingByField, onStatChange, onResumeChange, onRevert, onRetry }: RunViewProps) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  if (loading) return <p className="text-sm text-secondary">Loading run state…</p>;
  if (error) {
    return <section aria-labelledby="run-error-title"><h2 className="text-xl font-semibold text-ink" id="run-error-title">Run unavailable</h2><p className="mt-2 text-sm text-secondary" role="alert">{error}</p><button className="mt-5 inline-flex items-center gap-2 rounded-sm border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent" type="button" onClick={onRetry}><ArrowClockwiseIcon aria-hidden="true" size={16} /> Try again</button></section>;
  }
  if (!run) return null;

  return (
    <section aria-labelledby="run-title">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Current expedition</p>
      <h2 className="mt-1 text-2xl font-semibold text-ink" id="run-title">Run</h2>
      <p className="mt-2 max-w-[58ch] text-sm/6 text-secondary">Adjust the friendly values below in memory. The selected save is not written yet.</p>
      <div className="mt-7 grid min-w-0 gap-x-8 gap-y-5 sm:grid-cols-2">
        {run.stats.map((stat) => {
          const edit = pendingByField[stat.key];
          const input = inputs[stat.key] ?? String(edit?.after ?? stat.value);
          const parsed = Number(input);
          const invalid = input.trim() === "" || !Number.isSafeInteger(parsed) || (stat.key === "level" && parsed < 1);
          return <div className="border-t border-line pt-4" key={stat.key}>
            <label className="text-sm font-semibold text-ink" htmlFor={`run-${stat.key}`}>{stat.label}</label>
            <div className="mt-3 flex flex-wrap items-start gap-3">
              <input aria-describedby={invalid ? `run-${stat.key}-error` : undefined} aria-invalid={invalid ? "true" : undefined} className="w-36 rounded-sm border border-line-strong bg-surface px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:outline-none" id={`run-${stat.key}`} min={stat.key === "level" ? 1 : undefined} step="1" type="number" value={input} onChange={(event) => {
                const value = event.target.value;
                setInputs((current) => ({ ...current, [stat.key]: value }));
                const next = Number(value);
                if (value.trim() && Number.isSafeInteger(next) && (stat.key !== "level" || next >= 1)) onStatChange(stat, next);
              }} />
              {edit ? <button className="rounded-sm border border-line-strong px-3 py-2 text-sm font-semibold text-secondary hover:border-accent hover:text-accent" type="button" onClick={() => {
                setInputs((current) => { const next = { ...current }; delete next[stat.key]; return next; });
                onRevert(stat.key);
              }}>Revert</button> : null}
            </div>
            {invalid ? <p className="mt-2 text-xs text-danger" id={`run-${stat.key}-error`} role="alert">{stat.key === "level" ? "Level must be a whole number of one or more." : `${stat.label} must be a whole number.`}</p> : null}
            {edit ? <p className="mt-2 text-xs font-medium text-accent" data-testid={`pending-run-${stat.key}`}>Pending: {edit.before} → {edit.after}</p> : null}
          </div>;
        })}
        <div className="border-t border-line pt-4 sm:col-span-2">
          <label className="text-sm font-semibold text-ink" htmlFor="run-resume-location">Resume location</label>
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <select className="min-w-56 rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none" id="run-resume-location" value={String(pendingByField.resumeLocation?.after ?? run.resumeLocation.value)} onChange={(event) => onResumeChange(event.target.value)}>
              {run.resumeLocation.options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            {pendingByField.resumeLocation ? <button className="rounded-sm border border-line-strong px-3 py-2 text-sm font-semibold text-secondary hover:border-accent hover:text-accent" type="button" onClick={() => onRevert("resumeLocation")}>Revert</button> : null}
          </div>
          {pendingByField.resumeLocation ? <p className="mt-2 text-xs font-medium text-accent" data-testid="pending-run-resume">Pending: {pendingByField.resumeLocation.before} → {pendingByField.resumeLocation.after}</p> : null}
        </div>
      </div>
    </section>
  );
}
