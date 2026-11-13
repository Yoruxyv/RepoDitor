/** Global Cosmetics presentation with independently admitted synthetic MetaSave editing. */
import { ArrowClockwiseIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import { closeNativeCosmeticArtwork, useCosmeticArtworkActivity } from "@/app/tauriArtwork";
import { usePreferences } from "@/app/preferences";
import { tauriReadApi } from "@/app/tauriReadApi";
import { CosmeticsView } from "./CosmeticsView";
import { useCosmeticsRead } from "./useCosmeticsRead";
import { useTauriCosmetics } from "./useTauriCosmetics";
import { TauriCosmeticsActions, TauriCosmeticsStatus } from "./TauriCosmeticsActions";

function CosmeticArtworkStatus() {
  const { t } = usePreferences();
  const decoding = useCosmeticArtworkActivity();
  return (
    <p className="mb-4 text-sm text-secondary" data-testid="cosmetic-artwork-status">
      {t(decoding ? "cosmetics.decodingVisible" : "cosmetics.visibleArtwork")}
    </p>
  );
}

function CosmeticsPreparationStatus({
  validating,
  hasCatalog,
  hasRetainedView,
}: {
  readonly validating: boolean;
  readonly hasCatalog: boolean;
  readonly hasRetainedView: boolean;
}) {
  const { t } = usePreferences();
  const message = hasRetainedView ? "cosmetics.revalidating" : "cosmetics.validating";
  return (
    <>
      <output className={validating ? "mb-4 block text-sm text-secondary" : undefined}>
        {validating ? t(message) : null}
      </output>
      {hasCatalog ? <CosmeticArtworkStatus /> : null}
    </>
  );
}

export function TauriCosmeticsWorkspace({
  active,
  recoveryGeneration,
}: {
  readonly active: boolean;
  readonly recoveryGeneration: number;
}) {
  const { t } = usePreferences();
  useEffect(() => (active ? closeNativeCosmeticArtwork : undefined), [active]);
  const meta = useTauriCosmetics(active, recoveryGeneration);
  const cosmetics = useCosmeticsRead(
    meta.readOnlyReady,
    recoveryGeneration,
    tauriReadApi.cosmetics.get,
  );
  const view = meta.enabled ? meta.view : cosmetics.view;
  const loading = meta.enabled ? meta.loading || meta.saving : cosmetics.loading;
  const action = meta.intent?.metaCosmetics.action;
  let nativeError = meta.state.state === "blocked" ? t("health.conflict") : null;
  if (meta.state.state === "busy") nativeError = t("health.checking");
  const error = meta.enabled ? nativeError : cosmetics.error;
  const actions = mutationActions(meta);
  function refresh() {
    void (meta.enabled ? meta.reload() : cosmetics.reload());
  }
  return (
    <section aria-label={t("app.cosmetics")} data-testid="cosmetics-workspace" hidden={!active}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4 text-xs text-secondary">
        <span className="font-mono text-ink">MetaSave.es3</span>
        <div className="flex items-center gap-4">
          {view && (meta.enabled || !loading) ? (
            <span className="inline-flex items-center gap-1.5 text-success">
              <ShieldCheckIcon aria-hidden="true" size={15} />
              {t("cosmetics.validatedShort")}
            </span>
          ) : null}
          {view ? (
            <button
              className="ui-feedback inline-flex items-center gap-2 rounded-sm border border-control px-3 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent disabled:opacity-50"
              disabled={loading || !!meta.intent || meta.recovery}
              type="button"
              onClick={refresh}
            >
              <ArrowClockwiseIcon aria-hidden="true" size={16} />
              {t(loading ? "action.refreshing" : "action.refresh")}
            </button>
          ) : null}
        </div>
      </div>
      <CosmeticsPreparationStatus
        validating={active && loading && !meta.saving && !meta.recovery}
        hasCatalog={active && !loading && !error && (view?.catalogAvailable ?? false)}
        hasRetainedView={view !== null}
      />
      {meta.enabled ? <TauriCosmeticsStatus meta={meta} /> : null}
      <fieldset
        disabled={meta.enabled && meta.locked}
        className="m-0 min-w-0 border-0 p-0"
        aria-busy={loading}
      >
        <CosmeticsView
          view={view}
          artworkActive={active}
          artworkPending={!meta.enabled && loading}
          knownOwnedCount={view?.knownOwnedCount ?? 0}
          knownLockedCount={view?.knownLockedCount ?? 0}
          savedPresetCount={view?.savedPresetCount ?? 0}
          loading={loading}
          error={error}
          unlockAllPending={action === "unlockAll"}
          lockAllPending={action === "lockAll"}
          clearAllPresetsPending={action === "clearPresets"}
          hasPendingEdits={!!meta.intent}
          hasBulkPending={!!meta.intent && action !== "unlockIds"}
          saving={meta.saving}
          lockAllBlockedReason={meta.lockAllBlockedReason}
          onRetry={refresh}
          {...actions}
        />
      </fieldset>
      {meta.enabled ? <TauriCosmeticsActions meta={meta} /> : null}
    </section>
  );
}

function mutationActions(meta: ReturnType<typeof useTauriCosmetics>) {
  if (!meta.state.admission || !meta.state.session || !meta.enabled)
    return {
      onUnlockAll: null,
      onUnlockCosmetic: null,
      onClearAllPresets: null,
      onLockAll: null,
    };
  return {
    onUnlockAll: () => meta.stage("unlockAll"),
    onUnlockCosmetic: (id: number) => meta.stage("unlockIds", id),
    onClearAllPresets: () => meta.stage("clearPresets"),
    onLockAll: () => meta.stage("lockAll"),
  };
}
