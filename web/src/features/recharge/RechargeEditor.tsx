import { BatteryChargingIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { useI18n } from "@/app/i18n/context";
import {
  inspectRecharge,
  RechargeEditError,
  rechargeAllSupportedItems,
  type RechargeState,
} from "@/features/recharge/recharge";
import type { EditSession } from "@/features/save-file/session/session";

interface RechargeEditorProps {
  readonly busy: boolean;
  readonly onSessionChange: (session: EditSession) => void;
  readonly session: EditSession;
}

function errorMessage(error: unknown, t: ReturnType<typeof useI18n>["t"]): string {
  return error instanceof RechargeEditError && error.message.includes("signed Int32")
    ? t("recharge.invalidInt32")
    : t("recharge.unavailableMessage");
}

function rechargeStatus(
  state: RechargeState,
  t: ReturnType<typeof useI18n>["t"],
  formatNumber: (value: number) => string,
): string {
  if (state.supportedItemCount === 0) {
    return t("recharge.empty");
  }
  if (state.needingRechargeCount === 0) {
    return t("recharge.complete");
  }
  return t(
    "recharge.needed",
    { count: formatNumber(state.needingRechargeCount) },
    state.needingRechargeCount,
  );
}

export function RechargeEditor({ busy, onSessionChange, session }: RechargeEditorProps) {
  const { formatNumber, t } = useI18n();
  const [mutationError, setMutationError] = useState<string | null>(null);

  let state: RechargeState;
  try {
    state = inspectRecharge(session.working);
  } catch (error) {
    return (
      <section aria-labelledby="recharge-title">
        <h2 className="text-2xl font-semibold text-ink" id="recharge-title">
          {t("recharge.unavailable")}
        </h2>
        <p className="mt-3 text-sm text-accent" role="alert">
          {errorMessage(error, t)}
        </p>
      </section>
    );
  }

  function recharge(): void {
    try {
      if (rechargeAllSupportedItems(session.working)) {
        onSessionChange({ ...session });
      }
      setMutationError(null);
    } catch (error) {
      setMutationError(errorMessage(error, t));
    }
  }

  return (
    <section aria-labelledby="recharge-title">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
        {t("recharge.eyebrow")}
      </p>
      <h2 className="mt-1 text-2xl font-semibold text-ink" id="recharge-title">
        {t("recharge.title")}
      </h2>

      <div className="mt-7 max-w-xl border-y border-line py-5">
        <p className="text-lg font-semibold text-ink">
          {t(
            "recharge.supported",
            { count: formatNumber(state.supportedItemCount) },
            state.supportedItemCount,
          )}
        </p>
        <p className="mt-1 text-sm/6 text-secondary">{rechargeStatus(state, t, formatNumber)}</p>
        <p className="mt-1 text-xs/5 text-secondary">{t("recharge.preservation")}</p>

        <button
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy || state.needingRechargeCount === 0}
          onClick={recharge}
          type="button"
        >
          <BatteryChargingIcon aria-hidden="true" size={18} weight="bold" />
          {t("recharge.action")}
        </button>
        {mutationError ? (
          <p className="mt-3 text-sm text-accent" role="alert">
            {mutationError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
