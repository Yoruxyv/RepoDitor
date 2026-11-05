/** Narrow synthetic-only health transport; the native host owns authority. */
import { invoke } from "@tauri-apps/api/core";
import type { PlayerDto, PlayerUpgradeDto, SaveOpenResult } from "@electron/contracts";

export interface HealthCanonical {
  opened: SaveOpenResult;
  players: PlayerDto[];
  upgrades?: PlayerUpgradeDto[];
}

export interface HealthValueIntent {
  playerId: string;
  health: number;
  before: number;
}
export interface UpgradeIntentEdit {
  playerId: string;
  key: string;
  before: number;
  value: number;
}
export type HealthIntent = HealthValueIntent | { upgrades: UpgradeIntentEdit[] };
export const UPGRADE_INTENT_LIMIT = 2048;
export function upgradeIntentFits(upgrades: readonly UpgradeIntentEdit[]): boolean {
  return (
    upgrades.length > 0 &&
    new TextEncoder().encode(JSON.stringify({ upgrades })).length <= UPGRADE_INTENT_LIMIT
  );
}

export interface HealthState {
  enabled: boolean;
  state: "disabled" | "idle" | "pending" | "busy" | "blocked";
  pending: { operationId: string; fingerprint: string; intent: HealthIntent | null } | null;
  canonical: HealthCanonical | null;
  upgradeSession?: string | null;
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
export interface UpgradesWrite {
  saveId: string;
  fingerprint: string;
  operationId: string;
  session: string;
  upgrades: UpgradeIntentEdit[];
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
  async writeUpgrades(request: UpgradesWrite): Promise<HealthTransaction> {
    try {
      return await invoke<HealthTransaction>("test_upgrades_write", { request });
    } catch {
      return unresolved(request.operationId, "uncertain");
    }
  },
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
