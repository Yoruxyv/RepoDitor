import { fireEvent, render, screen } from "@testing-library/react";
import { WrenchIcon } from "@phosphor-icons/react";
import { describe, expect, it } from "vitest";

import { GameIcon } from "./GameIcon";

describe("GameIcon", () => {
  it("skeletonizes only the known thumbnail until its local image loads", () => {
    render(
      <GameIcon
        fallback={WrenchIcon}
        fallbackSource="fallback"
        loading="lazy"
        testId="game-icon"
        token="opaque-token"
        variant="item"
      />,
    );

    const image = screen.getByTestId("game-icon").querySelector("img")!;
    expect(image.getAttribute("src")).toBe("repoditor-icon://local/opaque-token");
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
    expect(screen.getByTestId("game-icon-loading")).toBeTruthy();
    fireEvent.error(screen.getByTestId("game-icon").querySelector("img")!);
    expect(screen.getByTestId("game-icon").getAttribute("data-icon-source")).toBe("specific");
    expect(screen.queryByTestId("game-icon-loading")).toBeNull();
  });

  it("remembers a successfully loaded opaque token across component remounts", () => {
    const icon = (
      <GameIcon
        fallback={WrenchIcon}
        fallbackSource="fallback"
        loading="lazy"
        testId="remounted-icon"
        token="session-loaded-token"
        variant="cosmetic"
      />
    );
    const first = render(icon);
    fireEvent.load(screen.getByTestId("remounted-icon").querySelector("img")!);
    first.unmount();

    render(icon);
    expect(screen.queryByTestId("remounted-icon-loading")).toBeNull();
    expect(screen.getByTestId("remounted-icon").getAttribute("aria-busy")).toBe("false");
  });

  it("keeps upgrade thumbnail and fallback geometry aligned", () => {
    const { rerender } = render(
      <GameIcon fallback={WrenchIcon} fallbackSource="specific" testId="upgrade-icon" token="upgrade-token" variant="upgrade" />,
    );
    expect(screen.getByTestId("upgrade-icon").className).toContain("size-20");
    expect(screen.getByTestId("upgrade-icon-loading")).toBeTruthy();
    rerender(<GameIcon fallback={WrenchIcon} fallbackSource="specific" testId="upgrade-icon" token={null} variant="upgrade" />);
    expect(screen.getByTestId("upgrade-icon").className).toContain("size-20");
    expect(screen.getByTestId("upgrade-icon").dataset.iconSource).toBe("specific");
  });
});
