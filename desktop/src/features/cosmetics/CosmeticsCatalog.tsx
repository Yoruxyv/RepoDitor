import { MagnifyingGlassIcon, TShirtIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import type { CosmeticDto, CosmeticsViewDto } from "@electron/contracts";

import { GameIcon } from "@/components/GameIcon";
import { usePreferences } from "@/app/preferences";
import type { Translate } from "@/app/translations";

interface CosmeticsCatalogProps {
  readonly view: CosmeticsViewDto;
}

type OwnershipFilter = "all" | "owned" | "locked";
type CosmeticSort =
  | "name-asc"
  | "name-desc"
  | "rarity-asc"
  | "rarity-desc"
  | "id-asc"
  | "id-desc";
type TypeFilter = "all" | number;

const COSMETIC_TYPE_SYMBOLS = [
  "Hat",
  "ArmRight",
  "ArmLeft",
  "LegRight",
  "LegLeft",
  "HeadTopMesh",
  "HeadBottomMesh",
  "BodyTopMesh",
  "BodyBottomMesh",
  "ArmRightMesh",
  "ArmLeftMesh",
  "LegRightMesh",
  "LegLeftMesh",
  "GrabberMesh",
  "EyeLidRightMesh",
  "EyeLidLeftMesh",
  "BodyTopOverlay",
  "Ears",
  "Eyewear",
  "FootRight",
  "BodyTop",
  "BodyBottom",
  "FootLeft",
  "BodyBottomOverlay",
  "HeadTopOverlay",
  "HeadBottomOverlay",
  "ArmRightOverlay",
  "ArmLeftOverlay",
  "LegRightOverlay",
  "LegLeftOverlay",
  "HeadBottom",
  "FaceTop",
  "FaceBottom",
] as const;
const COSMETIC_RARITY_SYMBOLS = ["Common", "Uncommon", "Rare", "UltraRare"] as const;
const COSMETIC_STATUS_SYMBOLS = ["WIP", "FirstIteration", "NeedRevision", "Finalized"] as const;

function formatManagedSymbol(symbol: string): string {
  return symbol.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function managedSymbol(
  symbols: readonly string[],
  value: number,
): string | null {
  const symbol = symbols[value];
  return symbol === undefined ? null : formatManagedSymbol(symbol);
}

function cosmeticStateLabel(cosmetic: CosmeticDto, t: Translate): string {
  switch (cosmetic.state) {
    case "owned":
      return t("cosmetics.owned");
    case "locked":
      return t("cosmetics.locked");
    case "unknown":
      return t("cosmetics.unknown");
  }
}

function typeName(type: number): string | null {
  return managedSymbol(COSMETIC_TYPE_SYMBOLS, type);
}

function cosmeticTypeLabel(type: number, t: Translate): string {
  const name = typeName(type);
  return name === null
    ? t("cosmetics.typeLabel", { type })
    : t("cosmetics.typeManagedLabel", { type: name });
}

function cosmeticRarityLabel(rarity: number, t: Translate): string {
  const name = managedSymbol(COSMETIC_RARITY_SYMBOLS, rarity);
  return name === null
    ? t("cosmetics.rarityLabel", { rarity })
    : t("cosmetics.rarityManagedLabel", { rarity: name });
}

function cosmeticStatusLabel(status: number, t: Translate): string {
  const name = managedSymbol(COSMETIC_STATUS_SYMBOLS, status);
  return name === null
    ? t("cosmetics.statusLabel", { status })
    : t("cosmetics.statusManagedLabel", { status: name });
}

function compareDisplayName(left: CosmeticDto, right: CosmeticDto): number {
  return left.displayName.localeCompare(right.displayName) || left.id - right.id;
}

function compareRarity(
  left: CosmeticDto,
  right: CosmeticDto,
  direction: "asc" | "desc",
): number {
  const leftRarity =
    left.rarity !== null
    && left.rarity >= 0
    && left.rarity < COSMETIC_RARITY_SYMBOLS.length
      ? left.rarity
      : null;

  const rightRarity =
    right.rarity !== null
    && right.rarity >= 0
    && right.rarity < COSMETIC_RARITY_SYMBOLS.length
      ? right.rarity
      : null;

  if (leftRarity === null && rightRarity !== null) return 1;
  if (leftRarity !== null && rightRarity === null) return -1;

  if (
    leftRarity !== null
    && rightRarity !== null
    && leftRarity !== rightRarity
  ) {
    const difference = leftRarity - rightRarity;
    return direction === "asc" ? difference : -difference;
  }

  return compareDisplayName(left, right);
}
function sortCosmetics(cosmetics: CosmeticDto[], sort: CosmeticSort): CosmeticDto[] {
  return cosmetics.sort((left, right) => {
    switch (sort) {
      case "name-asc":
        return compareDisplayName(left, right);
      case "name-desc": {
        const nameOrder = right.displayName.localeCompare(left.displayName);
        return nameOrder || left.id - right.id;
      }
      case "rarity-asc":
        return compareRarity(left, right, "asc");
      case "rarity-desc":
        return compareRarity(left, right, "desc");
      case "id-asc":
        return left.id - right.id;
      case "id-desc":
        return right.id - left.id;
    }
  });
}

function cosmeticTypeOptions(cosmetics: readonly CosmeticDto[]): number[] {
  return [...new Set(
    cosmetics.flatMap((cosmetic) =>
      cosmetic.known && cosmetic.type !== null ? [cosmetic.type] : [],
    ),
  )].sort((left, right) => left - right);
}

function visibleCatalogCosmetics(
  cosmetics: readonly CosmeticDto[],
  search: string,
  ownershipFilter: OwnershipFilter,
  typeFilter: TypeFilter,
  sort: CosmeticSort,
): CosmeticDto[] {
  const query = search.trim().toLocaleLowerCase();
  const filtered = cosmetics.filter((cosmetic) => {
    const matchesSearch = !query
      || cosmetic.displayName.toLocaleLowerCase().includes(query)
      || String(cosmetic.id).includes(query);
    const matchesOwnership = ownershipFilter === "all"
      || cosmetic.state === ownershipFilter;
    const matchesType = typeFilter === "all" || cosmetic.type === typeFilter;
    return matchesSearch && matchesOwnership && matchesType;
  });
  return sortCosmetics(filtered, sort);
}

export function CosmeticsCatalog({ view }: CosmeticsCatalogProps) {
  const { t } = usePreferences();
  const [search, setSearch] = useState("");
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<CosmeticSort>("name-asc");
  const searchInput = useRef<HTMLInputElement>(null);
  const typeOptions = cosmeticTypeOptions(view.cosmetics);
  const visibleCosmetics = visibleCatalogCosmetics(
    view.cosmetics,
    search,
    ownershipFilter,
    typeFilter,
    sort,
  );

  function clearSearch(): void {
    setSearch("");
    searchInput.current?.focus();
  }

  return (
    <section aria-labelledby="cosmetics-catalog-title" className="mt-8 border-t border-line pt-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink" id="cosmetics-catalog-title">
            {t("cosmetics.catalog")}
          </h3>
          <p className="mt-1 max-w-[68ch] text-sm/6 text-secondary">
            {t("cosmetics.catalogDescription")}
          </p>
        </div>
        {view.catalogAvailable ? (
          <span className="font-mono text-xs text-secondary">
            {t("cosmetics.catalogCount", { count: view.knownCatalogCount })}
          </span>
        ) : null}
      </div>

      {!view.catalogAvailable ? (
        <p
          className="mt-4 border-l-2 border-warning bg-warning-muted px-4 py-3 text-sm/6 text-secondary"
          role="status"
        >
          {t("cosmetics.catalogUnavailableMetadata")}
        </p>
      ) : null}

      <div className="mt-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-[2_1_20rem]">
            <label className="text-sm font-semibold text-ink" htmlFor="cosmetic-search">
              {t("cosmetics.searchLabel")}
            </label>
            <div className="relative mt-2">
              <MagnifyingGlassIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
                size={17}
              />
              <input
                aria-describedby="cosmetic-filter-status"
                className="w-full rounded-sm border border-control bg-surface py-2.5 pr-11 pl-10 text-sm text-ink focus:border-accent"
                id="cosmetic-search"
                placeholder={t("cosmetics.searchPlaceholder")}
                ref={searchInput}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search ? (
                <button
                  aria-label={t("cosmetics.clearSearch")}
                  className="ui-feedback absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-2 text-muted hover:text-accent"
                  type="button"
                  onClick={clearSearch}
                >
                  <XIcon aria-hidden="true" size={15} weight="bold" />
                </button>
              ) : null}
            </div>
          </div>

          <label className="min-w-36 flex-[1_1_9rem] text-sm font-semibold text-ink">
            <span>{t("cosmetics.ownershipFilterLabel")}</span>
            <select
              className="mt-2 block w-full rounded-sm border border-control bg-surface px-3 py-2.5 text-sm text-ink focus:border-accent"
              value={ownershipFilter}
              onChange={(event) => setOwnershipFilter(event.target.value as OwnershipFilter)}
            >
              <option value="all">{t("cosmetics.filterAll")}</option>
              <option value="owned">{t("cosmetics.filterUnlocked")}</option>
              <option value="locked">{t("cosmetics.filterLocked")}</option>
            </select>
          </label>

          <label className="min-w-40 flex-[1_1_10rem] text-sm font-semibold text-ink">
            <span>{t("cosmetics.typeFilterLabel")}</span>
            <select
              className="mt-2 block w-full rounded-sm border border-control bg-surface px-3 py-2.5 text-sm text-ink focus:border-accent"
              value={typeFilter}
              onChange={(event) => {
                const value = event.target.value;
                setTypeFilter(value === "all" ? "all" : Number(value));
              }}
            >
              <option value="all">{t("cosmetics.filterAllTypes")}</option>
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {typeName(type) ?? t("cosmetics.typeLabel", { type })}
                </option>
              ))}
            </select>
          </label>

          <label className="min-w-48 flex-[1_1_12rem] text-sm font-semibold text-ink">
            <span>{t("cosmetics.sortLabel")}</span>
            <select
              className="mt-2 block w-full rounded-sm border border-control bg-surface px-3 py-2.5 text-sm text-ink focus:border-accent"
              value={sort}
              onChange={(event) => setSort(event.target.value as CosmeticSort)}
            >
              <option value="name-asc">{t("cosmetics.sortNameAsc")}</option>
              <option value="name-desc">{t("cosmetics.sortNameDesc")}</option>
              <option value="rarity-asc">{t("cosmetics.sortRarityAsc")}</option>
              <option value="rarity-desc">{t("cosmetics.sortRarityDesc")}</option>
              <option value="id-asc">{t("cosmetics.sortIdAsc")}</option>
              <option value="id-desc">{t("cosmetics.sortIdDesc")}</option>
            </select>
          </label>
        </div>

        <p aria-live="polite" className="mt-2 text-xs text-muted" id="cosmetic-filter-status">
          {t(
            visibleCosmetics.length === 1
              ? "cosmetics.matches.one"
              : "cosmetics.matches.many",
            { count: visibleCosmetics.length },
          )}
        </p>
      </div>

      {visibleCosmetics.length === 0 ? (
        <p className="mt-4 border-y border-line py-8 text-sm text-secondary">
          {t("cosmetics.noMatches")}
        </p>
      ) : (
        <ul
          aria-label={t("cosmetics.catalogList")}
          className="mt-4 grid max-h-128 gap-2 overflow-y-auto pr-1 md:grid-cols-2 2xl:grid-cols-3"
        >
          {visibleCosmetics.map((cosmetic) => {
            const stateLabel = cosmeticStateLabel(cosmetic, t);
            return (
              <li
                aria-label={t("cosmetics.itemLabel", {
                  id: cosmetic.id,
                  name: cosmetic.displayName,
                  state: stateLabel,
                })}
                className="min-w-0 rounded-sm border border-line bg-surface p-3"
                data-cosmetic-id={cosmetic.id}
                key={cosmetic.id}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <GameIcon
                    fallback={TShirtIcon}
                    fallbackSource="fallback"
                    loading="lazy"
                    testId={`cosmetic-icon-${cosmetic.id}`}
                    token={cosmetic.iconToken}
                    variant="cosmetic"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink" title={cosmetic.displayName}>
                      {cosmetic.displayName}
                    </p>
                    <p className="mt-1 font-mono text-xs text-secondary">
                      {t("cosmetics.idLabel", { id: cosmetic.id })}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-secondary">{stateLabel}</span>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
                  {cosmetic.type === null ? null : (
                    <span>{cosmeticTypeLabel(cosmetic.type, t)}</span>
                  )}
                  {cosmetic.rarity === null ? null : (
                    <span>{cosmeticRarityLabel(cosmetic.rarity, t)}</span>
                  )}
                  {cosmetic.status === null ? null : (
                    <span>{cosmeticStatusLabel(cosmetic.status, t)}</span>
                  )}
                  {!cosmetic.mutationEligible ? (
                    <span className="font-semibold text-warning">{t("cosmetics.readOnly")}</span>
                  ) : null}
                </div>

                {!cosmetic.known ? (
                  <p className="mt-2 text-xs/5 text-secondary">{t("cosmetics.unknownPreserved")}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
