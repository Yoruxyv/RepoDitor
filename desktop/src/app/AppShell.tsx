import { HardDrive } from "@phosphor-icons/react";
import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-[100dvh] bg-app text-ink">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-20 focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink"
        href="#discovery-home"
      >
        Skip to discovery
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

          <div className="flex items-center gap-2 text-sm text-secondary">
            <HardDrive aria-hidden="true" size={17} weight="regular" />
            <span className="hidden sm:inline">Local desktop</span>
          </div>
        </div>
      </header>

      <main
        className="mx-auto w-full max-w-[1280px] px-5 py-8 sm:px-8 sm:py-10"
        id="discovery-home"
      >
        {children}
      </main>
    </div>
  );
}
