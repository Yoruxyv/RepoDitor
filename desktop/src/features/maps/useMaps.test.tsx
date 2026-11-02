import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { createRepoDitorApi, maps } from "@/test/repoditorApiFixture";
import { useMaps } from "./useMaps";

describe("useMaps", () => {
  it("preserves usable data on refresh failure and ignores superseded requests", async () => {
    const api = createRepoDitorApi(vi.fn());
    Object.defineProperty(window, "repoditor", { configurable: true, value: api });
    const { result } = renderHook(() => useMaps({ ok: true, data: maps }), {
      wrapper: PreferencesProvider,
    });
    vi.mocked(api.maps.list).mockRejectedValueOnce(new Error("unavailable"));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.discovery).toEqual(maps);
    expect(result.current.error).not.toBeNull();
    expect(result.current.artworkAttempt).toBe(0);
    let finish!: (value: Awaited<ReturnType<typeof api.maps.list>>) => void;
    vi.mocked(api.maps.list).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.reload();
    });
    vi.mocked(api.maps.list).mockResolvedValueOnce({ ok: true, data: { ...maps, maps: [] } });
    await act(async () => {
      await result.current.reload();
    });
    const attempt = result.current.artworkAttempt;
    expect(attempt).toBeGreaterThan(0);
    await act(async () => {
      finish({ ok: true, data: maps });
      await pending;
    });
    await waitFor(() => expect(result.current.discovery?.maps).toEqual([]));
    expect(result.current.error).toBeNull();
    expect(result.current.artworkAttempt).toBe(attempt);
  });
});
