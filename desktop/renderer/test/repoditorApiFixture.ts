/** Deterministic desktop projection fixtures for renderer tests. */
import type {
  AdvancedSaveDto,
  CosmeticsViewDto,
  EnvironmentDiscovery,
  InstalledMapsDto,
  PlayerDto,
  PlayerUpgradeDto,
  RunStateDto,
  SaveSession,
} from "@/app/tauri/desktopContracts";

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
    { internalName: "Arctic", displayName: "McJannek Station", knownLabel: true, iconToken: null },
    { internalName: "Modded Moon", displayName: "Modded Moon", knownLabel: false, iconToken: null },
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
    canClearPresets: true,
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
