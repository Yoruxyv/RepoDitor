import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlayerDto, PlayerUpgradeDto } from "@electron/contracts";
import { UpgradesView } from "./UpgradesView";

const player: PlayerDto = { id: "1", name: "Alpha", health: 100, maxHealth: 100 };
const upgrades: PlayerUpgradeDto[] = [
  { key: "playerUpgradeHealth", label: "Health", known: true, values: [{ playerId: "1", value: 2 }] },
  { key: "futureUpgrade", label: "Future upgrade", known: false, values: [{ playerId: "1", value: 1 }] },
];

describe("UpgradesView", () => {
  it("shows semantic icons while retaining an accessible fallback and numeric controls", () => {
    render(
      <UpgradesView
        error={null}
        loading={false}
        pendingByUpgrade={{}}
        players={[player]}
        selectedPlayerId={player.id}
        upgrades={upgrades}
        onChange={vi.fn()}
        onRetry={vi.fn()}
        onRevert={vi.fn()}
        onSelectPlayer={vi.fn()}
      />,
    );

    expect(screen.getByTestId("upgrade-icon-playerUpgradeHealth").dataset.iconSource)
      .toBe("specific");
    expect(screen.getByTestId("upgrade-icon-futureUpgrade").dataset.iconSource).toBe("fallback");
    expect(screen.getByRole("spinbutton", { name: "Health for Alpha" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "Future upgrade for Alpha" })).toBeTruthy();
  });
});
