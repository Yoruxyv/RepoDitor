import { CircleHalfIcon, GithubLogoIcon, StarIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { LanguageMenu } from "@/app/LanguageMenu";
import { usePreferences, type ThemePreference } from "@/app/preferences";

const PROJECT_URL = "https://github.com/Yoruxyv/RepoDitor";

export function UtilityCluster() {
  const [stars, setStars] = useState<number | null>(null);
  const { theme, setTheme, t } = usePreferences();

  useEffect(() => {
    let active = true;
    void window.repoditor.project.metadata().then((result) => {
      if (active && result.ok) {
        setStars(result.data.stars);
      }
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const starLabel = stars === null
    ? t("utility.githubUnavailable")
    : t("utility.githubStars", { count: stars });
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={t("utility.group")}>
      <a
        aria-label={t("utility.openGithub", { stars: starLabel })}
        className="ui-feedback inline-flex h-10 items-center gap-2 rounded-sm border border-line-strong bg-surface px-3 text-sm font-semibold text-secondary hover:border-accent hover:text-accent"
        href={PROJECT_URL}
        rel="noreferrer"
        target="_blank"
      >
        <GithubLogoIcon aria-hidden="true" size={17} />
        <StarIcon aria-hidden="true" size={15} />
        <span className="min-w-4 font-mono text-xs" data-testid="github-stars">
          {stars ?? "—"}
        </span>
      </a>
      <label className="ui-feedback relative inline-flex h-10 items-center rounded-sm border border-line-strong bg-surface text-secondary focus-within:border-accent focus-within:text-accent">
        <CircleHalfIcon aria-hidden="true" className="pointer-events-none absolute left-3" size={16} />
        <span className="sr-only">{t("utility.theme")}</span>
        <select
          aria-label={t("utility.theme")}
          className="h-full appearance-none bg-transparent py-0 pr-7 pl-9 text-sm font-semibold text-inherit"
          value={theme}
          onChange={(event) => setTheme(event.target.value as ThemePreference)}
        >
          <option value="system">{t("utility.theme.system")}</option>
          <option value="dark">{t("utility.theme.dark")}</option>
          <option value="light">{t("utility.theme.light")}</option>
        </select>
      </label>
      <LanguageMenu />
    </div>
  );
}
