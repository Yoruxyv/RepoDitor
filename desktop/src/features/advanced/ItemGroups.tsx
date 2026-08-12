import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import type { AdvancedItemDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import type { Translate } from "@/app/translations";
import { FeatureIcon } from "@/components/FeatureIcon";
import type { AdvancedRefillEdit } from "@/features/editor/pendingEdits";
import { getItemIcon } from "./itemIcons";

interface ItemGroupsProps {
  readonly canRefillToFull: boolean;
  readonly items: readonly AdvancedItemDto[];
  readonly pendingByItem: Readonly<Record<string, AdvancedRefillEdit>>;
  readonly onRefillAllToFull: () => void;
  readonly onRefillToFull: (item: AdvancedItemDto) => void;
  readonly onRevertRefill: (saveKey: string) => void;
}

interface ItemGroup {
  readonly name: string;
  readonly items: AdvancedItemDto[];
}

type ItemFilter = "all" | "rechargeable" | "other";
type ItemSort = "name-asc" | "name-desc" | "quantity-desc";

function groupItems(items: readonly AdvancedItemDto[]): ItemGroup[] {
  const groups = new Map<string, AdvancedItemDto[]>();
  for (const item of items) {
    const group = groups.get(item.name);
    if (group) group.push(item);
    else groups.set(item.name, [item]);
  }
  return [...groups].map(([name, groupedItems]) => ({ name, items: groupedItems }));
}

function chargeText(
  item: AdvancedItemDto,
  pending: AdvancedRefillEdit | undefined,
  t: Translate,
): string | null {
  if (pending || item.chargeState === "default_full") return t("status.fullDefault");
  if (item.chargeState === "stored") {
    return t("items.chargeValue", { value: String(item.storedCharge) });
  }
  return null;
}

export function ItemGroups({
  canRefillToFull,
  items,
  pendingByItem,
  onRefillAllToFull,
  onRefillToFull,
  onRevertRefill,
}: ItemGroupsProps) {
  const { t } = usePreferences();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [sort, setSort] = useState<ItemSort>("name-asc");
  const searchInput = useRef<HTMLInputElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const visibleItems = items.filter((item) => {
    const matchesSearch = !query || item.name.toLocaleLowerCase().includes(query);
    const rechargeable = item.chargeState === "stored" || item.chargeState === "default_full";
    return matchesSearch && (
      filter === "all"
      || (filter === "rechargeable" ? rechargeable : !rechargeable)
    );
  });
  const visibleKeys = new Set(visibleItems.map((item) => item.saveKey));
  const itemKeys = new Set(items.map((item) => item.saveKey));
  const hiddenPendingCount = Object.keys(pendingByItem).filter(
    (saveKey) => itemKeys.has(saveKey) && !visibleKeys.has(saveKey),
  ).length;
  const hiddenPendingKey = hiddenPendingCount === 1
    ? "items.hiddenPending.one"
    : "items.hiddenPending.many";
  const groups = groupItems(visibleItems).sort((left, right) => {
    if (sort === "quantity-desc") {
      return right.items.length - left.items.length || left.name.localeCompare(right.name);
    }
    const order = left.name.localeCompare(right.name);
    return sort === "name-desc" ? -order : order;
  });
  const canRechargeAll = canRefillToFull && items.some(
    (item) => item.chargeState === "stored" && !pendingByItem[item.saveKey],
  );

  function clearSearch(): void {
    setSearch("");
    searchInput.current?.focus();
  }

  return (
    <>
      <div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-[1_1_20rem]">
            <label className="text-sm font-semibold text-ink" htmlFor="item-search">
              {t("items.searchLabel")}
            </label>
            <div className="relative mt-2">
              <MagnifyingGlassIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
                size={17}
              />
              <input
                aria-describedby="item-filter-status"
                className="w-full rounded-sm border border-control bg-surface py-2.5 pr-11 pl-10 text-sm text-ink focus:border-accent"
                id="item-search"
                placeholder={t("items.searchPlaceholder")}
                ref={searchInput}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search ? (
                <button
                  aria-label={t("items.clearSearch")}
                  className="ui-feedback absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-2 text-muted hover:text-accent"
                  type="button"
                  onClick={clearSearch}
                >
                  <XIcon aria-hidden="true" size={15} weight="bold" />
                </button>
              ) : null}
            </div>
          </div>
          <label className="w-44 text-sm font-semibold text-ink">
            <span>{t("items.filterLabel")}</span>
            <select
              className="mt-2 block w-full rounded-sm border border-control bg-surface px-3 py-2.5 text-sm text-ink focus:border-accent"
              value={filter}
              onChange={(event) => setFilter(event.target.value as ItemFilter)}
            >
              <option value="all">{t("items.filterAll")}</option>
              <option value="rechargeable">{t("items.filterRechargeable")}</option>
              <option value="other">{t("items.filterOther")}</option>
            </select>
          </label>
          <label className="w-44 text-sm font-semibold text-ink">
            <span>{t("items.sortLabel")}</span>
            <select
              className="mt-2 block w-full rounded-sm border border-control bg-surface px-3 py-2.5 text-sm text-ink focus:border-accent"
              value={sort}
              onChange={(event) => setSort(event.target.value as ItemSort)}
            >
              <option value="name-asc">{t("items.sortNameAsc")}</option>
              <option value="name-desc">{t("items.sortNameDesc")}</option>
              <option value="quantity-desc">{t("items.sortQuantity")}</option>
            </select>
          </label>
          <button
            className="ui-feedback whitespace-nowrap rounded-sm border border-accent px-4 py-2.5 text-sm font-semibold text-accent hover:bg-accent hover:text-accent-ink disabled:cursor-not-allowed disabled:border-control disabled:text-muted disabled:opacity-60"
            data-testid="recharge-all-tools"
            disabled={!canRechargeAll}
            type="button"
            onClick={onRefillAllToFull}
          >
            {t("items.rechargeAll")}
          </button>
        </div>
        <p aria-live="polite" className="mt-2 text-xs text-muted" id="item-filter-status">
          {t(
            visibleItems.length === 1 ? "items.matches.one" : "items.matches.many",
            { count: visibleItems.length },
          )}
          {hiddenPendingCount > 0
            ? ` · ${t(hiddenPendingKey, { count: hiddenPendingCount })}`
            : null}
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="mt-5 border-y border-line py-8 text-sm text-secondary">
          {t("items.noMatches")}
        </p>
      ) : (
        <ul className="mt-5 space-y-4" aria-label={t("items.instances")}>
          {groups.map((group) => {
            const itemIcon = getItemIcon(group.name);
            const chargeRows = group.items
              .map((item) => {
                const pending = pendingByItem[item.saveKey];
                return { item, pending, status: chargeText(item, pending, t) };
              })
              .filter((row) => row.status !== null);
            return (
              <li
                className="min-w-0 border-y border-line bg-surface"
                data-testid={`item-group-${group.name}`}
                key={group.name}
              >
                <header className="flex items-center gap-3 px-4 py-3">
                  <FeatureIcon
                    icon={itemIcon.icon}
                    source={itemIcon.source}
                    testId={`item-icon-${group.items[0]!.saveKey}`}
                    variant="item"
                  />
                  <h4 className="min-w-0 flex-1 wrap-break-word text-base font-semibold text-ink">
                    {group.name}
                  </h4>
                  <span
                    aria-label={t("items.instanceCount", { count: group.items.length })}
                    className="shrink-0 font-mono text-sm font-semibold text-muted"
                  >
                    ×{group.items.length}
                  </span>
                </header>
                {chargeRows.length > 0 ? (
                  <ul className="divide-y divide-line border-t border-line">
                  {chargeRows.map(({ item, pending, status }) => {
                    return (
                      <li
                        className="min-w-0 px-4 py-3"
                        data-testid={`item-instance-${item.saveKey}`}
                        key={item.saveKey}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="font-mono text-sm font-semibold text-ink">
                            {status}
                          </p>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {pending ? (
                              <button
                                className="ui-feedback rounded-sm border border-control px-3 py-2 text-xs font-semibold text-secondary hover:border-accent hover:text-accent"
                                type="button"
                                onClick={() => onRevertRefill(item.saveKey)}
                              >
                                {t("items.revertRefill")}
                              </button>
                            ) : null}
                            {!pending
                            && item.chargeState === "stored"
                            && canRefillToFull ? (
                              <button
                                aria-label={t("items.refillLabel", {
                                  item: item.name,
                                  instance: item.instanceId,
                                })}
                                className="ui-feedback rounded-sm border border-accent px-3 py-2 text-xs font-semibold text-accent hover:bg-accent hover:text-accent-ink"
                                type="button"
                                onClick={() => onRefillToFull(item)}
                              >
                                {t("items.refill")}
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {pending ? (
                          <p className="mt-2 font-mono text-xs text-secondary">
                            {t("status.pending", {
                              before: pending.before,
                              after: t("status.fullDefault"),
                            })}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
