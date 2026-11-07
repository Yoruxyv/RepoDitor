/** Synthetic MetaSave status and explicit confirmation, independent of catalog rendering. */
import { useRef } from "react";
import { usePreferences } from "@/app/preferences";
import { PendingChangesBar } from "@/features/pending-changes/PendingChangesBar";
import type { useTauriCosmetics } from "./useTauriCosmetics";

const UNAVAILABLE = "cosmetics.syntheticUnavailable";

type Meta = ReturnType<typeof useTauriCosmetics>;

export function TauriCosmeticsStatus({ meta }: { readonly meta: Meta }) {
  const { t } = usePreferences();
  return (
    <div className="mb-4 space-y-2 text-sm" data-testid="meta-status" data-state={meta.state.state}>
      {!meta.state.admission ? <p className="text-warning">{t(UNAVAILABLE)}</p> : null}
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
  const action = meta.intent?.metaCosmetics;
  const affected =
    action?.action === "unlockIds"
      ? action.ids.length
      : (meta.state.view?.cosmetics.filter(
          (c) =>
            c.known && c.mutationEligible && (action?.action === "lockAll" ? c.owned : !c.owned),
        ).length ?? 0);
  return (
    <>
      <PendingChangesBar
        edits={meta.pendingEdits}
        saving={meta.saving}
        error={null}
        backupPath={null}
        testIdPrefix="cosmetics"
        blocked={meta.locked}
        saveUnavailableReason={meta.state.session ? null : t(UNAVAILABLE)}
        onRevert={meta.revert}
        onSave={() => dialog.current?.showModal()}
      />
      <dialog
        ref={dialog}
        className="max-w-lg rounded-sm border border-control bg-surface p-6 text-ink backdrop:bg-black/60"
        aria-labelledby="meta-confirm-title"
      >
        <form method="dialog">
          <h2 id="meta-confirm-title" className="text-lg font-semibold">
            {t("cosmetics.confirmTitle")}
          </h2>
          <p className="mt-3 text-sm/6">
            {t(
              action?.action === "clearPresets"
                ? "cosmetics.confirmPresets"
                : "cosmetics.confirmOwnership",
              { count: affected },
            )}
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="submit"
              className="ui-feedback rounded-sm border border-control px-3 py-2"
            >
              {t("cosmetics.cancel")}
            </button>
            <button
              type="submit"
              className="ui-feedback rounded-sm bg-accent px-3 py-2 text-accent-ink"
              disabled={meta.locked}
              onClick={() => {
                dialog.current?.close();
                void meta.save();
              }}
            >
              {t("action.saveChanges")}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
