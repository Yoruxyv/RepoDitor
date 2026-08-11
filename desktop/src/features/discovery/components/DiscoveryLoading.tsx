import { usePreferences } from "@/app/preferences";

export function DiscoveryLoading() {
  const { t } = usePreferences();
  return (
    <section aria-busy="true" aria-label={t("discovery.loading")}>
      <span className="sr-only" aria-live="polite">
        {t("discovery.loadingLive")}
      </span>

      <div className="animate-pulse motion-reduce:animate-none">
        <div className="flex items-end justify-between gap-6 border-b border-line pb-7">
          <div className="w-full max-w-xl space-y-4">
            <div className="h-3 w-36 rounded-sm bg-surface-raised" />
            <div className="h-14 w-72 max-w-full rounded-sm bg-surface-raised" />
            <div className="h-4 w-full max-w-lg rounded-sm bg-surface-raised" />
          </div>
          <div className="hidden h-10 w-28 rounded-sm bg-surface-raised sm:block" />
        </div>

        <div className="grid gap-8 pt-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-7">
            <div className="h-52 rounded-sm bg-surface" />
            <div className="space-y-3">
              <div className="h-6 w-32 rounded-sm bg-surface-raised" />
              <div className="h-20 rounded-sm bg-surface" />
              <div className="h-20 rounded-sm bg-surface" />
            </div>
          </div>
          <div className="h-72 rounded-sm bg-surface" />
        </div>
      </div>
    </section>
  );
}
