import { ArrowClockwiseIcon, MapTrifoldIcon } from "@phosphor-icons/react";

import type { InstalledMapsDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { PathDetails } from "@/components/PathDetails";

interface MapsViewProps {
  readonly discovery: InstalledMapsDto | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
}

export function MapsView({ discovery, loading, error, onRetry }: MapsViewProps) {
  const { t } = usePreferences();
  if (loading) return <output aria-live="polite" className="text-sm text-secondary">{t("maps.loading")}</output>;
  if (error) return <section aria-labelledby="maps-error-title"><h2 className="text-xl font-semibold text-ink" id="maps-error-title">{t("maps.unavailable")}</h2><p className="mt-2 text-sm text-secondary" role="alert">{error}</p><button className="mt-5 inline-flex items-center gap-2 rounded-sm border border-control px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent" type="button" onClick={onRetry}><ArrowClockwiseIcon aria-hidden="true" size={16} /> {t("action.tryAgain")}</button></section>;
  if (!discovery?.available) return <section aria-labelledby="maps-title"><h2 className="text-2xl font-semibold text-ink" id="maps-title">{t("nav.maps")}</h2><p className="mt-3 max-w-[58ch] text-sm/6 text-secondary">{t("maps.noGame")}</p></section>;

  return (
    <section aria-labelledby="maps-title">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">{t("maps.installed")}</p>
      <div className="mt-1 flex items-end justify-between gap-4"><h2 className="text-2xl font-semibold text-ink" id="maps-title">{t("nav.maps")}</h2><span className="font-mono text-xs text-muted">{discovery.maps.length}</span></div>
      <p className="mt-2 max-w-[58ch] text-sm/6 text-secondary">{t("maps.description")}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {discovery.maps.map((gameMap) => <div className="min-w-0 rounded-sm border border-line bg-surface p-4" key={gameMap.internalName}><div className="flex items-start gap-3"><MapTrifoldIcon aria-hidden="true" className="mt-0.5 shrink-0 text-accent" size={19} /><div className="min-w-0"><h3 className="wrap-break-word text-sm font-semibold text-ink">{gameMap.displayName}</h3>{gameMap.displayName !== gameMap.internalName ? <details className="mt-1"><summary className="cursor-pointer text-xs font-semibold text-accent">{t("technical.details")}</summary><p className="mt-1 wrap-break-word font-mono text-xs/5 text-muted">{gameMap.internalName}</p></details> : null}</div></div></div>)}
      </div>
      {discovery.catalogPath ? (
        <PathDetails
          className="mt-6 border-t border-line pt-4"
          label={t("maps.catalogSource")}
          testId="map-catalog-path"
          value={discovery.catalogPath}
        />
      ) : null}
    </section>
  );
}
