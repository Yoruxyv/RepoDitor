import { ShieldCheckIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { AppFooter, AppHeader } from "@/app/AppShell";
import { useI18n } from "@/app/i18n/context";
import { I18nProvider } from "@/app/i18n/I18nProvider";
import { SaveFilePanel } from "@/features/save-file/components/SaveFilePanel";

function AppContent() {
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const { t } = useI18n();

  return (
    <div className="theme-surface flex min-h-dvh flex-col bg-app text-ink">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-10 focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-accent-ink"
        href="#main-content"
      >
        {t("app.skip")}
      </a>

      <AppHeader />

      <main
        className={`mx-auto w-full flex-1 ${
          workspaceOpen
            ? "max-w-[1280px] px-5 py-8 sm:px-8 sm:py-10"
            : "grid max-w-6xl items-center gap-10 px-5 py-12 sm:px-8 md:grid-cols-[minmax(0,1.2fr)_minmax(22rem,1fr)] md:py-16 lg:gap-16"
        }`}
        id="main-content"
      >
        {workspaceOpen ? null : (
          <section aria-labelledby="page-title" className="max-w-xl">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">
              {t("save.landing.eyebrow")}
            </p>
            <h1
              aria-label={t("save.landing.title")}
              className="font-display mt-3 text-5xl font-semibold uppercase leading-[0.92] tracking-tight"
              id="page-title"
            >
              <span className="md:block">{t("save.landing.titleOne")} </span>
              <span className="md:block">{t("save.landing.titleTwo")}</span>
            </h1>
            <p className="mt-5 max-w-md text-lg/7 text-secondary">{t("save.landing.noInstall")}</p>

            <div className="mt-9 flex items-center gap-3 border-l-2 border-accent bg-accent-muted px-4 py-3 text-sm/6 text-secondary">
              <ShieldCheckIcon aria-hidden="true" className="shrink-0 text-accent" size={22} />
              <p>{t("save.landing.privacy")}</p>
            </div>
          </section>
        )}

        <SaveFilePanel onWorkspaceChange={setWorkspaceOpen} />
      </main>
      <AppFooter />
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}
