/** Existing discovery presentation running against the opt-in native adapter. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { AppShell } from "@/app/AppShell";
import { LanguageMenu } from "@/app/LanguageMenu";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { ThemeMenu } from "@/app/ThemeMenu";
import { usePreferences } from "@/app/preferences";
import type { TranslationKey } from "@/app/i18n";
import { closeTauriPreview, tauriReadApi } from "@/app/tauriReadApi";
import {
  cancelEntryArtwork,
  clearEntryArtwork,
  closeNativeWorkspace,
  ENTRY_ARTWORK_SCOPES,
  type EntryArtworkProgress,
  type EntryArtworkResults,
} from "@/app/tauriArtwork";
import { AssetPreparationView } from "@/features/assets/AssetPreparationView";
import { TauriWorkspace } from "@/features/editor/TauriWorkspace";
import { TauriCosmeticsWorkspace } from "@/features/cosmetics/TauriCosmeticsWorkspace";
import { useSaveSession } from "@/features/editor/useSaveSession";
import {
  entryProgressCounts,
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

type ArtworkDecision = { readonly result: EntryArtworkResults; readonly proceed: () => void };
type EditMode = "checking" | "readonly" | "test" | "production";
const READ_ONLY = "app.discoveryPreview";

function waitForArtworkDecision(
  result: EntryArtworkResults,
  signal: AbortSignal,
  show: (decision: ArtworkDecision) => void,
) {
  return new Promise<void>((resolve) => {
    function proceed() {
      signal.removeEventListener("abort", proceed);
      resolve();
    }
    signal.addEventListener("abort", proceed, { once: true });
    show({ result, proceed });
  });
}

function ArtworkIssues({ result }: { readonly result: EntryArtworkResults }) {
  const { t } = usePreferences();
  return (
    <output className="mt-2 block space-y-1 text-sm text-secondary">
      {ENTRY_ARTWORK_SCOPES.flatMap((scope) => {
        const { issues } = result[scope];
        return (Object.keys(issues) as (keyof typeof issues)[]).map((reason) => (
          <span className="block" key={scope + reason}>
            {t(`nav.${scope}s`)} ·{" "}
            {t(`entry.artworkIssue.${reason}`, { count: issues[reason] ?? 0 })}
          </span>
        ));
      })}
    </output>
  );
}

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
  artworkProgress,
  artworkDecision,
  onCancel,
}: {
  readonly progress: TauriEntryProgress | null;
  readonly artworkProgress: EntryArtworkProgress | null;
  readonly artworkDecision: ArtworkDecision | null;
  readonly onCancel: () => void;
}) {
  const { t } = usePreferences();
  const counts = progress && entryProgressCounts(progress);
  let detail: TranslationKey = counts ? "entry.detail.finalizing" : "entry.detail.readingSave";
  if (counts?.current) detail = `entry.detail.${counts.current}`;
  if (artworkProgress?.scope) detail = `entry.artwork.${artworkProgress.scope}`;
  if (artworkDecision) detail = "entry.artworkIncomplete";
  const artworkCounts = artworkProgress && {
    completed: artworkProgress.settled,
    total: artworkProgress.total,
  };
  // Reserve one phase for artwork before its roster exists, so the data fill is retained.
  let artworkCompletion = 0;
  if (artworkCounts) {
    artworkCompletion =
      artworkCounts.total === 0 ? 1 : artworkCounts.completed / artworkCounts.total;
  }
  const combined = counts && {
    completed: counts.completed / counts.total + artworkCompletion,
    total: 2,
  };
  const progressText = [
    counts && t("entry.editorDataCompact", { completed: counts.completed, total: counts.total }),
    artworkCounts && t("entry.artworkCompact", artworkCounts),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <AssetPreparationView
      compact
      mode="save"
      saveDetail={t(detail)}
      editorProgress={combined}
      progressText={progressText}
      onCancel={onCancel}
      {...(artworkDecision ? { onContinue: artworkDecision.proceed } : {})}
      continueLabel={t("entry.artworkContinue")}
    >
      {artworkDecision ? <ArtworkIssues result={artworkDecision.result} /> : null}
    </AssetPreparationView>
  );
}

function RunSaveContent({
  discovery,
  save,
  active,
  prepared,
  progress,
  artworkProgress,
  artworkDecision,
  onOpen,
  onCancel,
  onClose,
  onHealthAvailability,
}: {
  readonly discovery: ReturnType<typeof useEnvironmentDiscovery>;
  readonly save: ReturnType<typeof useSaveSession>;
  readonly active: boolean;
  readonly prepared: TauriEntrySnapshot | null;
  readonly progress: TauriEntryProgress | null;
  readonly artworkProgress: EntryArtworkProgress | null;
  readonly artworkDecision: ArtworkDecision | null;
  readonly onOpen: (saveId: string) => void;
  readonly onCancel: (saveId: string) => void;
  readonly onClose: () => void;
  readonly onHealthAvailability: (mode: EditMode) => void;
}) {
  const { t } = usePreferences();
  const openingId = save.openingSaveId;
  if (openingId !== null) {
    return (
      <OpeningSavePreparation
        progress={progress}
        artworkProgress={artworkProgress}
        artworkDecision={artworkDecision}
        onCancel={() => onCancel(openingId)}
      />
    );
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
        whileChecking={
          <OpeningSavePreparation
            progress={progress}
            artworkProgress={artworkProgress}
            artworkDecision={null}
            onCancel={onClose}
          />
        }
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
  const [artworkProgress, setArtworkProgress] = useState<EntryArtworkProgress | null>(null);
  const [artworkDecision, setArtworkDecision] = useState<ArtworkDecision | null>(null);
  const safety = useGameSafety(tauriReadApi.game.status);
  const closingWorkspace = useRef(false);
  const [closeFailed, setCloseFailed] = useState(false);
  const save = useSaveSession(async (id, signal) => {
    setProgress(null);
    setArtworkProgress(null);
    setArtworkDecision(null);
    setPrepared(null);
    signal.throwIfAborted();
    const opened = await tauriReadApi.saves.open(id);
    if (!opened.ok) return opened;
    let keep = false;
    try {
      signal.throwIfAborted();
      const entry = await prepareTauriEntry(
        opened.data,
        signal,
        setProgress,
        (status) => {
          if (!signal.aborted) setArtworkProgress(status);
        },
        (result) => waitForArtworkDecision(result, signal, setArtworkDecision),
      );
      if (!entry.ok) return entry;
      await safety.check();
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
      cancelEntryArtwork();
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
  useEffect(() => {
    if (inSave) return cancelEntryArtwork;
  }, [inSave]);
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
    workspace === "run-saves" &&
    (opening || (inSave && editMode === "checking")) &&
    !initialCheck &&
    blocked === null;
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
    if (opening || (inSave && editMode === "checking") || initialCheck || blocked !== null) return;
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
  }, [
    workspace,
    opening,
    initialCheck,
    blocked,
    inSave,
    editMode,
    waitingForDiscovery,
    refreshRevision,
  ]);

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
  function focusDiscoveryAfterRefresh(saveId: string) {
    navigationFocus.current = {
      kind: "discovery",
      saveId,
      refreshRevision,
      headingFocused: false,
    };
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
  async function close() {
    const id = save.session?.id;
    if (!id || closingWorkspace.current) return;
    closingWorkspace.current = true;
    setCloseFailed(false);
    const closed = await closeNativeWorkspace(id);
    closingWorkspace.current = false;
    if (!closed) {
      setCloseFailed(true);
      return;
    }
    generation.current += 1;
    setPrepared(null);
    focusDiscoveryAfterRefresh(id);
    save.close();
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
            artworkProgress={artworkProgress}
            artworkDecision={
              artworkDecision && {
                result: artworkDecision.result,
                proceed: () => {
                  setArtworkDecision(null);
                  artworkDecision.proceed();
                },
              }
            }
            active={workspace === "run-saves" && !initialCheck && blocked === null}
            onOpen={(id) => void open(id)}
            onCancel={cancelOpen}
            onClose={() => void close()}
            onHealthAvailability={setEditMode}
          />
        </div>
        <TauriCosmeticsWorkspace
          active={workspace === "cosmetics"}
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
    </PreferencesProvider>
  );
}
