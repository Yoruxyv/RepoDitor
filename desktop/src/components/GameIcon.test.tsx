import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WrenchIcon } from "@phosphor-icons/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { GameIcon } from "./GameIcon";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const dataUrl = "data:image/png;base64,AAAA";
const nativeToken = (scope: string) => `${scope}-artwork:${"a".repeat(32)}`;
beforeEach(() => {
  vi.mocked(invoke).mockImplementation(async (_command, args) => ({
    ok: true,
    data: {
      token: args && typeof args === "object" && "token" in args ? args.token : undefined,
      revision: "b".repeat(64),
      dataUrl,
    },
  }));
});

describe("GameIcon", () => {
  it("skeletonizes only the known thumbnail until its local image loads", async () => {
    render(
      <GameIcon
        fallback={WrenchIcon}
        fallbackSource="fallback"
        loading="lazy"
        testId="game-icon"
        token={nativeToken("item")}
        variant="item"
      />,
    );

    const image = await waitFor(() => {
      const image = screen.getByTestId("game-icon").querySelector("img");
      expect(image).not.toBeNull();
      return image!;
    });
    expect(image.getAttribute("src")).toBe(dataUrl);
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(screen.getByTestId("game-icon").getAttribute("data-icon-source")).toBe("local");
    expect(screen.getByTestId("game-icon-loading").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("game-icon").getAttribute("aria-busy")).toBe("true");

    fireEvent.load(image);
    expect(screen.queryByTestId("game-icon-loading")).toBeNull();
    expect(screen.getByTestId("game-icon").getAttribute("aria-busy")).toBe("false");
  });

  it("uses the exact Phosphor fallback when unavailable or loading fails", () => {
    const { rerender } = render(
      <GameIcon
        fallback={WrenchIcon}
        fallbackSource="specific"
        testId="game-icon"
        token={null}
        variant="item"
      />,
    );
    expect(screen.getByTestId("game-icon").getAttribute("data-icon-source")).toBe("specific");
    expect(screen.queryByTestId("game-icon-loading")).toBeNull();

    rerender(
      <GameIcon
        fallback={WrenchIcon}
        fallbackSource="specific"
        testId="game-icon"
        token="failed-token"
        variant="item"
      />,
    );
    expect(screen.getByTestId("game-icon").querySelector("img")).toBeNull();
    expect(screen.getByTestId("game-icon").getAttribute("data-icon-source")).toBe("specific");
    expect(screen.queryByTestId("game-icon-loading")).toBeNull();
  });

  it.each([
    ["item", "size-14"],
    ["map", "aspect-2/1"],
  ] as const)(
    "keeps the %s frame through loading, decoding and fallback",
    async (variant, sizeClass) => {
      const icon = (token: string | null) => (
        <GameIcon
          fallback={WrenchIcon}
          fallbackSource="fallback"
          testId="frame"
          token={token}
          variant={variant}
        />
      );
      function expectFrame(source: string) {
        const frame = screen.getByTestId("frame");
        expect(frame.classList.contains(sizeClass)).toBe(true);
        if (variant === "map") expect(frame.classList.contains("w-full")).toBe(true);
        expect(frame.getAttribute("aria-hidden")).toBe("true");
        expect(frame.dataset.iconSource).toBe(source);
      }
      const { rerender } = render(icon(nativeToken(variant)));
      const image = await waitFor(() => {
        const image = screen.getByTestId("frame").querySelector("img");
        expect(image).not.toBeNull();
        return image!;
      });
      expect(image.alt).toBe("");
      expect(screen.getByTestId("frame-loading")).toBeTruthy();
      expectFrame("local");
      fireEvent.load(image);
      expect(screen.queryByTestId("frame-loading")).toBeNull();
      expectFrame("local");
      fireEvent.error(image);
      expect(screen.getByTestId("frame").querySelector("img")).toBeNull();
      expectFrame("fallback");
      rerender(icon(null));
      expectFrame("fallback");
    },
  );

  it("keeps upgrade thumbnail and fallback geometry aligned", () => {
    const { rerender } = render(
      <GameIcon
        fallback={WrenchIcon}
        fallbackSource="specific"
        testId="upgrade-icon"
        token={nativeToken("upgrade")}
        variant="upgrade"
      />,
    );
    expect(screen.getByTestId("upgrade-icon").className).toContain("size-20");
    const loadingSkeleton = screen.getByTestId("upgrade-icon-loading");
    expect(loadingSkeleton.className).toContain("w-2/3");
    expect(loadingSkeleton.className).toContain("h-full");
    rerender(
      <GameIcon
        fallback={WrenchIcon}
        fallbackSource="specific"
        testId="upgrade-icon"
        token={null}
        variant="upgrade"
      />,
    );
    expect(screen.getByTestId("upgrade-icon").className).toContain("size-20");
    expect(screen.getByTestId("upgrade-icon").dataset.iconSource).toBe("specific");
  });
});
