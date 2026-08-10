import { useState } from "react";

import { AppShell } from "@/app/AppShell";
import { CosmeticsWorkspace } from "@/features/cosmetics/CosmeticsWorkspace";
import { DiscoveryHome } from "@/features/discovery/components/DiscoveryHome";
import { Workspace } from "@/features/editor/Workspace";
import { useSaveSession } from "@/features/editor/useSaveSession";

type AppWorkspace = "run-saves" | "cosmetics";

function App() {
  const save = useSaveSession();
  const [activeWorkspace, setActiveWorkspace] = useState<AppWorkspace>("run-saves");

  return (
    <AppShell>
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

      <CosmeticsWorkspace hidden={activeWorkspace !== "cosmetics"} />
    </AppShell>
  );
}

export default App;
