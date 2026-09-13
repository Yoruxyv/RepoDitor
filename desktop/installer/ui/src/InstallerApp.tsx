import { useEffect, useState, type ReactNode } from "react";

import { BrandHeader, WindowChrome } from "./InstallerChrome";
import { ProgressState, ReadyState, ResultState } from "./InstallerStates";
import {
  installerBridge,
  type InstallerMessage,
  type InstallerMode,
  type InstallerScope,
  type InstallerState,
} from "./bridge/webview";

interface InstallerView {
  readonly initialized: boolean;
  readonly mode: InstallerMode;
  readonly updating: boolean;
  readonly version: string;
  readonly scope: InstallerScope;
  readonly scopeLocked: boolean;
  readonly showScope: boolean;
  readonly path: string;
  readonly phase: InstallerState;
  readonly message: string;
  readonly session: string | null;
  readonly percentage: number | null;
  readonly extractionAttempt: number;
}

const initialView: InstallerView = {
  initialized: false,
  mode: "install",
  updating: false,
  version: "",
  scope: "current",
  scopeLocked: false,
  showScope: true,
  path: "Preparing installation…",
  phase: "ready",
  message: "",
  session: null,
  percentage: null,
  extractionAttempt: 0,
};

function applyMessage(view: InstallerView, message: InstallerMessage): InstallerView {
  if (message.type === "initialize") {
    if (view.initialized) return view;
    return {
      initialized: true,
      mode: message.mode,
      updating: message.updated,
      version: message.version,
      scope: message.scope,
      scopeLocked: message.scopeLocked,
      showScope: message.showScope,
      path: message.path || view.path,
      phase: "ready",
      message: "",
      session: null,
      percentage: null,
      extractionAttempt: 0,
    };
  }

  if (!view.initialized) return view;
  if (message.type === "progress") return applyProgress(view, message);
  if (message.type === "path") {
    return view.phase === "ready" ? { ...view, path: message.path } : view;
  }
  return applyState(view, message);
}

function applyProgress(
  view: InstallerView,
  message: Extract<InstallerMessage, { type: "progress" }>,
): InstallerView {
  if (view.mode !== "install" || view.phase !== "installing" || message.session !== view.session)
    return view;
  if (message.attempt === view.extractionAttempt) {
    if (view.percentage !== null && message.percentage < view.percentage) return view;
  } else if (
    message.attempt !== view.extractionAttempt + 1 ||
    (view.extractionAttempt !== 0 && message.percentage !== 0)
  )
    return view;
  return { ...view, percentage: message.percentage, extractionAttempt: message.attempt };
}

function applyState(
  view: InstallerView,
  message: Extract<InstallerMessage, { type: "state" }>,
): InstallerView {
  if (!canTransition(view.phase, message.state)) return view;
  if (message.state === "preparing") {
    if (view.mode === "uninstall" && message.session !== undefined) return view;
    if (view.phase === "preparing" && (message.session ?? null) !== view.session) return view;
    if (
      view.phase === "failure" &&
      message.session !== undefined &&
      message.session === view.session
    )
      return view;
    return {
      ...view,
      phase: message.state,
      message: message.message,
      session: message.session ?? null,
      percentage: null,
      extractionAttempt: 0,
    };
  }
  if ((message.session ?? null) !== view.session) return view;
  return { ...view, phase: message.state, message: message.message };
}

function canTransition(current: InstallerState, next: InstallerState): boolean {
  if (current === next) return true;
  if (next === "preparing") return current === "ready" || current === "failure";
  if (next === "installing") return current === "preparing";
  if (next === "finalizing") return current === "installing";
  if (next === "success") return current === "finalizing";
  if (next === "failure")
    return current === "preparing" || current === "installing" || current === "finalizing";
  return false;
}

export function InstallerApp() {
  const [view, setView] = useState(initialView);

  useEffect(() => {
    const unsubscribe = installerBridge.subscribe((message) => {
      setView((current) => applyMessage(current, message));
    });
    installerBridge.post("ready");
    return unsubscribe;
  }, []);

  const setScope = (scope: InstallerScope) => {
    setView((current) => ({ ...current, scope }));
    installerBridge.post(scope === "all" ? "scope:all" : "scope:current");
  };

  const title = view.mode === "uninstall" ? "RepoDitor Uninstall" : "RepoDitor Setup";
  const version = `RepoDitor ${view.version}`.trim();
  const busy =
    view.phase === "preparing" || view.phase === "installing" || view.phase === "finalizing";
  const finish = () => {
    if (view.phase === "failure") installerBridge.post("retry");
    else if (view.mode === "uninstall") installerBridge.post("close");
    else installerBridge.post("launch");
  };

  let state: ReactNode;
  if (view.phase === "ready") {
    state = (
      <ReadyState
        initialized={view.initialized}
        mode={view.mode}
        updating={view.updating}
        scope={view.scope}
        scopeLocked={view.scopeLocked}
        showScope={view.showScope}
        path={view.path}
        onScopeChange={setScope}
        onChoosePath={() => installerBridge.post("choose-path")}
        onCancel={() => installerBridge.post("cancel")}
        onStart={() => installerBridge.post("start")}
      />
    );
  } else if (
    view.phase === "preparing" ||
    view.phase === "installing" ||
    view.phase === "finalizing"
  ) {
    state = (
      <ProgressState
        mode={view.mode}
        stage={view.phase}
        percentage={view.percentage}
        attempt={view.extractionAttempt}
      />
    );
  } else {
    state = (
      <ResultState
        mode={view.mode}
        failed={view.phase === "failure"}
        message={view.message}
        onClose={() => installerBridge.post("close")}
        onResult={finish}
      />
    );
  }

  return (
    <div className="stage">
      <main className="window" aria-label="RepoDitor installer">
        <WindowChrome title={title} />
        <div className="version">{version}</div>
        <section className="panel" aria-busy={busy}>
          <BrandHeader />
          {state}
        </section>
      </main>
    </div>
  );
}
