import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { CosmeticDto, CosmeticsViewDto } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { CosmeticsCatalog } from "@/features/cosmetics/CosmeticsCatalog";

const fingerprint = "c".repeat(64);

interface InstalledCosmeticOptions {
  readonly owned?: boolean;
  readonly mutationEligible?: boolean;
  readonly type?: number | null;
  readonly rarity?: number | null;
  readonly status?: number | null;
}

function installedCosmetic(
  id: number,
  displayName: string,
  options: InstalledCosmeticOptions = {},
): CosmeticDto {
  const owned = options.owned ?? false;
  const mutationEligible = id < 547;
  if (options.mutationEligible !== undefined) {
    expect(options.mutationEligible).toBe(mutationEligible);
  }
  return {
    id,
    displayName,
    type: options.type === undefined ? 0 : options.type,
    rarity: options.rarity === undefined ? 0 : options.rarity,
    status: options.status === undefined ? 3 : options.status,
    owned,
    known: true,
    state: owned ? "owned" : "locked",
    mutationEligible,
    removalBlockedReason: mutationEligible ? null : "Outside proven mutation trust",
  };
}

function unknownCosmetic(id: number): CosmeticDto {
  return {
    id,
    displayName: `Cosmetic #${id}`,
    type: null,
    rarity: null,
    status: null,
    owned: true,
    known: false,
    state: "unknown",
    mutationEligible: false,
    removalBlockedReason: "Preserved read-only",
  };
}

function catalogView(
  cosmetics: CosmeticDto[],
  catalogAvailable = true,
): CosmeticsViewDto {
  const knownCosmetics = cosmetics.filter((cosmetic) => cosmetic.known);
  if (catalogAvailable) {
    expect(knownCosmetics.map((cosmetic) => cosmetic.id)).toEqual(
      Array.from({ length: knownCosmetics.length }, (_, id) => id),
    );
    for (const cosmetic of knownCosmetics) {
      expect(cosmetic.mutationEligible).toBe(cosmetic.id < 547);
    }
  }
  const knownOwnedCount = knownCosmetics.filter((cosmetic) => cosmetic.owned).length;
  const mutationAvailable = catalogAvailable
    && knownCosmetics.some((cosmetic) => cosmetic.mutationEligible);
  return {
    fingerprint,
    catalogAvailable,
    knownCatalogCount: catalogAvailable ? knownCosmetics.length : 0,
    knownOwnedCount: catalogAvailable ? knownOwnedCount : 0,
    knownLockedCount: catalogAvailable ? knownCosmetics.length - knownOwnedCount : 0,
    savedPresetCount: 0,
    unknownOwnedIds: cosmetics.filter((cosmetic) => !cosmetic.known).map((cosmetic) => cosmetic.id),
    capabilities: {
      canReadCosmetics: true,
      canUnlockCosmetic: mutationAvailable,
      canUnlockAll: mutationAvailable,
      canRemoveOwnership: mutationAvailable,
    },
    cosmetics,
  };
}

function renderCatalog(view: CosmeticsViewDto): void {
  render(
    <PreferencesProvider>
      <CosmeticsCatalog view={view} />
    </PreferencesProvider>,
  );
}

function visibleIds(): number[] {
  return screen.getAllByRole("listitem").map((row) => Number(row.getAttribute("data-cosmetic-id")));
}

describe("CosmeticsCatalog", () => {
  it("searches installed cosmetics by name and canonical numeric ID", async () => {
    const user = userEvent.setup();
    renderCatalog(catalogView([
      installedCosmetic(0, "Long Sleeve"),
      installedCosmetic(1, "Short Sleeve"),
      installedCosmetic(2, "Monkey"),
    ]));

    const search = screen.getByRole("searchbox", { name: "Search cosmetics" });
    await user.type(search, "mOnKeY");
    expect(visibleIds()).toEqual([2]);
    expect(screen.getByText("1 cosmetic")).toBeTruthy();

    await user.clear(search);
    await user.type(search, "1");
    expect(visibleIds()).toEqual([1]);

    const clearSearch = screen.getByRole("button", { name: "Clear cosmetic search" });
    expect(clearSearch).toBeTruthy();
    await user.click(clearSearch);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("keeps duplicate display names distinct by canonical integer ID", () => {
    renderCatalog(catalogView([
      installedCosmetic(0, "Duplicate Name", { owned: true }),
      installedCosmetic(1, "Duplicate Name"),
    ]));

    const first = screen.getByRole("listitem", { name: "Duplicate Name, ID 0, Owned" });
    const second = screen.getByRole("listitem", { name: "Duplicate Name, ID 1, Locked" });
    expect(first.getAttribute("data-cosmetic-id")).toBe("0");
    expect(second.getAttribute("data-cosmetic-id")).toBe("1");
    expect(screen.getAllByText("Duplicate Name")).toHaveLength(2);
  });

  it("filters ownership without categorizing unknown entries as unlocked or locked", async () => {
    const user = userEvent.setup();
    renderCatalog(catalogView([
      installedCosmetic(0, "Owned Cosmetic", { owned: true }),
      installedCosmetic(1, "Locked Cosmetic"),
      unknownCosmetic(999),
    ]));

    const ownership = screen.getByRole("combobox", { name: "Ownership" });
    expect(new Set(visibleIds())).toEqual(new Set([0, 1, 999]));

    await user.selectOptions(ownership, "owned");
    expect(visibleIds()).toEqual([0]);

    await user.selectOptions(ownership, "locked");
    expect(visibleIds()).toEqual([1]);

    await user.selectOptions(ownership, "all");
    expect(new Set(visibleIds())).toEqual(new Set([0, 1, 999]));
  });

  it("generates type filters from present catalog values and preserves unknown type values", async () => {
    const user = userEvent.setup();
    renderCatalog(catalogView([
      installedCosmetic(0, "Hat Cosmetic", { type: 0 }),
      installedCosmetic(1, "Ears Cosmetic", { type: 17 }),
      installedCosmetic(2, "Future Type", { type: 33 }),
      unknownCosmetic(999),
    ]));

    const typeFilter = screen.getByRole("combobox", { name: "Type" });
    const options = within(typeFilter).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["All Types", "Hat", "Ears", "Type 33"]);

    await user.selectOptions(typeFilter, "17");
    expect(visibleIds()).toEqual([1]);
    expect(screen.queryByText("Cosmetic #999")).toBeNull();

    await user.selectOptions(typeFilter, "all");
    expect(screen.getByText("Cosmetic #999")).toBeTruthy();
  });

  it("presents proven managed type, rarity, and lifecycle status symbols", () => {
    renderCatalog(catalogView([
      installedCosmetic(0, "Common WIP Hat", { type: 0, rarity: 0, status: 0 }),
      installedCosmetic(1, "Uncommon Ears", { type: 17, rarity: 1, status: 1 }),
      installedCosmetic(2, "Rare Body", { type: 20, rarity: 2, status: 2 }),
      installedCosmetic(3, "Ultra Face", { type: 32, rarity: 3, status: 3 }),
    ]));

    expect(screen.getByText("Type: Hat")).toBeTruthy();
    expect(screen.getByText("Type: Ears")).toBeTruthy();
    expect(screen.getByText("Type: Body Top")).toBeTruthy();
    expect(screen.getByText("Type: Face Bottom")).toBeTruthy();
    for (const rarity of ["Common", "Uncommon", "Rare", "Ultra Rare"]) {
      expect(screen.getByText(`Rarity: ${rarity}`)).toBeTruthy();
    }
    for (const status of ["WIP", "First Iteration", "Need Revision", "Finalized"]) {
      expect(screen.getByText(`Status: ${status}`)).toBeTruthy();
    }
  });

  it("sorts rarity ascending and keeps null rarity last", async () => {
    const user = userEvent.setup();
    renderCatalog(catalogView([
      installedCosmetic(0, "Rare", { rarity: 2 }),
      installedCosmetic(1, "Common", { rarity: 0 }),
      installedCosmetic(2, "Ultra", { rarity: 3 }),
      unknownCosmetic(999),
    ]));

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "rarity-asc");
    expect(visibleIds()).toEqual([1, 0, 2, 999]);
  });

  it("sorts rarity descending and keeps null rarity last", async () => {
    const user = userEvent.setup();
    renderCatalog(catalogView([
      installedCosmetic(0, "Rare", { rarity: 2 }),
      installedCosmetic(1, "Common", { rarity: 0 }),
      installedCosmetic(2, "Ultra", { rarity: 3 }),
      unknownCosmetic(999),
    ]));

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "rarity-desc");
    expect(visibleIds()).toEqual([2, 0, 1, 999]);
  });

  it("keeps future unknown rarity values last in both rarity directions", async () => {
    const user = userEvent.setup();

    renderCatalog(catalogView([
      installedCosmetic(0, "Common", { rarity: 0 }),
      installedCosmetic(1, "Ultra", { rarity: 3 }),
      installedCosmetic(2, "Future", { rarity: 4 }),
      unknownCosmetic(999),
    ]));

    const sort = screen.getByRole("combobox", { name: "Sort" });

    await user.selectOptions(sort, "rarity-asc");
    expect(visibleIds()).toEqual([0, 1, 999, 2]);

    await user.selectOptions(sort, "rarity-desc");
    expect(visibleIds()).toEqual([1, 0, 999, 2]);
  });
  it("uses display name then cosmetic ID as deterministic rarity tie-breakers", async () => {
    const user = userEvent.setup();
    renderCatalog(catalogView([
      installedCosmetic(0, "Twin", { rarity: 1 }),
      installedCosmetic(1, "Alpha", { rarity: 1 }),
      installedCosmetic(2, "Twin", { rarity: 1 }),
    ]));

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "rarity-desc");
    expect(visibleIds()).toEqual([1, 0, 2]);
  });

  it("derives sorted rows without mutating view.cosmetics", async () => {
    const user = userEvent.setup();
    const cosmetics = [
      installedCosmetic(0, "Zulu", { rarity: 3 }),
      installedCosmetic(1, "Alpha", { rarity: 0 }),
      installedCosmetic(2, "Mike", { rarity: 2 }),
    ];
    const view = catalogView(cosmetics);
    const originalIds = view.cosmetics.map((cosmetic) => cosmetic.id);
    renderCatalog(view);

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "id-desc");
    expect(visibleIds()).toEqual([2, 1, 0]);
    expect(view.cosmetics.map((cosmetic) => cosmetic.id)).toEqual(originalIds);
  });

  it("sorts IDs ascending and descending", async () => {
    const user = userEvent.setup();
    renderCatalog(catalogView([
      installedCosmetic(0, "Zulu"),
      installedCosmetic(1, "Alpha"),
      installedCosmetic(2, "Mike"),
    ]));

    const sort = screen.getByRole("combobox", { name: "Sort" });
    await user.selectOptions(sort, "id-desc");
    expect(visibleIds()).toEqual([2, 1, 0]);
    await user.selectOptions(sort, "id-asc");
    expect(visibleIds()).toEqual([0, 1, 2]);
  });

  it("sorts duplicate names deterministically by ID in both name directions", async () => {
    const user = userEvent.setup();
    renderCatalog(catalogView([
      installedCosmetic(0, "Twin"),
      installedCosmetic(1, "Alpha"),
      installedCosmetic(2, "Twin"),
    ]));

    const sort = screen.getByRole("combobox", { name: "Sort" });
    expect(visibleIds()).toEqual([1, 0, 2]);
    await user.selectOptions(sort, "name-desc");
    expect(visibleIds()).toEqual([0, 2, 1]);
  });

  it("renders future enum integers as numeric fallbacks without hiding the cosmetic", () => {
    renderCatalog(catalogView([
      installedCosmetic(0, "Future Cosmetic", {
        type: 33,
        rarity: 4,
        status: 4,
      }),
    ]));

    const row = screen.getByRole("listitem", { name: "Future Cosmetic, ID 0, Locked" });
    expect(within(row).getByText("Type 33")).toBeTruthy();
    expect(within(row).getByText("Rarity 4")).toBeTruthy();
    expect(within(row).getByText("Status 4")).toBeTruthy();
  });

  it("keeps a future installed ID visible but read-only", () => {
    const futureCatalog = Array.from({ length: 548 }, (_, id) =>
      installedCosmetic(
        id,
        id === 547 ? "Future Installed Cosmetic" : `Installed Cosmetic ${id}`,
      ),
    );
    renderCatalog(catalogView(futureCatalog));

    const row = screen.getByRole("listitem", { name: "Future Installed Cosmetic, ID 547, Locked" });
    expect(row.getAttribute("data-cosmetic-id")).toBe("547");
    expect(within(row).getByText("Read only")).toBeTruthy();
  });

  it("keeps the degraded warning visible while filtering preserved unknown IDs", async () => {
    const user = userEvent.setup();
    renderCatalog(catalogView([unknownCosmetic(27), unknownCosmetic(999)], false));

    expect(screen.getByRole("status").textContent).toContain(
      "Installed cosmetic metadata is unavailable",
    );
    for (const id of [27, 999]) {
      const row = screen.getByRole("listitem", { name: `Cosmetic #${id}, ID ${id}, Unknown` });
      expect(row.getAttribute("data-cosmetic-id")).toBe(String(id));
      expect(within(row).getByText("Read only")).toBeTruthy();
      expect(within(row).getByText(/Preserved from the save/)).toBeTruthy();
    }

    await user.selectOptions(screen.getByRole("combobox", { name: "Ownership" }), "owned");
    expect(screen.getByText("No cosmetics match the current search and filters.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "Installed cosmetic metadata is unavailable",
    );
  });

  it("exposes accessible controls, a live result count, and an explicit no-results state", async () => {
    const user = userEvent.setup();
    renderCatalog(catalogView([
      installedCosmetic(0, "Long Sleeve"),
      installedCosmetic(1, "Short Sleeve"),
    ]));

    expect(screen.getByRole("searchbox", { name: "Search cosmetics" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Ownership" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Type" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Sort" })).toBeTruthy();
    expect(screen.getByText("2 cosmetics").getAttribute("aria-live")).toBe("polite");

    await user.type(screen.getByRole("searchbox", { name: "Search cosmetics" }), "missing");
    expect(screen.getByText("0 cosmetics")).toBeTruthy();
    expect(screen.getByText("No cosmetics match the current search and filters.")).toBeTruthy();
  });
});
