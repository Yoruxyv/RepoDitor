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
  }],
};

describe("CosmeticsView", () => {
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
