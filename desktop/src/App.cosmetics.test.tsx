import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import {
  cosmetics,
  createRepoDitorApi as bridge,
  players,
  session,
} from "@/test/repoditorApiFixture";

describe("cosmetics workspace integration", () => {
  beforeEach(() => {
    localStorage.clear();
    window.repoditor = bridge(vi.fn());
  });

  it("reloads MetaSave whenever Cosmetics is entered without pending edits", async () => {
    const getCosmetics = vi.mocked(window.repoditor.cosmetics.get);
    const user = userEvent.setup();
    render(<App />);

    expect(getCosmetics).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await waitFor(() => expect(getCosmetics).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Run Saves" }));
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await waitFor(() => expect(getCosmetics).toHaveBeenCalledTimes(2));
  });

  it("does not expose a manual MetaSave Refresh control", async () => {
    const getCosmetics = vi.mocked(window.repoditor.cosmetics.get);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    const workspace = await screen.findByTestId("cosmetics-workspace");
    await screen.findByRole("heading", { name: "Cosmetics" });

    expect(getCosmetics).toHaveBeenCalledTimes(1);
    expect(workspace.querySelector("button")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  it("stages, projects, reverts, and safely saves one cosmetic unlock", async () => {
    const cosmeticWrite = vi.mocked(window.repoditor.cosmetics.write);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await screen.findByRole("heading", { name: "Cosmetics" });

    const ownedCount = () =>
      screen.getByText("Owned", { selector: "dt" }).nextElementSibling?.textContent;
    const lockedCount = () =>
      screen.getByText("Locked", { selector: "dt" }).nextElementSibling?.textContent;
    expect(ownedCount()).toBe("1");
    expect(lockedCount()).toBe("1");

    await user.click(screen.getByRole("button", { name: "Unlock Installed Cosmetic 28" }));

    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe("1 pending change");
    expect(ownedCount()).toBe("2");
    expect(lockedCount()).toBe("0");
    expect(
      screen.getByRole("listitem", { name: "Installed Cosmetic 28, ID 28, Owned" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unlock Installed Cosmetic 28" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Unlock All Cosmetics" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(cosmeticWrite).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText(/Installed Cosmetic 28.*Ownership/)).toBeTruthy();
    expect(screen.getByText("Locked → Owned")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(ownedCount()).toBe("1");
    expect(lockedCount()).toBe("1");
    expect(
      screen.getByRole("listitem", { name: "Installed Cosmetic 28, ID 28, Locked" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock Installed Cosmetic 28" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Unlock Installed Cosmetic 28" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(cosmeticWrite).toHaveBeenCalledWith(cosmetics.fingerprint, [
      { feature: "cosmetics", entity: "28", field: "owned", after: true },
    ]);
    expect(await screen.findByText("Saved safely · Backup created")).toBeTruthy();
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    expect(ownedCount()).toBe("2");
    expect(lockedCount()).toBe("0");
  }, 10_000);

  it("stages Clear All Presets as one revertible edit and saves it separately", async () => {
    const withPresets = structuredClone(cosmetics);
    withPresets.savedPresetCount = 3;
    const cleared = structuredClone(withPresets);
    cleared.savedPresetCount = 0;
    window.repoditor.cosmetics.get = vi.fn().mockResolvedValue({ ok: true, data: withPresets });
    const cosmeticWrite = vi.fn().mockResolvedValue({
      ok: true as const,
      data: {
        backupPath: "C:\\fixture\\MetaSave.es3.bak-20260810-172700",
        cosmetics: cleared,
      },
    });
    window.repoditor.cosmetics.write = cosmeticWrite;
    const runWrite = vi.mocked(window.repoditor.saves.write);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await screen.findByRole("heading", { name: "Cosmetics" });
    expect(screen.getByText("Saved presets").nextElementSibling?.textContent).toBe("3");

    await user.click(screen.getByRole("button", { name: "Clear All Presets" }));
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe("1 pending change");
    expect(screen.getByText("Saved presets").nextElementSibling?.textContent).toBe("0");
    expect(screen.getByText(/Cosmetics.*Saved presets/)).toBeTruthy();
    expect(screen.getByText("3 → 0")).toBeTruthy();
    expect(cosmeticWrite).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByText("Saved presets").nextElementSibling?.textContent).toBe("3");
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "No pending changes",
    );

    await user.click(screen.getByRole("button", { name: "Clear All Presets" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(cosmeticWrite).toHaveBeenCalledWith(withPresets.fingerprint, [
      { feature: "cosmetics", entity: "presets", field: "clearAll", after: true },
    ]);
    expect(runWrite).not.toHaveBeenCalled();
    expect(await screen.findByText("Saved safely · Backup created")).toBeTruthy();
    expect(screen.queryByText("C:\\fixture\\MetaSave.es3.bak-20260810-172700")).toBeNull();
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
    expect(
      (screen.getByRole("button", { name: "Clear All Presets" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  }, 10_000);

  it("opens Cosmetics without a Run save and keeps Lock All pending until save", async () => {
    const cosmeticWrite = vi.mocked(window.repoditor.cosmetics.write);
    const runWrite = vi.mocked(window.repoditor.saves.write);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));

    expect(await screen.findByRole("heading", { name: "Cosmetics" })).toBeTruthy();
    expect(screen.getByText("Known catalog")).toBeTruthy();
    expect(screen.getByText("Saved presets")).toBeTruthy();
    expect(screen.queryByLabelText("Search by cosmetic ID")).toBeNull();
    expect(await screen.findByText("Long Sleeve")).toBeTruthy();
    expect(screen.queryByText("Cosmetic #27")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Clear All Presets" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: /^Lock All Cosmetics$/ }));
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe("1 pending change");
    expect(screen.getByText(/Cosmetics.*Known ownership/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Run Saves" }));
    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    expect(
      (screen.getByRole("button", { name: "Lock All pending" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(cosmeticWrite).toHaveBeenCalledWith(cosmetics.fingerprint, [
      { feature: "cosmetics", entity: "known", field: "lockAll", after: false },
    ]);
    expect(runWrite).not.toHaveBeenCalled();
    expect(await screen.findByText("Saved safely · Backup created")).toBeTruthy();
    expect(screen.queryByText("C:\\fixture\\MetaSave.es3.bak-20260808-102100")).toBeNull();
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
  }, 10_000);

  it("keeps Run and Cosmetics pending state independent across workspace navigation", async () => {
    window.repoditor = bridge(vi.fn().mockResolvedValue({ ok: true, data: session }), players);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Open workspace/ }));
    await user.click(await screen.findByRole("tab", { name: "Run" }));
    const currency = await screen.findByRole("spinbutton", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "20");
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("1 pending change");

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await user.click(await screen.findByRole("button", { name: /^Unlock All Cosmetics$/ }));
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe("1 pending change");

    await user.click(screen.getByRole("button", { name: "Run Saves" }));
    expect((screen.getByRole("spinbutton", { name: "Currency" }) as HTMLInputElement).value).toBe(
      "20",
    );
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("1 pending change");

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    expect(screen.getByRole("button", { name: "Unlock All pending" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "No pending changes",
    );

    await user.click(screen.getByRole("button", { name: "Run Saves" }));
    expect(screen.getByTestId("workspace-pending-edit-count").textContent).toBe("1 pending change");
  });

  it("represents Unlock All as one revertible pending action", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Cosmetics" }));
    await user.click(await screen.findByRole("button", { name: /^Unlock All Cosmetics$/ }));

    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe("1 pending change");
    expect(screen.getByText(/Cosmetics.*Known ownership/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(screen.getByTestId("cosmetics-pending-edit-count").textContent).toBe(
      "No pending changes",
    );
  });
});
