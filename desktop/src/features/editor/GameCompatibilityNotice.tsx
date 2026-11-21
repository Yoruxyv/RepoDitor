import { useEffect, useState } from "react";
import { usePreferences } from "@/app/preferences";

import type { CompatibilityIssue } from "./compatibility";

export type CompatibilityFeature =
  "nav.players" | "nav.upgrades" | "nav.run" | "nav.items" | "app.cosmetics";

const announced = new Set<string>();

export function GameCompatibilityNotice({
  build,
  issue,
  features,
}: {
  readonly build?: string | null | undefined;
  readonly issue: CompatibilityIssue;
  readonly features: readonly CompatibilityFeature[];
}) {
  const { t } = usePreferences();
  const key = JSON.stringify([build, issue, features]);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);
  useEffect(() => {
    if (features.length && !announced.has(key)) {
      announced.add(key);
      setNoticeKey(key);
    }
  }, [features.length, key]);
  if (!features.length) return null;
  const title = t("compatibility.title");
  const notify = noticeKey === key;
  return (
    <aside
      aria-label={title}
      className="mb-4 border-l-2 border-warning bg-warning-muted px-4 py-3 text-sm text-secondary"
    >
      {notify ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="font-semibold text-ink">
            {title}
          </p>
          <button
            type="button"
            className="ui-feedback rounded-sm border border-control px-3 py-1 text-xs hover:text-ink"
            onClick={() => setNoticeKey(null)}
          >
            {t("compatibility.dismiss")}
          </button>
        </div>
      ) : null}
      <p>
        {features.map((feature) => t(feature)).join(" · ")}
        {build ? ` · ${t("compatibility.build", { build })}` : ""}
      </p>
      <p className="mt-1">{t(`compatibility.${issue}`)}</p>
      <a
        className="mt-1 inline-block text-accent underline"
        href="https://github.com/Yoruxyv/RepoDitor/releases"
        rel="noreferrer"
        target="_blank"
      >
        {t("compatibility.updates")}
      </a>
    </aside>
  );
}
