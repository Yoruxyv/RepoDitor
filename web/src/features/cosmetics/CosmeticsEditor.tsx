import { LockSimpleIcon, SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import type { Translate } from "@/app/i18n/catalog";
import { useI18n } from "@/app/i18n/context";
import {
  inspectCosmeticBulkLock,
  inspectMetaCosmetics,
  lockAllCosmetics,
  type CosmeticBulkLockState,
  type MetaCosmeticsState,
  unlockRemainingCosmetics,
} from "@/features/cosmetics/cosmetics";
import { LockAllConfirmation } from "@/features/cosmetics/LockAllConfirmation";
import type { EditSession } from "@/features/save-file/session";

interface CosmeticsEditorProps {
  readonly busy: boolean;
  readonly onSessionChange: (session: EditSession) => void;
  readonly session: EditSession;
}
interface LockSnapshot {
  readonly sessionToken: symbol;
  readonly ownedIds: readonly number[];
  readonly preservedCount: number;
}

function confirmationMatches(
  snapshot: LockSnapshot,
  session: EditSession,
  state: CosmeticBulkLockState,
): boolean {
  return (
    snapshot.sessionToken === session.sessionToken &&
    snapshot.ownedIds.length === state.ownedIds.length &&
    snapshot.ownedIds.every((id, index) => id === state.ownedIds[index])
  );
}

function unavailableLockReason(
  busy: boolean,
  state: CosmeticBulkLockState,
  t: Translate,
): string | null {
  if (busy) return t("cosmetics.lockBlocked.busy");
  if (state.ownedIds.length === 0) return t("cosmetics.lockBlocked.empty");
  return state.blockedReason ? t(`cosmetics.lockBlocked.${state.blockedReason}`) : null;
}

export function CosmeticsEditor({ busy, onSessionChange, session }: CosmeticsEditorProps) {
  const { formatNumber, t } = useI18n();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<LockSnapshot | null>(null);
  const lockTrigger = useRef<HTMLButtonElement>(null);
  const unlockTrigger = useRef<HTMLButtonElement>(null);
  const returnAfterConfirm = useRef(false);
  useEffect(() => {
    if (confirmation === null && returnAfterConfirm.current) {
      unlockTrigger.current?.focus();
      returnAfterConfirm.current = false;
    }
  }, [confirmation]);
  const unavailableMessage = t("cosmetics.unavailableMessage");
  let state: MetaCosmeticsState;
  let lockState: CosmeticBulkLockState;
  try {
    state = inspectMetaCosmetics(session.working);
    lockState = inspectCosmeticBulkLock(session.working);
  } catch {
    return (
      <section aria-labelledby="cosmetics-title" className="py-12">
        <h2
          className="font-display text-4xl font-semibold uppercase leading-none text-ink"
          id="cosmetics-title"
        >
          {t("cosmetics.unavailable")}
        </h2>
        <p className="mt-3 text-sm text-accent" role="alert">
          {unavailableMessage}
        </p>
      </section>
    );
  }
  const complete = state.remainingSupportedCount === 0;
  const statusText = complete
    ? t("cosmetics.complete")
    : t(
        "cosmetics.remaining",
        { count: formatNumber(state.remainingSupportedCount) },
        state.remainingSupportedCount,
      );
  const lockReason = unavailableLockReason(busy, lockState, t);
  const stale =
    confirmation !== null &&
    (!confirmationMatches(confirmation, session, lockState) || lockState.blockedReason !== null);

  function apply(operation: () => boolean): void {
    try {
      if (operation()) onSessionChange({ ...session });
      setMutationError(null);
    } catch {
      setMutationError(unavailableMessage);
    }
  }
  function requestLock(): void {
    if (lockReason || confirmation) return;
    setMutationError(null);
    setConfirmation({
      sessionToken: session.sessionToken,
      ownedIds: lockState.ownedIds,
      preservedCount: lockState.preservedCount,
    });
  }
  function cancelLock(): void {
    setConfirmation(null);
    lockTrigger.current?.focus();
  }
  function confirmLock(): void {
    if (!confirmation || busy) return;
    try {
      const current = inspectCosmeticBulkLock(session.working);
      if (!confirmationMatches(confirmation, session, current) || current.blockedReason !== null)
        setMutationError(t("cosmetics.lockChanged"));
      else apply(() => lockAllCosmetics(session.working));
    } catch {
      setMutationError(unavailableMessage);
    }
    returnAfterConfirm.current = true;
    setConfirmation(null);
  }

  return (
    <section aria-labelledby="cosmetics-title" className="py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
        {t("cosmetics.eyebrow")}
      </p>
      <h2
        className="font-display mt-1 text-4xl font-semibold uppercase leading-none text-ink"
        id="cosmetics-title"
      >
        {t("cosmetics.title")}
      </h2>
      <div className="mt-7 max-w-xl border-y border-line py-5">
        <output className="block text-lg font-semibold text-ink" aria-live="polite">
          {t("cosmetics.unlocked", {
            owned: formatNumber(state.ownedSupportedCount),
            total: formatNumber(state.totalSupportedCount),
          })}
        </output>
        <p className="mt-1 text-sm/6 text-secondary">{statusText}</p>
        <p className="mt-1 text-xs/5 text-secondary">{t("cosmetics.presets")}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="inline-flex items-center justify-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:opacity-60"
            ref={unlockTrigger}
            disabled={busy || complete || confirmation !== null}
            onClick={() => apply(() => unlockRemainingCosmetics(session.working))}
            type="button"
          >
            <SparkleIcon aria-hidden="true" size={18} weight="bold" />
            {t("cosmetics.action")}
          </button>
          <button
            ref={lockTrigger}
            className="inline-flex items-center justify-center gap-2 rounded-sm border border-control px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={lockReason !== null}
            aria-describedby={lockReason ? "cosmetics-lock-reason" : undefined}
            onClick={requestLock}
          >
            <LockSimpleIcon aria-hidden="true" size={18} />
            {t("cosmetics.lockAll")}
          </button>
        </div>
        {lockReason ? (
          <output className="mt-3 block text-xs/5 text-secondary" id="cosmetics-lock-reason">
            {lockReason}
          </output>
        ) : null}
        {lockState.preservedCount > 0 ? (
          <p className="mt-2 text-xs/5 text-secondary">
            {t(
              "cosmetics.preservedOwnership",
              { count: formatNumber(lockState.preservedCount) },
              lockState.preservedCount,
            )}
          </p>
        ) : null}
        {mutationError ? (
          <p className="mt-3 text-sm text-accent" role="alert">
            {mutationError}
          </p>
        ) : null}
      </div>
      <LockAllConfirmation
        open={confirmation !== null}
        count={confirmation?.ownedIds.length ?? 0}
        preservedCount={confirmation?.preservedCount ?? 0}
        busy={busy}
        stale={stale}
        onCancel={cancelLock}
        onConfirm={confirmLock}
      />
    </section>
  );
}
