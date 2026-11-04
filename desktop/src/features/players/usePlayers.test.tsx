import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DesktopOperationResult, PlayerDto } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { players, saveId } from "@/test/repoditorApiFixture";
import { usePlayers } from "./usePlayers";

const player = { id: "111", name: "Alpha", health: 80, maxHealth: 100 };

function wrapper({ children }: { readonly children: ReactNode }) {
  return <PreferencesProvider>{children}</PreferencesProvider>;
}

describe("usePlayers health edits", () => {
  it("keeps every pending health value within the player bounds", () => {
    const { result } = renderHook(() => usePlayers(saveId, { ok: true, data: [player] }), {
      wrapper,
    });

    act(() => result.current.updateHealth(player, 101));
    expect(result.current.pendingByPlayer[player.id]?.after).toBe(100);

    act(() => result.current.updateHealth(player, -1));
    expect(result.current.pendingByPlayer[player.id]?.after).toBe(0);

    act(() => result.current.updateHealth(player, Number.NaN));
    expect(result.current.pendingByPlayer[player.id]?.after).toBe(0);

    act(() => result.current.updateHealth(player, player.health));
    expect(result.current.pendingByPlayer[player.id]).toBeUndefined();
  });
});

describe("injected player reads", () => {
  it("keeps an accepted canonical snapshot when an older read completes late", async () => {
    let finish: (value: DesktopOperationResult<PlayerDto[]>) => void = (_value) => undefined;
    const list = vi.fn(
      () =>
        new Promise<DesktopOperationResult<PlayerDto[]>>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => usePlayers(saveId, null, list), { wrapper });
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    act(() => result.current.acceptSnapshot([{ ...player, health: 17 }]));
    await act(async () => finish({ ok: true, data: [player] }));
    expect(result.current.players[0]?.health).toBe(17);
    expect(result.current.selectedPlayerId).toBe("111");
    expect(result.current.loading).toBe(false);
  });
  it("scopes selection to loaded players and recovers from failure without an Electron bridge", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: players })
      .mockResolvedValueOnce({ ok: false, error: { code: "save_missing", message: "private" } })
      .mockResolvedValueOnce({ ok: true, data: [players[0]] });
    const { result } = renderHook(() => usePlayers(saveId, null, list), {
      wrapper: PreferencesProvider,
    });
    await waitFor(() => expect(result.current.selectedPlayerId).toBe("111"));
    act(() => result.current.setSelectedPlayerId("222"));
    act(() => result.current.setSelectedPlayerId("999"));
    expect(result.current.selectedPlayerId).toBe("222");
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).not.toContain("private");
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.selectedPlayerId).toBe("111"));
    expect(result.current.error).toBeNull();
    expect(list).toHaveBeenCalledWith(saveId);
  });
  it("ignores an in-flight result after the workspace is unmounted", async () => {
    let complete!: (value: DesktopOperationResult<PlayerDto[]>) => void;
    const list = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => usePlayers(saveId, null, list), {
      wrapper: PreferencesProvider,
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => complete({ ok: true, data: players }));
    expect(result.current.players).toEqual([]);
  });
});
