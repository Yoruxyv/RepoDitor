/** Structural initial-loading state matching the final discovery workspace. */
import { usePreferences } from "@/app/preferences";
import { Skeleton, SkeletonRegion } from "@/components/Skeleton";

export function DiscoveryLoading() {
  const { t } = usePreferences();
  return (
    <SkeletonRegion label={t("discovery.loading")} testId="discovery-skeleton">
      <div className="flex items-end justify-between gap-6 border-b border-line pb-7">
        <div className="w-full max-w-xl space-y-4">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-10 w-72 max-w-full" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>
        <Skeleton className="hidden h-10 w-28 sm:block" />
      </div>

      <div className="grid gap-8 pt-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
        <div className="space-y-8">
          <div data-testid="latest-save-skeleton">
            <Skeleton className="h-6 w-28" />
            <div className="mt-3 flex min-h-48 items-start gap-4 border border-line border-l-accent bg-surface p-6">
              <Skeleton className="size-10 shrink-0" />
              <div className="min-w-0 flex-1 space-y-4">
                <Skeleton className="h-9 w-3/4" />
                <Skeleton className="h-3 w-52 max-w-full" />
                <Skeleton className="h-3 w-40 max-w-full" />
                <Skeleton className="h-4 w-28" />
              </div>
            </div>
          </div>

          <div data-testid="recent-save-skeleton">
            <div className="flex justify-between gap-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="mt-3 border-t border-line">
              {[0, 1].map((row) => (
                <div
                  className="flex items-center justify-between gap-4 border-b border-line py-5"
                  key={row}
                >
                  <div className="flex flex-1 items-center gap-3">
                    <Skeleton className="size-4 shrink-0" />
                    <Skeleton className="h-4 w-52 max-w-2/3" />
                  </div>
                  <Skeleton className="h-3 w-36 max-w-1/3" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="self-start border border-line bg-surface p-6">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="mt-2 h-3 w-44 max-w-full" />
          {[0, 1].map((row) => (
            <div
              className="mt-5 flex gap-3 border-t border-line pt-5 first:border-0 first:pt-0"
              key={row}
            >
              <Skeleton className="size-5 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-36 max-w-full" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </aside>
      </div>
    </SkeletonRegion>
  );
}
