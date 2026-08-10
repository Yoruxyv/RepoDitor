import { useState } from "react";

import { AppShell } from "@/app/AppShell";
import { CosmeticsWorkspace } from "@/features/cosmetics/CosmeticsWorkspace";
import { DiscoveryHome } from "@/features/discovery/components/DiscoveryHome";
import { Workspace } from "@/features/editor/Workspace";
import { useSaveSession } from "@/features/editor/useSaveSession";
import { GameSafetyDialog } from "@/features/safety/GameSafetyDialog";
import { useGameSafety } from "@/features/safety/useGameSafety";

type AppWorkspace = "run-saves" | "cosmetics";

function App() {
  const save = useSaveSession();
  const gameSafety = useGameSafety();
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
        <nav className="mb-8 flex gap-2 border-b border-line pb-3" aria-label="RepoDitor workspaces">
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
            Run Saves
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
            Cosmetics
          </button>
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

export default App;
