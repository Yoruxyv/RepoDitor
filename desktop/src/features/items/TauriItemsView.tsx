/** Bind exact-instance refill controls to the shared synthetic transaction. */
import { usePreferences } from "@/app/preferences";
import type { useTauriHealth } from "@/features/players/useTauriHealth";
import { ItemsView } from "./ItemsView";
import type { useItems } from "./useItems";

export function TauriItemsView({
  items,
  transaction,
}: {
  readonly items: ReturnType<typeof useItems>;
  readonly transaction: ReturnType<typeof useTauriHealth>;
}) {
  const { t } = usePreferences();
  function refillAll() {
    if (
      items.advanced?.domains.some(
        (domain) => domain.key === "currentCharge" && domain.capabilities.canRefillToFull,
      )
    )
      transaction.stageRefills(items.advanced.items);
  }
  return (
    <fieldset className="min-w-0" disabled={transaction.enabled && transaction.locked}>
      <legend className="sr-only">{t("nav.items")}</legend>
      <ItemsView
        advanced={items.advanced}
        loading={items.loading}
        error={items.error}
        pendingByItem={Object.fromEntries(
          transaction.refillEdits.map((edit) => [edit.entity, edit]),
        )}
        onRefillAllToFull={transaction.enabled ? refillAll : null}
        onRefillToFull={transaction.enabled ? (item) => transaction.stageRefills([item]) : null}
        onRevertRefill={transaction.enabled ? transaction.revertRefill : null}
        onRetry={() => void items.reload()}
      />
    </fieldset>
  );
}
