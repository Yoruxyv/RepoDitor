/**
 * Searchable, sortable, lazily illustrated installed cosmetic catalog.
 *
 * Filtering changes only presentation order. Numeric IDs remain canonical and all
 * action availability is supplied by the typed domain projection.
 */
import { MagnifyingGlassIcon, TShirtIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import type { CosmeticDto, CosmeticsViewDto } from "@electron/contracts";

import { COSMETIC_ICON_SIZE, GameIcon } from "@/components/GameIcon";
import { Select } from "@/components/Select";
import { Skeleton } from "@/components/Skeleton";
import { usePreferences } from "@/app/preferences";
import type { Translate } from "@/app/i18n";

interface CosmeticsCatalogProps {
  readonly view: CosmeticsViewDto;
  readonly actionsDisabled: boolean;
  readonly artworkActive?: boolean | undefined;
  readonly artworkPending?: boolean | undefined;
  readonly onUnlockCosmetic: ((cosmeticId: number) => void) | null;
}

type OwnershipFilter = "all" | "owned" | "locked";
type TypeFilter = "all" | number;

const COSMETIC_SORT = {
  idAscending: "id-asc",
  idDescending: "id-desc",
  nameAscending: "name-asc",
  nameDescending: "name-desc",
  rarityAscending: "rarity-asc",
  rarityDescending: "rarity-desc",
} as const;

type CosmeticSort = (typeof COSMETIC_SORT)[keyof typeof COSMETIC_SORT];

const COSMETIC_TRANSLATION_KEY = {
  typeLabel: "cosmetics.typeLabel",
} as const;

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

function formatManagedSymbol(symbol: string): string {
  return symbol.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function managedSymbol(symbols: readonly string[], value: number): string | null {
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
    ? t(COSMETIC_TRANSLATION_KEY.typeLabel, { type })
    : t("cosmetics.typeManagedLabel", { type: name });
}

function cosmeticRarityLabel(rarity: number, t: Translate): string {
  const name = managedSymbol(COSMETIC_RARITY_SYMBOLS, rarity);
  return name === null
    ? t("cosmetics.rarityLabel", { rarity })
    : t("cosmetics.rarityManagedLabel", { rarity: name });
}

function isUnlockEligible(view: CosmeticsViewDto, cosmetic: CosmeticDto): boolean {
  return (
    view.capabilities.canUnlockCosmetic &&
    cosmetic.known &&
    cosmetic.state === "locked" &&
    !cosmetic.owned &&
    cosmetic.mutationEligible
  );
}

function compareDisplayName(left: CosmeticDto, right: CosmeticDto): number {
  return left.displayName.localeCompare(right.displayName) || left.id - right.id;
}

function compareRarity(left: CosmeticDto, right: CosmeticDto, direction: "asc" | "desc"): number {
  const leftRarity =
    left.rarity !== null && left.rarity >= 0 && left.rarity < COSMETIC_RARITY_SYMBOLS.length
      ? left.rarity
      : null;

  const rightRarity =
    right.rarity !== null && right.rarity >= 0 && right.rarity < COSMETIC_RARITY_SYMBOLS.length
      ? right.rarity
      : null;

  if (leftRarity === null && rightRarity !== null) return 1;
  if (leftRarity !== null && rightRarity === null) return -1;

  if (leftRarity !== null && rightRarity !== null && leftRarity !== rightRarity) {
    const difference = leftRarity - rightRarity;
    return direction === "asc" ? difference : -difference;
  }

  return compareDisplayName(left, right);
}
function sortCosmetics(cosmetics: CosmeticDto[], sort: CosmeticSort): CosmeticDto[] {
  return cosmetics.sort((left, right) => {
    switch (sort) {
      case COSMETIC_SORT.nameAscending:
        return compareDisplayName(left, right);
      case COSMETIC_SORT.nameDescending: {
        const nameOrder = right.displayName.localeCompare(left.displayName);
        return nameOrder || left.id - right.id;
      }
      case COSMETIC_SORT.rarityAscending:
        return compareRarity(left, right, "asc");
      case COSMETIC_SORT.rarityDescending:
        return compareRarity(left, right, "desc");
      case COSMETIC_SORT.idAscending:
        return left.id - right.id;
      case COSMETIC_SORT.idDescending:
        return right.id - left.id;
    }
  });
}

function cosmeticTypeOptions(cosmetics: readonly CosmeticDto[]): number[] {
  return [
    ...new Set(
      cosmetics.flatMap((cosmetic) =>
        cosmetic.known && cosmetic.type !== null ? [cosmetic.type] : [],
      ),
    ),
  ].sort((left, right) => left - right);
}

function matchesCatalogFilters(
  cosmetic: CosmeticDto,
  query: string,
  ownershipFilter: OwnershipFilter,
  typeFilter: TypeFilter,
): boolean {
  const matchesSearch =
    !query ||
    cosmetic.displayName.toLocaleLowerCase().includes(query) ||
    String(cosmetic.id).includes(query);
  const matchesOwnership = ownershipFilter === "all" || cosmetic.state === ownershipFilter;
  const matchesType = typeFilter === "all" || cosmetic.type === typeFilter;
  return matchesSearch && matchesOwnership && matchesType;
}

export function CosmeticsCatalog({
  view,
  actionsDisabled,
  artworkActive,
  artworkPending,
  onUnlockCosmetic,
}: CosmeticsCatalogProps) {
  const { t } = usePreferences();
  const [search, setSearch] = useState("");
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<CosmeticSort>(COSMETIC_SORT.nameAscending);
  const searchInput = useRef<HTMLInputElement>(null);
  const ownershipFilterLabel = t("cosmetics.ownershipFilterLabel");
  const typeFilterLabel = t("cosmetics.typeFilterLabel");
  const sortLabel = t("cosmetics.sortLabel");
  const typeOptions = cosmeticTypeOptions(view.cosmetics);
  const sortedCosmetics = sortCosmetics([...view.cosmetics], sort);
  const query = search.trim().toLocaleLowerCase();
  const visibleCosmeticIds = new Set(
    sortedCosmetics
      .filter((cosmetic) => matchesCatalogFilters(cosmetic, query, ownershipFilter, typeFilter))
      .map((cosmetic) => cosmetic.id),
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
        <output className="mt-4 block border-l-2 border-warning bg-warning-muted px-4 py-3 text-sm/6 text-secondary">
          {t("cosmetics.catalogUnavailableMetadata")}
        </output>
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
            <span>{ownershipFilterLabel}</span>
            <Select<OwnershipFilter>
              ariaLabel={ownershipFilterLabel}
              className="mt-2"
              options={[
                { value: "all", label: t("cosmetics.filterAll") },
                { value: "owned", label: t("cosmetics.filterUnlocked") },
                { value: "locked", label: t("cosmetics.filterLocked") },
              ]}
              value={ownershipFilter}
              onValueChange={setOwnershipFilter}
            />
          </label>

          <label className="min-w-40 flex-[1_1_10rem] text-sm font-semibold text-ink">
            <span>{typeFilterLabel}</span>
            <Select<TypeFilter>
              ariaLabel={typeFilterLabel}
              className="mt-2"
              options={[
                { value: "all", label: t("cosmetics.filterAllTypes") },
                ...typeOptions.map((type) => ({
                  value: type,
                  label: typeName(type) ?? t(COSMETIC_TRANSLATION_KEY.typeLabel, { type }),
                })),
              ]}
              value={typeFilter}
              onValueChange={setTypeFilter}
            />
          </label>

          <label className="min-w-48 flex-[1_1_12rem] text-sm font-semibold text-ink">
            <span>{sortLabel}</span>
            <Select<CosmeticSort>
              ariaLabel={sortLabel}
              className="mt-2"
              options={[
                { value: COSMETIC_SORT.nameAscending, label: t("cosmetics.sortNameAsc") },
                { value: COSMETIC_SORT.nameDescending, label: t("cosmetics.sortNameDesc") },
                { value: COSMETIC_SORT.rarityAscending, label: t("cosmetics.sortRarityAsc") },
                { value: COSMETIC_SORT.rarityDescending, label: t("cosmetics.sortRarityDesc") },
                { value: COSMETIC_SORT.idAscending, label: t("cosmetics.sortIdAsc") },
                { value: COSMETIC_SORT.idDescending, label: t("cosmetics.sortIdDesc") },
              ]}
              value={sort}
              onValueChange={setSort}
            />
          </label>
        </div>

        <p aria-live="polite" className="mt-2 text-xs text-muted" id="cosmetic-filter-status">
          {t(visibleCosmeticIds.size === 1 ? "cosmetics.matches.one" : "cosmetics.matches.many", {
            count: visibleCosmeticIds.size,
          })}
        </p>
      </div>

      {visibleCosmeticIds.size === 0 ? (
        <p className="mt-4 border-y border-line py-8 text-sm text-secondary">
          {t("cosmetics.noMatches")}
        </p>
      ) : null}
      <ul
        aria-label={t("cosmetics.catalogList")}
        className="mt-4 grid max-h-128 gap-2 overflow-y-auto pr-1 md:grid-cols-2 2xl:grid-cols-3"
      >
        {sortedCosmetics.map((cosmetic) => {
          const stateLabel = cosmeticStateLabel(cosmetic, t);
          const visible = visibleCosmeticIds.has(cosmetic.id);
          const showArtwork = artworkActive === undefined || (artworkActive && visible);
          const iconId = `cosmetic-icon-${cosmetic.id}`;
          const pendingArtwork = artworkPending && cosmetic.iconToken !== null;
          return (
            <li
              aria-label={t("cosmetics.itemLabel", {
                id: cosmetic.id,
                name: cosmetic.displayName,
                state: stateLabel,
              })}
              className="min-w-0 rounded-sm border border-line bg-surface p-3"
              data-cosmetic-id={cosmetic.id}
              hidden={!visible}
              key={cosmetic.id}
            >
              <div className="flex min-w-0 items-start gap-3">
                {showArtwork && pendingArtwork ? (
                  <Skeleton
                    className={`${COSMETIC_ICON_SIZE} shrink-0 border border-line`}
                    testId={`${iconId}-loading`}
                  />
                ) : null}
                {showArtwork && !pendingArtwork ? (
                  <GameIcon
                    key={artworkActive === undefined ? undefined : cosmetic.iconToken}
                    fallback={TShirtIcon}
                    fallbackSource="fallback"
                    loading="lazy"
                    testId={iconId}
                    token={cosmetic.iconToken}
                    variant="cosmetic"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-semibold text-ink"
                    title={cosmetic.displayName}
                  >
                    {cosmetic.displayName}
                  </p>
                  <p className="mt-1 font-mono text-xs text-secondary">
                    {t("cosmetics.idLabel", { id: cosmetic.id })}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-semibold text-secondary">{stateLabel}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-secondary">
                {cosmetic.type === null ? null : <span>{cosmeticTypeLabel(cosmetic.type, t)}</span>}
                {cosmetic.rarity === null ? null : (
                  <span>{cosmeticRarityLabel(cosmetic.rarity, t)}</span>
                )}
                {!cosmetic.mutationEligible ? (
                  <span className="font-semibold text-warning">{t("cosmetics.readOnly")}</span>
                ) : null}
              </div>

              {onUnlockCosmetic !== null && isUnlockEligible(view, cosmetic) ? (
                <button
                  aria-label={t("cosmetics.unlockCosmetic", { name: cosmetic.displayName })}
                  className="ui-feedback mt-3 rounded-sm border border-control px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={actionsDisabled}
                  type="button"
                  onClick={() => onUnlockCosmetic(cosmetic.id)}
                >
                  {t("cosmetics.unlock")}
                </button>
              ) : null}

              {!cosmetic.known ? (
                <p className="mt-2 text-xs/5 text-secondary">{t("cosmetics.unknownPreserved")}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
