import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssetPreparationState } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import {
  AssetPreparationNotice,
  AssetPreparationView,
} from "./AssetPreparationView";

function state(overrides: Partial<AssetPreparationState> = {}): AssetPreparationState {
  return {
    stage: "discovering",
    installationFound: false,
    buildVerified: false,
    completed: null,
    total: null,
    degraded: false,
    ...overrides,
  };
}

function renderView(
  value: AssetPreparationState,
  waitingForUpgradeDiscovery = false,
  onContinue?: () => void,
) {
  return render(
    <PreferencesProvider>
      <AssetPreparationView
        state={value}
        waitingForUpgradeDiscovery={waitingForUpgradeDiscovery}
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
    expect(screen.getByRole("heading", { name: "Validating installed build" })).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByTestId("asset-preparation").getAttribute("aria-busy")).toBe("true");
  });

  it("exposes real completed/total progress with progressbar semantics", () => {
    renderView(state({
      stage: "decoding",
      installationFound: true,
      buildVerified: true,
      completed: 4,
      total: 7,
    }));

    const progress = screen.getByRole("progressbar", { name: "Game asset preparation progress" });
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("7");
    expect(progress.getAttribute("aria-valuenow")).toBe("4");
    expect(progress.getAttribute("aria-valuetext")).toBe("4 / 7 assets");
    expect(screen.getByTestId("asset-progress-count").textContent).toBe("4 / 7 assets");
  });

  it("describes save upgrade discovery without inventing a backend preparation stage", () => {
    renderView(state({
      stage: "ready",
      installationFound: true,
      buildVerified: true,
    }), true);

    expect(screen.getAllByText("Reading save upgrade identities").length).toBeGreaterThan(0);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("offers a bounded editor escape after the slow threshold without inventing progress", () => {
    vi.useFakeTimers();
    const onContinue = vi.fn();
    renderView(state(), false, onContinue);

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
    render(
      <PreferencesProvider>
        <AssetPreparationNotice state={state({ stage: "degraded", degraded: true })} />
      </PreferencesProvider>,
    );

    const notice = screen.getByTestId("asset-preparation-notice");
    expect(notice.textContent).toContain("Game artwork unavailable.");
    expect(notice.textContent).toContain("R.E.P.O. was not detected");
  });
});
