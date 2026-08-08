import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EnvironmentDiscovery,
  PlayerDto,
  RepoDitorApi,
  SaveSession,
} from "@electron/contracts";
import App from "./App";

const saveId = "REPO_SAVE_2026_08_08_10_20_30";
const environment: EnvironmentDiscovery = {
  saveRoot: "C:\\fixture\\saves",
  saveRootStatus: "available",
  saveRootDetected: true,
  gameRoot: null,
  gameStatus: "game_not_found",
  gameDetected: false,
  saves: [
    {
      id: saveId,
      name: "2026-08-08 10:20:30",
      path: `C:\\fixture\\saves\\${saveId}\\${saveId}.es3`,
      modifiedAt: "2026-08-08T10:20:30+00:00",
      sizeBytes: 1024,
    },
  ],
};
const session: SaveSession = {
  ...environment.saves[0]!,
  level: 5,
  currency: 12,
  playerCount: 2,
  resumeLocation: "Normal",
};
const players: PlayerDto[] = [
  { id: "111", name: "Alpha", health: 80 },
  { id: "222", name: "Beta", health: 0 },
];

function bridge(
  open: RepoDitorApi["saves"]["open"],
  playerList: PlayerDto[] = [],
  avatar: RepoDitorApi["players"]["avatar"] = vi.fn((_saveId: string, playerId: string) =>
    Promise.resolve({ ok: true as const, data: { playerId, avatarUrl: null } }),
  ),
): RepoDitorApi {
  return {
    environment: { detect: vi.fn().mockResolvedValue({ ok: true, data: environment }) },
    saves: {
      list: vi.fn().mockResolvedValue({ ok: true, data: environment.saves }),
      open,
    },
    players: {
      list: vi.fn().mockResolvedValue({ ok: true, data: playerList }),
      avatar,
    },
  };
}

describe("save workspace transition", () => {
  beforeEach(() => {
    window.repoditor = bridge(vi.fn());
  });

  it("shows discovery loading while the desktop bridge responds", () => {
    window.repoditor.environment.detect = vi.fn(() => new Promise<never>(() => undefined));
    render(<App />);
    expect(screen.getByLabelText("Discovering local R.E.P.O. saves")).toBeTruthy();
  });

  it("shows opening state and transitions into the workspace", async () => {
    let finishOpen: ((value: { ok: true; data: SaveSession }) => void) | undefined;
    const open = vi.fn(
      () =>
        new Promise<{ ok: true; data: SaveSession }>((resolve) => {
          finishOpen = resolve;
        }),
    );
    window.repoditor = bridge(open);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(screen.getByRole("button", { name: /Opening save/ }).hasAttribute("disabled")).toBe(
      true,
    );
    finishOpen?.({ ok: true, data: session });

    expect(await screen.findByTestId("workspace")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    screen.getByRole("tab", { name: "Overview" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Players" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("keeps discovery visible and reports open failures", async () => {
    window.repoditor = bridge(
      vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "save_corrupt", message: "The selected save is corrupted." },
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The selected save is corrupted. No save files were changed.",
    );
    expect(screen.queryByTestId("workspace")).toBeNull();
  });

  it("shows Overview and preserves typed pending player edits across navigation", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    expect(await screen.findByText("Save opened safely")).toBeTruthy();
    expect(screen.getByText("Last modified")).toBeTruthy();
    expect(screen.getByText("Normal")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Players" }));
    await user.click(await screen.findByRole("button", { name: /Beta/ }));
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect(screen.getByTestId("avatar-fallback").textContent).toBe("B");

    const health = screen.getByRole("spinbutton", { name: "Current health" });
    await user.clear(health);
    await user.type(health, "42");
    expect(screen.getByTestId("pending-health-edit").textContent).toContain("0 → 42");
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("1 pending change");

    await user.clear(health);
    await user.type(health, "0");
    expect(screen.queryByTestId("pending-health-edit")).toBeNull();
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("No pending changes");

    await user.clear(health);
    await user.type(health, "42");

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.click(screen.getByRole("tab", { name: "Players" }));
    expect(screen.getByRole("heading", { name: "Beta" })).toBeTruthy();
    expect((screen.getByRole("spinbutton", { name: "Current health" }) as HTMLInputElement).value)
      .toBe("42");

    await user.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.queryByTestId("pending-health-edit")).toBeNull();
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("No pending changes");
  });

  it("rejects invalid health without creating a pending edit", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(screen.getByRole("tab", { name: "Players" }));
    const health = await screen.findByRole("spinbutton", { name: "Current health" });
    fireEvent.change(health, { target: { value: "-1" } });

    expect(screen.getByRole("alert").textContent).toContain("whole number");
    expect(screen.getByTestId("pending-edit-count").textContent).toBe("No pending changes");
  });

  it("keeps editing available while an avatar loads and falls back if the image fails", async () => {
    let finishAvatar:
      | ((value: {
          ok: true;
          data: { playerId: string; avatarUrl: string | null };
        }) => void)
      | undefined;
    const avatar = vi.fn(
      () =>
        new Promise<{ ok: true; data: { playerId: string; avatarUrl: string | null } }>(
          (resolve) => {
            finishAvatar = resolve;
          },
        ),
    );
    window.repoditor = bridge(
      vi.fn().mockResolvedValue({ ok: true, data: session }),
      [players[0]!],
      avatar,
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(screen.getByRole("tab", { name: "Players" }));
    const health = await screen.findByRole("spinbutton", { name: "Current health" });
    await user.clear(health);
    await user.type(health, "95");
    expect(screen.getByTestId("pending-health-edit")).toBeTruthy();

    const avatarUrl = "https://avatars.akamai.steamstatic.com/avatar.jpg";
    await act(async () => {
      finishAvatar?.({ ok: true, data: { playerId: "111", avatarUrl } });
    });
    const image = await waitFor(() => {
      const element = document.querySelector<HTMLImageElement>(`img[src="${avatarUrl}"]`);
      expect(element).toBeTruthy();
      return element!;
    });
    fireEvent.error(image);
    expect(screen.getByTestId("avatar-fallback").textContent).toBe("A");
  });
});
