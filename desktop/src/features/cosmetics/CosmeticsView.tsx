import { ArrowClockwiseIcon, LockSimpleIcon, SparkleIcon, TrashIcon } from "@phosphor-icons/react";

import type { CosmeticsViewDto } from "@electron/contracts";

interface CosmeticsViewProps {
  readonly view: CosmeticsViewDto | null;
  readonly knownOwnedCount: number;
  readonly knownLockedCount: number;
  readonly savedPresetCount: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly unlockAllPending: boolean;
  readonly lockAllPending: boolean;
  readonly clearAllPresetsPending: boolean;
  readonly lockAllBlockedReason: string | null;
  readonly refreshDisabled: boolean;
  readonly onRetry: () => void;
  readonly onRefresh: () => void;
  readonly onUnlockAll: () => void;
  readonly onClearAllPresets: () => void;
  readonly onLockAll: () => void;
}

export function CosmeticsView({
  view,
  knownOwnedCount,
  knownLockedCount,
  savedPresetCount,
  loading,
  error,
  unlockAllPending,
  lockAllPending,
  clearAllPresetsPending,
  lockAllBlockedReason,
  refreshDisabled,
  onRetry,
  onRefresh,
  onUnlockAll,
  onClearAllPresets,
  onLockAll,
}: CosmeticsViewProps) {
  if (loading) {
    return <output aria-live="polite" className="text-sm text-secondary">Reading MetaSave cosmetics…</output>;
  }
  if (error) {
    return (
      <section aria-labelledby="cosmetics-error-title">
        <h2 className="text-xl font-semibold text-ink" id="cosmetics-error-title">Cosmetics unavailable</h2>
        <p className="mt-2 text-sm text-secondary" role="alert">{error}</p>
        <button
          className="mt-5 inline-flex items-center gap-2 rounded-sm border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          type="button"
          onClick={onRetry}
        >
          <ArrowClockwiseIcon aria-hidden="true" size={16} />
          Try again
        </button>
      </section>
    );
  }
  if (!view) return null;

  const bulkPending = unlockAllPending || lockAllPending || clearAllPresetsPending;
  const lockAllUnavailable = lockAllBlockedReason
    ? "Lock All is unavailable while an owned cosmetic is equipped or used by a preset."
    : null;

  return (
    <section aria-labelledby="cosmetics-title">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">MetaSave ownership</p>
      <h2 className="mt-1 text-2xl font-semibold text-ink" id="cosmetics-title">Cosmetics</h2>
      <p className="mt-2 max-w-[62ch] text-sm/6 text-secondary">
        Manage the known cosmetic catalog without guessing unavailable names.
      </p>

      <dl className="mt-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          ["Known catalog", view.knownCatalogCount],
          ["Owned", knownOwnedCount],
          ["Locked", knownLockedCount],
          ["Saved presets", savedPresetCount],
        ].map(([label, value]) => (
          <div className="min-w-0 border-t border-line pt-3" key={label}>
            <dt className="text-xs font-semibold text-secondary">{label}</dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-7 flex flex-wrap gap-3" aria-label="Cosmetic bulk actions">
        <button
          className="inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!view.capabilities.canUnlockAll || knownLockedCount === 0 || bulkPending}
          type="button"
          onClick={onUnlockAll}
        >
          <SparkleIcon aria-hidden="true" size={17} weight="bold" />
          {unlockAllPending ? "Unlock All pending" : "Unlock All Cosmetics"}
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-sm border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={view.savedPresetCount === 0 || bulkPending}
          type="button"
          onClick={onClearAllPresets}
        >
          <TrashIcon aria-hidden="true" size={17} />
          {clearAllPresetsPending ? "Clear All Presets pending" : "Clear All Presets"}
        </button>
        <button
          aria-describedby={lockAllUnavailable ? "lock-all-note" : undefined}
          className="inline-flex items-center gap-2 rounded-sm border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={
            !view.capabilities.canRemoveOwnership
            || knownOwnedCount === 0
            || bulkPending
            || lockAllBlockedReason !== null
          }
          type="button"
          onClick={onLockAll}
        >
          <LockSimpleIcon aria-hidden="true" size={17} />
          {lockAllPending ? "Lock All pending" : "Lock All Cosmetics"}
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-sm border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={refreshDisabled}
          type="button"
          onClick={onRefresh}
        >
          <ArrowClockwiseIcon aria-hidden="true" size={17} />
          Refresh
        </button>
      </div>
      {lockAllUnavailable ? (
        <p className="mt-2 text-xs text-warning" id="lock-all-note">{lockAllUnavailable}</p>
      ) : null}
    </section>
  );
}
