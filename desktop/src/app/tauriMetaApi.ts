/** Fixed MetaSave endpoints; authority is separate from Run-save sessions. */
import { invoke } from "@tauri-apps/api/core";
import type { CosmeticsViewDto } from "@/app/desktopContracts";

export type MetaAction =
  | { action: "unlockIds"; admission: string; ids: number[] }
  | { action: "unlockAll" | "lockAll" | "clearPresets"; admission: string };
export interface MetaIntent {
  metaCosmetics: MetaAction;
}
export interface MetaState {
  production?: boolean;
  sourcePath?: string;
  state: "disabled" | "idle" | "pending" | "busy" | "blocked";
  view: CosmeticsViewDto | null;
  admission: { manifest: string; identity: string; build: string; digest: string } | null;
  namespace: string | null;
  session: string | null;
  recoverySession: string | null;
  pending: {
    operationId: string;
    fingerprint: string;
    status: "applied" | "unchanged";
    backupAvailable: boolean;
    intent: MetaIntent | null;
  } | null;
}
export interface MetaResult {
  operationId: string;
  status: "rejected" | "uncertain" | "applied" | "unchanged" | "conflict" | "busy";
  view: CosmeticsViewDto | null;
  fingerprint: string | null;
  backupAvailable: boolean;
  reason: string | null;
  fresh?: MetaState;
  recoverySession?: string;
}
export interface MetaWrite {
  operationId: string;
  fingerprint: string;
  session: string;
  intent: MetaIntent;
}
export const disabledMeta = (): MetaState => ({
  state: "disabled",
  view: null,
  admission: null,
  namespace: null,
  session: null,
  recoverySession: null,
  pending: null,
});
const failed = (operationId: string, status: "uncertain" | "conflict"): MetaResult => ({
  operationId,
  status,
  view: null,
  fingerprint: null,
  backupAvailable: false,
  reason: null,
});
export const tauriMetaApi = {
  async state(operationId?: string): Promise<MetaState> {
    const request = operationId ? { operationId } : {};
    try {
      const result = await invoke<MetaState>("test_meta_state", { request });
      if (result.state !== "disabled") return result;
    } catch {
      // This build may have only production authority.
    }
    try {
      const result = await invoke<MetaState>("production_meta_state", { request });
      return result.state === "disabled" ? result : { ...result, production: true };
    } catch {
      return disabledMeta();
    }
  },
  async write(request: MetaWrite, production = false): Promise<MetaResult> {
    try {
      return await invoke<MetaResult>(production ? "production_meta_write" : "test_meta_write", {
        request,
      });
    } catch {
      return failed(request.operationId, "uncertain");
    }
  },
  async recover(operationId: string, session: string, production = false): Promise<MetaResult> {
    try {
      return await invoke<MetaResult>(
        production ? "production_meta_recover" : "test_meta_recover",
        { request: { operationId, session } },
      );
    } catch {
      return failed(operationId, "conflict");
    }
  },
  async close(): Promise<void> {
    await invoke("production_meta_close").catch(() => {});
  },
};
export function metaIntentFits(intent: MetaIntent): boolean {
  const action = intent.metaCosmetics;
  return (
    (action.action !== "unlockIds" || (action.ids.length > 0 && action.ids.length <= 512)) &&
    new TextEncoder().encode(JSON.stringify(intent)).length <= 2048
  );
}
