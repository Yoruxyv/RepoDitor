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
  readonly onRefillToFull: (item: AdvancedItemDto) => void;
  readonly onRevertRefill: (saveKey: string) => void;
}

interface ItemGroup {
  readonly name: string;
  readonly items: AdvancedItemDto[];
}

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
  if (item.chargeState === "unknown") return t("items.chargeUnknown");
  return null;
}

export function ItemGroups({
  canRefillToFull,
  items,
  pendingByItem,
  onRefillToFull,
  onRevertRefill,
}: ItemGroupsProps) {
  const { t } = usePreferences();
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const instanceQuery = query.startsWith("#") ? query.slice(1) : query;
  const visibleItems = query
    ? items.filter(
        (item) =>
          item.name.toLocaleLowerCase().includes(query)
          || item.instanceId.toLocaleLowerCase().includes(instanceQuery),
      )
    : items;
  const visibleKeys = new Set(visibleItems.map((item) => item.saveKey));
  const itemKeys = new Set(items.map((item) => item.saveKey));
  const hiddenPendingCount = Object.keys(pendingByItem).filter(
    (saveKey) => itemKeys.has(saveKey) && !visibleKeys.has(saveKey),
  ).length;
  const hiddenPendingKey = hiddenPendingCount === 1
    ? "items.hiddenPending.one"
    : "items.hiddenPending.many";
  const groups = groupItems(visibleItems);

  function clearSearch(): void {
    setSearch("");
    searchInput.current?.focus();
  }

  return (
    <>
      <div className="mt-5 max-w-xl">
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
                <ul className="divide-y divide-line border-t border-line">
                  {group.items.map((item) => {
                    const pending = pendingByItem[item.saveKey];
                    const status = chargeText(item, pending, t);
                    return (
                      <li
                        className="min-w-0 px-4 py-3"
                        data-testid={`item-instance-${item.saveKey}`}
                        key={item.saveKey}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-mono text-sm font-semibold text-ink">
                              #{item.instanceId}
                            </p>
                            <details className="mt-1">
                              <summary className="w-fit cursor-pointer text-xs font-semibold text-secondary hover:text-accent">
                                {t("items.showKey")}
                              </summary>
                              <code className="mt-1 block break-all text-xs/5 text-muted">
                                {item.saveKey}
                              </code>
                            </details>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {status ? (
                              <p
                                className={`font-mono text-sm font-semibold ${item.chargeState === "unknown" ? "text-muted" : "text-ink"}`}
                              >
                                {status}
                              </p>
                            ) : null}
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
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
