import { useRef, useState } from "react";

import type { SaveChange, SaveOpenResult } from "@electron/contracts";
import { AppShell } from "@/app/AppShell";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { usePreferences } from "@/app/preferences";
import { useUiSound } from "@/app/useUiSound";
import { UtilityCluster } from "@/app/UtilityCluster";
import type { Translate, TranslationKey } from "@/app/translations";
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

interface WorkspaceTabsProps {
  readonly activeWorkspace: AppWorkspace;
  readonly cosmeticsPendingCount: number;
  readonly runPendingCount: number;
  readonly onChange: (workspace: AppWorkspace) => void;
}

function WorkspaceTabs({
  activeWorkspace,
  cosmeticsPendingCount,
  runPendingCount,
  onChange,
}: WorkspaceTabsProps) {
  const { t } = usePreferences();
  const runActive = activeWorkspace === "run-saves";
  const cosmeticsActive = activeWorkspace === "cosmetics";

  return (
    <nav
      aria-label={t("app.workspaces")}
      className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3"
    >
      <div className="flex gap-2">
        <button
          aria-describedby={runPendingCount > 0 ? "run-saves-pending" : undefined}
          aria-current={runActive ? "page" : undefined}
          aria-label={t("app.runSaves")}
          className={`ui-feedback rounded-sm px-4 py-2.5 text-sm font-semibold ${
            runActive
              ? "bg-accent text-accent-ink"
              : "text-secondary hover:bg-surface hover:text-ink"
          }`}
          type="button"
          onClick={() => onChange("run-saves")}
        >
          {t("app.runSaves")}
          <PendingDot count={runPendingCount} id="run-saves-pending" />
        </button>
        <button
          aria-describedby={cosmeticsPendingCount > 0 ? "cosmetics-pending" : undefined}
          aria-current={cosmeticsActive ? "page" : undefined}
          aria-label={t("app.cosmetics")}
          className={`ui-feedback rounded-sm px-4 py-2.5 text-sm font-semibold ${
            cosmeticsActive
              ? "bg-accent text-accent-ink"
              : "text-secondary hover:bg-surface hover:text-ink"
          }`}
          type="button"
          onClick={() => onChange("cosmetics")}
        >
          {t("app.cosmetics")}
          <PendingDot count={cosmeticsPendingCount} id="cosmetics-pending" />
        </button>
      </div>
      <UtilityCluster />
    </nav>
  );
}

interface RunSavesWorkspaceProps {
  readonly active: boolean;
  readonly activeSection: WorkspaceSection;
  readonly assets: ReturnType<typeof useAssetPreparation>;
  readonly currentTask: RunEntryTask | null;
  readonly discovery: ReturnType<typeof useEnvironmentDiscovery>;
  readonly initialEntryData: RunEntryData | null;
  readonly pendingEntry: PendingRunEntry | null;
  readonly realAssetPreparation: boolean;
  readonly save: ReturnType<typeof useSaveSession>;
  readonly onActiveSectionChange: (section: WorkspaceSection) => void;
  readonly onClose: () => void;
  readonly onOpenSave: (saveId: string) => void;
  readonly onPendingCountChange: (count: number) => void;
  readonly onSave: ReturnType<typeof useSaveSession>["write"];
}

function runSaveDetail(
  pendingEntry: PendingRunEntry,
  currentTask: RunEntryTask | null,
  t: Translate,
): string {
  if (pendingEntry.phase === "opening-save") return t("entry.detail.readingSave");
  if (currentTask === null) return t("entry.detail.finalizing");
  return t(RUN_ENTRY_TASK_KEYS[currentTask]);
}

function RunSavesWorkspace({
  active,
  activeSection,
  assets,
  currentTask,
  discovery,
  initialEntryData,
  pendingEntry,
  realAssetPreparation,
  save,
  onActiveSectionChange,
  onClose,
  onOpenSave,
  onPendingCountChange,
  onSave,
}: RunSavesWorkspaceProps) {
  const { t } = usePreferences();

  if (pendingEntry !== null) {
    return (
      <div hidden={!active}>
        <AssetPreparationView
          mode={realAssetPreparation ? "artwork" : "save"}
          state={assets}
          saveDetail={runSaveDetail(pendingEntry, currentTask, t)}
        />
      </div>
    );
  }

  if (save.session === null) {
    return (
      <div hidden={!active}>
        <DiscoveryHome
          discovery={discovery}
          openError={save.error}
          openingSaveId={save.openingSaveId}
          onOpenSave={onOpenSave}
        />
      </div>
    );
  }

  return (
    <div hidden={!active}>
      <Workspace
        activeSection={activeSection}
        assetState={assets}
        backupPath={save.lastBackupPath}
        initialEntryData={initialEntryData}
        saveError={save.saveError}
        saving={save.saving}
        session={save.session}
        onPendingCountChange={onPendingCountChange}
        onActiveSectionChange={onActiveSectionChange}
        onClose={onClose}
        onSave={onSave}
      />
    </div>
  );
}

function currentRunEntryTask(pendingEntry: PendingRunEntry | null): RunEntryTask | null {
  if (pendingEntry?.phase !== "preparing-entry") return null;
  return RUN_ENTRY_TASK_PRIORITY.find((task) => pendingEntry.pendingTasks.has(task)) ?? null;
}

function isRealAssetPreparation(
  pendingEntry: PendingRunEntry | null,
  assets: ReturnType<typeof useAssetPreparation>,
): boolean {
  return (
    pendingEntry?.phase === "preparing-entry" &&
    pendingEntry.awaitingPresentation &&
    assets.total !== null &&
    ACTIVE_ASSET_STAGES.has(assets.stage)
  );
}

function AppContent() {
  useUiSound();
  const save = useSaveSession();
  const assets = useAssetPreparation();
  const gameSafety = useGameSafety();
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

  const currentTask = currentRunEntryTask(pendingRunEntry);
  const realAssetPreparation = isRealAssetPreparation(pendingRunEntry, assets);
  return (
    <AppShell>
      <div
        ref={editorContent}
        aria-busy={initialSafetyCheck || (safetyRequired && gameSafety.checking)}
        data-testid="editor-content"
        inert={dialogStatus !== null || initialSafetyCheck}
        tabIndex={-1}
      >
        <WorkspaceTabs
          activeWorkspace={activeWorkspace}
          cosmeticsPendingCount={cosmeticsPendingCount}
          runPendingCount={runPendingCount}
          onChange={setActiveWorkspace}
        />

        <RunSavesWorkspace
          active={activeWorkspace === "run-saves"}
          activeSection={activeRunSection}
          assets={assets}
          currentTask={currentTask}
          discovery={discovery}
          initialEntryData={initialEntryData}
          pendingEntry={pendingRunEntry}
          realAssetPreparation={realAssetPreparation}
          save={save}
          onActiveSectionChange={setActiveRunSection}
          onClose={closeRunSave}
          onOpenSave={(saveId) => void openRunSave(saveId)}
          onPendingCountChange={setRunPendingCount}
          onSave={writeRunSave}
        />

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
