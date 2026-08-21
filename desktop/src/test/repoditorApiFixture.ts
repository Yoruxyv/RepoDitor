/**
 * Complete typed preload fixture for renderer/component tests.
 *
 * Defaults are deterministic in-memory DTOs and mocked methods; individual tests
 * override only the boundary behavior they exercise, without spawning Electron or
 * touching local saves.
 */
import { vi } from "vitest";

import type {
  AdvancedSaveDto,
  AssetPreparationState,
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

export const saveId = "REPO_SAVE_2026_08_08_10_20_30";
export const environment: EnvironmentDiscovery = {
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
export const session: SaveSession = {
  ...environment.saves[0]!,
  fingerprint: "a".repeat(64),
  level: 5,
  currency: 12,
  playerCount: 2,
  resumeLocation: "Normal",
};
export const requiredUpgradeVisualKeys = ["playerUpgradeStrength", "playerUpgradeMoonBoots"];
export const players: PlayerDto[] = [
  { id: "111", name: "Alpha", health: 80, maxHealth: 100 },
  { id: "222", name: "Beta", health: 0, maxHealth: 100 },
];
export const upgrades: PlayerUpgradeDto[] = [
  {
    key: "playerUpgradeStrength",
    label: "Strength",
    presentationSource: "installed",
    gameplayCap: 10,
    iconToken: null,
    values: [
      { playerId: "111", value: 2 },
      { playerId: "222", value: 0 },
    ],
  },
  {
    key: "playerUpgradeMoonBoots",
    label: "Moon Boots",
    presentationSource: "humanized",
    gameplayCap: null,
    iconToken: null,
    values: [
      { playerId: "111", value: 0 },
      { playerId: "222", value: 7 },
    ],
  },
];
export function openResult(
  value: SaveSession = session,
  presentationReadiness: "ready" | "unresolved" = "ready",
) {
  return {
    ok: true as const,
    data: { session: value, requiredUpgradeVisualKeys, presentationReadiness },
  };
}

export const runState: RunStateDto = {
  stats: [
    { key: "level", label: "Level", value: 5 },
    { key: "currency", label: "Currency", value: 12 },
    { key: "lives", label: "Lives", value: 3 },
  ],
  resumeLocation: { value: "Normal", options: ["Normal", "Shop / Service Station"] },
};
export const maps: InstalledMapsDto = {
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
export const advanced: AdvancedSaveDto = {
  domains: [
    {
      key: "items",
      label: "Item instances",
      status: "confirmed",
      entryCount: 1,
      capabilities: readOnlyAdvancedCapabilities,
    },
    {
      key: "currentCharge",
      label: "Stored charge entries",
      status: "partially_confirmed",
      entryCount: 1,
      capabilities: { ...readOnlyAdvancedCapabilities, canRefillToFull: true },
    },
    {
      key: "batteryUpgrades",
      label: "Battery upgrade entries",
      status: "unknown",
      entryCount: 0,
      capabilities: { ...readOnlyAdvancedCapabilities, canRead: false },
    },
    {
      key: "purchasedUpgrades",
      label: "Purchased upgrade entries",
      status: "partially_confirmed",
      entryCount: 1,
      capabilities: { ...readOnlyAdvancedCapabilities, canRead: false },
    },
    {
      key: "purchasedItems",
      label: "Purchased item entries",
      status: "partially_confirmed",
      entryCount: 1,
      capabilities: { ...readOnlyAdvancedCapabilities, canRead: false },
    },
    {
      key: "purchasedItemsTotal",
      label: "Total purchased item entries",
      status: "partially_confirmed",
      entryCount: 2,
      capabilities: { ...readOnlyAdvancedCapabilities, canRead: false },
    },
  ],
  items: [
    {
      saveKey: "Item Melee Inflatable Hammer/1",
      name: "Melee Inflatable Hammer",
      instanceId: "1",
      isUpgrade: false,
      storedCharge: 99,
      chargeState: "stored",
      rechargeCapability: "rechargeable",
      canRefillToFull: true,
      iconToken: null,
    },
  ],
  unlinkedChargeEntryCount: 0,
};
export const cosmetics: CosmeticsViewDto = {
  fingerprint: "c".repeat(64),
  catalogAvailable: true,
  knownCatalogCount: 2,
  knownOwnedCount: 1,
  knownLockedCount: 1,
  savedPresetCount: 0,
  unknownOwnedIds: [999],
  capabilities: {
    canReadCosmetics: true,
    canUnlockCosmetic: true,
    canUnlockAll: true,
    canRemoveOwnership: true,
  },
  cosmetics: [
    {
      id: 27,
      displayName: "Long Sleeve",
      type: 3,
      rarity: 0,
      status: 1,
      owned: true,
      known: true,
      state: "owned",
      mutationEligible: true,
      removalBlockedReason: null,
      iconToken: null,
    },
    {
      id: 28,
      displayName: "Installed Cosmetic 28",
      type: 0,
      rarity: 1,
      status: 1,
      owned: false,
      known: true,
      state: "locked",
      mutationEligible: true,
      removalBlockedReason: null,
      iconToken: null,
    },
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
  const knownCosmetics = next.cosmetics.filter((cosmetic) => cosmetic.known);
  for (const cosmetic of knownCosmetics) {
    cosmetic.owned = owned;
    cosmetic.state = owned ? "owned" : "locked";
  }
  next.knownOwnedCount = owned ? knownCosmetics.length : 0;
  next.knownLockedCount = owned ? 0 : knownCosmetics.length;
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
    if (cosmetic.known && cosmetic.owned !== change.after) {
      next.knownOwnedCount += change.after ? 1 : -1;
      next.knownLockedCount += change.after ? -1 : 1;
    }
    cosmetic.owned = change.after;
    cosmetic.state = change.after ? "owned" : "locked";
  }
}

export const readyAssets: AssetPreparationState = {
  stage: "ready",
  installationFound: true,
  buildVerified: true,
  completed: null,
  total: null,
  currentAsset: null,
  currentAssetLabel: null,
  degraded: false,
};

export function createRepoDitorApi(
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
    assets: {
      state: vi.fn().mockResolvedValue(readyAssets),
      onState: vi.fn((listener) => {
        listener(readyAssets);
        return () => undefined;
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
    upgrades: {
      list: vi.fn().mockResolvedValue({ ok: true, data: upgrades }),
      prepareEntry: vi.fn().mockResolvedValue({ ok: true, data: upgrades }),
    },
    run: { get: vi.fn().mockResolvedValue({ ok: true, data: runState }) },
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
