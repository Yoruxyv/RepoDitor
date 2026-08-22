// @vitest-environment node

import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { AssetPreparationService } = require("../../dist-electron/assets/preparation.cjs");

function final(overrides: Record<string, unknown> = {}) {
  return {
    type: "final",
    ok: true,
    installationFound: true,
    buildVerified: true,
    completed: null,
    total: null,
    degraded: false,
    ...overrides,
  };
}

function progress(
  stage: string,
  completed: number | null,
  total: number | null,
  currentAsset: string | null = null,
  currentAssetLabel: string | null = null,
) {
  return {
    type: "progress",
    stage,
    installationFound: stage !== "discovering",
    buildVerified: !["discovering", "validating"].includes(stage),
    completed,
    total,
    currentAsset,
    currentAssetLabel,
    degraded: false,
  };
}

function cache(initial: readonly string[] = []) {
  const prepared = new Set(initial);
  return {
    prepared,
    beginPreparation: vi.fn(),
    finishPreparation: vi.fn(),
    hasPrepared: vi.fn(async (key: string) => prepared.has(key)),
    storePrepared: vi.fn(async (key: string, value: unknown) => {
      if (value === null) return false;
      prepared.add(key);
      return true;
    }),
  };
}

function client(
  runRecords: (
    command: string,
    request: readonly string[],
    onRecord: (record: unknown) => Promise<void> | void,
  ) => Promise<unknown>,
) {
  return {
    run: vi.fn(),
    runRecords: vi.fn(runRecords),
    dispose: vi.fn(),
  };
}

describe("AssetPreparationService", () => {
  it("exposes only truthful startup discovery, validation, and ready states", async () => {
    const fakeCache = cache();
    const fakeClient = client(async (_command, request, onRecord) => {
      expect(request).toEqual([]);
      await onRecord(progress("discovering", null, null));
      await onRecord(progress("validating", null, null));
      return final();
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);
    const stages: string[] = [];
    service.subscribe((state: { stage: string }) => stages.push(state.stage));

    await service.prepareStartup();
    await service.prepareStartup();

    expect(stages).toEqual(["discovering", "validating", "ready"]);
    expect(fakeClient.runRecords).toHaveBeenCalledTimes(1);
    expect(service.getState()).toEqual({
      stage: "ready",
      installationFound: true,
      buildVerified: true,
      completed: null,
      total: null,
      currentAsset: null,
      currentAssetLabel: null,
      degraded: false,
    });
  });

  it("surfaces the actual texture currently being decoded", async () => {
    const fakeCache = cache();
    const fakeClient = client(async (_command, request, onRecord) => {
      const [key] = request;
      await onRecord(progress("decoding", 0, 1, "Upgrade_Health_Albedo", "Health"));
      await onRecord({
        type: "texture",
        upgradeKey: key,
        texture: { opaque: true },
        completed: 1,
        total: 1,
      });
      return final({ completed: 1, total: 1 });
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);
    const currentAssets: Array<string | null> = [];
    const currentAssetLabels: Array<string | null> = [];
    service.subscribe(
      (state: { currentAsset: string | null; currentAssetLabel: string | null }) => {
        currentAssets.push(state.currentAsset);
        currentAssetLabels.push(state.currentAssetLabel);
      },
    );

    await service.prepareUpgradeVisuals([{ upgradeKey: "playerUpgradeHealth", cacheKey: null }]);

    expect(fakeCache.storePrepared).toHaveBeenCalledTimes(1);
    expect(currentAssets).toContain("Upgrade_Health_Albedo");
    expect(currentAssetLabels).toContain("Health");
    expect(service.getState()).toMatchObject({
      currentAsset: null,
      currentAssetLabel: null,
      stage: "ready",
    });
  });

  it("reuses a degraded startup capability result without spawning a save batch", async () => {
    const fakeCache = cache();
    const fakeClient = client(async (_command, request) => {
      if (request.length === 0) {
        return final({
          installationFound: false,
          buildVerified: false,
          degraded: true,
        });
      }
      throw new Error("save-specific preparation must reuse the degraded startup result");
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);

    await service.prepareStartup();
    await service.prepareUpgradeVisuals([
      { upgradeKey: "playerUpgradeHealth", cacheKey: null },
      { upgradeKey: "playerUpgradeFuture", cacheKey: null },
    ]);

    expect(fakeClient.runRecords).toHaveBeenCalledTimes(1);
    expect(service.getState()).toEqual({
      stage: "degraded",
      installationFound: false,
      buildVerified: false,
      completed: 2,
      total: 2,
      currentAsset: null,
      currentAssetLabel: null,
      degraded: true,
    });
  });

  it("counts generated cache art and prepared session art before batching only missing keys", async () => {
    const fakeCache = cache(["playerUpgradePrepared"]);
    const fakeClient = client(async (_command, request, onRecord) => {
      const keys = [...request];
      expect(keys).toEqual(["playerUpgradeMissingA", "playerUpgradeMissingB"]);
      await onRecord(progress("resolving", 0, 2));
      await onRecord({
        type: "texture",
        upgradeKey: keys[0],
        texture: { opaque: "validated by cache boundary in production" },
        completed: 1,
        total: 2,
      });
      await onRecord({
        type: "texture",
        upgradeKey: keys[1],
        texture: { opaque: "validated by cache boundary in production" },
        completed: 2,
        total: 2,
      });
      return final({ completed: 2, total: 2 });
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);
    const states: Array<{ stage: string; completed: number | null; total: number | null }> = [];
    service.subscribe(
      (state: { stage: string; completed: number | null; total: number | null }) => {
        states.push({ stage: state.stage, completed: state.completed, total: state.total });
      },
    );

    await service.prepareUpgradeVisuals([
      { upgradeKey: "playerUpgradeCached", cacheKey: "item upgrade cached.png" },
      { upgradeKey: "playerUpgradePrepared", cacheKey: null },
      { upgradeKey: "playerUpgradeMissingA", cacheKey: null },
      { upgradeKey: "playerUpgradeMissingB", cacheKey: null },
    ]);

    expect(fakeClient.runRecords).toHaveBeenCalledTimes(1);
    expect(fakeCache.storePrepared).toHaveBeenCalledTimes(2);
    expect(states).toContainEqual({ stage: "resolving", completed: 2, total: 4 });
    expect(states).toContainEqual({ stage: "resolving", completed: 3, total: 4 });
    expect(service.getState()).toMatchObject({
      stage: "ready",
      completed: 4,
      total: 4,
      degraded: false,
    });
  });

  it("takes the zero-batch fast path when every dynamic visual has generated cache art", async () => {
    const fakeCache = cache();
    const fakeClient = client(async () => {
      throw new Error("generated cache hits must not start texture preparation");
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);

    await service.prepareUpgradeVisuals([
      { upgradeKey: "playerUpgradeHealth", cacheKey: "item upgrade player health.png" },
      { upgradeKey: "playerUpgradeStrength", cacheKey: "item upgrade player strength.png" },
    ]);

    expect(fakeClient.runRecords).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({
      stage: "ready",
      completed: 2,
      total: 2,
      degraded: false,
    });
  });

  it("reuses unchanged prepared visuals without restarting active preparation", async () => {
    const fakeCache = cache();
    const fakeClient = client(async (_command, request, onRecord) => {
      const [key] = request;
      await onRecord({
        type: "texture",
        upgradeKey: key,
        texture: { opaque: true },
        completed: 1,
        total: 1,
      });
      return final({ completed: 1, total: 1 });
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);
    const stages: string[] = [];
    service.subscribe((state: { stage: string }) => stages.push(state.stage));
    const visuals = [{ upgradeKey: "playerUpgradeHealth", cacheKey: null }];

    await service.prepareUpgradeVisuals(visuals);
    const afterFirstPreparation = stages.length;
    await service.prepareUpgradeVisuals(visuals);

    expect(fakeClient.runRecords).toHaveBeenCalledTimes(1);
    expect(stages.slice(afterFirstPreparation)).toEqual([]);
    expect(fakeCache.hasPrepared).toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ stage: "ready", completed: 1, total: 1 });

    await service.prepareUpgradeVisuals([{ upgradeKey: "playerUpgradeFuture", cacheKey: null }]);
    expect(fakeClient.runRecords).toHaveBeenCalledTimes(2);
  });

  it("preserves actual completed progress when a batch process fails mid-stream", async () => {
    const fakeCache = cache();
    const fakeClient = client(async (_command, request, onRecord) => {
      const keys = [...request];
      await onRecord({
        type: "texture",
        upgradeKey: keys[0],
        texture: { opaque: true },
        completed: 1,
        total: 3,
      });
      throw new Error("sidecar exited after one completed visual");
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);

    await service.prepareUpgradeVisuals([
      { upgradeKey: "playerUpgradeA", cacheKey: null },
      { upgradeKey: "playerUpgradeB", cacheKey: null },
      { upgradeKey: "playerUpgradeC", cacheKey: null },
    ]);

    expect(service.getState()).toMatchObject({
      stage: "degraded",
      completed: 1,
      total: 3,
      degraded: true,
    });
  });

  it("marks a partial texture failure degraded and does not repeatedly batch the same miss", async () => {
    const fakeCache = cache();
    const fakeClient = client(async (_command, request, onRecord) => {
      const keys = [...request];
      await onRecord({
        type: "texture",
        upgradeKey: keys[0],
        texture: { opaque: true },
        completed: 1,
        total: 2,
      });
      await onRecord({
        type: "texture",
        upgradeKey: keys[1],
        texture: null,
        completed: 2,
        total: 2,
      });
      return final({ completed: 2, total: 2, degraded: true });
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);
    const visuals = [
      { upgradeKey: "playerUpgradeHealth", cacheKey: null },
      { upgradeKey: "playerUpgradeFuture", cacheKey: null },
    ];

    await service.prepareUpgradeVisuals(visuals);
    expect(service.getState()).toMatchObject({
      stage: "degraded",
      completed: 2,
      total: 2,
      degraded: true,
    });
    await expect(
      service.checkUpgradeVisualReadiness(visuals.map((visual) => visual.upgradeKey)),
    ).resolves.toBe("unresolved");

    await service.prepareUpgradeVisuals(visuals);
    expect(fakeClient.runRecords).toHaveBeenCalledTimes(1);
    expect(service.getState()).toMatchObject({ completed: 2, total: 2 });
  });

  it.each([
    [false, false],
    [true, false],
  ])(
    "degrades safely when installation/build preparation ends unavailable",
    async (installationFound, buildVerified) => {
      const fakeCache = cache();
      const fakeClient = client(async () =>
        final({
          installationFound,
          buildVerified,
          completed: 2,
          total: 2,
          degraded: true,
        }),
      );
      const service = new AssetPreparationService(fakeClient, fakeCache);

      await service.prepareUpgradeVisuals([
        { upgradeKey: "playerUpgradeA", cacheKey: null },
        { upgradeKey: "playerUpgradeB", cacheKey: null },
      ]);

      expect(service.getState()).toEqual({
        stage: "degraded",
        installationFound,
        buildVerified,
        completed: 2,
        total: 2,
        currentAsset: null,
        currentAssetLabel: null,
        degraded: true,
      });
      expect(
        Object.keys(service.getState()).sort((left, right) => left.localeCompare(right)),
      ).toEqual([
        "buildVerified",
        "completed",
        "currentAsset",
        "currentAssetLabel",
        "degraded",
        "installationFound",
        "stage",
        "total",
      ]);
    },
  );

  it("deduplicates identical in-flight visual preparation in the same session", async () => {
    const fakeCache = cache();
    let release: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fakeClient = client(async (_command, request, onRecord) => {
      await hold;
      await onRecord({
        type: "texture",
        upgradeKey: request[0],
        texture: { opaque: true },
        completed: 1,
        total: 1,
      });
      return final({ completed: 1, total: 1 });
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);
    const visuals = [{ upgradeKey: "playerUpgradeHealth", cacheKey: null }];

    const first = service.prepareUpgradeVisuals(visuals);
    const second = service.prepareUpgradeVisuals(visuals);
    expect(first).toBe(second);
    expect(fakeClient.runRecords).toHaveBeenCalledTimes(0);

    release?.();
    await Promise.all([first, second]);
    expect(fakeClient.runRecords).toHaveBeenCalledTimes(1);
  });

  it("uses the actual dynamic request count rather than a fixed upgrade catalog", async () => {
    const fakeCache = cache();
    const fakeClient = client(async (_command, request, onRecord) => {
      const keys = [...request];
      for (const [index, key] of keys.entries()) {
        await onRecord({
          type: "texture",
          upgradeKey: key,
          texture: { opaque: true },
          completed: index + 1,
          total: keys.length,
        });
      }
      return final({ completed: keys.length, total: keys.length });
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);
    const visuals = Array.from({ length: 7 }, (_, index) => ({
      upgradeKey: `playerUpgradeDynamic${index}`,
      cacheKey: null,
    }));

    await service.prepareUpgradeVisuals(visuals);

    expect(service.getState()).toMatchObject({ completed: 7, total: 7, stage: "ready" });
    expect(fakeClient.runRecords.mock.calls[0]![1]).toHaveLength(7);
    expect(fakeClient.runRecords.mock.calls[0]![1]).toEqual(
      visuals.map((visual) => visual.upgradeKey),
    );
  });

  it("reports previously resolved source-valid visuals ready without another preparation batch", async () => {
    const fakeCache = cache();
    const fakeClient = client(async (_command, request, onRecord) => {
      await onRecord({
        type: "texture",
        upgradeKey: request[0],
        texture: { opaque: true },
        completed: 1,
        total: 1,
      });
      return final({ completed: 1, total: 1 });
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);
    const visuals = [
      { upgradeKey: "playerUpgradeCached", cacheKey: "item upgrade cached.png" },
      { upgradeKey: "playerUpgradeDynamic", cacheKey: null },
    ];

    await service.prepareUpgradeVisuals(visuals);
    expect(
      await service.checkUpgradeVisualReadiness(visuals.map((visual) => visual.upgradeKey)),
    ).toBe("ready");

    expect(fakeClient.runRecords).toHaveBeenCalledTimes(1);
    expect(fakeCache.hasPrepared).toHaveBeenLastCalledWith("playerUpgradeDynamic");
  });

  it("keeps valid cached visuals and prepares only a new requirement for another save", async () => {
    const fakeCache = cache();
    const requests: string[][] = [];
    const fakeClient = client(async (_command, request, onRecord) => {
      const keys = [...request];
      requests.push(keys);
      for (const [index, key] of keys.entries()) {
        await onRecord({
          type: "texture",
          upgradeKey: key,
          texture: { opaque: true },
          completed: index + 1,
          total: keys.length,
        });
      }
      return final({ completed: keys.length, total: keys.length });
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);
    const firstVisuals = ["A", "B", "C"].map((suffix) => ({
      upgradeKey: `playerUpgrade${suffix}`,
      cacheKey: null,
    }));
    const secondVisuals = [...firstVisuals, { upgradeKey: "playerUpgradeD", cacheKey: null }];

    await service.prepareUpgradeVisuals(firstVisuals);
    expect(
      await service.checkUpgradeVisualReadiness(secondVisuals.map((visual) => visual.upgradeKey)),
    ).toBe("unresolved");

    await service.prepareUpgradeVisuals(secondVisuals);

    expect(requests).toEqual([
      ["playerUpgradeA", "playerUpgradeB", "playerUpgradeC"],
      ["playerUpgradeD"],
    ]);
    expect(
      await service.checkUpgradeVisualReadiness(secondVisuals.map((visual) => visual.upgradeKey)),
    ).toBe("ready");
  });

  it("rejects an invalidated cached source and reprepares only the affected visual", async () => {
    const fakeCache = cache();
    const requests: string[][] = [];
    const fakeClient = client(async (_command, request, onRecord) => {
      const keys = [...request];
      requests.push(keys);
      for (const [index, key] of keys.entries()) {
        await onRecord({
          type: "texture",
          upgradeKey: key,
          texture: { opaque: true },
          completed: index + 1,
          total: keys.length,
        });
      }
      return final({ completed: keys.length, total: keys.length });
    });
    const service = new AssetPreparationService(fakeClient, fakeCache);
    const visuals = ["A", "B", "C"].map((suffix) => ({
      upgradeKey: `playerUpgrade${suffix}`,
      cacheKey: null,
    }));

    await service.prepareUpgradeVisuals(visuals);
    fakeCache.prepared.delete("playerUpgradeB");

    expect(
      await service.checkUpgradeVisualReadiness(visuals.map((visual) => visual.upgradeKey)),
    ).toBe("unresolved");
    await service.prepareUpgradeVisuals(visuals);

    expect(requests).toEqual([
      ["playerUpgradeA", "playerUpgradeB", "playerUpgradeC"],
      ["playerUpgradeB"],
    ]);
    expect(fakeCache.prepared.has("playerUpgradeA")).toBe(true);
    expect(fakeCache.prepared.has("playerUpgradeC")).toBe(true);
  });
});
