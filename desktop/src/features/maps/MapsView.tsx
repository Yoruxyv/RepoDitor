import { ArrowClockwiseIcon, MapTrifoldIcon } from "@phosphor-icons/react";

import type { InstalledMapsDto } from "@electron/contracts";

interface MapsViewProps {
  readonly discovery: InstalledMapsDto | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
}

export function MapsView({ discovery, loading, error, onRetry }: MapsViewProps) {
  if (loading) return <p className="text-sm text-secondary">Discovering installed maps…</p>;
  if (error) return <section aria-labelledby="maps-error-title"><h2 className="text-xl font-semibold text-ink" id="maps-error-title">Maps unavailable</h2><p className="mt-2 text-sm text-secondary" role="alert">{error}</p><button className="mt-5 inline-flex items-center gap-2 rounded-sm border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent" type="button" onClick={onRetry}><ArrowClockwiseIcon aria-hidden="true" size={16} /> Try again</button></section>;
  if (!discovery?.available) return <section aria-labelledby="maps-title"><h2 className="text-2xl font-semibold text-ink" id="maps-title">Maps</h2><p className="mt-3 max-w-[58ch] text-sm/6 text-secondary">No validated R.E.P.O. installation was found. Map discovery does not affect save editing.</p></section>;

  return (
    <section aria-labelledby="maps-title">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Installed content</p>
      <div className="mt-1 flex items-end justify-between gap-4"><h2 className="text-2xl font-semibold text-ink" id="maps-title">Maps</h2><span className="font-mono text-xs text-muted">{discovery.maps.length}</span></div>
      <p className="mt-2 max-w-[58ch] text-sm/6 text-secondary">Read-only discovery from the installed game&apos;s catalog. RepoDitor does not force the next map.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {discovery.maps.map((gameMap) => <div className="min-w-0 rounded-sm border border-line bg-surface p-4" key={gameMap.internalName}><div className="flex items-start gap-3"><MapTrifoldIcon aria-hidden="true" className="mt-0.5 shrink-0 text-accent" size={19} /><div className="min-w-0"><h3 className="wrap-break-word text-sm font-semibold text-ink">{gameMap.displayName}</h3>{gameMap.displayName !== gameMap.internalName ? <p className="mt-1 wrap-break-word font-mono text-[0.68rem] text-muted">{gameMap.internalName}</p> : null}</div></div></div>)}
      </div>
      <p className="mt-6 break-all border-t border-line pt-4 font-mono text-[0.68rem]/5 text-muted" title={discovery.catalogPath ?? undefined}>{discovery.catalogPath}</p>
    </section>
  );
}
