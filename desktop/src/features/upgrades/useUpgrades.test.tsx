import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DesktopOperationResult, PlayerUpgradeDto } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { saveId, upgrades } from "@/test/repoditorApiFixture";
import { useUpgrades } from "./useUpgrades";

function wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <StrictMode>
      <PreferencesProvider>{children}</PreferencesProvider>
    </StrictMode>
  );
}

describe("injected upgrade reads", () => {
  it("refreshes optional tokens without replacing canonical values with an older read", async () => {
    const initial = upgrades.map((upgrade) => ({ ...upgrade, iconToken: null }));
    const list = vi.fn().mockResolvedValue({
      ok: true,
      data: initial.map((upgrade) => ({ ...upgrade, iconToken: "upgrade-artwork:new" })),
    });
    const { result } = renderHook(() => useUpgrades(saveId, { ok: true, data: initial }, list), {
      wrapper,
    });
    const canonical = initial.map((upgrade) => ({
      ...upgrade,
      values: upgrade.values.map((entry) => ({ ...entry, value: 9 })),
    }));
    act(() => result.current.acceptSnapshot(canonical));
    await act(async () => result.current.refreshArtwork());
    expect(result.current.upgrades).toEqual(
      canonical.map((upgrade) => ({ ...upgrade, iconToken: "upgrade-artwork:new" })),
    );
  });
  it("keeps a canonical transaction snapshot when an older read completes later", async () => {
    let complete!: (value: DesktopOperationResult<PlayerUpgradeDto[]>) => void;
    const list = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { result } = renderHook(() => useUpgrades(saveId, null, list), { wrapper });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    const canonical = upgrades.map((upgrade) => ({
      ...upgrade,
      values: upgrade.values.map((entry) => ({ ...entry, value: 9 })),
    }));
    act(() => result.current.acceptSnapshot(canonical));
    await act(async () => complete({ ok: true, data: upgrades }));
    expect(result.current.upgrades).toEqual(canonical);
    expect(result.current.loading).toBe(false);
  });
  it("loads once under StrictMode, coalesces retries and recovers from a translated failure", async () => {
    let complete!: (value: DesktopOperationResult<PlayerUpgradeDto[]>) => void;
    const list = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          complete = resolve;
        }),
      )
      .mockResolvedValueOnce({ ok: true, data: upgrades });
    const { result } = renderHook(() => useUpgrades(saveId, null, list), { wrapper });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.reload();
    });
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () =>
      complete({ ok: false, error: { code: "save_missing", message: "private" } }),
    );
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).not.toContain("private");
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.upgrades).toEqual(upgrades);
    expect(result.current.error).toBeNull();
  });
  it("does not apply a late result after save/workspace unmount", async () => {
    let complete!: (value: DesktopOperationResult<PlayerUpgradeDto[]>) => void;
    const list = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useUpgrades(saveId, null, list), { wrapper });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => complete({ ok: true, data: upgrades }));
    expect(result.current.upgrades).toEqual([]);
  });
});
