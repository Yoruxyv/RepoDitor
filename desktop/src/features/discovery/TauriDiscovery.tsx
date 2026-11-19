/** Existing discovery presentation running against the opt-in native adapter. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { AppShell } from "@/app/AppShell";
import { LanguageMenu } from "@/app/LanguageMenu";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { ThemeMenu } from "@/app/ThemeMenu";
import { TauriUpdateNotice } from "@/app/TauriUpdateNotice";
import { usePreferences } from "@/app/preferences";
import { closeTauriPreview, tauriReadApi } from "@/app/tauriReadApi";
import { cancelEntryArtwork, clearEntryArtwork, closeNativeWorkspace } from "@/app/tauriArtwork";
import { AssetPreparationView } from "@/features/assets/AssetPreparationView";
import { TauriWorkspace } from "@/features/editor/TauriWorkspace";
import { TauriCosmeticsWorkspace } from "@/features/cosmetics/TauriCosmeticsWorkspace";
import { useSaveSession } from "@/features/editor/useSaveSession";
import {
  prepareTauriEntry,
  type TauriEntryProgress,
  type TauriEntrySnapshot,
} from "@/features/editor/tauriEntryPreparation";
import { GameSafetyDialog } from "@/features/safety/GameSafetyDialog";
import { useGameSafety } from "@/features/safety/useGameSafety";
import { DiscoveryHome } from "./components/DiscoveryHome";
import { useEnvironmentDiscovery } from "./useEnvironmentDiscovery";

type NavigationFocus =
  | { kind: "workspace" }
  | { kind: "discovery"; saveId: string; refreshRevision: number; headingFocused: boolean };

type EditMode = "checking" | "readonly" | "test" | "production";
const READ_ONLY = "app.discoveryPreview";

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

function OpeningSavePreparation({
  progress,
  onCancel,
}: {
  readonly progress: TauriEntryProgress | null;
  readonly onCancel: () => void;
}) {
  const { t } = usePreferences();
  const details = {
    data: "entry.detail.editorData",
    artwork: "entry.detail.artworkAfterData",
    verifying: "entry.detail.finalizing",
  } as const;
  const counts = progress?.artwork;
  const artwork = counts?.total ? { completed: counts.settled, total: counts.total } : null;
  return (
    <AssetPreparationView
      compact
      mode="save"
      saveDetail={t(progress ? details[progress.stage] : "entry.detail.readingSave")}
      editorProgress={artwork}
      progressText={artwork ? t("entry.artworkCompact", artwork) : ""}
      onCancel={onCancel}
    />
  );
}

function RunSaveContent({
  discovery,
  save,
  active,
  progress,
  prepared,
  onOpen,
  onCancel,
  onClose,
  onHealthAvailability,
}: {
  readonly discovery: ReturnType<typeof useEnvironmentDiscovery>;
  readonly save: ReturnType<typeof useSaveSession>;
  readonly active: boolean;
  readonly progress: TauriEntryProgress | null;
  readonly prepared: TauriEntrySnapshot | null;
  readonly onOpen: (saveId: string) => void;
  readonly onCancel: (saveId: string) => void;
  readonly onClose: () => void;
  readonly onHealthAvailability: (mode: EditMode) => void;
}) {
  const { t } = usePreferences();
  const openingId = save.openingSaveId;
  if (openingId !== null) {
    return <OpeningSavePreparation progress={progress} onCancel={() => onCancel(openingId)} />;
  }
  if (save.session !== null) {
    return (
      <TauriWorkspace
        key={save.session.id}
        session={save.session}
        prepared={prepared}
        active={active}
        onClose={onClose}
        onCanonical={save.enter}
        onHealthAvailability={onHealthAvailability}
        compatibility={discovery.data}
      />
    );
  }
  return (
    <>
      {save.drainingOpen ? (
        <output className="mb-4 block border-l-2 border-accent bg-accent-muted px-4 py-3 text-sm text-secondary">
          {t("entry.cancelledOpening")}
        </output>
      ) : null}
      <DiscoveryHome
        discovery={discovery}
        openError={save.error}
        openingSaveId={null}
        onOpenSave={save.drainingOpen ? null : onOpen}
      />
    </>
  );
}

function DiscoveryPreview() {
  const [workspace, setWorkspace] = useState<"run-saves" | "cosmetics">("run-saves");
  const [editMode, setEditMode] = useState<EditMode>("checking");
  const [cosmeticsEditing, setCosmeticsEditing] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<TauriEntryProgress | null>(null);
  const [prepared, setPrepared] = useState<TauriEntrySnapshot | null>(null);
  const safety = useGameSafety(tauriReadApi.game.status);
  const closingWorkspace = useRef(false);
  const [closeFailed, setCloseFailed] = useState(false);
  const save = useSaveSession(async (id, signal) => {
    setProgress(null);
    signal.throwIfAborted();
    const opened = await tauriReadApi.saves.open(id);
    if (!opened.ok) return opened;
    let keep = false;
    try {
      signal.throwIfAborted();
      await safety.check();
      signal.throwIfAborted();
      const entry = await prepareTauriEntry(opened.data, signal, setProgress);
      if (!entry.ok) return entry;
      signal.throwIfAborted();
      setPrepared(entry.data);
      keep = true;
      return opened;
    } finally {
      if (!keep) {
        cancelEntryArtwork();
        await closeNativeWorkspace(id);
      }
    }
  });
  const opening = save.openingSaveId !== null;
  const discovery = useEnvironmentDiscovery(
    workspace === "run-saves" && save.session === null && !opening && !save.drainingOpen,
    safety.recoveryGeneration,
    tauriReadApi.environment.detect,
  );
  const content = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const navigationFocus = useRef<NavigationFocus | null>(null);
  useEffect(() => {
    return () => {
      generation.current += 1;
    };
  }, []);
  const safetyRequired = save.session !== null || opening || workspace === "cosmetics";
  const initialCheck = safetyRequired && safety.status === null;
  const blocked =
    safetyRequired && (safety.status === "running" || safety.status === "unknown")
      ? safety.status
      : null;
  const { isRefreshing, refreshRevision } = discovery;
  const inSave = save.session !== null;
  function focusDiscoveryAfterRefresh(saveId: string) {
    navigationFocus.current = {
      kind: "discovery",
      saveId,
      refreshRevision,
      headingFocused: false,
    };
  }
  async function close(id: string) {
    if (closingWorkspace.current) return;
    closingWorkspace.current = true;
    setCloseFailed(false);
    const closed = await closeNativeWorkspace(id);
    closingWorkspace.current = false;
    if (!closed) {
      setCloseFailed(true);
      return;
    }
    generation.current += 1;
    cancelEntryArtwork();
    setPrepared(null);
    focusDiscoveryAfterRefresh(id);
    save.close();
  }
  useEffect(() => {
    const revision = prepared?.artworkRevision;
    if (!inSave || !revision) return;
    let current = true;
    let checking = false;
    async function verifyArtworkSource() {
      if (checking) return;
      checking = true;
      try {
        const result = await tauriReadApi.maps.list("verify");
        if (current && result.ok && result.data.entryArtworkRevision !== revision) {
          clearEntryArtwork();
        }
      } finally {
        checking = false;
      }
    }
    function onFocus() {
      void verifyArtworkSource();
    }
    window.addEventListener("focus", onFocus);
    return () => {
      current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [inSave, prepared]);
  const focusPreparation =
    workspace === "run-saves" && opening && !initialCheck && blocked === null;
  const waitingForDiscovery = isRefreshing || save.drainingOpen;
  useLayoutEffect(() => {
    if (focusPreparation)
      focusNavigationTarget(content.current?.querySelector("#asset-preparation-title"));
  }, [focusPreparation, opening]);
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
    if (waitingForDiscovery || refreshRevision === request.refreshRevision) {
      if (!request.headingFocused) request.headingFocused = focusNavigationTarget(heading);
      return;
    }
    navigationFocus.current = null;
    if (request.headingFocused && document.activeElement !== heading) return;
    const button = Array.from(
      root.querySelectorAll<HTMLButtonElement>("button[data-save-id]"),
    ).find((candidate) => candidate.dataset["saveId"] === request.saveId);
    if (!focusNavigationTarget(button)) focusNavigationTarget(heading);
  }, [workspace, opening, initialCheck, blocked, inSave, waitingForDiscovery, refreshRevision]);

  async function open(saveId: string) {
    const request = generation.current;
    const result = await save.open(saveId);
    if (request !== generation.current) return;
    if (result === null) {
      focusDiscoveryAfterRefresh(saveId);
    } else {
      navigationFocus.current = { kind: "workspace" };
      save.enter(result);
    }
  }
  function cancelOpen(saveId: string) {
    generation.current += 1;
    cancelEntryArtwork();
    focusDiscoveryAfterRefresh(saveId);
    save.cancelOpen();
    // End cancellable native reads now. The opening callback also cleans up if the
    // initial save read completed after this cancellation.
    void closeNativeWorkspace(saveId);
  }
  const { t } = usePreferences();
  const readOnly =
    workspace === "cosmetics" ? cosmeticsEditing === false : inSave && editMode === "readonly";
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
        <nav
          aria-label={t("app.workspaces")}
          className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3"
        >
          <div className="flex gap-2">
            {(["run-saves", "cosmetics"] as const).map((item) => (
              <button
                key={item}
                aria-current={workspace === item ? "page" : undefined}
                className={`ui-feedback rounded-sm px-4 py-2.5 text-sm font-semibold ${workspace === item ? "bg-accent text-accent-ink" : "text-secondary hover:bg-surface hover:text-ink"}`}
                type="button"
                onClick={() => {
                  if (item === "cosmetics" && save.openingSaveId !== null)
                    cancelOpen(save.openingSaveId);
                  setWorkspace(item);
                }}
              >
                {t(item === "run-saves" ? "app.runSaves" : "app.cosmetics")}
              </button>
            ))}
          </div>
          {readOnly ? (
            <output className="flex-1 text-sm text-secondary">{t(READ_ONLY)}</output>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <ThemeMenu />
            <LanguageMenu />
          </div>
        </nav>
        <div hidden={workspace !== "run-saves"}>
          {closeFailed ? <p role="alert">{t("error.service")}</p> : null}
          <RunSaveContent
            discovery={discovery}
            save={save}
            prepared={prepared}
            progress={progress}
            active={workspace === "run-saves" && !initialCheck && blocked === null}
            onOpen={(id) => void open(id)}
            onCancel={cancelOpen}
            onClose={() => {
              if (save.session) void close(save.session.id);
            }}
            onHealthAvailability={setEditMode}
          />
        </div>
        <TauriCosmeticsWorkspace
          active={workspace === "cosmetics"}
          compatibility={discovery.data}
          onCancel={() => setWorkspace("run-saves")}
          recoveryGeneration={safety.recoveryGeneration}
          onEditingAvailability={setCosmeticsEditing}
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
      <TauriUpdateNotice />
    </PreferencesProvider>
  );
}
