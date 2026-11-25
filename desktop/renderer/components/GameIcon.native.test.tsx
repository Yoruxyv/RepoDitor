import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WrenchIcon } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import {
  cancelEntryArtwork,
  clearEntryArtwork,
  preloadEntryArtwork,
  rememberEntryArtwork,
  restoreEntryArtwork,
} from "@/app/tauri/tauriArtwork";
import { GameIcon } from "./GameIcon";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const token = (n: string) => `upgrade-artwork:${n.repeat(32)}`;
function icon(
  value: string,
  variant: "upgrade" | "map" | "item" | "cosmetic" = "upgrade",
  upgradeItem = false,
) {
  return (
    <GameIcon
      fallback={WrenchIcon}
      fallbackSource="specific"
      testId="native-icon"
      token={value}
      upgradeItem={upgradeItem}
      variant={variant}
    />
  );
}
describe("native GameIcon", () => {
  it("shows a pending Map thumbnail without duplicating its background request", async () => {
    const upgrade = token("9");
    const map = upgrade.replace("upgrade-", "map-");
    let completeUpgrade!: (result: unknown) => void;
    vi.mocked(invoke)
      .mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => (completeUpgrade = resolve)))
      .mockResolvedValueOnce({
        ok: true,
        data: { token: map, revision: "b".repeat(64), dataUrl: "data:image/png;base64,AAAA" },
      });
    try {
      const artwork = preloadEntryArtwork(
        { upgrade: [upgrade], map: [map], item: [] },
        new AbortController().signal,
      );
      render(icon(map, "map"));
      expect(screen.getByTestId("native-icon-loading")).toBeTruthy();
      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
      await act(async () => {
        completeUpgrade({ ok: true, data: null });
        await artwork;
      });
      expect(screen.getByTestId("native-icon").getAttribute("data-artwork-revision")).toBe(
        "b".repeat(64),
      );
      expect(invoke).toHaveBeenCalledTimes(2);
    } finally {
      cancelEntryArtwork();
    }
  });
  it("retains artwork for two verified saves and binds each to fresh tokens", async () => {
    const original = token("1");
    const current = token("2");
    const alternate = token("3");
    const alternateCurrent = token("4");
    const shape = (value: string) => ({ upgrade: [value], map: [], item: [] });
    vi.mocked(invoke)
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        data: { token: original, revision: "a".repeat(64), dataUrl: "data:image/png;base64,AAAA" },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { token: alternate, revision: "b".repeat(64), dataUrl: "data:image/png;base64,BBBB" },
      });
    try {
      const results = await preloadEntryArtwork(
        shape(original),
        new AbortController().signal,
        vi.fn(),
      );
      rememberEntryArtwork("verified save and installation", shape(original), results);
      const otherResults = await preloadEntryArtwork(
        shape(alternate),
        new AbortController().signal,
        vi.fn(),
      );
      rememberEntryArtwork("alternate save and installation", shape(alternate), otherResults);
      expect(restoreEntryArtwork("changed source", shape(original))).toBeNull();
      expect(restoreEntryArtwork("verified save and installation", shape(current))).toEqual(
        results,
      );
      const view = render(icon(current));
      expect(screen.queryByTestId("native-icon-loading")).toBeNull();
      expect(screen.getByTestId("native-icon").querySelector("img")?.getAttribute("src")).toBe(
        "data:image/png;base64,AAAA",
      );
      view.unmount();
      expect(
        restoreEntryArtwork("alternate save and installation", shape(alternateCurrent)),
      ).toEqual(otherResults);
      const otherView = render(icon(alternateCurrent));
      expect(screen.getByTestId("native-icon").querySelector("img")?.getAttribute("src")).toBe(
        "data:image/png;base64,BBBB",
      );
      expect(invoke).toHaveBeenCalledTimes(2);
      otherView.unmount();
    } finally {
      restoreEntryArtwork("verified save and installation", shape(original));
      restoreEntryArtwork("alternate save and installation", shape(alternate));
      cancelEntryArtwork();
    }
  });
  it("uses prepared Maps and shares the checked Upgrade texture with its matching Item", async () => {
    const upgrade = token("a");
    const map = upgrade.replace("upgrade-", "map-");
    vi.mocked(invoke)
      .mockReset()
      .mockImplementation(async (_command, args) => ({
        ok: true,
        data: {
          token: (args as { token: string }).token,
          revision: "b".repeat(64),
          dataUrl: "data:image/png;base64,AAAA",
        },
      }));
    try {
      await preloadEntryArtwork(
        { upgrade: [upgrade], map: [map], item: [upgrade] },
        new AbortController().signal,
        vi.fn(),
      );
      const rendered = render(icon(upgrade));
      expect(screen.getByTestId("native-icon").getAttribute("aria-busy")).toBe("false");
      rendered.unmount();
      clearEntryArtwork("upgrade");
      const artwork = render(
        <>
          {icon(upgrade, "item", true)}
          {icon(map, "map")}
        </>,
      );
      expect(screen.queryByTestId("native-icon-loading")).toBeNull();
      expect(
        screen.getAllByTestId("native-icon").map((frame) => frame.querySelectorAll("img").length),
      ).toEqual([1, 1]);
      expect(invoke).toHaveBeenCalledTimes(2);
      artwork.unmount();
    } finally {
      cancelEntryArtwork();
    }
  });
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
    await waitFor(() => expect(completions).toHaveLength(1));
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
    await waitFor(() => expect(completions).toHaveLength(2));
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
    expect(image.getAttribute("loading")).toBe("eager");
    expect(screen.getByTestId("native-icon").getAttribute("data-artwork-revision")).toBe(
      "d".repeat(64),
    );
    fireEvent.load(image);
    expect(screen.queryByTestId("native-icon-loading")).toBeNull();
    unmount();
    render(icon(token("b")));
    await waitFor(() => expect(completions).toHaveLength(3));
    await act(async () => {
      completions[2]!({ ok: true, data: null });
    });
    expect(screen.getByTestId("native-icon").getAttribute("data-icon-source")).toBe("specific");
  });
  it("settles one Upgrade group to validated artwork and fallbacks", async () => {
    let finish!: (result: unknown) => void;
    vi.mocked(invoke)
      .mockReset()
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    render(
      <>
        {icon(token("a"))}
        {icon(token("b"))}
        {icon(token("c"))}
      </>,
    );
    expect(screen.getAllByTestId("native-icon-loading")).toHaveLength(3);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledExactlyOnceWith("upgrade_artwork_get", {
        tokens: [token("a"), token("b"), token("c")],
      }),
    );
    await act(async () =>
      finish({
        ok: true,
        data: [
          { token: token("a"), revision: "d".repeat(64), dataUrl: "data:image/png;base64,AQID" },
          null,
          { token: token("b"), revision: "d".repeat(64), dataUrl: "data:image/png;base64,AQID" },
        ],
      }),
    );
    const [first, second, third] = screen.getAllByTestId("native-icon");
    expect(second?.getAttribute("data-icon-source")).toBe("specific");
    expect(third?.getAttribute("data-icon-source")).toBe("specific");
    fireEvent.load(first!.querySelector("img")!);
    expect(screen.queryByTestId("native-icon-loading")).toBeNull();
  });
  it.each(["upgrade-artwork:forged", token("a")])("rejects cross-domain tokens: %s", (value) => {
    vi.mocked(invoke).mockReset();
    render(icon(value, "item"));
    expect(screen.getByTestId("native-icon").getAttribute("data-icon-source")).toBe("specific");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("uses the fallback for an unprepared cosmetic without issuing a browsing request", () => {
    vi.mocked(invoke).mockReset();
    render(icon(`cosmetic-artwork:${"d".repeat(32)}`, "cosmetic"));
    expect(screen.getByTestId("native-icon").getAttribute("data-icon-source")).toBe("specific");
    expect(screen.queryByTestId("native-icon-loading")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("cancels offscreen item artwork", async () => {
    const variant = "item";
    const sizeClass = "size-14";
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
      await waitFor(() =>
        expect(invoke).toHaveBeenCalledExactlyOnceWith(`${variant}_artwork_get`, { token: value }),
      );
      act(() => intersection(false));
      expect(invoke).toHaveBeenLastCalledWith(`${variant}_artwork_cancel`, { token: value });
      await act(async () => finish({ ok: true, data: null }));
      expect(screen.getByTestId("native-icon-loading")).toBeTruthy();
      expect(screen.getByTestId("native-icon").classList.contains(sizeClass)).toBe(true);
      act(() => intersection(true));
      await waitFor(() =>
        expect(invoke).toHaveBeenNthCalledWith(3, `${variant}_artwork_get`, { token: value }),
      );
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
