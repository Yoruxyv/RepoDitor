import type { SaveSession } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";

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
    </div>
  );
}
