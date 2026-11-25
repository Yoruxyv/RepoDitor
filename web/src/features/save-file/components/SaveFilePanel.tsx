import { ArrowSquareOutIcon, FileArrowUpIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useState, type ChangeEvent } from "react";

import { useI18n } from "@/app/i18n/context";
import type { Translate, TranslationKey } from "@/app/i18n/catalog";
import { PendingHealthLimitError } from "@/features/run-save/model/runSave";
import type { WorkspaceExportState } from "@/features/save-file/components/PendingChangesBar";
import { FindSaveDialog } from "@/features/save-file/components/FindSaveDialog";
import {
  createEditSession,
  resetEditSession,
  type EditSession,
} from "@/features/save-file/session/session";

const SaveWorkspace = lazy(() =>
  import("@/features/save-file/components/SaveWorkspace").then(({ SaveWorkspace: component }) => ({
    default: component,
  })),
);

const DESKTOP_URL = "https://github.com/Yoruxyv/RepoDitor/releases/latest";
const DEFAULT_LOAD_ERROR_KEY: TranslationKey = "save.picker.errorRead";

type LoadState =
  | { readonly status: "idle" }
  | { readonly fileName: string; readonly status: "loading" }
  | { readonly session: EditSession; readonly status: "ready" }
  | { readonly errorKey: TranslationKey; readonly status: "error" };

function loadErrorKey(error: unknown): TranslationKey {
  if (!(error instanceof Error) || error.name !== "SavePipelineError") {
    return DEFAULT_LOAD_ERROR_KEY;
  }
  const code = typeof Reflect.get(error, "code") === "string" ? Reflect.get(error, "code") : "";
  switch (code) {
    case "unsupported-file":
      return "save.picker.errorUnsupportedFile";
    case "decrypt-failed":
      return "save.picker.errorDecrypt";
    case "malformed-save":
      return "save.picker.errorMalformed";
    case "unsupported-save":
      return "save.picker.errorUnsupportedSave";
    default:
      return DEFAULT_LOAD_ERROR_KEY;
  }
}

function isBusy(state: LoadState, exportState: WorkspaceExportState): boolean {
  return state.status === "loading" || exportState.status === "preparing";
}

function panelHeading(state: LoadState): TranslationKey {
  switch (state.status) {
    case "ready":
      return "save.picker.ready";
    case "loading":
      return "save.picker.reading";
    case "error":
      return "save.picker.notLoaded";
    case "idle":
      return "save.picker.drop";
  }
}

function panelMessage(state: LoadState, t: Translate): string {
  switch (state.status) {
    case "ready":
      return t("save.picker.readyMessage", { fileName: state.session.originalFileName });
    case "loading":
      return t("save.picker.readingMessage", { fileName: state.fileName });
    case "error":
      return t(state.errorKey);
    case "idle":
      return t("save.picker.idleMessage");
  }
}

function StatusIcon({ state }: { readonly state: LoadState }) {
  if (state.status === "error") {
    return <WarningCircleIcon aria-hidden="true" className="text-accent" size={56} />;
  }
  return (
    <span className="flex size-14 items-center justify-center rounded-sm border border-line bg-app text-accent transition-transform motion-safe:group-hover:-translate-y-1">
      <FileArrowUpIcon aria-hidden="true" size={30} />
    </span>
  );
}

interface SaveFilePanelProps {
  readonly onWorkspaceChange: (open: boolean) => void;
}

export function SaveFilePanel({ onWorkspaceChange }: SaveFilePanelProps) {
  const { t } = useI18n();
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [exportState, setExportState] = useState<WorkspaceExportState>({ status: "idle" });
  const busy = isBusy(state, exportState);

  async function selectFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    setExportState({ status: "idle" });
    setState({ fileName: file.name, status: "loading" });
    try {
      const { loadSaveFile } = await import("@/features/save-file/processing/pipeline");
      const session = createEditSession(await loadSaveFile(file));
      setState({ session, status: "ready" });
      onWorkspaceChange(true);
    } catch (error) {
      setState({ errorKey: loadErrorKey(error), status: "error" });
      onWorkspaceChange(false);
    } finally {
      input.value = "";
    }
  }

  async function downloadCopy(session: EditSession): Promise<void> {
    setExportState({ status: "preparing" });
    try {
      const { downloadVerifiedExport, prepareVerifiedExport } =
        await import("@/features/save-file/processing/export");
      const output = await prepareVerifiedExport(session);
      downloadVerifiedExport(output);
      setExportState({
        fileName: output.fileName,
        status: "success",
      });
    } catch (error) {
      setExportState(
        error instanceof PendingHealthLimitError
          ? { status: "error", healthMaximum: error.maximum }
          : { status: "error" },
      );
    }
  }

  function clear(): void {
    setState({ status: "idle" });
    setExportState({ status: "idle" });
    onWorkspaceChange(false);
  }

  function updateSession(session: EditSession): void {
    setState({ session, status: "ready" });
    setExportState({ status: "idle" });
  }

  if (state.status === "ready") {
    return (
      <Suspense
        fallback={
          <section aria-busy="true" aria-live="polite" className="py-12 text-secondary">
            {t("save.picker.preparingEditor")}
          </section>
        }
      >
        <SaveWorkspace
          busy={busy}
          exportState={exportState}
          session={state.session}
          onClear={clear}
          onDownload={() => void downloadCopy(state.session)}
          onReset={() => updateSession(resetEditSession(state.session))}
          onSelectFile={(event) => void selectFile(event)}
          onSessionChange={updateSession}
        />
      </Suspense>
    );
  }

  return (
    <section aria-label={t("save.picker.choose")} className="min-w-0">
      <label className="group relative flex min-h-72 cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-control bg-surface px-6 py-12 text-center shadow-panel transition-colors hover:border-accent hover:bg-surface-raised focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-focus sm:min-h-80">
        <input
          accept=".es3"
          aria-describedby="save-file-help save-file-status supported-save-types"
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-wait"
          disabled={busy}
          onChange={(event) => void selectFile(event)}
          type="file"
        />
        <StatusIcon state={state} />

        <span className="font-display mt-6 text-3xl font-semibold uppercase leading-none tracking-tight sm:text-4xl">
          {t(panelHeading(state))}
        </span>
        <output
          aria-live={state.status === "error" ? "assertive" : "polite"}
          className="mt-3 text-sm font-medium text-secondary"
          id="save-file-status"
        >
          {panelMessage(state, t)}
        </output>
        <span className="sr-only" id="save-file-help">
          {t("save.picker.help")}
        </span>
        <span className="mt-4 grid gap-1 text-xs/5 text-secondary" id="supported-save-types">
          <span>
            <strong className="font-semibold text-ink">{t("save.picker.runSaves")}</strong> -{" "}
            {t("save.picker.runHelp")}
          </span>
          <span>
            <strong className="font-semibold text-ink">MetaSave.es3</strong> -{" "}
            {t("save.picker.metaHelp")}
          </span>
        </span>
      </label>

      <div className="mt-5 grid gap-3 border-t border-line pt-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-secondary">{t("save.picker.findPrompt")}</p>
          <FindSaveDialog />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-secondary">{t("save.picker.desktopPrompt")}</p>
          <a
            className="inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-sm border border-control bg-surface-raised px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
            href={DESKTOP_URL}
            rel="noreferrer"
            target="_blank"
          >
            {t("save.picker.desktopAction")}
            <ArrowSquareOutIcon aria-hidden="true" size={17} weight="bold" />
          </a>
        </div>
      </div>
    </section>
  );
}
