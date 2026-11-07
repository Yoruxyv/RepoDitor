import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CosmeticDto, CosmeticsViewDto } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { useCosmetics } from "@/features/cosmetics/useCosmetics";
import { createRepoDitorApi } from "@/test/repoditorApiFixture";

function entry(id: number, owned: boolean, mutationEligible: boolean): CosmeticDto {
  return {
    id,
    displayName: `Fixture ${id}`,
    type: 0,
    rarity: 0,
    status: 0,
    known: true,
    owned,
    state: owned ? "owned" : "locked",
    mutationEligible,
    removalBlockedReason: mutationEligible ? null : "Outside policy",
    iconToken: null,
  };
}
function view(eligibleOwned = false, approvedId = 547): CosmeticsViewDto {
  return {
    fingerprint: "a".repeat(64),
    catalogAvailable: true,
    knownCatalogCount: 4,
    knownOwnedCount: eligibleOwned ? 3 : 1,
    knownLockedCount: eligibleOwned ? 1 : 3,
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
      entry(0, eligibleOwned, true),
      entry(approvedId, eligibleOwned, true),
      entry(557, false, false),
      entry(558, true, false),
    ],
  };
}

describe("cosmetic pending projection", () => {
  beforeEach(() => {
    window.repoditor = createRepoDitorApi(vi.fn());
  });
  it.each([false, true])(
    "stages presets only with independent authorization: %s",
    async (allowed) => {
      const catalog = view();
      catalog.savedPresetCount = 2;
      catalog.capabilities = {
        canReadCosmetics: true,
        canUnlockCosmetic: false,
        canUnlockAll: false,
        canRemoveOwnership: false,
        canClearPresets: allowed,
      };
      catalog.cosmetics = catalog.cosmetics.map((c) => ({ ...c, mutationEligible: false }));
      vi.mocked(window.repoditor.cosmetics.get).mockResolvedValue({ ok: true, data: catalog });
      const { result } = renderHook(() => useCosmetics(true, 0), { wrapper: PreferencesProvider });
      await waitFor(() => expect(result.current.savedPresetCount).toBe(2));
      act(() => result.current.clearAllPresets());
      expect(result.current.pendingEdits).toHaveLength(allowed ? 1 : 0);
      expect(result.current.savedPresetCount).toBe(allowed ? 0 : 2);
      expect(window.repoditor.cosmetics.write).not.toHaveBeenCalled();
    },
  );
  it("projects only eligible rows during Unlock All and preserves the future locked tail", async () => {
    vi.mocked(window.repoditor.cosmetics.get).mockResolvedValue({ ok: true, data: view() });
    const { result } = renderHook(() => useCosmetics(true, 0), { wrapper: PreferencesProvider });
    await waitFor(() => expect(result.current.view).not.toBeNull());
    act(() => result.current.unlockAll());
    expect(result.current.knownOwnedCount).toBe(3);
    expect(result.current.knownLockedCount).toBe(1);
    expect(result.current.view?.cosmetics.map((cosmetic) => cosmetic.owned)).toEqual([
      true,
      true,
      false,
      true,
    ]);
    expect(window.repoditor.cosmetics.write).not.toHaveBeenCalled();
    act(() => result.current.revertAll());
    expect(result.current.knownOwnedCount).toBe(1);
  });
  it("projects safe Lock All without removing restricted ownership or blocking on its policy reason", async () => {
    vi.mocked(window.repoditor.cosmetics.get).mockResolvedValue({ ok: true, data: view(true) });
    const { result } = renderHook(() => useCosmetics(true, 0), { wrapper: PreferencesProvider });
    await waitFor(() => expect(result.current.view).not.toBeNull());
    expect(result.current.lockAllBlockedReason).toBeNull();
    act(() => result.current.lockAll());
    expect(result.current.knownOwnedCount).toBe(1);
    expect(result.current.view?.cosmetics.map((cosmetic) => cosmetic.owned)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });
  it.each(Array.from({ length: 10 }, (_, index) => index + 547))(
    "stages approved ID %i while rejecting an unapproved discovered ID",
    async (id) => {
      vi.mocked(window.repoditor.cosmetics.get).mockResolvedValue({
        ok: true,
        data: view(false, id),
      });
      const { result } = renderHook(() => useCosmetics(true, 0), { wrapper: PreferencesProvider });
      await waitFor(() => expect(result.current.view).not.toBeNull());
      act(() => result.current.unlockCosmetic(id));
      act(() => result.current.unlockCosmetic(557));
      expect(result.current.pendingEdits.map((edit) => edit.entity)).toEqual([String(id)]);
    },
  );
});
