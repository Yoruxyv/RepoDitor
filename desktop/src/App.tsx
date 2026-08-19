import { useRef, useState } from "react";

import type { SaveChange, SaveOpenResult } from "@electron/contracts";
import { AppShell } from "@/app/AppShell";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { usePreferences } from "@/app/preferences";
import { useUiSound } from "@/app/useUiSound";
import { UtilityCluster } from "@/app/UtilityCluster";
import type { TranslationKey } from "@/app/translations";
import { AssetPreparationView } from "@/features/assets/AssetPreparationView";
import { useAssetPreparation } from "@/features/assets/useAssetPreparation";
import { CosmeticsWorkspace } from "@/features/cosmetics/CosmeticsWorkspace";
import { DiscoveryHome } from "@/features/discovery/components/DiscoveryHome";
import { useEnvironmentDiscovery } from "@/features/discovery/useEnvironmentDiscovery";
import { Workspace, type WorkspaceSection } from "@/features/editor/Workspace";
import {
  prepareRunEntryData,
  runEntryDataReusable,
  type RunEntryData,
  type RunEntryTask,
} from "@/features/editor/runEntryPreparation";
import { useSaveSession } from "@/features/editor/useSaveSession";
import { GameSafetyDialog } from "@/features/safety/GameSafetyDialog";
import { useGameSafety } from "@/features/safety/useGameSafety";

type AppWorkspace = "run-saves" | "cosmetics";

interface CachedRunEntry {
  readonly fingerprint: string;
  readonly data: RunEntryData;
}

type PendingRunEntry =
  | {
      readonly phase: "opening-save";
      readonly saveId: string;
      readonly requestId: number;
    }
  | {
      readonly phase: "preparing-entry";
      readonly opened: SaveOpenResult;
      readonly requestId: number;
      readonly awaitingPresentation: boolean;
      readonly pendingTasks: ReadonlySet<RunEntryTask>;
    };

const ACTIVE_ASSET_STAGES = new Set(["indexing", "resolving", "decoding"]);
const RUN_ENTRY_TASK_PRIORITY: readonly RunEntryTask[] = [
  "items",
  "upgrades",
  "players",
  "avatars",
  "run",
  "maps",
];
const RUN_ENTRY_TASK_KEYS: Record<RunEntryTask, TranslationKey> = {
  items: "entry.detail.items",
  upgrades: "entry.detail.upgrades",
  players: "entry.detail.players",
  avatars: "entry.detail.avatars",
  run: "entry.detail.run",
  maps: "entry.detail.maps",
};

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
  const [initialEntryData, setInitialEntryData] = useState<RunEntryData | null>(null);
  const runEntryRequest = useRef(0);
  const runEntryCache = useRef(new Map<string, CachedRunEntry>());
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

  function updatePendingTasks(requestId: number, tasks: ReadonlySet<RunEntryTask>): void {
    if (runEntryRequest.current !== requestId) return;
    setPendingRunEntry((current) =>
      current?.phase === "preparing-entry" && current.requestId === requestId
        ? { ...current, pendingTasks: tasks }
        : current,
    );
  }

  async function openRunSave(saveId: string): Promise<void> {
    const requestId = ++runEntryRequest.current;
    const cachedCandidate = runEntryCache.current.get(saveId) ?? null;
    if (cachedCandidate === null) {
      setPendingRunEntry({ phase: "opening-save", saveId, requestId });
    }

    const opened = await save.open(saveId);
    if (runEntryRequest.current !== requestId) return;
    if (opened === null) {
      setPendingRunEntry(null);
      return;
    }

    const cached =
      cachedCandidate?.fingerprint === opened.session.fingerprint ? cachedCandidate : null;
    if (cached !== null && opened.presentationReadiness === "ready") {
      setPendingRunEntry(null);
      setInitialEntryData(cached.data);
      save.enter(opened);
      return;
    }

    setPendingRunEntry({
      phase: "preparing-entry",
      opened,
      requestId,
      awaitingPresentation: opened.presentationReadiness === "unresolved",
      pendingTasks: new Set(cached === null ? RUN_ENTRY_TASK_PRIORITY : ["upgrades"]),
    });

    const data = await prepareRunEntryData({
      saveId: opened.session.id,
      requiredUpgradeVisualKeys: opened.requiredUpgradeVisualKeys,
      presentationReadiness: opened.presentationReadiness,
      maps: () => window.repoditor.maps.list(),
      existingData: cached?.data ?? null,
      onPendingTasksChange: (tasks) => updatePendingTasks(requestId, tasks),
    });
    if (runEntryRequest.current !== requestId) return;

    if (runEntryDataReusable(data)) {
      runEntryCache.current.set(opened.session.id, {
        fingerprint: opened.session.fingerprint,
        data,
      });
    } else {
      runEntryCache.current.delete(opened.session.id);
    }
    setInitialEntryData(data);
    setPendingRunEntry(null);
    save.enter(opened);
  }

  function closeRunSave(): void {
    runEntryRequest.current += 1;
    setPendingRunEntry(null);
    setInitialEntryData(null);
    setActiveRunSection("overview");
    save.close();
  }

  async function writeRunSave(changes: SaveChange[]) {
    const result = await save.write(changes);
    if (result !== null) runEntryCache.current.delete(result.session.id);
    return result;
  }

  const currentRunEntryTask =
    pendingRunEntry?.phase === "preparing-entry"
      ? RUN_ENTRY_TASK_PRIORITY.find((task) => pendingRunEntry.pendingTasks.has(task)) ?? null
      : null;
  const realAssetPreparation =
    pendingRunEntry?.phase === "preparing-entry" &&
    pendingRunEntry.awaitingPresentation &&
    assets.total !== null &&
    ACTIVE_ASSET_STAGES.has(assets.stage);
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
              mode={realAssetPreparation ? "artwork" : "save"}
              state={assets}
              saveDetail={
                pendingRunEntry.phase === "opening-save"
                  ? t("entry.detail.readingSave")
                  : currentRunEntryTask === null
                    ? t("entry.detail.finalizing")
                    : t(RUN_ENTRY_TASK_KEYS[currentRunEntryTask])
              }
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
              initialEntryData={initialEntryData}
              saveError={save.saveError}
              saving={save.saving}
              session={save.session}
              onPendingCountChange={setRunPendingCount}
              onActiveSectionChange={setActiveRunSection}
              onClose={closeRunSave}
              onSave={writeRunSave}
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
