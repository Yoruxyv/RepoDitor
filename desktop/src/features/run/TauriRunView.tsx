/** Bind the shared Run presentation to synthetic-only drafts and recovery. */
import { usePreferences } from "@/app/preferences";
import type { useTauriHealth } from "@/features/players/useTauriHealth";
import { RunView } from "./RunView";
import type { useRunState } from "./useRunState";

export function TauriRunView({
  run,
  transaction,
}: {
  readonly run: ReturnType<typeof useRunState>;
  readonly transaction: ReturnType<typeof useTauriHealth>;
}) {
  const { t } = usePreferences();
  const { enabled, locked } = transaction;
  return (
    <fieldset className="min-w-0" disabled={enabled && locked}>
      <legend className="sr-only">{t("nav.run")}</legend>
      <RunView
        run={run.run}
        loading={run.loading}
        error={run.error}
        pendingByField={Object.fromEntries(transaction.runEdits.map((edit) => [edit.field, edit]))}
        resetVersion={transaction.resetVersion}
        precisionNotice={enabled}
        onValidityChange={enabled ? transaction.setRunInvalid : undefined}
        onStatChange={
          enabled
            ? (stat, value) =>
                transaction.editRun({
                  feature: "run",
                  entity: "run",
                  field: stat.key,
                  before: stat.value,
                  after: value,
                  label: stat.label,
                  subject: "Run",
                })
            : null
        }
        onResumeChange={
          enabled && run.run
            ? (value) =>
                transaction.editRun({
                  feature: "run",
                  entity: "run",
                  field: "resumeLocation",
                  before: run.run!.resumeLocation.value,
                  after: value,
                  label: t("run.resumeLocation"),
                  subject: "Run",
                })
            : null
        }
        onRevert={enabled ? transaction.revertRun : null}
        onRetry={() => void run.reload()}
      />
    </fieldset>
  );
}
