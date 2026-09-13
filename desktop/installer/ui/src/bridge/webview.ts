export const installerCommands = [
  "ready",
  "choose-path",
  "scope:current",
  "scope:all",
  "start",
  "retry",
  "launch",
  "cancel",
  "close",
  "window:drag",
  "window:minimize",
  "window:maximize",
  "window:close",
] as const;

export type InstallerCommand = (typeof installerCommands)[number];
export type InstallerMode = "install" | "uninstall";
export type InstallerScope = "current" | "all";
export const installerStates = [
  "ready",
  "preparing",
  "installing",
  "finalizing",
  "success",
  "failure",
] as const;
export type InstallerState = (typeof installerStates)[number];
export type InstallerStage = Extract<InstallerState, "preparing" | "installing" | "finalizing">;

interface InitializeMessage {
  readonly type: "initialize";
  readonly mode: InstallerMode;
  readonly version: string;
  readonly updated: boolean;
  readonly scope: InstallerScope;
  readonly scopeLocked: boolean;
  readonly showScope: boolean;
  readonly path: string;
}

export type InstallerMessage =
  | InitializeMessage
  | { readonly type: "path"; readonly path: string }
  | {
      readonly type: "state";
      readonly state: InstallerState;
      readonly message: string;
    };

type MessageListener = (event: { readonly data: unknown }) => void;

interface NativeWebView {
  postMessage(message: string): void;
  addEventListener(type: "message", listener: MessageListener): void;
  removeEventListener(type: "message", listener: MessageListener): void;
}

interface WebViewWindow extends Window {
  readonly chrome?: { readonly webview?: NativeWebView };
}

function getWebView(): NativeWebView | undefined {
  return typeof window === "undefined" ? undefined : (window as WebViewWindow).chrome?.webview;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInstallerState(value: unknown): value is InstallerState {
  return installerStates.some((state) => state === value);
}

function parseInitialize(value: Record<string, unknown>): InitializeMessage | null {
  if (
    (value.mode !== "install" && value.mode !== "uninstall") ||
    (value.scope !== "current" && value.scope !== "all") ||
    typeof value.version !== "string" ||
    typeof value.path !== "string" ||
    typeof value.updated !== "boolean" ||
    typeof value.scopeLocked !== "boolean" ||
    typeof value.showScope !== "boolean"
  ) {
    return null;
  }
  return {
    type: "initialize",
    mode: value.mode,
    version: value.version,
    updated: value.updated,
    scope: value.scope,
    scopeLocked: value.scopeLocked,
    showScope: value.showScope,
    path: value.path,
  };
}

export function parseInstallerMessage(value: unknown): InstallerMessage | null {
  if (!isRecord(value)) return null;

  if (value.type === "initialize") {
    return parseInitialize(value);
  }

  if (value.type === "path" && typeof value.path === "string") {
    return { type: "path", path: value.path };
  }

  // No percentage is supported: reject extra fields, including purported numeric telemetry.
  if (
    value.type === "state" &&
    isInstallerState(value.state) &&
    typeof value.message === "string" &&
    Object.keys(value).every((key) => key === "type" || key === "state" || key === "message")
  ) {
    return {
      type: "state",
      state: value.state,
      message: value.message,
    };
  }

  return null;
}

export const installerBridge = {
  post(command: InstallerCommand): void {
    getWebView()?.postMessage(command);
  },

  subscribe(listener: (message: InstallerMessage) => void): () => void {
    const webview = getWebView();
    if (!webview) return () => undefined;

    const receive: MessageListener = (event) => {
      const message = parseInstallerMessage(event.data);
      if (message) listener(message);
    };

    webview.addEventListener("message", receive);
    return () => webview.removeEventListener("message", receive);
  },
};
