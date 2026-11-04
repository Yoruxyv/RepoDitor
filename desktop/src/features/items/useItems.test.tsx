import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DesktopOperationResult, AdvancedSaveDto } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { advanced, saveId } from "@/test/repoditorApiFixture";
import { useItems } from "./useItems";

function wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <StrictMode>
      <PreferencesProvider>{children}</PreferencesProvider>
    </StrictMode>
  );
}

describe("injected Items reads", () => {
  it("loads once under StrictMode, coalesces retries and recovers from a translated failure", async () => {
    let complete!: (value: DesktopOperationResult<AdvancedSaveDto>) => void;
    const get = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          complete = resolve;
        }),
      )
      .mockResolvedValueOnce({ ok: true, data: advanced });
    const { result } = renderHook(() => useItems(saveId, null, get), { wrapper });
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
    expect(result.current.advanced).toEqual(advanced);
    expect(result.current.error).toBeNull();
  });
  it("discards a late result after workspace unmount", async () => {
    let complete!: (value: DesktopOperationResult<AdvancedSaveDto>) => void;
    const get = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useItems(saveId, null, get), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => complete({ ok: true, data: advanced }));
    expect(result.current.advanced).toBeNull();
  });
  it("maps thrown reads to a public error and keeps supplied Electron initial data", async () => {
    const get = vi.fn().mockRejectedValue(new Error("private"));
    const { result } = renderHook(() => useItems(saveId, { ok: true, data: advanced }, get), {
      wrapper,
    });
    expect(result.current.advanced).toEqual(advanced);
    expect(get).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.refreshAfterSave();
    });
    expect(result.current.advanced).toEqual(advanced);
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).not.toContain("private");
  });
});
