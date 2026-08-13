import type { CosmeticDto, CosmeticsViewDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import type { Translate } from "@/app/translations";

interface CosmeticsCatalogProps {
  readonly view: CosmeticsViewDto;
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

export function CosmeticsCatalog({ view }: CosmeticsCatalogProps) {
  const { t } = usePreferences();

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

      {view.cosmetics.length > 0 ? (
        <ul
          aria-label={t("cosmetics.catalogList")}
          className="mt-4 grid max-h-128 gap-2 overflow-y-auto pr-1 md:grid-cols-2 2xl:grid-cols-3"
        >
          {view.cosmetics.map((cosmetic) => {
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
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
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
                    <span>{t("cosmetics.typeLabel", { type: cosmetic.type })}</span>
                  )}
                  {cosmetic.rarity === null ? null : (
                    <span>{t("cosmetics.rarityLabel", { rarity: cosmetic.rarity })}</span>
                  )}
                  {cosmetic.status === null ? null : (
                    <span>{t("cosmetics.statusLabel", { status: cosmetic.status })}</span>
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
      ) : null}
    </section>
  );
}
