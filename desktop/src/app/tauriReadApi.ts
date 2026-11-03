/** The preview's implemented desktop capabilities; no write or generic native API. */
import { invoke } from "@tauri-apps/api/core";
import type {
  DesktopOperationResult,
  GameProcessState,
  RepoDitorApi,
  SaveOpenResult,
} from "@electron/contracts";
import { tauriDiscoveryApi } from "@/features/discovery/tauriDiscoveryApi";

let gameRequest: Promise<DesktopOperationResult<GameProcessState>> | null = null;

export const tauriReadApi: {
  environment: RepoDitorApi["environment"];
  saves: Pick<RepoDitorApi["saves"], "open">;
  game: RepoDitorApi["game"];
} = {
  environment: tauriDiscoveryApi,
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
