/** Explicit confirmation for the ownership-only bulk lock operation. */
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useI18n } from "@/app/i18n/context";

interface LockAllConfirmationProps {
  readonly open: boolean;
  readonly count: number;
  readonly preservedCount: number;
  readonly busy: boolean;
  readonly stale: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function closeDialog(dialog: HTMLDialogElement | null): void {
  if (!dialog?.open) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

export function LockAllConfirmation({
  open,
  count,
  preservedCount,
  busy,
  stale,
  onCancel,
  onConfirm,
}: LockAllConfirmationProps) {
  const { t, formatNumber } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      closeDialog(dialog);
      return;
    }
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    cancelRef.current?.focus();
  }, [open]);

  function cancel(): void {
    closeDialog(dialogRef.current);
    onCancel();
  }

  function cycleFocus(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "Tab") return;
    if (event.shiftKey && event.currentTarget === cancelRef.current) {
      event.preventDefault();
      (busy || stale ? cancelRef : confirmRef).current?.focus();
    } else if (!event.shiftKey && (event.currentTarget === confirmRef.current || busy || stale)) {
      event.preventDefault();
      cancelRef.current?.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="lock-cosmetics-title"
      aria-describedby="lock-cosmetics-description"
      className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-sm border border-line bg-surface p-5 text-ink shadow-panel backdrop:bg-app/85 sm:p-6"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <h3 className="font-display text-3xl font-semibold uppercase" id="lock-cosmetics-title">
        {t("cosmetics.lockConfirmTitle")}
      </h3>
      <div className="mt-3 space-y-2 text-sm/6 text-secondary" id="lock-cosmetics-description">
        <p>{t("cosmetics.lockConfirmBody", { count: formatNumber(count) }, count)}</p>
        <p>{t("cosmetics.lockRestrictions")}</p>
        {preservedCount > 0 ? (
          <p>
            {t(
              "cosmetics.preservedOwnership",
              { count: formatNumber(preservedCount) },
              preservedCount,
            )}
          </p>
        ) : null}
      </div>
      {busy ? (
        <output className="mt-3 block text-sm text-accent">
          {t("cosmetics.lockBlocked.busy")}
        </output>
      ) : null}
      {stale && !busy ? (
        <output className="mt-3 block text-sm text-accent">{t("cosmetics.lockChanged")}</output>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button
          className="rounded-sm border border-control px-4 py-2.5 text-sm font-semibold hover:border-accent"
          ref={cancelRef}
          onKeyDown={cycleFocus}
          type="button"
          onClick={cancel}
        >
          {t("cosmetics.cancelLock")}
        </button>
        <button
          className="rounded-sm bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink hover:bg-focus disabled:cursor-not-allowed disabled:opacity-60"
          onKeyDown={cycleFocus}
          type="button"
          ref={confirmRef}
          disabled={busy || stale}
          onClick={onConfirm}
        >
          {t("cosmetics.confirmLock", { count: formatNumber(count) }, count)}
        </button>
      </div>
    </dialog>
  );
}
