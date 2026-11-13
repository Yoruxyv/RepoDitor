import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CosmeticsViewDto, DesktopOperationResult } from "@electron/contracts";
import { tauriReadApi } from "@/app/tauriReadApi";
import { disabledMeta, type MetaState } from "@/app/tauriMetaApi";
import { cosmetics, createRepoDitorApi } from "@/test/repoditorApiFixture";
import { renderWithPreferences } from "@/test/render";
import { TauriCosmeticsWorkspace } from "./TauriCosmeticsWorkspace";

vi.mock("@/app/tauriReadApi", () => ({ tauriReadApi: { cosmetics: { get: vi.fn() } } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function withArtwork(token: string, fingerprint: string) {
  return {
    ...cosmetics,
    fingerprint,
    cosmetics: [{ ...cosmetics.cosmetics[0]!, iconToken: token }, ...cosmetics.cosmetics.slice(1)],
  };
}

class VisibleArtworkObserver {
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  disconnect() {}
}

describe("native Cosmetics composition", () => {
  beforeEach(() => {
    window.repoditor = createRepoDitorApi(vi.fn());
    vi.mocked(invoke)
      .mockReset()
      .mockImplementation(async (command) =>
        command === "test_meta_state" ? disabledMeta() : undefined,
      );
    vi.mocked(tauriReadApi.cosmetics.get)
      .mockReset()
      .mockResolvedValue({ ok: true, data: cosmetics });
  });
  it("keeps retained rows usable while a revisit checks authority and replaces artwork", async () => {
    const firstToken = `cosmetic-artwork:${"a".repeat(32)}`;
    const nextToken = `cosmetic-artwork:${"b".repeat(32)}`;
    const currentMeta = deferred<MetaState>();
    const currentCatalog = deferred<DesktopOperationResult<CosmeticsViewDto>>();
    const artworkRequests: string[] = [];
    const get = vi.mocked(tauriReadApi.cosmetics.get);
    get
      .mockResolvedValueOnce({
        ok: true,
        data: withArtwork(firstToken, "a".repeat(64)),
      })
      .mockReturnValueOnce(currentCatalog.promise);
    let metaChecks = 0;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "test_meta_state")
        return ++metaChecks === 1 ? disabledMeta() : currentMeta.promise;
      if (command !== "cosmetic_artwork_get") return undefined;
      const token = String((args as { token?: unknown } | undefined)?.token);
      artworkRequests.push(token);
      return {
        ok: true,
        data: {
          token,
          revision: token.slice(-1).repeat(64),
          dataUrl: "data:image/png;base64,AAAA",
        },
      };
    });
    vi.stubGlobal("IntersectionObserver", VisibleArtworkObserver);
    try {
      const { rerender } = renderWithPreferences(
        <TauriCosmeticsWorkspace active recoveryGeneration={0} />,
      );
      const id = `cosmetic-icon-${cosmetics.cosmetics[0]!.id}`;
      const search = await screen.findByRole("searchbox");
      await waitFor(() => expect(artworkRequests).toEqual([firstToken]));
      expect(screen.getByText("Validated MetaSave")).toBeTruthy();
      rerender(<TauriCosmeticsWorkspace active={false} recoveryGeneration={0} />);
      expect(invoke).toHaveBeenCalledWith("cosmetic_artwork_cancel");
      rerender(<TauriCosmeticsWorkspace active recoveryGeneration={0} />);
      expect(screen.getByRole("searchbox")).toBe(search);
      expect(screen.getByText("Cosmetic #999")).toBeTruthy();
      expect(get).toHaveBeenCalledTimes(1);
      expect(artworkRequests).toEqual([firstToken]);
      expect(screen.getByTestId(`${id}-loading`).classList.contains("size-[48px]")).toBe(true);
      expect(screen.queryByTestId(id)).toBeNull();
      expect(screen.queryByText("Validated MetaSave")).toBeNull();

      await act(() => currentMeta.resolve(disabledMeta()));
      await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
      expect(screen.getByRole("searchbox")).toBe(search);
      expect(artworkRequests).toEqual([firstToken]);
      await act(() =>
        currentCatalog.resolve({ ok: true, data: withArtwork(nextToken, "b".repeat(64)) }),
      );
      await waitFor(() => expect(artworkRequests).toEqual([firstToken, nextToken]));
      await waitFor(() =>
        expect(screen.getByTestId(id).getAttribute("data-artwork-revision")).toBe("b".repeat(64)),
      );
      expect(screen.getByTestId(id).classList.contains("size-[48px]")).toBe(true);
      expect(get).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("waits for the latest visit after leaving during the previous authority check", async () => {
    const previous = deferred<MetaState>();
    const current = deferred<MetaState>();
    const checks = vi
      .fn()
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(current.promise);
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "test_meta_state" ? checks() : undefined,
    );
    const { rerender } = renderWithPreferences(
      <TauriCosmeticsWorkspace active recoveryGeneration={0} />,
    );
    await waitFor(() => expect(checks).toHaveBeenCalledTimes(1));
    rerender(<TauriCosmeticsWorkspace active={false} recoveryGeneration={0} />);
    rerender(<TauriCosmeticsWorkspace active recoveryGeneration={0} />);
    rerender(<TauriCosmeticsWorkspace active recoveryGeneration={1} />);
    expect(checks).toHaveBeenCalledTimes(1);
    await act(() => previous.resolve(disabledMeta()));
    await waitFor(() => expect(checks).toHaveBeenCalledTimes(2));
    expect(tauriReadApi.cosmetics.get).not.toHaveBeenCalled();
    await act(() => current.resolve(disabledMeta()));
    expect(await screen.findByRole("searchbox")).toBeTruthy();
    expect(tauriReadApi.cosmetics.get).toHaveBeenCalledTimes(1);
  });
  it("retains informational capabilities and catalog controls while omitting every mutation surface", async () => {
    renderWithPreferences(<TauriCosmeticsWorkspace active recoveryGeneration={0} />);
    expect(await screen.findByRole("searchbox", { name: "Search cosmetics" })).toBeTruthy();
    expect(screen.getByText("Cosmetic #999")).toBeTruthy();
    expect(screen.getByTestId("cosmetic-artwork-status").textContent).toMatch(/built-in icons/);
    expect(screen.getByTestId("cosmetic-icon-999").getAttribute("data-icon-source")).toBe(
      "fallback",
    );
    expect(
      screen.queryByRole("button", { name: /Unlock|Lock All|Clear Presets|Save|Revert/ }),
    ).toBeNull();
    expect(screen.queryByTestId("cosmetics-pending-bar")).toBeNull();
    expect(window.repoditor.cosmetics.get).not.toHaveBeenCalled();
    expect(window.repoditor.cosmetics.write).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "999" } });
    expect(screen.getByText("1 cosmetic")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(tauriReadApi.cosmetics.get).toHaveBeenCalledTimes(2));
    expect(window.repoditor.cosmetics.write).not.toHaveBeenCalled();
  });
  it("separates catalog validation from the active artwork request", async () => {
    const read = deferred<DesktopOperationResult<CosmeticsViewDto>>();
    const image = deferred<unknown>();
    const token = `cosmetic-artwork:${"f".repeat(32)}`;
    vi.mocked(tauriReadApi.cosmetics.get).mockReturnValueOnce(read.promise);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "test_meta_state") return disabledMeta();
      if (command === "cosmetic_artwork_get") return image.promise;
    });
    vi.stubGlobal("IntersectionObserver", VisibleArtworkObserver);
    try {
      renderWithPreferences(<TauriCosmeticsWorkspace active recoveryGeneration={0} />);
      expect(
        screen.getByText("Validating MetaSave and the installed cosmetic catalog…"),
      ).toBeTruthy();
      expect(screen.queryByTestId("cosmetic-artwork-status")).toBeNull();
      await act(() => read.resolve({ ok: true, data: withArtwork(token, "f".repeat(64)) }));
      expect(await screen.findByText("Loading images for visible cosmetics…")).toBeTruthy();
      expect(screen.getByRole("searchbox").matches(":disabled")).toBe(false);
      expect(
        screen.queryByText("Validating MetaSave and the installed cosmetic catalog…"),
      ).toBeNull();
      await act(() => image.resolve({ ok: true, data: null }));
      expect(screen.getByTestId("cosmetic-artwork-status").textContent).toMatch(/built-in icons/);
      const icon = screen.getByTestId(`cosmetic-icon-${cosmetics.cosmetics[0]!.id}`);
      expect(icon.dataset.iconSource).toBe("fallback");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
