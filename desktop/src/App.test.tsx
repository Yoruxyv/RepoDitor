import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdvancedSaveDto,
  CosmeticsViewDto,
  EnvironmentDiscovery,
  InstalledMapsDto,
  PlayerDto,
  PlayerUpgradeDto,
  RepoDitorApi,
  RunStateDto,
  SaveSession,
} from "@electron/contracts";
import App from "@/App";

const saveId = "REPO_SAVE_2026_08_08_10_20_30";
const environment: EnvironmentDiscovery = {
  saveRoot: "C:\\fixture\\saves",
  saveRootStatus: "available",
  saveRootDetected: true,
  gameRoot: null,
  gameStatus: "game_not_found",
  gameDetected: false,
  saves: [
    {
      id: saveId,
      name: "2026-08-08 10:20:30",
      path: `C:\\fixture\\saves\\${saveId}\\${saveId}.es3`,
      modifiedAt: "2026-08-08T10:20:30+00:00",
      sizeBytes: 1024,
    },
  ],
};
const session: SaveSession = {
  ...environment.saves[0]!,
  fingerprint: "a".repeat(64),
  level: 5,
  currency: 12,
  playerCount: 2,
  resumeLocation: "Normal",
};
const players: PlayerDto[] = [
  { id: "111", name: "Alpha", health: 80, maxHealth: 100 },
  { id: "222", name: "Beta", health: 0, maxHealth: 100 },
];
const upgrades: PlayerUpgradeDto[] = [
  {
    key: "playerUpgradeStrength",
    label: "Strength",
    known: true,
    values: [{ playerId: "111", value: 2 }, { playerId: "222", value: 0 }],
  },
  {
    key: "playerUpgradeMoonBoots",
    label: "Moon Boots",
    known: false,
    values: [{ playerId: "111", value: 0 }, { playerId: "222", value: 7 }],
  },
];
const run: RunStateDto = {
  stats: [
    { key: "level", label: "Level", value: 5 },
    { key: "currency", label: "Currency", value: 12 },
    { key: "lives", label: "Lives", value: 3 },
  ],
  resumeLocation: { value: "Normal", options: ["Normal", "Shop / Service Station"] },
};
const maps: InstalledMapsDto = {
  available: true,
  catalogPath: "C:\\fixture\\game\\catalog.json",
  maps: [
    { internalName: "Arctic", displayName: "McJannek Station", knownLabel: true },
    { internalName: "Modded Moon", displayName: "Modded Moon", knownLabel: false },
  ],
};
const readOnlyAdvancedCapabilities = {
  canRead: true,
  canEdit: false,
  canAdd: false,
  canDelete: false,
  canDuplicate: false,
  canRefillToFull: false,
} as const;
const advanced: AdvancedSaveDto = {
  domains: [
    { key: "items", label: "Item instances", status: "confirmed", entryCount: 1, capabilities: readOnlyAdvancedCapabilities },
    { key: "currentCharge", label: "Stored charge entries", status: "partially_confirmed", entryCount: 1, capabilities: { ...readOnlyAdvancedCapabilities, canRefillToFull: true } },
    { key: "batteryUpgrades", label: "Battery upgrade entries", status: "unknown", entryCount: 0, capabilities: { ...readOnlyAdvancedCapabilities, canRead: false } },
    { key: "purchasedUpgrades", label: "Purchased upgrade entries", status: "partially_confirmed", entryCount: 1, capabilities: { ...readOnlyAdvancedCapabilities, canRead: false } },
    { key: "purchasedItems", label: "Purchased item entries", status: "partially_confirmed", entryCount: 1, capabilities: { ...readOnlyAdvancedCapabilities, canRead: false } },
    { key: "purchasedItemsTotal", label: "Total purchased item entries", status: "partially_confirmed", entryCount: 2, capabilities: { ...readOnlyAdvancedCapabilities, canRead: false } },
    { key: "runMetadata", label: "Additional Run values", status: "partially_confirmed", entryCount: 1, capabilities: readOnlyAdvancedCapabilities },
  ],
  items: [{ saveKey: "Item Melee Inflatable Hammer/1", name: "Melee Inflatable Hammer", instanceId: "1", storedCharge: 99 }],
  runValues: [{ saveKey: "chargingStationCharge", label: "Charging station charge", value: 10, status: "partially_confirmed" }],
  unlinkedChargeEntryCount: 0,
};
const cosmetics: CosmeticsViewDto = {
  fingerprint: "c".repeat(64),
  knownCatalogCount: 547,
  knownOwnedCount: 1,
  knownLockedCount: 546,
  unknownOwnedIds: [999],
  capabilities: {
    canReadCosmetics: true,
    canUnlockCosmetic: true,
    canUnlockAll: true,
    canRemoveOwnership: true,
  },
  cosmetics: [
    ...Array.from({ length: 547 }, (_, id) => ({
      id,
      displayName: `Cosmetic #${id}`,
      owned: id === 27,
      known: true,
      removalBlockedReason: id === 27 ? "Removal unavailable while equipped." : null,
    })),
    {
      id: 999,
      displayName: "Cosmetic #999",
      owned: true,
      known: false,
      removalBlockedReason: "Unknown or future cosmetics are preserved read-only.",
    },
  ],
};

function bridge(
  open: RepoDitorApi["saves"]["open"],
  playerList: PlayerDto[] = [],
  avatar: RepoDitorApi["players"]["avatar"] = vi.fn((_saveId: string, playerId: string) =>
    Promise.resolve({ ok: true as const, data: { playerId, avatarUrl: null } }),
  ),
  write: RepoDitorApi["saves"]["write"] = vi.fn().mockResolvedValue({
    ok: true,
    data: {
      backupPath: "C:\\fixture\\save.es3.bak-20260808-102100",
      session: { ...session, fingerprint: "b".repeat(64) },
    },
  }),
): RepoDitorApi {
  return {
    environment: { detect: vi.fn().mockResolvedValue({ ok: true, data: environment }) },
    saves: {
      list: vi.fn().mockResolvedValue({ ok: true, data: environment.saves }),
      open,
      write,
    },
    players: {
      list: vi.fn().mockResolvedValue({ ok: true, data: playerList }),
      avatar,
    },
    upgrades: { list: vi.fn().mockResolvedValue({ ok: true, data: upgrades }) },
    run: { get: vi.fn().mockResolvedValue({ ok: true, data: run }) },
    advanced: { get: vi.fn().mockResolvedValue({ ok: true, data: advanced }) },
    cosmetics: {
      get: vi.fn().mockResolvedValue({ ok: true, data: cosmetics }),
      write: vi.fn().mockImplementation((_saveId, _fingerprint, changes) => {
        const next = structuredClone(cosmetics);
        for (const change of changes) {
          if (change.field === "unlockAll") {
            for (const cosmetic of next.cosmetics) {
              if (cosmetic.known) cosmetic.owned = true;
            }
            next.knownOwnedCount = 547;
            next.knownLockedCount = 0;
          } else {
            const cosmetic = next.cosmetics.find((entry) => String(entry.id) === change.entity);
            if (cosmetic) cosmetic.owned = change.after;
          }
        }
        return Promise.resolve({
          ok: true as const,
          data: {
            backupPath: "C:\\fixture\\MetaSave.es3.bak-20260808-102100",
            cosmetics: next,
          },
        });
      }),
    },
    maps: { list: vi.fn().mockResolvedValue({ ok: true, data: maps }) },
  };
}

describe("save workspace transition", () => {
  beforeEach(() => {
    window.repoditor = bridge(vi.fn());
  });

  it("presents release identity and project attribution", () => {
    render(<App />);

    expect(screen.getAllByText("v0.1.0").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("About RepoDitor").textContent).toContain(
      "Unofficial R.E.P.O. save utility",
    );
    expect(screen.getByRole("link", { name: "Project source" }).getAttribute("href")).toBe(
      "https://github.com/Yoruxyv/RepoDitor",
    );
  });

  it("shows discovery loading while the desktop bridge responds", () => {
    window.repoditor.environment.detect = vi.fn(() => new Promise<never>(() => undefined));
    render(<App />);
    expect(screen.getByLabelText("Discovering local R.E.P.O. saves")).toBeTruthy();
  });

  it.each([
    ["available" as const, "No valid saves yet"],
    ["missing" as const, "Standard save folder not found"],
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
    expect(screen.getByRole("tab", { name: "Players" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it.each([
    ["save_missing" as const, "The selected save no longer exists."],
    ["save_corrupt" as const, "The selected save is corrupted."],
    ["save_unsupported" as const, "The selected save format is not supported."],
  ])("keeps discovery visible and reports %s open failures", async (code, message) => {
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
      `${message} No save files were changed.`,
    );
    expect(screen.queryByTestId("workspace")).toBeNull();
  });

  it("shows Overview and preserves typed pending player edits across navigation", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByText("Save opened safely")).toBeTruthy();
    expect(screen.getByText("Last modified")).toBeTruthy();
    expect(screen.getByText("Normal")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Players" }));
    await user.click(await screen.findByRole("button", { name: /Beta/ }));
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect(screen.getByTestId("avatar-fallback").textContent).toBe("B");

    const health = screen.getByRole("spinbutton", { name: "Current health" });
    await user.clear(health);
    await user.type(health, "42");
    expect(screen.getByTestId("pending-health-edit").textContent).toContain("0 → 42");
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("1 pending change");

    await user.clear(health);
    await user.type(health, "0");
    expect(screen.queryByTestId("pending-health-edit")).toBeNull();
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("No pending changes");

    await user.clear(health);
    await user.type(health, "42");

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.click(screen.getByRole("tab", { name: "Players" }));
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect((screen.getByRole("spinbutton", { name: "Current health" }) as HTMLInputElement).value)
      .toBe("42");

    await user.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.queryByTestId("pending-health-edit")).toBeNull();
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("No pending changes");
  });

  it("rejects invalid health without creating a pending edit", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(screen.getByRole("tab", { name: "Players" }));
    const health = await screen.findByRole("spinbutton", { name: "Current health" });
    fireEvent.change(health, { target: { value: "-1" } });

    expect(screen.getByRole("alert").textContent).toContain("whole number");
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("No pending changes");
  });

  it("heals to Python-provided max health through the existing pending edit", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(screen.getByRole("tab", { name: "Players" }));
    await user.click(await screen.findByRole("button", { name: /Beta/ }));

    expect(screen.getByLabelText("Maximum health 100")).toBeTruthy();
    const heal = screen.getByRole("button", { name: "Heal to Full" });
    await user.click(heal);
    expect((screen.getByRole("spinbutton", { name: "Current health" }) as HTMLInputElement).value)
      .toBe("100");
    expect((heal as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("pending-health-edit").textContent).toContain("0 → 100");

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.click(screen.getByRole("tab", { name: "Players" }));
    expect((screen.getByRole("spinbutton", { name: "Current health" }) as HTMLInputElement).value)
      .toBe("100");

    await user.click(screen.getByRole("button", { name: "Revert" }));
    expect((screen.getByRole("spinbutton", { name: "Current health" }) as HTMLInputElement).value)
      .toBe("0");
    expect((screen.getByRole("button", { name: "Heal to Full" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it("disables Heal to Full when current health already equals max health", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), [
      { ...players[0]!, health: 100 },
    ]);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(screen.getByRole("tab", { name: "Players" }));

    expect(
      (await screen.findByRole("button", { name: "Heal to Full" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("No pending changes");
  });

  it("keeps advanced refill and other edits while navigating sections", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(screen.getByRole("tab", { name: "Players" }));
    await user.click(await screen.findByRole("button", { name: /Beta/ }));

    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    expect(await screen.findByText("Moon Boots")).toBeTruthy();
    const strength = screen.getByRole("spinbutton", { name: "Strength for Beta" });
    await user.clear(strength);
    await user.type(strength, "3");
    expect(screen.getByTestId("pending-upgrade-playerUpgradeStrength").textContent).toContain(
      "0 → 3",
    );

    await user.click(screen.getByRole("tab", { name: "Run" }));
    const currency = await screen.findByRole("spinbutton", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "20");
    expect(screen.getByTestId("pending-run-currency").textContent).toContain("12 → 20");
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("2 pending changes");

    await user.click(screen.getByRole("tab", { name: "Items" }));
    expect(await screen.findByText("Melee Inflatable Hammer #1")).toBeTruthy();
    expect(screen.getByText(
      "Only the evidence-backed Refill to Full action is writable. All unverified item mutations remain unavailable.",
    )).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Refill Melee Inflatable Hammer #1 to full" }));
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("3 pending changes");

    await user.click(screen.getByRole("tab", { name: "Maps" }));
    expect(await screen.findByText("McJannek Station")).toBeTruthy();
    expect(screen.getByText("Modded Moon")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    expect((screen.getByRole("spinbutton", { name: "Strength for Beta" }) as HTMLInputElement).value)
      .toBe("3");
    await user.click(screen.getByRole("tab", { name: "Run" }));
    expect((screen.getByRole("spinbutton", { name: "Currency" }) as HTMLInputElement).value)
      .toBe("20");
    await user.click(screen.getByRole("tab", { name: "Items" }));
    expect(screen.getByText("Pending: 99 → Full / Default")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revert refill" }));
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("2 pending changes");
  });

  it("keeps cosmetic ownership pending until save and preserves unknown IDs read-only", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const cosmeticWrite = vi.mocked(window.repoditor.cosmetics.write);
    const runWrite = vi.mocked(window.repoditor.saves.write);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(screen.getByRole("tab", { name: "Cosmetics" }));

    expect(await screen.findByRole("heading", { name: "Cosmetics" })).toBeTruthy();
    expect(screen.getByText(/Unknown\/future ID/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark Cosmetic #27 as Locked" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Unlock Cosmetic #28" }));
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("1 pending change");
    expect(screen.getByText(/Cosmetic #28.*Ownership/)).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.click(screen.getByRole("tab", { name: "Cosmetics" }));
    expect(screen.getByRole("button", { name: "Revert Cosmetic #28 ownership" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(cosmeticWrite).toHaveBeenCalledWith(saveId, cosmetics.fingerprint, [
      { feature: "cosmetics", entity: "28", field: "owned", after: true },
    ]);
    expect(runWrite).not.toHaveBeenCalled();
    expect(await screen.findByText(/MetaSave\.es3\.bak/)).toBeTruthy();
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("No pending changes");
  });

  it("represents Unlock All as one revertible pending action", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(screen.getByRole("tab", { name: "Cosmetics" }));
    await user.click(await screen.findByRole("button", { name: "Unlock All" }));

    expect(screen.getByTestId("pending-edit-count").textContent).toBe("1 pending change");
    expect(screen.getByText(/Cosmetics.*Known ownership/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("No pending changes");
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
    expect((screen.getByRole("button", { name: "Save Changes" }) as HTMLButtonElement).disabled)
      .toBe(true);

    await user.click(screen.getByRole("tab", { name: "Players" }));
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
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("3 pending changes");

    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("No pending changes");
    expect((screen.getByRole("spinbutton", { name: "Currency" }) as HTMLInputElement).value)
      .toBe("12");
    expect(write).not.toHaveBeenCalled();

    await user.clear(screen.getByRole("spinbutton", { name: "Currency" }));
    await user.type(screen.getByRole("spinbutton", { name: "Currency" }), "20");
    await user.click(screen.getByRole("tab", { name: "Items" }));
    await user.click(screen.getByRole("button", { name: "Refill Melee Inflatable Hammer #1 to full" }));
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
    expect(await screen.findByText(/Saved safely\. Backup:/)).toBeTruthy();
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("No pending changes");
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
    await user.click(screen.getByRole("tab", { name: "Run" }));
    const currency = await screen.findByRole("spinbutton", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "20");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Reopen it");
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("1 pending change");
  });

  it("keeps editing available while an avatar loads and falls back if the image fails", async () => {
    let finishAvatar:
      | ((value: {
          ok: true;
          data: { playerId: string; avatarUrl: string | null };
        }) => void)
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
    expect(avatar).toHaveBeenCalledWith(saveId, "111");
    await user.click(screen.getByRole("tab", { name: "Players" }));
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
