import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetPreparationState } from "@electron/contracts";
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
) {
  return render(
    <PreferencesProvider>
      <AssetPreparationView
        mode={mode}
        state={value}
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

    expect(screen.queryByRole("progressbar")).toBeNull();
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

    expect(screen.queryByRole("progressbar")).toBeNull();
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

    expect(screen.queryByRole("progressbar")).toBeNull();
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
    expect(screen.queryByRole("progressbar")).toBeNull();
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
    expect(screen.queryByRole("progressbar")).toBeNull();
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
