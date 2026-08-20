import { PackageIcon, WrenchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import type { AssetPreparationStage, AssetPreparationState } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import type { Translate, TranslationKey } from "@/app/translations";

const SEGMENT_COUNT = 18;
const PROGRESS_REVEAL_DELAY_MS = 500;
const SLOW_COPY_DELAY_MS = 6_000;

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
  readonly state: AssetPreparationState;
  readonly mode?: "save" | "artwork";
  readonly saveDetail?: string;
  readonly onContinue?: () => void;
}

interface PreparationProgress {
  readonly completed: number;
  readonly total: number;
}

function countFilledSegments(progress: PreparationProgress | null): number {
  if (progress === null) return 0;
  const ratio = progress.total > 0 ? progress.completed / progress.total : 1;
  return Math.round(Math.min(1, Math.max(0, ratio)) * SEGMENT_COUNT);
}

interface PreparationCopy {
  readonly localPreparation: string;
  readonly preparing: string;
  readonly title: string;
  readonly detail: string;
  readonly hint: string;
}

function preparationProgress(
  state: AssetPreparationState,
  mode: "save" | "artwork",
): PreparationProgress | null {
  if (mode !== "artwork" || state.completed === null || state.total === null) return null;
  return { completed: state.completed, total: state.total };
}

function preparationCopy(
  state: AssetPreparationState,
  mode: "save" | "artwork",
  saveDetail: string | undefined,
  slow: boolean,
  t: Translate,
): PreparationCopy {
  if (mode === "save") {
    const hintKey = slow ? "entry.slowHint" : "entry.localOnlyHint";
    return {
      localPreparation: t("entry.localPreparation"),
      preparing: t("entry.preparingEditor"),
      title: t("entry.readingPreparingSave"),
      detail: saveDetail ?? t("entry.detail.finalizing"),
      hint: t(hintKey),
    };
  }

  let detail = t(STAGE_KEYS[state.stage]);
  if (state.currentAssetLabel !== null) {
    detail = t("entry.detail.upgradeArtwork", { asset: state.currentAssetLabel });
  } else if (state.currentAsset !== null) {
    detail = t("entry.detail.asset", { asset: state.currentAsset });
  }

  const hintKey = slow ? "assets.slowHint" : "assets.localOnlyHint";
  return {
    localPreparation: t("assets.localPreparation"),
    preparing: t("assets.preparingUpgrades"),
    title: t("entry.decodingGameAssets"),
    detail,
    hint: t(hintKey),
  };
}

function PreparationProgressDisplay({
  progress,
  t,
}: {
  readonly progress: PreparationProgress | null;
  readonly t: Translate;
}) {
  const filledSegments = countFilledSegments(progress);
  const progressAttributes =
    progress === null
      ? {}
      : {
          role: "progressbar" as const,
          "aria-label": t("assets.progressLabel"),
          "aria-valuemin": 0,
          "aria-valuemax": progress.total,
          "aria-valuenow": progress.completed,
          "aria-valuetext": t("assets.progressCount", {
            completed: progress.completed,
            total: progress.total,
          }),
        };
  const workingClass = progress === null ? "visible opacity-100" : "invisible opacity-0";
  const countClass = progress !== null ? "visible opacity-100" : "invisible opacity-0";
  const progressCount =
    progress === null
      ? ""
      : t("assets.progressCount", {
          completed: progress.completed,
          total: progress.total,
        });

  return (
    <div className="mt-7">
      <div
        {...progressAttributes}
        className="relative overflow-hidden"
        data-testid="asset-progress"
      >
        <div className="grid grid-cols-18 gap-1">
          {Array.from({ length: SEGMENT_COUNT }, (_, index) => {
            const filled = progress !== null && index < filledSegments;
            return (
              <span
                aria-hidden="true"
                className={`h-3 border border-line ${filled ? "bg-accent" : "bg-surface-raised"}`}
                key={index}
              />
            );
          })}
        </div>
        {progress === null ? (
          <span
            aria-hidden="true"
            className="asset-preparation-sweep pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-accent-muted"
          />
        ) : null}
      </div>

      <div
        className="mt-3 flex min-h-6 items-center justify-end text-xs font-semibold uppercase tracking-[0.12em] text-secondary"
        data-testid="asset-progress-status"
      >
        <span className="relative grid min-w-32 text-right">
          <span
            className={`col-start-1 row-start-1 transition-opacity duration-150 motion-reduce:transition-none ${workingClass}`}
          >
            {t("assets.working")}
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
    </div>
  );
}

function AssetPreparationFooter({
  mode,
  state,
}: {
  readonly mode: "save" | "artwork";
  readonly state: AssetPreparationState;
}) {
  const { t } = usePreferences();

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

export function AssetPreparationView({
  state,
  mode = "artwork",
  saveDetail,
  onContinue,
}: AssetPreparationViewProps) {
  const { t } = usePreferences();
  const progress = preparationProgress(state, mode);
  const hasDetailedProgress = progress !== null;
  const [slow, setSlow] = useState(false);
  const [showDetailedProgress, setShowDetailedProgress] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_COPY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hasDetailedProgress) {
      setShowDetailedProgress(false);
      return;
    }
    const timer = window.setTimeout(() => setShowDetailedProgress(true), PROGRESS_REVEAL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hasDetailedProgress]);

  const visibleProgress = showDetailedProgress ? progress : null;
  const copy = preparationCopy(state, mode, saveDetail, slow, t);

  return (
    <section
      aria-busy={true}
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

        <div className="relative grid gap-7 py-9 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center sm:gap-9">
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
            >
              {copy.title}
            </h1>
            <p
              aria-live="polite"
              className="mt-3 min-h-6 text-sm font-medium text-secondary"
              data-testid="entry-loading-detail"
            >
              {copy.detail}
            </p>

            <PreparationProgressDisplay progress={visibleProgress} t={t} />

            <p className="mt-5 max-w-[58ch] text-sm/6 text-secondary">{copy.hint}</p>
            {mode === "artwork" && slow && onContinue !== undefined ? (
              <button
                className="ui-feedback mt-5 inline-flex items-center rounded-sm border border-accent bg-accent-muted px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-raised"
                type="button"
                onClick={onContinue}
              >
                {t("assets.continueEditor")}
              </button>
            ) : null}
          </div>
        </div>

        <footer className="relative flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          <AssetPreparationFooter mode={mode} state={state} />
        </footer>
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
}: {
  readonly state: AssetPreparationState;
  readonly showPreparing?: boolean;
}) {
  const { t } = usePreferences();
  const preparing = showPreparing && ACTIVE_STAGES.has(state.stage) && !state.degraded;
  if (!state.degraded && !preparing) return null;

  if (preparing) {
    const progress =
      state.completed !== null && state.total !== null
        ? t("assets.progressCount", { completed: state.completed, total: state.total })
        : t("assets.working");
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
      <span>
        <strong className="font-semibold text-ink">{t("assets.notice.title")}</strong> {t(detail)}
      </span>
    </output>
  );
}
