import { useRef, useState } from "react";

import type {
  DesktopOperationResult,
  PlayerUpgradeDto,
  SaveOpenResult,
} from "@electron/contracts";
import { AppShell } from "@/app/AppShell";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { usePreferences } from "@/app/preferences";
import { useUiSound } from "@/app/useUiSound";
import { UtilityCluster } from "@/app/UtilityCluster";
import { AssetPreparationView } from "@/features/assets/AssetPreparationView";
import { useAssetPreparation } from "@/features/assets/useAssetPreparation";
import { CosmeticsWorkspace } from "@/features/cosmetics/CosmeticsWorkspace";
import { DiscoveryHome } from "@/features/discovery/components/DiscoveryHome";
import { useEnvironmentDiscovery } from "@/features/discovery/useEnvironmentDiscovery";
import { Workspace, type WorkspaceSection } from "@/features/editor/Workspace";
import { useSaveSession } from "@/features/editor/useSaveSession";
import { GameSafetyDialog } from "@/features/safety/GameSafetyDialog";
import { useGameSafety } from "@/features/safety/useGameSafety";

type AppWorkspace = "run-saves" | "cosmetics";

interface PendingRunEntry {
  readonly opened: SaveOpenResult;
  readonly upgrades: Promise<DesktopOperationResult<PlayerUpgradeDto[]>>;
  readonly requestId: number;
}

const ACTIVE_ASSET_STAGES = new Set([
  "discovering",
  "validating",
  "indexing",
  "resolving",
  "decoding",
]);

function PendingDot({ count, id }: { readonly count: number; readonly id: string }) {
  const { t } = usePreferences();
  if (count === 0) return null;
  return (
    <>
      <span aria-hidden="true" className="ml-2 inline-block size-2 rounded-full bg-warning" />
      <span className="sr-only" id={id}>
        {" · "}
        {t(count === 1 ? "pending.one" : "pending.many", { count })}
      </span>
    </>
  );
}

function AppContent() {
  useUiSound();
  const save = useSaveSession();
  const assets = useAssetPreparation();
  const gameSafety = useGameSafety();
  const { t } = usePreferences();
  const editorContent = useRef<HTMLDivElement>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<AppWorkspace>("run-saves");
  const [activeRunSection, setActiveRunSection] = useState<WorkspaceSection>("overview");
  const [runPendingCount, setRunPendingCount] = useState(0);
  const [cosmeticsPendingCount, setCosmeticsPendingCount] = useState(0);
  const [pendingRunEntry, setPendingRunEntry] = useState<PendingRunEntry | null>(null);
  const [initialUpgradeLoad, setInitialUpgradeLoad] = useState<
    Promise<DesktopOperationResult<PlayerUpgradeDto[]>> | null
  >(null);
  const runEntryRequest = useRef(0);
  const discovery = useEnvironmentDiscovery(
    save.session === null && pendingRunEntry === null,
    gameSafety.recoveryGeneration,
  );
  const safetyRequired =
    save.session !== null || pendingRunEntry !== null || activeWorkspace === "cosmetics";
  const dialogStatus =
    safetyRequired && (gameSafety.status === "running" || gameSafety.status === "unknown")
      ? gameSafety.status
      : null;
  const initialSafetyCheck = safetyRequired && gameSafety.status === null;

  async function openRunSave(saveId: string): Promise<void> {
    const opened = await save.open(saveId);
    if (opened === null) return;

    if (opened.presentationReadiness === "ready") {
      setInitialUpgradeLoad(null);
      save.enter(opened);
      return;
    }

    const requestId = ++runEntryRequest.current;
    const upgrades = window.repoditor.upgrades
      .prepareEntry(opened.session.id, opened.requiredUpgradeVisualKeys)
      .catch(() => ({
        ok: false as const,
        error: {
          code: "internal_error" as const,
          message: "The desktop upgrade bridge failed unexpectedly.",
        },
      }));
    setPendingRunEntry({ opened, upgrades, requestId });
    const result = await upgrades;
    if (runEntryRequest.current !== requestId) return;

    setPendingRunEntry(null);
    setInitialUpgradeLoad(Promise.resolve(result));
    save.enter(opened);
  }

  function continueRunEntry(): void {
    if (pendingRunEntry === null) return;
    runEntryRequest.current += 1;
    setInitialUpgradeLoad(pendingRunEntry.upgrades);
    save.enter(pendingRunEntry.opened);
    setPendingRunEntry(null);
  }

  function closeRunSave(): void {
    runEntryRequest.current += 1;
    setPendingRunEntry(null);
    setInitialUpgradeLoad(null);
    setActiveRunSection("overview");
    save.close();
  }

  return (
    <AppShell>
      <div
        ref={editorContent}
        aria-busy={initialSafetyCheck || (safetyRequired && gameSafety.checking)}
        data-testid="editor-content"
        inert={dialogStatus !== null || initialSafetyCheck}
        tabIndex={-1}
      >
        <nav
          aria-label={t("app.workspaces")}
          className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3"
        >
          <div className="flex gap-2">
            <button
              aria-describedby={runPendingCount > 0 ? "run-saves-pending" : undefined}
              aria-current={activeWorkspace === "run-saves" ? "page" : undefined}
              aria-label={t("app.runSaves")}
              className={`ui-feedback rounded-sm px-4 py-2.5 text-sm font-semibold ${
                activeWorkspace === "run-saves"
                  ? "bg-accent text-accent-ink"
                  : "text-secondary hover:bg-surface hover:text-ink"
              }`}
              type="button"
              onClick={() => setActiveWorkspace("run-saves")}
            >
              {t("app.runSaves")}
              <PendingDot count={runPendingCount} id="run-saves-pending" />
            </button>
            <button
              aria-describedby={cosmeticsPendingCount > 0 ? "cosmetics-pending" : undefined}
              aria-current={activeWorkspace === "cosmetics" ? "page" : undefined}
              aria-label={t("app.cosmetics")}
              className={`ui-feedback rounded-sm px-4 py-2.5 text-sm font-semibold ${
                activeWorkspace === "cosmetics"
                  ? "bg-accent text-accent-ink"
                  : "text-secondary hover:bg-surface hover:text-ink"
              }`}
              type="button"
              onClick={() => setActiveWorkspace("cosmetics")}
            >
              {t("app.cosmetics")}
              <PendingDot count={cosmeticsPendingCount} id="cosmetics-pending" />
            </button>
          </div>
          <UtilityCluster />
        </nav>

        <div hidden={activeWorkspace !== "run-saves"}>
          {pendingRunEntry !== null ? (
            <AssetPreparationView
              state={assets}
              waitingForUpgradeDiscovery={!ACTIVE_ASSET_STAGES.has(assets.stage)}
              onContinue={continueRunEntry}
            />
          ) : save.session === null ? (
            <DiscoveryHome
              discovery={discovery}
              openError={save.error}
              openingSaveId={save.openingSaveId}
              onOpenSave={(saveId) => void openRunSave(saveId)}
            />
          ) : (
            <Workspace
              activeSection={activeRunSection}
              assetState={assets}
              backupPath={save.lastBackupPath}
              initialUpgradeLoad={initialUpgradeLoad}
              saveError={save.saveError}
              saving={save.saving}
              session={save.session}
              onPendingCountChange={setRunPendingCount}
              onActiveSectionChange={setActiveRunSection}
              onClose={closeRunSave}
              onSave={save.write}
            />
          )}
        </div>

        <CosmeticsWorkspace
          hidden={activeWorkspace !== "cosmetics"}
          recoveryGeneration={gameSafety.recoveryGeneration}
          onPendingCountChange={setCosmeticsPendingCount}
        />
      </div>

      {dialogStatus !== null ? (
        <GameSafetyDialog
          status={dialogStatus}
          checking={gameSafety.checking}
          fallbackFocusRef={editorContent}
          onCheckAgain={() => void gameSafety.check()}
          onExit={() => window.close()}
        />
      ) : null}
    </AppShell>
  );
}

function App() {
  return (
    <PreferencesProvider>
      <AppContent />
    </PreferencesProvider>
  );
}

export default App;
