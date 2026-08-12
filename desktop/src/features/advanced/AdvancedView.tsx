import { ArrowClockwiseIcon, ShieldCheckIcon } from "@phosphor-icons/react";

import type {
  AdvancedItemDto,
  AdvancedSaveDto,
} from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import type { AdvancedRefillEdit } from "@/features/editor/pendingEdits";
import { ItemGroups } from "./ItemGroups";

interface AdvancedViewProps {
  readonly advanced: AdvancedSaveDto | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly pendingByItem: Readonly<Record<string, AdvancedRefillEdit>>;
  readonly onRefillAllToFull: () => void;
  readonly onRefillToFull: (item: AdvancedItemDto) => void;
  readonly onRetry: () => void;
  readonly onRevertRefill: (saveKey: string) => void;
}

export function AdvancedView({
  advanced,
  loading,
  error,
  pendingByItem,
  onRefillAllToFull,
  onRefillToFull,
  onRetry,
  onRevertRefill,
}: AdvancedViewProps) {
  const { t } = usePreferences();
  if (loading) {
    return <output aria-live="polite" className="text-sm text-secondary">{t("items.loading")}</output>;
  }
  if (error) {
    return (
      <section aria-labelledby="advanced-error-title">
        <h2 className="text-xl font-semibold text-ink" id="advanced-error-title">
          {t("items.unavailable")}
        </h2>
        <p className="mt-2 text-sm text-secondary" role="alert">{error}</p>
        <button
          className="mt-5 inline-flex items-center gap-2 rounded-sm border border-control px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          type="button"
          onClick={onRetry}
        >
          <ArrowClockwiseIcon aria-hidden="true" size={16} />
          {t("action.tryAgain")}
        </button>
      </section>
    );
  }
  if (!advanced) {
    return null;
  }

  const itemsDomain = advanced.domains.find((domain) => domain.key === "items");
  const chargeDomain = advanced.domains.find((domain) => domain.key === "currentCharge");

  return (
    <section aria-labelledby="advanced-title">
      <h2 className="text-2xl font-semibold text-ink" id="advanced-title">{t("nav.items")}</h2>
      <p className="mt-2 max-w-[62ch] text-sm/6 text-secondary">
        {t("items.description")}
      </p>

      <div className="mt-6 flex items-start gap-2 border-l-2 border-success px-3 py-2 text-xs/5 text-secondary">
        <ShieldCheckIcon aria-hidden="true" className="mt-0.5 shrink-0 text-success" size={17} />
        <p>
          {t("items.safety")}
        </p>
      </div>

      <div className="mt-7 border-t border-line pt-6">
        {!itemsDomain?.capabilities.canRead ? (
          <p className="max-w-[58ch] text-sm/6 text-secondary">
            {t("items.missingContainer")}
          </p>
        ) : null}
        {itemsDomain?.capabilities.canRead && advanced.items.length === 0 ? (
          <p className="text-sm text-secondary">{t("items.empty")}</p>
        ) : null}
        {itemsDomain?.capabilities.canRead && advanced.items.length > 0 ? (
          <ItemGroups
            canRefillToFull={chargeDomain?.capabilities.canRefillToFull ?? false}
            items={advanced.items}
            pendingByItem={pendingByItem}
            onRefillAllToFull={onRefillAllToFull}
            onRefillToFull={onRefillToFull}
            onRevertRefill={onRevertRefill}
          />
        ) : null}
      </div>
    </section>
  );
}
