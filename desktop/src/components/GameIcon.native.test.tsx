import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WrenchIcon } from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { GameIcon } from "./GameIcon";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const token = (n: string) => `upgrade-artwork:${n.repeat(32)}`;
function icon(value: string, variant: "upgrade" | "item" = "upgrade") {
  return (
    <GameIcon
      fallback={WrenchIcon}
      fallbackSource="specific"
      testId="native-icon"
      token={value}
      variant={variant}
    />
  );
}
describe("native GameIcon", () => {
  it("shows only validated current-session images and cancels stale replies", async () => {
    const completions: Array<(value: unknown) => void> = [];
    vi.mocked(invoke)
      .mockReset()
      .mockImplementation((command) =>
        command === "upgrade_artwork_cancel"
          ? Promise.resolve()
          : new Promise((resolve) => completions.push(resolve)),
      );
    const { rerender, unmount } = render(icon(token("a")));
    expect(screen.getByTestId("native-icon-loading")).toBeTruthy();
    rerender(icon(token("b")));
    expect(invoke).toHaveBeenCalledWith("upgrade_artwork_cancel", { token: token("a") });
    await act(async () => {
      completions[0]!({
        ok: true,
        data: {
          token: token("a"),
          revision: "c".repeat(64),
          dataUrl: "data:image/png;base64,AAAA",
        },
      });
    });
    expect(screen.getByTestId("native-icon").querySelector("img")).toBeNull();
    await act(async () => {
      completions[1]!({
        ok: true,
        data: {
          token: token("b"),
          revision: "d".repeat(64),
          dataUrl: "data:image/png;base64,AQID",
        },
      });
    });
    const image = screen.getByTestId("native-icon").querySelector("img")!;
    expect(image.getAttribute("src")).toBe("data:image/png;base64,AQID");
    expect(screen.getByTestId("native-icon").getAttribute("data-artwork-revision")).toBe(
      "d".repeat(64),
    );
    fireEvent.load(image);
    expect(screen.queryByTestId("native-icon-loading")).toBeNull();
    unmount();
    render(icon(token("b")));
    await act(async () => {
      completions[2]!({ ok: true, data: null });
    });
    expect(screen.getByTestId("native-icon").getAttribute("data-icon-source")).toBe("specific");
  });
  it.each(["upgrade-artwork:forged", token("a")])("rejects cross-domain tokens: %s", (value) => {
    vi.mocked(invoke).mockReset();
    render(icon(value, "item"));
    expect(screen.getByTestId("native-icon").getAttribute("data-icon-source")).toBe("specific");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("falls back for a rejected, malformed or unsafe response", async () => {
    vi.mocked(invoke)
      .mockReset()
      .mockResolvedValue({
        ok: true,
        data: { token: token("e"), revision: "f".repeat(64), dataUrl: "file:///private.png" },
      });
    render(icon(token("e")));
    await waitFor(() =>
      expect(screen.getByTestId("native-icon").getAttribute("data-icon-source")).toBe("specific"),
    );
    expect(screen.queryByTestId("native-icon-loading")).toBeNull();
  });
});
