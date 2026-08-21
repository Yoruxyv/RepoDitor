/** Read-only Run snapshot and navigation hub built from already loaded projections. */
import {
  ArrowUpIcon,
  CoinsIcon,
  MapPinIcon,
  PackageIcon,
  PersonSimpleRunIcon,
  UserIcon,
} from "@phosphor-icons/react";

import type { SaveSession } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";

export type OverviewDestination = "players" | "upgrades" | "run" | "items";

interface OverviewViewProps {
  readonly session: SaveSession;
  readonly onNavigate: (destination: OverviewDestination) => void;
}

export function OverviewView({ session, onNavigate }: OverviewViewProps) {
  const { locale, t } = usePreferences();
  const metrics = [
    { icon: ArrowUpIcon, label: t("overview.level"), value: session.level },
    {
      icon: CoinsIcon,
      label: t("overview.currency"),
      value: session.currency.toLocaleString(locale),
    },
    { icon: UserIcon, label: t("overview.players"), value: session.playerCount },
    { icon: MapPinIcon, label: t("overview.resumeAt"), value: session.resumeLocation },
  ];
  const destinations = [
    { destination: "players", descriptionKey: "overview.playersDescription", icon: UserIcon },
    { destination: "upgrades", descriptionKey: "overview.upgradesDescription", icon: ArrowUpIcon },
    { destination: "run", descriptionKey: "overview.runDescription", icon: PersonSimpleRunIcon },
    { destination: "items", descriptionKey: "overview.itemsDescription", icon: PackageIcon },
  ] as const;

  return (
    <section aria-labelledby="overview-title">
      <h2 className="text-2xl font-semibold text-ink" id="overview-title">
        {t("nav.overview")}
      </h2>

      <section aria-labelledby="run-snapshot-title" className="mt-6">
        <h3 className="text-lg font-semibold text-ink" id="run-snapshot-title">
          {t("overview.runSnapshot")}
        </h3>
        <dl className="mt-2 grid grid-cols-2 border-y border-line xl:grid-cols-4">
          {metrics.map(({ icon: MetricIcon, label, value }) => (
            <div
              className="min-w-0 px-4 py-5 first:pl-0 xl:border-r xl:border-line xl:last:border-r-0"
              key={label}
            >
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <MetricIcon aria-hidden="true" size={14} />
                {label}
              </dt>
              <dd
                className="mt-2 truncate font-mono text-xl font-semibold text-ink"
                title={String(value)}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="edit-save-title" className="mt-8">
        <h3 className="text-lg font-semibold text-ink" id="edit-save-title">
          {t("overview.editSave")}
        </h3>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {destinations.map(({ destination, descriptionKey, icon: DestinationIcon }) => {
            const label = t(`nav.${destination}`);
            return (
              <li
                className="flex flex-wrap items-center justify-between gap-4 py-4"
                key={destination}
              >
                <div className="min-w-0">
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <DestinationIcon aria-hidden="true" className="text-accent" size={17} />
                    {label}
                  </h4>
                  <p className="mt-1 text-xs/5 text-secondary">{t(descriptionKey)}</p>
                </div>
                <button
                  className="ui-feedback shrink-0 rounded-sm border border-control px-3 py-2 text-sm font-semibold text-secondary hover:border-accent hover:text-accent"
                  type="button"
                  onClick={() => onNavigate(destination)}
                >
                  {t("overview.openSection", { section: label })}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}
