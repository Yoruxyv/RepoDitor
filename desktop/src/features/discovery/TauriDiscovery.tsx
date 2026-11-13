/** Existing discovery presentation running against the opt-in native adapter. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppShell } from "@/app/AppShell";
import { LanguageMenu } from "@/app/LanguageMenu";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { ThemeMenu } from "@/app/ThemeMenu";
import { usePreferences } from "@/app/preferences";
import { closeTauriPreview, tauriReadApi } from "@/app/tauriReadApi";
import { closeNativeArtwork } from "@/app/tauriArtwork";
import { TauriWorkspace } from "@/features/editor/TauriWorkspace";
import { TauriCosmeticsWorkspace } from "@/features/cosmetics/TauriCosmeticsWorkspace";
import { useSaveSession } from "@/features/editor/useSaveSession";
import { GameSafetyDialog } from "@/features/safety/GameSafetyDialog";
import { useGameSafety } from "@/features/safety/useGameSafety";
import { DiscoveryHome } from "./components/DiscoveryHome";
import { useEnvironmentDiscovery } from "./useEnvironmentDiscovery";

type NavigationFocus =
  | { kind: "workspace" }
  | { kind: "discovery"; saveId: string; refreshRevision: number; headingFocused: boolean };

function focusNavigationTarget(target: HTMLElement | null | undefined): boolean {
  if (
    !target?.isConnected ||
    target.matches(":disabled") ||
    target.closest("[hidden], [inert]") ||
    target.checkVisibility?.({ visibilityProperty: true }) === false
  )
    return false;
  target.focus();
  return document.activeElement === target;
}

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
  const navigationFocus = useRef<NavigationFocus | null>(null);
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
  const { isRefreshing, refreshRevision } = discovery;
  const inSave = save.session !== null;
  useLayoutEffect(() => {
    const root = content.current;
    const request = navigationFocus.current;
    if (!root || !request) return;
    if (workspace !== "run-saves") {
      navigationFocus.current = null;
      return;
    }
    if (opening || initialCheck || blocked !== null) return;
    if (request.kind === "workspace") {
      if (inSave && focusNavigationTarget(root.querySelector("#native-overview-tab")))
        navigationFocus.current = null;
      return;
    }
    if (inSave) return;
    const heading = root.querySelector<HTMLElement>("#discovery-title");
    // Wait for the refreshed list so a removed save cannot take focus with it.
    if (isRefreshing || refreshRevision === request.refreshRevision) {
      if (!request.headingFocused) request.headingFocused = focusNavigationTarget(heading);
      return;
    }
    navigationFocus.current = null;
    if (request.headingFocused && document.activeElement !== heading) return;
    const button = Array.from(
      root.querySelectorAll<HTMLButtonElement>("button[data-save-id]"),
    ).find((candidate) => candidate.dataset["saveId"] === request.saveId);
    if (!focusNavigationTarget(button)) focusNavigationTarget(heading);
  }, [workspace, opening, initialCheck, blocked, inSave, isRefreshing, refreshRevision]);

  async function open(saveId: string) {
    const request = generation.current;
    const result = await save.open(saveId);
    if (request === generation.current && result !== null) {
      navigationFocus.current = { kind: "workspace" };
      save.enter(result);
    }
  }
  function close() {
    generation.current += 1;
    if (save.session !== null) {
      navigationFocus.current = {
        kind: "discovery",
        saveId: save.session.id,
        refreshRevision,
        headingFocused: false,
      };
      void closeNativeArtwork(save.session.id);
    }
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
      <section
        aria-labelledby="native-opening-title"
        className="rounded-sm border border-line bg-surface p-6"
        data-testid="native-save-opening"
      >
        <h1 className="text-2xl font-semibold text-ink" id="native-opening-title">
          {t("saves.openingSave")}
        </h1>
        <output className="mt-2 block text-sm text-secondary">
          {t("entry.detail.readingSave")}
        </output>
      </section>
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
      <output
        className={
          initialCheck
            ? "mb-4 block rounded-sm border border-line bg-surface px-4 py-3 text-sm text-secondary"
            : undefined
        }
      >
        {initialCheck ? t("safety.initialCheck") : null}
      </output>
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
