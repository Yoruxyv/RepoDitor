import { fireEvent, render, screen } from "@testing-library/react";
import { WrenchIcon } from "@phosphor-icons/react";
import { describe, expect, it } from "vitest";

import { GameIcon } from "./GameIcon";

describe("GameIcon", () => {
  it("renders a decorative local image for an opaque token", () => {
    render(
      <GameIcon
        fallback={WrenchIcon}
        fallbackSource="fallback"
        testId="game-icon"
        token="opaque-token"
        variant="item"
      />,
    );

    const image = screen.getByTestId("game-icon").querySelector("img")!;
    expect(image.getAttribute("src")).toBe("repoditor-icon://local/opaque-token");
    expect(screen.getByTestId("game-icon").getAttribute("data-icon-source")).toBe("local");
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

    rerender(
      <GameIcon
        fallback={WrenchIcon}
        fallbackSource="specific"
        testId="game-icon"
        token="opaque-token"
        variant="item"
      />,
    );
    fireEvent.error(screen.getByTestId("game-icon").querySelector("img")!);
    expect(screen.getByTestId("game-icon").getAttribute("data-icon-source")).toBe("specific");
  });
});
