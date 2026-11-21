import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderWithPreferences } from "@/test/render";
import { TauriLegacyInstallNotice } from "./TauriLegacyInstallNotice";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const registration = "legacy_install_registered";
const key = "repoditor.migration.electron-0.2.1";
const name = "RepoDitor v0.2.1 is still installed";

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset().mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

it("checks once on startup and opens Installed Apps only on request", async () => {
  renderWithPreferences(
    <StrictMode>
      <TauriLegacyInstallNotice />
    </StrictMode>,
  );
  expect(await screen.findByRole("dialog", { name })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remind Me Later" }));
  expect(invoke).toHaveBeenCalledExactlyOnceWith(registration);
  expect(localStorage.getItem(key)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Installed Apps" }));
  expect(invoke).toHaveBeenLastCalledWith("open_installed_apps");
  expect(localStorage.getItem(key)).toBeNull();
});

it.each([false, null, { installed: true }])(
  "ignores an absent or invalid result (%j)",
  async (result) => {
    vi.mocked(invoke).mockResolvedValue(result);
    renderWithPreferences(<TauriLegacyInstallNotice />);
    await act(async () => {});
    expect(invoke).toHaveBeenCalledExactlyOnceWith(registration);
    expect(screen.queryByRole("dialog", { name })).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  },
);

it("removes the notice when the registration disappears and focus returns", async () => {
  renderWithPreferences(<TauriLegacyInstallNotice />);
  await screen.findByRole("dialog", { name });
  vi.mocked(invoke).mockResolvedValue(false);
  fireEvent.focus(window);
  await waitFor(() => expect(screen.queryByRole("dialog", { name })).toBeNull());
  fireEvent.focus(window);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(key)).toBeNull();
});

it("remembers a deferral across startup for seven days", async () => {
  const now = 1_800_000_000_000;
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const first = renderWithPreferences(<TauriLegacyInstallNotice />);
  await screen.findByRole("dialog", { name });
  fireEvent.click(screen.getByRole("button", { name: "Remind Me Later" }));
  expect(screen.queryByRole("dialog", { name })).toBeNull();
  first.unmount();

  const second = renderWithPreferences(<TauriLegacyInstallNotice />);
  await act(async () => {});
  expect(invoke).toHaveBeenCalledExactlyOnceWith(registration);
  expect(screen.queryByRole("dialog", { name })).toBeNull();
  second.unmount();

  clock.mockReturnValue(now + 7 * 24 * 60 * 60 * 1000);
  renderWithPreferences(<TauriLegacyInstallNotice />);
  expect(await screen.findByRole("dialog", { name })).toBeTruthy();
});

it("keeps a permanent dismissal across startup", async () => {
  const first = renderWithPreferences(<TauriLegacyInstallNotice />);
  await screen.findByRole("dialog", { name });
  fireEvent.click(screen.getByRole("button", { name: "Don't Show Again" }));
  first.unmount();
  renderWithPreferences(<TauriLegacyInstallNotice />);
  await act(async () => {});
  expect(invoke).toHaveBeenCalledExactlyOnceWith(registration);
  expect(screen.queryByRole("dialog", { name })).toBeNull();
});

it("offers the manual Settings path if the system action fails", async () => {
  renderWithPreferences(<TauriLegacyInstallNotice />);
  await screen.findByRole("dialog", { name });
  vi.mocked(invoke).mockRejectedValue(new Error("Settings unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Open Installed Apps" }));
  expect(
    await screen.findByText("Open Windows Settings and go to Apps → Installed apps."),
  ).toBeTruthy();
  expect(screen.getByRole("dialog", { name })).toBeTruthy();
});

it("treats Escape as Remind Me Later", async () => {
  const now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockReturnValue(now);
  renderWithPreferences(<TauriLegacyInstallNotice />);
  const modal = await screen.findByRole("dialog", { name });
  fireEvent(modal, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog", { name })).toBeNull();
  expect(localStorage.getItem(key)).toBe(String(now + 7 * 24 * 60 * 60 * 1000));
});

it("defers to the game-safety dialog without saving a dismissal", async () => {
  const { rerender } = renderWithPreferences(<TauriLegacyInstallNotice suspended />);
  await act(async () => {});
  expect(screen.queryByRole("dialog", { name })).toBeNull();
  rerender(<TauriLegacyInstallNotice />);
  expect(await screen.findByRole("dialog", { name })).toBeTruthy();
  rerender(<TauriLegacyInstallNotice suspended />);
  expect(screen.queryByRole("dialog", { name })).toBeNull();
  expect(localStorage.getItem(key)).toBeNull();
});
