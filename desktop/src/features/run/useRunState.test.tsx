import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DesktopOperationResult, RunStateDto } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { runState, saveId } from "@/test/repoditorApiFixture";
import { useRunState } from "./useRunState";

function wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <StrictMode>
      <PreferencesProvider>{children}</PreferencesProvider>
    </StrictMode>
  );
}

describe("injected Run reads", () => {
  it("loads once under StrictMode, coalesces retries and recovers from a translated failure", async () => {
    let complete!: (value: DesktopOperationResult<RunStateDto>) => void;
    const get = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          complete = resolve;
        }),
      )
      .mockResolvedValueOnce({ ok: true, data: runState });
    const { result } = renderHook(() => useRunState(saveId, null, get), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledExactlyOnceWith(saveId));
    await act(async () => {
      await result.current.reload();
    });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () =>
      complete({ ok: false, error: { code: "save_missing", message: "private" } }),
    );
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).not.toContain("private");
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.run).toEqual(runState);
    expect(result.current.error).toBeNull();
  });
  it("discards a late result after workspace unmount", async () => {
    let complete!: (value: DesktopOperationResult<RunStateDto>) => void;
    const get = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useRunState(saveId, null, get), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => complete({ ok: true, data: runState }));
    expect(result.current.run).toBeNull();
  });
  it("maps thrown reads to a public error and keeps supplied Electron initial data", async () => {
    const get = vi.fn().mockRejectedValue(new Error("private"));
    const { result } = renderHook(() => useRunState(saveId, { ok: true, data: runState }, get), {
      wrapper,
    });
    expect(result.current.run).toEqual(runState);
    expect(get).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.refreshAfterSave();
    });
    expect(result.current.run).toEqual(runState);
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).not.toContain("private");
  });
});
