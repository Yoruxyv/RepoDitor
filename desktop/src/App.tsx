import { AppShell } from "@/app/AppShell";
import { DiscoveryHome } from "@/features/discovery/components/DiscoveryHome";
import { Workspace } from "@/features/editor/Workspace";
import { useSaveSession } from "@/features/editor/useSaveSession";

function App() {
  const save = useSaveSession();

  return (
    <AppShell>
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
    </AppShell>
  );
}

export default App;
