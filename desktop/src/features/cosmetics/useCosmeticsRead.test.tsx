import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CosmeticsViewDto, DesktopOperationResult } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { cosmetics } from "@/test/repoditorApiFixture";
import { useCosmeticsRead } from "./useCosmeticsRead";

function wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <StrictMode>
      <PreferencesProvider>{children}</PreferencesProvider>
    </StrictMode>
  );
}

describe("read-only Cosmetics loading", () => {
  it("discards superseded entry data and reads once for the latest navigation/recovery", async () => {
    let finish!: (result: DesktopOperationResult<CosmeticsViewDto>) => void;
    const fresh = { ...cosmetics, fingerprint: "b".repeat(64) };
    const get = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValue({ ok: true, data: fresh });
    const observed: (string | undefined)[] = [];
    const { result, rerender } = renderHook(
      ({ active, generation }) => {
        const state = useCosmeticsRead(active, generation, get);
        observed.push(state.view?.fingerprint);
        return state;
      },
      { initialProps: { active: true, generation: 0 }, wrapper },
    );
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    rerender({ active: false, generation: 0 });
    rerender({ active: true, generation: 0 });
    rerender({ active: true, generation: 1 });
    await act(async () => finish({ ok: true, data: cosmetics }));
    await waitFor(() => expect(result.current.view).toEqual(fresh));
    expect(get).toHaveBeenCalledTimes(2);
    expect(observed).not.toContain(cosmetics.fingerprint);
  });
  it("waits for global entry, loads once under StrictMode and coalesces overlapping reads", async () => {
    let finish!: (result: DesktopOperationResult<CosmeticsViewDto>) => void;
    const get = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result, rerender } = renderHook(({ active }) => useCosmeticsRead(active, 0, get), {
      initialProps: { active: false },
      wrapper,
    });
    expect(get).not.toHaveBeenCalled();
    rerender({ active: true });
    await waitFor(() => expect(get).toHaveBeenCalledExactlyOnceWith());
    act(() => result.current.reload());
    expect(get).toHaveBeenCalledTimes(1);
    await act(() => finish({ ok: true, data: cosmetics }));
    expect(result.current.view).toEqual(cosmetics);
    expect(result.current.loading).toBe(false);
  });
  it("retains data during refresh, translates errors and reloads on entry/recovery", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, data: cosmetics });
    const { result, rerender } = renderHook(
      ({ active, generation }) => useCosmeticsRead(active, generation, get),
      { initialProps: { active: true, generation: 0 }, wrapper },
    );
    await waitFor(() => expect(result.current.view).toEqual(cosmetics));
    let finish!: (result: DesktopOperationResult<CosmeticsViewDto>) => void;
    get.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    act(() => result.current.reload());
    expect(result.current.loading).toBe(true);
    expect(result.current.view).toEqual(cosmetics);
    await act(async () =>
      finish({ ok: false, error: { code: "meta_missing", message: "private" } }),
    );
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).not.toContain("private");
    expect(result.current.view).toBeNull();
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.view).toEqual(cosmetics));
    rerender({ active: false, generation: 0 });
    rerender({ active: true, generation: 0 });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(4));
    rerender({ active: true, generation: 1 });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(5));
  });
  it("ignores completion after unmount and maps thrown reads to a public error", async () => {
    let finish!: (result: DesktopOperationResult<CosmeticsViewDto>) => void;
    const get = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useCosmeticsRead(true, 0, get), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => finish({ ok: true, data: cosmetics }));
    expect(result.current.view).toBeNull();
    const failing = vi.fn().mockRejectedValue(new Error("private"));
    const second = renderHook(() => useCosmeticsRead(true, 0, failing), { wrapper });
    await waitFor(() => expect(second.result.current.error).toBeTruthy());
    expect(second.result.current.error).not.toContain("private");
  });
});
