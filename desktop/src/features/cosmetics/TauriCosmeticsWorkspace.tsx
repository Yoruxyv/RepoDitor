/** Global Cosmetics presentation with independently admitted MetaSave editing. */
import { ArrowClockwiseIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import type { CosmeticsViewDto } from "@electron/contracts";
import { closeNativeCosmeticArtwork } from "@/app/tauriArtwork";
import { usePreferences } from "@/app/preferences";
import { tauriReadApi } from "@/app/tauriReadApi";
import { AssetPreparationView } from "@/features/assets/AssetPreparationView";
import { INITIAL_STATE } from "@/features/assets/useAssetPreparation";
import { CosmeticsView } from "./CosmeticsView";
import { useCosmeticsRead } from "./useCosmeticsRead";
import { useTauriCosmetics } from "./useTauriCosmetics";
import { TauriCosmeticsActions, TauriCosmeticsStatus } from "./TauriCosmeticsActions";

export function TauriCosmeticsWorkspace({
  active,
  recoveryGeneration,
  onEditingAvailability,
}: {
  readonly active: boolean;
  readonly recoveryGeneration: number;
  readonly onEditingAvailability?: (enabled: boolean | null) => void;
}) {
  const { t } = usePreferences();
  useEffect(() => (active ? closeNativeCosmeticArtwork : undefined), [active]);
  const meta = useTauriCosmetics(active, recoveryGeneration);
  const production = active && meta.state.production === true && meta.enabled;
  const editing = active && meta.enabled && meta.state.admission !== null;
  useEffect(() => {
    onEditingAvailability?.(meta.authorizationPending ? null : editing);
    return () => onEditingAvailability?.(null);
  }, [meta.authorizationPending, editing, onEditingAvailability]);
  const { view, error, loading, artwork, preparing, refresh } = useCosmeticsPresentation(
    meta,
    production,
    recoveryGeneration,
  );
  const action = meta.intent?.metaCosmetics.action;
  const actions = mutationActions(meta);
  const title = t("cosmetics.artwork.title");
  const label = t("app.cosmetics");
  const preparationState = artwork ? { ...INITIAL_STATE, ...artwork } : INITIAL_STATE;
  const progressCopy = artwork ? { progressText: t("entry.artworkCompact", artwork) } : {};
  return (
    <>
      {active && preparing ? (
        <AssetPreparationView
          compact
          state={preparationState}
          progressLabel={title}
          {...progressCopy}
          copyOverrides={{
            title,
            preparing: label,
            detail: t("cosmetics.artwork.checking"),
          }}
        />
      ) : null}
      <section aria-label={label} data-testid="cosmetics-workspace" hidden={!active || preparing}>
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
        {meta.enabled ? <TauriCosmeticsStatus meta={meta} /> : null}
        <fieldset
          disabled={meta.enabled && meta.locked}
          className="m-0 min-w-0 border-0 p-0"
          aria-busy={loading}
        >
          <CosmeticsView
            view={view}
            artworkActive={active && !preparing}
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
    </>
  );
}

function useCosmeticsPresentation(
  meta: ReturnType<typeof useTauriCosmetics>,
  production: boolean,
  recoveryGeneration: number,
) {
  const { t } = usePreferences();
  const cosmetics = useCosmeticsRead(
    meta.readOnlyReady || (production && !meta.authorizationPending),
    recoveryGeneration,
    tauriReadApi.cosmetics.get,
    production ? meta.view?.fingerprint : undefined,
  );
  const artwork = cosmetics.loading ? null : cosmetics.view;
  const view = meta.enabled ? withNativeArtwork(meta.view, artwork) : cosmetics.view;
  const loading = meta.enabled ? meta.loading || meta.saving : cosmetics.loading;
  let nativeError = meta.state.state === "blocked" ? t("health.conflict") : null;
  if (meta.state.state === "busy") nativeError = t("health.checking");
  return {
    view,
    loading,
    error: meta.enabled ? nativeError : cosmetics.error,
    artwork: cosmetics.artwork,
    preparing: !meta.saving && !meta.recovery && (loading || (production && cosmetics.loading)),
    refresh() {
      void (meta.enabled ? meta.reload() : cosmetics.reload());
    },
  };
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

function withNativeArtwork(view: CosmeticsViewDto | null, source: CosmeticsViewDto | null) {
  if (!view || source?.fingerprint !== view.fingerprint) return view;
  const icons = new Map(
    source.cosmetics.map(({ id, iconToken, iconReuseKey }) => [id, { iconToken, iconReuseKey }]),
  );
  return {
    ...view,
    cosmetics: view.cosmetics.map((row) => ({ ...row, ...icons.get(row.id) })),
  };
}
