export interface IpcChannelMap {
  environmentDetect: "environment:detect";
  savesList: "saves:list";
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
  };
}
