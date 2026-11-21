import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { environment } from "@/test/repoditorApiFixture";
import { tauriDiscoveryApi } from "./tauriDiscoveryApi";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("Tauri discovery adapter", () => {
  it("uses only the named parameterless discovery operation and existing DTO", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ ok: true, data: environment });
    expect(await tauriDiscoveryApi.detect()).toEqual({ ok: true, data: environment });
    expect(invoke).toHaveBeenLastCalledWith("environment_detect");
  });
  it("preserves typed native failures and sanitizes transport rejection", async () => {
    const failure = { ok: false, error: { code: "process_timeout", message: "timed out" } };
    vi.mocked(invoke)
      .mockResolvedValueOnce(failure)
      .mockRejectedValueOnce(new Error("private local path"));
    expect(await tauriDiscoveryApi.detect()).toEqual(failure);
    expect(await tauriDiscoveryApi.detect()).toEqual({
      ok: false,
      error: { code: "internal_error", message: "The desktop discovery bridge is unavailable." },
    });
  });
});
