import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdvancedSaveDto,
  CosmeticChange,
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
import { TRANSLATIONS, type Locale } from "@/app/translations";

const localeCases: ReadonlyArray<readonly [Locale, string]> = [
  ["en", "English"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["zh", "中文"],
  ["id", "Bahasa Indonesia"],
];

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
  ],
  items: [{ saveKey: "Item Melee Inflatable Hammer/1", name: "Melee Inflatable Hammer", instanceId: "1", storedCharge: 99, chargeState: "stored", rechargeCapability: "rechargeable", canRefillToFull: true, iconToken: null }],
  unlinkedChargeEntryCount: 0,
};
const cosmetics: CosmeticsViewDto = {
  fingerprint: "c".repeat(64),
  catalogAvailable: true,
  knownCatalogCount: 547,
  knownOwnedCount: 1,
  knownLockedCount: 546,
  savedPresetCount: 0,
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
      displayName: id === 27 ? "Long Sleeve" : `Installed Cosmetic ${id}`,
      type: id % 4,
      rarity: id % 3,
      status: 1,
      owned: id === 27,
      known: true,
      state: id === 27 ? "owned" as const : "locked" as const,
      mutationEligible: true,
      removalBlockedReason: null,
      iconToken: null,
    })),
    {
      id: 999,
      displayName: "Cosmetic #999",
      type: null,
      rarity: null,
      status: null,
      owned: true,
      known: false,
      state: "unknown",
      mutationEligible: false,
      removalBlockedReason: "Unknown or future cosmetics are preserved read-only.",
      iconToken: null,
    },
  ],
};

function setKnownCosmeticsOwned(next: CosmeticsViewDto, owned: boolean): void {
  for (const cosmetic of next.cosmetics) {
    if (cosmetic.known) {
      cosmetic.owned = owned;
      cosmetic.state = owned ? "owned" : "locked";
    }
  }
  next.knownOwnedCount = owned ? 547 : 0;
  next.knownLockedCount = owned ? 0 : 547;
}

function applyCosmeticChange(next: CosmeticsViewDto, change: CosmeticChange): void {
  if (change.field === "unlockAll" || change.field === "lockAll") {
    setKnownCosmeticsOwned(next, change.field === "unlockAll");
    return;
  }
  if (change.field === "clearAll") {
    next.savedPresetCount = 0;
    return;
  }
  const cosmetic = next.cosmetics.find((entry) => String(entry.id) === change.entity);
  if (cosmetic) {
    cosmetic.owned = change.after;
    cosmetic.state = change.after ? "owned" : "locked";
  }
}

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
    project: { metadata: vi.fn().mockResolvedValue({ ok: true, data: { stars: 42 } }) },
    environment: { detect: vi.fn().mockResolvedValue({ ok: true, data: environment }) },
    game: {
      status: vi.fn().mockResolvedValue({
        ok: true,
        data: { status: "not_running", running: false },
      }),
    },
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
      write: vi.fn().mockImplementation((_fingerprint, changes: CosmeticChange[]) => {
        const next = structuredClone(cosmetics);
        changes.forEach((change) => applyCosmeticChange(next, change));
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
    localStorage.clear();
    window.repoditor = bridge(vi.fn());
  });

  it("presents release identity and project attribution", () => {
    render(<App />);

    expect(screen.getAllByText(`v${__APP_VERSION__}`).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("About RepoDitor").textContent).toContain(
      "Unofficial R.E.P.O. save utility",
    );
    expect(screen.getByRole("link", { name: "Project source" }).getAttribute("href")).toBe(
      "https://github.com/Yoruxyv/RepoDitor",
    );
  });

  it("renders GitHub stars and keeps the repository link usable when metadata fails", async () => {
    const metadata = vi.mocked(window.repoditor.project.metadata);
    const { unmount } = render(<App />);

    expect((await screen.findByTestId("github-stars")).textContent).toBe("42");
    expect(screen.getByRole("link", { name: /42 GitHub stars/ }).getAttribute("href")).toBe(
      "https://github.com/Yoruxyv/RepoDitor",
    );
    expect(screen.getByTestId("github-project-link").className).toContain("inline-flex");
    expect(screen.getByTestId("github-stars").className).toContain("xl:inline");
    unmount();

    metadata.mockResolvedValue({
      ok: false,
      error: { code: "backend_unavailable", message: "GitHub metadata is unavailable." },
    });
    render(<App />);
    expect(await screen.findByRole("link", { name: /star count unavailable/ })).toBeTruthy();
  });

  it("switches themes and restores the persisted preference", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    expect(document.documentElement.dataset.theme).toBe("light");
    await user.selectOptions(screen.getByRole("combobox", { name: "Theme" }), "dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("repoditor.theme")).toBe("dark");
    unmount();

    render(<App />);
    expect((screen.getByRole("combobox", { name: "Theme" }) as HTMLSelectElement).value)
      .toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("tracks operating-system theme changes when System is selected", async () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: (_type: string, next: (event: MediaQueryListEvent) => void) => {
          listener = next;
        },
        removeEventListener: vi.fn(),
      }),
    });
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => listener?.({ matches: true } as MediaQueryListEvent));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("repoditor.theme")).toBe("system");
  });

  it.each(localeCases)("renders critical shell controls in the %s locale", async (locale, nativeName) => {
    localStorage.setItem("repoditor.locale", locale);
    render(<App />);

    expect(document.documentElement.lang).toBe(locale);
    expect(screen.getByRole("button", { name: TRANSLATIONS[locale]["app.runSaves"] })).toBeTruthy();
    expect(screen.getByRole("button", { name: TRANSLATIONS[locale]["app.cosmetics"] })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: TRANSLATIONS[locale]["utility.theme"] })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(nativeName) })).toBeTruthy();
    expect(await screen.findByRole("button", { name: TRANSLATIONS[locale]["action.refresh"] }))
      .toBeTruthy();
  });

  it("switches and restores UI language while preserving game-derived strings", async () => {
    window.repoditor = bridge(
      vi.fn().mockResolvedValue({ ok: true, data: session }),
      players,
    );
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await user.click(screen.getByRole("button", { name: "Language: English" }));
    await user.click(screen.getByRole("option", { name: "日本語" }));
    expect(screen.getByRole("button", { name: "ランセーブ" })).toBeTruthy();
    expect(localStorage.getItem("repoditor.locale")).toBe("ja");
    expect(await screen.findByText(environment.saves[0]!.name)).toBeTruthy();

    await user.click((await screen.findByText("ワークスペースを開く")).closest("button")!);
    await user.click(screen.getByRole("tab", { name: "アップグレード" }));
    expect(await screen.findByRole("spinbutton", { name: "Alpha の Strength" })).toBeTruthy();
    expect(screen.getByText("Strength")).toBeTruthy();
    unmount();

    render(<App />);
    expect(screen.getByRole("button", { name: "言語: 日本語" })).toBeTruthy();
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
    window.repoditor.saves.open = vi.fn().mockResolvedValue({ ok: true, data: session });
    gameStatus
      .mockResolvedValueOnce({ ok: true, data: { status: "running", running: true } })
      .mockResolvedValueOnce({ ok: true, data: { status: "running", running: true } })
      .mockResolvedValueOnce({ ok: true, data: { status: "not_running", running: false } });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("button", { name: /Open workspace/ })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByRole("heading", { name: "R.E.P.O. is currently running" })).toBeTruthy();
    expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Check Again" }));
    expect(await screen.findByRole("heading", { name: "R.E.P.O. is currently running" })).toBeTruthy();
    expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Check Again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(false);
  });

  it("fails closed on an open workspace when game process status is unknown", async () => {
    window.repoditor.saves.open = vi.fn().mockResolvedValue({ ok: true, data: session });
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
    ["save_missing" as const, "The selected save no longer exists.", "The selected save could not be found."],
    ["save_corrupt" as const, "The selected save is corrupted.", "The selected save could not be safely read or validated."],
    ["save_unsupported" as const, "The selected save format is not supported.", "The selected save could not be safely read or validated."],
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
    expect(source.textContent).toContain(
      "REPO_SAVE_2026_08_08_10_20_30.es3",
    );
    expect(document.querySelectorAll("details")).toHaveLength(1);
    expect((source as HTMLDetailsElement).open).toBe(false);
    expect(metadata.contains(source)).toBe(false);
    expect(metadata.nextElementSibling).toBe(source);
    expect(screen.getByRole("heading", { name: "Run snapshot" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Edit this save" })).toBeTruthy();
    expect(screen.getByText("Normal")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Open Players" }));
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Players" }),
    ));
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
    expect(document.querySelector("#run-saves-pending")?.textContent).toContain(
      "1 pending change",
    );

    await user.clear(health);
    await user.type(health, "0");
    expect(screen.queryByTestId("pending-health-edit")).toBeNull();
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("No pending changes");

    await user.clear(health);
    await user.type(health, "42");

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.click(screen.getByRole("tab", { name: "Players" }));
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect((screen.getByRole("spinbutton", { name: "Current health" }) as HTMLInputElement).value)
      .toBe("42");

    await user.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.queryByTestId("pending-health-edit")).toBeNull();
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("No pending changes");
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
    expect(health.getAttribute("aria-describedby")).toContain("player-health-error");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("No pending changes");
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
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("No pending changes");
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
    expect(strength.getAttribute("aria-describedby")).toContain(
      "playerUpgradeStrength-pending",
    );

    await user.click(screen.getByRole("tab", { name: "Run" }));
    const currency = await screen.findByRole("spinbutton", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "20");
    expect(screen.getByTestId("pending-run-currency").textContent).toContain("12 → 20");
    expect(currency.getAttribute("min")).toBeNull();
    expect(currency.getAttribute("aria-describedby")).toContain("run-currency-pending");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("2 pending changes");

    await user.click(screen.getByRole("tab", { name: "Items" }));
    expect(await screen.findByRole("heading", { name: "Melee Inflatable Hammer" })).toBeTruthy();
    expect(screen.getByTestId("item-instance-Item Melee Inflatable Hammer/1").textContent)
      .toContain("Current charge: 99");
    expect(screen.queryByText("#1")).toBeNull();
    expect(screen.getByText(
      "Recharge appears only for tools RepoDitor can safely refill.",
    )).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Recharge All Tools" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("3 pending changes");

    await user.click(screen.getByRole("tab", { name: "Maps" }));
    expect(await screen.findByText("McJannek Station")).toBeTruthy();
    expect(screen.getByText("Modded Moon")).toBeTruthy();
    expect(screen.queryByText("Arctic")).toBeNull();
    expect(screen.queryByText(maps.catalogPath!)).toBeNull();
    expect(document.querySelectorAll("details")).toHaveLength(1);

    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    expect((screen.getByRole("spinbutton", { name: "Strength for Beta" }) as HTMLInputElement).value)
      .toBe("3");
    await user.click(screen.getByRole("tab", { name: "Run" }));
    expect((screen.getByRole("spinbutton", { name: "Currency" }) as HTMLInputElement).value)
      .toBe("20");
    await user.click(screen.getByRole("tab", { name: "Items" }));
    expect(screen.getByText("Pending: 99 → Full")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revert recharge" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("2 pending changes");
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
          { saveKey: "Item Gun Tranq/2", name: "Gun Tranq", instanceId: "2", storedCharge: 17, chargeState: "stored", rechargeCapability: "rechargeable", canRefillToFull: true, iconToken: null },
          { saveKey: "Item Gun Tranq/3", name: "Gun Tranq", instanceId: "3", storedCharge: null, chargeState: "default_full", rechargeCapability: "rechargeable", canRefillToFull: false, iconToken: null },
          { saveKey: "Item Cart Medium/1", name: "Cart Medium", instanceId: "1", storedCharge: null, chargeState: "not_applicable", rechargeCapability: "not_rechargeable", canRefillToFull: false, iconToken: null },
          { saveKey: "Item Future Tool/4", name: "Future Tool", instanceId: "4", storedCharge: 7, chargeState: "stored", rechargeCapability: "unknown", canRefillToFull: false, iconToken: null },
        ],
      },
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(screen.getByRole("tab", { name: "Items" }));
    await user.click(await screen.findByRole("button", { name: "Recharge All Tools" }));

    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("2 pending changes");
    expect(screen.getAllByText(/Pending: .* Full/)).toHaveLength(2);
    expect((screen.getByRole("button", { name: "Recharge All Tools" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(write).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText(/Melee Inflatable Hammer.*Charge/)).toBeTruthy();
    expect(screen.getByText(/Gun Tranq.*Charge/)).toBeTruthy();
    expect(screen.queryByText(/Cart Medium.*Charge/)).toBeNull();
    expect(screen.queryByText(/Future Tool.*Charge/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("No pending changes");
  });

  it("reloads MetaSave whenever Cosmetics is entered without pending edits", async () => {
    const getCosmetics = vi.mocked(window.repoditor.cosmetics.get);
    const user = userEvent.setup();
    render(<App />);

    expect(getCosmetics).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await waitFor(() => expect(getCosmetics).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Run Saves" }));
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await waitFor(() => expect(getCosmetics).toHaveBeenCalledTimes(2));
  });

  it("does not expose a manual MetaSave Refresh control", async () => {
    const getCosmetics = vi.mocked(window.repoditor.cosmetics.get);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    const workspace = await screen.findByTestId("cosmetics-workspace");
    await screen.findByRole("heading", { name: "Cosmetics" });

    expect(getCosmetics).toHaveBeenCalledTimes(1);
    expect(workspace.querySelector('button')).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  it("rechecks game safety silently on focus without reloading MetaSave", async () => {
    const getCosmetics = vi.mocked(window.repoditor.cosmetics.get);
    const gameStatus = vi.mocked(window.repoditor.game.status);
    let finishFocusCheck:
      | ((value: {
          ok: true;
          data: { status: "not_running"; running: false };
        }) => void)
      | undefined;
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
    await waitFor(() => expect(screen.getByTestId("editor-content").hasAttribute("inert")).toBe(false));
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
    expect(await screen.findByRole("heading", { name: "R.E.P.O. is currently running" })).toBeTruthy();

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
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "1 pending change",
    );
    expect(document.querySelector("#cosmetics-pending")?.textContent).toContain(
      "1 pending change",
    );

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(gameStatus).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Run Saves" }));
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));

    expect(getCosmetics).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Unlock All pending" })).toBeTruthy();
  });

  it("stages Clear All Presets as one revertible edit and saves it separately", async () => {
    const withPresets = structuredClone(cosmetics);
    withPresets.savedPresetCount = 3;
    const cleared = structuredClone(withPresets);
    cleared.savedPresetCount = 0;
    window.repoditor.cosmetics.get = vi.fn().mockResolvedValue({ ok: true, data: withPresets });
    const cosmeticWrite = vi.fn().mockResolvedValue({
      ok: true as const,
      data: {
        backupPath: "C:\\fixture\\MetaSave.es3.bak-20260810-172700",
        cosmetics: cleared,
      },
    });
    window.repoditor.cosmetics.write = cosmeticWrite;
    const runWrite = vi.mocked(window.repoditor.saves.write);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await screen.findByRole("heading", { name: "Cosmetics" });
    expect(screen.getByText("Saved presets").nextElementSibling?.textContent).toBe("3");

    await user.click(screen.getByRole("button", { name: "Clear All Presets" }));
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "1 pending change",
    );
    expect(screen.getByText("Saved presets").nextElementSibling?.textContent).toBe("0");
    expect(screen.getByText(/Cosmetics.*Saved presets/)).toBeTruthy();
    expect(screen.getByText("3 → 0")).toBeTruthy();
    expect(cosmeticWrite).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByText("Saved presets").nextElementSibling?.textContent).toBe("3");
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "No pending changes",
    );

    await user.click(screen.getByRole("button", { name: "Clear All Presets" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(cosmeticWrite).toHaveBeenCalledWith(withPresets.fingerprint, [
      { feature: "cosmetics", entity: "presets", field: "clearAll", after: true },
    ]);
    expect(runWrite).not.toHaveBeenCalled();
    expect(await screen.findByText("Saved safely · Backup created")).toBeTruthy();
    expect(screen.queryByText("C:\\fixture\\MetaSave.es3.bak-20260810-172700")).toBeNull();
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    expect(
      (screen.getByRole("button", { name: "Clear All Presets" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("opens Cosmetics without a Run save and keeps Lock All pending until save", async () => {
    const cosmeticWrite = vi.mocked(window.repoditor.cosmetics.write);
    const runWrite = vi.mocked(window.repoditor.saves.write);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));

    expect(await screen.findByRole("heading", { name: "Cosmetics" })).toBeTruthy();
    expect(screen.getByText("Known catalog")).toBeTruthy();
    expect(screen.getByText("Saved presets")).toBeTruthy();
    expect(screen.queryByLabelText("Search by cosmetic ID")).toBeNull();
    expect(await screen.findByText("Long Sleeve")).toBeTruthy();
    expect(screen.queryByText("Cosmetic #27")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Clear All Presets" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: /^Lock All Cosmetics$/ }));
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "1 pending change",
    );
    expect(screen.getByText(/Cosmetics.*Known ownership/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Run Saves" }));
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    expect(
      (screen.getByRole("button", { name: "Lock All pending" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(cosmeticWrite).toHaveBeenCalledWith(cosmetics.fingerprint, [
      { feature: "cosmetics", entity: "known", field: "lockAll", after: false },
    ]);
    expect(runWrite).not.toHaveBeenCalled();
    expect(await screen.findByText("Saved safely · Backup created")).toBeTruthy();
    expect(screen.queryByText("C:\\fixture\\MetaSave.es3.bak-20260808-102100")).toBeNull();
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
  });

  it("keeps Run and Cosmetics pending state independent across workspace navigation", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(screen.getByRole("tab", { name: "Run" }));
    const currency = await screen.findByRole("spinbutton", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "20");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "1 pending change",
    );

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await user.click(
      await screen.findByRole("button", { name: /^Unlock All Cosmetics$/ }),
    );
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "1 pending change",
    );

    await user.click(screen.getByRole("button", { name: "Run Saves" }));
    expect((screen.getByRole("spinbutton", { name: "Currency" }) as HTMLInputElement).value).toBe(
      "20",
    );
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "1 pending change",
    );

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    expect(screen.getByRole("button", { name: "Unlock All pending" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "No pending changes",
    );

    await user.click(screen.getByRole("button", { name: "Run Saves" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe(
      "1 pending change",
    );
  });

  it("represents Unlock All as one revertible pending action", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await user.click(
      await screen.findByRole("button", { name: /^Unlock All Cosmetics$/ }),
    );

    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "1 pending change",
    );
    expect(screen.getByText(/Cosmetics.*Known ownership/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
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
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("3 pending changes");

    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("No pending changes");
    expect((screen.getByRole("spinbutton", { name: "Currency" }) as HTMLInputElement).value)
      .toBe("12");
    expect(write).not.toHaveBeenCalled();

    await user.clear(screen.getByRole("spinbutton", { name: "Currency" }));
    await user.type(screen.getByRole("spinbutton", { name: "Currency" }), "20");
    await user.click(screen.getByRole("tab", { name: "Items" }));
    await user.click(screen.getByRole("button", { name: "Recharge Melee Inflatable Hammer, tool 1" }));
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
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("No pending changes");
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
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("1 pending change");
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
    await waitFor(() => {
      expect(avatar).toHaveBeenCalledWith(saveId, "111");
    });
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
