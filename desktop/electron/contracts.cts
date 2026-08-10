export interface IpcChannelMap {
  environmentDetect: "environment:detect";
  savesList: "saves:list";
  savesOpen: "saves:open";
  savesWrite: "saves:write";
  playersList: "players:list";
  playersAvatar: "players:avatar";
  upgradesList: "upgrades:list";
  runGet: "run:get";
  advancedGet: "advanced:get";
  cosmeticsGet: "cosmetics:get";
  cosmeticsWrite: "cosmetics:write";
  mapsList: "maps:list";
}

export type SaveRootStatus =
  | "available"
  | "missing"
  | "unreadable";

export type GameDiscoveryStatus =
  | "found"
  | "steam_not_found"
  | "game_not_found"
  | "discovery_error";

export interface SaveSummary {
  id: string;
  name: string;
  path: string;
  modifiedAt: string;
  sizeBytes: number;
}

export interface SaveSession {
  id: string;
  name: string;
  path: string;
  modifiedAt: string;
  fingerprint: string;
  level: number;
  currency: number;
  playerCount: number;
  resumeLocation: string;
}

export interface PlayerDto {
  id: string;
  name: string;
  health: number;
  maxHealth: number;
}

export interface PlayerAvatar {
  playerId: string;
  avatarUrl: string | null;
}

export interface PlayerHealthChange {
  feature: "players";
  entity: string;
  field: "health";
  after: number;
}

export interface UpgradeValueChange {
  feature: "upgrades";
  entity: string;
  field: string;
  after: number;
}

export interface RunStatChange {
  feature: "run";
  entity: "run";
  field: "level" | "currency" | "lives" | "totalHaul";
  after: number;
}

export interface RunResumeChange {
  feature: "run";
  entity: "run";
  field: "resumeLocation";
  after: string;
}

export interface AdvancedRefillChange {
  feature: "advanced";
  entity: string;
  field: "refillToFull";
  after: true;
}

export type SaveChange =
  | PlayerHealthChange
  | UpgradeValueChange
  | RunStatChange
  | RunResumeChange
  | AdvancedRefillChange;

export interface SaveWriteResult {
  backupPath: string;
  session: SaveSession;
}

export interface PlayerUpgradeValueDto {
  playerId: string;
  value: number;
}

export interface PlayerUpgradeDto {
  key: string;
  label: string;
  known: boolean;
  values: PlayerUpgradeValueDto[];
}

export interface RunStatDto {
  key: "level" | "currency" | "lives" | "totalHaul";
  label: string;
  value: number;
}

export interface RunStateDto {
  stats: RunStatDto[];
  resumeLocation: {
    value: string;
    options: string[];
  };
}

export type AdvancedEvidenceStatus = "confirmed" | "partially_confirmed" | "unknown";

export type AdvancedDomainKey =
  | "items"
  | "currentCharge"
  | "batteryUpgrades"
  | "purchasedUpgrades"
  | "purchasedItems"
  | "purchasedItemsTotal"
  | "runMetadata";

export interface AdvancedCapabilitiesDto {
  canRead: boolean;
  canEdit: false;
  canAdd: false;
  canDelete: false;
  canDuplicate: false;
  canRefillToFull: boolean;
}

export interface AdvancedDomainDto {
  key: AdvancedDomainKey;
  label: string;
  status: AdvancedEvidenceStatus;
  entryCount: number | null;
  capabilities: AdvancedCapabilitiesDto;
}

export interface AdvancedItemDto {
  saveKey: string;
  name: string;
  instanceId: string;
  storedCharge: number | null;
}

export interface AdvancedRunValueDto {
  saveKey: "chargingStationCharge" | "chargingStationChargeTotal";
  label: string;
  value: number;
  status: AdvancedEvidenceStatus;
}

export interface AdvancedSaveDto {
  domains: AdvancedDomainDto[];
  items: AdvancedItemDto[];
  runValues: AdvancedRunValueDto[];
  unlinkedChargeEntryCount: number;
}

export interface CosmeticCapabilitiesDto {
  canReadCosmetics: boolean;
  canUnlockCosmetic: boolean;
  canUnlockAll: boolean;
  canRemoveOwnership: boolean;
}

export interface CosmeticDto {
  id: number;
  displayName: string;
  owned: boolean;
  known: boolean;
  removalBlockedReason: string | null;
}

export interface CosmeticsViewDto {
  fingerprint: string;
  knownCatalogCount: number;
  knownOwnedCount: number;
  knownLockedCount: number;
  savedPresetCount: number;
  unknownOwnedIds: number[];
  capabilities: CosmeticCapabilitiesDto;
  cosmetics: CosmeticDto[];
}

export interface CosmeticOwnershipChange {
  feature: "cosmetics";
  entity: string;
  field: "owned";
  after: boolean;
}

export interface CosmeticUnlockAllChange {
  feature: "cosmetics";
  entity: "known";
  field: "unlockAll";
  after: true;
}

export interface CosmeticLockAllChange {
  feature: "cosmetics";
  entity: "known";
  field: "lockAll";
  after: false;
}

export type CosmeticChange =
  | CosmeticOwnershipChange
  | CosmeticUnlockAllChange
  | CosmeticLockAllChange;

export interface CosmeticsWriteResult {
  backupPath: string;
  cosmetics: CosmeticsViewDto;
}

export interface InstalledMapDto {
  internalName: string;
  displayName: string;
  knownLabel: boolean;
}

export interface InstalledMapsDto {
  available: boolean;
  catalogPath: string | null;
  maps: InstalledMapDto[];
}

export interface EnvironmentDiscovery {
  saveRoot: string;
  saveRootStatus: SaveRootStatus;
  saveRootDetected: boolean;
  gameRoot: string | null;
  gameStatus: GameDiscoveryStatus;
  gameDetected: boolean;
  saves: SaveSummary[];
}

export type DesktopOperationErrorCode =
  | "python_unavailable"
  | "process_failed"
  | "process_timeout"
  | "empty_response"
  | "malformed_response"
  | "invalid_response"
  | "invalid_request"
  | "save_missing"
  | "meta_missing"
  | "save_corrupt"
  | "save_decrypt_failed"
  | "save_unsupported"
  | "save_stale"
  | "save_validation_failed"
  | "backup_failed"
  | "save_write_failed"
  | "save_verification_failed"
  | "backend_unavailable"
  | "internal_error";

export interface DesktopOperationError {
  code: DesktopOperationErrorCode;
  message: string;
}

export interface DesktopOperationSuccess<T> {
  ok: true;
  data: T;
}

export interface DesktopOperationFailure {
  ok: false;
  error: DesktopOperationError;
}

export type DesktopOperationResult<T> =
  | DesktopOperationSuccess<T>
  | DesktopOperationFailure;

export interface RepoDitorApi {
  environment: {
    detect: () => Promise<
      DesktopOperationResult<EnvironmentDiscovery>
    >;
  };
  saves: {
    list: () => Promise<
      DesktopOperationResult<SaveSummary[]>
    >;
    open: (
      saveId: string,
    ) => Promise<
      DesktopOperationResult<SaveSession>
    >;
    write: (
      saveId: string,
      fingerprint: string,
      changes: SaveChange[],
    ) => Promise<
      DesktopOperationResult<SaveWriteResult>
    >;
  };
  players: {
    list: (
      saveId: string,
    ) => Promise<
      DesktopOperationResult<PlayerDto[]>
    >;
    avatar: (
      saveId: string,
      playerId: string,
    ) => Promise<
      DesktopOperationResult<PlayerAvatar>
    >;
  };
  upgrades: {
    list: (
      saveId: string,
    ) => Promise<
      DesktopOperationResult<PlayerUpgradeDto[]>
    >;
  };
  run: {
    get: (
      saveId: string,
    ) => Promise<
      DesktopOperationResult<RunStateDto>
    >;
  };
  advanced: {
    get: (
      saveId: string,
    ) => Promise<
      DesktopOperationResult<AdvancedSaveDto>
    >;
  };
  cosmetics: {
    get: () => Promise<
      DesktopOperationResult<CosmeticsViewDto>
    >;
    write: (
      fingerprint: string,
      changes: CosmeticChange[],
    ) => Promise<
      DesktopOperationResult<CosmeticsWriteResult>
    >;
  };
  maps: {
    list: () => Promise<
      DesktopOperationResult<InstalledMapsDto>
    >;
  };
}
