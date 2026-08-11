import { ArrowClockwiseIcon, UserIcon } from "@phosphor-icons/react";
import { useState } from "react";

import type { PlayerDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import type { PlayerHealthEdit } from "@/features/editor/pendingEdits";
import { PlayerAvatar } from "./PlayerAvatar";

interface PlayersViewProps {
  readonly players: PlayerDto[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedPlayerId: string | null;
  readonly pendingByPlayer: Record<string, PlayerHealthEdit>;
  readonly avatarUrls: Record<string, string | null>;
  readonly onSelect: (playerId: string) => void;
  readonly onRejectAvatar: (playerId: string) => void;
  readonly onHealthChange: (player: PlayerDto, health: number) => void;
  readonly onRevertHealth: (playerId: string) => void;
  readonly onRetry: () => void;
}

export function PlayersView({
  players,
  loading,
  error,
  selectedPlayerId,
  pendingByPlayer,
  avatarUrls,
  onSelect,
  onRejectAvatar,
  onHealthChange,
  onRevertHealth,
  onRetry,
}: PlayersViewProps) {
  const { t } = usePreferences();
  const player = players.find((item) => item.id === selectedPlayerId) ?? null;
  const pending = player ? pendingByPlayer[player.id] : undefined;
  const health = pending?.after ?? player?.health ?? 0;
  const [healthInputs, setHealthInputs] = useState<Record<string, string>>({});
  const healthInput = player ? (healthInputs[player.id] ?? String(health)) : String(health);
  const parsedHealth = Number(healthInput);
  const healthError =
    healthInput.trim() === "" || !Number.isSafeInteger(parsedHealth) || parsedHealth < 0
      ? t("players.healthError")
      : null;
  const isAtFullHealth = !healthError && parsedHealth === player?.maxHealth;

  if (loading) {
    return <output aria-live="polite" className="text-sm text-secondary">{t("players.loading")}</output>;
  }

  if (error) {
    return (
      <section aria-labelledby="players-error-title">
        <h2 className="text-xl font-semibold text-ink" id="players-error-title">
          {t("players.unavailable")}
        </h2>
        <p className="mt-2 text-sm text-secondary" role="alert">
          {error}
        </p>
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

  if (!player) {
    return (
      <section aria-labelledby="players-empty-title">
        <h2 className="text-xl font-semibold text-ink" id="players-empty-title">
          {t("players.emptyTitle")}
        </h2>
        <p className="mt-2 text-sm text-secondary">{t("players.emptyDescription")}</p>
      </section>
    );
  }

  function editHealth(value: string): void {
    if (!player) {
      return;
    }
    setHealthInputs((current) => ({ ...current, [player.id]: value }));
    const next = Number(value);
    if (value.trim() === "" || !Number.isSafeInteger(next) || next < 0) {
      return;
    }
    onHealthChange(player, next);
  }

  function revertHealth(playerId: string): void {
    setHealthInputs((current) => {
      const next = { ...current };
      delete next[playerId];
      return next;
    });
    onRevertHealth(playerId);
  }

  return (
    <div className="grid min-w-0 gap-7 md:grid-cols-[15rem_minmax(0,1fr)]">
      <section aria-labelledby="player-list-title">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-semibold text-ink" id="player-list-title">
            {t("nav.players")}
          </h2>
          <span className="font-mono text-xs text-muted">{players.length}</span>
        </div>
        <div className="mt-4 grid gap-2" aria-label={t("nav.players")}>
          {players.map((item) => {
            const selected = item.id === player.id;
            return (
              <button
                aria-pressed={selected}
                className={`min-w-0 rounded-sm border px-4 py-3 text-left transition duration-150 ${
                  selected
                    ? "border-accent bg-accent-muted text-ink"
                    : "border-control bg-surface text-secondary hover:border-accent hover:text-ink"
                }`}
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
              >
                <span className="block truncate text-sm font-semibold">{item.name}</span>
                <span className="mt-1 block truncate font-mono text-[0.68rem] text-muted">
                  {item.id}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="min-w-0 border-t border-line pt-6 md:border-l md:border-t-0 md:pl-7 md:pt-0" aria-labelledby="player-detail-title">
        <div className="flex min-w-0 items-center gap-4">
          <PlayerAvatar
            avatarUrl={avatarUrls[player.id]}
            className="size-16 text-2xl"
            fallbackTestId="avatar-fallback"
            name={player.name}
            onError={() => onRejectAvatar(player.id)}
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
              {t("players.selected")}
            </p>
            <h2 className="mt-1 truncate text-2xl font-semibold text-ink" id="player-detail-title">
              {player.name}
            </h2>
            <p className="mt-1 truncate font-mono text-xs text-muted">{player.id}</p>
          </div>
        </div>

        <div className="mt-7 max-w-sm border-t border-line pt-6">
          <label className="text-sm font-semibold text-ink" htmlFor="player-health">
            {t("players.currentHealth")}
          </label>
          <p className="mt-1 text-xs/5 text-muted">
            {t("players.healthHelper")}
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-3">
            <div className="flex items-center gap-2">
              <input
                aria-describedby={healthError ? "player-health-error" : undefined}
                aria-invalid={healthError ? "true" : undefined}
                className="w-28 rounded-sm border border-control bg-surface px-3 py-2 font-mono text-sm text-ink focus:border-accent"
                id="player-health"
                inputMode="numeric"
                min="0"
                step="1"
                type="number"
                value={healthInput}
                onChange={(event) => editHealth(event.target.value)}
              />
              <span
                aria-label={t("players.maximumHealth", { value: player.maxHealth })}
                className="font-mono text-sm text-secondary"
              >
                / {player.maxHealth}
              </span>
            </div>
            <button
              className="rounded-sm border border-control px-3 py-2 text-sm font-semibold text-secondary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-control disabled:hover:text-secondary"
              disabled={isAtFullHealth}
              type="button"
              onClick={() => editHealth(String(player.maxHealth))}
            >
              {t("players.healFull")}
            </button>
            {pending ? (
              <button
                className="rounded-sm border border-control px-3 py-2 text-sm font-semibold text-secondary hover:border-accent hover:text-accent"
                type="button"
                onClick={() => revertHealth(player.id)}
              >
                {t("action.revert")}
              </button>
            ) : null}
          </div>
          {healthError ? (
            <p className="mt-2 text-xs text-danger" id="player-health-error" role="alert">
              {healthError}
            </p>
          ) : null}
          {pending ? (
            <p className="mt-4 text-xs font-medium text-accent" data-testid="pending-health-edit">
              {t("status.pending", { before: pending.before, after: pending.after })}
            </p>
          ) : (
            <p className="mt-4 flex items-center gap-2 text-xs text-muted">
              <UserIcon aria-hidden="true" size={15} /> {t("players.noPendingHealth")}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
