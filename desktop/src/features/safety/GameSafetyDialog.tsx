import { useEffect, useRef } from "react";

import type { GameProcessStatus } from "@electron/contracts";

interface GameSafetyDialogProps {
  readonly status: Exclude<GameProcessStatus, "not_running">;
  readonly checking: boolean;
  readonly onCheckAgain: () => void;
  readonly onExit: () => void;
}

const TITLE_ID = "game-safety-title";
const DESCRIPTION_ID = "game-safety-description";

export function GameSafetyDialog({
  status,
  checking,
  onCheckAgain,
  onExit,
}: GameSafetyDialogProps) {
  const checkButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    checkButton.current?.focus();
  }, [status]);

  const title = status === "running"
    ? "R.E.P.O. is currently running"
    : "RepoDitor could not verify that R.E.P.O. is closed.";
  const description = status === "running"
    ? "Close the game before editing saves. R.E.P.O. can keep save state in memory and write it later, which can make RepoDitor read stale data or overwrite changes unexpectedly."
    : "RepoDitor cannot safely enable save editing until it can confirm the validated R.E.P.O. installation is closed.";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-app/90 p-5 backdrop-blur-sm">
      <section
        aria-describedby={DESCRIPTION_ID}
        aria-labelledby={TITLE_ID}
        aria-modal="true"
        className="w-full max-w-xl rounded-md border border-line-strong bg-surface p-6 shadow-2xl sm:p-8"
        role="dialog"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-warning">
          Save safety
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-ink" id={TITLE_ID}>{title}</h1>
        <p className="mt-4 text-sm/6 text-secondary" id={DESCRIPTION_ID}>{description}</p>

        <div className="mt-7 flex flex-wrap gap-3">
          <button
            ref={checkButton}
            className="rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60"
            disabled={checking}
            type="button"
            onClick={onCheckAgain}
          >
            {checking ? "Checking…" : "Check Again"}
          </button>
          <button
            className="rounded-sm border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            type="button"
            onClick={onExit}
          >
            Exit RepoDitor
          </button>
        </div>
      </section>
    </div>
  );
}
