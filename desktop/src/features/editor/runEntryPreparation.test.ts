import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopOperationResult, RepoDitorApi } from "@electron/contracts";
import {
  advanced,
  createRepoDitorApi,
  maps,
  players,
  readyAssets,
  runState,
  saveId,
  upgrades,
} from "@/test/repoditorApiFixture";
import {
  prepareRunEntryData,
  type RunEntryData,
  type RunEntryProgress,
} from "./runEntryPreparation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("prepareRunEntryData progress", () => {
  beforeEach(() => {
    window.repoditor = createRepoDitorApi(vi.fn(), players);
  });

  it("settles domain reads without starting or waiting for optional avatars", async () => {
    const playerLoad = deferred<Awaited<ReturnType<RepoDitorApi["players"]["list"]>>>();
    const avatarLoad = deferred<Awaited<ReturnType<RepoDitorApi["players"]["avatar"]>>>();
    const upgradeLoad = deferred<Awaited<ReturnType<RepoDitorApi["upgrades"]["list"]>>>();
    const runLoad = deferred<Awaited<ReturnType<RepoDitorApi["run"]["get"]>>>();
    const itemLoad = deferred<Awaited<ReturnType<RepoDitorApi["advanced"]["get"]>>>();
    const mapLoad = deferred<Awaited<ReturnType<RepoDitorApi["maps"]["list"]>>>();
    window.repoditor.players.list = vi.fn(() => playerLoad.promise);
    window.repoditor.players.avatar = vi.fn(() => avatarLoad.promise);
    window.repoditor.upgrades.list = vi.fn(() => upgradeLoad.promise);
    window.repoditor.run.get = vi.fn(() => runLoad.promise);
    window.repoditor.advanced.get = vi.fn(() => itemLoad.promise);
    const snapshots: RunEntryProgress[] = [];

    const preparation = prepareRunEntryData({
      saveId,
      requiredUpgradeVisualKeys: [],
      presentationReadiness: "ready",
      maps: () => mapLoad.promise,
      onProgressChange: (progress) => snapshots.push(progress),
    });

    expect(snapshots[0]).toMatchObject({ completed: 0, total: 5, currentTask: "items" });
    expect(snapshots.at(-1)).toMatchObject({
      completed: 0,
      total: 5,
      tasks: {
        items: "running",
        upgrades: "running",
        players: "running",
        run: "running",
        maps: "running",
      },
    });
    expect(window.repoditor.players.avatar).not.toHaveBeenCalled();

    playerLoad.resolve({ ok: true, data: players });
    await vi.waitFor(() => expect(snapshots.at(-1)?.tasks.players).toBe("completed"));
    expect(snapshots.at(-1)).toMatchObject({
      completed: 1,
      total: 5,
      tasks: { players: "completed" },
    });

    avatarLoad.resolve({ ok: true, data: { playerId: players[0]!.id, avatarUrl: null } });
    upgradeLoad.resolve({ ok: true, data: upgrades });
    runLoad.reject(new Error("fail-soft run bridge failure"));
    itemLoad.resolve({ ok: true, data: advanced });
    mapLoad.resolve({ ok: true, data: maps });
    await preparation;

    expect(snapshots.at(-1)).toEqual({
      completed: 5,
      total: 5,
      currentTask: null,
      tasks: {
        items: "completed",
        upgrades: "completed",
        players: "completed",
        run: "completed",
        maps: "completed",
      },
    });
    expect(snapshots.filter((progress) => progress.completed === progress.total)).toHaveLength(1);
    expect(window.repoditor.players.avatar).not.toHaveBeenCalled();
  });

  it("uses one real task for a cached entry that only refreshes upgrade artwork", async () => {
    const upgradeLoad = deferred<DesktopOperationResult<typeof upgrades>>();
    window.repoditor.upgrades.prepareEntry = vi.fn(() => upgradeLoad.promise);
    window.repoditor.assets.state = vi.fn().mockResolvedValue(readyAssets);
    const existingData: RunEntryData = {
      artworkDegraded: false,
      players: { ok: true, data: players },
      avatarUrls: {},
      upgrades: { ok: true, data: upgrades },
      run: { ok: true, data: runState },
      items: { ok: true, data: advanced },
      maps: { ok: true, data: maps },
    };
    const snapshots: RunEntryProgress[] = [];

    const preparation = prepareRunEntryData({
      saveId,
      requiredUpgradeVisualKeys: ["playerUpgradeHealth"],
      presentationReadiness: "unresolved",
      maps: () => Promise.resolve({ ok: true, data: maps }),
      existingData,
      onProgressChange: (progress) => snapshots.push(progress),
    });

    expect(snapshots).toEqual([
      {
        completed: 0,
        total: 1,
        currentTask: "upgrades",
        tasks: { upgrades: "waiting" },
      },
      {
        completed: 0,
        total: 1,
        currentTask: "upgrades",
        tasks: { upgrades: "running" },
      },
    ]);
    upgradeLoad.resolve({ ok: true, data: upgrades });
    await preparation;
    expect(snapshots.at(-1)).toEqual({
      completed: 1,
      total: 1,
      currentTask: null,
      tasks: { upgrades: "completed" },
    });
  });
});
