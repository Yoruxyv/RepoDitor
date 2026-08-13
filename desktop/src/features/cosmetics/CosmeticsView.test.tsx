import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CosmeticsViewDto } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { CosmeticsView } from "@/features/cosmetics/CosmeticsView";

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
  },
  cosmetics: [{
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
  }],
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
  },
  cosmetics: [{
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
  }],
};

describe("CosmeticsView", () => {
  it("keeps ownership bulk controls fail-closed while presets remain independent", () => {
    render(
      <PreferencesProvider>
        <CosmeticsView
          clearAllPresetsPending={false}
          error={null}
          knownLockedCount={0}
          knownOwnedCount={0}
          loading={false}
          lockAllBlockedReason={null}
          lockAllPending={false}
          savedPresetCount={1}
          unlockAllPending={false}
          view={degradedView}
          onClearAllPresets={vi.fn()}
          onLockAll={vi.fn()}
          onRetry={vi.fn()}
          onUnlockAll={vi.fn()}
        />
      </PreferencesProvider>,
    );

    expect((screen.getByRole("button", { name: "Unlock All Cosmetics" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Lock All Cosmetics" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Clear All Presets" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("listitem", { name: "Cosmetic #27, ID 27, Unknown" })).toBeTruthy();
  });

  it("exposes the Lock All blocker independently of the disabled button", () => {
    render(
      <PreferencesProvider>
        <CosmeticsView
          clearAllPresetsPending={false}
          error={null}
          knownLockedCount={0}
          knownOwnedCount={1}
          loading={false}
          lockAllBlockedReason="Equipped cosmetic"
          lockAllPending={false}
          savedPresetCount={0}
          unlockAllPending={false}
          view={blockedView}
          onClearAllPresets={vi.fn()}
          onLockAll={vi.fn()}
          onRetry={vi.fn()}
          onUnlockAll={vi.fn()}
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
