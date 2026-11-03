import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("renders saved health without edit actions or invalid-edit guidance in read-only mode", () => {
    renderWithPreferences(
      <PlayersView
        {...handlers}
        avatarUrls={{ "1": null }}
        error={null}
        loading={false}
        players={[{ ...player, health: 180 }]}
        selectedPlayerId="1"
        onHealthChange={null}
        onRevertHealth={null}
      />,
    );
    const input = screen.getByRole("spinbutton");
    expect(input.hasAttribute("readonly")).toBe(true);
    expect(input.getAttribute("value")).toBe("180");
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.blur(input);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(screen.queryByRole("button", { name: "Heal to Full" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
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

  it("renders accessible health progress from the saved value", () => {
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

    const progress = screen.getByRole("progressbar", { name: "Current health" });
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");
    expect(progress.getAttribute("aria-valuenow")).toBe("80");
    expect(screen.getByTestId("player-health-progress-fill").style.width).toBe("80%");
  });

  it("updates health progress immediately for typed health and Heal to Full", async () => {
    const user = userEvent.setup();
    const onHealthChange = vi.fn();
    renderWithPreferences(
      <PlayersView
        {...handlers}
        avatarUrls={{ "1": null }}
        error={null}
        loading={false}
        players={[player]}
        selectedPlayerId={player.id}
        onHealthChange={onHealthChange}
      />,
    );

    const input = screen.getByRole("spinbutton");
    const progress = screen.getByRole("progressbar", { name: "Current health" });
    await user.clear(input);
    await user.type(input, "70");

    expect(progress.getAttribute("aria-valuenow")).toBe("70");
    expect(screen.getByTestId("player-health-progress-fill").style.width).toBe("70%");
    fireEvent.blur(input);
    expect(onHealthChange).toHaveBeenLastCalledWith(player, 70);

    await user.click(screen.getByRole("button", { name: "Heal to Full" }));
    expect(progress.getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByTestId("player-health-progress-fill").style.width).toBe("100%");
    expect(onHealthChange).toHaveBeenLastCalledWith(player, 100);
  });

  it("restores saved health progress after reverting a pending edit", async () => {
    const user = userEvent.setup();
    const pendingByPlayer = {
      "1": {
        feature: "players" as const,
        entity: "1",
        field: "health" as const,
        before: 80,
        after: 70,
        label: "Health",
        subject: "Alpha",
      },
    };
    const { rerender } = renderWithPreferences(
      <PlayersView
        {...handlers}
        avatarUrls={{ "1": null }}
        error={null}
        loading={false}
        pendingByPlayer={pendingByPlayer}
        players={[player]}
        selectedPlayerId={player.id}
      />,
    );

    expect(
      screen.getByRole("progressbar", { name: "Current health" }).getAttribute("aria-valuenow"),
    ).toBe("70");
    await user.click(screen.getByRole("button", { name: "Revert" }));

    rerender(
      <PlayersView
        {...handlers}
        avatarUrls={{ "1": null }}
        error={null}
        loading={false}
        pendingByPlayer={{}}
        players={[player]}
        selectedPlayerId={player.id}
      />,
    );
    expect(
      screen.getByRole("progressbar", { name: "Current health" }).getAttribute("aria-valuenow"),
    ).toBe("80");
  });

  it("keeps health progress stable while the temporary input is invalid", async () => {
    const user = userEvent.setup();
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

    await user.clear(screen.getByRole("spinbutton"));

    const progress = screen.getByRole("progressbar", { name: "Current health" });
    expect(progress.getAttribute("aria-valuenow")).toBe("80");
    expect(screen.getByTestId("player-health-progress-fill").style.width).toBe("80%");
    expect(screen.getByText("Health must be between 0 and 100.")).toBeTruthy();
  });

  it.each([
    ["101", 100],
    ["-1", 0],
    ["100", 100],
  ])("clamps explicit health %s to %i on commit", (value, expected) => {
    const onHealthChange = vi.fn();
    renderWithPreferences(
      <PlayersView
        {...handlers}
        avatarUrls={{ "1": null }}
        error={null}
        loading={false}
        players={[player]}
        selectedPlayerId={player.id}
        onHealthChange={onHealthChange}
      />,
    );

    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value } });

    expect(onHealthChange).not.toHaveBeenCalled();
    fireEvent.blur(input);

    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect((input as HTMLInputElement).value).toBe(String(expected));
    expect(onHealthChange).toHaveBeenCalledWith(player, expected);
  });

  it("does not turn malformed loaded health into an edit until the user changes it", () => {
    const malformed = { ...player, health: 676_761, maxHealth: 20_100 };
    const onHealthChange = vi.fn();
    renderWithPreferences(
      <PlayersView
        {...handlers}
        avatarUrls={{ "1": null }}
        error={null}
        loading={false}
        players={[malformed]}
        selectedPlayerId={malformed.id}
        onHealthChange={onHealthChange}
      />,
    );

    const input = screen.getByRole("spinbutton");
    expect((input as HTMLInputElement).value).toBe("676761");
    const progress = screen.getByRole("progressbar", { name: "Current health" });
    if (!(progress instanceof HTMLProgressElement)) throw new Error("Expected a progress element.");
    expect(progress.value).toBe(20_100);
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onHealthChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "95" } });
    fireEvent.blur(input);
    expect(onHealthChange).toHaveBeenCalledWith(malformed, 95);
  });
});
