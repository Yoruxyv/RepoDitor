export interface IpcChannelMap {
  environmentDetect: "environment:detect";
  savesList: "saves:list";
  savesOpen: "saves:open";
  playersList: "players:list";
  playersAvatar: "players:avatar";
  upgradesList: "upgrades:list";
  runGet: "run:get";
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
  level: number;
  currency: number;
  playerCount: number;
  resumeLocation: string;
}

export interface PlayerDto {
  id: string;
  name: string;
  health: number;
}

export interface PlayerAvatar {
  playerId: string;
  avatarUrl: string | null;
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
  | "save_corrupt"
  | "save_decrypt_failed"
  | "save_unsupported"
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
  maps: {
    list: () => Promise<
      DesktopOperationResult<InstalledMapsDto>
    >;
  };
}
