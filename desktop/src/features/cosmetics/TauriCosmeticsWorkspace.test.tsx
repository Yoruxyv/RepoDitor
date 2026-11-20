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

  it.each([false, true])(
    "reconciles a single unlock and prepares artwork only on source drift (%s)",
    async (changed) => {
      const source = { ...withArtwork(["1", "2"]), artworkRevision: "3".repeat(64) };
      const next: CosmeticsViewDto = {
        ...cosmetics,
        artworkRevision: changed ? "4".repeat(64) : source.artworkRevision,
        fingerprint: "b".repeat(64),
        knownOwnedCount: 2,
        knownLockedCount: 0,
        cosmetics: cosmetics.cosmetics.map((row) =>
          row.id === 28 ? { ...row, state: "owned", owned: true } : row,
        ),
      };
      const initial: MetaState = {
        ...disabledMeta(),
        state: "idle",
        session: "editor",
        admission: {
          build: "26732417",
          identity: "production",
          manifest: "manifest",
          digest: "digest",
        },
        view: {
          ...cosmetics,
          fingerprint: source.fingerprint,
          artworkRevision: source.artworkRevision,
        },
      };
      let operationId = "";
      vi.mocked(invoke).mockImplementation(async (command, args) => {
        if (command === "test_meta_state") return disabledMeta();
        if (command === "production_meta_state") return initial;
        if (command === "production_meta_write") {
          operationId = (args as { request: { operationId: string } }).request.operationId;
          return {
            operationId,
            status: "applied",
            view: next,
            fingerprint: next.fingerprint,
            recoverySession: "proof",
          };
        }
        if (command === "production_meta_recover") {
          return {
            operationId,
            status: "applied",
            fingerprint: next.fingerprint,
            fresh: { ...initial, view: next },
          };
        }
        if (command === "cosmetic_artwork_get") {
          const { token, tokens } = args as { token?: string; tokens?: string[] };
          const image = (id: string) => ({
            token: id,
            revision: id.slice(-1).repeat(64),
            dataUrl: "data:image/png;base64,AAAA",
          });
          return { ok: true, data: tokens ? tokens.map(image) : image(token!) };
        }
      });
      const get = vi.mocked(tauriReadApi.cosmetics.get);
      get.mockResolvedValueOnce({ ok: true, data: source });
      get.mockResolvedValue({
        ok: true,
        data: { ...next, cosmetics: withArtwork(["5", "6"], "b").cosmetics },
      });
      renderWithPreferences(<TauriCosmeticsWorkspace active recoveryGeneration={0} />);
      const unlock = await screen.findByRole("button", { name: "Unlock Installed Cosmetic 28" });
      const icon = () => screen.getByTestId("cosmetic-icon-28").querySelector("img");
      const original = icon();
      expect(original).toBeTruthy();
      fireEvent.click(unlock);
      expect(screen.queryByRole("button", { name: "Unlock Installed Cosmetic 28" })).toBeNull();
      expect(get).toHaveBeenCalledOnce();
      const save = screen.getByRole("button", { name: "Save Changes" });
      fireEvent.click(save);
      fireEvent.click(save);
      fireEvent.click(screen.getAllByRole("button", { name: "Save Changes" }).at(-1)!);
      await screen.findByText(/Changes saved and verified/);
      if (changed) {
        await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
      } else {
        expect(get).toHaveBeenCalledOnce();
        expect(icon()).toBe(original);
        expect(screen.queryByRole("heading", { name: "Preparing cosmetic artwork" })).toBeNull();
      }
    },
  );
  it("prepares a complete batch before rendering and only fetches changed bindings on revisit", async () => {
    const first = withArtwork(["a", "b"]);
    const warm = deferred<DesktopOperationResult<CosmeticsViewDto>>();
    const changed = withArtwork(["c", "b"], "b");
    const image = deferred<unknown>();
    const changedImage = deferred<unknown>();
    const get = vi.mocked(tauriReadApi.cosmetics.get);
    get
      .mockResolvedValueOnce({ ok: true, data: first })
      .mockReturnValueOnce(warm.promise)
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
      if (params.token && params.token === changed.cosmetics[0]?.iconToken)
        return changedImage.promise;
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
    expect(await screen.findByRole("heading", { name: "Preparing cosmetic artwork" })).toBeTruthy();
    await act(() =>
      image.resolve({
        ok: true,
        data: [firstRow, secondRow].map((row) => renderImage(row!.iconToken!)),
      }),
    );
    expect(await screen.findByRole("searchbox")).toBeTruthy();
    expect(icon().dataset.artworkRevision).toBe("a".repeat(64));
    expect(icon().querySelector("img")?.getAttribute("loading")).toBe("eager");
    const preparedImage = icon().querySelector("img");
    expect(screen.queryByText(/images load as you browse/i)).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: firstRow!.displayName } });
    rerender(<TauriCosmeticsWorkspace active={false} recoveryGeneration={0} />);
    expect(invoke).toHaveBeenCalledWith("cosmetic_artwork_cancel");
    rerender(<TauriCosmeticsWorkspace active recoveryGeneration={0} />);
    expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe(firstRow!.displayName);
    expect(screen.queryByTestId("cosmetics-skeleton")).toBeNull();
    expect(icon().dataset.artworkRevision).toBe("a".repeat(64));
    expect(icon().querySelector("img")).toBe(preparedImage);
    expect(screen.queryByRole("heading", { name: "Preparing cosmetic artwork" })).toBeNull();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await act(() =>
      warm.resolve({
        ok: true,
        data: {
          ...first,
          cosmetics: first.cosmetics.map((row, index) =>
            row.iconToken
              ? {
                  ...row,
                  iconToken: "cosmetic-artwork:" + String(index + 1).repeat(32),
                }
              : row,
          ),
        },
      }),
    );
    expect(icon().querySelector("img")).toBe(preparedImage);
    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "cosmetic_artwork_get"),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("heading", { name: "Preparing cosmetic artwork" })).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    await act(() =>
      changedImage.resolve({
        ok: true,
        data: renderImage(changed.cosmetics[0]!.iconToken!),
      }),
    );
    await waitFor(() => expect(icon().dataset.artworkRevision).toBe("c".repeat(64)));
    expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe(firstRow!.displayName);
    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "cosmetic_artwork_get"),
    ).toHaveLength(2);
  });
  it("preserves a complete catalog on a transient recheck failure and hides a confirmed missing source", async () => {
    const get = vi.mocked(tauriReadApi.cosmetics.get);
    get
      .mockResolvedValueOnce({ ok: true, data: cosmetics })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "process_timeout", message: "private diagnostic" },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "meta_missing", message: "private diagnostic" },
      });
    renderWithPreferences(<TauriCosmeticsWorkspace active recoveryGeneration={0} />);
    const search = await screen.findByRole("searchbox");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect((await screen.findByRole("alert")).textContent).not.toContain("private diagnostic");
    expect(screen.getByRole("searchbox")).toBe(search);
    expect(screen.queryByTestId("cosmetics-skeleton")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("MetaSave.es3 could not be found.")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
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
  it.each([true, false])(
    "requires a matching fingerprint (%s) for display-only metadata",
    async (matches) => {
      const view = {
        ...cosmetics,
        catalogAvailable: false,
        knownCatalogCount: 0,
        knownOwnedCount: 0,
        knownLockedCount: 0,
        cosmetics: cosmetics.cosmetics.filter((row) => !row.known),
      };
      const state: MetaState = { ...disabledMeta(), state: "idle", view };
      vi.mocked(invoke).mockImplementation(async (command) =>
        command === "production_meta_state" ? state : disabledMeta(),
      );
      vi.mocked(tauriReadApi.cosmetics.get).mockResolvedValue({
        ok: true,
        data: { ...cosmetics, fingerprint: matches ? view.fingerprint : "b".repeat(64) },
      });

      renderWithPreferences(<TauriCosmeticsWorkspace active recoveryGeneration={0} />);
      expect(await screen.findByRole("searchbox")).toBeTruthy();
      await waitFor(() => {
        expect(
          screen.getByText("Known catalog", { selector: "dt" }).nextElementSibling?.textContent,
        ).toBe(matches ? "2" : "Unknown");
      });
      expect(
        screen.queryByRole("button", { name: /Unlock|Lock All|Clear All Presets|Save Changes/ }),
      ).toBeNull();
    },
  );
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
    expect(screen.queryByText("Checking saved cosmetic artwork…")).toBeNull();
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

  it("explains a confirmed installed-layout restriction without removing inspectable IDs", async () => {
    vi.mocked(tauriReadApi.cosmetics.get).mockResolvedValue({
      ok: true,
      data: { ...cosmetics, catalogAvailable: false, catalogIssue: "incompatible" },
    });
    renderWithPreferences(
      <TauriCosmeticsWorkspace
        active
        recoveryGeneration={0}
        compatibility={{
          gameDetected: true,
          healthWriteCompatibility: {
            buildId: "26732417",
            status: "unsupported",
            supported: false,
          },
        }}
      />,
    );
    expect(
      await screen.findByText(/assets or save structure could not be read safely/),
    ).toBeTruthy();
    expect(screen.getByText("Cosmetic #999")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unlock All Cosmetics" })).toBeNull();
  });
});
