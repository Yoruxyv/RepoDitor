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
  tauriHealthApi: {
    state: vi.fn(),
    write: vi.fn(),
    writeHealthBatch: vi.fn(),
    recover: vi.fn(),
    writeUpgrades: vi.fn(),
    writeRun: vi.fn(),
    writeRefills: vi.fn(),
  },
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
      canonical: { opened: openResult().data, players, upgrades, run: runState },
      upgradeSession: "synthetic-session",
    });
    vi.mocked(tauriHealthApi.writeHealthBatch).mockImplementation(async (request) => ({
      operationId: request.operationId,
      status: "rejected",
      fingerprint: null,
      backupAvailable: false,
      reason: "save_stale",
      canonical: null,
    }));
  });

  it("reviews and reverts an exact refill, then refreshes Full only after durable canonical confirmation", async () => {
    const user = userEvent.setup();
    const updated = structuredClone(advanced);
    Object.assign(updated.items[0]!, {
      storedCharge: null,
      chargeState: "default_full",
      canRefillToFull: false,
    });
    const canonical = {
      opened: openResult({ ...session, fingerprint: "b".repeat(64) }).data,
      players,
      upgrades,
      run: runState,
      advanced: updated,
    };
    vi.mocked(tauriHealthApi.writeRefills).mockImplementation(async (request) => ({
      operationId: request.operationId,
      status: "applied",
      fingerprint: "b".repeat(64),
      backupAvailable: true,
      reason: null,
      canonical,
    }));
    vi.mocked(tauriHealthApi.recover).mockImplementation(async (_save, operationId) => ({
      operationId,
      status: "applied",
      fingerprint: "b".repeat(64),
      backupAvailable: true,
      reason: null,
      canonical,
    }));
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: "Items" }));
    await user.click(
      await screen.findByRole("button", { name: "Recharge Melee Inflatable Hammer, tool 1" }),
    );
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("1 pending change");
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByTestId("workspace-review").textContent).toContain(
      "Melee Inflatable Hammer · Charge",
    );
    await user.click(screen.getByRole("tab", { name: "Players" }));
    await user.click(screen.getByRole("tab", { name: "Items" }));
    await user.click(screen.getByRole("button", { name: "Revert recharge" }));
    expect(tauriHealthApi.writeRefills).not.toHaveBeenCalled();
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    await user.click(screen.getByRole("button", { name: "Recharge All Tools" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(screen.getByTestId("health-status").getAttribute("data-phase")).toBe("saved"),
    );
    expect(tauriHealthApi.writeRefills).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        saveId: session.id,
        fingerprint: session.fingerprint,
        refillToFull: [{ saveKey: advanced.items[0]!.saveKey, before: 99 }],
      }),
    );
    expect(screen.getByTestId(`item-instance-${advanced.items[0]!.saveKey}`).textContent).toContain(
      "Full",
    );
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    expect(vi.mocked(tauriHealthApi.recover).mock.calls.map((call) => call[2])).toEqual([
      false,
      true,
    ]);
  });
  it("keeps ordinary Items read-only and blocks a mixed refill/Run Save", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithPreferences(
      <TauriWorkspace session={session} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole("tab", { name: "Items" }));
    await user.click(await screen.findByRole("button", { name: "Recharge All Tools" }));
    await user.click(screen.getByRole("tab", { name: "Run" }));
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Currency" }), {
      target: { value: "4" },
    });
    expect(screen.getByRole("button", { name: "Save Changes" }).matches(":disabled")).toBe(true);
    expect(screen.getByText(/Revert Health, Upgrades, Run or Items drafts/)).toBeTruthy();
    expect(tauriHealthApi.writeRefills).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    unmount();
    vi.mocked(tauriHealthApi.state).mockResolvedValue({
      enabled: false,
      state: "disabled",
      pending: null,
      canonical: null,
    });
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: "Items" }));
    await screen.findByTestId(`item-instance-${advanced.items[0]!.saveKey}`);
    expect(screen.queryByRole("button", { name: /Recharge|Revert|Save Changes/ })).toBeNull();
  });

  it("explains why unsupported precision stays unavailable without exposing an editor", async () => {
    vi.mocked(tauriReadApi.run.get).mockResolvedValue({
      ok: false,
      error: { code: "invalid_response", message: "private" },
    });
    vi.mocked(tauriHealthApi.state).mockResolvedValue({
      enabled: true,
      state: "idle",
      pending: null,
      canonical: { opened: openResult().data, players, upgrades, run: null },
      upgradeSession: "synthetic-session",
    });
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole("tab", { name: "Run" }));
    expect(
      await screen.findByText(/Run stays read-only when its values cannot be represented exactly/),
    ).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(tauriHealthApi.writeRun).not.toHaveBeenCalled();
  });

  it("reviews Run drafts across tabs, preserves invalid proposals and reverts without a writer", async () => {
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Run" }));
    const currency = await screen.findByRole("spinbutton", { name: "Currency" });
    fireEvent.change(currency, { target: { value: "-19" } });
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(within(screen.getByTestId("workspace-review")).getByText("Run · Currency")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    await user.click(screen.getByRole("tab", { name: "Run" }));
    const returned = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Currency" });
    expect(returned.value).toBe("-19");
    fireEvent.change(returned, { target: { value: "2147483648" } });
    expect(returned.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("button", { name: "Save Changes" }).matches(":disabled")).toBe(true);
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("1 pending change");
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Currency" }).value).toBe("12");
    expect(tauriHealthApi.writeRun).not.toHaveBeenCalled();
  });

  it("saves Run drafts only after confirming canonical values and exposes refreshed fields", async () => {
    const run = {
      ...runState,
      stats: runState.stats.map((stat) =>
        stat.key === "currency" ? { ...stat, value: -19 } : stat,
      ),
    };
    vi.mocked(tauriHealthApi.writeRun).mockImplementation(async (request) => ({
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
      canonical: { opened: openResult().data, players, upgrades, run },
    }));
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Run" }));
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Currency" }), {
      target: { value: "-19" },
    });
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(screen.getByTestId("health-status").getAttribute("data-phase")).toBe("saved"),
    );
    expect(tauriHealthApi.writeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        session: "synthetic-session",
        run: [{ field: "currency", before: 12, value: -19 }],
      }),
    );
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Currency" }).value).toBe(
      "-19",
    );
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
  });

  it("blocks a mixed Run and Upgrade Save until one domain is reverted", async () => {
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    const user = await openUpgrades();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Strength for Alpha" }), {
      target: { value: "3" },
    });
    await user.click(screen.getByRole("tab", { name: "Run" }));
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Currency" }), {
      target: { value: "-19" },
    });
    expect(screen.getByRole("button", { name: "Save Changes" }).matches(":disabled")).toBe(true);
    expect(screen.getByText(/Save one group at a time/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Revert$/ }));
    expect(screen.getByRole("button", { name: "Save Changes" }).matches(":disabled")).toBe(false);
    expect(tauriHealthApi.writeRun).not.toHaveBeenCalled();
    expect(tauriHealthApi.writeUpgrades).not.toHaveBeenCalled();
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
    expect(tauriHealthApi.writeHealthBatch).not.toHaveBeenCalled();
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

  it("marks Health drafts on the Players tab across selection, navigation, Revert and Save", async () => {
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    const user = userEvent.setup();
    const tab = screen.getByRole("tab", { name: "Players" });
    await user.click(tab);
    const health = await screen.findByRole("spinbutton", { name: "Current health" });
    await waitFor(() => expect(health.hasAttribute("readonly")).toBe(false));
    expect(tab.getAttribute("aria-describedby")).toBeNull();
    health.focus();
    fireEvent.change(health, { target: { value: "17" } });
    await user.tab();
    expect(tab.getAttribute("aria-describedby")).toBe("native-players-pending");
    expect(document.getElementById("native-players-pending")?.textContent).toBe("1 pending change");
    await user.click(screen.getByRole("button", { name: /Beta/ }));
    expect(health.hasAttribute("readonly")).toBe(false);
    tab.focus();
    await user.keyboard("{ArrowRight}{ArrowLeft}");
    expect(document.activeElement).toBe(tab);
    expect(tab.getAttribute("aria-describedby")).toBe("native-players-pending");
    await user.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(screen.getByRole("spinbutton", { name: "Current health" }).getAttribute("value")).toBe(
      "17",
    );
    await user.click(screen.getByRole("button", { name: "Revert" }));
    expect(tab.getAttribute("aria-describedby")).toBeNull();
    expect(document.getElementById("native-players-pending")).toBeNull();
    const stage = async () => {
      const input = screen.getByRole("spinbutton", { name: "Current health" });
      input.focus();
      fireEvent.change(input, { target: { value: "17" } });
      await user.tab();
    };
    await stage();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(tab.getAttribute("aria-describedby")).toBeNull();
    expect(tauriHealthApi.writeHealthBatch).not.toHaveBeenCalled();
    expect(tauriHealthApi.recover).not.toHaveBeenCalled();
    await stage();
    const canonical = {
      opened: openResult({ ...session, fingerprint: "b".repeat(64) }).data,
      players: players.map((player) => (player.id === "111" ? { ...player, health: 17 } : player)),
      upgrades,
      run: runState,
    };
    vi.mocked(tauriHealthApi.writeHealthBatch).mockImplementation(async (request) => ({
      operationId: request.operationId,
      status: "applied",
      fingerprint: canonical.opened.session.fingerprint,
      backupAvailable: true,
      reason: null,
      canonical,
    }));
    vi.mocked(tauriHealthApi.recover).mockImplementation(async (_save, operationId) => ({
      operationId,
      status: "applied",
      fingerprint: canonical.opened.session.fingerprint,
      backupAvailable: true,
      reason: null,
      canonical,
    }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(screen.getByTestId("health-status").getAttribute("data-phase")).toBe("saved"),
    );
    expect(tab.getAttribute("aria-describedby")).toBeNull();
    expect(document.getElementById("native-players-pending")).toBeNull();
    expect(tauriHealthApi.writeHealthBatch).toHaveBeenCalledOnce();
    expect(tauriHealthApi.recover).toHaveBeenLastCalledWith(session.id, expect.any(String), true);
  });

  it("reviews, individually reverts and atomically saves multiple players without losing selection", async () => {
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    const user = userEvent.setup();
    const tab = screen.getByRole("tab", { name: "Players" });
    await user.click(tab);
    const input = await screen.findByRole("spinbutton", { name: "Current health" });
    await waitFor(() => expect(input.hasAttribute("readonly")).toBe(false));
    async function stage(name: string, value: string) {
      await user.click(screen.getByRole("button", { name: new RegExp(name) }));
      const health = screen.getByRole("spinbutton", { name: "Current health" });
      health.focus();
      fireEvent.change(health, { target: { value } });
      await user.tab();
    }
    await stage("Alpha", "17");
    await stage("Beta", "42");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "2 pending changes",
    );
    expect(document.getElementById("native-players-pending")?.textContent).toBe(
      "2 pending changes",
    );
    await user.click(screen.getByRole("button", { name: "Review" }));
    const review = within(screen.getByTestId("workspace-review"));
    expect(review.getByText("Alpha · Health")).toBeTruthy();
    expect(review.getByText("Beta · Health")).toBeTruthy();
    tab.focus();
    await user.keyboard("{ArrowRight}{ArrowLeft}");
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Current health" }).getAttribute("value")).toBe(
      "42",
    );
    await user.click(screen.getByRole("button", { name: /^Revert$/ }));
    expect(review.queryByText("Beta · Health")).toBeNull();
    expect(review.getByText("Alpha · Health")).toBeTruthy();
    await stage("Beta", "42");
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    expect(tauriHealthApi.writeHealthBatch).not.toHaveBeenCalled();
    expect(tauriHealthApi.recover).not.toHaveBeenCalled();
    await stage("Alpha", "17");
    await stage("Beta", "42");
    const canonical = {
      opened: openResult({ ...session, fingerprint: "b".repeat(64) }).data,
      players: [
        { ...players[0]!, health: 17 },
        { ...players[1]!, health: 42 },
      ],
      upgrades,
      run: runState,
    };
    vi.mocked(tauriHealthApi.writeHealthBatch).mockImplementation(async (request) => ({
      operationId: request.operationId,
      status: "applied",
      fingerprint: "b".repeat(64),
      backupAvailable: true,
      reason: null,
      canonical,
    }));
    vi.mocked(tauriHealthApi.recover).mockImplementation(async (_save, operationId) => ({
      operationId,
      status: "applied",
      fingerprint: "b".repeat(64),
      backupAvailable: true,
      reason: null,
      canonical,
    }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(screen.getByTestId("health-status").getAttribute("data-phase")).toBe("saved"),
    );
    expect(tauriHealthApi.writeHealthBatch).toHaveBeenCalledOnce();
    expect(tauriHealthApi.writeHealthBatch).toHaveBeenCalledWith({
      saveId: session.id,
      fingerprint: session.fingerprint,
      operationId: expect.stringMatching(/^[0-9a-f]{32}$/),
      session: "synthetic-session",
      health: [
        { playerId: "111", before: 80, value: 17 },
        { playerId: "222", before: 0, value: 42 },
      ],
    });
    expect(tauriHealthApi.write).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    expect(screen.getByTestId("workspace").getAttribute("data-session-fingerprint")).toBe(
      "b".repeat(64),
    );
    await stage("Beta", "50");
    expect(screen.queryByText("Original backup verified.")).toBeNull();
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
    expect(tauriHealthApi.writeHealthBatch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    await user.click(screen.getByRole("button", { name: "Revert upgrade drafts" }));
    await user.click(screen.getByRole("tab", { name: "Players" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(tauriHealthApi.writeHealthBatch).toHaveBeenCalledTimes(1));
    expect(tauriHealthApi.writeHealthBatch).toHaveBeenCalledWith(
      expect.objectContaining({ health: [{ playerId: "111", before: 80, value: 17 }] }),
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
    expect(tauriHealthApi.writeHealthBatch).not.toHaveBeenCalled();
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
    expect(tauriHealthApi.writeHealthBatch).not.toHaveBeenCalled();
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
    expect(tauriHealthApi.writeHealthBatch).not.toHaveBeenCalled();
  });
});
