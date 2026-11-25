/** Accessible startup/progress presentation for fail-soft installed artwork work. */
import { PackageIcon, WrenchIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useId, useState, type ReactNode } from "react";

import type { AssetPreparationStage, AssetPreparationState } from "@/app/tauri/desktopContracts";
import { usePreferences } from "@/app/preferences/preferences";
import type { Translate, TranslationKey } from "@/app/i18n";
import { INITIAL_ASSET_PREPARATION } from "./assetPreparationState";

const SEGMENT_COUNT = 18;
const PROGRESS_REVEAL_DELAY_MS = 500;
const SLOW_COPY_DELAY_MS = 6_000;

const PREPARATION_TRANSLATION_KEY = {
  progressCount: "assets.progressCount",
  upgradeArtwork: "entry.detail.upgradeArtwork",
  working: "assets.working",
} as const;

const PROGRESS_VISIBILITY_CLASS = {
  hidden: "invisible opacity-0",
  visible: "visible opacity-100",
} as const;

const STAGE_KEYS: Record<AssetPreparationStage, TranslationKey> = {
  idle: "assets.stage.idle",
  discovering: "assets.stage.discovering",
  validating: "assets.stage.validating",
  indexing: "assets.stage.indexing",
  resolving: "assets.stage.resolving",
  decoding: "assets.stage.decoding",
  ready: "assets.stage.ready",
  degraded: "assets.stage.degraded",
};

interface AssetPreparationViewProps {
  readonly children?: ReactNode;
  readonly compact?: boolean;
  readonly copyOverrides?: Partial<PreparationCopy>;
  readonly progressText?: string;
  readonly progressLabel?: string;
  readonly footerText?: readonly [string, string];
  readonly continueImmediately?: boolean;
  readonly continueLabel?: string;
  readonly state?: AssetPreparationState;
  readonly mode?: "save" | "artwork";
  readonly saveDetail?: string;
  readonly editorProgress?: PreparationProgress | null;
  readonly artworkDetail?: boolean;
  readonly onContinue?: () => void;
  readonly onCancel?: () => void;
}

interface PreparationProgress {
  readonly completed: number;
  readonly total: number;
}

function countFilledSegments(progress: PreparationProgress | null, compact: boolean): number {
  if (progress === null) return 0;
  const ratio = progress.total > 0 ? progress.completed / progress.total : 1;
  const segments = Math.min(1, Math.max(0, ratio)) * SEGMENT_COUNT;
  return compact ? Math.floor(segments) : Math.round(segments);
}

interface PreparationCopy {
  readonly localPreparation: string;
  readonly preparing: string;
  readonly title: string;
  readonly detail: string;
  readonly hint: string;
}

function savePreparationCopy(
  state: AssetPreparationState,
  saveDetail: string | undefined,
  artworkDetail: boolean,
  slow: boolean,
  t: Translate,
): PreparationCopy {
  let hint = t(slow ? "entry.slowHint" : "entry.localOnlyHint");
  if (slow && artworkDetail && state.completed !== null && state.total !== null) {
    hint = t("entry.slowArtworkHint", { completed: state.completed, total: state.total });
  }
  let detail = saveDetail ?? t("entry.detail.finalizing");
  if (artworkDetail) detail = t("entry.detail.preparingUpgradeArtwork");
  if (artworkDetail && state.currentAssetLabel !== null) {
    detail = t(PREPARATION_TRANSLATION_KEY.upgradeArtwork, { asset: state.currentAssetLabel });
  }
  return {
    localPreparation: t("entry.localPreparation"),
    preparing: t("entry.preparingEditor"),
    title: t("saves.openingSave"),
    detail,
    hint,
  };
}

function preparationProgress(
  state: AssetPreparationState,
  mode: "save" | "artwork",
  editorProgress: PreparationProgress | null,
): PreparationProgress | null {
  if (mode === "save") return editorProgress;
  if (state.completed === null || state.total === null) return null;
  return { completed: state.completed, total: state.total };
}

function preparationCopy(
  state: AssetPreparationState,
  mode: "save" | "artwork",
  saveDetail: string | undefined,
  artworkDetail: boolean,
  slow: boolean,
  t: Translate,
): PreparationCopy {
  if (mode === "save") return savePreparationCopy(state, saveDetail, artworkDetail, slow, t);

  let detail = t(STAGE_KEYS[state.stage]);
  if (state.currentAssetLabel !== null) {
    detail = t(PREPARATION_TRANSLATION_KEY.upgradeArtwork, { asset: state.currentAssetLabel });
  } else if (state.currentAsset !== null) {
    detail = t("entry.detail.asset", { asset: state.currentAsset });
  }

  const hintKey = slow ? "assets.slowHint" : "assets.localOnlyHint";
  return {
    localPreparation: t("assets.localPreparation"),
    preparing: t("assets.preparingUpgrades"),
    title: t("assets.preparingGame"),
    detail,
    hint: t(hintKey),
  };
}

function PreparationProgressDisplay({
  mode,
  progress,
  t,
  progressText,
  progressLabel,
  compact,
}: {
  readonly mode: "save" | "artwork";
  readonly progress: PreparationProgress | null;
  readonly t: Translate;
  readonly progressText?: string;
  readonly progressLabel?: string;
  readonly compact: boolean;
}) {
  const statusId = useId();
  const filledSegments = countFilledSegments(progress, compact);
  const labelKey = mode === "save" ? "entry.progressLabel" : "assets.progressLabel";
  const countKey =
    mode === "save" ? "entry.progressCount" : PREPARATION_TRANSLATION_KEY.progressCount;
  const { visible, hidden } = PROGRESS_VISIBILITY_CLASS;
  const [workingClass, countClass] = progress === null ? [visible, hidden] : [hidden, visible];
  const progressCount =
    progress === null
      ? ""
      : (progressText ??
        t(countKey, {
          completed: progress.completed,
          total: progress.total,
        }));
  const valueAttributes =
    progress !== null
      ? {
          "aria-valuemin": 0,
          "aria-valuemax": progress.total,
          "aria-valuenow": progress.completed,
          "aria-valuetext": progressCount || undefined,
        }
      : undefined;
  const progressAttributes = {
    role: "progressbar" as const,
    "aria-label": progressLabel ?? t(labelKey),
    "aria-describedby": compact && progress === null && progressText !== "" ? statusId : undefined,
    ...valueAttributes,
  };
  const liveStatus = compact ? { "aria-atomic": true, "aria-live": "polite" as const } : undefined;

  return (
    <div className={compact ? "mt-4" : "mt-7"}>
      <div
        {...progressAttributes}
        className="relative overflow-hidden"
        data-testid="asset-progress"
      >
        <div className="grid grid-cols-18 gap-1">
          {Array.from({ length: SEGMENT_COUNT }, (_, index) => {
            const filled = index < filledSegments;
            return (
              <span
                aria-hidden="true"
                className={`h-3 border border-line ${filled ? "bg-accent" : "bg-surface-raised"}`}
                key={index}
              />
            );
          })}
        </div>
        {progress === null && !compact ? (
          <span
            aria-hidden="true"
            className="asset-preparation-sweep pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-accent-muted"
          />
        ) : null}
      </div>

      {progressText !== "" ? (
        <div
          {...liveStatus}
          className="mt-3 flex min-h-6 items-center justify-end text-xs font-semibold uppercase tracking-[0.12em] text-secondary"
          data-testid="asset-progress-status"
          id={statusId}
        >
          <span className="relative grid min-w-32 text-right">
            <span
              className={`col-start-1 row-start-1 transition-opacity duration-150 motion-reduce:transition-none ${workingClass}`}
            >
              {t(PREPARATION_TRANSLATION_KEY.working)}
            </span>
            <span
              aria-hidden={progress === null}
              className={`col-start-1 row-start-1 transition-opacity duration-150 motion-reduce:transition-none ${countClass}`}
              data-testid={progress === null ? undefined : "asset-progress-count"}
            >
              {progressCount}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function visiblePreparationProgress(
  mode: "save" | "artwork",
  progress: PreparationProgress | null,
  showDetailedProgress: boolean,
): PreparationProgress | null {
  if (mode === "save") return progress;
  return showDetailedProgress ? progress : null;
}

function AssetPreparationFooter({
  mode,
  state,
  footerText,
}: {
  readonly mode: "save" | "artwork";
  readonly state: AssetPreparationState;
  readonly footerText?: readonly [string, string];
}) {
  const { t } = usePreferences();
  if (footerText !== undefined) {
    return (
      <>
        <span>{footerText[0]}</span>
        <span>{footerText[1]}</span>
      </>
    );
  }

  if (mode === "save") {
    return (
      <>
        <span>{t("entry.localSave")}</span>
        <span>{t("entry.editorPreparing")}</span>
      </>
    );
  }

  const installation = state.installationFound
    ? t("assets.installationFound")
    : t("assets.installationPending");
  const build = state.buildVerified ? t("assets.buildVerified") : t("assets.buildPending");

  return (
    <>
      <span>{installation}</span>
      <span className={state.buildVerified ? "text-success" : undefined}>{build}</span>
    </>
  );
}

function PreparationActions({
  compact,
  hint,
  cancel,
  proceed,
  continueLabel,
}: {
  readonly compact: boolean;
  readonly hint: string;
  readonly cancel: (() => void) | undefined;
  readonly proceed: (() => void) | undefined;
  readonly continueLabel: string;
}) {
  const { t } = usePreferences();
  const layout = compact ? "mt-4 flex flex-wrap justify-end gap-2" : "relative mt-5";
  return (
    <div className={layout}>
      {!compact ? <p className="max-w-[58ch] text-sm/6 text-secondary">{hint}</p> : null}
      {cancel ? (
        <button
          className="ui-feedback inline-flex max-w-full items-center rounded-sm border border-control bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          type="button"
          onClick={cancel}
        >
          {t("entry.cancelOpening")}
        </button>
      ) : null}
      {proceed ? (
        <button
          className={`ui-feedback inline-flex items-center rounded-sm border border-accent bg-accent-muted px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-raised ${compact ? "" : "mt-5"}`}
          type="button"
          onClick={proceed}
        >
          {continueLabel}
        </button>
      ) : null}
    </div>
  );
}

export function AssetPreparationView({
  children,
  compact = false,
  state = INITIAL_ASSET_PREPARATION,
  copyOverrides,
  progressText,
  progressLabel,
  footerText,
  continueImmediately = false,
  continueLabel,
  mode = "artwork",
  saveDetail,
  editorProgress = null,
  artworkDetail = false,
  onContinue,
  onCancel,
}: AssetPreparationViewProps) {
  const { t } = usePreferences();
  const progress = preparationProgress(state, mode, editorProgress);
  const hasDetailedProgress = progress !== null;
  const [slow, setSlow] = useState(false);
  const [showDetailedProgress, setShowDetailedProgress] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_COPY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hasDetailedProgress || mode === "save") {
      setShowDetailedProgress(false);
      return;
    }
    const timer = window.setTimeout(() => setShowDetailedProgress(true), PROGRESS_REVEAL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hasDetailedProgress, mode]);

  const visibleProgress = visiblePreparationProgress(mode, progress, showDetailedProgress);
  const copy = {
    ...preparationCopy(state, mode, saveDetail, artworkDetail, slow, t),
    ...copyOverrides,
  };
  const canContinue = compact || continueImmediately || (mode === "artwork" && slow);
  const currentAssetLabel = state.currentAssetLabel;
  const assetValues = currentAssetLabel === null ? {} : { asset: currentAssetLabel };
  const artworkProgressKey =
    currentAssetLabel === null ? "entry.artworkProgressCount" : "entry.artworkProgressAsset";
  const footerOverride = footerText === undefined ? {} : { footerText };

  return (
    <section
      aria-busy={mode === "artwork" ? true : undefined}
      aria-labelledby="asset-preparation-title"
      className="mx-auto grid min-h-96 max-w-4xl place-items-center px-2 py-8"
      data-entry-mode={mode}
      data-testid="asset-preparation"
    >
      <div className="asset-preparation-panel relative w-full overflow-hidden border border-line-strong bg-surface p-5 shadow-2xl sm:p-7">
        <div
          aria-hidden="true"
          className="asset-preparation-scanline pointer-events-none absolute inset-0"
        />
        <header className="relative flex items-center justify-between gap-4 border-b border-line pb-3">
          <div>
            <p className="font-display text-2xl font-semibold uppercase tracking-[0.12em] text-ink">
              RepoDitor
            </p>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              {copy.localPreparation}
            </p>
          </div>
          <div aria-hidden="true" className="text-muted">
            <WrenchIcon className="asset-preparation-tool" size={18} weight="bold" />
          </div>
        </header>

        <div
          className={`relative grid gap-7 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center sm:gap-9 ${compact ? "py-6" : "py-9"}`}
        >
          <div
            aria-hidden="true"
            className="asset-preparation-crate mx-auto grid size-24 place-items-center border border-line-strong bg-surface-raised text-accent"
          >
            <PackageIcon size={48} weight="duotone" />
          </div>

          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-secondary">
              {copy.preparing}
            </p>
            <h1
              aria-live="polite"
              className="font-display mt-1 text-4xl font-semibold uppercase leading-none tracking-[0.02em] text-ink sm:text-5xl"
              id="asset-preparation-title"
              tabIndex={-1}
            >
              {copy.title}
            </h1>
            <output
              className="mt-3 block min-h-6 text-sm font-medium text-secondary"
              data-testid="entry-loading-detail"
            >
              {copy.detail}
            </output>

            <PreparationProgressDisplay
              mode={mode}
              compact={compact}
              progress={visibleProgress}
              {...(progressText === undefined ? {} : { progressText })}
              {...(progressLabel === undefined ? {} : { progressLabel })}
              t={t}
            />
            {children}

            {artworkDetail && state.completed !== null && state.total !== null ? (
              <p className="mt-2 text-right text-xs font-medium text-secondary">
                {t(artworkProgressKey, {
                  completed: state.completed,
                  total: state.total,
                  ...assetValues,
                })}
              </p>
            ) : null}

            <PreparationActions
              compact={compact}
              hint={copy.hint}
              cancel={onCancel}
              proceed={canContinue ? onContinue : undefined}
              continueLabel={continueLabel ?? t("assets.continueEditor")}
            />
          </div>
        </div>

        {!compact ? (
          <footer className="relative flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            <AssetPreparationFooter {...footerOverride} mode={mode} state={state} />
          </footer>
        ) : null}
      </div>
    </section>
  );
}

function noticeKey(state: AssetPreparationState): TranslationKey {
  if (!state.installationFound) return "assets.notice.gameMissing";
  if (!state.buildVerified) return "assets.notice.buildUnverified";
  return "assets.notice.partial";
}

const ACTIVE_STAGES = new Set<AssetPreparationStage>([
  "discovering",
  "validating",
  "indexing",
  "resolving",
  "decoding",
]);

export function AssetPreparationNotice({
  state,
  showPreparing = false,
  onDismiss,
}: {
  readonly state: AssetPreparationState;
  readonly showPreparing?: boolean;
  readonly onDismiss?: (() => void) | undefined;
}) {
  const { t } = usePreferences();
  const preparing = showPreparing && ACTIVE_STAGES.has(state.stage) && !state.degraded;
  if (!state.degraded && !preparing) return null;

  if (preparing) {
    const progress =
      state.completed !== null && state.total !== null
        ? t(PREPARATION_TRANSLATION_KEY.progressCount, {
            completed: state.completed,
            total: state.total,
          })
        : t(PREPARATION_TRANSLATION_KEY.working);
    return (
      <output
        className="mb-5 flex items-start gap-3 border-l-2 border-accent bg-accent-muted px-4 py-3 text-sm text-secondary"
        data-testid="asset-preparation-notice"
      >
        <WrenchIcon
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-accent"
          size={18}
          weight="bold"
        />
        <span>
          <strong className="font-semibold text-ink">{t("assets.notice.preparingTitle")}</strong>{" "}
          {t("assets.notice.preparing", { progress })}
        </span>
      </output>
    );
  }

  const detail = noticeKey(state);
  return (
    <output
      className="mb-5 flex items-start gap-3 border-l-2 border-warning bg-warning-muted px-4 py-3 text-sm text-secondary"
      data-testid="asset-preparation-notice"
    >
      <WarningCircleIcon
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-warning"
        size={18}
        weight="fill"
      />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold text-ink">{t("assets.notice.title")}</strong> {t(detail)}
      </span>
      {onDismiss !== undefined ? (
        <button
          aria-label={t("assets.notice.dismiss")}
          className="ui-feedback -mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-sm text-secondary outline-none hover:bg-surface-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          type="button"
          onClick={onDismiss}
        >
          <XIcon aria-hidden="true" size={16} weight="bold" />
        </button>
      ) : null}
    </output>
  );
}
