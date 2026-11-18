/** Localized save/recovery status for the explicitly authorized synthetic health editor. */
import { useEffect, useRef } from "react";
import type { PlayerDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import type { TranslationKey } from "@/app/i18n";
import type { HealthPhase, useTauriHealth } from "./useTauriHealth";

const TEST_LABEL = "health.testOnly";
const LABELS: Record<HealthPhase, TranslationKey> = {
  checking: "health.checking",
  disabled: TEST_LABEL,
  editing: TEST_LABEL,
  saving: "status.savingSafely",
  reconciling: "health.reconciling",
  recovery: "health.recovery",
  saved: "health.saved",
  rejected: "health.rejected",
  unchanged: "health.unchanged",
  conflict: "health.conflict",
};
const ERRORS: Record<string, TranslationKey> = {
  save_stale: "error.saveStale",
  save_missing: "error.saveMissing",
  game_running: "error.gameRunning",
  game_status_unknown: "error.gameUnknown",
  save_in_use: "health.fileInUse",
  save_verification_unavailable: "health.verificationUnavailable",
  save_unsupported: "health.unsupportedBuild",
  write_conflict: LABELS.conflict,
  save_validation_failed: "error.saveInvalid",
};

const STATUS = "health.status";

function statusLabel(health: ReturnType<typeof useTauriHealth>): TranslationKey {
  if (health.production && health.phase === "editing") return STATUS;
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
  player,
}: {
  readonly health: ReturnType<typeof useTauriHealth>;
  readonly player: PlayerDto | null;
}) {
  const { t } = usePreferences();
  const region = useRef<HTMLElement>(null);
  useEffect(() => {
    if (["saved", "rejected", "recovery", "unchanged", "conflict"].includes(health.phase)) {
      region.current?.focus({ preventScroll: true });
    }
  }, [health.phase]);
  if (!health.enabled) return null;
  const working = health.phase === "saving" || health.phase === "reconciling";
  const problem = ["rejected", "recovery", "conflict"].includes(health.phase);
  return (
    <section
      ref={region}
      aria-label={t(STATUS)}
      tabIndex={-1}
      className="my-4 min-w-0 rounded-sm border border-line bg-surface px-4 py-3 text-sm"
      data-testid="health-status"
      data-phase={health.phase}
      data-operation-id={health.operationId ?? ""}
      aria-busy={working}
    >
      <p
        className={problem ? "font-semibold text-danger" : "font-semibold text-ink"}
        role={problem ? "alert" : "status"}
      >
        {t(statusLabel(health))}
      </p>
      {health.reason && ERRORS[health.reason] ? (
        <p className="mt-1 text-xs text-secondary">{t(ERRORS[health.reason]!)}</p>
      ) : null}
      {player ? (
        <p className="mt-1 text-xs text-secondary" data-testid="health-persisted">
          {t("health.persisted", {
            name: player.name,
            health: player.health,
            max: player.maxHealth,
          })}
        </p>
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
