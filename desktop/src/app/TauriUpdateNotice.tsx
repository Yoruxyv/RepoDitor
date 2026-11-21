import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { usePreferences } from "@/app/preferences";
import { checkForUpdate, dismissUpdate } from "./tauriRelease";

export function TauriUpdateNotice() {
  const { t } = usePreferences();
  const [release, setRelease] = useState<Awaited<ReturnType<typeof checkForUpdate>>>(null);
  useEffect(() => {
    let active = true;
    void checkForUpdate().then((result) => {
      if (active) setRelease(result);
    });
    return () => {
      active = false;
    };
  }, []);

  const title = release ? t("update.available", { version: release.version }) : "";
  return (
    <>
      <span aria-live="polite" className="sr-only">
        {title}
      </span>
      {release && (
        <section
          aria-label={title}
          className="fixed inset-x-4 bottom-4 z-10 ml-auto max-w-sm rounded-sm border border-line bg-surface-raised p-4 text-sm text-ink shadow-lg"
        >
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-secondary">{t("update.description")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              className="ui-feedback inline-flex items-center gap-1 rounded-sm bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:brightness-110"
              href={release.url}
              rel="noreferrer"
              target="_blank"
            >
              {t("update.viewRelease")}
              <ArrowUpRightIcon aria-hidden="true" size={14} />
            </a>
            <button
              className="ui-feedback rounded-sm border border-control px-3 py-1.5 font-semibold text-secondary hover:bg-surface hover:text-ink"
              type="button"
              onClick={() => {
                dismissUpdate(release.version);
                setRelease(null);
              }}
            >
              {t("update.later")}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
