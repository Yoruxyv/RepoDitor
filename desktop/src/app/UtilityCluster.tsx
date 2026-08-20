import { GithubLogoIcon, StarIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { LanguageMenu } from "@/app/LanguageMenu";
import { utilityTriggerClassName } from "@/app/utilityMenuChrome";
import { usePreferences } from "@/app/preferences";
import { ThemeMenu } from "@/app/ThemeMenu";

const PROJECT_URL = "https://github.com/Yoruxyv/RepoDitor";

export function UtilityCluster() {
  const [stars, setStars] = useState<number | null>(null);
  const { t } = usePreferences();

  useEffect(() => {
    let active = true;
    void window.repoditor.project
      .metadata()
      .then((result) => {
        if (active && result.ok) {
          setStars(result.data.stars);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const starLabel =
    stars === null ? t("utility.githubUnavailable") : t("utility.githubStars", { count: stars });
  return (
    <div
      className="flex min-w-0 flex-wrap items-center justify-end gap-2"
      aria-label={t("utility.group")}
    >
      <a
        aria-label={t("utility.openGithub", { stars: starLabel })}
        className={utilityTriggerClassName()}
        data-testid="github-project-link"
        href={PROJECT_URL}
        rel="noreferrer"
        target="_blank"
      >
        <GithubLogoIcon aria-hidden="true" size={17} />
        <StarIcon aria-hidden="true" className="hidden xl:block" size={15} />
        <span className="hidden min-w-4 font-mono text-xs xl:inline" data-testid="github-stars">
          {stars ?? "—"}
        </span>
      </a>
      <ThemeMenu />
      <LanguageMenu />
    </div>
  );
}
