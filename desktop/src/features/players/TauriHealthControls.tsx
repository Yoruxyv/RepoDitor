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
  save_validation_failed: "error.saveInvalid",
};

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
      aria-label={t("health.status")}
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
        {t(
          health.phase === "recovery" &&
            health.pending &&
            health.pendingOperationId !== health.operationId
            ? "health.otherOperation"
            : LABELS[health.phase],
        )}
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
      {health.phase === "recovery" ||
      health.phase === "conflict" ||
      health.phase === "unchanged" ? (
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
