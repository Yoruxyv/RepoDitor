import { useState } from "react";

import { AppShell } from "@/app/AppShell";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { usePreferences } from "@/app/preferences";
import { UtilityCluster } from "@/app/UtilityCluster";
import { CosmeticsWorkspace } from "@/features/cosmetics/CosmeticsWorkspace";
import { DiscoveryHome } from "@/features/discovery/components/DiscoveryHome";
import { Workspace } from "@/features/editor/Workspace";
import { useSaveSession } from "@/features/editor/useSaveSession";
import { GameSafetyDialog } from "@/features/safety/GameSafetyDialog";
import { useGameSafety } from "@/features/safety/useGameSafety";

type AppWorkspace = "run-saves" | "cosmetics";

function AppContent() {
  const save = useSaveSession();
  const gameSafety = useGameSafety();
  const { t } = usePreferences();
  const [activeWorkspace, setActiveWorkspace] = useState<AppWorkspace>("run-saves");
  const dialogStatus =
    gameSafety.status === "running" || gameSafety.status === "unknown" ? gameSafety.status : null;
  const initialSafetyCheck = gameSafety.status === null;

  return (
    <AppShell>
      <div
        aria-busy={initialSafetyCheck || gameSafety.checking}
        data-testid="editor-content"
        inert={dialogStatus !== null || initialSafetyCheck}
      >
        <nav
          aria-label={t("app.workspaces")}
          className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3"
        >
          <div className="flex gap-2">
            <button
              aria-current={activeWorkspace === "run-saves" ? "page" : undefined}
              className={`rounded-sm px-4 py-2.5 text-sm font-semibold transition duration-150 ${
                activeWorkspace === "run-saves"
                  ? "bg-accent text-accent-ink"
                  : "text-secondary hover:bg-surface hover:text-ink"
              }`}
              type="button"
              onClick={() => setActiveWorkspace("run-saves")}
            >
              {t("app.runSaves")}
            </button>
            <button
              aria-current={activeWorkspace === "cosmetics" ? "page" : undefined}
              className={`rounded-sm px-4 py-2.5 text-sm font-semibold transition duration-150 ${
                activeWorkspace === "cosmetics"
                  ? "bg-accent text-accent-ink"
                  : "text-secondary hover:bg-surface hover:text-ink"
              }`}
              type="button"
              onClick={() => setActiveWorkspace("cosmetics")}
            >
              {t("app.cosmetics")}
            </button>
          </div>
          <UtilityCluster />
        </nav>

        <div hidden={activeWorkspace !== "run-saves"}>
          {save.session === null ? (
            <DiscoveryHome
              key={gameSafety.recoveryGeneration}
              openError={save.error}
              openingSaveId={save.openingSaveId}
              onOpenSave={(saveId) => void save.open(saveId)}
            />
          ) : (
            <Workspace
              key={save.session.fingerprint}
              backupPath={save.lastBackupPath}
              saveError={save.saveError}
              saving={save.saving}
              session={save.session}
              onClose={save.close}
              onSave={save.write}
            />
          )}
        </div>

        <CosmeticsWorkspace
          hidden={activeWorkspace !== "cosmetics"}
          recoveryGeneration={gameSafety.recoveryGeneration}
        />
      </div>

      {dialogStatus !== null ? (
        <GameSafetyDialog
          status={dialogStatus}
          checking={gameSafety.checking}
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
