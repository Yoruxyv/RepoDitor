import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CosmeticArtworkPreparationState } from "@electron/contracts";
import App from "@/App";
import { createRepoDitorApi } from "@/test/repoditorApiFixture";

const state = (
  phase: CosmeticArtworkPreparationState["phase"],
  cached = 0,
): CosmeticArtworkPreparationState => ({ phase, cached, total: 557, completed: cached, failed: 0 });

describe("cosmetic catalog artwork readiness", () => {
  beforeEach(() => {
    localStorage.clear();
    window.repoditor = createRepoDitorApi(vi.fn());
  });

  it.each(["idle", "checking", "ready", "degraded"] as const)(
    "opens the catalog directly during %s, including tab reentry and remount",
    async (phase) => {
      vi.mocked(window.repoditor.cosmetics.artworkState).mockResolvedValue(
        state(phase, phase === "ready" ? 557 : 0),
      );
      const user = userEvent.setup();
      const first = render(<App />);
      await user.click(screen.getByRole("button", { name: "Cosmetics" }));
      await screen.findByRole("heading", { name: "Cosmetics" });
      expect(screen.queryByTestId("cosmetic-artwork-preparation")).toBeNull();
      await user.click(screen.getByRole("button", { name: "Run Saves" }));
      await user.click(screen.getByRole("button", { name: "Cosmetics" }));
      expect(screen.queryByTestId("cosmetic-artwork-preparation")).toBeNull();
      first.unmount();
      render(<App />);
      await user.click(screen.getByRole("button", { name: "Cosmetics" }));
      await screen.findByRole("heading", { name: "Cosmetics" });
      expect(screen.queryByTestId("cosmetic-artwork-preparation")).toBeNull();
    },
  );

  it("preserves catalog access for partial artwork while allowing explicit progress viewing", async () => {
    vi.mocked(window.repoditor.cosmetics.artworkState).mockResolvedValue(state("preparing", 556));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await screen.findByRole("heading", { name: "Cosmetics" });
    expect(screen.getByTestId("cosmetic-artwork-compact")).toBeTruthy();
    expect(screen.queryByTestId("cosmetic-artwork-preparation")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show artwork progress" }));
    expect(screen.getByTestId("cosmetic-artwork-preparation")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue in background" }));
    expect(screen.getByRole("heading", { name: "Cosmetics" })).toBeTruthy();
  });

  it("offers the preparation screen only for real cold preparation and keeps background choice across tabs", async () => {
    vi.mocked(window.repoditor.cosmetics.artworkState).mockResolvedValue(state("preparing"));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await screen.findByTestId("cosmetic-artwork-preparation");
    await user.click(screen.getByRole("button", { name: "Continue in background" }));
    await screen.findByRole("heading", { name: "Cosmetics" });
    await user.click(screen.getByRole("button", { name: "Run Saves" }));
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    expect(screen.queryByTestId("cosmetic-artwork-preparation")).toBeNull();
    expect(screen.getByTestId("cosmetic-artwork-compact")).toBeTruthy();
  });
});
