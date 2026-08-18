import { BrowserWindow, ipcMain } from "electron";

import { IPC_CHANNELS } from "../channels.cjs";
import type { AssetPreparationStage, AssetPreparationState } from "../contracts.cjs";
import { decodedUpgradeTextureCache, type DecodedUpgradeTextureCache } from "../icons/protocol.cjs";
import { pythonClient, type PythonRecordClient } from "../python/client.cjs";

const PREPARATION_STAGES = new Set<AssetPreparationStage>([
  "discovering",
  "validating",
  "indexing",
  "resolving",
  "decoding",
]);

const INITIAL_STATE: AssetPreparationState = {
  stage: "idle",
  installationFound: false,
  buildVerified: false,
  completed: null,
  total: null,
  degraded: false,
};

export interface UpgradeVisualPreparationRequest {
  readonly upgradeKey: string;
  readonly cacheKey: string | null;
}

interface ProgressRecord {
  readonly type: "progress";
  readonly stage: Exclude<AssetPreparationStage, "idle" | "ready" | "degraded">;
  readonly installationFound: boolean;
  readonly buildVerified: boolean;
  readonly completed: number | null;
  readonly total: number | null;
  readonly degraded: boolean;
}

interface TextureRecord {
  readonly type: "texture";
  readonly upgradeKey: string;
  readonly texture: unknown;
  readonly completed: number;
  readonly total: number;
}

interface FinalRecord {
  readonly type: "final";
  readonly ok: boolean;
  readonly installationFound: boolean;
  readonly buildVerified: boolean;
  readonly completed: number | null;
  readonly total: number | null;
  readonly degraded: boolean;
}

type PreparationRecord = ProgressRecord | TextureRecord;

interface BatchContext {
  readonly upgradeKeys: readonly string[];
  readonly completedOffset: number;
  readonly overallTotal: number | null;
  readonly requested: ReadonlySet<string>;
  readonly reported: Set<string>;
  localFailure: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCount(value: unknown, nullable: boolean): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid asset preparation count.");
  }
  return value;
}

function parseProgress(value: Record<string, unknown>): ProgressRecord {
  const stage = value.stage;
  if (
    typeof stage !== "string" ||
    !PREPARATION_STAGES.has(stage as AssetPreparationStage) ||
    typeof value.installationFound !== "boolean" ||
    typeof value.buildVerified !== "boolean" ||
    typeof value.degraded !== "boolean"
  ) {
    throw new Error("Invalid asset preparation progress record.");
  }
  const completed = readCount(value.completed, true);
  const total = readCount(value.total, true);
  if (
    (completed === null) !== (total === null) ||
    (completed !== null && total !== null && completed > total)
  ) {
    throw new Error("Invalid asset preparation progress counts.");
  }
  return {
    type: "progress",
    stage: stage as ProgressRecord["stage"],
    installationFound: value.installationFound,
    buildVerified: value.buildVerified,
    completed,
    total,
    degraded: value.degraded,
  };
}

function parseTexture(value: Record<string, unknown>): TextureRecord {
  if (typeof value.upgradeKey !== "string") {
    throw new Error("Invalid asset preparation texture record.");
  }
  const completed = readCount(value.completed, false)!;
  const total = readCount(value.total, false)!;
  if (completed > total) throw new Error("Invalid asset preparation texture counts.");
  return {
    type: "texture",
    upgradeKey: value.upgradeKey,
    texture: value.texture,
    completed,
    total,
  };
}

function parseRecord(value: unknown): PreparationRecord {
  if (!isRecord(value)) throw new Error("Invalid asset preparation record.");
  if (value.type === "progress") return parseProgress(value);
  if (value.type === "texture") return parseTexture(value);
  throw new Error("Unexpected asset preparation record.");
}

function parseFinal(value: unknown): FinalRecord {
  if (
    !isRecord(value) ||
    value.type !== "final" ||
    typeof value.ok !== "boolean" ||
    typeof value.installationFound !== "boolean" ||
    typeof value.buildVerified !== "boolean" ||
    typeof value.degraded !== "boolean"
  ) {
    throw new Error("Invalid asset preparation final record.");
  }
  const completed = readCount(value.completed, true);
  const total = readCount(value.total, true);
  if (
    (completed === null) !== (total === null) ||
    (completed !== null && total !== null && completed > total)
  ) {
    throw new Error("Invalid asset preparation final counts.");
  }
  return {
    type: "final",
    ok: value.ok,
    installationFound: value.installationFound,
    buildVerified: value.buildVerified,
    completed,
    total,
    degraded: value.degraded,
  };
}

function readProgressCompleted(
  record: ProgressRecord,
  batchTotal: number,
  overallTotal: number | null,
): number | null {
  if (overallTotal === null) {
    if (record.completed !== null || record.total !== null) {
      throw new Error("Asset preparation returned inconsistent progress counts.");
    }
    return null;
  }
  if (record.completed === null || record.total !== batchTotal) {
    throw new Error("Asset preparation returned inconsistent progress counts.");
  }
  return record.completed;
}

function validateFinalCounts(
  record: FinalRecord,
  batchTotal: number,
  overallTotal: number | null,
): void {
  if (overallTotal === null) {
    if (record.completed !== null || record.total !== null) {
      throw new Error("Asset preparation returned inconsistent final counts.");
    }
    return;
  }
  if (record.completed !== batchTotal || record.total !== batchTotal) {
    throw new Error("Asset preparation returned inconsistent final counts.");
  }
}

export class AssetPreparationService {
  readonly #listeners = new Set<(state: AssetPreparationState) => void>();
  readonly #failedUpgradeKeys = new Set<string>();
  readonly #client: PythonRecordClient;
  readonly #cache: DecodedUpgradeTextureCache;
  #state: AssetPreparationState = INITIAL_STATE;
  #startup: Promise<void> | null = null;
  #visualTail: Promise<void> = Promise.resolve();
  readonly #visualInFlight = new Map<string, Promise<void>>();

  constructor(client: PythonRecordClient, cache: DecodedUpgradeTextureCache) {
    this.#client = client;
    this.#cache = cache;
  }

  getState(): AssetPreparationState {
    return this.#state;
  }

  subscribe(listener: (state: AssetPreparationState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async prepareStartup(): Promise<void> {
    if (this.#startup !== null) return this.#startup;
    this.#startup = this.#prepare([], 0, null);
    return this.#startup;
  }

  prepareUpgradeVisuals(requests: readonly UpgradeVisualPreparationRequest[]): Promise<void> {
    const unique = new Map<string, UpgradeVisualPreparationRequest>();
    for (const request of requests) unique.set(request.upgradeKey, request);
    const visuals = [...unique.values()];
    const signature = JSON.stringify(visuals);
    const existing = this.#visualInFlight.get(signature);
    if (existing !== undefined) return existing;

    const preparedKeys = visuals
      .filter((visual) => visual.cacheKey === null)
      .map((visual) => visual.upgradeKey);
    this.#cache.beginPreparation(preparedKeys);
    const task = this.#visualTail.then(async () => {
      try {
        if (this.#startup !== null) await this.#startup;
        await this.#prepareUpgradeVisualsNow(visuals);
      } catch {
        this.#set({
          ...this.#state,
          stage: "degraded",
          degraded: true,
        });
      } finally {
        for (const key of preparedKeys) this.#cache.finishPreparation(key);
      }
    });
    this.#visualInFlight.set(signature, task);
    this.#visualTail = task.then(
      () => undefined,
      () => undefined,
    );
    void task.then(
      () => this.#visualInFlight.delete(signature),
      () => this.#visualInFlight.delete(signature),
    );
    return task;
  }

  #summarizeKnownVisuals(visuals: readonly UpgradeVisualPreparationRequest[]): {
    completed: number;
    knownFailure: boolean;
  } {
    let completed = 0;
    let knownFailure = false;
    for (const visual of visuals) {
      if (visual.cacheKey !== null) {
        completed += 1;
      } else if (this.#failedUpgradeKeys.has(visual.upgradeKey)) {
        completed += 1;
        knownFailure = true;
      }
    }
    return { completed, knownFailure };
  }

  async #rememberUnavailableVisuals(
    visuals: readonly UpgradeVisualPreparationRequest[],
  ): Promise<void> {
    for (const visual of visuals) {
      if (
        visual.cacheKey !== null ||
        this.#failedUpgradeKeys.has(visual.upgradeKey) ||
        (await this.#cache.hasPrepared(visual.upgradeKey))
      ) {
        continue;
      }
      this.#failedUpgradeKeys.add(visual.upgradeKey);
    }
  }

  async #findMissingVisuals(
    visuals: readonly UpgradeVisualPreparationRequest[],
    initialCompleted: number,
  ): Promise<{ completed: number; missing: string[] }> {
    let completed = initialCompleted;
    const missing: string[] = [];
    for (const visual of visuals) {
      if (visual.cacheKey !== null || this.#failedUpgradeKeys.has(visual.upgradeKey)) {
        continue;
      }
      if (await this.#cache.hasPrepared(visual.upgradeKey)) {
        completed += 1;
      } else {
        missing.push(visual.upgradeKey);
      }
    }
    return { completed, missing };
  }

  async #prepareUpgradeVisualsNow(
    visuals: readonly UpgradeVisualPreparationRequest[],
  ): Promise<void> {
    const total = visuals.length;
    if (total === 0) {
      this.#finish(0, 0, false);
      return;
    }

    const installationUnavailable =
      this.#state.degraded && (!this.#state.installationFound || !this.#state.buildVerified);
    const { completed: initialCompleted, knownFailure } = this.#summarizeKnownVisuals(visuals);
    if (installationUnavailable) {
      await this.#rememberUnavailableVisuals(visuals);
      this.#finish(total, total, true);
      return;
    }

    const { completed, missing } = await this.#findMissingVisuals(visuals, initialCompleted);
    if (missing.length === 0) {
      const terminalStage = knownFailure ? "degraded" : "ready";
      if (
        this.#state.stage !== terminalStage ||
        this.#state.completed !== completed ||
        this.#state.total !== total ||
        this.#state.degraded !== knownFailure
      ) {
        this.#finish(completed, total, knownFailure);
      }
      return;
    }

    this.#set({
      ...this.#state,
      stage: "resolving",
      completed,
      total,
      degraded: knownFailure,
    });
    await this.#prepare(missing, completed, total, knownFailure);
  }

  async #prepare(
    upgradeKeys: readonly string[],
    completedOffset: number,
    overallTotal: number | null,
    existingDegraded = false,
  ): Promise<void> {
    const context: BatchContext = {
      upgradeKeys,
      completedOffset,
      overallTotal,
      requested: new Set(upgradeKeys),
      reported: new Set<string>(),
      localFailure: false,
    };
    try {
      const finalValue = await this.#client.runRecords("assets-prepare", upgradeKeys, (value) =>
        this.#handleRecord(value, context),
      );
      const final = parseFinal(finalValue);
      validateFinalCounts(final, upgradeKeys.length, overallTotal);
      const terminalDegraded =
        existingDegraded || !final.ok || final.degraded || context.localFailure;
      if (terminalDegraded) await this.#rememberBatchFailures(upgradeKeys);
      this.#set({
        stage: terminalDegraded ? "degraded" : "ready",
        installationFound: final.installationFound,
        buildVerified: final.buildVerified,
        completed: overallTotal,
        total: overallTotal,
        degraded: terminalDegraded,
      });
    } catch {
      for (const key of upgradeKeys) this.#failedUpgradeKeys.add(key);
      this.#set({
        ...this.#state,
        stage: "degraded",
        completed: overallTotal === null ? null : (this.#state.completed ?? completedOffset),
        total: overallTotal,
        degraded: true,
      });
    }
  }

  async #handleRecord(value: unknown, context: BatchContext): Promise<void> {
    const record = parseRecord(value);
    if (record.type === "progress") {
      const localCompleted = readProgressCompleted(
        record,
        context.upgradeKeys.length,
        context.overallTotal,
      );
      this.#set({
        stage: record.stage,
        installationFound: record.installationFound,
        buildVerified: record.buildVerified,
        completed: localCompleted === null ? null : context.completedOffset + localCompleted,
        total: context.overallTotal,
        degraded: record.degraded,
      });
      return;
    }

    if (
      !context.requested.has(record.upgradeKey) ||
      context.reported.has(record.upgradeKey) ||
      record.total !== context.upgradeKeys.length
    ) {
      throw new Error("Asset preparation returned an unexpected upgrade identity.");
    }
    context.reported.add(record.upgradeKey);
    const stored =
      record.texture !== null &&
      (await this.#cache.storePrepared(record.upgradeKey, record.texture));
    if (!stored) {
      context.localFailure = true;
      this.#failedUpgradeKeys.add(record.upgradeKey);
      this.#cache.finishPreparation(record.upgradeKey);
    }
    if (context.overallTotal !== null) {
      this.#set({
        ...this.#state,
        completed: Math.min(context.overallTotal, context.completedOffset + record.completed),
        total: context.overallTotal,
      });
    }
  }

  async #rememberBatchFailures(upgradeKeys: readonly string[]): Promise<void> {
    for (const key of upgradeKeys) {
      if (!(await this.#cache.hasPrepared(key))) this.#failedUpgradeKeys.add(key);
    }
  }

  #finish(completed: number, total: number, degraded: boolean): void {
    this.#set({
      ...this.#state,
      stage: degraded ? "degraded" : "ready",
      completed,
      total,
      degraded,
    });
  }

  #set(state: AssetPreparationState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
  }
}

export const assetPreparationService = new AssetPreparationService(
  pythonClient,
  decodedUpgradeTextureCache,
);

type IpcRegistrar = Pick<typeof ipcMain, "handle">;

export function registerAssetPreparationIpc(
  service: AssetPreparationService = assetPreparationService,
  registrar: IpcRegistrar = ipcMain,
): () => void {
  registrar.handle(IPC_CHANNELS.assetPreparationState, () => service.getState());
  return service.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.assetPreparationProgress, state);
      }
    }
  });
}
