import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/app/i18n/I18nProvider";
import { FindSaveDialog } from "@/features/save-file/components/FindSaveDialog";
import {
  detectInitialGuidancePlatform,
  PROTON_REPO_SUFFIX,
  WINDOWS_META_PATH,
  WINDOWS_RUN_PATH,
} from "@/features/save-file/saveLocations";

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const userAgentDescriptor = Object.getOwnPropertyDescriptor(navigator, "userAgent");

function restoreNavigatorProperty(
  name: "clipboard" | "userAgent",
  descriptor?: PropertyDescriptor,
) {
  if (descriptor) {
    Object.defineProperty(navigator, name, descriptor);
  } else {
    Reflect.deleteProperty(navigator, name);
  }
}

function installClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

function installUserAgent(userAgent: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

function openDialog() {
  const trigger = screen.getByRole("button", { name: "Find my save" });
  trigger.focus();
  fireEvent.click(trigger);
  return { dialog: screen.getByRole("dialog"), trigger };
}

function renderDialog() {
  return render(
    <I18nProvider>
      <FindSaveDialog />
    </I18nProvider>,
  );
}

beforeEach(() => {
  installUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreNavigatorProperty("clipboard", clipboardDescriptor);
  restoreNavigatorProperty("userAgent", userAgentDescriptor);
});

describe("Find My Save guidance", () => {
  it("opens with Windows paths, explicit MetaSave guidance, and returns focus on close", () => {
    renderDialog();
    const { dialog, trigger } = openDialog();

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.className).toContain("max-w-xl");
    expect(dialog.className).toContain("rounded-sm");
    expect(dialog.className).toContain("border-line");
    expect(dialog.className).not.toContain("overflow-y-auto");
    expect(dialog.className).not.toContain("overflow-y-scroll");
    expect(dialog.className).not.toContain("overflow-hidden");
    const scrollRegion = screen.getByTestId("find-save-scroll-region");
    expect(scrollRegion.className).toContain("min-h-0");
    expect(scrollRegion.className).toContain("overflow-y-auto");
    expect(scrollRegion.className).not.toContain("overflow-y-scroll");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close save location guide" }),
    );
    const runPath = screen.getByText(WINDOWS_RUN_PATH);
    expect(runPath.className).toContain("whitespace-normal");
    expect(runPath.className).toContain("break-all");
    expect(runPath.className).not.toContain("overflow-x-auto");
    expect(runPath.className).not.toContain("whitespace-nowrap");
    expect(screen.getByText(WINDOWS_META_PATH)).toBeTruthy();
    expect(screen.getByText(/For cosmetics, select/iu).textContent).toContain("MetaSave.es3");
    expect(screen.getByRole("status").className).toContain("sr-only");

    fireEvent.click(screen.getByRole("button", { name: "Close save location guide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on the native Escape cancel event and restores trigger focus", () => {
    renderDialog();
    const { dialog, trigger } = openDialog();

    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("renders accurate Linux and Proton guidance and supports manual keyboard tab switching", () => {
    renderDialog();
    openDialog();
    const windows = screen.getByRole("tab", { name: "Windows" });
    const linux = screen.getByRole("tab", { name: "Linux / Proton" });

    fireEvent.keyDown(windows, { key: "ArrowRight" });

    expect(linux.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(linux);
    expect(screen.getAllByText(/3241660/iu).length).toBeGreaterThan(0);
    const protonPath = screen.getByText(PROTON_REPO_SUFFIX);
    expect(protonPath.className).toContain("whitespace-normal");
    expect(protonPath.className).toContain("break-all");
    expect(protonPath.className).not.toContain("overflow-x-auto");
    expect(protonPath.className).not.toContain("whitespace-nowrap");
    expect(screen.getByText("~/.local/share/Steam/")).toBeTruthy();
    expect(screen.getByText("~/.steam/steam/")).toBeTruthy();
    expect(screen.getByText(/Custom Steam libraries may be on another disk/iu)).toBeTruthy();
    expect(screen.getByText(/Press Ctrl \+ L/iu)).toBeTruthy();
    const linuxPanel = screen.getByRole("tabpanel");
    expect(linuxPanel.textContent).toContain("saves/");
    expect(linuxPanel.textContent).toContain("MetaSave.es3");

    fireEvent.click(windows);
    expect(windows.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(WINDOWS_RUN_PATH)).toBeTruthy();
  });

  it("uses platform information only for the initial tab and always allows switching", () => {
    expect(detectInitialGuidancePlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(detectInitialGuidancePlatform("Mozilla/5.0 (Linux; Android 16)")).toBe("windows");
    expect(detectInitialGuidancePlatform("unknown")).toBe("windows");
    installUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    renderDialog();
    openDialog();

    const linux = screen.getByRole("tab", { name: "Linux / Proton" });
    const windows = screen.getByRole("tab", { name: "Windows" });
    expect(linux.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(windows);
    expect(windows.getAttribute("aria-selected")).toBe("true");
  });

  it("copies exact paths with polite feedback and makes no network requests", async () => {
    const writeText = installClipboard();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderDialog();
    openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Copy Windows Run saves path" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(WINDOWS_RUN_PATH));
    const copyStatus = screen.getByRole("status");
    expect(copyStatus.textContent).toBe("Windows Run saves path copied.");
    expect(copyStatus.className).not.toContain("sr-only");
    fireEvent.click(screen.getByRole("tab", { name: "Linux / Proton" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Linux Proton Repo path" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(PROTON_REPO_SUFFIX));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
