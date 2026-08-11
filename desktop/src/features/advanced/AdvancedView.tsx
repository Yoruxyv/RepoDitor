import { ArrowClockwiseIcon, ShieldCheckIcon } from "@phosphor-icons/react";

import type {
  AdvancedEvidenceStatus,
  AdvancedDomainKey,
  AdvancedItemDto,
  AdvancedSaveDto,
} from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import type { Translate, TranslationKey } from "@/app/translations";
import type { AdvancedRefillEdit } from "@/features/editor/pendingEdits";
import { ItemGroups } from "./ItemGroups";

interface AdvancedViewProps {
  readonly advanced: AdvancedSaveDto | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly pendingByItem: Readonly<Record<string, AdvancedRefillEdit>>;
  readonly onRefillToFull: (item: AdvancedItemDto) => void;
  readonly onRetry: () => void;
  readonly onRevertRefill: (saveKey: string) => void;
}

const STATUS_KEYS: Record<AdvancedEvidenceStatus, TranslationKey> = {
  confirmed: "status.confirmed",
  partially_confirmed: "status.partiallyConfirmed",
  unknown: "status.unknown",
};

const DOMAIN_KEYS: Record<AdvancedDomainKey, TranslationKey> = {
  items: "items.domain.items",
  currentCharge: "items.domain.currentCharge",
  batteryUpgrades: "items.domain.batteryUpgrades",
  purchasedUpgrades: "items.domain.purchasedUpgrades",
  purchasedItems: "items.domain.purchasedItems",
  purchasedItemsTotal: "items.domain.purchasedItemsTotal",
  runMetadata: "items.domain.runMetadata",
};

function entryCount(value: number | null, t: Translate): string {
  return value === null ? t("status.notObserved") : String(value);
}

export function AdvancedView({
  advanced,
  loading,
  error,
  pendingByItem,
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
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
        {t("items.discovery")}
      </p>
      <h2 className="mt-1 text-2xl font-semibold text-ink" id="advanced-title">{t("nav.items")}</h2>
      <p className="mt-2 max-w-[62ch] text-sm/6 text-secondary">
        {t("items.description")}
      </p>

      <div className="mt-6 flex items-start gap-2 border-l-2 border-success px-3 py-2 text-xs/5 text-secondary">
        <ShieldCheckIcon aria-hidden="true" className="mt-0.5 shrink-0 text-success" size={17} />
        <p>
          {t("items.safety")}
        </p>
      </div>

      <h3 className="mt-6 text-sm font-semibold text-ink">{t("items.evidenceSummary")}</h3>
      <dl className="mt-2 grid border-y border-line sm:grid-cols-2 xl:grid-cols-3">
        {advanced.domains.map((domain) => (
          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-line px-3 py-2.5 last:border-b-0 sm:odd:border-r xl:border-r xl:nth-[3n]:border-r-0" key={domain.key}>
            <dt className="min-w-0 text-xs font-semibold text-secondary">
              {t(DOMAIN_KEYS[domain.key])}
              <span className="mt-0.5 block text-[0.65rem] font-semibold uppercase tracking-widest text-muted">
                {t(STATUS_KEYS[domain.status])}
              </span>
            </dt>
            <dd className="shrink-0 font-mono text-sm font-semibold text-ink">
              {entryCount(domain.entryCount, t)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-9 border-t border-line pt-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">
              {t("items.confirmedStructure")}
            </p>
            <h3 className="mt-1 text-xl font-semibold text-ink">{t("items.instances")}</h3>
          </div>
          <span className="font-mono text-xs text-muted">{advanced.items.length}</span>
        </div>

        {!itemsDomain?.capabilities.canRead ? (
          <p className="mt-4 max-w-[58ch] text-sm/6 text-secondary">
            {t("items.missingContainer")}
          </p>
        ) : null}
        {itemsDomain?.capabilities.canRead && advanced.items.length === 0 ? (
          <p className="mt-4 text-sm text-secondary">{t("items.empty")}</p>
        ) : null}
        {itemsDomain?.capabilities.canRead && advanced.items.length > 0 ? (
          <ItemGroups
            canRefillToFull={chargeDomain?.capabilities.canRefillToFull ?? false}
            items={advanced.items}
            pendingByItem={pendingByItem}
            onRefillToFull={onRefillToFull}
            onRevertRefill={onRevertRefill}
          />
        ) : null}

        {advanced.unlinkedChargeEntryCount > 0 ? (
          <p className="mt-4 text-xs text-warning">
            {t(
              advanced.unlinkedChargeEntryCount === 1
                ? "items.unlinked.one"
                : "items.unlinked.many",
              { count: advanced.unlinkedChargeEntryCount },
            )}
          </p>
        ) : null}
      </div>

      {advanced.runValues.length > 0 ? (
        <details className="mt-9 border-y border-line py-4">
          <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-ink">
            <span>{t("items.additionalRun")}</span>
            <span className="font-mono text-xs text-muted">{advanced.runValues.length}</span>
          </summary>
          <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted">
            {t("status.partiallyConfirmed")}
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {advanced.runValues.map((value) => (
              <div className="rounded-sm border border-line bg-surface p-4" key={value.saveKey}>
                <dt className="text-sm font-semibold text-ink">
                  {t(`items.run.${value.saveKey}`)}
                </dt>
                <dd className="mt-2 font-mono text-xl font-semibold text-ink">{value.value}</dd>
                <details className="mt-3 border-t border-line pt-3">
                  <summary className="w-fit cursor-pointer text-xs font-semibold text-secondary hover:text-accent">
                    {t("items.showKey")}
                  </summary>
                  <code className="mt-2 block break-all text-[0.68rem]/5 text-muted">
                    {value.saveKey}
                  </code>
                </details>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}
