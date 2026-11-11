/** Existing discovery presentation running against the opt-in native adapter. */
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/app/AppShell";
import { LanguageMenu } from "@/app/LanguageMenu";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { ThemeMenu } from "@/app/ThemeMenu";
import { usePreferences } from "@/app/preferences";
import { closeTauriPreview, tauriReadApi } from "@/app/tauriReadApi";
import { closeNativeArtwork } from "@/app/tauriArtwork";
import { AssetPreparationView } from "@/features/assets/AssetPreparationView";
import { INITIAL_STATE as idleAssets } from "@/features/assets/useAssetPreparation";
import { TauriWorkspace } from "@/features/editor/TauriWorkspace";
import { TauriCosmeticsWorkspace } from "@/features/cosmetics/TauriCosmeticsWorkspace";
import { useSaveSession } from "@/features/editor/useSaveSession";
import { GameSafetyDialog } from "@/features/safety/GameSafetyDialog";
import { useGameSafety } from "@/features/safety/useGameSafety";
import { DiscoveryHome } from "./components/DiscoveryHome";
import { useEnvironmentDiscovery } from "./useEnvironmentDiscovery";

function DiscoveryPreview() {
  const [workspace, setWorkspace] = useState<"run-saves" | "cosmetics">("run-saves");
  const [healthEnabled, setHealthEnabled] = useState(false);
  const save = useSaveSession(tauriReadApi.saves.open);
  const safety = useGameSafety(tauriReadApi.game.status);
  const opening = save.openingSaveId !== null;
  const discovery = useEnvironmentDiscovery(
    workspace === "run-saves" && save.session === null && !opening,
    safety.recoveryGeneration,
    tauriReadApi.environment.detect,
  );
  const content = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  const safetyRequired = save.session !== null || opening || workspace === "cosmetics";
  const initialCheck = safetyRequired && safety.status === null;
  const blocked =
    safetyRequired && (safety.status === "running" || safety.status === "unknown")
      ? safety.status
      : null;
  async function open(saveId: string) {
    const request = generation.current;
    const result = await save.open(saveId);
    if (request === generation.current && result !== null) save.enter(result);
  }
  function close() {
    generation.current += 1;
    if (save.session !== null) void closeNativeArtwork(save.session.id);
    save.close();
  }
  const { t } = usePreferences();
  let view = (
    <DiscoveryHome
      discovery={discovery}
      openError={save.error}
      openingSaveId={save.openingSaveId}
      onOpenSave={(id) => void open(id)}
    />
  );
  if (opening) {
    view = (
      <AssetPreparationView
        mode="save"
        saveDetail={t("entry.detail.readingSave")}
        state={idleAssets}
      />
    );
  } else if (save.session !== null) {
    view = (
      <TauriWorkspace
        key={save.session.id}
        session={save.session}
        onClose={close}
        onCanonical={save.enter}
        onHealthAvailability={setHealthEnabled}
      />
    );
  }
  return (
    <AppShell>
      <div
        ref={content}
        aria-busy={initialCheck || (safetyRequired && safety.checking)}
        data-testid="editor-content"
        inert={initialCheck || blocked !== null}
        tabIndex={-1}
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-secondary">
            {t(healthEnabled ? "health.testOnly" : "app.discoveryPreview")}
          </p>
          <div className="flex gap-2">
            <ThemeMenu />
            <LanguageMenu />
          </div>
        </div>
        <nav aria-label={t("app.workspaces")} className="mb-5 flex gap-2 border-b border-line pb-3">
          {(["run-saves", "cosmetics"] as const).map((item) => (
            <button
              key={item}
              aria-current={workspace === item ? "page" : undefined}
              className={`ui-feedback rounded-sm px-4 py-2.5 text-sm font-semibold ${workspace === item ? "bg-accent text-accent-ink" : "text-secondary hover:bg-surface hover:text-ink"}`}
              type="button"
              onClick={() => setWorkspace(item)}
            >
              {t(item === "run-saves" ? "app.runSaves" : "app.cosmetics")}
            </button>
          ))}
        </nav>
        <div hidden={workspace !== "run-saves"}>{view}</div>
        <TauriCosmeticsWorkspace
          active={workspace === "cosmetics"}
          recoveryGeneration={safety.recoveryGeneration}
        />
      </div>
      {blocked !== null ? (
        <GameSafetyDialog
          status={blocked}
          checking={safety.checking}
          fallbackFocusRef={content}
          onCheckAgain={() => void safety.check()}
          onExit={() => void closeTauriPreview()}
        />
      ) : null}
    </AppShell>
  );
}

export function TauriDiscovery() {
  return (
    <PreferencesProvider>
      <DiscoveryPreview />
    </PreferencesProvider>
  );
}
