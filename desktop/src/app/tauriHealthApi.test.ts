import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { healthIntentFits, refillIntentFits, tauriHealthApi } from "./tauriHealthApi";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const call = vi.mocked(invoke);
beforeEach(() => {
  call.mockReset();
});
describe("synthetic native health transport", () => {
  it("sends only a fixed refill intent and preserves identity after response loss", async () => {
    const request = {
      saveId: "save",
      fingerprint: "a".repeat(64),
      operationId: "b".repeat(32),
      session: "test-session",
      refillToFull: [{ saveKey: "Item Tool/1", before: 99 }],
    };
    call.mockRejectedValue(new Error("private path"));
    expect(await tauriHealthApi.writeRefills(request)).toMatchObject({
      operationId: request.operationId,
      status: "uncertain",
      canonical: null,
    });
    expect(call).toHaveBeenCalledExactlyOnceWith("test_items_refill", { request });
  });
  it.each([-1, 0, 1])("uses the same UTF-8 refill boundary at offset %s", (delta) => {
    const refillToFull = Array.from({ length: 35 }, (_entry, n) => ({
      saveKey: `Item 🧪/${n}`,
      before: 1,
    }));
    const size = () => new TextEncoder().encode(JSON.stringify({ refillToFull })).length;
    const target = 2048 + delta;
    for (const edit of refillToFull)
      edit.saveKey = edit.saveKey.replace("/", "x".repeat(Math.min(target - size(), 50)) + "/");
    expect(size()).toBe(target);
    expect(refillIntentFits(refillToFull)).toBe(delta <= 0);
  });
  it("sends one typed Health batch on the existing synthetic-only channel and retains uncertain identity", async () => {
    const request = {
      saveId: "save",
      fingerprint: "a".repeat(64),
      operationId: "b".repeat(32),
      session: "test-session",
      health: [
        { playerId: "111", before: 80, value: 17 },
        { playerId: "222", before: 0, value: 42 },
      ],
    };
    call.mockRejectedValue(new Error("private backend path"));
    expect(await tauriHealthApi.writeHealthBatch(request)).toEqual({
      operationId: request.operationId,
      status: "uncertain",
      fingerprint: null,
      backupAvailable: false,
      reason: null,
      canonical: null,
    });
    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith("test_health_write", { request });
  });
  it.each([-1, 0, 1])("uses the same Health byte ceiling at offset %s", (delta) => {
    const health = Array.from({ length: 40 }, (_entry, n) => ({
      playerId: String(n),
      before: 0,
      value: 1,
    }));
    const size = () => new TextEncoder().encode(JSON.stringify({ health })).length;
    const target = 2048 + delta;
    for (const edit of health)
      edit.playerId =
        "0".repeat(Math.min(target - size(), 20 - edit.playerId.length)) + edit.playerId;
    expect(size()).toBe(target);
    expect(healthIntentFits(health)).toBe(delta <= 0);
  });
  it("uses the fixed Run channel and fails closed after response loss", async () => {
    const request = {
      saveId: "save",
      fingerprint: "a".repeat(64),
      operationId: "b".repeat(32),
      session: "test-session",
      run: [{ field: "currency" as const, before: 12, value: -19 }],
    };
    call.mockRejectedValue(new Error("private backend path"));
    expect(await tauriHealthApi.writeRun(request)).toMatchObject({
      operationId: request.operationId,
      status: "uncertain",
      canonical: null,
    });
    expect(call).toHaveBeenCalledWith("test_run_write", { request });
  });
  it("uses only the typed upgrade channel and treats response loss as uncertain", async () => {
    const request = {
      saveId: "save",
      fingerprint: "a".repeat(64),
      operationId: "b".repeat(32),
      session: "test-session",
      upgrades: [{ playerId: "111", key: "playerUpgradeStrength", before: 2, value: 3 }],
    };
    call.mockRejectedValue(new Error("private backend path"));
    expect(await tauriHealthApi.writeUpgrades(request)).toMatchObject({
      operationId: request.operationId,
      status: "uncertain",
      canonical: null,
    });
    expect(call).toHaveBeenCalledWith("test_upgrades_write", { request });
  });
  it("keeps a normal host disabled and never guesses a successful outcome", async () => {
    call.mockRejectedValue(new Error("private backend path"));
    expect(await tauriHealthApi.state("save")).toMatchObject({ enabled: false, state: "disabled" });
    const request = {
      saveId: "save",
      fingerprint: "a".repeat(64),
      playerId: "111",
      health: 17,
      operationId: "b".repeat(32),
    };
    expect(await tauriHealthApi.write(request)).toMatchObject({
      operationId: request.operationId,
      status: "uncertain",
      backupAvailable: false,
    });
    expect(await tauriHealthApi.recover("save", request.operationId)).toMatchObject({
      operationId: request.operationId,
      status: "conflict",
    });
  });
  it("uses only the fixed health channels with canonical operation identity and explicit acknowledgement", async () => {
    call.mockResolvedValue({ enabled: true, state: "busy", pending: null, canonical: null });
    await tauriHealthApi.state("save");
    expect(call).toHaveBeenLastCalledWith("test_health_state", { saveId: "save" });
    await tauriHealthApi.recover("save", "a".repeat(32), true);
    expect(call).toHaveBeenLastCalledWith("test_health_recover", {
      request: { saveId: "save", operationId: "a".repeat(32), acknowledge: true },
    });
  });
});
