export interface IpcChannelMap {
  environmentDetect: "environment:detect";
  projectMetadata: "project:metadata";
  gameStatus: "game:status";
  assetPreparationState: "assets:state";
  assetPreparationProgress: "assets:progress";
  savesList: "saves:list";
  savesOpen: "saves:open";
  savesWrite: "saves:write";
  playersList: "players:list";
  playersAvatar: "players:avatar";
  upgradesList: "upgrades:list";
  upgradesPrepareEntry: "upgrades:prepare-entry";
  runGet: "run:get";
  advancedGet: "advanced:get";
  cosmeticsGet: "cosmetics:get";
  cosmeticsWrite: "cosmetics:write";
  mapsList: "maps:list";
}

export type SaveRootStatus = "available" | "missing" | "unreadable" | "unavailable";

export type GameProcessStatus = "running" | "not_running" | "unknown";

export interface GameProcessState {
  status: GameProcessStatus;
  running: boolean;
}

export type AssetPreparationStage =
  | "idle"
  | "discovering"
  | "validating"
  | "indexing"
  | "resolving"
  | "decoding"
  | "ready"
  | "degraded";

export interface AssetPreparationState {
  stage: AssetPreparationStage;
  installationFound: boolean;
  buildVerified: boolean;
  completed: number | null;
  total: number | null;
  currentAsset: string | null;
  degraded: boolean;
}

export interface ProjectMetadata {
  stars: number;
}

export type GameDiscoveryStatus =
  "found" | "steam_not_found" | "game_not_found" | "discovery_error";

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

export type SavePresentationReadiness = "ready" | "unresolved";

export interface SaveOpenResult {
  session: SaveSession;
  requiredUpgradeVisualKeys: string[];
  presentationReadiness: SavePresentationReadiness;
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
  PlayerHealthChange | UpgradeValueChange | RunStatChange | RunResumeChange | AdvancedRefillChange;

export interface SaveCanonicalPlayerValue {
  id: string;
  health: number;
}

export interface SaveCanonicalUpgradeValue {
  playerId: string;
  key: string;
  value: number;
}

export type SaveCanonicalRunStatKey = "level" | "currency" | "lives" | "totalHaul";

export interface SaveCanonicalRunStatValue {
  key: SaveCanonicalRunStatKey;
  value: number;
}

export interface SaveCanonicalRun {
  stats: SaveCanonicalRunStatValue[];
  resumeLocation?: string;
}

export interface SaveCanonicalAdvancedItem {
  saveKey: string;
  storedCharge: number | null;
  chargeState: AdvancedItemChargeState;
  rechargeCapability: AdvancedItemRechargeCapability;
  canRefillToFull: boolean;
}

export interface SaveCanonicalAdvanced {
  items: SaveCanonicalAdvancedItem[];
  currentChargeEntryCount: number;
}

export interface SaveCanonicalResult {
  fingerprint: string;
  players?: SaveCanonicalPlayerValue[];
  upgrades?: SaveCanonicalUpgradeValue[];
  run?: SaveCanonicalRun;
  advanced?: SaveCanonicalAdvanced;
}

export interface SaveWriteResult {
  backupPath: string;
  session: SaveSession;
  canonical?: SaveCanonicalResult;
}

export interface PlayerUpgradeValueDto {
  playerId: string;
  value: number;
}

export interface PlayerUpgradeDto {
  key: string;
  label: string;
  presentationSource: "installed" | "alias" | "humanized";
  gameplayCap: number | null;
  iconToken: string | null;
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
  | "purchasedItemsTotal";

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

export type AdvancedItemChargeState = "stored" | "default_full" | "not_applicable" | "unknown";

export type AdvancedItemRechargeCapability = "rechargeable" | "not_rechargeable" | "unknown";

export interface AdvancedItemDto {
  saveKey: string;
  name: string;
  instanceId: string;
  isUpgrade: boolean;
  storedCharge: number | null;
  chargeState: AdvancedItemChargeState;
  rechargeCapability: AdvancedItemRechargeCapability;
  canRefillToFull: boolean;
  iconToken: string | null;
}

export interface AdvancedSaveDto {
  domains: AdvancedDomainDto[];
  items: AdvancedItemDto[];
  unlinkedChargeEntryCount: number;
}

export interface CosmeticCapabilitiesDto {
  canReadCosmetics: boolean;
  canUnlockCosmetic: boolean;
  canUnlockAll: boolean;
  canRemoveOwnership: boolean;
}

export type CosmeticState = "owned" | "locked" | "unknown";

export interface CosmeticDto {
  id: number;
  displayName: string;
  type: number | null;
  rarity: number | null;
  status: number | null;
  owned: boolean;
  known: boolean;
  state: CosmeticState;
  mutationEligible: boolean;
  removalBlockedReason: string | null;
  iconToken: string | null;
}

export interface CosmeticsViewDto {
  fingerprint: string;
  catalogAvailable: boolean;
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

export interface CosmeticClearAllPresetsChange {
  feature: "cosmetics";
  entity: "presets";
  field: "clearAll";
  after: true;
}

export type CosmeticChange =
  | CosmeticOwnershipChange
  | CosmeticUnlockAllChange
  | CosmeticLockAllChange
  | CosmeticClearAllPresetsChange;

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
  saveRoot: string | null;
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
  | "game_running"
  | "game_status_unknown"
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

export type DesktopOperationResult<T> = DesktopOperationSuccess<T> | DesktopOperationFailure;

export interface RepoDitorApi {
  project: {
    metadata: () => Promise<DesktopOperationResult<ProjectMetadata>>;
  };
  environment: {
    detect: () => Promise<DesktopOperationResult<EnvironmentDiscovery>>;
  };
  game: {
    status: () => Promise<DesktopOperationResult<GameProcessState>>;
  };
  assets: {
    state: () => Promise<AssetPreparationState>;
    onState: (listener: (state: AssetPreparationState) => void) => () => void;
  };
  saves: {
    list: () => Promise<DesktopOperationResult<SaveSummary[]>>;
    open: (saveId: string) => Promise<DesktopOperationResult<SaveOpenResult>>;
    write: (
      saveId: string,
      fingerprint: string,
      changes: SaveChange[],
    ) => Promise<DesktopOperationResult<SaveWriteResult>>;
  };
  players: {
    list: (saveId: string) => Promise<DesktopOperationResult<PlayerDto[]>>;
    avatar: (saveId: string, playerId: string) => Promise<DesktopOperationResult<PlayerAvatar>>;
  };
  upgrades: {
    list: (saveId: string) => Promise<DesktopOperationResult<PlayerUpgradeDto[]>>;
    prepareEntry: (
      saveId: string,
      requiredVisualKeys: string[],
    ) => Promise<DesktopOperationResult<PlayerUpgradeDto[]>>;
  };
  run: {
    get: (saveId: string) => Promise<DesktopOperationResult<RunStateDto>>;
  };
  advanced: {
    get: (saveId: string) => Promise<DesktopOperationResult<AdvancedSaveDto>>;
  };
  cosmetics: {
    get: () => Promise<DesktopOperationResult<CosmeticsViewDto>>;
    write: (
      fingerprint: string,
      changes: CosmeticChange[],
    ) => Promise<DesktopOperationResult<CosmeticsWriteResult>>;
  };
  maps: {
    list: () => Promise<DesktopOperationResult<InstalledMapsDto>>;
  };
}
