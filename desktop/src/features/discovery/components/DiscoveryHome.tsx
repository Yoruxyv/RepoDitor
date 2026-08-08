import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";

import type { EnvironmentDiscovery } from "@electron/contracts";
import { formatSaveCount } from "@/features/discovery/formatters";
import { useEnvironmentDiscovery } from "@/features/discovery/useEnvironmentDiscovery";
import { DiscoveryFailure, DiscoveryState } from "./DiscoveryState";
import { DiscoveryLoading } from "./DiscoveryLoading";
import { EnvironmentStatus } from "./EnvironmentStatus";
import { LatestSave } from "./LatestSave";
import { RecentSaveList } from "./RecentSaveList";

function getHeadline(environment: EnvironmentDiscovery): string {
  if (environment.gameDetected) {
    return "R.E.P.O. detected";
  }
  if (environment.saveRootDetected && environment.saves.length > 0) {
    return "Local saves detected";
  }
  if (environment.saveRootStatus === "missing") {
    return "Save folder not found";
  }
  if (environment.saveRootStatus === "unreadable") {
    return "Save folder unavailable";
  }
  return "Save folder is ready";
}

function getSummary(environment: EnvironmentDiscovery): string {
  const saveCount = environment.saves.length;

  if (environment.gameDetected && saveCount > 0) {
    return `RepoDitor found the game installation and ${formatSaveCount(saveCount)} on this PC.`;
  }
  if (saveCount > 0) {
    return `RepoDitor found ${formatSaveCount(saveCount)}. The game installation was not detected, but save discovery is ready.`;
  }
  if (environment.saveRootStatus === "available") {
    return "The standard save folder exists, but it does not contain a valid save slot yet.";
  }
  if (environment.saveRootStatus === "missing") {
    return environment.gameDetected
      ? "The game installation is ready. The standard save folder has not been created yet."
      : "RepoDitor checked the standard save location, but the folder was not detected.";
  }
  return "RepoDitor found the save location but could not read its contents.";
}

interface DiscoveryHomeProps {
  readonly onOpenSave: (saveId: string) => void;
  readonly openingSaveId: string | null;
  readonly openError: string | null;
}

export function DiscoveryHome({
  onOpenSave,
  openingSaveId,
  openError,
}: DiscoveryHomeProps) {
  const { data, error, isInitialLoading, isRefreshing, refresh } =
    useEnvironmentDiscovery();

  if (isInitialLoading || (data === null && error === null)) {
    return <DiscoveryLoading />;
  }

  if (data === null && error !== null) {
    return <DiscoveryFailure error={error} onRetry={() => void refresh()} />;
  }

  if (data === null) {
    return null;
  }

  const latestSave = data.saveRootStatus === "available" ? data.saves[0] : undefined;

  return (
    <section aria-busy={isRefreshing} aria-labelledby="discovery-title">
      <header className="flex flex-col gap-6 border-b border-line pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            Automatic local discovery
          </p>
          <h1
            className="font-display mt-3 text-5xl font-semibold uppercase leading-[0.9] tracking-tight text-ink sm:text-6xl"
            id="discovery-title"
          >
            {getHeadline(data)}
          </h1>
          <p className="mt-4 max-w-[62ch] text-sm/6 text-secondary">
            {getSummary(data)}
          </p>
        </div>

        <button
          className="inline-flex w-fit shrink-0 items-center gap-2 rounded-sm border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition duration-150 hover:border-accent hover:text-accent active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isRefreshing}
          type="button"
          onClick={() => void refresh()}
        >
          <ArrowClockwiseIcon
            aria-hidden="true"
            className={isRefreshing ? "animate-spin motion-reduce:animate-none" : undefined}
            size={17}
            weight="bold"
          />
          {isRefreshing ? "Refreshing" : "Refresh"}
        </button>
      </header>

      {error !== null && (
        <output
          className="mt-5 flex items-start gap-3 border-l-2 border-warning bg-warning-muted px-4 py-3 text-sm text-secondary"
        >
          <WarningCircleIcon
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-warning"
            size={18}
            weight="fill"
          />
          <p>
            Refresh failed. Showing the last discovery result. {error.message}
          </p>
        </output>
      )}

      {openError !== null && (
        <div
          className="mt-5 flex items-start gap-3 border-l-2 border-danger bg-surface px-4 py-3 text-sm text-secondary"
          role="alert"
        >
          <WarningCircleIcon
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-danger"
            size={18}
            weight="fill"
          />
          <p>{openError} No save files were changed.</p>
        </div>
      )}

      <div className="grid gap-8 pt-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
        <div className="min-w-0 space-y-8">
          {latestSave === undefined ? (
            <DiscoveryState saveRoot={data.saveRoot} status={data.saveRootStatus} />
          ) : (
            <>
              <LatestSave
                isDisabled={openingSaveId !== null}
                isOpening={openingSaveId === latestSave.id}
                save={latestSave}
                onOpen={onOpenSave}
              />
              <RecentSaveList
                openingSaveId={openingSaveId}
                saves={data.saves}
                onOpen={onOpenSave}
              />
            </>
          )}
        </div>

        <EnvironmentStatus environment={data} />
      </div>
    </section>
  );
}
