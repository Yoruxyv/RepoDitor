import { useEffect, useRef } from "react";

import type { GameProcessStatus } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";

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
  const { t } = usePreferences();
  const checkButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    checkButton.current?.focus();
  }, [status]);

  const title = status === "running"
    ? t("safety.runningTitle")
    : t("safety.unknownTitle");
  const description = status === "running"
    ? t("safety.runningDescription")
    : t("safety.unknownDescription");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-app/90 p-5 backdrop-blur-sm">
      <dialog
        open
        aria-describedby={DESCRIPTION_ID}
        aria-labelledby={TITLE_ID}
        aria-modal="true"
        className="m-0 w-full max-w-xl rounded-md border border-line-strong bg-surface p-6 text-ink shadow-2xl sm:p-8"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-warning">
          {t("safety.label")}
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
            {t(checking ? "safety.checking" : "safety.checkAgain")}
          </button>
          <button
            className="rounded-sm border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            type="button"
            onClick={onExit}
          >
            {t("safety.exit")}
          </button>
        </div>
      </dialog>
    </div>
  );
}
