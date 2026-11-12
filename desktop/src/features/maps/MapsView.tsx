/** Read-only installed map presentation; no selection or game-control behavior. */
import { ArrowClockwiseIcon, MapTrifoldIcon } from "@phosphor-icons/react";

import type { InstalledMapsDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { GameIcon } from "@/components/GameIcon";
import { Skeleton, SkeletonRegion } from "@/components/Skeleton";

interface MapsViewProps {
  readonly artworkAttempt?: number;
  readonly discovery: InstalledMapsDto | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
}

function MapsSkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonRegion label={label} testId="maps-skeleton">
      <Skeleton className="h-3 w-24" />
      <div className="mt-2 flex items-end justify-between gap-4">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-3 w-5" />
      </div>
      <Skeleton className="mt-3 h-4 w-full max-w-lg" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((gameMap) => (
          <div
            className="min-w-0 rounded-sm border border-line bg-surface p-4"
            data-skeleton-kind="map-card"
            key={gameMap}
          >
            <Skeleton className="aspect-2/1 w-full" />
            <Skeleton className="mt-4 h-5 w-40 max-w-full" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function MapsView({
  artworkAttempt = 0,
  discovery,
  loading,
  error,
  onRetry,
}: MapsViewProps) {
  const { t } = usePreferences();
  if (loading && !discovery) return <MapsSkeleton label={t("maps.loading")} />;
  if (error && !discovery)
    return (
      <section aria-labelledby="maps-error-title">
        <h2 className="text-xl font-semibold text-ink" id="maps-error-title">
          {t("maps.unavailable")}
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
  const available = discovery?.available === true;
  const maps = available ? discovery.maps : [];

  return (
    <section aria-busy={loading} aria-labelledby="maps-title">
      {available ? (
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
          {t("maps.installed")}
        </p>
      ) : null}
      <div className="mt-1 flex items-end justify-between gap-4">
        <h2 className="text-2xl font-semibold text-ink" id="maps-title">
          {t("nav.maps")}
        </h2>
        <button
          className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-control px-3 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent disabled:opacity-50"
          disabled={loading}
          type="button"
          onClick={onRetry}
        >
          <ArrowClockwiseIcon aria-hidden="true" size={16} />
          {t(loading ? "action.refreshing" : "action.refresh")}
        </button>
      </div>
      <p className="mt-2 max-w-[58ch] text-sm/6 text-secondary">
        {t(available ? "maps.description" : "maps.noGame")}
      </p>
      {error ? (
        <p className="mt-3 text-sm text-secondary" role="alert">
          {error}
        </p>
      ) : null}
      {available && maps.length === 0 ? (
        <p className="mt-6 text-sm text-secondary">{t("maps.empty")}</p>
      ) : null}
      {maps.length > 0 ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {maps.map((gameMap) => (
            <div
              className="min-w-0 rounded-sm border border-line bg-surface p-4"
              key={gameMap.internalName}
            >
              <GameIcon
                key={artworkAttempt}
                fallback={MapTrifoldIcon}
                fallbackSource="fallback"
                testId={`map-artwork-${gameMap.internalName}`}
                token={gameMap.iconToken}
                variant="map"
                loading="eager"
              />
              <h3 className="mt-4 min-w-0 wrap-break-word text-base font-semibold text-ink">
                {gameMap.displayName}
              </h3>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
