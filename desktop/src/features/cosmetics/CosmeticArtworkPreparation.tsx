/** Cosmetic progress presentation reusing the editor's existing preparation screen. */
import { PackageIcon } from "@phosphor-icons/react";

import type { AssetPreparationState, CosmeticArtworkPreparationState } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { AssetPreparationView } from "@/features/assets/AssetPreparationView";

interface CosmeticArtworkPreparationProps {
  readonly state: CosmeticArtworkPreparationState;
  readonly compact: boolean;
  readonly onContinueInBackground: () => void;
  readonly onShowProgress: () => void;
}

function cosmeticPhaseToAssetStage(
  phase: CosmeticArtworkPreparationState["phase"],
): AssetPreparationState["stage"] {
  switch (phase) {
    case "checking":
      return "validating";
    case "preparing":
      return "decoding";
    case "degraded":
      return "degraded";
    case "ready":
      return "ready";
    default:
      return "idle";
  }
}

function toAssetPreparationState(state: CosmeticArtworkPreparationState): AssetPreparationState {
  return {
    stage: cosmeticPhaseToAssetStage(state.phase),
    installationFound: true,
    buildVerified: true,
    completed: state.total > 0 ? Math.min(state.total, Math.max(0, state.completed)) : null,
    total: state.total > 0 ? state.total : null,
    currentAsset: null,
    currentAssetLabel: null,
    degraded: state.phase === "degraded",
  };
}

export function CosmeticArtworkPreparation({
  state,
  compact,
  onContinueInBackground,
  onShowProgress,
}: CosmeticArtworkPreparationProps) {
  const { t } = usePreferences();
  if (state.phase === "idle" || state.phase === "ready") return null;

  const count = t("cosmetics.artwork.count", {
    completed: Math.max(0, state.completed),
    total: Math.max(0, state.total),
  });
  let detail = t("cosmetics.artwork.scanning");
  if (state.phase === "degraded") {
    detail = t("cosmetics.artwork.degraded");
  } else if (state.phase === "checking") {
    detail = t("cosmetics.artwork.checking");
  }

  if (compact || state.phase === "degraded") {
    return (
      <section
        aria-label={t("cosmetics.artwork.title")}
        className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line-strong bg-surface px-4 py-3"
        data-testid="cosmetic-artwork-compact"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm text-secondary">
          <PackageIcon aria-hidden="true" className="shrink-0 text-accent" size={19} />
          <span className="font-semibold text-ink">{t("cosmetics.artwork.title")}</span>
          <span aria-live="polite" className="font-mono text-xs tabular-nums">
            {state.phase === "checking" ? detail : count}
          </span>
        </span>
        {state.phase !== "degraded" ? (
          <button
            className="ui-feedback rounded-sm border border-control px-3 py-2 text-xs font-semibold text-ink hover:border-accent"
            type="button"
            onClick={onShowProgress}
          >
            {t("cosmetics.artwork.expand")}
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <div
      className="grid min-h-[min(35rem,calc(100dvh-13rem))] place-items-center"
      data-testid="cosmetic-artwork-preparation"
    >
      <AssetPreparationView
        mode="artwork"
        state={toAssetPreparationState(state)}
        copyOverrides={{
          localPreparation: t("assets.localPreparation"),
          preparing: t("assets.localPreparation"),
          title: t("cosmetics.artwork.title"),
          detail,
          hint: t("cosmetics.artwork.hint"),
        }}
        {...(state.total > 0 ? { progressText: count } : {})}
        progressLabel={t("cosmetics.artwork.title")}
        footerText={[detail, t("cosmetics.artwork.title")]}
        continueImmediately
        continueLabel={t("cosmetics.artwork.background")}
        onContinue={onContinueInBackground}
      />
    </div>
  );
}
