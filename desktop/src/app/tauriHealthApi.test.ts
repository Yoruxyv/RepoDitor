import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { tauriHealthApi } from "./tauriHealthApi";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const call = vi.mocked(invoke);
beforeEach(() => {
  call.mockReset();
});
describe("synthetic native health transport", () => {
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
