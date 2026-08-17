import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SaveSession } from "@electron/contracts";
import App from "@/App";
import { createRepoDitorApi as bridge, environment, session } from "@/test/repoditorApiFixture";

describe("save discovery integration", () => {
  beforeEach(() => {
    localStorage.clear();
    window.repoditor = bridge(vi.fn());
  });

  it("shows discovery loading while the desktop bridge responds", () => {
    window.repoditor.environment.detect = vi.fn(() => new Promise<never>(() => undefined));
    render(<App />);
    expect(screen.getByLabelText("Discovering local R.E.P.O. saves")).toBeTruthy();
    expect(screen.getByTestId("discovery-skeleton").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("latest-save-skeleton")).toBeTruthy();
    expect(screen.getByTestId("recent-save-skeleton")).toBeTruthy();
    expect(screen.queryByText("Discovering local R.E.P.O. saves.")).toBeNull();
  });

  it.each([
    ["available" as const, "No valid saves yet"],
    ["missing" as const, "Standard save folder not found"],
    ["unavailable" as const, "Save folder could not be read"],
  ])("renders the %s discovery state", async (saveRootStatus, expectedHeading) => {
    window.repoditor.environment.detect = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ...environment,
        saveRootDetected: saveRootStatus === "available",
        saveRootStatus,
        saves: [],
      },
    });
    render(<App />);

    expect(await screen.findByRole("heading", { name: expectedHeading })).toBeTruthy();
  });

  it("keeps the last discovery result when refresh fails", async () => {
    const detect = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: environment })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "discovery_failed", message: "The save folder is temporarily busy." },
      });
    window.repoditor.environment.detect = detect;
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("button", { name: /Open workspace/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText(/Refresh failed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open workspace/ })).toBeTruthy();
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("shows opening state and transitions into the workspace", async () => {
    let finishOpen: ((value: { ok: true; data: SaveSession }) => void) | undefined;
    const open = vi.fn(
      () =>
        new Promise<{ ok: true; data: SaveSession }>((resolve) => {
          finishOpen = resolve;
        }),
    );
    window.repoditor = bridge(open);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(screen.getByRole("button", { name: /Opening save/ }).hasAttribute("disabled")).toBe(
      true,
    );
    finishOpen?.({ ok: true, data: session });

    expect(await screen.findByTestId("workspace")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    screen.getByRole("tab", { name: "Overview" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Players" }).getAttribute("aria-selected")).toBe("true");
  });

  it.each([
    [
      "save_missing" as const,
      "The selected save no longer exists.",
      "The selected save could not be found.",
    ],
    [
      "save_corrupt" as const,
      "The selected save is corrupted.",
      "The selected save could not be safely read or validated.",
    ],
    [
      "save_unsupported" as const,
      "The selected save format is not supported.",
      "The selected save could not be safely read or validated.",
    ],
  ])("keeps discovery visible and reports %s open failures", async (code, message, localized) => {
    window.repoditor = bridge(
      vi.fn().mockResolvedValue({
        ok: false,
        error: { code, message },
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      `${localized} No save files were changed.`,
    );
    expect(screen.queryByTestId("workspace")).toBeNull();
  });
});
