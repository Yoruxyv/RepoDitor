import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WrenchIcon } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { GameIcon } from "./GameIcon";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const token = (n: string) => `upgrade-artwork:${n.repeat(32)}`;
function icon(value: string, variant: "upgrade" | "item" | "cosmetic" = "upgrade") {
  return (
    <GameIcon
      fallback={WrenchIcon}
      fallbackSource="specific"
      testId="native-icon"
      token={value}
      variant={variant}
    />
  );
}
describe("native GameIcon", () => {
  it("shows only validated current-session images and cancels stale replies", async () => {
    const completions: Array<(value: unknown) => void> = [];
    vi.mocked(invoke)
      .mockReset()
      .mockImplementation((command) =>
        command === "upgrade_artwork_cancel"
          ? Promise.resolve()
          : new Promise((resolve) => completions.push(resolve)),
      );
    const { rerender, unmount } = render(icon(token("a")));
    expect(screen.getByTestId("native-icon-loading")).toBeTruthy();
    rerender(icon(token("b")));
    expect(invoke).toHaveBeenCalledWith("upgrade_artwork_cancel", { token: token("a") });
    await act(async () => {
      completions[0]!({
        ok: true,
        data: {
          token: token("a"),
          revision: "c".repeat(64),
          dataUrl: "data:image/png;base64,AAAA",
        },
      });
    });
    expect(screen.getByTestId("native-icon").querySelector("img")).toBeNull();
    await act(async () => {
      completions[1]!({
        ok: true,
        data: {
          token: token("b"),
          revision: "d".repeat(64),
          dataUrl: "data:image/png;base64,AQID",
        },
      });
    });
    const image = screen.getByTestId("native-icon").querySelector("img")!;
    expect(image.getAttribute("src")).toBe("data:image/png;base64,AQID");
    expect(screen.getByTestId("native-icon").getAttribute("data-artwork-revision")).toBe(
      "d".repeat(64),
    );
    fireEvent.load(image);
    expect(screen.queryByTestId("native-icon-loading")).toBeNull();
    unmount();
    render(icon(token("b")));
    await act(async () => {
      completions[2]!({ ok: true, data: null });
    });
    expect(screen.getByTestId("native-icon").getAttribute("data-icon-source")).toBe("specific");
  });
  it.each(["upgrade-artwork:forged", token("a")])("rejects cross-domain tokens: %s", (value) => {
    vi.mocked(invoke).mockReset();
    render(icon(value, "item"));
    expect(screen.getByTestId("native-icon").getAttribute("data-icon-source")).toBe("specific");
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["item", "cosmetic"] as const)("cancels offscreen %s artwork", async (variant) => {
    const sizeClass = variant === "item" ? "size-14" : "size-[48px]";
    let observe!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          observe = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    const value = `${variant}-artwork:${"d".repeat(32)}`;
    let finish!: (result: unknown) => void;
    vi.mocked(invoke)
      .mockReset()
      .mockImplementation((command) =>
        command === `${variant}_artwork_cancel`
          ? Promise.resolve()
          : new Promise((resolve) => {
              finish = resolve;
            }),
      );
    try {
      const { unmount } = render(icon(value, variant));
      expect(invoke).not.toHaveBeenCalled();
      const intersection = (isIntersecting: boolean) =>
        observe([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
      act(() => intersection(true));
      expect(invoke).toHaveBeenCalledExactlyOnceWith(`${variant}_artwork_get`, { token: value });
      act(() => intersection(false));
      expect(invoke).toHaveBeenLastCalledWith(`${variant}_artwork_cancel`, { token: value });
      await act(async () => finish({ ok: true, data: null }));
      expect(screen.getByTestId("native-icon-loading")).toBeTruthy();
      expect(screen.getByTestId("native-icon").classList.contains(sizeClass)).toBe(true);
      act(() => intersection(true));
      await act(async () =>
        finish({
          ok: true,
          data: { token: value, revision: "a".repeat(64), dataUrl: "data:image/png;base64,AAAA" },
        }),
      );
      expect(screen.getByTestId("native-icon").querySelector("img")).toBeTruthy();
      act(() => intersection(false));
      expect(screen.getByTestId("native-icon").querySelector("img")).toBeNull();
      expect(screen.getByTestId("native-icon-loading")).toBeTruthy();
      expect(screen.getByTestId("native-icon").classList.contains(sizeClass)).toBe(true);
      unmount();
      expect(disconnect).toHaveBeenCalled();
      render(icon(value));
      expect(screen.getByTestId("native-icon").getAttribute("data-icon-source")).toBe("specific");
      expect(invoke).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("falls back for a rejected, malformed or unsafe response", async () => {
    vi.mocked(invoke)
      .mockReset()
      .mockResolvedValue({
        ok: true,
        data: { token: token("e"), revision: "f".repeat(64), dataUrl: "file:///private.png" },
      });
    render(icon(token("e")));
    await waitFor(() =>
      expect(screen.getByTestId("native-icon").getAttribute("data-icon-source")).toBe("specific"),
    );
    expect(screen.queryByTestId("native-icon-loading")).toBeNull();
  });
});
