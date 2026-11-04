import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { createRepoDitorApi, maps } from "@/test/repoditorApiFixture";
import { useMaps } from "./useMaps";

describe("useMaps", () => {
  it("loads the injected read once in StrictMode and ignores a late unmounted result", async () => {
    let finish!: (value: Awaited<ReturnType<typeof list>>) => void;
    const list = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <StrictMode>
        <PreferencesProvider>{children}</PreferencesProvider>
      </StrictMode>
    );
    const { result, unmount } = renderHook(() => useMaps(null, list), { wrapper });
    await waitFor(() => expect(list).toHaveBeenCalledExactlyOnceWith());
    expect(result.current.loading).toBe(true);
    unmount();
    await act(async () => finish({ ok: true, data: maps }));
    expect(result.current.discovery).toBeNull();
  });

  it("retains injected data on backend failure, translates errors and recovers", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: "process_timeout", message: "private" } })
      .mockResolvedValueOnce({ ok: true, data: { ...maps, maps: [] } });
    const { result } = renderHook(() => useMaps({ ok: true, data: maps }, list), {
      wrapper: PreferencesProvider,
    });
    expect(list).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.discovery).toEqual(maps);
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).not.toContain("private");
    expect(result.current.loading).toBe(false);
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.discovery?.maps).toEqual([]);
    expect(result.current.error).toBeNull();
  });

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
