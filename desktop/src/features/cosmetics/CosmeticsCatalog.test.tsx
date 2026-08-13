import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CosmeticDto, CosmeticsViewDto } from "@electron/contracts";
import { PreferencesProvider } from "@/app/PreferencesProvider";
import { CosmeticsCatalog } from "@/features/cosmetics/CosmeticsCatalog";

const fingerprint = "c".repeat(64);

function installedCosmetic(
  id: number,
  displayName: string,
  options: { readonly owned?: boolean; readonly mutationEligible?: boolean } = {},
): CosmeticDto {
  const owned = options.owned ?? false;
  const mutationEligible = options.mutationEligible ?? true;
  return {
    id,
    displayName,
    type: id + 2,
    rarity: id,
    status: 1,
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

describe("CosmeticsCatalog", () => {
  it("shows installed names and numeric metadata with canonical integer IDs", () => {
    renderCatalog(catalogView([installedCosmetic(0, "Long Sleeve", { owned: true })]));

    const row = screen.getByRole("listitem", { name: "Long Sleeve, ID 0, Owned" });
    expect(row.getAttribute("data-cosmetic-id")).toBe("0");
    expect(within(row).getByText("Long Sleeve")).toBeTruthy();
    expect(within(row).getByText("ID 0")).toBeTruthy();
    expect(within(row).getByText("Type 2")).toBeTruthy();
    expect(within(row).getByText("Rarity 0")).toBeTruthy();
    expect(within(row).getByText("Status 1")).toBeTruthy();
  });

  it("keeps duplicate display names distinct by canonical integer ID", () => {
    renderCatalog(
      catalogView([
        installedCosmetic(0, "Duplicate Name", { owned: true }),
        installedCosmetic(1, "Duplicate Name"),
      ]),
    );

    const first = screen.getByRole("listitem", { name: "Duplicate Name, ID 0, Owned" });
    const second = screen.getByRole("listitem", { name: "Duplicate Name, ID 1, Locked" });
    expect(first.getAttribute("data-cosmetic-id")).toBe("0");
    expect(second.getAttribute("data-cosmetic-id")).toBe("1");
    expect(screen.getAllByText("Duplicate Name")).toHaveLength(2);
  });

  it("keeps future installed IDs visible but read-only", () => {
    const futureCatalog = Array.from({ length: 548 }, (_, id) =>
      installedCosmetic(
        id,
        id === 547 ? "Future Cosmetic" : `Installed Cosmetic ${id}`,
        { mutationEligible: id < 547 },
      ),
    );
    renderCatalog(catalogView(futureCatalog));

    const row = screen.getByRole("listitem", { name: "Future Cosmetic, ID 547, Locked" });
    expect(row.getAttribute("data-cosmetic-id")).toBe("547");
    expect(within(row).getByText("Future Cosmetic")).toBeTruthy();
    expect(within(row).getByText("ID 547")).toBeTruthy();
    expect(within(row).getByText("Read only")).toBeTruthy();
  });

  it("shows preserved unknown IDs and an explicit degraded-catalog state", () => {
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
  });
});
