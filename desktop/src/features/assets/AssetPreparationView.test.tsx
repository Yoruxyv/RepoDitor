import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetPreparationState } from "@/app/desktopContracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { AssetPreparationNotice, AssetPreparationView } from "./AssetPreparationView";

function state(overrides: Partial<AssetPreparationState> = {}): AssetPreparationState {
  return {
    stage: "discovering",
    installationFound: false,
    buildVerified: false,
    completed: null,
    total: null,
    currentAsset: null,
    currentAssetLabel: null,
    degraded: false,
    ...overrides,
  };
}

function renderView(
  value: AssetPreparationState,
  mode: "save" | "artwork" = "artwork",
  saveDetail?: string,
  onContinue?: () => void,
  editorProgress?: { readonly completed: number; readonly total: number } | null,
  artworkDetail?: boolean,
) {
  return render(
    <PreferencesProvider>
      <AssetPreparationView
        mode={mode}
        state={value}
        {...(editorProgress === undefined ? {} : { editorProgress })}
        {...(artworkDetail === undefined ? {} : { artworkDetail })}
        {...(saveDetail === undefined ? {} : { saveDetail })}
        {...(onContinue === undefined ? {} : { onContinue })}
      />
    </PreferencesProvider>,
  );
}

describe("AssetPreparationView", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses an indeterminate presentation until the real work-unit total is known", () => {
    renderView(state({ stage: "validating", installationFound: true }));

    const progress = screen.getByRole("progressbar", {
      name: "Game asset preparation progress",
    });
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
    expect(screen.getByRole("heading", { name: "Preparing game artwork" })).toBeTruthy();
    expect(screen.getByTestId("entry-loading-detail").textContent).toBe(
      "Validating installed build",
    );
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByTestId("asset-preparation").getAttribute("aria-busy")).toBe("true");
  });

  it("reveals real completed/total progress only after the visual threshold", () => {
    vi.useFakeTimers();
    renderView(
      state({
        stage: "decoding",
        installationFound: true,
        buildVerified: true,
        completed: 4,
        total: 7,
      }),
    );

    expect(
      screen
        .getByRole("progressbar", { name: "Game asset preparation progress" })
        .hasAttribute("aria-valuenow"),
    ).toBe(false);
    expect(screen.queryByTestId("asset-progress-count")).toBeNull();
    expect(screen.getByTestId("asset-progress-status").textContent).toContain("Working");

    act(() => vi.advanceTimersByTime(500));

    const progress = screen.getByRole("progressbar", { name: "Game asset preparation progress" });
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("7");
    expect(progress.getAttribute("aria-valuenow")).toBe("4");
    expect(progress.getAttribute("aria-valuetext")).toBe("4 / 7 assets");
    expect(screen.getByTestId("asset-progress-count").textContent).toBe("4 / 7 assets");
  });

  it("does not flash detailed progress for an ultra-short preparation stage", () => {
    vi.useFakeTimers();
    const { rerender } = renderView(
      state({
        stage: "decoding",
        installationFound: true,
        buildVerified: true,
        completed: 1,
        total: 2,
      }),
    );
    const progressRegion = screen.getByTestId("asset-progress");
    const statusRegion = screen.getByTestId("asset-progress-status");

    act(() => vi.advanceTimersByTime(250));
    rerender(
      <PreferencesProvider>
        <AssetPreparationView
          state={state({
            stage: "ready",
            installationFound: true,
            buildVerified: true,
            completed: null,
            total: null,
          })}
        />
      </PreferencesProvider>,
    );
    act(() => vi.advanceTimersByTime(500));

    expect(
      screen
        .getByRole("progressbar", { name: "Game asset preparation progress" })
        .hasAttribute("aria-valuenow"),
    ).toBe(false);
    expect(screen.queryByTestId("asset-progress-count")).toBeNull();
    expect(screen.getByTestId("asset-progress")).toBe(progressRegion);
    expect(screen.getByTestId("asset-progress-status")).toBe(statusRegion);
  });

  it("uses an informative indeterminate shell for save-specific editor loading", () => {
    renderView(
      state({ stage: "ready", installationFound: true, buildVerified: true }),
      "save",
      "Loading item data…",
    );

    const heading = screen.getByRole("heading", { name: "Opening save" });
    expect(heading).toBeTruthy();
    expect(heading.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByTestId("entry-loading-detail").textContent).toBe("Loading item data…");
    expect(screen.getByTestId("asset-preparation").getAttribute("data-entry-mode")).toBe("save");
    expect(screen.getByTestId("asset-progress-status").textContent).toContain("Working");
    const progress = screen.getByRole("progressbar", { name: "Editor preparation progress" });
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
  });

  it("shows real editor task progress immediately and fills the existing segmented bar", () => {
    renderView(state({ stage: "ready" }), "save", "Loading player data…", undefined, {
      completed: 3,
      total: 6,
    });

    const progress = screen.getByRole("progressbar", { name: "Editor preparation progress" });
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("6");
    expect(progress.getAttribute("aria-valuenow")).toBe("3");
    expect(progress.getAttribute("aria-valuetext")).toBe("3 of 6 editor tasks completed");
    expect(screen.getByTestId("asset-progress-count").textContent).toBe(
      "3 of 6 editor tasks completed",
    );
    expect(progress.querySelectorAll(".bg-accent")).toHaveLength(9);
  });

  it("keeps compact progress static until completed work advances the fill", () => {
    const view = (completed: number | null, text = "") => (
      <PreferencesProvider>
        <AssetPreparationView
          compact
          mode="save"
          editorProgress={completed === null ? null : { completed, total: 2 }}
          progressText={text}
        />
      </PreferencesProvider>
    );
    const { rerender } = render(view(null));
    const bar = screen.getByRole("progressbar");
    expect(bar.querySelector(".asset-preparation-sweep")).toBeNull();
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
    rerender(view(1, "Editor data 5/5"));
    expect(bar.querySelectorAll(".bg-accent")).toHaveLength(9);

    rerender(view(1, "Editor data 5/5 · Artwork checked 0/64"));
    expect(screen.getByRole("progressbar")).toBe(bar);
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.querySelectorAll(".bg-accent")).toHaveLength(9);
    expect(screen.getByTestId("asset-progress-count").textContent).toContain(
      "Artwork checked 0/64",
    );

    rerender(view(1 + 63 / 64, "Editor data 5/5 · Artwork checked 63/64"));
    expect(bar.querySelectorAll(".bg-accent")).toHaveLength(17);

    rerender(view(2, "Editor data 5/5 · Artwork checked 64/64"));
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.querySelectorAll(".bg-accent")).toHaveLength(18);
    expect(bar.querySelector(".asset-preparation-sweep")).toBeNull();
  });

  it("keeps artwork counts secondary to editor-task progress", () => {
    renderView(
      state({
        stage: "decoding",
        completed: 8,
        total: 12,
        currentAssetLabel: "Health",
      }),
      "save",
      "Loading upgrade data…",
      undefined,
      { completed: 2, total: 6 },
      true,
    );

    expect(screen.getByTestId("entry-loading-detail").textContent).toBe(
      "Decoding Health upgrade artwork…",
    );
    expect(screen.getByText("2 of 6 editor tasks completed")).toBeTruthy();
    expect(screen.getByText("8 of 12 upgrade assets prepared · Health")).toBeTruthy();
  });

  it("does not invent a secondary artwork count when none is reported", () => {
    renderView(
      state({ stage: "resolving", completed: null, total: null }),
      "save",
      "Loading upgrade data…",
      undefined,
      { completed: 2, total: 6 },
      true,
    );

    expect(screen.queryByText(/upgrade assets prepared/)).toBeNull();
    expect(screen.getByTestId("entry-loading-detail").textContent).toBe(
      "Preparing upgrade artwork…",
    );
  });

  it("changes to useful slow artwork copy with real counts", () => {
    vi.useFakeTimers();
    renderView(
      state({ stage: "decoding", completed: 8, total: 12 }),
      "save",
      "Loading upgrade data…",
      undefined,
      { completed: 2, total: 6 },
      true,
    );

    expect(screen.getByText("Preparing local editor data.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByText("Still working — preparing upgrade artwork (8 of 12).")).toBeTruthy();
  });

  it("uses calm generic slow copy when artwork is not the active work", () => {
    vi.useFakeTimers();
    renderView(state({ stage: "ready" }), "save", "Loading map data…", undefined, {
      completed: 4,
      total: 6,
    });

    expect(screen.getByText("Preparing local editor data.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(6_000));
    expect(
      screen.getByText("Still working — some local game data can take longer to prepare."),
    ).toBeTruthy();
  });

  it("shows the actual decoded texture name without duplicating the big title", () => {
    renderView(
      state({
        stage: "decoding",
        installationFound: true,
        buildVerified: true,
        completed: 1,
        total: 3,
        currentAsset: "Upgrade_Health_Albedo",
        currentAssetLabel: "Health",
      }),
    );

    expect(screen.getByRole("heading", { name: "Preparing game artwork" })).toBeTruthy();
    expect(screen.getByTestId("entry-loading-detail").textContent).toBe(
      "Decoding Health upgrade artwork…",
    );
  });

  it("offers a bounded editor escape after the slow threshold without inventing progress", () => {
    vi.useFakeTimers();
    const onContinue = vi.fn();
    renderView(state(), "artwork", undefined, onContinue);

    expect(screen.getByText(/Reading your local installation/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue to editor" })).toBeNull();
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByText(/first scan can take a little longer/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Continue to editor" });
    fireEvent.click(button);
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("progressbar", { name: "Game asset preparation progress" })
        .hasAttribute("aria-valuenow"),
    ).toBe(false);
  });

  it("shows real background preparation status after the editor escape", () => {
    render(
      <PreferencesProvider>
        <AssetPreparationNotice
          state={state({
            stage: "decoding",
            installationFound: true,
            buildVerified: true,
            completed: 4,
            total: 7,
          })}
          showPreparing
        />
      </PreferencesProvider>,
    );

    const notice = screen.getByTestId("asset-preparation-notice");
    expect(notice.textContent).toContain("Game artwork is still preparing.");
    expect(notice.textContent).toContain("4 / 7 assets");
  });

  it("keeps degraded artwork status nonblocking and explains the structured reason", () => {
    const onDismiss = vi.fn();
    render(
      <PreferencesProvider>
        <AssetPreparationNotice
          state={state({ stage: "degraded", degraded: true })}
          onDismiss={onDismiss}
        />
      </PreferencesProvider>,
    );

    const notice = screen.getByTestId("asset-preparation-notice");
    expect(notice.textContent).toContain("Game artwork unavailable.");
    expect(notice.textContent).toContain("R.E.P.O. was not detected");
    const dismiss = screen.getByRole("button", { name: "Dismiss artwork warning" });
    dismiss.focus();
    expect(document.activeElement).toBe(dismiss);
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
