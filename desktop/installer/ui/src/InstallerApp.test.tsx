import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { InstallerApp } from "./InstallerApp";
import { installerCommands, installerStates, parseInstallerMessage } from "./bridge/webview";

type MessageListener = (event: { readonly data: unknown }) => void;

const postMessage = vi.fn();
let listeners: Set<MessageListener>;

function sendFromHost(data: unknown) {
  act(() => {
    for (const listener of listeners) listener({ data });
  });
}

function initialize(mode: "install" | "uninstall" = "install", updated = false) {
  sendFromHost({
    type: "initialize",
    mode,
    version: "0.2.1",
    updated,
    scope: "current",
    scopeLocked: updated,
    showScope: true,
    path: "C:\\RepoDitor",
  });
}

function stage(state: string) {
  sendFromHost({ type: "state", state, message: "" });
}

beforeEach(() => {
  postMessage.mockReset();
  listeners = new Set();
  Object.defineProperty(window, "chrome", {
    configurable: true,
    value: {
      webview: {
        postMessage,
        addEventListener: (_type: "message", listener: MessageListener) => listeners.add(listener),
        removeEventListener: (_type: "message", listener: MessageListener) =>
          listeners.delete(listener),
      },
    },
  });
});

describe("installer WebView2 contract", () => {
  test("keeps the complete command allowlist explicit", () => {
    expect(installerCommands).toEqual([
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
    ]);
  });

  test("rejects unknown native messages", () => {
    expect(parseInstallerMessage({ type: "state", state: "percent", message: "50" })).toBeNull();
    expect(parseInstallerMessage({ type: "path", path: 42 })).toBeNull();
    expect(parseInstallerMessage("initialize")).toBeNull();
    expect(parseInstallerMessage({ type: "initialize", mode: "unknown" })).toBeNull();
    expect(parseInstallerMessage({ type: "state", state: "installing", message: 42 })).toBeNull();
    expect(parseInstallerMessage({ type: "state", state: "installing" })).toBeNull();
    expect(parseInstallerMessage(null)).toBeNull();
    expect(parseInstallerMessage([])).toBeNull();
  });

  test("explicitly accepts only the native semantic states", () => {
    expect(installerStates).toEqual([
      "ready",
      "preparing",
      "installing",
      "finalizing",
      "success",
      "failure",
    ]);
    for (const state of installerStates) {
      const message = { type: "state", state, message: "" };
      expect(parseInstallerMessage(message)).toEqual(message);
    }
  });

  test.each([NaN, Infinity, -Infinity, -1, 101, "50", null, 0, 43, 100])(
    "rejects unsupported percentage telemetry: %s",
    (percentage) => {
      expect(
        parseInstallerMessage({
          type: "state",
          state: "installing",
          message: "",
          percentage,
        }),
      ).toBeNull();
    },
  );
});

test("renders an initialized install and preserves a long selectable path", () => {
  const longPath =
    "C:\\Users\\ASUS\\AppData\\Local\\Programs\\A very long parent folder\\RepoDitor";
  render(<InstallerApp />);

  expect(postMessage).toHaveBeenCalledWith("ready");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Install" }).disabled).toBe(true);

  sendFromHost({
    type: "initialize",
    mode: "install",
    version: "0.2.1",
    updated: false,
    scope: "current",
    scopeLocked: false,
    showScope: true,
    path: longPath,
  });

  const path = screen.getByLabelText("INSTALL LOCATION");
  expect(path).toBeInstanceOf(HTMLInputElement);
  expect((path as HTMLInputElement).value).toBe(longPath);
  expect((path as HTMLInputElement).readOnly).toBe(true);
  expect(path.getAttribute("title")).toBe(longPath);
  (path as HTMLInputElement).select();
  expect((path as HTMLInputElement).selectionStart).toBe(0);
  expect((path as HTMLInputElement).selectionEnd).toBe(longPath.length);

  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  fireEvent.click(screen.getByLabelText("All users"));
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  expect(postMessage).toHaveBeenCalledWith("choose-path");
  expect(postMessage).toHaveBeenCalledWith("scope:all");
  expect(postMessage).toHaveBeenCalledWith("start");
});

test.each([false, true])("represents real install/update stages, updated=%s", (updated) => {
  render(<InstallerApp />);
  initialize("install", updated);
  fireEvent.click(screen.getByRole("button", { name: updated ? "Update" : "Install" }));
  expect(screen.queryByRole("progressbar")).toBeNull();

  stage("preparing");
  expect(screen.getByRole("status").textContent).toBe("Preparing installation…");
  stage("installing");
  expect(screen.getByRole("heading", { name: "Installing RepoDitor" }).isConnected).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("Running installation…");
  const progress = screen.getByRole("progressbar");
  expect(progress.getAttribute("aria-valuenow")).toBeNull();
  expect(progress.getAttribute("aria-valuetext")).toBe("Running installation…");
  expect(progress.closest("section")?.getAttribute("aria-busy")).toBe("true");
  expect(screen.queryByRole("button", { name: "Launch RepoDitor" })).toBeNull();
  stage("finalizing");
  expect(screen.getByRole("status").textContent).toBe("Verifying installation…");
  expect(screen.queryByRole("button", { name: "Launch RepoDitor" })).toBeNull();

  stage("success");
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByRole("heading", { name: "RepoDitor is ready" }).isConnected).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Launch RepoDitor" }));
  expect(postMessage).toHaveBeenCalledWith("launch");
});

test("ignores early success, out-of-order stages, and malformed telemetry", () => {
  render(<InstallerApp />);
  stage("success");
  initialize();
  stage("success");
  stage("finalizing");
  expect(screen.getByRole("heading", { name: "Ready to install" }).isConnected).toBe(true);
  stage("preparing");
  stage("success");
  sendFromHost({ type: "state", state: "installing", message: "", percentage: 100 });
  expect(screen.getByRole("status").textContent).toBe("Preparing installation…");
  stage("installing");
  stage("success");
  stage("preparing");
  initialize("uninstall");
  expect(screen.getByRole("status").textContent).toBe("Running installation…");
});

test.each(["preparing", "installing", "finalizing"])(
  "failure at %s stops progress and rejects late success until native retry starts",
  (failedStage) => {
    render(<InstallerApp />);
    initialize();
    for (const current of ["preparing", "installing", "finalizing"]) {
      stage(current);
      if (current === failedStage) break;
    }
    sendFromHost({ type: "state", state: "failure", message: "The installer engine failed." });
    stage("finalizing");
    stage("success");
    stage("installing");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("heading", { name: "Installation failed" }).isConnected).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("The installer engine failed.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(postMessage).toHaveBeenCalledWith("retry");
    stage("success");
    expect(screen.queryByRole("progressbar")).toBeNull();
    stage("preparing");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Preparing installation…");
    expect(screen.getByRole("progressbar").getAttribute("value")).toBeNull();
    stage("installing");
    stage("finalizing");
    stage("success");
    expect(screen.getByRole("heading", { name: "RepoDitor is ready" }).isConnected).toBe(true);
  },
);

test("a claimed 100 percent cannot complete native verification", () => {
  render(<InstallerApp />);
  initialize();
  stage("preparing");
  stage("installing");
  stage("finalizing");
  sendFromHost({ type: "state", state: "success", message: "", percentage: 100 });
  expect(screen.getByRole("status").textContent).toBe("Verifying installation…");
  expect(screen.queryByRole("button", { name: "Launch RepoDitor" })).toBeNull();
  sendFromHost({ type: "state", state: "failure", message: "Verification failed." });
  sendFromHost({ type: "state", state: "success", message: "", percentage: 100 });
  stage("success");
  expect(screen.getByRole("alert").textContent).toBe("Verification failed.");
  expect(screen.queryByRole("progressbar")).toBeNull();
});

test("preserves uninstall scope and completion behavior", () => {
  render(<InstallerApp />);
  sendFromHost({
    type: "initialize",
    mode: "uninstall",
    version: "0.2.1",
    updated: false,
    scope: "all",
    scopeLocked: false,
    showScope: false,
    path: "C:\\Program Files\\RepoDitor",
  });

  expect(screen.getByRole("heading", { name: "Uninstall RepoDitor?" }).isConnected).toBe(true);
  expect(screen.queryByLabelText("INSTALL LOCATION")).toBeNull();
  expect(screen.queryByText("Current user")).toBeNull();

  stage("preparing");
  expect(screen.getByRole("status").textContent).toBe("Preparing removal…");
  stage("installing");
  expect(screen.getByRole("status").textContent).toBe("Running removal…");
  stage("finalizing");
  expect(screen.getByRole("status").textContent).toBe("Verifying removal…");
  expect(screen.queryByRole("heading", { name: "Uninstall finished" })).toBeNull();
  stage("success");
  const complete = screen
    .getAllByRole("button", { name: "Close" })
    .find((button) => button.classList.contains("primary"));
  expect(complete).toBeDefined();
  fireEvent.click(complete as HTMLButtonElement);
  expect(postMessage).toHaveBeenCalledWith("close");
});
