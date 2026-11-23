import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { cancelEntryArtwork, preloadEntryArtwork } from "@/app/tauriArtwork";
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

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(),
}));
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
    players: { list: vi.fn(), avatar: vi.fn() },
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
    vi.mocked(tauriReadApi.players.avatar).mockImplementation(async (_save, playerId) => ({
      ok: true,
      data: { playerId, avatarUrl: null, status: "unavailable", retryAfterMs: null },
    }));
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

  it("shows Overview with editing unavailable until the initial check finishes", async () => {
    let finish!: (status: Awaited<ReturnType<typeof tauriHealthApi.state>>) => void;
    vi.mocked(tauriHealthApi.state).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Run snapshot" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
    await act(() =>
      finish({
        enabled: true,
        state: "idle",
        pending: null,
        canonical: { opened: openResult().data, players, upgrades, run: runState },
        upgradeSession: "synthetic-session",
      }),
    );
    expect(await screen.findByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Edit this save" })).toBeTruthy();
    expect(screen.getByTestId("health-status").hasAttribute("hidden")).toBe(true);
  });

  it("reviews and reverts Health drafts without offering an unauthorized save", async () => {
    vi.mocked(tauriHealthApi.state).mockResolvedValue({
      enabled: true,
      draftOnly: true,
      state: "idle",
      pending: null,
      canonical: { opened: openResult().data, players, upgrades, run: runState },
      upgradeSession: "draft-session",
    });
    const user = userEvent.setup();
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: "Players" }));
    const input = await screen.findByRole<HTMLInputElement>("spinbutton", {
      name: "Current health",
    });
    const original = input.value;
    fireEvent.change(input, { target: { value: "17" } });
    fireEvent.blur(input);
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByTestId("workspace-review").textContent).toContain(`${original} → 17`);
    const save = screen.getByRole<HTMLButtonElement>("button", {
      name: "Save Changes",
    });
    expect(save.disabled).toBe(true);
    await user.click(save);
    expect(tauriHealthApi.writeHealthBatch).not.toHaveBeenCalled();
    expect(tauriHealthApi.recover).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(input.value).toBe(original);
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
  });

  it.each([false, true])(
    "honors individual production approvals (Upgrades: %s)",
    async (upgradesApproved) => {
      vi.mocked(tauriHealthApi.state).mockResolvedValue({
        enabled: true,
        production: true,
        domains: upgradesApproved ? ["health", "upgrades"] : ["health"],
        state: "idle",
        pending: null,
        canonical: { opened: openResult().data, players, upgrades, run: runState },
        upgradeSession: "editor-session",
      });
      const user = userEvent.setup();
      renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
      await user.click(screen.getByRole("tab", { name: "Players" }));
      const health = await screen.findByRole("spinbutton", { name: "Current health" });
      expect(health.hasAttribute("readonly")).toBe(false);
      fireEvent.change(health, { target: { value: "79" } });
      fireEvent.blur(health);
      const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save Changes" });
      expect(save.disabled).toBe(false);
      await user.click(save);
      expect(screen.getByTestId("workspace-review").textContent).toContain(session.path);
      expect(screen.getByTestId("workspace-review").textContent).toContain("80 → 79");
      expect(tauriHealthApi.writeHealthBatch).not.toHaveBeenCalled();
      expect(save.disabled).toBe(false);
      await user.click(screen.getByRole("button", { name: "Revert all" }));
      await user.click(screen.getByRole("tab", { name: "Upgrades" }));
      const upgrade = await screen.findByRole(upgradesApproved ? "spinbutton" : "textbox", {
        name: "Strength for Alpha",
      });
      expect(upgrade.hasAttribute("readonly")).toBe(!upgradesApproved);
    },
  );

  it.each([false, true])(
    "reports private Items compatibility by domain (approved: %s)",
    async (approved) => {
      vi.mocked(tauriHealthApi.state).mockResolvedValue({
        enabled: true,
        production: true,
        domains: approved
          ? ["health", "upgrades", "run", "refillToFull"]
          : ["health", "upgrades", "run"],
        state: "idle",
        pending: null,
        canonical: { opened: openResult().data, players, upgrades, run: runState },
        upgradeSession: "editor-session",
      });
      vi.mocked(tauriReadApi.advanced.get).mockResolvedValue({
        ok: true,
        data: {
          ...advanced,
          items: [{ ...advanced.items[0]!, rechargeCapability: "unknown", canRefillToFull: false }],
        },
      });
      renderWithPreferences(
        <TauriWorkspace
          session={session}
          onClose={vi.fn()}
          compatibility={{
            gameDetected: true,
            healthWriteCompatibility: {
              buildId: "26732417",
              status: "unsupported",
              supported: false,
            },
          }}
        />,
      );
      await userEvent.setup().click(screen.getByRole("tab", { name: "Items" }));
      await screen.findByTestId("item-group-Melee Inflatable Hammer");
      const notice = screen.queryByRole("complementary", {
        name: "Game compatibility restriction",
      });
      if (approved) expect(notice).toBeNull();
      else expect(within(notice!).getByText("Items · R.E.P.O. build 26732417")).toBeTruthy();
    },
  );

  it.each([true, false])(
    "keeps Overview available and defers Players/Upgrades until initial safety resolves (synthetic: %s)",
    async (enabled) => {
      let resolve!: (state: Awaited<ReturnType<typeof tauriHealthApi.state>>) => void;
      vi.mocked(tauriHealthApi.state).mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const user = userEvent.setup();
      renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
      expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
      await user.click(screen.getByRole("tab", { name: "Upgrades" }));
      expect(tauriHealthApi.state).toHaveBeenCalledOnce();
      expect(tauriReadApi.players.list).not.toHaveBeenCalled();
      expect(tauriReadApi.upgrades.list).not.toHaveBeenCalled();
      await act(async () =>
        resolve({
          enabled,
          state: enabled ? "idle" : "disabled",
          pending: null,
          canonical: enabled
            ? { opened: openResult().data, players, upgrades, run: runState }
            : null,
          upgradeSession: enabled ? "synthetic-session" : null,
        }),
      );
      await waitFor(() => expect(tauriReadApi.upgrades.list).toHaveBeenCalledOnce());
      if (enabled) {
        expect(tauriReadApi.players.list).not.toHaveBeenCalled();
        expect(await screen.findByRole("spinbutton", { name: "Strength for Alpha" })).toBeTruthy();
      } else {
        await waitFor(() => expect(tauriReadApi.players.list).toHaveBeenCalledOnce());
        expect(screen.getByRole("tab", { name: "Upgrades" })).toBeTruthy();
        expect(tauriHealthApi.writeUpgrades).not.toHaveBeenCalled();
      }
    },
  );

  it("uses the native selected-player avatar and keeps image failure at initials", async () => {
    vi.mocked(tauriReadApi.players.avatar).mockImplementation(async (_save, playerId) => ({
      ok: true,
      data: {
        playerId,
        avatarUrl: "https://avatars.fastly.steamstatic.com/synthetic.jpg",
        status: "available",
        retryAfterMs: null,
      },
    }));
    const user = userEvent.setup();
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: "Players" }));
    const picture = await screen.findByRole("img", { name: "Alpha avatar" });
    expect(tauriReadApi.players.avatar).toHaveBeenCalledExactlyOnceWith(session.id, "111");
    fireEvent.error(picture);
    expect(screen.getByTestId("avatar-fallback").textContent).toBe("A");
    expect(tauriReadApi.players.avatar).toHaveBeenCalledTimes(1);
    expect(tauriHealthApi.writeHealthBatch).not.toHaveBeenCalled();
  });

  it("defers hidden reads and keeps player controls usable alongside a pending Maps read", async () => {
    let finishMaps!: (value: Awaited<ReturnType<typeof tauriReadApi.maps.list>>) => void;
    let finishAvatar!: (value: Awaited<ReturnType<typeof tauriReadApi.players.avatar>>) => void;
    vi.mocked(tauriReadApi.maps.list).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishMaps = resolve;
        }),
    );
    vi.mocked(tauriReadApi.players.avatar).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAvatar = resolve;
        }),
    );
    const user = userEvent.setup();
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(tauriReadApi.players.avatar).toHaveBeenCalledExactlyOnceWith(
        session.id,
        players[0]!.id,
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Players" }));
    expect(await screen.findByRole("spinbutton", { name: "Current health" })).toBeTruthy();
    expect(screen.getByTestId("avatar-fallback-loading")).toBeTruthy();
    expect(tauriReadApi.maps.list).not.toHaveBeenCalled();
    expect(tauriReadApi.advanced.get).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Run" }));
    expect(tauriReadApi.run.get).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Maps" }));
    await waitFor(() => expect(tauriReadApi.maps.list).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("tab", { name: "Players" }));
    expect(screen.getByRole("spinbutton", { name: "Current health" })).toBeTruthy();
    await act(async () => {
      finishAvatar({
        ok: true,
        data: {
          playerId: players[0]!.id,
          avatarUrl: null,
          status: "unavailable",
          retryAfterMs: null,
        },
      });
      finishMaps({ ok: true, data: maps });
    });
    expect(screen.getByTestId("avatar-fallback").textContent).toBe("A");
    expect(tauriReadApi.players.avatar).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("tab", { name: "Maps" }));
    expect(await screen.findByText("McJannek Station")).toBeTruthy();
    expect(tauriReadApi.maps.list).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    "reconciles an exact refill and refreshes artwork only when required (%s retained)",
    async (itemArtworkRetained) => {
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
        itemArtworkRetained,
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
      expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
        "1 pending change",
      );
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
      expect(
        screen.getByTestId(`item-instance-${advanced.items[0]!.saveKey}`).textContent,
      ).toContain("Full");
      expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
        "No pending changes",
      );
      expect(vi.mocked(tauriHealthApi.recover).mock.calls.map((call) => call[2])).toEqual([
        false,
        true,
      ]);
      expect(tauriReadApi.advanced.get).toHaveBeenCalledTimes(itemArtworkRetained ? 1 : 2);
    },
  );
  it("keeps ordinary Items read-only and blocks a mixed refill/Run Save", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithPreferences(
      <TauriWorkspace session={session} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole("tab", { name: "Items" }));
    await user.click(await screen.findByRole("button", { name: "Recharge All Tools" }));
    expect(screen.queryByTestId("workspace-tab-pending-indicator-items")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Run" }));
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Currency" }), {
      target: { value: "4" },
    });
    expect(screen.getByTestId("workspace-tab-pending-indicator-items")).toBeTruthy();
    expect(screen.queryByTestId("workspace-tab-pending-indicator-run")).toBeNull();
    expect(screen.getByRole("button", { name: "Save Changes" }).matches(":disabled")).toBe(true);
    expect(screen.getByText(/Revert Health, Upgrades, Run or Items drafts/)).toBeTruthy();
    expect(tauriHealthApi.writeRefills).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Items" }));
    expect(screen.queryByTestId("workspace-tab-pending-indicator-items")).toBeNull();
    expect(screen.getByTestId("workspace-tab-pending-indicator-run")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.queryByTestId("workspace-tab-pending-indicator-run")).toBeNull();
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
    expect(screen.queryByTestId("workspace-tab-pending-indicator-upgrades")).toBeNull();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByTestId("workspace-tab-pending-indicator-upgrades")).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    expect(screen.queryByTestId("workspace-tab-pending-indicator-upgrades")).toBeNull();
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

  it.each([false, true])(
    "persists a reviewed batch and refreshes canonical values (production: %s)",
    async (production) => {
      const writeScope = production ? "production-session" : "synthetic-session";
      if (production) {
        vi.mocked(tauriHealthApi.state).mockResolvedValue({
          enabled: true,
          production: true,
          domains: ["upgrades"],
          state: "idle",
          pending: null,
          canonical: { opened: openResult().data, players, upgrades },
          upgradeSession: writeScope,
        });
      }
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
      let finishAcknowledgement!: () => void;
      const acknowledgement = new Promise<void>((resolve) => {
        finishAcknowledgement = resolve;
      });
      vi.mocked(tauriHealthApi.recover).mockImplementation(
        async (_save, operationId, acknowledge) => {
          if (acknowledge) await acknowledgement;
          return {
            operationId,
            status: "applied",
            fingerprint: "b".repeat(64),
            backupAvailable: true,
            reason: null,
            canonical: {
              opened: {
                ...openResult().data,
                session: { ...session, fingerprint: "b".repeat(64) },
              },
              players,
              upgrades: projected,
              ...(production ? { upgradeArtworkRetained: true } : {}),
            },
          };
        },
      );
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
      if (production) await user.click(screen.getByRole("button", { name: "Review" }));
      await user.click(screen.getByRole("button", { name: "Save Changes" }));
      await waitFor(() => expect(tauriHealthApi.recover).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByTestId("workspace").getAttribute("data-session-fingerprint")).toBe(
          production ? session.fingerprint : "b".repeat(64),
        ),
      );
      expect(tauriReadApi.upgrades.list).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole("tab", { name: "Maps" }));
      expect(tauriReadApi.maps.list).not.toHaveBeenCalled();
      await act(async () => finishAcknowledgement());
      await waitFor(() =>
        expect(screen.getByTestId("health-status").getAttribute("data-phase")).toBe("saved"),
      );
      expect(await screen.findByText("McJannek Station")).toBeTruthy();
      expect(tauriReadApi.maps.list).toHaveBeenCalledOnce();
      await user.click(screen.getByRole("tab", { name: "Upgrades" }));
      await waitFor(() =>
        expect(tauriReadApi.upgrades.list).toHaveBeenCalledTimes(production ? 1 : 2),
      );
      expect(tauriHealthApi.writeUpgrades).toHaveBeenCalledWith(
        expect.objectContaining({
          saveId: session.id,
          session: writeScope,
          fingerprint: session.fingerprint,
          upgrades: [
            { playerId: "111", key: "playerUpgradeStrength", before: 2, value: 3 },
            { playerId: "222", key: "playerUpgradeStrength", before: 0, value: 4 },
          ],
        }),
        ...(production ? [true] : []),
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
      expect(tauriHealthApi.recover).toHaveBeenLastCalledWith(
        session.id,
        expect.any(String),
        true,
        ...(production ? [true] : []),
      );
      expect(vi.mocked(tauriHealthApi.recover).mock.calls.map((call) => call[2])).toEqual(
        production ? [true] : [false, true],
      );
    },
  );

  it("reviews and saves the latest Health draft directly from the focused input", async () => {
    vi.mocked(tauriHealthApi.state).mockResolvedValue({
      enabled: true,
      production: true,
      domains: ["health"],
      state: "idle",
      pending: null,
      canonical: { opened: openResult().data, players, upgrades, run: runState },
      upgradeSession: "production-session",
    });
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Players" }));
    const input = await screen.findByRole("spinbutton", { name: "Current health" });
    await waitFor(() => expect(input.hasAttribute("readonly")).toBe(false));
    await user.clear(input);
    await user.type(input, "17");
    const save = screen.getByRole("button", { name: "Save Changes" });
    expect(document.activeElement).toBe(input);
    expect(save.matches(":disabled")).toBe(false);
    await user.click(save);
    const review = within(screen.getByTestId("workspace-review"));
    expect(review.getByText("80 → 17")).toBeTruthy();
    await user.clear(input);
    await user.type(input, "12");
    expect(document.activeElement).toBe(input);
    expect(review.getByText("80 → 12")).toBeTruthy();
    expect(tauriHealthApi.writeHealthBatch).not.toHaveBeenCalled();

    await user.click(save);
    expect(tauriHealthApi.writeHealthBatch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ health: [{ playerId: "111", before: 80, value: 12 }] }),
      true,
    );
  });

  it("keeps verified upgrade thumbnails across repeated Health saves and player changes", async () => {
    const token = `upgrade-artwork:${"a".repeat(32)}`;
    const dataUrl = "data:image/png;base64,AAAA";
    const visual = upgrades.map((upgrade) =>
      upgrade.key === "playerUpgradeStrength" ? { ...upgrade, iconToken: token } : upgrade,
    );
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: { token, revision: "a".repeat(64), dataUrl },
    });
    vi.mocked(tauriReadApi.upgrades.list)
      .mockResolvedValueOnce({ ok: true, data: visual })
      .mockResolvedValue({ ok: true, data: upgrades });
    vi.mocked(tauriHealthApi.state).mockResolvedValue({
      enabled: true,
      production: true,
      domains: ["health", "upgrades"],
      state: "idle",
      pending: null,
      canonical: { opened: openResult().data, players, upgrades: visual },
      upgradeSession: "production-session",
    });
    let canonical = {
      opened: openResult().data,
      players,
      upgrades: visual,
      upgradeArtworkRetained: true,
    };
    const result = (operationId: string) => ({
      operationId,
      status: "applied" as const,
      fingerprint: canonical.opened.session.fingerprint,
      backupAvailable: true,
      reason: null,
      canonical,
    });
    vi.mocked(tauriHealthApi.writeHealthBatch).mockImplementation(async ({ operationId }) => ({
      ...result(operationId),
      canonical: null,
    }));
    vi.mocked(tauriHealthApi.recover).mockImplementation(async (_save, operationId) =>
      result(operationId),
    );

    const artworkPlan = { upgrade: [token], map: [], item: [] };
    try {
      await preloadEntryArtwork(artworkPlan, new AbortController().signal);
      renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
      const user = await openUpgrades();
      const thumbnail = "upgrade-icon-playerUpgradeStrength";
      for (const [value, digest] of [
        [17, "b"],
        [15, "c"],
      ] as const) {
        await user.click(screen.getByRole("tab", { name: "Players" }));
        const health = screen.getByRole("spinbutton", { name: "Current health" });
        fireEvent.change(health, { target: { value: String(value) } });
        await user.click(screen.getByRole("tab", { name: "Upgrades" }));
        canonical = {
          ...canonical,
          opened: openResult({ ...session, fingerprint: digest.repeat(64) }).data,
          players: players.map((player) =>
            player.id === "111" ? { ...player, health: value } : player,
          ),
        };
        await user.click(screen.getByRole("button", { name: "Review" }));
        await user.click(screen.getByRole("button", { name: "Save Changes" }));
        await waitFor(() =>
          expect(screen.getByTestId("health-status").dataset.phase).toBe("saved"),
        );
        expect(screen.getByTestId("workspace").dataset.sessionFingerprint).toBe(digest.repeat(64));
        expect(screen.queryByTestId(`${thumbnail}-loading`)).toBeNull();
        expect(screen.getByTestId(thumbnail).querySelector("img")?.getAttribute("src")).toBe(
          dataUrl,
        );
      }
      await user.click(screen.getByRole("combobox", { name: "Player" }));
      await user.click(screen.getByRole("option", { name: "Beta" }));
      expect(screen.getByTestId(thumbnail).querySelector("img")?.getAttribute("src")).toBe(dataUrl);
      expect(tauriReadApi.upgrades.list).toHaveBeenCalledOnce();
      expect(invoke).toHaveBeenCalledExactlyOnceWith("upgrade_artwork_get", { token });
    } finally {
      cancelEntryArtwork();
    }
  });

  it("marks Health drafts on the Players tab across selection, navigation, Revert and Save", async () => {
    renderWithPreferences(<TauriWorkspace session={session} onClose={vi.fn()} />);
    const user = userEvent.setup();
    const tab = screen.getByRole("tab", { name: "Players" });
    const upgradesTab = screen.getByRole("tab", { name: "Upgrades" });
    const indicator = () => screen.queryByTestId("workspace-tab-pending-indicator-players");
    await user.click(tab);
    const health = await screen.findByRole("spinbutton", { name: "Current health" });
    await waitFor(() => expect(health.hasAttribute("readonly")).toBe(false));
    expect(tab.getAttribute("aria-describedby")).toBeNull();
    health.focus();
    fireEvent.change(health, { target: { value: "17" } });
    expect(document.activeElement).toBe(health);
    expect(screen.getByTestId("pending-health-edit").textContent).toContain("80 → 17");
    expect(indicator()).toBeNull();
    expect(tab.getAttribute("aria-describedby")).toBe("native-players-pending");
    expect(document.getElementById("native-players-pending")?.textContent).toBe("1 pending change");
    fireEvent.change(health, { target: { value: "1.5" } });
    expect(screen.getByRole("button", { name: "Save Changes" }).matches(":disabled")).toBe(true);
    expect(screen.getByTestId("pending-health-edit").textContent).toContain("80 → 17");
    await user.click(screen.getByRole("button", { name: /Beta/ }));
    const betaHealth = screen.getByRole("spinbutton", { name: "Current health" });
    expect(betaHealth.getAttribute("value")).toBe("0");
    expect(betaHealth.hasAttribute("aria-invalid")).toBe(false);
    expect(screen.queryByTestId("pending-health-edit")).toBeNull();
    tab.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(upgradesTab);
    expect(upgradesTab.getAttribute("aria-selected")).toBe("true");
    expect(indicator()?.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Players", description: "1 pending change" })).toBe(tab);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(tab);
    expect(indicator()).toBeNull();
    expect(tab.getAttribute("aria-describedby")).toBe("native-players-pending");
    await user.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(screen.getByRole("spinbutton", { name: "Current health" }).getAttribute("value")).toBe(
      "17",
    );
    await user.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.getByRole("spinbutton", { name: "Current health" }).getAttribute("value")).toBe(
      "80",
    );
    expect(tab.getAttribute("aria-describedby")).toBeNull();
    expect(document.getElementById("native-players-pending")).toBeNull();
    const stage = async () => {
      const input = screen.getByRole("spinbutton", { name: "Current health" });
      input.focus();
      fireEvent.change(input, { target: { value: "17" } });
      await user.tab();
    };
    await stage();
    await user.click(upgradesTab);
    expect(indicator()).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(indicator()).toBeNull();
    expect(tab.getAttribute("aria-describedby")).toBeNull();
    expect(tauriHealthApi.writeHealthBatch).not.toHaveBeenCalled();
    expect(tauriHealthApi.recover).not.toHaveBeenCalled();
    await user.click(tab);
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
    await user.click(upgradesTab);
    expect(indicator()).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() =>
      expect(screen.getByTestId("health-status").getAttribute("data-phase")).toBe("saved"),
    );
    expect(tab.getAttribute("aria-describedby")).toBeNull();
    expect(indicator()).toBeNull();
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
    expect(screen.queryByText("Review pending upgrade changes before saving.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert upgrade drafts" })).toBeNull();
    expect(screen.getByRole("button", { name: "Review" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revert all" })).toBeTruthy();
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
    await user.click(screen.getByRole("button", { name: /^Revert$/ }));
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
    await user.click(screen.getByRole("button", { name: /^Revert$/ }));
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
