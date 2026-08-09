import { HardDriveIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

interface AppShellProps {
  readonly children: ReactNode;
}

const PROJECT_URL = "https://github.com/Dendroculus/RepoDitor";

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-app text-ink">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-20 focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink"
        href="#app-content"
      >
        Skip to content
      </a>

      <header className="border-b border-line bg-app/95">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between px-5 sm:px-8">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="font-display text-[1.9rem] font-semibold uppercase leading-none tracking-[-0.02em] text-ink">
              RepoDitor
            </span>
            <span className="hidden truncate text-xs font-medium text-muted sm:inline">
              R.E.P.O. save utility
            </span>
          </div>

          <div className="flex items-center gap-3 text-sm text-secondary">
            <HardDriveIcon aria-hidden="true" size={17} weight="regular" />
            <span className="hidden sm:inline">Local desktop</span>
            <span aria-hidden="true" className="text-line-strong">/</span>
            <span className="font-mono text-xs">v{__APP_VERSION__}</span>
          </div>
        </div>
      </header>

      <main
        className="mx-auto w-full max-w-[1280px] flex-1 px-5 py-8 sm:px-8 sm:py-10"
        id="app-content"
      >
        {children}
      </main>

      <footer aria-label="About RepoDitor" className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-2 px-5 py-4 text-xs/5 text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="flex flex-wrap gap-x-1">
            <span className="font-semibold text-secondary">RepoDitor v{__APP_VERSION__}</span>
            <span aria-hidden="true">·</span>
            <span>Unofficial R.E.P.O. save utility</span>
          </p>
          <p className="flex flex-wrap gap-x-3">
            <a
              className="font-semibold text-secondary hover:text-accent"
              href={PROJECT_URL}
              rel="noreferrer"
              target="_blank"
            >
              Project source
            </a>
            <span>MIT · Teko SIL OFL 1.1</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
