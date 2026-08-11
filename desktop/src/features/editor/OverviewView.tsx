import { CheckCircleIcon } from "@phosphor-icons/react";

import type { SaveSession } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { formatDateTime } from "@/features/discovery/formatters";

export function OverviewView({ session }: { readonly session: SaveSession }) {
  const { locale, t } = usePreferences();
  const metrics = [
    [t("overview.level"), session.level],
    [t("overview.currency"), session.currency.toLocaleString(locale)],
    [t("overview.players"), session.playerCount],
    [t("overview.resumeAt"), session.resumeLocation],
  ];

  return (
    <div>
      <dl className="grid grid-cols-2 border-y border-line xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div
            className="min-w-0 px-4 py-5 first:pl-0 xl:border-r xl:border-line xl:last:border-r-0"
            key={label}
          >
            <dt className="text-xs font-medium text-muted">{label}</dt>
            <dd
              className="mt-2 truncate font-mono text-xl font-semibold text-ink"
              title={String(value)}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <section className="mt-8" aria-labelledby="session-ready-title">
        <CheckCircleIcon aria-hidden="true" className="text-success" size={27} weight="regular" />
        <h2 className="mt-4 text-xl font-semibold text-ink" id="session-ready-title">
          {t("overview.safeTitle")}
        </h2>
        <p className="mt-2 max-w-[60ch] text-sm/6 text-secondary">
          {t("overview.safeDescription")}
        </p>

        <dl className="mt-7 grid gap-5 border-t border-line pt-6 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted">{t("overview.saveName")}</dt>
            <dd className="mt-2 truncate text-sm font-semibold text-ink" title={session.name}>
              {session.name}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted">{t("overview.lastModified")}</dt>
            <dd className="mt-2 text-sm font-semibold text-ink">
              {formatDateTime(session.modifiedAt, locale)}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
