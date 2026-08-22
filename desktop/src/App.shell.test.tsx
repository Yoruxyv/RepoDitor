import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdvancedSaveDto,
  AssetPreparationState,
  DesktopOperationResult,
  PlayerUpgradeDto,
} from "@electron/contracts";
import App from "@/App";
import { TRANSLATIONS, type Locale } from "@/app/translations";
import {
  createRepoDitorApi as bridge,
  advanced,
  environment,
  players,
  readyAssets,
  openResult,
  upgrades,
  session,
} from "@/test/repoditorApiFixture";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const localeCases: ReadonlyArray<readonly [Locale, string]> = [
  ["en", "English"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["zh", "中文"],
  ["id", "Bahasa Indonesia"],
];

describe("app shell integration", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.repoditor = bridge(vi.fn());
  });

  it("keeps startup asset preparation silent while save discovery remains usable", async () => {
    const stillDiscovering: AssetPreparationState = {
      ...readyAssets,
      stage: "discovering",
      installationFound: false,
      buildVerified: false,
    };
    window.repoditor.assets.state = vi.fn().mockResolvedValue(stillDiscovering);
    window.repoditor.assets.onState = vi.fn((listener) => {
      listener(stillDiscovering);
      return () => undefined;
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: /Open workspace/ })).toBeTruthy();
    expect(screen.queryByTestId("asset-preparation")).toBeNull();
    expect(screen.queryByTestId("asset-preparation-notice")).toBeNull();
  });

  it("prepares every editor domain before first entry and reports the decoded game asset", async () => {
    let assetListener: ((state: AssetPreparationState) => void) | undefined;
    const preparation = deferred<DesktopOperationResult<PlayerUpgradeDto[]>>();
    window.repoditor = bridge(
      vi.fn().mockResolvedValue(openResult(session, "unresolved")),
      players,
    );
    window.repoditor.upgrades.prepareEntry = vi.fn(() => preparation.promise);
    window.repoditor.assets.onState = vi.fn((listener) => {
      assetListener = listener;
      listener(readyAssets);
      return () => undefined;
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));

    const preload = await screen.findByTestId("asset-preparation");
    expect(preload.getAttribute("data-entry-mode")).toBe("save");
    expect(screen.getByRole("heading", { name: "Opening save" })).toBeTruthy();
    expect(screen.getByTestId("entry-loading-detail").textContent).toContain(
      "Checking cached artwork and loading upgrade data",
    );
    expect(screen.queryByTestId("workspace")).toBeNull();
    expect(window.repoditor.players.list).toHaveBeenCalledTimes(1);
    expect(window.repoditor.run.get).toHaveBeenCalledTimes(1);
    expect(window.repoditor.advanced.get).toHaveBeenCalledTimes(1);
    expect(window.repoditor.maps.list).toHaveBeenCalledTimes(1);
    expect(window.repoditor.players.avatar).toHaveBeenCalledTimes(players.length);

    act(() =>
      assetListener?.({
        stage: "decoding",
        installationFound: true,
        buildVerified: true,
        completed: 0,
        total: 3,
        currentAsset: "Upgrade_Health_Albedo",
        currentAssetLabel: "Health",
        degraded: false,
      }),
    );
    expect(preload.getAttribute("data-entry-mode")).toBe("artwork");
    expect(screen.getByRole("heading", { name: "Preparing game artwork" })).toBeTruthy();
    expect(screen.getByTestId("entry-loading-detail").textContent).toBe(
      "Decoding Health upgrade artwork…",
    );
    expect(screen.queryByTestId("workspace")).toBeNull();

    act(() => assetListener?.(readyAssets));
    await act(async () => {
      preparation.resolve({ ok: true, data: upgrades });
    });

    expect(await screen.findByTestId("workspace")).toBeTruthy();
    expect(screen.queryByTestId("asset-preparation")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Players" }));
    expect(screen.queryByTestId("players-skeleton")).toBeNull();
    expect(screen.queryByTestId("player-avatar-skeleton")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    expect(screen.queryByTestId("upgrades-skeleton")).toBeNull();
    expect(screen.getByText("Strength")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Run" }));
    expect(screen.queryByTestId("run-skeleton")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Items" }));
    expect(screen.queryByTestId("items-skeleton")).toBeNull();
    expect(screen.getByText("Melee Inflatable Hammer")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Maps" }));
    expect(screen.queryByTestId("maps-skeleton")).toBeNull();
    expect(window.repoditor.upgrades.list).not.toHaveBeenCalled();
  });

  it("shows a fresh save-read state when reopening cached editor data", async () => {
    const preparation = deferred<DesktopOperationResult<PlayerUpgradeDto[]>>();
    const reopening = deferred<ReturnType<typeof openResult>>();
    const open = vi
      .fn()
      .mockResolvedValueOnce(openResult(session, "unresolved"))
      .mockImplementationOnce(() => reopening.promise);
    window.repoditor = bridge(open, players);
    window.repoditor.upgrades.prepareEntry = vi.fn(() => preparation.promise);
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByTestId("asset-preparation")).toBeTruthy();
    await act(async () => {
      preparation.resolve({ ok: true, data: upgrades });
    });
    expect(await screen.findByTestId("workspace")).toBeTruthy();

    const playerCalls = vi.mocked(window.repoditor.players.list).mock.calls.length;
    const avatarCalls = vi.mocked(window.repoditor.players.avatar).mock.calls.length;
    const runCalls = vi.mocked(window.repoditor.run.get).mock.calls.length;
    const itemCalls = vi.mocked(window.repoditor.advanced.get).mock.calls.length;
    const mapCalls = vi.mocked(window.repoditor.maps.list).mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Change save" }));
    expect(await screen.findByRole("button", { name: /Open workspace/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Open workspace/ }));
    const preload = await screen.findByTestId("asset-preparation");
    expect(preload.getAttribute("data-entry-mode")).toBe("save");
    expect(screen.getByRole("heading", { name: "Opening save" })).toBeTruthy();
    expect(screen.getByTestId("entry-loading-detail").textContent).toBe(
      "Reading and validating save data…",
    );
    expect(screen.queryByRole("heading", { name: "Preparing game artwork" })).toBeNull();
    expect(screen.queryByTestId("workspace")).toBeNull();

    await act(async () => {
      reopening.resolve(openResult(session, "ready"));
    });

    expect(await screen.findByTestId("workspace")).toBeTruthy();
    expect(screen.queryByTestId("asset-preparation")).toBeNull();
    expect(window.repoditor.players.list).toHaveBeenCalledTimes(playerCalls);
    expect(window.repoditor.players.avatar).toHaveBeenCalledTimes(avatarCalls);
    expect(window.repoditor.run.get).toHaveBeenCalledTimes(runCalls);
    expect(window.repoditor.advanced.get).toHaveBeenCalledTimes(itemCalls);
    expect(window.repoditor.maps.list).toHaveBeenCalledTimes(mapCalls);
    expect(window.repoditor.upgrades.prepareEntry).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("tab", { name: "Players" }));
    expect(screen.queryByTestId("players-skeleton")).toBeNull();
    expect(screen.queryByTestId("player-avatar-skeleton")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    expect(screen.queryByTestId("upgrades-skeleton")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Run" }));
    expect(screen.queryByTestId("run-skeleton")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Items" }));
    expect(screen.queryByTestId("items-skeleton")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Maps" }));
    expect(screen.queryByTestId("maps-skeleton")).toBeNull();
  });

  it("clears save-opening status when the authoritative open fails", async () => {
    const opening = deferred<DesktopOperationResult<ReturnType<typeof openResult>["data"]>>();
    window.repoditor = bridge(
      vi.fn(() => opening.promise),
      players,
    );
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));

    expect(await screen.findByRole("heading", { name: "Opening save" })).toBeTruthy();
    expect(screen.getByTestId("entry-loading-detail").textContent).toBe(
      "Reading and validating save data…",
    );
    expect(screen.queryByTestId("workspace")).toBeNull();

    await act(async () => {
      opening.resolve({
        ok: false,
        error: { code: "save_corrupt", message: "fixture failure" },
      });
    });

    expect(await screen.findByRole("button", { name: /Open workspace/ })).toBeTruthy();
    expect(screen.queryByTestId("asset-preparation")).toBeNull();
    expect(screen.queryByTestId("workspace")).toBeNull();
  });

  it("uses save-specific loading for a different save when game artwork is already ready", async () => {
    const secondSave = {
      ...environment.saves[0]!,
      id: "REPO_SAVE_2026_08_08_10_20_31",
      name: "2026-08-08 10:20:31",
      path: "C:\\fixture\\saves\\REPO_SAVE_2026_08_08_10_20_31\\REPO_SAVE_2026_08_08_10_20_31.es3",
      modifiedAt: "2026-08-08T10:20:31+00:00",
    };
    const secondSession = { ...session, ...secondSave, fingerprint: "b".repeat(64) };
    const environmentWithTwoSaves = { ...environment, saves: [environment.saves[0]!, secondSave] };
    const secondItems = deferred<DesktopOperationResult<AdvancedSaveDto>>();
    window.repoditor = bridge(
      vi.fn((saveId: string) =>
        Promise.resolve(
          saveId === session.id ? openResult(session, "ready") : openResult(secondSession, "ready"),
        ),
      ),
      players,
    );
    window.repoditor.environment.detect = vi
      .fn()
      .mockResolvedValue({ ok: true, data: environmentWithTwoSaves });
    window.repoditor.advanced.get = vi.fn((saveId: string) =>
      saveId === secondSession.id
        ? secondItems.promise
        : Promise.resolve({ ok: true as const, data: advanced }),
    );
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByTestId("workspace")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change save" }));

    const secondButton = (await screen.findByText(secondSave.name)).closest("button");
    expect(secondButton).not.toBeNull();
    await user.click(secondButton!);

    const preload = await screen.findByTestId("asset-preparation");
    expect(preload.getAttribute("data-entry-mode")).toBe("save");
    expect(screen.getByRole("heading", { name: "Opening save" })).toBeTruthy();
    expect(screen.getByTestId("entry-loading-detail").textContent).toContain("Loading item data");
    expect(screen.queryByRole("heading", { name: "Preparing game artwork" })).toBeNull();
    expect(window.repoditor.upgrades.prepareEntry).not.toHaveBeenCalled();

    await act(async () => {
      secondItems.resolve({ ok: true, data: advanced });
    });
    expect(await screen.findByRole("heading", { name: secondSession.name })).toBeTruthy();
    expect(screen.queryByTestId("asset-preparation")).toBeNull();
  });

  it("keeps slow cached-artwork upgrade loading inside the save-specific pre-entry phase", async () => {
    const upgradeLoad = deferred<DesktopOperationResult<PlayerUpgradeDto[]>>();
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult(session, "ready")), players);
    window.repoditor.upgrades.list = vi.fn(() => upgradeLoad.promise);
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));

    const preload = await screen.findByTestId("asset-preparation");
    expect(preload.getAttribute("data-entry-mode")).toBe("save");
    expect(screen.getByRole("heading", { name: "Opening save" })).toBeTruthy();
    expect(screen.getByTestId("entry-loading-detail").textContent).toContain(
      "Loading upgrade data",
    );
    expect(screen.queryByRole("heading", { name: "Preparing game artwork" })).toBeNull();
    expect(screen.queryByTestId("workspace")).toBeNull();
    expect(window.repoditor.upgrades.prepareEntry).not.toHaveBeenCalled();

    await act(async () => {
      upgradeLoad.resolve({ ok: true, data: upgrades });
    });
    expect(await screen.findByTestId("workspace")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Upgrades" }));
    expect(screen.queryByTestId("upgrades-skeleton")).toBeNull();
    expect(window.repoditor.upgrades.list).toHaveBeenCalledTimes(1);
  });

  it("keeps save editing available when optional game artwork preparation is degraded", async () => {
    window.repoditor = bridge(
      vi.fn().mockResolvedValue(openResult(session, "unresolved")),
      players,
    );
    const degradedAssets: AssetPreparationState = {
      stage: "degraded",
      installationFound: false,
      buildVerified: false,
      completed: null,
      total: null,
      currentAsset: null,
      currentAssetLabel: null,
      degraded: true,
    };
    window.repoditor.assets.state = vi.fn().mockResolvedValue(degradedAssets);
    window.repoditor.assets.onState = vi.fn((listener) => {
      listener(degradedAssets);
      return () => undefined;
    });
    window.repoditor.upgrades.prepareEntry = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "backend_unavailable", message: "offline" },
    });
    const user = userEvent.setup();

    render(<App />);

    expect(screen.queryByTestId("asset-preparation-notice")).toBeNull();
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByRole("heading", { name: session.name })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Upgrades" })).toBeTruthy();
    expect(screen.getByTestId("asset-preparation-notice")).toBeTruthy();
  });

  it("scopes degraded artwork and its dismissal to the opened save", async () => {
    const saveB = {
      ...session,
      id: "REPO_SAVE_2026_08_08_10_20_31",
      name: "Degraded B",
      path: "C:\\fixture\\saves\\B.es3",
      fingerprint: "b".repeat(64),
    };
    const saveA = {
      ...session,
      id: "REPO_SAVE_2026_08_08_10_20_32",
      name: "Healthy A",
      path: "C:\\fixture\\saves\\A.es3",
      fingerprint: "a".repeat(64),
    };
    const saveC = {
      ...session,
      id: "REPO_SAVE_2026_08_08_10_20_33",
      name: "Degraded C",
      path: "C:\\fixture\\saves\\C.es3",
      fingerprint: "c".repeat(64),
    };
    const summaries = [saveB, saveA, saveC].map((save) => ({
      id: save.id,
      name: save.name,
      path: save.path,
      modifiedAt: save.modifiedAt,
      sizeBytes: 1024,
    }));
    const sessions = new Map([
      [saveA.id, saveA],
      [saveB.id, saveB],
      [saveC.id, saveC],
    ]);
    window.repoditor = bridge(
      vi.fn((id: string) =>
        Promise.resolve(
          openResult(sessions.get(id) ?? saveC, id === saveA.id ? "ready" : "unresolved"),
        ),
      ),
      players,
    );
    window.repoditor.environment.detect = vi.fn().mockResolvedValue({
      ok: true,
      data: { ...environment, saves: summaries },
    });
    const degradedAssets: AssetPreparationState = {
      stage: "degraded",
      installationFound: true,
      buildVerified: true,
      completed: 1,
      total: 2,
      currentAsset: null,
      currentAssetLabel: null,
      degraded: true,
    };
    window.repoditor.assets.state = vi.fn().mockResolvedValue(degradedAssets);
    window.repoditor.assets.onState = vi.fn((listener) => {
      listener(degradedAssets);
      return () => undefined;
    });
    window.repoditor.upgrades.prepareEntry = vi
      .fn()
      .mockResolvedValue({ ok: true, data: upgrades });
    const user = userEvent.setup();
    render(<App />);

    const openSave = async (name: string) => {
      const button = (await screen.findByText(name)).closest("button");
      expect(button).not.toBeNull();
      await user.click(button!);
      await screen.findByRole("heading", { name });
    };

    await openSave(saveB.name);
    expect(screen.getByTestId("asset-preparation-notice")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Dismiss artwork warning" }));
    expect(screen.queryByTestId("asset-preparation-notice")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Change save" }));
    await openSave(saveA.name);
    expect(screen.queryByTestId("asset-preparation-notice")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Change save" }));
    await openSave(saveC.name);
    expect(screen.getByTestId("asset-preparation-notice")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Change save" }));
    await openSave(saveB.name);
    expect(screen.queryByTestId("asset-preparation-notice")).toBeNull();
  });

  it("presents release identity and project attribution", () => {
    render(<App />);

    expect(screen.getAllByText(`v${__APP_VERSION__}`).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("About RepoDitor").textContent).toContain(
      "Unofficial R.E.P.O. save utility",
    );
    expect(screen.getByRole("link", { name: "Project source" }).getAttribute("href")).toBe(
      "https://github.com/Yoruxyv/RepoDitor",
    );
  });

  it("renders GitHub stars and keeps the repository link usable when metadata fails", async () => {
    const metadata = vi.mocked(window.repoditor.project.metadata);
    const { unmount } = render(<App />);

    expect((await screen.findByTestId("github-stars")).textContent).toBe("42");
    expect(screen.getByRole("link", { name: /42 GitHub stars/ }).getAttribute("href")).toBe(
      "https://github.com/Yoruxyv/RepoDitor",
    );
    expect(screen.getByTestId("github-project-link").className).toContain("inline-flex");
    expect(screen.getByTestId("github-stars").className).toContain("xl:inline");
    unmount();

    metadata.mockResolvedValue({
      ok: false,
      error: { code: "backend_unavailable", message: "GitHub metadata is unavailable." },
    });
    render(<App />);
    expect(await screen.findByRole("link", { name: /star count unavailable/ })).toBeTruthy();
  });

  it("switches themes and restores the persisted preference", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    expect(document.documentElement.dataset.theme).toBe("light");
    await user.click(screen.getByRole("button", { name: "Theme: System" }));
    await user.click(screen.getByRole("option", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("repoditor.theme")).toBe("dark");
    unmount();

    render(<App />);
    expect(screen.getByRole("button", { name: "Theme: Dark" })).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("tracks operating-system theme changes when System is selected", async () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: (_type: string, next: (event: MediaQueryListEvent) => void) => {
          listener = next;
        },
        removeEventListener: vi.fn(),
      }),
    });
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => listener?.({ matches: true } as MediaQueryListEvent));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("repoditor.theme")).toBe("system");
  });

  it.each(localeCases)(
    "renders critical shell controls in the %s locale",
    async (locale, nativeName) => {
      localStorage.setItem("repoditor.locale", locale);
      render(<App />);

      expect(document.documentElement.lang).toBe(locale);
      expect(
        screen.getByRole("button", { name: TRANSLATIONS[locale]["app.runSaves"] }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: TRANSLATIONS[locale]["app.cosmetics"] }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", {
          name: `${TRANSLATIONS[locale]["utility.theme"]}: ${TRANSLATIONS[locale]["utility.theme.system"]}`,
        }),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: new RegExp(nativeName) })).toBeTruthy();
      expect(
        await screen.findByRole("button", { name: TRANSLATIONS[locale]["action.refresh"] }),
      ).toBeTruthy();
    },
  );

  it("switches and restores UI language while preserving game-derived strings", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue(openResult()), players);
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await user.click(screen.getByRole("button", { name: "Language: English" }));
    await user.click(screen.getByRole("option", { name: "日本語" }));
    expect(screen.getByRole("button", { name: "ランセーブ" })).toBeTruthy();
    expect(localStorage.getItem("repoditor.locale")).toBe("ja");
    expect(await screen.findByText(environment.saves[0]!.name)).toBeTruthy();

    await user.click((await screen.findByText("ワークスペースを開く")).closest("button")!);
    await user.click(await screen.findByRole("tab", { name: "アップグレード" }));
    expect(await screen.findByRole("spinbutton", { name: "Alpha の Strength" })).toBeTruthy();
    expect(screen.getByText("Strength")).toBeTruthy();
    unmount();

    render(<App />);
    expect(screen.getByRole("button", { name: "言語: 日本語" })).toBeTruthy();
  });
});
