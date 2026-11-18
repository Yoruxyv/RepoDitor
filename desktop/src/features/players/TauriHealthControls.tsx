/** Save and recovery feedback for the native Run editor. */
import { useEffect, useRef } from "react";
import { usePreferences } from "@/app/preferences";
import type { TranslationKey } from "@/app/i18n";
import type { HealthPhase, useTauriHealth } from "./useTauriHealth";

const CONFLICT = "health.conflict";
const LABELS: Partial<Record<HealthPhase, TranslationKey>> = {
  reconciling: "health.reconciling",
  recovery: "health.recovery",
  saved: "health.saved",
  rejected: "health.rejected",
  unchanged: "health.unchanged",
  conflict: CONFLICT,
};
const ERRORS: Record<string, TranslationKey> = {
  save_stale: "error.saveStale",
  save_missing: "error.saveMissing",
  game_running: "error.gameRunning",
  game_status_unknown: "error.gameUnknown",
  save_in_use: "health.fileInUse",
  save_verification_unavailable: "health.verificationUnavailable",
  save_unsupported: "health.unsupportedBuild",
  write_conflict: CONFLICT,
  save_validation_failed: "error.saveInvalid",
};

function statusLabel(health: ReturnType<typeof useTauriHealth>): TranslationKey | undefined {
  if (
    health.phase === "recovery" &&
    health.healthEdits.length > 0 &&
    health.pendingOperationId !== health.operationId
  ) {
    return "health.otherOperation";
  }
  return LABELS[health.phase];
}

function showRecoveryAction(health: ReturnType<typeof useTauriHealth>): boolean {
  return (
    ["recovery", "conflict", "unchanged"].includes(health.phase) &&
    !(health.draftOnly && health.operationId)
  );
}

export function TauriHealthControls({
  health,
}: {
  readonly health: ReturnType<typeof useTauriHealth>;
}) {
  const { t } = usePreferences();
  const region = useRef<HTMLElement>(null);
  useEffect(() => {
    if (["saved", "rejected", "recovery", "unchanged", "conflict"].includes(health.phase)) {
      region.current?.focus({ preventScroll: true });
    }
  }, [health.phase]);
  if (!health.enabled) return null;
  const problem = ["rejected", "recovery", "conflict"].includes(health.phase);
  const label = statusLabel(health);
  return (
    <section
      ref={region}
      tabIndex={-1}
      className="my-4 text-sm"
      hidden={!label}
      data-testid="health-status"
      data-phase={health.phase}
      data-operation-id={health.operationId ?? ""}
    >
      <p
        className={problem ? "font-semibold text-danger" : "font-semibold text-ink"}
        role={problem ? "alert" : "status"}
      >
        {label ? t(label) : null}
      </p>
      {health.reason && ERRORS[health.reason] ? (
        <p className="mt-1 text-xs text-secondary">{t(ERRORS[health.reason]!)}</p>
      ) : null}
      {health.backupVerified ? (
        <p className="mt-1 text-xs text-success">{t("health.backupVerified")}</p>
      ) : null}
      {showRecoveryAction(health) ? (
        <button
          className="ui-feedback mt-3 rounded-sm border border-control px-3 py-2 font-semibold text-ink hover:border-accent disabled:opacity-50"
          type="button"
          onClick={() => {
            if (health.operationId) void health.recover();
            else health.refresh();
          }}
        >
          {t(health.operationId ? "health.reconcile" : "health.recheck")}
        </button>
      ) : null}
      {health.phase === "rejected" ? (
        <button
          type="button"
          className="ui-feedback mt-3 rounded-sm border border-control px-3 py-2 font-semibold text-ink hover:border-accent"
          onClick={health.refresh}
        >
          {t("health.refresh")}
        </button>
      ) : null}
    </section>
  );
}
