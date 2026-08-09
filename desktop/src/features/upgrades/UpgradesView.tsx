import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useState } from "react";

import type { PlayerDto, PlayerUpgradeDto } from "@electron/contracts";
import type { UpgradeValueEdit } from "@/features/editor/pendingEdits";

interface UpgradesViewProps {
  readonly players: PlayerDto[];
  readonly selectedPlayerId: string | null;
  readonly upgrades: PlayerUpgradeDto[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly pendingByUpgrade: Record<string, UpgradeValueEdit>;
  readonly onSelectPlayer: (playerId: string) => void;
  readonly onChange: (upgrade: PlayerUpgradeDto, player: PlayerDto, value: number) => void;
  readonly onRevert: (playerId: string, upgradeKey: string) => void;
  readonly onRetry: () => void;
}

function key(playerId: string, upgradeKey: string): string {
  return `${playerId}:${upgradeKey}`;
}

export function UpgradesView({
  players,
  selectedPlayerId,
  upgrades,
  loading,
  error,
  pendingByUpgrade,
  onSelectPlayer,
  onChange,
  onRevert,
  onRetry,
}: UpgradesViewProps) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const player = players.find((item) => item.id === selectedPlayerId) ?? players[0] ?? null;

  if (loading) {
    return <output aria-live="polite" className="text-sm text-secondary">Loading upgrades…</output>;
  }
  if (error) {
    return (
      <section aria-labelledby="upgrades-error-title">
        <h2 className="text-xl font-semibold text-ink" id="upgrades-error-title">Upgrades unavailable</h2>
        <p className="mt-2 text-sm text-secondary" role="alert">{error}</p>
        <button className="mt-5 inline-flex items-center gap-2 rounded-sm border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent" type="button" onClick={onRetry}>
          <ArrowClockwiseIcon aria-hidden="true" size={16} /> Try again
        </button>
      </section>
    );
  }
  if (!player) {
    return <p className="text-sm text-secondary">No players are available for upgrade editing.</p>;
  }

  return (
    <section aria-labelledby="upgrades-title">
      <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Per-player values</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink" id="upgrades-title">Upgrades</h2>
        </div>
        <label className="text-sm font-semibold text-ink">
          <span>Player</span>
          <select className="mt-1 block min-w-52 rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-accent" value={player.id} onChange={(event) => onSelectPlayer(event.target.value)}>
            {players.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>

      {upgrades.length === 0 ? (
        <p className="mt-6 text-sm text-secondary">This save contains no player upgrades.</p>
      ) : (
        <div className="mt-6 grid min-w-0 gap-x-8 gap-y-5 xl:grid-cols-2">
          {upgrades.map((upgrade) => {
            const edit = pendingByUpgrade[key(player.id, upgrade.key)];
            const stored = upgrade.values.find((item) => item.playerId === player.id)?.value ?? 0;
            const inputKey = key(player.id, upgrade.key);
            const input = inputs[inputKey] ?? String(edit?.after ?? stored);
            const parsed = Number(input);
            const invalid = input.trim() === "" || !Number.isSafeInteger(parsed) || parsed < 0;
            const errorId = `${upgrade.key}-error`;
            return (
              <div className="min-w-0 border-t border-line pt-4" key={upgrade.key}>
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <label className="min-w-0 text-sm font-semibold text-ink" htmlFor={upgrade.key} title={upgrade.label}>{upgrade.label}</label>
                  {!upgrade.known ? <span className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">Detected</span> : null}
                </div>
                <p className="mt-1 truncate font-mono text-[0.68rem] text-muted" title={upgrade.key}>{upgrade.key}</p>
                <div className="mt-3 flex flex-wrap items-start gap-3">
                  <input aria-describedby={invalid ? errorId : undefined} aria-invalid={invalid ? "true" : undefined} aria-label={`${upgrade.label} for ${player.name}`} className="w-32 rounded-sm border border-line-strong bg-surface px-3 py-2 font-mono text-sm text-ink focus:border-accent" id={upgrade.key} min="0" step="1" type="number" value={input} onChange={(event) => {
                    const value = event.target.value;
                    setInputs((current) => ({ ...current, [inputKey]: value }));
                    const next = Number(value);
                    if (value.trim() && Number.isSafeInteger(next) && next >= 0) onChange(upgrade, player, next);
                  }} />
                  {edit ? <button className="rounded-sm border border-line-strong px-3 py-2 text-sm font-semibold text-secondary hover:border-accent hover:text-accent" type="button" onClick={() => {
                    setInputs((current) => { const next = { ...current }; delete next[inputKey]; return next; });
                    onRevert(player.id, upgrade.key);
                  }}>Revert</button> : null}
                </div>
                {invalid ? <p className="mt-2 text-xs text-danger" id={errorId} role="alert">Upgrade value must be a whole number of zero or more.</p> : null}
                {edit ? <p className="mt-2 text-xs font-medium text-accent" data-testid={`pending-upgrade-${upgrade.key}`}>Pending: {edit.before} → {edit.after}</p> : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
