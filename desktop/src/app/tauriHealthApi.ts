/** Narrow synthetic-only save transports; the native host owns authority. */
import { invoke } from "@tauri-apps/api/core";
import type {
  AdvancedSaveDto,
  PlayerDto,
  PlayerUpgradeDto,
  RunStateDto,
  RunStatDto,
  SaveOpenResult,
} from "@electron/contracts";

export interface HealthCanonical {
  opened: SaveOpenResult;
  players: PlayerDto[];
  upgrades?: PlayerUpgradeDto[];
  run?: RunStateDto | null;
  advanced?: AdvancedSaveDto | null;
}

export interface HealthValueIntent {
  playerId: string;
  health: number;
  before: number;
}
export interface HealthIntentEdit {
  playerId: string;
  before: number;
  value: number;
}
export interface UpgradeIntentEdit {
  playerId: string;
  key: string;
  before: number;
  value: number;
}
export interface RunIntentEdit {
  field: RunStatDto["key"] | "resumeLocation";
  before: number | string;
  value: number | string;
}
export interface RefillIntentEdit {
  saveKey: string;
  before: number;
}
export type HealthIntent =
  | HealthValueIntent
  | { health: HealthIntentEdit[] }
  | { upgrades: UpgradeIntentEdit[] }
  | { run: RunIntentEdit[] }
  | RefillIntent;
export type RefillIntent = { refillToFull: RefillIntentEdit[] };
export const REFILL_INTENT_LIMIT = 2048;
export function refillIntentFits(refillToFull: readonly RefillIntentEdit[]): boolean {
  return (
    refillToFull.length > 0 &&
    refillToFull.length <= 512 &&
    new TextEncoder().encode(JSON.stringify({ refillToFull })).length <= REFILL_INTENT_LIMIT
  );
}
export const HEALTH_INTENT_LIMIT = 2048;
export function healthIntentFits(health: readonly HealthIntentEdit[]): boolean {
  return (
    health.length > 0 &&
    health.length <= 512 &&
    new TextEncoder().encode(JSON.stringify({ health })).length <= HEALTH_INTENT_LIMIT
  );
}
export const RUN_INTENT_LIMIT = 512;
export function runIntentFits(run: readonly RunIntentEdit[]): boolean {
  return (
    run.length > 0 &&
    run.length <= 5 &&
    new TextEncoder().encode(JSON.stringify({ run })).length <= RUN_INTENT_LIMIT
  );
}
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
export interface HealthBatchWrite {
  saveId: string;
  fingerprint: string;
  operationId: string;
  session: string;
  health: HealthIntentEdit[];
}
export interface RunWrite {
  saveId: string;
  fingerprint: string;
  operationId: string;
  session: string;
  run: RunIntentEdit[];
}
export interface RefillWrite {
  saveId: string;
  fingerprint: string;
  operationId: string;
  session: string;
  refillToFull: RefillIntentEdit[];
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
  async writeRefills(request: RefillWrite): Promise<HealthTransaction> {
    try {
      return await invoke<HealthTransaction>("test_items_refill", { request });
    } catch {
      return unresolved(request.operationId, "uncertain");
    }
  },
  async writeHealthBatch(request: HealthBatchWrite): Promise<HealthTransaction> {
    try {
      return await invoke<HealthTransaction>("test_health_write", { request });
    } catch {
      return unresolved(request.operationId, "uncertain");
    }
  },
  async writeRun(request: RunWrite): Promise<HealthTransaction> {
    try {
      return await invoke<HealthTransaction>("test_run_write", { request });
    } catch {
      return unresolved(request.operationId, "uncertain");
    }
  },
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
