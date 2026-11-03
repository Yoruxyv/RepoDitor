import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { environment, openResult, players, upgrades } from "@/test/repoditorApiFixture";
import { closeTauriPreview, tauriReadApi } from "@/app/tauriReadApi";
import { TauriDiscovery } from "./TauriDiscovery";

vi.mock("@/app/tauriReadApi", () => ({
  tauriReadApi: {
    environment: { detect: vi.fn() },
    saves: { open: vi.fn() },
    game: { status: vi.fn() },
    players: { list: vi.fn() },
    upgrades: { list: vi.fn() },
  },
  closeTauriPreview: vi.fn(),
}));

describe("read-only native discovery", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(tauriReadApi.environment.detect).mockReset();
    vi.mocked(tauriReadApi.saves.open)
      .mockReset()
      .mockResolvedValue(openResult(undefined, "unresolved"));
    vi.mocked(tauriReadApi.game.status)
      .mockReset()
      .mockResolvedValue({ ok: true, data: { status: "not_running", running: false } });
    vi.mocked(closeTauriPreview).mockReset();
    vi.mocked(tauriReadApi.players.list).mockReset().mockResolvedValue({ ok: true, data: players });
    vi.mocked(tauriReadApi.upgrades.list)
      .mockReset()
      .mockResolvedValue({ ok: true, data: upgrades });
  });
  it("reuses discovery, enables save opens, and preserves data on refresh failure", async () => {
    vi.mocked(tauriReadApi.environment.detect)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ...environment,
          saves: [
            ...environment.saves,
            { ...environment.saves[0]!, id: "another", name: "Earlier save" },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "process_timeout", message: "timed out" },
      });
    render(<TauriDiscovery />);
    const latest = await screen.findByRole("button", { name: /Open workspace/ });
    expect(latest.matches(":disabled")).toBe(false);
    expect(screen.getByRole("button", { name: /Earlier save/ }).matches(":disabled")).toBe(false);
    expect(screen.getByText(/Read-only preview/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText(/Refresh failed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open workspace/ })).toBeTruthy();
  });
  it("uses the existing structural initial-loading state", () => {
    vi.mocked(tauriReadApi.environment.detect).mockReturnValue(new Promise(() => undefined));
    render(<TauriDiscovery />);
    expect(screen.getByTestId("discovery-skeleton").getAttribute("aria-busy")).toBe("true");
  });
  it("opens the existing Overview with no edit controls and returns to discovery", async () => {
    vi.mocked(tauriReadApi.environment.detect).mockResolvedValue({ ok: true, data: environment });
    render(<TauriDiscovery />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    const snapshot = await screen.findByRole("heading", { name: "Run snapshot" });
    expect(snapshot).toBeTruthy();
    const workspace = screen.getByTestId("workspace");
    expect(
      within(workspace)
        .getAllByRole("button", { name: /^Open (Run|Items)$/ })
        .every((button) => button.matches(":disabled")),
    ).toBe(true);
    expect(
      within(workspace).getByRole("button", { name: "Open Players" }).matches(":disabled"),
    ).toBe(false);
    expect(within(workspace).queryByRole("spinbutton")).toBeNull();
    expect(within(workspace).queryByRole("button", { name: /Save Changes/ })).toBeNull();
    expect(screen.getByTestId("selected-save-metadata")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change save" }));
    expect(await screen.findByRole("button", { name: /Open workspace/ })).toBeTruthy();
    expect(tauriReadApi.environment.detect).toHaveBeenCalledTimes(2);
  });
  it("keeps Players selection across tabs with read-only details, fallback and keyboard navigation", async () => {
    vi.mocked(tauriReadApi.environment.detect).mockResolvedValue({ ok: true, data: environment });
    render(<TauriDiscovery />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("button", { name: "Open Players" }));
    await user.click(await screen.findByRole("button", { name: /Beta/ }));
    expect(screen.getByRole("spinbutton").hasAttribute("readonly")).toBe(true);
    expect(screen.getByTestId("avatar-fallback").textContent).toBe("B");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(screen.queryByRole("button", { name: "Heal to Full" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Players" }));
    expect(screen.getByRole("button", { name: /Beta/ }).getAttribute("aria-pressed")).toBe("true");
    expect(tauriReadApi.players.list).toHaveBeenCalledTimes(1);
  });
  it("uses the existing Players loading, empty and retry states", async () => {
    vi.mocked(tauriReadApi.environment.detect).mockResolvedValue({ ok: true, data: environment });
    let complete!: (value: Awaited<ReturnType<typeof tauriReadApi.players.list>>) => void;
    vi.mocked(tauriReadApi.players.list)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          complete = resolve;
        }),
      )
      .mockResolvedValueOnce({ ok: true, data: [] });
    render(<TauriDiscovery />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("tab", { name: "Players" }));
    expect(await screen.findByTestId("players-skeleton")).toBeTruthy();
    complete({ ok: false, error: { code: "process_failed", message: "private" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).not.toContain("private");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "No players found" })).toBeTruthy();
  });
  it("synchronizes Players and read-only Upgrades selection and preserves it across tabs", async () => {
    vi.mocked(tauriReadApi.environment.detect).mockResolvedValue({ ok: true, data: environment });
    render(<TauriDiscovery />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("button", { name: "Open Upgrades" }));
    expect(await screen.findByRole("textbox", { name: "Strength for Alpha" })).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "Player" }));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    expect(screen.getByRole("textbox", { name: "Moon Boots for Beta" }).getAttribute("value")).toBe(
      "7",
    );
    expect(screen.queryByRole("spinbutton")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Players" }));
    expect(screen.getByRole("button", { name: /Beta/ }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: /Alpha/ }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Players" }), { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Upgrades" }));
    expect(screen.getByRole("textbox", { name: "Strength for Alpha" }).getAttribute("value")).toBe(
      "2",
    );
    expect(tauriReadApi.upgrades.list).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Change save" }));
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("tab", { name: "Upgrades" }));
    expect(await screen.findByRole("textbox", { name: "Strength for Alpha" })).toBeTruthy();
    expect(tauriReadApi.upgrades.list).toHaveBeenCalledTimes(2);
  });
  it.each(["save_missing", "save_stale", "process_failed"] as const)(
    "shows the existing translated %s failure without entering a workspace",
    async (code) => {
      vi.mocked(tauriReadApi.environment.detect).mockResolvedValue({ ok: true, data: environment });
      vi.mocked(tauriReadApi.saves.open).mockResolvedValue({
        ok: false,
        error: { code, message: "private raw diagnostic" },
      });
      render(<TauriDiscovery />);
      await userEvent.setup().click(await screen.findByRole("button", { name: /Open workspace/ }));
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(screen.getByRole("alert").textContent).not.toContain("private");
      expect(screen.queryByTestId("workspace")).toBeNull();
    },
  );
  it("preserves unknown/running safety states, retry, focus checks and native exit", async () => {
    vi.mocked(tauriReadApi.environment.detect).mockResolvedValue({ ok: true, data: environment });
    vi.mocked(tauriReadApi.game.status).mockResolvedValue({
      ok: true,
      data: { status: "unknown", running: false },
    });
    render(<TauriDiscovery />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(true);
    vi.mocked(tauriReadApi.game.status).mockResolvedValue({
      ok: true,
      data: { status: "not_running", running: false },
    });
    await user.click(screen.getByRole("button", { name: "Check Again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    vi.mocked(tauriReadApi.game.status).mockResolvedValue({
      ok: false,
      error: { code: "invalid_response", message: "private" },
    });
    fireEvent(window, new Event("focus"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Exit RepoDitor" }));
    expect(closeTauriPreview).toHaveBeenCalledTimes(1);
  });
});
