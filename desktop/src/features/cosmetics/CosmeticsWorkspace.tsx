import { ShieldCheckIcon } from "@phosphor-icons/react";
import { useEffect } from "react";

import { usePreferences } from "@/app/preferences";
import { CosmeticsView } from "@/features/cosmetics/CosmeticsView";
import { useCosmetics } from "@/features/cosmetics/useCosmetics";
import { PendingChangesBar } from "@/features/editor/PendingChangesBar";

interface CosmeticsWorkspaceProps {
  readonly hidden: boolean;
  readonly recoveryGeneration: number;
  readonly onPendingCountChange: (count: number) => void;
}

export function CosmeticsWorkspace({
  hidden,
  recoveryGeneration,
  onPendingCountChange,
}: CosmeticsWorkspaceProps) {
  const { t } = usePreferences();
  const cosmetics = useCosmetics(!hidden, recoveryGeneration);

  useEffect(() => {
    onPendingCountChange(cosmetics.pendingEdits.length);
    return () => onPendingCountChange(0);
  }, [cosmetics.pendingEdits.length, onPendingCountChange]);

  return (
    <section aria-label={t("app.cosmetics")} data-testid="cosmetics-workspace" hidden={hidden}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4 text-xs text-secondary">
        <span className="font-mono text-ink">MetaSave.es3</span>
        <span className="inline-flex items-center gap-1.5 text-success">
          <ShieldCheckIcon aria-hidden="true" size={15} />
          {t("cosmetics.validatedShort")}
        </span>
      </div>
      <div>
        <div className="min-w-0">
          <CosmeticsView
            clearAllPresetsPending={cosmetics.clearAllPresetsPending}
            error={cosmetics.loadError}
            hasBulkPending={cosmetics.hasBulkPending}
            hasPendingEdits={cosmetics.hasPendingEdits}
            knownLockedCount={cosmetics.knownLockedCount}
            knownOwnedCount={cosmetics.knownOwnedCount}
            lockAllBlockedReason={cosmetics.lockAllBlockedReason}
            saving={cosmetics.saving}
            lockAllPending={cosmetics.lockAllPending}
            loading={cosmetics.loading}
            savedPresetCount={cosmetics.savedPresetCount}
            unlockAllPending={cosmetics.unlockAllPending}
            view={cosmetics.view}
            onClearAllPresets={cosmetics.clearAllPresets}
            onLockAll={cosmetics.lockAll}
            onRetry={() => void cosmetics.reload()}
            onUnlockAll={cosmetics.unlockAll}
            onUnlockCosmetic={cosmetics.unlockCosmetic}
          />
        </div>
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
