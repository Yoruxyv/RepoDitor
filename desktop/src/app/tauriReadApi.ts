/** The preview's implemented desktop capabilities; no write or generic native API. */
import { invoke } from "@tauri-apps/api/core";
import type {
  AdvancedSaveDto,
  CosmeticsViewDto,
  DesktopOperationResult,
  GameProcessState,
  InstalledMapsDto,
  PlayerDto,
  PlayerAvatar,
  PlayerUpgradeDto,
  RepoDitorApi,
  RunStateDto,
  SaveOpenResult,
} from "@electron/contracts";
import { tauriDiscoveryApi } from "@/features/discovery/tauriDiscoveryApi";

let gameRequest: Promise<DesktopOperationResult<GameProcessState>> | null = null;

export type NativeInstalledMaps = InstalledMapsDto & {
  readonly entryArtworkRevision?: string;
  readonly entrySaveVerified?: boolean;
};
type SaveProof = Pick<SaveOpenResult["session"], "id" | "fingerprint">;
export type NativeSaveOpenResult = SaveOpenResult & { readonly supportsEntryBatch?: boolean };
type NativeEditorEntry = {
  players: DesktopOperationResult<PlayerDto[]>;
  upgrades: DesktopOperationResult<PlayerUpgradeDto[]>;
  run: DesktopOperationResult<RunStateDto>;
  items: DesktopOperationResult<AdvancedSaveDto>;
  maps: DesktopOperationResult<NativeInstalledMaps>;
};

type EntryRead<T> = (
  saveId: string,
  prepareFingerprint?: string,
) => Promise<DesktopOperationResult<T>>;

async function readUpgrades(
  saveId: string,
  background = false,
  prepareFingerprint?: string,
): Promise<DesktopOperationResult<PlayerUpgradeDto[]>> {
  try {
    return await invoke<DesktopOperationResult<PlayerUpgradeDto[]>>("upgrades_list", {
      saveId,
      ...(background ? { background: true } : {}),
      prepareFingerprint,
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
}

export const tauriReadApi: {
  environment: RepoDitorApi["environment"];
  saves: {
    open: (
      saveId: string,
      verifyFingerprint?: string,
    ) => Promise<DesktopOperationResult<NativeSaveOpenResult>>;
    prepareEntry: (save: SaveProof) => Promise<DesktopOperationResult<NativeEditorEntry>>;
  };
  game: RepoDitorApi["game"];
  players: { list: EntryRead<PlayerDto[]>; avatar: RepoDitorApi["players"]["avatar"] };
  upgrades: { list: EntryRead<PlayerUpgradeDto[]>; prepare: RepoDitorApi["upgrades"]["list"] };
  run: { get: EntryRead<RunStateDto> };
  advanced: {
    get: (
      saveId: string,
      prepareFingerprint?: string,
      background?: boolean,
    ) => Promise<DesktopOperationResult<AdvancedSaveDto>>;
  };
  maps: {
    list: (
      proof?: "entry" | "verify",
      save?: SaveProof,
    ) => Promise<DesktopOperationResult<NativeInstalledMaps>>;
  };
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
    async list(proof, save) {
      try {
        return await invoke<DesktopOperationResult<NativeInstalledMaps>>("maps_list", {
          entryProof: proof !== undefined,
          validateOnly: proof === "verify",
          verifySaveId: save?.id,
          verifyFingerprint: save?.fingerprint,
        });
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
    async get(saveId, prepareFingerprint, background) {
      try {
        return await invoke<DesktopOperationResult<AdvancedSaveDto>>("advanced_get", {
          saveId,
          prepareFingerprint,
          ...(background ? { background: true } : {}),
        });
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
    async get(saveId, prepareFingerprint) {
      try {
        return await invoke<DesktopOperationResult<RunStateDto>>("run_get", {
          saveId,
          prepareFingerprint,
        });
      } catch {
        return {
          ok: false,
          error: { code: "internal_error", message: "The desktop run bridge failed unexpectedly." },
        };
      }
    },
  },
  upgrades: {
    list: (saveId, prepareFingerprint) =>
      readUpgrades(saveId, prepareFingerprint !== undefined, prepareFingerprint),
    prepare: (saveId) => readUpgrades(saveId, true),
  },
  players: {
    async avatar(saveId, playerId) {
      try {
        return await invoke<DesktopOperationResult<PlayerAvatar>>("players_avatar", {
          saveId,
          playerId,
        });
      } catch {
        return {
          ok: false,
          error: {
            code: "internal_error",
            message: "The desktop avatar bridge failed unexpectedly.",
          },
        };
      }
    },
    async list(saveId, prepareFingerprint) {
      try {
        return await invoke<DesktopOperationResult<PlayerDto[]>>("players_list", {
          saveId,
          prepareFingerprint,
        });
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
    async prepareEntry({ id, fingerprint }) {
      try {
        return await invoke<DesktopOperationResult<NativeEditorEntry>>("editor_entry", {
          saveId: id,
          fingerprint,
        });
      } catch {
        return {
          ok: false,
          error: {
            code: "internal_error",
            message: "The desktop editor preparation bridge failed unexpectedly.",
          },
        };
      }
    },
    async open(saveId, verifyFingerprint) {
      try {
        return await invoke<DesktopOperationResult<NativeSaveOpenResult>>("saves_open", {
          saveId,
          verifyFingerprint,
        });
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
