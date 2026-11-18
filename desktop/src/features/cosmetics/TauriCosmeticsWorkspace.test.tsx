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

function withArtwork(versions: string[], fingerprint = "a") {
  return {
    ...cosmetics,
    fingerprint: fingerprint.repeat(64),
    cosmetics: cosmetics.cosmetics.map((row, index) => {
      const version = versions[index];
      return version
        ? {
            ...row,
            iconToken: "cosmetic-artwork:" + version.repeat(32),
            iconReuseKey: [fingerprint.repeat(64), row.id, version.repeat(64), "d".repeat(64)].join(
              ":",
            ),
          }
        : row;
    }),
  };
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
  it("prepares a complete batch before rendering and only fetches changed bindings on revisit", async () => {
    const first = withArtwork(["a", "b"]);
    const warm = withArtwork(["a", "b"], "b");
    const changed = withArtwork(["c", "b"], "b");
    const image = deferred<unknown>();
    const get = vi.mocked(tauriReadApi.cosmetics.get);
    get
      .mockResolvedValueOnce({ ok: true, data: first })
      .mockResolvedValueOnce({ ok: true, data: warm })
      .mockResolvedValueOnce({ ok: true, data: changed });
    const renderImage = (token: string) => ({
      token,
      revision: token.slice(-1).repeat(64),
      dataUrl: "data:image/png;base64,AAAA",
    });
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "test_meta_state") return disabledMeta();
      if (command !== "cosmetic_artwork_get") return undefined;
      const params = args as { token?: string; tokens?: string[] };
      if (params.tokens) return image.promise;
      return { ok: true, data: renderImage(params.token!) };
    });
    const { rerender } = renderWithPreferences(
      <TauriCosmeticsWorkspace active recoveryGeneration={0} />,
    );
    const [firstRow, secondRow] = first.cosmetics;
    const icon = () => screen.getByTestId("cosmetic-icon-" + firstRow!.id);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("cosmetic_artwork_get", {
        tokens: [firstRow!.iconToken, secondRow!.iconToken],
      }),
    );
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("heading", { name: "Preparing cosmetic artwork" })).toBeTruthy();
    await act(() =>
      image.resolve({
        ok: true,
        data: [firstRow, secondRow].map((row) => renderImage(row!.iconToken!)),
      }),
    );
    expect(await screen.findByRole("searchbox")).toBeTruthy();
    expect(icon().dataset.artworkRevision).toBe("a".repeat(64));
    expect(icon().querySelector("img")?.getAttribute("loading")).toBe("eager");
    expect(screen.queryByText(/images load as you browse/i)).toBeNull();
    rerender(<TauriCosmeticsWorkspace active={false} recoveryGeneration={0} />);
    expect(invoke).toHaveBeenCalledWith("cosmetic_artwork_cancel");
    rerender(<TauriCosmeticsWorkspace active recoveryGeneration={0} />);
    expect(await screen.findByRole("searchbox")).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "cosmetic_artwork_get"),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("searchbox")).toBeTruthy();
    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "cosmetic_artwork_get"),
    ).toHaveLength(2);
    expect(icon().dataset.artworkRevision).toBe("c".repeat(64));
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
    expect(screen.queryByText(/built-in icons/)).toBeNull();
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
  it("presents an explicit fallback after an unavailable image result", async () => {
    const view = withArtwork(["f"]);
    const read = deferred<DesktopOperationResult<CosmeticsViewDto>>();
    const image = deferred<unknown>();
    vi.mocked(tauriReadApi.cosmetics.get).mockReturnValueOnce(read.promise);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "test_meta_state") return disabledMeta();
      if (command === "cosmetic_artwork_get") return image.promise;
    });
    renderWithPreferences(<TauriCosmeticsWorkspace active recoveryGeneration={0} />);
    expect(screen.getByText("Checking saved cosmetic artwork…")).toBeTruthy();
    await act(() => read.resolve({ ok: true, data: view }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("cosmetic_artwork_get", {
        token: view.cosmetics[0]!.iconToken,
      }),
    );
    expect(screen.queryByRole("searchbox")).toBeNull();
    await act(() => image.resolve({ ok: true, data: null }));
    expect(await screen.findByRole("searchbox")).toBeTruthy();
    const icon = screen.getByTestId("cosmetic-icon-" + view.cosmetics[0]!.id);
    expect(icon.dataset.iconSource).toBe("fallback");
    expect(icon.getAttribute("aria-busy")).toBeNull();
  });
});
