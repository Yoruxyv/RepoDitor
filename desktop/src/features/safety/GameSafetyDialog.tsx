/**
 * Modal fail-closed interruption for running or unverifiable game-process state.
 * Owns focus trapping/restoration only; status authority remains Python-owned.
 */
import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";

import type { GameProcessStatus } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";

interface GameSafetyDialogProps {
  readonly status: Exclude<GameProcessStatus, "not_running">;
  readonly checking: boolean;
  readonly fallbackFocusRef: RefObject<HTMLElement | null>;
  readonly onCheckAgain: () => void;
  readonly onExit: () => void;
}

const TITLE_ID = "game-safety-title";
const DESCRIPTION_ID = "game-safety-description";

export function GameSafetyDialog({
  status,
  checking,
  fallbackFocusRef,
  onCheckAgain,
  onExit,
}: GameSafetyDialogProps) {
  const { t } = usePreferences();
  const dialog = useRef<HTMLDialogElement>(null);
  const checkButton = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    const fallbackFocus = fallbackFocusRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;

    if (!modal.open) modal.showModal();
    (checkButton.current?.disabled ? exitButton.current : checkButton.current)?.focus();

    return () => {
      if (modal.open) modal.close();
      queueMicrotask(() => {
        if (modal.open) return;
        const returnTarget =
          previouslyFocused?.isConnected && !previouslyFocused.closest("[inert]")
            ? previouslyFocused
            : fallbackFocus;
        if (returnTarget?.isConnected && !returnTarget.closest("[inert]")) returnTarget.focus();
      });
    };
  }, [fallbackFocusRef]);

  const title = status === "running" ? t("safety.runningTitle") : t("safety.unknownTitle");
  const description =
    status === "running" ? t("safety.runningDescription") : t("safety.unknownDescription");

  function containFocus(event: KeyboardEvent<HTMLDialogElement>): void {
    if (event.key !== "Tab") return;
    const first = checkButton.current?.disabled ? exitButton.current : checkButton.current;
    const last = exitButton.current;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-describedby={DESCRIPTION_ID}
      aria-labelledby={TITLE_ID}
      aria-modal="true"
      className="game-safety-dialog m-auto w-[calc(100%-2.5rem)] max-w-xl rounded-md border border-line-strong bg-surface p-6 text-ink shadow-2xl sm:p-8"
      onCancel={(event) => {
        event.preventDefault();
        (checkButton.current?.disabled ? exitButton.current : checkButton.current)?.focus();
      }}
      onKeyDown={containFocus}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-warning">
        {t("safety.label")}
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-ink" id={TITLE_ID}>
        {title}
      </h1>
      <p className="mt-4 text-sm/6 text-secondary" id={DESCRIPTION_ID}>
        {description}
      </p>

      <div className="mt-7 flex flex-wrap gap-3">
        <button
          ref={checkButton}
          className="ui-feedback rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60"
          disabled={checking}
          type="button"
          onClick={onCheckAgain}
        >
          {t(checking ? "safety.checking" : "safety.checkAgain")}
        </button>
        <button
          ref={exitButton}
          className="ui-feedback rounded-sm border border-control px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          type="button"
          onClick={onExit}
        >
          {t("safety.exit")}
        </button>
      </div>
    </dialog>
  );
}
