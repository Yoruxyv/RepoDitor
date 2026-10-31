// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  DecodedCosmeticArtworkCache,
} = require("../../dist-electron/icons/cosmeticArtworkCache.cjs");

describe("non-blocking cosmetic artwork preparation", () => {
  it("reports real progress while leaving the calling thread free", async () => {
    const cache = new DecodedCosmeticArtworkCache();
    const phases: string[] = [];
    let resolved!: () => void;
    const degraded = new Promise<void>((resolve) => {
      resolved = resolve;
    });
    const unsubscribe = cache.subscribePreparation((state: { phase: string }) => {
      phases.push(state.phase);
      if (state.phase === "degraded") resolved();
    });
    const runRecords = vi.fn(async () => {
      throw new Error("Optional artwork unavailable");
    });
    expect(cache.prefetch([3, 4], { runRecords })).toBeUndefined();
    await degraded;
    expect(phases).toEqual(expect.arrayContaining(["checking", "preparing", "degraded"]));
    expect(cache.getPreparationState()).toMatchObject({
      phase: "degraded",
      total: 2,
      completed: 0,
    });
    unsubscribe();
  });

  it("counts streamed cosmetic records without waiting for all source decoding", async () => {
    const cache = new DecodedCosmeticArtworkCache();
    const snapshots: Array<{ phase: string; completed: number; failed: number }> = [];
    const unsubscribe = cache.subscribePreparation(
      (state: { phase: string; completed: number; failed: number }) => {
        snapshots.push({ phase: state.phase, completed: state.completed, failed: state.failed });
      },
    );
    const runRecords = vi.fn(
      async (_command: string, request: string[], onRecord: (value: unknown) => Promise<void>) => {
        expect(request).toEqual(["7", "8"]);
        await onRecord({ type: "texture", cosmeticId: 7, artwork: null, completed: 1, total: 2 });
        await onRecord({ type: "texture", cosmeticId: 8, artwork: null, completed: 2, total: 2 });
        return { type: "final", ok: true, completed: 2, total: 2 };
      },
    );
    expect(cache.prefetch([7, 8], { runRecords })).toBeUndefined();
    await vi.waitFor(() => {
      expect(cache.getPreparationState()).toMatchObject({
        phase: "degraded",
        total: 2,
        completed: 2,
        failed: 2,
      });
    });
    expect(snapshots).toEqual(
      expect.arrayContaining([
        { phase: "checking", completed: 0, failed: 0 },
        { phase: "preparing", completed: 1, failed: 1 },
        { phase: "preparing", completed: 2, failed: 2 },
      ]),
    );
    expect(runRecords).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
