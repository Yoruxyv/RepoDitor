import { GithubLogoIcon, MoonIcon, ShieldCheckIcon, SunIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { useI18n } from "@/app/i18n/context";

import { LanguageMenu } from "./LanguageMenu";

const GITHUB_URL = "https://github.com/Yoruxyv/RepoDitor";
const THEME_KEY = "repoditor-theme";
const VISIBLE_THEME_ICON_CLASS = "is-visible";

type Theme = "dark" | "light";
type Policy = "privacy" | "security" | "terms";

function policyFromHash(): Policy | null {
  const hash = window.location.hash.slice(1);
  return hash === "privacy" || hash === "security" || hash === "terms" ? hash : null;
}

function initialTheme(): Theme {
  const rootTheme = document.documentElement.dataset.theme;
  if (rootTheme === "dark" || rootTheme === "light") {
    return rootTheme;
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeReady = "true";
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#f3f2ed" : "#0d1110");
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function AppHeader() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const { t } = useI18n();

  function toggleTheme(): void {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // The explicit preference still applies for this page when storage is unavailable.
    }
    setTheme(next);
  }

  return (
    <header className="theme-surface border-b border-line bg-app">
      <div className="mx-auto flex min-h-16 w-full max-w-[1280px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:px-8">
        <a
          className="mr-auto inline-flex items-center gap-3 text-ink"
          href="/"
          aria-label={t("app.home")}
        >
          <img alt="" aria-hidden="true" className="size-8 rounded-sm" src="/icon.png" />
          <span className="font-display text-3xl font-semibold uppercase leading-none tracking-tight">
            RepoDitor <span className="text-accent">Web</span>
          </span>
        </a>

        <nav
          aria-label={t("app.application")}
          className="flex flex-wrap items-center justify-end gap-2"
        >
          <a
            className="inline-flex items-center gap-2 rounded-sm px-2.5 py-2 text-sm font-semibold text-secondary transition-colors hover:text-accent"
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
          >
            <GithubLogoIcon aria-hidden="true" size={18} weight="bold" />
            GitHub
          </a>
          <button
            aria-label={t("app.switchTheme", {
              theme: t(theme === "dark" ? "app.light" : "app.dark").toLowerCase(),
            })}
            className="inline-flex items-center gap-2 rounded-sm px-3 py-2 text-sm font-semibold text-secondary transition-colors hover:bg-surface-raised hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={toggleTheme}
            type="button"
          >
            <span aria-hidden="true" className="relative size-[17px] overflow-hidden">
              <MoonIcon
                className={`theme-celestial theme-celestial--moon absolute inset-0 ${
                  theme === "dark" ? VISIBLE_THEME_ICON_CLASS : ""
                }`}
                data-theme-icon="moon"
                size={17}
              />
              <SunIcon
                className={`theme-celestial theme-celestial--sun absolute inset-0 ${
                  theme === "light" ? VISIBLE_THEME_ICON_CLASS : ""
                }`}
                data-theme-icon="sun"
                size={17}
              />
            </span>
            {t(theme === "dark" ? "app.dark" : "app.light")}
          </button>
          <LanguageMenu />
        </nav>
      </div>
    </header>
  );
}

interface PolicyDialogProps {
  readonly policy: Policy | null;
  readonly renderedPolicy: Policy | null;
  readonly setPolicy: Dispatch<SetStateAction<Policy | null>>;
}

function showPolicyDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function hidePolicyDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function PolicyDialog({ policy, renderedPolicy, setPolicy }: PolicyDialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const openFrame = useRef<number | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (openFrame.current !== null) {
      window.cancelAnimationFrame(openFrame.current);
      openFrame.current = null;
    }
    if (policy) {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      showPolicyDialog(dialog);
      if (prefersReducedMotion()) {
        dialog.dataset.state = "open";
      } else {
        delete dialog.dataset.state;
        openFrame.current = window.requestAnimationFrame(() => {
          dialog.dataset.state = "open";
          openFrame.current = null;
        });
      }
      closeRef.current?.focus();
      return;
    }
    if (!dialog.open) return;

    const finishClose = () => {
      hidePolicyDialog(dialog);
      delete dialog.dataset.state;
      previousFocus.current?.focus();
      closeTimer.current = null;
    };
    if (prefersReducedMotion()) finishClose();
    else {
      dialog.dataset.state = "closing";
      closeTimer.current = window.setTimeout(finishClose, 300);
    }
  }, [policy]);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      if (openFrame.current !== null) window.cancelAnimationFrame(openFrame.current);
    },
    [],
  );

  function close(): void {
    const trigger = previousFocus.current;
    if (trigger instanceof HTMLAnchorElement && trigger.hash === window.location.hash) {
      window.history.back();
    } else {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setPolicy(null);
    }
  }

  const title = renderedPolicy ? t(`policies.${renderedPolicy}Title`) : "";
  return (
    <dialog
      aria-labelledby="policy-title"
      aria-modal="true"
      className="policy-dialog theme-surface m-auto w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-sm border border-line bg-surface p-0 text-ink shadow-panel"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      ref={dialogRef}
    >
      {renderedPolicy ? (
        <div className="p-5 sm:p-7">
          <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
                RepoDitor Web
              </p>
              <h2
                className="font-display mt-1 text-4xl font-semibold uppercase leading-none"
                id="policy-title"
              >
                {title}
              </h2>
            </div>
            <button
              aria-label={t("app.closePolicy", { title })}
              className="grid size-10 place-items-center rounded-sm border border-control text-secondary transition-colors hover:border-accent hover:text-accent"
              onClick={close}
              ref={closeRef}
              type="button"
            >
              <XIcon aria-hidden="true" size={18} />
            </button>
          </header>
          <div className="mt-5 grid gap-4 text-sm/6 text-secondary">
            {renderedPolicy === "privacy" ? (
              <>
                <p>{t("policies.privacyOne")}</p>
                <p>{t("policies.privacyTwo")}</p>
              </>
            ) : null}
            {renderedPolicy === "security" ? (
              <>
                <p>{t("policies.securityOne")}</p>
                <p>
                  {t("policies.securityBeforeLink")}{" "}
                  <a
                    className="font-semibold text-accent underline underline-offset-4"
                    href={`${GITHUB_URL}/security/advisories/new`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {t("policies.securityLink")}
                  </a>
                  {t("policies.securityAfterLink")}
                </p>
              </>
            ) : null}
            {renderedPolicy === "terms" ? (
              <>
                <p>{t("policies.termsOne")}</p>
                <p>{t("policies.termsTwo")}</p>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

export function AppFooter() {
  const { t } = useI18n();
  const initialPolicy = policyFromHash();
  const [policy, setPolicy] = useState<Policy | null>(initialPolicy);
  const [renderedPolicy, setRenderedPolicy] = useState<Policy | null>(initialPolicy);

  function selectPolicy(nextPolicy: Policy | null): void {
    if (nextPolicy) setRenderedPolicy(nextPolicy);
    setPolicy(nextPolicy);
  }

  useEffect(() => {
    const syncHash = () => selectPolicy(policyFromHash());
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);
    return () => {
      window.removeEventListener("hashchange", syncHash);
      window.removeEventListener("popstate", syncHash);
    };
  }, []);

  return (
    <footer className="theme-surface border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col flex-wrap gap-3 p-5 text-sm text-secondary sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="inline-flex items-center gap-2">
          <ShieldCheckIcon aria-hidden="true" className="shrink-0 text-accent" size={17} />
          {t("app.footerPrivacy")}
        </p>
        <nav aria-label={t("app.policies")} className="flex flex-wrap gap-x-6 gap-y-2">
          {(["security", "privacy", "terms"] as const).map((entry) => (
            <a
              className="py-1 font-semibold text-secondary transition-colors hover:text-accent"
              href={`#${entry}`}
              key={entry}
              onClick={(event) => {
                event.preventDefault();
                window.history.pushState(null, "", `#${entry}`);
                selectPolicy(entry);
              }}
            >
              {t(`policies.${entry}Title`)}
            </a>
          ))}
          <a
            className="py-1 font-semibold text-secondary transition-colors hover:text-accent"
            href={`${GITHUB_URL}/blob/main/LICENSE`}
            rel="noreferrer"
            target="_blank"
          >
            {t("policies.licenseTitle")}
          </a>
        </nav>
      </div>
      <PolicyDialog policy={policy} renderedPolicy={renderedPolicy} setPolicy={setPolicy} />
    </footer>
  );
}
