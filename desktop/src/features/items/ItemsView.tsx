import { ArrowClockwiseIcon, ShieldCheckIcon } from "@phosphor-icons/react";

import type { AdvancedItemDto, AdvancedSaveDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { Skeleton, SkeletonRegion } from "@/components/Skeleton";
import type { AdvancedRefillEdit } from "@/features/pending-changes/pendingEdits";
import { ItemGroups } from "./ItemGroups";

interface ItemsViewProps {
  readonly advanced: AdvancedSaveDto | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly pendingByItem: Readonly<Record<string, AdvancedRefillEdit>>;
  readonly onRefillAllToFull: () => void;
  readonly onRefillToFull: (item: AdvancedItemDto) => void;
  readonly onRetry: () => void;
  readonly onRevertRefill: (saveKey: string) => void;
}

function AdvancedSkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonRegion label={label} testId="items-skeleton">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <Skeleton className="mt-2 h-4 w-3/4 max-w-lg" />
      <div className="mt-6 flex gap-3 border-l-2 border-line px-3 py-2">
        <Skeleton className="size-4 shrink-0" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>

      <div className="mt-7 border-t border-line pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-[2_1_20rem]">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-10 w-full" />
          </div>
          {[0, 1].map((control) => (
            <div className="min-w-44 flex-[1_1_11rem]" key={control}>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="mt-2 h-10 w-full" />
            </div>
          ))}
          <Skeleton className="h-10 w-36" />
        </div>
        <Skeleton className="mt-2 h-3 w-28" />

        <div className="mt-5 space-y-4">
          {[0, 1, 2].map((group) => (
            <div
              className="border-y border-line bg-surface"
              data-skeleton-kind="item-group"
              key={group}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <Skeleton
                  className="size-14 shrink-0"
                  testId={group === 0 ? "item-thumbnail-skeleton" : undefined}
                />
                <Skeleton className="h-5 w-48 max-w-2/3" />
                <Skeleton className="ml-auto h-4 w-7" />
              </div>
              {group === 0 ? (
                <div className="flex items-center justify-between border-t border-line px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-9 w-20" />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function ItemsView({
  advanced,
  loading,
  error,
  pendingByItem,
  onRefillAllToFull,
  onRefillToFull,
  onRetry,
  onRevertRefill,
}: ItemsViewProps) {
  const { t } = usePreferences();
  if (loading && !advanced) {
    return <AdvancedSkeleton label={t("items.loading")} />;
  }
  if (error) {
    return (
      <section aria-labelledby="advanced-error-title">
        <h2 className="text-xl font-semibold text-ink" id="advanced-error-title">
          {t("items.unavailable")}
        </h2>
        <p className="mt-2 text-sm text-secondary" role="alert">
          {error}
        </p>
        <button
          className="mt-5 inline-flex items-center gap-2 rounded-sm border border-control px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          type="button"
          onClick={onRetry}
        >
          <ArrowClockwiseIcon aria-hidden="true" size={16} />
          {t("action.tryAgain")}
        </button>
      </section>
    );
  }
  if (!advanced) {
    return null;
  }

  const itemsDomain = advanced.domains.find((domain) => domain.key === "items");
  const chargeDomain = advanced.domains.find((domain) => domain.key === "currentCharge");

  return (
    <section aria-busy={loading} aria-labelledby="advanced-title">
      <h2 className="text-2xl font-semibold text-ink" id="advanced-title">
        {t("nav.items")}
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm/6 text-secondary">{t("items.description")}</p>

      <div className="mt-6 flex items-start gap-2 border-l-2 border-success px-3 py-2 text-xs/5 text-secondary">
        <ShieldCheckIcon aria-hidden="true" className="mt-0.5 shrink-0 text-success" size={17} />
        <p>{t("items.safety")}</p>
      </div>

      <div className="mt-7 border-t border-line pt-6">
        {!itemsDomain?.capabilities.canRead ? (
          <p className="max-w-[58ch] text-sm/6 text-secondary">{t("items.missingContainer")}</p>
        ) : null}
        {itemsDomain?.capabilities.canRead && advanced.items.length === 0 ? (
          <p className="text-sm text-secondary">{t("items.empty")}</p>
        ) : null}
        {itemsDomain?.capabilities.canRead && advanced.items.length > 0 ? (
          <ItemGroups
            canRefillToFull={chargeDomain?.capabilities.canRefillToFull ?? false}
            items={advanced.items}
            pendingByItem={pendingByItem}
            onRefillAllToFull={onRefillAllToFull}
            onRefillToFull={onRefillToFull}
            onRevertRefill={onRevertRefill}
          />
        ) : null}
      </div>
    </section>
  );
}
