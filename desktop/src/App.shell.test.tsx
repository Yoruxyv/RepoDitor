import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssetPreparationState } from "@electron/contracts";
import App from "@/App";
import { TRANSLATIONS, type Locale } from "@/app/translations";
import {
  createRepoDitorApi as bridge,
  environment,
  players,
  readyAssets,
  openResult,
  requiredUpgradeVisualKeys,
  session,
} from "@/test/repoditorApiFixture";

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

  it("keeps first-time artwork preparation as a pre-entry screen", async () => {
    let assetListener: ((state: AssetPreparationState) => void) | undefined;
    let finishPreparation:
      | ((value: Awaited<ReturnType<typeof window.repoditor.upgrades.prepareEntry>>) => void)
      | undefined;
    window.repoditor = bridge(
      vi.fn().mockResolvedValue(openResult(session, "unresolved")),
      players,
    );
    window.repoditor.upgrades.prepareEntry = vi.fn(
      () =>
        new Promise((resolve) => {
          finishPreparation = resolve;
        }),
    );
    window.repoditor.assets.onState = vi.fn((listener) => {
      assetListener = listener;
      listener(readyAssets);
      return () => undefined;
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));

    expect(await screen.findByTestId("asset-preparation")).toBeTruthy();
    expect(screen.queryByTestId("workspace")).toBeNull();
    expect(window.repoditor.upgrades.prepareEntry).toHaveBeenCalledWith(
      session.id,
      requiredUpgradeVisualKeys,
    );

    act(() =>
      assetListener?.({
        stage: "decoding",
        installationFound: true,
        buildVerified: true,
        completed: 0,
        total: 3,
        degraded: false,
      }),
    );
    expect(screen.getByRole("heading", { name: "Decoding local upgrade art" })).toBeTruthy();
    expect(screen.queryByTestId("workspace")).toBeNull();

    act(() => assetListener?.(readyAssets));
    await act(async () => {
      finishPreparation?.({ ok: true, data: [] });
    });

    expect(await screen.findByTestId("workspace")).toBeTruthy();
    expect(screen.queryByTestId("asset-preparation")).toBeNull();
    expect(window.repoditor.upgrades.list).not.toHaveBeenCalled();
  });

  it(
    "skips the pre-entry screen when the same save reopens with source-valid cached artwork",
    async () => {
      let finishPreparation:
        | ((value: Awaited<ReturnType<typeof window.repoditor.upgrades.prepareEntry>>) => void)
        | undefined;
      const open = vi
        .fn()
        .mockResolvedValueOnce(openResult(session, "unresolved"))
        .mockResolvedValueOnce(openResult(session, "ready"));
      window.repoditor = bridge(open, players);
      window.repoditor.upgrades.prepareEntry = vi.fn(
        () =>
          new Promise((resolve) => {
            finishPreparation = resolve;
          }),
      );
      const user = userEvent.setup();

      render(<App />);
      await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
      expect(await screen.findByTestId("asset-preparation")).toBeTruthy();
      await act(async () => {
        finishPreparation?.({ ok: true, data: [] });
      });
      expect(await screen.findByTestId("workspace")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Change save" }));
      expect(await screen.findByRole("button", { name: /Open workspace/ })).toBeTruthy();

      let preloadObserved = false;
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-testid="asset-preparation"]') !== null) {
          preloadObserved = true;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      try {
        await user.click(screen.getByRole("button", { name: /Open workspace/ }));
        expect(await screen.findByTestId("workspace")).toBeTruthy();
        expect(screen.queryByTestId("asset-preparation")).toBeNull();
        expect(preloadObserved).toBe(false);
        expect(window.repoditor.upgrades.prepareEntry).toHaveBeenCalledTimes(1);
      } finally {
        observer.disconnect();
      }
    },
  );

  it("reuses cached presentation readiness across a different save", async () => {
    const secondSave = {
      ...environment.saves[0]!,
      id: "REPO_SAVE_2026_08_08_10_20_31",
      name: "2026-08-08 10:20:31",
      path: "C:\\fixture\\saves\\REPO_SAVE_2026_08_08_10_20_31\\REPO_SAVE_2026_08_08_10_20_31.es3",
      modifiedAt: "2026-08-08T10:20:31+00:00",
    };
    const secondSession = {
      ...session,
      ...secondSave,
    };
    const environmentWithTwoSaves = { ...environment, saves: [environment.saves[0]!, secondSave] };
    const open = vi.fn((saveId: string) =>
      Promise.resolve(
        saveId === session.id
          ? openResult(session, "ready")
          : openResult(secondSession, "ready"),
      ),
    );
    window.repoditor = bridge(open, players);
    window.repoditor.environment.detect = vi
      .fn()
      .mockResolvedValue({ ok: true, data: environmentWithTwoSaves });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByTestId("workspace")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change save" }));

    const secondButton = (await screen.findByText(secondSave.name)).closest("button");
    expect(secondButton).not.toBeNull();
    await user.click(secondButton!);

    expect(await screen.findByRole("heading", { name: secondSession.name })).toBeTruthy();
    expect(screen.queryByTestId("asset-preparation")).toBeNull();
    expect(window.repoditor.upgrades.prepareEntry).not.toHaveBeenCalled();
  });

  it(
    "does not mislabel slow upgrades domain loading as artwork preparation once readiness is known",
    async () => {
      window.repoditor = bridge(vi.fn().mockResolvedValue(openResult(session, "ready")), players);
      window.repoditor.upgrades.list = vi.fn(() => new Promise(() => undefined));
      const user = userEvent.setup();

      render(<App />);
      await user.click(await screen.findByRole("button", { name: /Open workspace/ }));

      expect(await screen.findByTestId("workspace")).toBeTruthy();
      expect(screen.queryByTestId("asset-preparation")).toBeNull();
      expect(window.repoditor.upgrades.prepareEntry).not.toHaveBeenCalled();

      await user.click(screen.getByRole("tab", { name: "Upgrades" }));
      expect(screen.getByTestId("upgrades-skeleton")).toBeTruthy();
      expect(screen.queryByTestId("asset-preparation")).toBeNull();
    },
  );

  it(
    "allows entering the editor after the slow threshold while real preparation continues",
    async () => {
      let assetListener: ((state: AssetPreparationState) => void) | undefined;
      window.repoditor = bridge(
        vi.fn().mockResolvedValue(openResult(session, "unresolved")),
        players,
      );
      window.repoditor.upgrades.prepareEntry = vi.fn(() => new Promise(() => undefined));
      window.repoditor.assets.onState = vi.fn((listener) => {
        assetListener = listener;
        listener(readyAssets);
        return () => undefined;
      });
      render(<App />);
      const openButton = await screen.findByRole("button", { name: /Open workspace/ });

      vi.useFakeTimers();
      try {
        fireEvent.click(openButton);
        await act(async () => undefined);
        act(() =>
          assetListener?.({
            stage: "decoding",
            installationFound: true,
            buildVerified: true,
            completed: 2,
            total: 7,
            degraded: false,
          }),
        );
        expect(screen.getByTestId("asset-preparation")).toBeTruthy();
        expect(screen.queryByTestId("workspace")).toBeNull();

        act(() => vi.advanceTimersByTime(6_000));
        fireEvent.click(screen.getByRole("button", { name: "Continue to editor" }));
        await act(async () => undefined);

        expect(screen.getByRole("heading", { name: session.name })).toBeTruthy();
        expect(screen.queryByTestId("asset-preparation")).toBeNull();
        expect(screen.getByTestId("asset-preparation-notice").textContent).toContain(
          "2 / 7 assets",
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );

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
      degraded: true,
    };
    window.repoditor.assets.state = vi.fn().mockResolvedValue(degradedAssets);
    window.repoditor.assets.onState = vi.fn((listener) => {
      listener(degradedAssets);
      return () => undefined;
    });
    window.repoditor.upgrades.prepareEntry = vi
      .fn()
      .mockResolvedValue({
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
