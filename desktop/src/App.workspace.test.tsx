import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import {
  advanced,
  createRepoDitorApi as bridge,
  maps,
  players,
  saveId,
  session,
  upgrades,
} from "@/test/repoditorApiFixture";

describe("run-save workspace integration", () => {
  beforeEach(() => {
    localStorage.clear();
    window.repoditor = bridge(vi.fn());
  });

  it("shows Overview and preserves typed pending player edits across navigation", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: /Open workspace/ });
    expect(document.querySelectorAll("details")).toHaveLength(0);
    expect(screen.queryByText(session.path)).toBeNull();
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByText("Validated locally")).toBeTruthy();
    const metadata = screen.getByTestId("selected-save-metadata");
    const source = screen.getByTestId("selected-save-path");
    expect(source.textContent).toContain("REPO_SAVE_2026_08_08_10_20_30.es3");
    expect(document.querySelectorAll("details")).toHaveLength(1);
    expect((source as HTMLDetailsElement).open).toBe(false);
    expect(metadata.contains(source)).toBe(false);
    expect(metadata.nextElementSibling).toBe(source);
    expect(screen.getByRole("heading", { name: "Run snapshot" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Edit this save" })).toBeTruthy();
    expect(screen.getByText("Normal")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Open Players" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Players" })),
    );
    await user.click(await screen.findByRole("button", { name: /Beta/ }));
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect(screen.getByTestId("avatar-fallback").textContent).toBe("B");

    const health = screen.getByRole("spinbutton", { name: "Current health" });
    expect(health.getAttribute("min")).toBe("0");
    expect(health.getAttribute("step")).toBe("1");
    expect(health.getAttribute("aria-describedby")).toContain("player-health-help");
    await user.clear(health);
    await user.type(health, "42");
    expect(screen.getByTestId("pending-health-edit").textContent).toContain("0 → 42");
    expect(health.getAttribute("aria-describedby")).toContain("player-health-pending");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("1 pending change");
    expect(document.querySelector("#workspace-tab-pending-1")?.textContent).toContain(
      "1 pending change",
    );
    expect(document.querySelector("#run-saves-pending")?.textContent).toContain("1 pending change");

    await user.clear(health);
    await user.type(health, "0");
    expect(screen.queryByTestId("pending-health-edit")).toBeNull();
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );

    await user.clear(health);
    await user.type(health, "42");

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.click(await screen.findByRole("tab", { name: "Players" }, { timeout: 10_000 }));
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect(
      (screen.getByRole("spinbutton", { name: "Current health" }) as HTMLInputElement).value,
    ).toBe("42");

    await user.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.queryByTestId("pending-health-edit")).toBeNull();
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
  });

  it("rejects invalid health without creating a pending edit", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("tab", { name: "Players" }));
    const health = await screen.findByRole("spinbutton", { name: "Current health" });
    fireEvent.change(health, { target: { value: "-1" } });

    expect(screen.getByRole("alert").textContent).toContain("whole number");
    expect(health.getAttribute("aria-describedby")).toContain("player-health-error");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
  });

  it("heals to Python-provided max health through the existing pending edit", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("tab", { name: "Players" }));
    await user.click(await screen.findByRole("button", { name: /Beta/ }));

    expect(screen.getByLabelText("Maximum health 100")).toBeTruthy();
    const heal = screen.getByRole("button", { name: "Heal to Full" });
    await user.click(heal);
    expect(
      (screen.getByRole("spinbutton", { name: "Current health" }) as HTMLInputElement).value,
    ).toBe("100");
    expect((heal as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("pending-health-edit").textContent).toContain("0 → 100");

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.click(await screen.findByRole("tab", { name: "Players" }, { timeout: 10_000 }));
    expect(
      (screen.getByRole("spinbutton", { name: "Current health" }) as HTMLInputElement).value,
    ).toBe("100");

    await user.click(screen.getByRole("button", { name: "Revert" }));
    expect(
      (screen.getByRole("spinbutton", { name: "Current health" }) as HTMLInputElement).value,
    ).toBe("0");
    expect(
      (screen.getByRole("button", { name: "Heal to Full" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("disables Heal to Full when current health already equals max health", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), [
      { ...players[0]!, health: 100 },
    ]);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("tab", { name: "Players" }));

    expect(
      ((await screen.findByRole("button", { name: "Heal to Full" })) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
  });

  it("keeps advanced refill and other edits while navigating sections", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("tab", { name: "Players" }));
    await user.click(await screen.findByRole("button", { name: /Beta/ }));

    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    expect(await screen.findByText("Moon Boots")).toBeTruthy();
    const strength = screen.getByRole("spinbutton", { name: "Strength for Beta" });
    await user.clear(strength);
    await user.type(strength, "3");
    expect(screen.getByTestId("pending-upgrade-playerUpgradeStrength").textContent).toContain(
      "0 → 3",
    );
    expect(strength.getAttribute("aria-describedby")).toContain("playerUpgradeStrength-pending");

    await user.click(screen.getByRole("tab", { name: "Run" }));
    const currency = await screen.findByRole("spinbutton", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "20");
    expect(screen.getByTestId("pending-run-currency").textContent).toContain("12 → 20");
    expect(currency.getAttribute("min")).toBeNull();
    expect(currency.getAttribute("aria-describedby")).toContain("run-currency-pending");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "2 pending changes",
    );

    await user.click(screen.getByRole("tab", { name: "Items" }));
    expect(await screen.findByRole("heading", { name: "Melee Inflatable Hammer" })).toBeTruthy();
    expect(
      screen.getByTestId("item-instance-Item Melee Inflatable Hammer/1").textContent,
    ).toContain("Current charge: 99");
    expect(screen.queryByText("#1")).toBeNull();
    expect(
      screen.getByText("Recharge appears only for tools RepoDitor can safely refill."),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Recharge All Tools" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "3 pending changes",
    );

    await user.click(screen.getByRole("tab", { name: "Maps" }));
    expect(await screen.findByText("McJannek Station")).toBeTruthy();
    expect(screen.getByText("Modded Moon")).toBeTruthy();
    expect(screen.queryByText("Arctic")).toBeNull();
    expect(screen.queryByText(maps.catalogPath!)).toBeNull();
    expect(document.querySelectorAll("details")).toHaveLength(1);

    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    expect(
      (screen.getByRole("spinbutton", { name: "Strength for Beta" }) as HTMLInputElement).value,
    ).toBe("3");
    await user.click(screen.getByRole("tab", { name: "Run" }));
    expect((screen.getByRole("spinbutton", { name: "Currency" }) as HTMLInputElement).value).toBe(
      "20",
    );
    await user.click(screen.getByRole("tab", { name: "Items" }));
    expect(screen.getByText("Pending: 99 → Full")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revert recharge" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "2 pending changes",
    );
  });

  it("stages bulk recharge only for confirmed partial rechargeable tools and keeps it memory-only", async () => {
    const write = vi.fn();
    window.repoditor = bridge(
      vi.fn().mockResolvedValue({ ok: true, data: session }),
      players,
      undefined,
      write,
    );
    window.repoditor.advanced.get = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ...advanced,
        items: [
          advanced.items[0]!,
          {
            saveKey: "Item Gun Tranq/2",
            name: "Gun Tranq",
            instanceId: "2",
            isUpgrade: false,
            storedCharge: 17,
            chargeState: "stored",
            rechargeCapability: "rechargeable",
            canRefillToFull: true,
            iconToken: null,
          },
          {
            saveKey: "Item Gun Tranq/3",
            name: "Gun Tranq",
            instanceId: "3",
            isUpgrade: false,
            storedCharge: null,
            chargeState: "default_full",
            rechargeCapability: "rechargeable",
            canRefillToFull: false,
            iconToken: null,
          },
          {
            saveKey: "Item Cart Medium/1",
            name: "Cart Medium",
            instanceId: "1",
            isUpgrade: false,
            storedCharge: null,
            chargeState: "not_applicable",
            rechargeCapability: "not_rechargeable",
            canRefillToFull: false,
            iconToken: null,
          },
          {
            saveKey: "Item Future Tool/4",
            name: "Future Tool",
            instanceId: "4",
            isUpgrade: false,
            storedCharge: 7,
            chargeState: "stored",
            rechargeCapability: "unknown",
            canRefillToFull: false,
            iconToken: null,
          },
        ],
      },
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("tab", { name: "Items" }));
    await user.click(await screen.findByRole("button", { name: "Recharge All Tools" }));

    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "2 pending changes",
    );
    expect(screen.getAllByText(/Pending: .* Full/)).toHaveLength(2);
    expect(
      (screen.getByRole("button", { name: "Recharge All Tools" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(write).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText(/Melee Inflatable Hammer.*Charge/)).toBeTruthy();
    expect(screen.getByText(/Gun Tranq.*Charge/)).toBeTruthy();
    expect(screen.queryByText(/Cart Medium.*Charge/)).toBeNull();
    expect(screen.queryByText(/Future Tool.*Charge/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
  });

  it("summarizes, reverts, and safely submits pending changes", async () => {
    const write = vi.fn().mockResolvedValue({
      ok: true as const,
      data: {
        backupPath: "C:\\fixture\\save.es3.bak-20260808-102100",
        session: { ...session, fingerprint: "b".repeat(64), currency: 20 },
      },
    });
    window.repoditor = bridge(
      vi.fn().mockResolvedValue({ ok: true, data: session }),
      players,
      undefined,
      write,
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();

    await user.click(await screen.findByRole("tab", { name: "Players" }, { timeout: 10_000 }));
    await user.click(await screen.findByRole("button", { name: /Beta/ }));
    const health = screen.getByRole("spinbutton", { name: "Current health" });
    await user.clear(health);
    await user.type(health, "42");

    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    const strength = screen.getByRole("spinbutton", { name: "Strength for Beta" });
    await user.clear(strength);
    await user.type(strength, "3");

    await user.click(screen.getByRole("tab", { name: "Run" }));
    const currency = screen.getByRole("spinbutton", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "20");

    expect(screen.getByText("Beta · Health")).toBeTruthy();
    expect(screen.getByText("Beta · Strength")).toBeTruthy();
    expect(screen.getByText("Run · Currency")).toBeTruthy();
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "3 pending changes",
    );

    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    expect((screen.getByRole("spinbutton", { name: "Currency" }) as HTMLInputElement).value).toBe(
      "12",
    );
    expect(write).not.toHaveBeenCalled();

    await user.clear(screen.getByRole("spinbutton", { name: "Currency" }));
    await user.type(screen.getByRole("spinbutton", { name: "Currency" }), "20");
    await user.click(screen.getByRole("tab", { name: "Items" }));
    await user.click(
      screen.getByRole("button", { name: "Recharge Melee Inflatable Hammer, tool 1" }),
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(write).toHaveBeenCalledWith(session.id, session.fingerprint, [
      { feature: "run", entity: "run", field: "currency", after: 20 },
      {
        feature: "advanced",
        entity: "Item Melee Inflatable Hammer/1",
        field: "refillToFull",
        after: true,
      },
    ]);
    expect(await screen.findByText(/Saved safely · Backup created/)).toBeTruthy();
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
  });

  it("keeps post-save upgrade reloads non-blocking after a successful write", async () => {
    let finishUpgradeReload: ((value: { ok: true; data: typeof upgrades }) => void) | undefined;
    const write = vi.fn().mockResolvedValue({
      ok: true as const,
      data: {
        backupPath: "C:\\fixture\\save.es3.bak-20260808-102100",
        session: { ...session, fingerprint: "b".repeat(64), currency: 20 },
      },
    });
    window.repoditor = bridge(
      vi.fn().mockResolvedValue({ ok: true, data: session }),
      players,
      undefined,
      write,
    );
    const upgradeList = vi.mocked(window.repoditor.upgrades.list);
    upgradeList.mockResolvedValueOnce({ ok: true, data: upgrades }).mockImplementationOnce(
      () =>
        new Promise<{ ok: true; data: typeof upgrades }>((resolve) => {
          finishUpgradeReload = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByTestId("workspace")).toBeTruthy();
    await waitFor(() => expect(upgradeList).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("tab", { name: "Run" }));
    const currency = await screen.findByRole("spinbutton", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "20");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(upgradeList).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("asset-preparation")).toBeNull();
    expect(screen.getByTestId("workspace")).toBeTruthy();
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    expect(screen.getByText("Currency", { selector: "dt" }).nextElementSibling?.textContent).toBe(
      "20",
    );
    expect(screen.getByText(/Saved safely · Backup created/)).toBeTruthy();

    await act(async () => {
      finishUpgradeReload?.({ ok: true, data: upgrades });
      await Promise.resolve();
    });
    expect(screen.queryByTestId("asset-preparation")).toBeNull();
  });

  it("keeps pending changes when a stale save is rejected", async () => {
    const write = vi.fn().mockResolvedValue({
      ok: false as const,
      error: { code: "save_stale" as const, message: "Reopen it before saving edits." },
    });
    window.repoditor = bridge(
      vi.fn().mockResolvedValue({ ok: true, data: session }),
      players,
      undefined,
      write,
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("tab", { name: "Run" }));
    const currency = await screen.findByRole("spinbutton", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "20");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Reopen it");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("1 pending change");
  });

  it("keeps editing available while an avatar loads and falls back if the image fails", async () => {
    let finishAvatar:
      | ((value: { ok: true; data: { playerId: string; avatarUrl: string | null } }) => void)
      | undefined;
    const avatar = vi.fn(
      () =>
        new Promise<{ ok: true; data: { playerId: string; avatarUrl: string | null } }>(
          (resolve) => {
            finishAvatar = resolve;
          },
        ),
    );
    window.repoditor = bridge(
      vi.fn().mockResolvedValue({ ok: true, data: session }),
      [players[0]!],
      avatar,
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByTestId("workspace")).toBeTruthy();
    await waitFor(() => {
      expect(avatar).toHaveBeenCalledWith(saveId, "111");
    });
    await user.click(await screen.findByRole("tab", { name: "Players" }, { timeout: 10_000 }));
    const health = await screen.findByRole("spinbutton", { name: "Current health" });
    await user.clear(health);
    await user.type(health, "95");
    expect(screen.getByTestId("pending-health-edit")).toBeTruthy();

    const avatarUrl = "https://avatars.fastly.steamstatic.com/avatar.jpg";
    await act(async () => {
      finishAvatar?.({ ok: true, data: { playerId: "111", avatarUrl } });
    });
    const image = await waitFor(() => {
      const element = document.querySelector<HTMLImageElement>(`img[src="${avatarUrl}"]`);
      expect(element).toBeTruthy();
      return element!;
    });
    fireEvent.error(image);
    expect(screen.getByTestId("avatar-fallback").textContent).toBe("A");
  });
});
