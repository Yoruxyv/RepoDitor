import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import {
  advanced,
  createRepoDitorApi as bridge,
  maps,
  openResult,
  players,
  runState,
  saveId,
  session,
} from "@/test/repoditorApiFixture";

describe("run-save workspace integration", () => {
  beforeEach(() => {
    localStorage.clear();
    window.repoditor = bridge(vi.fn());
  });

  it("shows Overview and preserves typed pending player edits across navigation", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players);
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
    expect(screen.queryByTestId("workspace-tab-pending-indicator-players")).toBeNull();
    expect(
      screen.getByRole("tab", { name: "Players" }).getAttribute("aria-describedby"),
    ).toBeNull();
    await user.clear(health);
    await user.type(health, "42");
    expect(screen.getByTestId("pending-health-edit").textContent).toContain("0 → 42");
    expect(health.getAttribute("aria-describedby")).toContain("player-health-pending");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("1 pending change");
    expect(screen.getByTestId("workspace-tab-pending-indicator-players")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Players" }).getAttribute("aria-describedby")).toContain(
      "workspace-tab-pending-1",
    );
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
    expect(screen.queryByTestId("workspace-tab-pending-indicator-players")).toBeNull();

    await user.clear(health);
    await user.type(health, "42");

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByTestId("workspace-tab-pending-indicator-players")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Players" }).getAttribute("aria-selected")).toBe(
      "false",
    );
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
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players);
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
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players);
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
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), [
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
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players);
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
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players, undefined, write);
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

  it("applies canonical Players state without a post-save players reread", async () => {
    const write = vi.fn().mockResolvedValue({
      ok: true as const,
      data: {
        backupPath: "C:\\fixture\\save.es3.bak-20260808-102100",
        session: { ...session, fingerprint: "b".repeat(64) },
        canonical: {
          fingerprint: "b".repeat(64),
          players: [{ id: "222", health: 100 }],
        },
      },
    });
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players, undefined, write);
    const playerList = vi.mocked(window.repoditor.players.list);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByTestId("workspace")).toBeTruthy();
    await waitFor(() => expect(playerList).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole("tab", { name: "Players" }));
    await user.click(await screen.findByRole("button", { name: /Beta/ }));
    await user.click(screen.getByRole("button", { name: "Heal to Full" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText(/Saved safely · Backup created/)).toBeTruthy();
    expect(playerList).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("spinbutton", { name: "Current health" }) as HTMLInputElement).value,
    ).toBe("100");
  });

  it("applies canonical Upgrades state without a post-save upgrades reread", async () => {
    const write = vi.fn().mockResolvedValue({
      ok: true as const,
      data: {
        backupPath: "C:\\fixture\\save.es3.bak-20260808-102100",
        session: { ...session, fingerprint: "b".repeat(64) },
        canonical: {
          fingerprint: "b".repeat(64),
          upgrades: [{ playerId: "222", key: "playerUpgradeStrength", value: 3 }],
        },
      },
    });
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players, undefined, write);
    const upgradeList = vi.mocked(window.repoditor.upgrades.list);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByTestId("workspace")).toBeTruthy();
    await waitFor(() => expect(upgradeList).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByRole("tab", { name: "Players" }));
    await user.click(await screen.findByRole("button", { name: /Beta/ }));
    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    const strength = await screen.findByRole("spinbutton", { name: "Strength for Beta" });
    await user.clear(strength);
    await user.type(strength, "3");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText(/Saved safely · Backup created/)).toBeTruthy();
    expect(upgradeList).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("spinbutton", { name: "Strength for Beta" }) as HTMLInputElement).value,
    ).toBe("3");
    expect(screen.queryByTestId("asset-preparation")).toBeNull();
  });

  it("applies canonical recharge state without a post-save advanced reread", async () => {
    let finishWrite:
      | ((value: {
          ok: true;
          data: {
            backupPath: string;
            session: typeof session;
            canonical: {
              fingerprint: string;
              advanced: {
                items: Array<{
                  saveKey: string;
                  storedCharge: null;
                  chargeState: "default_full";
                  rechargeCapability: "rechargeable";
                  canRefillToFull: false;
                }>;
                currentChargeEntryCount: number;
              };
            };
          };
        }) => void)
      | undefined;
    const write = vi.fn(
      () =>
        new Promise<{
          ok: true;
          data: {
            backupPath: string;
            session: typeof session;
            canonical: {
              fingerprint: string;
              advanced: {
                items: Array<{
                  saveKey: string;
                  storedCharge: null;
                  chargeState: "default_full";
                  rechargeCapability: "rechargeable";
                  canRefillToFull: false;
                }>;
                currentChargeEntryCount: number;
              };
            };
          };
        }>((resolve) => {
          finishWrite = resolve;
        }),
    );
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players, undefined, write);
    const advancedGet = vi.mocked(window.repoditor.advanced.get);
    const upgradeList = vi.mocked(window.repoditor.upgrades.list);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByTestId("workspace")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Items" }));
    const search = screen.getByRole("searchbox", { name: "Search items" });
    await user.type(search, "hammer");
    await user.click(screen.getByRole("button", { name: /Recharge .*tool 1/ }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const progress = screen.getByRole("progressbar", { name: "Saving safely…" });
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
    expect(screen.queryByTestId("items-skeleton")).toBeNull();
    expect((search as HTMLInputElement).value).toBe("hammer");

    await act(async () => {
      finishWrite?.({
        ok: true,
        data: {
          backupPath: "C:\\fixture\\save.es3.bak-20260808-102100",
          session: {
            ...session,
            fingerprint: "b".repeat(64),
            name: "2026-08-08 10:21:00",
            modifiedAt: "2026-08-08T10:21:00+00:00",
          },
          canonical: {
            fingerprint: "b".repeat(64),
            advanced: {
              items: [
                {
                  saveKey: "Item Melee Inflatable Hammer/1",
                  storedCharge: null,
                  chargeState: "default_full",
                  rechargeCapability: "rechargeable",
                  canRefillToFull: false,
                },
              ],
              currentChargeEntryCount: 0,
            },
          },
        },
      });
    });

    expect(await screen.findByText(/Saved safely · Backup created/)).toBeTruthy();
    expect(advancedGet).toHaveBeenCalledTimes(1);
    expect(upgradeList).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("progressbar", { name: "Saving safely…" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Items" }).getAttribute("aria-selected")).toBe("true");
    expect(
      (screen.getByRole("searchbox", { name: "Search items" }) as HTMLInputElement).value,
    ).toBe("hammer");
    expect(screen.queryByTestId("items-skeleton")).toBeNull();
    expect(screen.queryByTestId("asset-preparation")).toBeNull();
    expect(
      screen.getByTestId("item-instance-Item Melee Inflatable Hammer/1").textContent,
    ).toContain("Full");
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
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players, undefined, write);
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

  it("applies canonical Run state without a post-save run reread", async () => {
    const write = vi.fn().mockResolvedValue({
      ok: true as const,
      data: {
        backupPath: "C:\\fixture\\save.es3.bak-20260808-102100",
        session: { ...session, fingerprint: "b".repeat(64), currency: 20 },
        canonical: {
          fingerprint: "b".repeat(64),
          run: { stats: [{ key: "currency" as const, value: 20 }] },
        },
      },
    });
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players, undefined, write);
    const runGet = vi.mocked(window.repoditor.run.get);
    const upgradeList = vi.mocked(window.repoditor.upgrades.list);
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

    expect(await screen.findByText(/Saved safely · Backup created/)).toBeTruthy();
    expect(runGet).toHaveBeenCalledTimes(1);
    expect(upgradeList).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("asset-preparation")).toBeNull();
    expect(screen.queryByTestId("run-skeleton")).toBeNull();
    expect(screen.getByRole("tab", { name: "Run" }).getAttribute("aria-selected")).toBe("true");
    expect(
      ((await screen.findByRole("spinbutton", { name: "Currency" })) as HTMLInputElement).value,
    ).toBe("20");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
  });

  it("falls back to refreshAfterSave when the canonical fingerprint mismatches", async () => {
    const write = vi.fn().mockResolvedValue({
      ok: true as const,
      data: {
        backupPath: "C:\\fixture\\save.es3.bak-20260808-102100",
        session: { ...session, fingerprint: "b".repeat(64), currency: 20 },
        canonical: {
          fingerprint: "c".repeat(64),
          run: { stats: [{ key: "currency" as const, value: 20 }] },
        },
      },
    });
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players, undefined, write);
    const runGet = vi.mocked(window.repoditor.run.get);
    runGet.mockResolvedValueOnce({ ok: true, data: runState }).mockResolvedValueOnce({
      ok: true,
      data: {
        ...runState,
        stats: runState.stats.map((stat) =>
          stat.key === "currency" ? { ...stat, value: 20 } : stat,
        ),
      },
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("tab", { name: "Run" }));
    const currency = await screen.findByRole("spinbutton", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "20");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText(/Saved safely · Backup created/)).toBeTruthy();
    expect(runGet).toHaveBeenCalledTimes(2);
    expect(
      ((await screen.findByRole("spinbutton", { name: "Currency" })) as HTMLInputElement).value,
    ).toBe("20");
  });

  it("falls back to refreshAfterSave when a successful write omits canonical state", async () => {
    const write = vi.fn().mockResolvedValue({
      ok: true as const,
      data: {
        backupPath: "C:\\fixture\\save.es3.bak-20260808-102100",
        session: { ...session, fingerprint: "b".repeat(64), currency: 20 },
      },
    });
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players, undefined, write);
    const runGet = vi.mocked(window.repoditor.run.get);
    runGet.mockResolvedValueOnce({ ok: true, data: runState }).mockResolvedValueOnce({
      ok: true,
      data: {
        ...runState,
        stats: runState.stats.map((stat) =>
          stat.key === "currency" ? { ...stat, value: 20 } : stat,
        ),
      },
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("tab", { name: "Run" }));
    const currency = await screen.findByRole("spinbutton", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "20");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText(/Saved safely · Backup created/)).toBeTruthy();
    expect(runGet).toHaveBeenCalledTimes(2);
    expect(
      ((await screen.findByRole("spinbutton", { name: "Currency" })) as HTMLInputElement).value,
    ).toBe("20");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
  });

  it("keeps the active tab and pending changes when a stale save is rejected", async () => {
    let finishWrite:
      ((value: { ok: false; error: { code: "save_stale"; message: string } }) => void) | undefined;
    const write = vi.fn(
      () =>
        new Promise<{
          ok: false;
          error: { code: "save_stale"; message: string };
        }>((resolve) => {
          finishWrite = resolve;
        }),
    );
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players, undefined, write);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("tab", { name: "Run" }));
    const currency = await screen.findByRole("spinbutton", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "20");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(screen.getByRole("tab", { name: "Run" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("progressbar", { name: "Saving safely…" })).toBeTruthy();

    await act(async () => {
      finishWrite?.({
        ok: false,
        error: { code: "save_stale", message: "Reopen it before saving edits." },
      });
    });

    expect((await screen.findByRole("alert")).textContent).toContain("Reopen it");
    expect(screen.queryByRole("progressbar", { name: "Saving safely…" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Run" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("1 pending change");
  });

  it("waits for avatar warmup before entry and falls back if the image fails", async () => {
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
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), [players[0]!], avatar);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await waitFor(() => {
      expect(avatar).toHaveBeenCalledWith(saveId, "111");
    });
    await waitFor(() => {
      expect(screen.getByTestId("entry-loading-detail").textContent).toBe(
        "Loading player avatars…",
      );
    });
    expect(screen.queryByTestId("workspace")).toBeNull();

    const avatarUrl = "https://avatars.fastly.steamstatic.com/avatar.jpg";
    await act(async () => {
      finishAvatar?.({ ok: true, data: { playerId: "111", avatarUrl } });
    });

    expect(await screen.findByTestId("workspace")).toBeTruthy();
    await user.click(await screen.findByRole("tab", { name: "Players" }, { timeout: 10_000 }));
    const health = await screen.findByRole("spinbutton", { name: "Current health" });
    await user.clear(health);
    await user.type(health, "95");
    expect(screen.getByTestId("pending-health-edit")).toBeTruthy();

    const image = await waitFor(() => {
      const element = document.querySelector<HTMLImageElement>(`img[src="${avatarUrl}"]`);
      expect(element).toBeTruthy();
      return element!;
    });
    fireEvent.error(image);
    expect(screen.getByTestId("avatar-fallback").textContent).toBe("A");
  });
});
