import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tauriReadApi } from "@/app/tauriReadApi";
import { cosmetics, createRepoDitorApi } from "@/test/repoditorApiFixture";
import { renderWithPreferences } from "@/test/render";
import { TauriCosmeticsWorkspace } from "./TauriCosmeticsWorkspace";

vi.mock("@/app/tauriReadApi", () => ({ tauriReadApi: { cosmetics: { get: vi.fn() } } }));

describe("native Cosmetics composition", () => {
  beforeEach(() => {
    window.repoditor = createRepoDitorApi(vi.fn());
    vi.mocked(tauriReadApi.cosmetics.get)
      .mockReset()
      .mockResolvedValue({ ok: true, data: cosmetics });
  });
  it("retains informational capabilities and catalog controls while omitting every mutation surface", async () => {
    renderWithPreferences(<TauriCosmeticsWorkspace active recoveryGeneration={0} />);
    expect(await screen.findByRole("searchbox", { name: "Search cosmetics" })).toBeTruthy();
    expect(screen.getByText("Cosmetic #999")).toBeTruthy();
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
});
