import { ArrowClockwiseIcon, LockSimpleIcon, SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";

import type { CosmeticDto, CosmeticsViewDto } from "@electron/contracts";
import type { CosmeticOwnershipEdit } from "@/features/editor/pendingEdits";

interface CosmeticsViewProps {
  readonly view: CosmeticsViewDto | null;
  readonly cosmetics: CosmeticDto[];
  readonly knownOwnedCount: number;
  readonly knownLockedCount: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly pendingById: Readonly<Record<string, CosmeticOwnershipEdit>>;
  readonly unlockAllPending: boolean;
  readonly onOwnedChange: (cosmetic: CosmeticDto, owned: boolean) => void;
  readonly onRetry: () => void;
  readonly onRevert: (cosmeticId: number) => void;
  readonly onUnlockAll: () => void;
}

export function CosmeticsView({
  view,
  cosmetics,
  knownOwnedCount,
  knownLockedCount,
  loading,
  error,
  pendingById,
  unlockAllPending,
  onOwnedChange,
  onRetry,
  onRevert,
  onUnlockAll,
}: CosmeticsViewProps) {
  const [query, setQuery] = useState("");

  if (loading) {
    return <output aria-live="polite" className="text-sm text-secondary">Reading MetaSave cosmeticsâ€¦</output>;
  }
  if (error) {
    return (
      <section aria-labelledby="cosmetics-error-title">
        <h2 className="text-xl font-semibold text-ink" id="cosmetics-error-title">Cosmetics unavailable</h2>
        <p className="mt-2 text-sm text-secondary" role="alert">{error}</p>
        <button
          className="mt-5 inline-flex items-center gap-2 rounded-sm border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          type="button"
          onClick={onRetry}
        >
          <ArrowClockwiseIcon aria-hidden="true" size={16} />
          Try again
        </button>
      </section>
    );
  }
  if (!view) return null;

  const normalizedQuery = query.trim().replace(/^#/, "");
  const filtered = normalizedQuery
    ? cosmetics.filter((cosmetic) => String(cosmetic.id).includes(normalizedQuery))
    : cosmetics;

  return (
    <section aria-labelledby="cosmetics-title">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">MetaSave ownership</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-ink" id="cosmetics-title">Cosmetics</h2>
          <p className="mt-2 max-w-[62ch] text-sm/6 text-secondary">
            Manage the evidence-backed ownership catalog. Names and unsupported MetaSave fields are not guessed.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!view.capabilities.canUnlockAll || knownLockedCount === 0 || unlockAllPending}
          type="button"
          onClick={onUnlockAll}
        >
          <SparkleIcon aria-hidden="true" size={17} weight="bold" />
          {unlockAllPending ? "Unlock All pending" : "Unlock All"}
        </button>
      </div>

      <dl className="mt-7 grid grid-cols-3 gap-3">
        {[
          ["Known catalog", view.knownCatalogCount],
          ["Owned", knownOwnedCount],
          ["Locked", knownLockedCount],
        ].map(([label, value]) => (
          <div className="min-w-0 border-t border-line pt-3" key={label}>
            <dt className="text-xs font-semibold text-secondary">{label}</dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-7">
        <label className="text-xs font-semibold uppercase tracking-widest text-muted" htmlFor="cosmetic-search">
          Search by cosmetic ID
        </label>
        <input
          className="mt-2 w-full rounded-sm border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted"
          id="cosmetic-search"
          inputMode="numeric"
          placeholder="Example: 28"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <p className="mt-4 text-xs text-muted" aria-live="polite">Showing {filtered.length} cosmetics</p>
      <ul className="mt-3 grid max-h-136 gap-2 overflow-y-auto pr-2" aria-label="Cosmetic ownership">
        {filtered.map((cosmetic) => {
          const pending = pendingById[cosmetic.id];
          return (
            <li className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-sm border border-line bg-surface p-3" key={cosmetic.id}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{cosmetic.displayName}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-secondary">
                  {cosmetic.owned ? "Owned" : "Locked"}
                  {!cosmetic.known ? " Â· Unknown/future ID Â· Read-only" : null}
                  {pending ? " Â· Pending" : null}
                </p>
                {cosmetic.owned && cosmetic.removalBlockedReason ? (
                  <p className="mt-1 max-w-[50ch] text-xs text-warning">{cosmetic.removalBlockedReason}</p>
                ) : null}
              </div>
              {pending ? (
                <button
                  aria-label={`Revert ${cosmetic.displayName} ownership`}
                  className="shrink-0 rounded-sm border border-line-strong px-3 py-2 text-xs font-semibold text-secondary hover:border-accent hover:text-accent"
                  type="button"
                  onClick={() => onRevert(cosmetic.id)}
                >
                  Revert
                </button>
              ) : null}
              {!pending && cosmetic.known && !cosmetic.owned ? (
                <button
                  aria-label={`Unlock ${cosmetic.displayName}`}
                  className="shrink-0 rounded-sm border border-accent px-3 py-2 text-xs font-semibold text-accent hover:bg-accent hover:text-accent-ink disabled:opacity-50"
                  disabled={!view.capabilities.canUnlockCosmetic || unlockAllPending}
                  type="button"
                  onClick={() => onOwnedChange(cosmetic, true)}
                >
                  Unlock
                </button>
              ) : null}
              {!pending && cosmetic.known && cosmetic.owned && !cosmetic.removalBlockedReason ? (
                <button
                  aria-label={`Mark ${cosmetic.displayName} as Locked`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-line-strong px-3 py-2 text-xs font-semibold text-secondary hover:border-accent hover:text-accent disabled:opacity-50"
                  disabled={!view.capabilities.canRemoveOwnership || unlockAllPending}
                  type="button"
                  onClick={() => onOwnedChange(cosmetic, false)}
                >
                  <LockSimpleIcon aria-hidden="true" size={14} />
                  Mark as Locked
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {filtered.length === 0 ? <p className="mt-4 text-sm text-secondary">No cosmetic ID matches this search.</p> : null}
    </section>
  );
}
