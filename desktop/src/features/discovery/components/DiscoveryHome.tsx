import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";

import type { EnvironmentDiscovery } from "../../../../electron/contracts.cts";
import { useEnvironmentDiscovery } from "../hooks/useEnvironmentDiscovery";
import { formatSaveCount } from "../utils/formatters";
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

export function DiscoveryHome() {
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

  const hasSaves = data.saveRootStatus === "available" && data.saves.length > 0;

  return (
    <section aria-busy={isRefreshing} aria-labelledby="discovery-title">
      <header className="flex flex-col gap-6 border-b border-line pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            Automatic local discovery
          </p>
          <h1
            className="font-display mt-3 text-5xl font-semibold uppercase leading-[0.9] tracking-[-0.025em] text-ink sm:text-6xl"
            id="discovery-title"
          >
            {getHeadline(data)}
          </h1>
          <p className="mt-4 max-w-[62ch] text-sm leading-6 text-secondary">
            {getSummary(data)}
          </p>
        </div>

        <button
          className="inline-flex w-fit shrink-0 items-center gap-2 rounded-sm border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition duration-150 hover:border-accent hover:text-accent active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isRefreshing}
          type="button"
          onClick={() => void refresh()}
        >
          <ArrowClockwise
            aria-hidden="true"
            className={isRefreshing ? "animate-spin motion-reduce:animate-none" : undefined}
            size={17}
            weight="bold"
          />
          {isRefreshing ? "Refreshing" : "Refresh"}
        </button>
      </header>

      {error !== null && (
        <div
          className="mt-5 flex items-start gap-3 border-l-2 border-warning bg-warning-muted px-4 py-3 text-sm text-secondary"
          role="status"
        >
          <WarningCircle
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-warning"
            size={18}
            weight="fill"
          />
          <p>
            Refresh failed. Showing the last discovery result. {error.message}
          </p>
        </div>
      )}

      <div className="grid gap-8 pt-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
        <div className="min-w-0 space-y-8">
          {hasSaves ? (
            <>
              <LatestSave save={data.saves[0]} />
              <RecentSaveList saves={data.saves} />
            </>
          ) : (
            <DiscoveryState saveRoot={data.saveRoot} status={data.saveRootStatus} />
          )}
        </div>

        <EnvironmentStatus environment={data} />
      </div>
    </section>
  );
}
