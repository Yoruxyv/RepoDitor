import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PlayerDto, PlayerUpgradeDto } from "@electron/contracts";
import { renderWithPreferences } from "@/test/render";
import { UpgradesView } from "./UpgradesView";

const player: PlayerDto = { id: "1", name: "Alpha", health: 100, maxHealth: 100 };
const secondPlayer: PlayerDto = { id: "2", name: "Beta User", health: 80, maxHealth: 100 };
const upgrades: PlayerUpgradeDto[] = [
  {
    key: "playerUpgradeHealth",
    label: "Health",
    presentationSource: "installed",
    gameplayCap: 10,
    iconToken: "health-token",
    values: [{ playerId: "1", value: 2 }],
  },
  {
    key: "playerUpgradeSuperMegaJump",
    label: "Super Mega Jump",
    presentationSource: "humanized",
    gameplayCap: null,
    iconToken: null,
    values: [{ playerId: "1", value: 1 }],
  },
];

describe("UpgradesView", () => {
  it("matches the player selector and upgrade-row geometry while loading", () => {
    renderWithPreferences(
      <UpgradesView
        avatarUrls={{}}
        error={null}
        loading
        pendingByUpgrade={{}}
        players={[]}
        selectedPlayerId={null}
        upgrades={[]}
        onChange={vi.fn()}
        onRejectAvatar={vi.fn()}
        onRetry={vi.fn()}
        onRevert={vi.fn()}
        onSelectPlayer={vi.fn()}
      />,
    );

    expect(screen.getByTestId("upgrades-skeleton").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("upgrade-avatar-skeleton")).toBeTruthy();
    expect(document.querySelectorAll('[data-skeleton-kind="upgrade-row"]')).toHaveLength(4);
    expect(screen.queryByText("Loading upgrades…")).toBeNull();
  });

  it("shows player-facing controls while keeping exact upgrade keys internal", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithPreferences(
      <UpgradesView
        avatarUrls={{ "1": "https://avatars.fastly.steamstatic.com/alpha.jpg" }}
        error={null}
        loading={false}
        pendingByUpgrade={{}}
        players={[player]}
        selectedPlayerId={player.id}
        upgrades={upgrades}
        onChange={onChange}
        onRejectAvatar={vi.fn()}
        onRetry={vi.fn()}
        onRevert={vi.fn()}
        onSelectPlayer={vi.fn()}
      />,
    );

    expect(screen.getByTestId("upgrade-icon-playerUpgradeHealth").dataset.iconSource).toBe("local");
    fireEvent.load(screen.getByTestId("upgrade-icon-playerUpgradeHealth").querySelector("img")!);
    expect(screen.getByTestId("upgrade-icon-playerUpgradeSuperMegaJump").dataset.iconSource).toBe(
      "fallback",
    );
    const avatar = screen.getByRole("img", { name: "Alpha avatar" });
    expect(avatar.getAttribute("src")).toContain("alpha.jpg");
    expect(screen.getByTestId("upgrades-avatar-fallback-loading")).toBeTruthy();
    expect(screen.getByTestId("selected-player-identity").textContent).toContain("Alpha");
    expect(screen.getByRole("spinbutton", { name: "Health for Alpha" })).toBeTruthy();
    fireEvent.load(avatar);
    expect(screen.queryByTestId("upgrades-avatar-fallback-loading")).toBeNull();
    expect(screen.getByTestId("selected-player-identity").textContent).toContain("1");
    expect(screen.getByRole("spinbutton", { name: "Super Mega Jump for Alpha" })).toBeTruthy();
    expect(screen.queryByText("playerUpgradeHealth")).toBeNull();
    expect(screen.queryByText("playerUpgradeSuperMegaJump")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
    expect(screen.getByText("Detected").className).toContain("text-xs");

    await user.clear(screen.getByRole("spinbutton", { name: "Health for Alpha" }));
    await user.type(screen.getByRole("spinbutton", { name: "Health for Alpha" }), "3");
    expect(onChange).toHaveBeenLastCalledWith(upgrades[0], player, 3);
  });

  it("accepts the Int32 maximum and rejects unsafe upgrade values inline", () => {
    const onChange = vi.fn();
    renderWithPreferences(
      <UpgradesView
        avatarUrls={{ "1": null }}
        error={null}
        loading={false}
        pendingByUpgrade={{}}
        players={[player]}
        selectedPlayerId={player.id}
        upgrades={[upgrades[0]!]}
        onChange={onChange}
        onRejectAvatar={vi.fn()}
        onRetry={vi.fn()}
        onRevert={vi.fn()}
        onSelectPlayer={vi.fn()}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Health for Alpha" });

    for (const value of ["0", "10", "2147483647"]) {
      fireEvent.change(input, { target: { value } });
    }
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith(upgrades[0], player, 2_147_483_647);
    expect(input.getAttribute("max")).toBe("2147483647");

    for (const value of ["", "-1", "1.5", "2147483648", "9007199254740992"]) {
      fireEvent.change(input, { target: { value } });
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByText("Upgrade value must be between 0 and 2,147,483,647.")).toBeTruthy();
    }
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("keeps player selection behavior through the reusable Select", async () => {
    const user = userEvent.setup();
    const onSelectPlayer = vi.fn();
    renderWithPreferences(
      <UpgradesView
        avatarUrls={{ "1": null, "2": null }}
        error={null}
        loading={false}
        pendingByUpgrade={{}}
        players={[player, secondPlayer]}
        selectedPlayerId={player.id}
        upgrades={upgrades}
        onChange={vi.fn()}
        onRejectAvatar={vi.fn()}
        onRetry={vi.fn()}
        onRevert={vi.fn()}
        onSelectPlayer={onSelectPlayer}
      />,
    );

    const control = screen.getByRole("combobox", { name: "Player" });
    await user.click(control);
    await user.click(screen.getByRole("option", { name: "Beta User" }));
    expect(onSelectPlayer).toHaveBeenCalledWith("2");
  });

  it("updates the avatar with the selected player and keeps a stable fallback", () => {
    const onSelectPlayer = vi.fn();
    const { rerender } = renderWithPreferences(
      <UpgradesView
        avatarUrls={{ "1": null, "2": null }}
        error={null}
        loading={false}
        pendingByUpgrade={{}}
        players={[player, secondPlayer]}
        selectedPlayerId={player.id}
        upgrades={upgrades}
        onChange={vi.fn()}
        onRejectAvatar={vi.fn()}
        onRetry={vi.fn()}
        onRevert={vi.fn()}
        onSelectPlayer={onSelectPlayer}
      />,
    );

    expect(screen.getByTestId("upgrades-avatar-fallback").textContent).toBe("A");
    rerender(
      <UpgradesView
        avatarUrls={{ "1": null, "2": null }}
        error={null}
        loading={false}
        pendingByUpgrade={{}}
        players={[player, secondPlayer]}
        selectedPlayerId={secondPlayer.id}
        upgrades={upgrades}
        onChange={vi.fn()}
        onRejectAvatar={vi.fn()}
        onRetry={vi.fn()}
        onRevert={vi.fn()}
        onSelectPlayer={onSelectPlayer}
      />,
    );
    expect(screen.getByTestId("upgrades-avatar-fallback").textContent).toBe("BU");
    expect(screen.getByTestId("selected-player-identity").textContent).toContain("Beta User");
  });
});
