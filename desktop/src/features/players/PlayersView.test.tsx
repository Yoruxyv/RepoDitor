import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlayerDto } from "@electron/contracts";
import { renderWithPreferences } from "@/test/render";
import { PlayersView } from "./PlayersView";

const player: PlayerDto = { id: "1", name: "Alpha", health: 80, maxHealth: 100 };
const handlers = {
  pendingByPlayer: {},
  onHealthChange: vi.fn(),
  onRejectAvatar: vi.fn(),
  onRetry: vi.fn(),
  onRevertHealth: vi.fn(),
  onSelect: vi.fn(),
};

describe("PlayersView", () => {
  it("uses player geometry for initial loading without hiding valid refresh data", () => {
    const { rerender } = renderWithPreferences(
      <PlayersView
        {...handlers}
        avatarUrls={{}}
        error={null}
        loading
        players={[]}
        selectedPlayerId={null}
      />,
    );

    expect(screen.getByTestId("players-skeleton").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("player-avatar-skeleton")).toBeTruthy();
    expect(screen.queryByText("Loading players…")).toBeNull();

    rerender(
      <PlayersView
        {...handlers}
        avatarUrls={{}}
        error={null}
        loading
        players={[player]}
        selectedPlayerId={player.id}
      />,
    );
    expect(screen.queryByTestId("players-skeleton")).toBeNull();
    expect(screen.getByTestId("selected-player-identity").textContent).toContain("Alpha");
    expect(screen.getByRole("spinbutton")).toBeTruthy();
    expect(screen.getByTestId("avatar-fallback-loading")).toBeTruthy();
  });

  it("shows the avatar fallback immediately when no avatar exists", () => {
    renderWithPreferences(
      <PlayersView
        {...handlers}
        avatarUrls={{ "1": null }}
        error={null}
        loading={false}
        players={[player]}
        selectedPlayerId={player.id}
      />,
    );

    expect(screen.getByTestId("avatar-fallback").textContent).toBe("A");
    expect(screen.queryByTestId("avatar-fallback-loading")).toBeNull();
  });
});
