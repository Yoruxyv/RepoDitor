import { ShieldCheckIcon } from "@phosphor-icons/react";

import { usePreferences } from "@/app/preferences";
import { CosmeticsView } from "@/features/cosmetics/CosmeticsView";
import { useCosmetics } from "@/features/cosmetics/useCosmetics";
import { PendingChangesBar } from "@/features/editor/PendingChangesBar";

interface CosmeticsWorkspaceProps {
  readonly hidden: boolean;
  readonly recoveryGeneration: number;
}

export function CosmeticsWorkspace({ hidden, recoveryGeneration }: CosmeticsWorkspaceProps) {
  const { t } = usePreferences();
  const cosmetics = useCosmetics(!hidden, recoveryGeneration);

  return (
    <section aria-label={t("app.cosmetics")} data-testid="cosmetics-workspace" hidden={hidden}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-10">
        <div className="min-w-0">
          <CosmeticsView
            clearAllPresetsPending={cosmetics.clearAllPresetsPending}
            error={cosmetics.loadError}
            knownLockedCount={cosmetics.knownLockedCount}
            knownOwnedCount={cosmetics.knownOwnedCount}
            lockAllBlockedReason={cosmetics.lockAllBlockedReason}
            lockAllPending={cosmetics.lockAllPending}
            loading={cosmetics.loading}
            savedPresetCount={cosmetics.savedPresetCount}
            unlockAllPending={cosmetics.unlockAllPending}
            view={cosmetics.view}
            onClearAllPresets={cosmetics.clearAllPresets}
            onLockAll={cosmetics.lockAll}
            onRetry={() => void cosmetics.reload()}
            onUnlockAll={cosmetics.unlockAll}
          />
        </div>

        <aside
          aria-label={t("cosmetics.context")}
          className="min-w-0 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0"
        >
          <p className="text-sm font-semibold text-ink">{t("workspace.source")}</p>
          <p className="mt-3 font-mono text-xs text-muted">MetaSave.es3</p>
          <div className="mt-6 flex items-start gap-2 border-t border-line pt-5 text-xs/5 text-secondary">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 shrink-0 text-success" size={17} />
            <p>{t("cosmetics.validated")}</p>
          </div>
        </aside>
      </div>

      <PendingChangesBar
        backupPath={cosmetics.pendingEdits.length === 0 ? cosmetics.backupPath : null}
        edits={cosmetics.pendingEdits}
        error={cosmetics.writeError}
        saving={cosmetics.saving}
        testIdPrefix="cosmetics"
        onRevert={cosmetics.revertAll}
        onSave={() => void cosmetics.save()}
      />
    </section>
  );
}
