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

  it("shows the preparation view only after a save is opened", async () => {
    let assetListener: ((state: AssetPreparationState) => void) | undefined;
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    window.repoditor.assets.onState = vi.fn((listener) => {
      assetListener = listener;
      listener(readyAssets);
      return () => undefined;
    });

    render(<App />);
    const openButton = await screen.findByRole("button", { name: /Open workspace/ });
    expect(screen.queryByTestId("asset-preparation")).toBeNull();

    fireEvent.click(openButton);
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

    expect(await screen.findByTestId("asset-preparation")).toBeTruthy();
  });

  it("allows entering the editor after the slow threshold while artwork continues in background", async () => {
    let assetListener: ((state: AssetPreparationState) => void) | undefined;
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    window.repoditor.assets.onState = vi.fn((listener) => {
      assetListener = listener;
      listener(readyAssets);
      return () => undefined;
    });
    render(<App />);
    const openButton = await screen.findByRole("button", { name: /Open workspace/ });

    vi.useFakeTimers();
    try {
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
      fireEvent.click(openButton);
      await act(async () => undefined);
      expect(screen.getByTestId("asset-preparation")).toBeTruthy();

      act(() => vi.advanceTimersByTime(6_000));
      fireEvent.click(screen.getByRole("button", { name: "Continue to editor" }));
      await act(async () => undefined);

      expect(screen.getByRole("heading", { name: session.name })).toBeTruthy();
      expect(screen.getByTestId("asset-preparation-notice").textContent).toContain("2 / 7 assets");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps save editing available when optional game artwork preparation is degraded", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
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
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
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
