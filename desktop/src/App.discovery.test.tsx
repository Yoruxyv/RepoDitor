import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SaveOpenResult } from "@electron/contracts";
import App from "@/App";
import { createRepoDitorApi as bridge, environment, openResult } from "@/test/repoditorApiFixture";

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
    let finishOpen: ((value: { ok: true; data: SaveOpenResult }) => void) | undefined;
    const open = vi.fn(
      () =>
        new Promise<{ ok: true; data: SaveOpenResult }>((resolve) => {
          finishOpen = resolve;
        }),
    );
    window.repoditor = bridge(open);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(screen.getByRole("heading", { name: "Reading and preparing this save" })).toBeTruthy();
    expect(screen.queryByTestId("workspace")).toBeNull();
    finishOpen?.(openResult());

    expect(await screen.findByTestId("workspace")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    screen.getByRole("tab", { name: "Overview" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Players" }).getAttribute("aria-selected")).toBe("true");
  });

  it("restores the previous discovery snapshot immediately and refreshes in background", async () => {
    let finishRefresh:
      | ((value: Awaited<ReturnType<typeof window.repoditor.environment.detect>>) => void)
      | undefined;
    const detect = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: environment })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefresh = resolve;
          }),
      );
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()));
    window.repoditor.environment.detect = detect;
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByTestId("workspace")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change save" }));

    expect(screen.getByRole("button", { name: /Open workspace/ })).toBeTruthy();
    expect(screen.queryByTestId("discovery-skeleton")).toBeNull();
    expect(screen.getByRole("button", { name: "Refreshing" })).toBeTruthy();
    expect(detect).toHaveBeenCalledTimes(2);

    await act(async () => {
      finishRefresh?.({ ok: true, data: environment });
    });
  });

  it("replaces the retained discovery snapshot after a successful return refresh", async () => {
    let finishRefresh:
      | ((value: Awaited<ReturnType<typeof window.repoditor.environment.detect>>) => void)
      | undefined;
    const updated = {
      ...environment,
      saves: [
        {
          ...environment.saves[0]!,
          id: "REPO_SAVE_2026_08_08_10_20_31",
          name: "2026-08-08 10:20:31",
          path: "C:\\fixture\\saves\\REPO_SAVE_2026_08_08_10_20_31\\REPO_SAVE_2026_08_08_10_20_31.es3",
        },
      ],
    };
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()));
    window.repoditor.environment.detect = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: environment })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRefresh = resolve;
          }),
      );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("button", { name: "Change save" }));
    expect(screen.getByText(environment.saves[0]!.name)).toBeTruthy();

    await act(async () => {
      finishRefresh?.({ ok: true, data: updated });
    });

    expect(await screen.findByText(updated.saves[0]!.name)).toBeTruthy();
    expect(screen.queryByText(environment.saves[0]!.name)).toBeNull();
  });

  it("keeps the retained discovery snapshot when the return refresh fails", async () => {
    const detect = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: environment })
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "discovery_failed" as const,
          message: "The save folder is temporarily busy.",
        },
      });
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()));
    window.repoditor.environment.detect = detect;
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("button", { name: "Change save" }));

    expect(await screen.findByText(/Refresh failed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open workspace/ })).toBeTruthy();
    expect(screen.queryByTestId("discovery-skeleton")).toBeNull();
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("does not rediscover merely when switching between Run Saves and Cosmetics", async () => {
    const detect = vi.fn().mockResolvedValue({ ok: true, data: environment });
    window.repoditor.environment.detect = detect;
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("button", { name: /Open workspace/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await user.click(screen.getByRole("button", { name: "Run Saves" }));

    expect(screen.getByRole("button", { name: /Open workspace/ })).toBeTruthy();
    expect(detect).toHaveBeenCalledTimes(1);
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
