/** The preview's implemented desktop capabilities; no write or generic native API. */
import { invoke } from "@tauri-apps/api/core";
import type {
  AdvancedSaveDto,
  CosmeticsViewDto,
  DesktopOperationResult,
  GameProcessState,
  InstalledMapsDto,
  PlayerDto,
  PlayerUpgradeDto,
  RepoDitorApi,
  RunStateDto,
  SaveOpenResult,
} from "@electron/contracts";
import { tauriDiscoveryApi } from "@/features/discovery/tauriDiscoveryApi";

let gameRequest: Promise<DesktopOperationResult<GameProcessState>> | null = null;

export const tauriReadApi: {
  environment: RepoDitorApi["environment"];
  saves: Pick<RepoDitorApi["saves"], "open">;
  game: RepoDitorApi["game"];
  players: Pick<RepoDitorApi["players"], "list">;
  upgrades: Pick<RepoDitorApi["upgrades"], "list">;
  run: RepoDitorApi["run"];
  advanced: RepoDitorApi["advanced"];
  maps: RepoDitorApi["maps"];
  cosmetics: Pick<RepoDitorApi["cosmetics"], "get">;
} = {
  environment: tauriDiscoveryApi,
  cosmetics: {
    async get() {
      try {
        return await invoke<DesktopOperationResult<CosmeticsViewDto>>("cosmetics_get");
      } catch {
        return {
          ok: false,
          error: {
            code: "internal_error",
            message: "The desktop cosmetics bridge failed unexpectedly.",
          },
        };
      }
    },
  },
  maps: {
    async list() {
      try {
        return await invoke<DesktopOperationResult<InstalledMapsDto>>("maps_list");
      } catch {
        return {
          ok: false,
          error: {
            code: "internal_error",
            message: "The desktop maps bridge failed unexpectedly.",
          },
        };
      }
    },
  },
  advanced: {
    async get(saveId) {
      try {
        return await invoke<DesktopOperationResult<AdvancedSaveDto>>("advanced_get", { saveId });
      } catch {
        return {
          ok: false,
          error: {
            code: "internal_error",
            message: "The desktop advanced data bridge failed unexpectedly.",
          },
        };
      }
    },
  },
  run: {
    async get(saveId) {
      try {
        return await invoke<DesktopOperationResult<RunStateDto>>("run_get", { saveId });
      } catch {
        return {
          ok: false,
          error: { code: "internal_error", message: "The desktop run bridge failed unexpectedly." },
        };
      }
    },
  },
  upgrades: {
    async list(saveId) {
      try {
        return await invoke<DesktopOperationResult<PlayerUpgradeDto[]>>("upgrades_list", {
          saveId,
        });
      } catch {
        return {
          ok: false,
          error: {
            code: "internal_error",
            message: "The desktop upgrades bridge failed unexpectedly.",
          },
        };
      }
    },
  },
  players: {
    async list(saveId) {
      try {
        return await invoke<DesktopOperationResult<PlayerDto[]>>("players_list", { saveId });
      } catch {
        return {
          ok: false,
          error: {
            code: "internal_error",
            message: "The desktop player bridge failed unexpectedly.",
          },
        };
      }
    },
  },
  saves: {
    async open(saveId) {
      try {
        return await invoke<DesktopOperationResult<SaveOpenResult>>("saves_open", { saveId });
      } catch {
        return {
          ok: false,
          error: {
            code: "internal_error",
            message: "The desktop save bridge failed unexpectedly.",
          },
        };
      }
    },
  },
  game: {
    status() {
      gameRequest ??= invoke<DesktopOperationResult<GameProcessState>>("game_status")
        .catch((): DesktopOperationResult<GameProcessState> => ({
          ok: false,
          error: { code: "internal_error", message: "The game-status bridge failed unexpectedly." },
        }))
        .finally(() => {
          gameRequest = null;
        });
      return gameRequest;
    },
  },
};

export function closeTauriPreview(): Promise<void> {
  return invoke<void>("preview_close");
}
