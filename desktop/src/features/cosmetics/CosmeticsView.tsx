import { ArrowClockwiseIcon, LockSimpleIcon, SparkleIcon, TrashIcon } from "@phosphor-icons/react";

import type { CosmeticsViewDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { Skeleton, SkeletonRegion } from "@/components/Skeleton";
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
  readonly hasPendingEdits: boolean;
  readonly hasBulkPending: boolean;
  readonly saving: boolean;
  readonly lockAllBlockedReason: string | null;
  readonly onRetry: () => void;
  readonly onUnlockAll: () => void;
  readonly onUnlockCosmetic: (cosmeticId: number) => void;
  readonly onClearAllPresets: () => void;
  readonly onLockAll: () => void;
}

function CosmeticCardSkeleton({ first }: { readonly first: boolean }) {
  return (
    <div
      className="min-w-0 rounded-sm border border-line bg-surface p-3"
      data-skeleton-kind="cosmetic-card"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Skeleton
          className="size-12 shrink-0"
          testId={first ? "cosmetic-thumbnail-skeleton" : undefined}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-14" />
        </div>
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-14" />
      </div>
    </div>
  );
}

function CosmeticsSkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonRegion label={label} testId="cosmetics-skeleton">
      <Skeleton className="h-3 w-36" />
      <Skeleton className="mt-2 h-8 w-32" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <Skeleton className="mt-2 h-4 w-2/3 max-w-lg" />

      <div className="mt-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((stat) => (
          <div className="border-t border-line pt-3" key={stat}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-6 w-12" />
          </div>
        ))}
      </div>
      <div className="mt-7 flex flex-wrap gap-3">
        <Skeleton className="h-10 w-44" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-40" />
      </div>

      <div className="mt-8 border-t border-line pt-6">
        <div className="flex justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-[2_1_20rem]">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-10 w-full" />
          </div>
          {[0, 1, 2].map((filter) => (
            <div className="min-w-36 flex-[1_1_9rem]" key={filter}>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-2 h-10 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-2 h-3 w-28" />

        <div aria-hidden="true" className="mt-4 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((card) => (
            <CosmeticCardSkeleton first={card === 0} key={card} />
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
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
  hasPendingEdits,
  hasBulkPending,
  saving,
  lockAllBlockedReason,
  onRetry,
  onUnlockAll,
  onUnlockCosmetic,
  onClearAllPresets,
  onLockAll,
}: CosmeticsViewProps) {
  const { t } = usePreferences();
  if (loading && !view) {
    return <CosmeticsSkeleton label={t("cosmetics.loading")} />;
  }
  if (error) {
    return (
      <section aria-labelledby="cosmetics-error-title">
        <h2 className="text-xl font-semibold text-ink" id="cosmetics-error-title">
          {t("cosmetics.unavailable")}
        </h2>
        <p className="mt-2 text-sm text-secondary" role="alert">
          {error}
        </p>
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

  const lockAllUnavailable = lockAllBlockedReason ? t("cosmetics.lockUnavailable") : null;

  return (
    <section aria-busy={loading} aria-labelledby="cosmetics-title">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
        {t("cosmetics.ownership")}
      </p>
      <h2 className="mt-1 text-2xl font-semibold text-ink" id="cosmetics-title">
        {t("app.cosmetics")}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm/6 text-secondary">{t("cosmetics.description")}</p>

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
          disabled={!view.capabilities.canUnlockAll || knownLockedCount === 0 || hasPendingEdits}
          type="button"
          onClick={onUnlockAll}
        >
          <SparkleIcon aria-hidden="true" size={17} weight="bold" />
          {t(unlockAllPending ? "cosmetics.unlockPending" : "cosmetics.unlockAll")}
        </button>
        <button
          className="ui-feedback inline-flex items-center gap-2 rounded-sm border border-control px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={view.savedPresetCount === 0 || hasPendingEdits}
          type="button"
          onClick={onClearAllPresets}
        >
          <TrashIcon aria-hidden="true" size={17} />
          {t(clearAllPresetsPending ? "cosmetics.clearPending" : "cosmetics.clearPresets")}
        </button>
        <button
          className="ui-feedback inline-flex items-center gap-2 rounded-sm border border-control px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={
            !view.capabilities.canRemoveOwnership ||
            knownOwnedCount === 0 ||
            hasPendingEdits ||
            lockAllBlockedReason !== null
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

      <CosmeticsCatalog
        actionsDisabled={hasBulkPending || saving}
        view={view}
        onUnlockCosmetic={onUnlockCosmetic}
      />
    </section>
  );
}
