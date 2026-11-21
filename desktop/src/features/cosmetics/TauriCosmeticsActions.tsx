/** MetaSave status and explicit confirmation, independent of catalog rendering. */
import { useRef } from "react";
import { usePreferences } from "@/app/preferences";
import { PendingChangesBar } from "@/features/pending-changes/PendingChangesBar";
import type { useTauriCosmetics } from "./useTauriCosmetics";

const APPROVAL_NEEDED = "cosmetics.saveUnavailable";
const SAVE_CHANGES = "action.saveChanges";

type Meta = ReturnType<typeof useTauriCosmetics>;

export function TauriCosmeticsStatus({ meta }: { readonly meta: Meta }) {
  const { t } = usePreferences();
  const unavailable = meta.state.production && meta.state.state === "idle" && !meta.state.admission;
  return (
    <div
      className="mb-4 space-y-2 text-sm"
      hidden={!unavailable && !meta.saved && !meta.error && !meta.recovery}
      data-testid="meta-status"
      data-state={meta.state.state}
    >
      {unavailable ? <p className="text-warning">{t(APPROVAL_NEEDED)}</p> : null}
      {meta.saved ? (
        <output className="block text-success">
          {t("health.saved")} {t("health.backupVerified")}
        </output>
      ) : null}
      {meta.error ? (
        <p role="alert" className="text-warning">
          {t(meta.error)}
        </p>
      ) : null}
      {meta.recovery ? (
        <button
          type="button"
          className="ui-feedback rounded-sm border border-control px-3 py-2"
          disabled={meta.saving}
          onClick={() => void meta.reconcile()}
        >
          {t("health.reconcile")}
        </button>
      ) : null}
    </div>
  );
}

export function TauriCosmeticsActions({ meta }: { readonly meta: Meta }) {
  const { t } = usePreferences();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const action = meta.intent?.metaCosmetics;
  return (
    <>
      <PendingChangesBar
        edits={meta.pendingEdits}
        saving={meta.saving}
        error={null}
        backupPath={null}
        testIdPrefix="cosmetics"
        reviewPath={meta.state.production ? meta.state.sourcePath : undefined}
        blocked={meta.locked}
        saveUnavailableReason={meta.intent && !meta.state.session ? t(APPROVAL_NEEDED) : null}
        onRevert={meta.revert}
        onSave={() => {
          if (!action || meta.locked || !dialog.current || dialog.current.open) return;
          dialog.current.showModal();
          cancelButton.current?.focus();
        }}
      />
      <dialog
        ref={dialog}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-sm border border-control bg-surface p-4 text-ink backdrop:bg-black/60 sm:p-6"
        aria-labelledby="meta-confirm-title"
        aria-describedby="meta-confirm-description"
      >
        <form method="dialog">
          <h2 id="meta-confirm-title" className="text-lg font-semibold">
            {t(meta.state.production ? SAVE_CHANGES : "cosmetics.confirmTitle")}
          </h2>
          <p className="mt-3 text-sm/6" id="meta-confirm-description">
            {t(
              action?.action === "clearPresets"
                ? "cosmetics.confirmPresets"
                : "cosmetics.confirmOwnership",
              { count: meta.affectedOwnershipCount },
            )}
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <button
              ref={cancelButton}
              type="submit"
              className="ui-feedback rounded-sm border border-control px-3 py-2"
            >
              {t("cosmetics.cancel")}
            </button>
            <button
              type="submit"
              className="ui-feedback rounded-sm bg-accent px-3 py-2 text-accent-ink"
              disabled={meta.locked || !action}
              onClick={() => {
                dialog.current?.close();
                void meta.save();
              }}
            >
              {t(SAVE_CHANGES)}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
