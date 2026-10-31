import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CosmeticArtworkPreparationState } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { CosmeticArtworkPreparation } from "./CosmeticArtworkPreparation";

const preparing: CosmeticArtworkPreparationState = {
  phase: "preparing",
  completed: 119,
  total: 557,
  cached: 12,
  failed: 0,
};

function renderPreparation(compact: boolean) {
  const onContinueInBackground = vi.fn();
  const onShowProgress = vi.fn();
  render(
    <PreferencesProvider>
      <CosmeticArtworkPreparation
        compact={compact}
        state={preparing}
        onContinueInBackground={onContinueInBackground}
        onShowProgress={onShowProgress}
      />
    </PreferencesProvider>,
  );
  return { onContinueInBackground, onShowProgress };
}

describe("CosmeticArtworkPreparation", () => {
  it("reuses the actual save-preparation panel and permits immediate continuation", () => {
    const { onContinueInBackground } = renderPreparation(false);
    expect(screen.getByTestId("cosmetic-artwork-preparation")).toBeTruthy();
    expect(screen.getByTestId("asset-preparation")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Preparing cosmetic artwork" })).toBeTruthy();
    expect(screen.getByTestId("asset-progress")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue in background" }));
    expect(onContinueInBackground).toHaveBeenCalledTimes(1);
  });

  it("uses only a compact status strip once the catalog is available", () => {
    const { onShowProgress } = renderPreparation(true);
    expect(screen.getByTestId("cosmetic-artwork-compact")).toBeTruthy();
    expect(screen.queryByTestId("asset-preparation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show artwork progress" }));
    expect(onShowProgress).toHaveBeenCalledTimes(1);
  });
});
