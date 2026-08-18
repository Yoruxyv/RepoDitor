import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { createRepoDitorApi as bridge, openResult, session } from "@/test/repoditorApiFixture";

describe("game safety integration", () => {
  beforeEach(() => {
    localStorage.clear();
    window.repoditor = bridge(vi.fn());
  });

  it("keeps discovery usable while the initial game verification is pending", () => {
    window.repoditor.game.status = vi.fn(() => new Promise<never>(() => undefined));

    render(<App />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(false);
    expect(screen.getByTestId("editor-content").getAttribute("aria-busy")).toBe("false");
  });

  it("blocks the editor while R.E.P.O. is running until Check Again confirms it closed", async () => {
    const gameStatus = vi.mocked(window.repoditor.game.status);
    window.repoditor.saves.open = vi.fn().mockResolvedValue(openResult());
    gameStatus
      .mockResolvedValueOnce({ ok: true, data: { status: "running", running: true } })
      .mockResolvedValueOnce({ ok: true, data: { status: "running", running: true } })
      .mockResolvedValueOnce({ ok: true, data: { status: "not_running", running: false } });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("button", { name: /Open workspace/ })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Open workspace/ }));
    expect(
      await screen.findByRole("heading", { name: "R.E.P.O. is currently running" }),
    ).toBeTruthy();
    expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Check Again" }));
    expect(
      await screen.findByRole("heading", { name: "R.E.P.O. is currently running" }),
    ).toBeTruthy();
    expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Check Again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(false);
  });

  it("fails closed on an open workspace when game process status is unknown", async () => {
    window.repoditor.saves.open = vi.fn().mockResolvedValue(openResult());
    window.repoditor.game.status = vi.fn().mockResolvedValue({
      ok: true,
      data: { status: "unknown", running: false },
    });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("button", { name: /Open workspace/ })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(false);
    await user.click(screen.getByRole("button", { name: /Open workspace/ }));
    expect(
      await screen.findByRole("heading", {
        name: "RepoDitor could not verify that R.E.P.O. is closed.",
      }),
    ).toBeTruthy();
    expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(true);
  });

  it("rechecks game safety silently on focus without reloading MetaSave", async () => {
    const getCosmetics = vi.mocked(window.repoditor.cosmetics.get);
    const gameStatus = vi.mocked(window.repoditor.game.status);
    let finishFocusCheck:
      ((value: { ok: true; data: { status: "not_running"; running: false } }) => void) | undefined;
    gameStatus
      .mockResolvedValueOnce({ ok: true, data: { status: "not_running", running: false } })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFocusCheck = resolve;
          }),
      );
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(gameStatus).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await waitFor(() => expect(getCosmetics).toHaveBeenCalledTimes(1));

    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(gameStatus).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(false);
    expect(getCosmetics).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFocusCheck?.({ ok: true, data: { status: "not_running", running: false } });
    });
    await waitFor(() =>
      expect(screen.getByTestId("editor-content").getAttribute("aria-busy")).toBe("false"),
    );
  });

  it("reloads persisted Cosmetics after a running game closes when there are no pending edits", async () => {
    const getCosmetics = vi.mocked(window.repoditor.cosmetics.get);
    const gameStatus = vi.mocked(window.repoditor.game.status);
    gameStatus
      .mockResolvedValueOnce({ ok: true, data: { status: "not_running", running: false } })
      .mockResolvedValueOnce({ ok: true, data: { status: "running", running: true } })
      .mockResolvedValueOnce({ ok: true, data: { status: "not_running", running: false } });
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(gameStatus).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await waitFor(() => expect(getCosmetics).toHaveBeenCalledTimes(1));

    act(() => window.dispatchEvent(new Event("focus")));
    expect(
      await screen.findByRole("heading", { name: "R.E.P.O. is currently running" }),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Check Again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(getCosmetics).toHaveBeenCalledTimes(2));
  });

  it("focus safety checks do not discard pending Cosmetics edits", async () => {
    const getCosmetics = vi.mocked(window.repoditor.cosmetics.get);
    const gameStatus = vi.mocked(window.repoditor.game.status);
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(gameStatus).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await user.click(await screen.findByRole("button", { name: /^Unlock All Cosmetics$/ }));
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe("1 pending change");
    expect(document.querySelector("#cosmetics-pending")?.textContent).toContain("1 pending change");

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(gameStatus).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Run Saves" }));
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));

    expect(getCosmetics).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Unlock All pending" })).toBeTruthy();
  });

  it(
    "reconciles discovery after game-safety recovery without remounting its prior data",
    async () => {
      const detect = vi.mocked(window.repoditor.environment.detect);
      const gameStatus = vi.mocked(window.repoditor.game.status);
      gameStatus
        .mockResolvedValueOnce({ ok: true, data: { status: "not_running", running: false } })
        .mockResolvedValueOnce({ ok: true, data: { status: "running", running: true } })
        .mockResolvedValueOnce({ ok: true, data: { status: "not_running", running: false } });
      render(<App />);

      expect(await screen.findByRole("button", { name: /Open workspace/ })).toBeTruthy();
      await waitFor(() => expect(detect).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(gameStatus).toHaveBeenCalledTimes(1));

      act(() => window.dispatchEvent(new Event("focus")));
      await waitFor(() => expect(gameStatus).toHaveBeenCalledTimes(2));
      expect(screen.getByRole("button", { name: /Open workspace/ })).toBeTruthy();

      act(() => window.dispatchEvent(new Event("focus")));
      await waitFor(() => expect(gameStatus).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(detect).toHaveBeenCalledTimes(2));

      expect(screen.getByRole("button", { name: /Open workspace/ })).toBeTruthy();
      expect(screen.queryByTestId("discovery-skeleton")).toBeNull();
    },
  );

  it("defers discovery reconciliation while a Run save workspace is open", async () => {
    const detect = vi.mocked(window.repoditor.environment.detect);
    const gameStatus = vi.mocked(window.repoditor.game.status);
    window.repoditor.saves.open = vi.fn().mockResolvedValue(openResult());
    gameStatus
      .mockResolvedValueOnce({ ok: true, data: { status: "not_running", running: false } })
      .mockResolvedValueOnce({ ok: true, data: { status: "running", running: true } })
      .mockResolvedValueOnce({ ok: true, data: { status: "not_running", running: false } });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByTestId("workspace")).toBeTruthy();
    expect(detect).toHaveBeenCalledTimes(1);

    act(() => window.dispatchEvent(new Event("focus")));
    expect(
      await screen.findByRole("heading", { name: "R.E.P.O. is currently running" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Check Again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(detect).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Change save" }));
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("discovery-skeleton")).toBeNull();
  });

});
