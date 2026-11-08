import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanced,
  cosmetics,
  maps,
  openResult,
  players,
  runState,
  saveId,
  upgrades,
} from "@/test/repoditorApiFixture";
import { closeTauriPreview, tauriReadApi } from "./tauriReadApi";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("typed native read capabilities", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());
  it("gets Cosmetics without paths or a Run ID and exposes no write method", async () => {
    const failure = { ok: false, error: { code: "meta_missing", message: "Missing" } };
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, data: cosmetics })
      .mockResolvedValueOnce(failure)
      .mockRejectedValueOnce(new Error("private"));
    expect(await tauriReadApi.cosmetics.get()).toEqual({ ok: true, data: cosmetics });
    expect(invoke).toHaveBeenNthCalledWith(1, "cosmetics_get");
    expect(await tauriReadApi.cosmetics.get()).toEqual(failure);
    const rejected = await tauriReadApi.cosmetics.get();
    expect(rejected).toMatchObject({ ok: false, error: { code: "internal_error" } });
    expect(JSON.stringify(rejected)).not.toContain("private");
    expect(Object.keys(tauriReadApi.cosmetics)).toEqual(["get"]);
  });
  it("lists Maps without renderer paths and sanitizes transport errors", async () => {
    const failure = { ok: false, error: { code: "backend_unavailable", message: "Unavailable" } };
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, data: maps })
      .mockResolvedValueOnce(failure)
      .mockRejectedValueOnce(new Error("private path"));
    expect(await tauriReadApi.maps.list()).toEqual({ ok: true, data: maps });
    expect(invoke).toHaveBeenNthCalledWith(1, "maps_list");
    expect(await tauriReadApi.maps.list()).toEqual(failure);
    expect(await tauriReadApi.maps.list()).toEqual({
      ok: false,
      error: { code: "internal_error", message: "The desktop maps bridge failed unexpectedly." },
    });
    expect(Object.keys(tauriReadApi.maps)).toEqual(["list"]);
  });
  it("exposes only the named Items read, preserves failures and sanitizes transport errors", async () => {
    const failure = { ok: false, error: { code: "save_missing", message: "Missing" } };
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, data: advanced })
      .mockResolvedValueOnce(failure)
      .mockRejectedValueOnce(new Error("private path"));
    expect(await tauriReadApi.advanced.get(saveId)).toEqual({ ok: true, data: advanced });
    expect(invoke).toHaveBeenNthCalledWith(1, "advanced_get", { saveId });
    expect(await tauriReadApi.advanced.get(saveId)).toEqual(failure);
    expect(await tauriReadApi.advanced.get(saveId)).toEqual({
      ok: false,
      error: {
        code: "internal_error",
        message: "The desktop advanced data bridge failed unexpectedly.",
      },
    });
    expect(Object.keys(tauriReadApi.advanced)).toEqual(["get"]);
  });
  it("exposes only the named Run read, preserves failures and sanitizes transport errors", async () => {
    const failure = { ok: false, error: { code: "save_missing", message: "Missing" } };
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, data: runState })
      .mockResolvedValueOnce(failure)
      .mockRejectedValueOnce(new Error("private path"));
    expect(await tauriReadApi.run.get(saveId)).toEqual({ ok: true, data: runState });
    expect(invoke).toHaveBeenNthCalledWith(1, "run_get", { saveId });
    expect(await tauriReadApi.run.get(saveId)).toEqual(failure);
    expect(await tauriReadApi.run.get(saveId)).toEqual({
      ok: false,
      error: { code: "internal_error", message: "The desktop run bridge failed unexpectedly." },
    });
    expect(Object.keys(tauriReadApi.run)).toEqual(["get"]);
  });
  it("only exposes the named upgrades read and sanitizes bridge rejections", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, data: upgrades })
      .mockRejectedValueOnce(new Error("private path"));
    expect(await tauriReadApi.upgrades.list(saveId)).toEqual({ ok: true, data: upgrades });
    expect(invoke).toHaveBeenNthCalledWith(1, "upgrades_list", { saveId });
    expect(await tauriReadApi.upgrades.list(saveId)).toEqual({
      ok: false,
      error: {
        code: "internal_error",
        message: "The desktop upgrades bridge failed unexpectedly.",
      },
    });
    expect(Object.keys(tauriReadApi.upgrades)).toEqual(["list"]);
  });
  it("lists players through one named read command and sanitizes transport rejection", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, data: players })
      .mockResolvedValueOnce({ ok: false, error: { code: "save_missing", message: "Missing" } })
      .mockRejectedValueOnce(new Error("private path"));
    expect(await tauriReadApi.players.list(saveId)).toEqual({ ok: true, data: players });
    expect(invoke).toHaveBeenNthCalledWith(1, "players_list", { saveId });
    expect(await tauriReadApi.players.list(saveId)).toMatchObject({
      ok: false,
      error: { code: "save_missing" },
    });
    const rejected = await tauriReadApi.players.list(saveId);
    expect(rejected).toMatchObject({ ok: false, error: { code: "internal_error" } });
    expect(JSON.stringify(rejected)).not.toContain("private");
    expect(Object.keys(tauriReadApi.players).sort((a, b) => a.localeCompare(b))).toEqual([
      "avatar",
      "list",
    ]);
  });
  it("uses only the scoped avatar command and sanitizes transport failures", async () => {
    const data = { playerId: "111", avatarUrl: null, status: "unavailable", retryAfterMs: null };
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, data })
      .mockRejectedValueOnce(new Error("private"));
    expect(await tauriReadApi.players.avatar(saveId, "111")).toEqual({ ok: true, data });
    expect(invoke).toHaveBeenNthCalledWith(1, "players_avatar", { saveId, playerId: "111" });
    expect(await tauriReadApi.players.avatar(saveId, "111")).toEqual({
      ok: false,
      error: {
        code: "internal_error",
        message: "The desktop avatar bridge failed unexpectedly.",
      },
    });
  });
  it("only forwards the opaque save ID to the named open command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(openResult());
    expect(await tauriReadApi.saves.open(saveId)).toEqual(openResult());
    expect(invoke).toHaveBeenCalledExactlyOnceWith("saves_open", { saveId });
    expect("write" in tauriReadApi.saves).toBe(false);
  });
  it("preserves backend failures and sanitizes rejected transports", async () => {
    const failure = { ok: false, error: { code: "save_missing", message: "Missing" } };
    vi.mocked(invoke).mockResolvedValueOnce(failure).mockRejectedValueOnce(new Error("private"));
    expect(await tauriReadApi.saves.open(saveId)).toEqual(failure);
    expect(await tauriReadApi.saves.open(saveId)).toMatchObject({
      ok: false,
      error: { code: "internal_error" },
    });
  });
  it("coalesces focus checks and preserves unknown status without a write capability", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const first = tauriReadApi.game.status();
    expect(tauriReadApi.game.status()).toBe(first);
    resolve({ ok: true, data: { status: "unknown", running: false } });
    expect(await first).toMatchObject({ ok: true, data: { status: "unknown" } });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("private process details"));
    expect(await tauriReadApi.game.status()).toMatchObject({
      ok: false,
      error: { code: "internal_error" },
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("only asks the host to close its own preview window", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await closeTauriPreview();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("preview_close");
  });
});
