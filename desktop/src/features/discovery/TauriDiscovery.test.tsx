import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { environment, openResult } from "@/test/repoditorApiFixture";
import { closeTauriPreview, tauriReadApi } from "@/app/tauriReadApi";
import { TauriDiscovery } from "./TauriDiscovery";

vi.mock("@/app/tauriReadApi", () => ({
  tauriReadApi: {
    environment: { detect: vi.fn() },
    saves: { open: vi.fn() },
    game: { status: vi.fn() },
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
        .getAllByRole("button", { name: /^Open / })
        .every((button) => button.matches(":disabled")),
    ).toBe(true);
    expect(within(workspace).queryByRole("spinbutton")).toBeNull();
    expect(within(workspace).queryByRole("button", { name: /Save Changes/ })).toBeNull();
    expect(screen.getByTestId("selected-save-metadata")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change save" }));
    expect(await screen.findByRole("button", { name: /Open workspace/ })).toBeTruthy();
    expect(tauriReadApi.environment.detect).toHaveBeenCalledTimes(2);
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
