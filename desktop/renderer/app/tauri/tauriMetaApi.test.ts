import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { tauriMetaApi, metaIntentFits } from "./tauriMetaApi";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
describe("fixed MetaSave transport", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });
  it("keeps uncertain operation identity when the response is lost", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("private transport data"));
    const request = {
      operationId: "a".repeat(32),
      session: "meta",
      fingerprint: "b".repeat(64),
      intent: { metaCosmetics: { action: "unlockAll" as const, admission: "c".repeat(64) } },
    };
    expect(await tauriMetaApi.write(request)).toMatchObject({
      operationId: request.operationId,
      status: "uncertain",
      view: null,
    });
    expect(invoke).toHaveBeenCalledWith("test_meta_write", { request });
    expect((await tauriMetaApi.state()).state).toBe("disabled");
    expect((await tauriMetaApi.recover(request.operationId, "recovery")).status).toBe("conflict");
  });
  it("enforces both count and serialized intent budgets", () => {
    const admission = "a".repeat(64);
    expect(metaIntentFits({ metaCosmetics: { action: "unlockIds", admission, ids: [0, 2] } })).toBe(
      true,
    );
    expect(metaIntentFits({ metaCosmetics: { action: "unlockIds", admission, ids: [] } })).toBe(
      false,
    );
    expect(
      metaIntentFits({
        metaCosmetics: {
          action: "unlockIds",
          admission,
          ids: Array.from({ length: 513 }, (_, i) => i),
        },
      }),
    ).toBe(false);
    expect(
      metaIntentFits({ metaCosmetics: { action: "unlockAll", admission: "a".repeat(2049) } }),
    ).toBe(false);
  });
});
