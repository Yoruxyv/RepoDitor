import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CosmeticsViewDto } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { CosmeticsView } from "@/features/cosmetics/CosmeticsView";

function button(element: HTMLElement): HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement)) throw new Error("Expected a button element.");
  return element;
}

const blockedView: CosmeticsViewDto = {
  fingerprint: "c".repeat(64),
  catalogAvailable: true,
  knownCatalogCount: 1,
  knownOwnedCount: 1,
  knownLockedCount: 0,
  savedPresetCount: 0,
  unknownOwnedIds: [],
  capabilities: {
    canReadCosmetics: true,
    canUnlockCosmetic: true,
    canUnlockAll: true,
    canRemoveOwnership: true,
    canClearPresets: true,
  },
  cosmetics: [
    {
      id: 0,
      displayName: "Long Sleeve",
      type: 0,
      rarity: 0,
      status: 1,
      owned: true,
      known: true,
      state: "owned",
      mutationEligible: true,
      removalBlockedReason: "Equipped cosmetic",
      iconToken: null,
    },
  ],
};

const degradedView: CosmeticsViewDto = {
  fingerprint: "d".repeat(64),
  catalogAvailable: false,
  knownCatalogCount: 0,
  knownOwnedCount: 0,
  knownLockedCount: 0,
  savedPresetCount: 1,
  unknownOwnedIds: [27],
  capabilities: {
    canReadCosmetics: true,
    canUnlockCosmetic: false,
    canUnlockAll: false,
    canRemoveOwnership: false,
    canClearPresets: true,
  },
  cosmetics: [
    {
      id: 27,
      displayName: "Cosmetic #27",
      type: null,
      rarity: null,
      status: null,
      owned: true,
      known: false,
      state: "unknown",
      mutationEligible: false,
      removalBlockedReason: "Preserved read-only",
      iconToken: null,
    },
  ],
};

describe("CosmeticsView", () => {
  it.each([false, true])("gates nonempty presets independently of ownership: %s", (allowed) => {
    const view: CosmeticsViewDto = {
      ...blockedView,
      savedPresetCount: 2,
      capabilities: {
        canReadCosmetics: true,
        canUnlockCosmetic: false,
        canUnlockAll: false,
        canRemoveOwnership: false,
        canClearPresets: allowed,
      },
      cosmetics: blockedView.cosmetics.map((c) => ({ ...c, mutationEligible: false })),
    };
    const clear = vi.fn();
    render(
      <PreferencesProvider>
        <CosmeticsView
          view={view}
          savedPresetCount={2}
          knownOwnedCount={1}
          knownLockedCount={0}
          loading={false}
          error={null}
          saving={false}
          lockAllBlockedReason={null}
          unlockAllPending={false}
          lockAllPending={false}
          clearAllPresetsPending={false}
          hasPendingEdits={false}
          hasBulkPending={false}
          onRetry={vi.fn()}
          onUnlockAll={vi.fn()}
          onUnlockCosmetic={vi.fn()}
          onLockAll={vi.fn()}
          onClearAllPresets={clear}
        />
      </PreferencesProvider>,
    );
    const action = button(screen.getByRole("button", { name: "Clear All Presets" }));
    expect(action.disabled).toBe(!allowed);
    fireEvent.click(action);
    expect(clear).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });
  it("uses a representative cosmetic-card skeleton only for initial loading", () => {
    const props = {
      clearAllPresetsPending: false,
      error: null,
      hasBulkPending: false,
      hasPendingEdits: false,
      knownLockedCount: 0,
      knownOwnedCount: 1,
      lockAllBlockedReason: null,
      saving: false,
      lockAllPending: false,
      savedPresetCount: 0,
      unlockAllPending: false,
      onClearAllPresets: vi.fn(),
      onLockAll: vi.fn(),
      onRetry: vi.fn(),
      onUnlockAll: vi.fn(),
      onUnlockCosmetic: vi.fn(),
    };
    const { rerender } = render(
      <PreferencesProvider>
        <CosmeticsView {...props} loading view={null} />
      </PreferencesProvider>,
    );

    expect(screen.getByTestId("cosmetics-skeleton").getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll('[data-skeleton-kind="cosmetic-card"]')).toHaveLength(6);
    expect(screen.getByTestId("cosmetic-thumbnail-skeleton")).toBeTruthy();
    expect(screen.queryByText("Reading MetaSave cosmetics…")).toBeNull();

    rerender(
      <PreferencesProvider>
        <CosmeticsView {...props} loading view={blockedView} />
      </PreferencesProvider>,
    );
    expect(screen.queryByTestId("cosmetics-skeleton")).toBeNull();
    expect(screen.getByRole("listitem", { name: "Long Sleeve, ID 0, Owned" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Cosmetics" }).getAttribute("aria-busy")).toBe(
      "true",
    );
  });

  it("keeps ownership bulk controls fail-closed while presets remain independent", () => {
    render(
      <PreferencesProvider>
        <CosmeticsView
          clearAllPresetsPending={false}
          error={null}
          hasBulkPending={false}
          hasPendingEdits={false}
          knownLockedCount={0}
          knownOwnedCount={0}
          loading={false}
          lockAllBlockedReason={null}
          saving={false}
          lockAllPending={false}
          savedPresetCount={1}
          unlockAllPending={false}
          view={degradedView}
          onClearAllPresets={vi.fn()}
          onLockAll={vi.fn()}
          onRetry={vi.fn()}
          onUnlockAll={vi.fn()}
          onUnlockCosmetic={vi.fn()}
        />
      </PreferencesProvider>,
    );

    expect(button(screen.getByRole("button", { name: "Unlock All Cosmetics" })).disabled).toBe(
      true,
    );
    expect(button(screen.getByRole("button", { name: "Lock All Cosmetics" })).disabled).toBe(true);
    expect(button(screen.getByRole("button", { name: "Clear All Presets" })).disabled).toBe(false);
    expect(screen.getByRole("listitem", { name: "Cosmetic #27, ID 27, Unknown" })).toBeTruthy();
  });

  it("exposes the Lock All blocker independently of the disabled button", () => {
    render(
      <PreferencesProvider>
        <CosmeticsView
          clearAllPresetsPending={false}
          error={null}
          hasBulkPending={false}
          hasPendingEdits={false}
          knownLockedCount={0}
          knownOwnedCount={1}
          loading={false}
          lockAllBlockedReason="Equipped cosmetic"
          saving={false}
          lockAllPending={false}
          savedPresetCount={0}
          unlockAllPending={false}
          view={blockedView}
          onClearAllPresets={vi.fn()}
          onLockAll={vi.fn()}
          onRetry={vi.fn()}
          onUnlockAll={vi.fn()}
          onUnlockCosmetic={vi.fn()}
        />
      </PreferencesProvider>,
    );

    const lockAll = screen.getByRole("button", { name: "Lock All Cosmetics" });
    expect((lockAll as HTMLButtonElement).disabled).toBe(true);
    expect(lockAll.hasAttribute("aria-describedby")).toBe(false);
    expect(screen.getByTestId("lock-all-blocked-reason").textContent).toBe(
      "Lock All is unavailable while an owned cosmetic is equipped or used by a preset.",
    );
  });
});
