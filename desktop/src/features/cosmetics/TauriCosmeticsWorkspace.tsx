/** Global native Cosmetics composition; only the shared read-only presentation is mounted. */
import { ArrowClockwiseIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { usePreferences } from "@/app/preferences";
import { tauriReadApi } from "@/app/tauriReadApi";
import { CosmeticsView } from "./CosmeticsView";
import { useCosmeticsRead } from "./useCosmeticsRead";

export function TauriCosmeticsWorkspace({
  active,
  recoveryGeneration,
}: {
  readonly active: boolean;
  readonly recoveryGeneration: number;
}) {
  const { t } = usePreferences();
  const cosmetics = useCosmeticsRead(active, recoveryGeneration, tauriReadApi.cosmetics.get);
  return (
    <section aria-label={t("app.cosmetics")} data-testid="cosmetics-workspace" hidden={!active}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4 text-xs text-secondary">
        <span className="font-mono text-ink">MetaSave.es3</span>
        <div className="flex items-center gap-4">
          {cosmetics.view ? (
            <span className="inline-flex items-center gap-1.5 text-success">
              <ShieldCheckIcon aria-hidden="true" size={15} />
              {t("cosmetics.validatedShort")}
            </span>
          ) : null}
          {cosmetics.view ? (
            <button
              className="ui-feedback inline-flex items-center gap-2 rounded-sm border border-control px-3 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent disabled:opacity-50"
              disabled={cosmetics.loading}
              type="button"
              onClick={() => void cosmetics.reload()}
            >
              <ArrowClockwiseIcon aria-hidden="true" size={16} />
              {t(cosmetics.loading ? "action.refreshing" : "action.refresh")}
            </button>
          ) : null}
        </div>
      </div>
      <CosmeticsView
        view={cosmetics.view}
        knownOwnedCount={cosmetics.view?.knownOwnedCount ?? 0}
        knownLockedCount={cosmetics.view?.knownLockedCount ?? 0}
        savedPresetCount={cosmetics.view?.savedPresetCount ?? 0}
        loading={cosmetics.loading}
        error={cosmetics.error}
        unlockAllPending={false}
        lockAllPending={false}
        clearAllPresetsPending={false}
        hasPendingEdits={false}
        hasBulkPending={false}
        saving={false}
        lockAllBlockedReason={null}
        onRetry={() => void cosmetics.reload()}
        onUnlockAll={null}
        onUnlockCosmetic={null}
        onClearAllPresets={null}
        onLockAll={null}
      />
    </section>
  );
}
