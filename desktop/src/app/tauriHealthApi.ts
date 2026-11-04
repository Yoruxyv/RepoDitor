/** Narrow synthetic-only health transport; the native host owns authority. */
import { invoke } from "@tauri-apps/api/core";
import type { PlayerDto, SaveOpenResult } from "@electron/contracts";

export interface HealthCanonical {
  opened: SaveOpenResult;
  players: PlayerDto[];
}

export interface HealthIntent {
  playerId: string;
  health: number;
  before: number;
}

export interface HealthState {
  enabled: boolean;
  state: "disabled" | "idle" | "pending" | "busy" | "blocked";
  pending: { operationId: string; fingerprint: string; intent: HealthIntent | null } | null;
  canonical: HealthCanonical | null;
}

export interface HealthTransaction {
  operationId: string;
  status: "rejected" | "uncertain" | "applied" | "unchanged" | "conflict" | "busy";
  fingerprint: string | null;
  backupAvailable: boolean;
  reason: string | null;
  canonical: HealthCanonical | null;
}

export interface HealthWrite {
  saveId: string;
  fingerprint: string;
  playerId: string;
  health: number;
  operationId: string;
}

function unresolved(operationId: string, status: "uncertain" | "conflict"): HealthTransaction {
  return {
    operationId,
    status,
    fingerprint: null,
    backupAvailable: false,
    reason: null,
    canonical: null,
  };
}

export const tauriHealthApi = {
  async state(saveId: string): Promise<HealthState> {
    try {
      const result = await invoke<HealthState>("test_health_state", { saveId });
      if (result?.enabled === true) return result;
    } catch {
      // A normal host has no synthetic health capability.
    }
    return { enabled: false, state: "disabled", pending: null, canonical: null };
  },
  async write(request: HealthWrite): Promise<HealthTransaction> {
    try {
      return await invoke<HealthTransaction>("test_health_write", { request });
    } catch {
      return unresolved(request.operationId, "uncertain");
    }
  },
  async recover(
    saveId: string,
    operationId: string,
    acknowledge = false,
  ): Promise<HealthTransaction> {
    try {
      return await invoke<HealthTransaction>("test_health_recover", {
        request: { saveId, operationId, acknowledge },
      });
    } catch {
      return unresolved(operationId, "conflict");
    }
  },
};
