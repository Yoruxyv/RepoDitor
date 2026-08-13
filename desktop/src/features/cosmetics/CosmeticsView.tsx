import { ArrowClockwiseIcon, LockSimpleIcon, SparkleIcon, TrashIcon } from "@phosphor-icons/react";

import type { CosmeticsViewDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { CosmeticsCatalog } from "@/features/cosmetics/CosmeticsCatalog";

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
  readonly onRetry: () => void;
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
  onRetry,
  onUnlockAll,
  onClearAllPresets,
  onLockAll,
}: CosmeticsViewProps) {
  const { t } = usePreferences();
  if (loading) {
    return <output aria-live="polite" className="text-sm text-secondary">{t("cosmetics.loading")}</output>;
  }
  if (error) {
    return (
      <section aria-labelledby="cosmetics-error-title">
        <h2 className="text-xl font-semibold text-ink" id="cosmetics-error-title">{t("cosmetics.unavailable")}</h2>
        <p className="mt-2 text-sm text-secondary" role="alert">{error}</p>
        <button
          className="ui-feedback mt-5 inline-flex items-center gap-2 rounded-sm border border-control px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          type="button"
          onClick={onRetry}
        >
          <ArrowClockwiseIcon aria-hidden="true" size={16} />
          {t("action.tryAgain")}
        </button>
      </section>
    );
  }
  if (!view) return null;

  const bulkPending = unlockAllPending || lockAllPending || clearAllPresetsPending;
  const lockAllUnavailable = lockAllBlockedReason
    ? t("cosmetics.lockUnavailable")
    : null;

  return (
    <section aria-labelledby="cosmetics-title">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">{t("cosmetics.ownership")}</p>
      <h2 className="mt-1 text-2xl font-semibold text-ink" id="cosmetics-title">{t("app.cosmetics")}</h2>
      <p className="mt-2 max-w-[62ch] text-sm/6 text-secondary">
        {t("cosmetics.description")}
      </p>

      <dl className="mt-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          [t("cosmetics.knownCatalog"), view.knownCatalogCount],
          [t("cosmetics.owned"), knownOwnedCount],
          [t("cosmetics.locked"), knownLockedCount],
          [t("cosmetics.savedPresets"), savedPresetCount],
        ].map(([label, value]) => (
          <div className="min-w-0 border-t border-line pt-3" key={label}>
            <dt className="text-xs font-semibold text-secondary">{label}</dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-7 flex flex-wrap gap-3" aria-label={t("cosmetics.actions")}>
        <button
          className="ui-feedback inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!view.capabilities.canUnlockAll || knownLockedCount === 0 || bulkPending}
          type="button"
          onClick={onUnlockAll}
        >
          <SparkleIcon aria-hidden="true" size={17} weight="bold" />
          {t(unlockAllPending ? "cosmetics.unlockPending" : "cosmetics.unlockAll")}
        </button>
        <button
          className="ui-feedback inline-flex items-center gap-2 rounded-sm border border-control px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={view.savedPresetCount === 0 || bulkPending}
          type="button"
          onClick={onClearAllPresets}
        >
          <TrashIcon aria-hidden="true" size={17} />
          {t(clearAllPresetsPending ? "cosmetics.clearPending" : "cosmetics.clearPresets")}
        </button>
        <button
          className="ui-feedback inline-flex items-center gap-2 rounded-sm border border-control px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
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
          {t(lockAllPending ? "cosmetics.lockPending" : "cosmetics.lockAll")}
        </button>
      </div>
      {lockAllUnavailable ? (
        <output
          aria-live="polite"
          className="mt-2 block text-xs text-warning"
          data-testid="lock-all-blocked-reason"
        >
          {lockAllUnavailable}
        </output>
      ) : null}

      <CosmeticsCatalog view={view} />
    </section>
  );
}
