import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tauriHealthApi } from "@/app/tauriHealthApi";
import { tauriReadApi } from "@/app/tauriReadApi";
import { renderWithPreferences } from "@/test/render";
import {
  advanced,
  maps,
  openResult,
  players,
  runState,
  session,
  upgrades,
} from "@/test/repoditorApiFixture";
import { TauriWorkspace } from "./TauriWorkspace";

vi.mock("@/app/tauriHealthApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/tauriHealthApi")>()),
  tauriHealthApi: { state: vi.fn(), write: vi.fn(), recover: vi.fn(), writeUpgrades: vi.fn() },
}));
vi.mock("@/app/tauriReadApi", () => ({
  tauriReadApi: {
    players: { list: vi.fn() },
    upgrades: { list: vi.fn() },
    run: { get: vi.fn() },
    advanced: { get: vi.fn() },
    maps: { list: vi.fn() },
  },
}));

async function openUpgrades() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "Upgrades" }));
  await screen.findByRole("spinbutton", { name: "Strength for Alpha" });
  return user;
}

describe("native upgrade drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauriReadApi.players.list).mockResolvedValue({ ok: true, data: players });
    vi.mocked(tauriReadApi.upgrades.list).mockResolvedValue({ ok: true, data: upgrades });
    vi.mocked(tauriReadApi.run.get).mockResolvedValue({ ok: true, data: runState });
    vi.mocked(tauriReadApi.advanced.get).mockResolvedValue({ ok: true, data: advanced });
    vi.mocked(tauriReadApi.maps.list).mockResolvedValue({ ok: true, data: maps });
    vi.mocked(tauriHealthApi.state).mockResolvedValue({
      enabled: true,
      state: "idle",
      pending: null,
      canonical: { opened: openResult().data, players, upgrades },
      upgradeSession: "synthetic-session",
    });
    vi.mocked(tauriHealthApi.write).mockImplementation(async (request) => ({
      operationId: request.operationId,
      status: "rejected",
      fingerprint: null,
      backupAvailable: false,
      reason: "save_stale",
      canonical: null,
    }));
  });

  it("reviews per-player drafts across keyboard tab navigation and reverts without a writer", async () => {
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    const user = await openUpgrades();
    const first = screen.getByRole("spinbutton", { name: "Strength for Alpha" });
    fireEvent.change(first, { target: { value: "3" } });
    await user.click(screen.getByRole("combobox", { name: "Player" }));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Strength for Beta" }), {
      target: { value: "4" },
    });
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "2 pending changes",
    );
    await user.click(screen.getByRole("button", { name: "Review" }));
    const review = within(screen.getByTestId("workspace-review"));
    expect(review.getByText("Alpha · Strength")).toBeTruthy();
    expect(review.getByText("Beta · Strength")).toBeTruthy();
    expect(review.getByText("2 → 3")).toBeTruthy();
    expect(review.getByText("0 → 4")).toBeTruthy();
    const tab = screen.getByRole("tab", { name: "Upgrades" });
    tab.focus();
    await user.keyboard("{ArrowLeft}{ArrowRight}");
    expect(document.activeElement).toBe(tab);
    expect(
      screen.getByRole("spinbutton", { name: "Strength for Beta" }).getAttribute("value"),
    ).toBe("4");
    const save = screen.getByRole("button", { name: "Save Changes" });
    expect(save.matches(":disabled")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("1 pending change");
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    expect(
      screen.getByRole("spinbutton", { name: "Strength for Beta" }).getAttribute("value"),
    ).toBe("0");
    expect(tauriHealthApi.write).not.toHaveBeenCalled();
    expect(tauriHealthApi.writeUpgrades).not.toHaveBeenCalled();
    expect(tauriHealthApi.recover).not.toHaveBeenCalled();
  });

  it("persists a reviewed batch and refreshes canonical values without losing player selection", async () => {
    const projected = upgrades.map((upgrade) => ({
      ...upgrade,
      values: upgrade.values.map((value) =>
        upgrade.key === "playerUpgradeStrength"
          ? { ...value, value: value.playerId === "111" ? 3 : 4 }
          : value,
      ),
    }));
    vi.mocked(tauriHealthApi.writeUpgrades).mockImplementation(async (request) => ({
      operationId: request.operationId,
      status: "applied",
      fingerprint: "b".repeat(64),
      backupAvailable: true,
      reason: null,
      canonical: null,
    }));
    vi.mocked(tauriHealthApi.recover).mockImplementation(async (_save, operationId) => ({
      operationId,
      status: "applied",
      fingerprint: "b".repeat(64),
      backupAvailable: true,
      reason: null,
      canonical: {
        opened: { ...openResult().data, session: { ...session, fingerprint: "b".repeat(64) } },
        players,
        upgrades: projected,
      },
    }));
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    const user = await openUpgrades();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Strength for Alpha" }), {
      target: { value: "3" },
    });
    await user.click(screen.getByRole("combobox", { name: "Player" }));
    await user.click(screen.getByRole("option", { name: "Beta" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Strength for Beta" }), {
      target: { value: "4" },
    });
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(screen.getByTestId("health-status").getAttribute("data-phase")).toBe("saved"),
    );
    expect(tauriHealthApi.writeUpgrades).toHaveBeenCalledWith(
      expect.objectContaining({
        saveId: session.id,
        session: "synthetic-session",
        fingerprint: session.fingerprint,
        upgrades: [
          { playerId: "111", key: "playerUpgradeStrength", before: 2, value: 3 },
          { playerId: "222", key: "playerUpgradeStrength", before: 0, value: 4 },
        ],
      }),
    );
    expect(
      screen.getByRole("spinbutton", { name: "Strength for Beta" }).getAttribute("value"),
    ).toBe("4");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    expect(screen.getByTestId("workspace").getAttribute("data-session-fingerprint")).toBe(
      "b".repeat(64),
    );
    expect(tauriHealthApi.recover).toHaveBeenLastCalledWith(session.id, expect.any(String), true);
  });

  it("never partially saves health while upgrade drafts are pending", async () => {
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    const user = await openUpgrades();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Strength for Alpha" }), {
      target: { value: "3" },
    });
    await user.click(screen.getByRole("tab", { name: "Players" }));
    const health = await screen.findByRole("spinbutton", { name: "Current health" });
    health.focus();
    fireEvent.change(health, {
      target: { value: "17" },
    });
    await user.tab();
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "2 pending changes",
    );
    const save = screen.getByRole("button", { name: "Save Changes" });
    expect(save.matches(":disabled")).toBe(true);
    fireEvent.click(save);
    expect(tauriHealthApi.write).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    await user.click(screen.getByRole("button", { name: "Revert upgrade drafts" }));
    await user.click(screen.getByRole("tab", { name: "Players" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(tauriHealthApi.write).toHaveBeenCalledTimes(1));
    expect(tauriHealthApi.write).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: "111", health: 17 }),
    );
  });

  it("resets invalid input locally and does not retain drafts after unmount", async () => {
    const { unmount } = renderWithPreferences(
      <TauriWorkspace session={session} onClose={vi.fn()} />,
    );
    const user = await openUpgrades();
    const input = screen.getByRole("spinbutton", { name: "Strength for Alpha" });
    fireEvent.change(input, { target: { value: "2147483648" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("2,147,483,647");
    await user.click(screen.getByRole("button", { name: "Revert upgrade drafts" }));
    expect((input as HTMLInputElement).value).toBe("2");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(input, { target: { value: "2147483647" } });
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("1 pending change");
    unmount();
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    await openUpgrades();
    expect(
      screen.getByRole("spinbutton", { name: "Strength for Alpha" }).getAttribute("value"),
    ).toBe("2");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    expect(tauriHealthApi.write).not.toHaveBeenCalled();
  });

  it("keeps ordinary hosts read-only and recovery-conflicted controls disabled", async () => {
    vi.mocked(tauriHealthApi.state).mockResolvedValue({
      enabled: false,
      state: "disabled",
      pending: null,
      canonical: null,
    });
    const { unmount } = renderWithPreferences(
      <TauriWorkspace session={session} onClose={vi.fn()} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    expect(
      (await screen.findByRole("textbox", { name: "Strength for Alpha" })).hasAttribute("readonly"),
    ).toBe(true);
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert upgrade drafts" })).toBeNull();
    unmount();
    vi.mocked(tauriHealthApi.state).mockResolvedValue({
      enabled: true,
      state: "blocked",
      pending: null,
      canonical: null,
    });
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    await openUpgrades();
    expect(
      screen.getByRole("spinbutton", { name: "Strength for Alpha" }).matches(":disabled"),
    ).toBe(true);
    expect(tauriHealthApi.write).not.toHaveBeenCalled();
  });

  it("shows loading and a sanitized retryable upgrade-read failure before allowing drafts", async () => {
    vi.mocked(tauriHealthApi.state).mockResolvedValue({
      enabled: true,
      state: "idle",
      pending: null,
      canonical: { opened: openResult().data, players },
      upgradeSession: "synthetic-session",
    });
    let fail!: (value: Awaited<ReturnType<typeof tauriReadApi.upgrades.list>>) => void;
    vi.mocked(tauriReadApi.upgrades.list).mockReturnValueOnce(
      new Promise((resolve) => {
        fail = resolve;
      }),
    );
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    expect(screen.getByTestId("upgrades-skeleton").getAttribute("aria-busy")).toBe("true");
    await act(async () =>
      fail({ ok: false, error: { code: "process_failed", message: "private raw diagnostic" } }),
    );
    expect(await screen.findByRole("heading", { name: "Upgrades unavailable" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).not.toContain("private raw diagnostic");
    expect(screen.queryByRole("spinbutton")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("spinbutton", { name: "Moon Boots for Alpha" })).toBeTruthy();
    expect(tauriReadApi.upgrades.list).toHaveBeenCalledTimes(2);
    expect(tauriHealthApi.write).not.toHaveBeenCalled();
  });
});
