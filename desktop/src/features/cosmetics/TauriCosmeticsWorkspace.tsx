/** Global Cosmetics presentation with independently admitted MetaSave editing. */
import { ArrowClockwiseIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useEffect, useMemo } from "react";
import type { CosmeticsViewDto } from "@electron/contracts";
import { closeNativeCosmeticArtwork } from "@/app/tauriArtwork";
import { usePreferences } from "@/app/preferences";
import { tauriReadApi } from "@/app/tauriReadApi";
import { AssetPreparationView } from "@/features/assets/AssetPreparationView";
import { INITIAL_STATE } from "@/features/assets/useAssetPreparation";
import {
  GameCompatibilityNotice,
  installedWriteRestriction,
  type CompatibilityEnvironment,
} from "@/features/editor/GameCompatibilityNotice";
import { CosmeticsView } from "./CosmeticsView";
import { sameCosmeticsSource, useCosmeticsRead } from "./useCosmeticsRead";
import { useTauriCosmetics } from "./useTauriCosmetics";
import { TauriCosmeticsActions, TauriCosmeticsStatus } from "./TauriCosmeticsActions";

export function TauriCosmeticsWorkspace({
  active,
  recoveryGeneration,
  onEditingAvailability,
  compatibility,
  onCancel,
}: {
  readonly active: boolean;
  readonly recoveryGeneration: number;
  readonly onEditingAvailability?: (enabled: boolean | null) => void;
  readonly compatibility?: CompatibilityEnvironment | null;
  readonly onCancel?: () => void;
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
  const { view, error, loading, artwork, preparing, replacing, incompatible, refresh } =
    useCosmeticsPresentation(meta, production, recoveryGeneration);
  const action = meta.intent?.metaCosmetics.action;
  const actions = mutationActions(meta);
  const title = t("cosmetics.artwork.title");
  const label = t("app.cosmetics");
  const preparationState = artwork ? { ...INITIAL_STATE, ...artwork } : INITIAL_STATE;
  const progressCopy = artwork ? { progressText: t("entry.artworkCompact", artwork) } : {};
  const showPreparation = active && preparing;
  const issue = compatibilityIssue(incompatible, view, compatibility);
  return (
    <>
      {showPreparation ? (
        <AssetPreparationView
          compact
          state={preparationState}
          progressLabel={title}
          {...progressCopy}
          {...(onCancel ? { onCancel } : {})}
          copyOverrides={{
            title,
            preparing: label,
            detail: t(artwork ? "cosmetics.artwork.scanning" : "cosmetics.loading"),
          }}
        />
      ) : null}
      <section
        aria-label={label}
        data-testid="cosmetics-workspace"
        hidden={!active || showPreparation}
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4 text-xs text-secondary">
          <span className="font-mono text-ink">MetaSave.es3</span>
          <div className="flex items-center gap-4">
            {!preparing && view && (meta.enabled || !loading) ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <ShieldCheckIcon aria-hidden="true" size={15} />
                {t("cosmetics.validatedShort")}
              </span>
            ) : null}
            {view && !preparing ? (
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
        {active &&
        compatibility &&
        !preparing &&
        !meta.authorizationPending &&
        !editing &&
        (view || incompatible) ? (
          <GameCompatibilityNotice
            build={compatibility.healthWriteCompatibility?.buildId}
            issue={issue}
            features={["app.cosmetics"]}
          />
        ) : null}
        {meta.enabled ? <TauriCosmeticsStatus meta={meta} /> : null}
        {view && error ? (
          <p role="alert" className="mb-4 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <fieldset
          disabled={meta.enabled && meta.locked}
          className="m-0 min-w-0 border-0 p-0"
          aria-busy={loading}
        >
          <CosmeticsView
            view={preparing && !replacing ? null : view}
            artworkActive={!preparing}
            knownOwnedCount={view?.knownOwnedCount ?? 0}
            knownLockedCount={view?.knownLockedCount ?? 0}
            savedPresetCount={view?.savedPresetCount ?? 0}
            loading={loading && !preparing}
            error={view ? null : error}
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

function compatibilityIssue(
  incompatible: boolean,
  view: CosmeticsViewDto | null,
  environment?: CompatibilityEnvironment | null,
) {
  if (incompatible || view?.catalogIssue === "incompatible") return "incompatible";
  if (view?.catalogAvailable === false) return "missing";
  return environment ? installedWriteRestriction(environment) : "unknown";
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
    production ? (meta.view?.artworkRevision ?? meta.view?.fingerprint) : undefined,
  );
  const source = cosmetics.view;
  const view = useMemo(
    () => (meta.enabled ? withNativePresentation(meta.view, source) : source),
    [meta.enabled, meta.view, source],
  );
  const loading = meta.enabled ? meta.loading || meta.saving : cosmetics.loading;
  const needsArtwork = production && !source && cosmetics.loading;
  const replacing =
    cosmetics.replacing ||
    Boolean(
      production &&
      cosmetics.loading &&
      source &&
      meta.view &&
      !sameCosmeticsSource(source, meta.view),
    );
  let nativeError = meta.state.state === "blocked" ? t("health.conflict") : null;
  if (meta.state.state === "busy") nativeError = t("health.checking");
  return {
    view,
    loading,
    error: meta.enabled ? nativeError : cosmetics.error,
    artwork: cosmetics.artwork,
    incompatible: cosmetics.incompatible,
    preparing: !meta.saving && !meta.recovery && ((!view && loading) || needsArtwork || replacing),
    replacing,
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

function withNativePresentation(view: CosmeticsViewDto | null, source: CosmeticsViewDto | null) {
  if (!view || !source || !sameCosmeticsSource(source, view)) return view;
  if (
    !view.catalogAvailable &&
    source.catalogAvailable &&
    view.fingerprint === source.fingerprint
  ) {
    return { ...source, capabilities: view.capabilities };
  }
  const rows = new Map(source.cosmetics.map((row) => [row.id, row]));
  return {
    ...view,
    cosmetics: view.cosmetics.map((row) => {
      const prepared = rows.get(row.id);
      return prepared?.known &&
        prepared.iconReuseKey &&
        row.known &&
        prepared.displayName === row.displayName
        ? { ...row, iconToken: prepared.iconToken, iconReuseKey: prepared.iconReuseKey }
        : row;
    }),
  };
}
