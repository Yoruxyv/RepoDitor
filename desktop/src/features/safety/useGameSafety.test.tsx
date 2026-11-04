import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DesktopOperationResult, GameProcessState } from "@electron/contracts";
import { useGameSafety } from "./useGameSafety";

type Result = DesktopOperationResult<GameProcessState>;
const closed: Result = { ok: true, data: { status: "not_running", running: false } };

describe("game-status freshness", () => {
  it("retains the previous status while a recheck is pending, then fails closed and recovers", async () => {
    let complete!: (value: Result) => void;
    const get = vi
      .fn()
      .mockResolvedValueOnce(closed)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          complete = resolve;
        }),
      )
      .mockRejectedValueOnce(new Error("private diagnostic"))
      .mockResolvedValueOnce(closed);
    const { result } = renderHook(() => useGameSafety(get));
    await waitFor(() => expect(result.current.status).toBe("not_running"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current.checking).toBe(true);
    expect(result.current.status).toBe("not_running");
    await act(async () => complete({ ok: true, data: { status: "unknown", running: false } }));
    expect(result.current.status).toBe("unknown");
    expect(result.current.checking).toBe(false);
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.status).toBe("unknown");
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.status).toBe("not_running");
    expect(result.current.recoveryGeneration).toBe(1);
  });
  it("does not let an older closed result overwrite a newer running result", async () => {
    let complete!: (value: Result) => void;
    const get = vi
      .fn()
      .mockResolvedValueOnce(closed)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          complete = resolve;
        }),
      )
      .mockResolvedValueOnce({ ok: true, data: { status: "running", running: true } });
    const { result } = renderHook(() => useGameSafety(get));
    await waitFor(() => expect(result.current.status).toBe("not_running"));
    act(() => {
      void result.current.check();
    });
    await act(async () => {
      await result.current.check();
    });
    expect(result.current.status).toBe("running");
    await act(async () => complete(closed));
    expect(result.current.status).toBe("running");
  });
  it("discards a late status after unmount", async () => {
    let complete!: (value: Result) => void;
    const get = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useGameSafety(get));
    expect(result.current.status).toBeNull();
    unmount();
    await act(async () => complete(closed));
    expect(result.current.status).toBeNull();
  });
});
