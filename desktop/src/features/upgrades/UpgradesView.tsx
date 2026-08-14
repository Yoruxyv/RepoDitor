import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useState } from "react";

import type { PlayerDto, PlayerUpgradeDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { GameIcon } from "@/components/GameIcon";
import { Skeleton, SkeletonRegion } from "@/components/Skeleton";
import type { UpgradeValueEdit } from "@/features/editor/pendingEdits";
import { SelectedPlayerIdentity } from "@/features/players/SelectedPlayerIdentity";
import { getUpgradeIcon } from "./upgradeIcons";

interface UpgradesViewProps {
  readonly players: PlayerDto[];
  readonly selectedPlayerId: string | null;
  readonly upgrades: PlayerUpgradeDto[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly pendingByUpgrade: Record<string, UpgradeValueEdit>;
  readonly avatarUrls: Record<string, string | null>;
  readonly onSelectPlayer: (playerId: string) => void;
  readonly onRejectAvatar: (playerId: string) => void;
  readonly onChange: (upgrade: PlayerUpgradeDto, player: PlayerDto, value: number) => void;
  readonly onRevert: (playerId: string, upgradeKey: string) => void;
  readonly onRetry: () => void;
}

function UpgradesSkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonRegion label={label} testId="upgrades-skeleton">
      <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-14 shrink-0" testId="upgrade-avatar-skeleton" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <div className="min-w-52">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-1 h-10 w-full" />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-x-8 gap-y-5 xl:grid-cols-2">
        {[0, 1, 2, 3].map((row) => (
          <div className="relative min-h-24 border-t border-line pt-4 pr-24" data-skeleton-kind="upgrade-row" key={row}>
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="absolute top-4 right-0 size-14" />
            <Skeleton className="mt-3 h-10 w-32" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
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
  avatarUrls,
  onSelectPlayer,
  onRejectAvatar,
  onChange,
  onRevert,
  onRetry,
}: UpgradesViewProps) {
  const { t } = usePreferences();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const player = players.find((item) => item.id === selectedPlayerId) ?? players[0] ?? null;

  if (loading && upgrades.length === 0) {
    return <UpgradesSkeleton label={t("upgrades.loading")} />;
  }
  if (error) {
    return (
      <section aria-labelledby="upgrades-error-title">
        <h2 className="text-xl font-semibold text-ink" id="upgrades-error-title">{t("upgrades.unavailable")}</h2>
        <p className="mt-2 text-sm text-secondary" role="alert">{error}</p>
        <button className="mt-5 inline-flex items-center gap-2 rounded-sm border border-control px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent" type="button" onClick={onRetry}>
          <ArrowClockwiseIcon aria-hidden="true" size={16} /> {t("action.tryAgain")}
        </button>
      </section>
    );
  }
  if (!player) {
    return <p className="text-sm text-secondary">{t("upgrades.noPlayers")}</p>;
  }

  return (
    <section aria-busy={loading} aria-labelledby="upgrades-title">
      <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">{t("upgrades.perPlayer")}</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink" id="upgrades-title">{t("nav.upgrades")}</h2>
        </div>
        <div className="flex min-w-0 flex-wrap items-end gap-4">
          <SelectedPlayerIdentity
            avatarUrl={avatarUrls[player.id]}
            fallbackTestId="upgrades-avatar-fallback"
            player={player}
            onRejectAvatar={() => onRejectAvatar(player.id)}
          />
          <label className="min-w-0 text-sm font-semibold text-ink">
            <span>{t("upgrades.player")}</span>
            <select className="mt-1 block min-w-52 max-w-full rounded-sm border border-control bg-surface px-3 py-2 text-sm text-ink focus:border-accent" value={player.id} onChange={(event) => onSelectPlayer(event.target.value)}>
              {players.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {upgrades.length === 0 ? (
        <p className="mt-6 text-sm text-secondary">{t("upgrades.empty")}</p>
      ) : (
        <div className="mt-6 grid min-w-0 gap-x-8 gap-y-5 xl:grid-cols-2">
          {upgrades.map((upgrade) => {
            const presentation = getUpgradeIcon(upgrade.key);
            const edit = pendingByUpgrade[key(player.id, upgrade.key)];
            const stored = upgrade.values.find((item) => item.playerId === player.id)?.value ?? 0;
            const inputKey = key(player.id, upgrade.key);
            const input = inputs[inputKey] ?? String(edit?.after ?? stored);
            const parsed = Number(input);
            const invalid = input.trim() === "" || !Number.isSafeInteger(parsed) || parsed < 0;
            const errorId = `${upgrade.key}-error`;
            const pendingId = `${upgrade.key}-pending`;
            const description = [invalid ? errorId : null, edit ? pendingId : null]
              .filter(Boolean)
              .join(" ") || undefined;
            return (
              <div className="relative min-h-24 min-w-0 border-t border-line pt-4 pr-24" key={upgrade.key}>
                <div className="absolute top-4 right-0">
                  <GameIcon fallback={presentation.icon} fallbackSource={presentation.source} testId={`upgrade-icon-${upgrade.key}`} token={upgrade.iconToken} variant="upgrade" />
                </div>
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <label className="min-w-0 text-sm font-semibold text-ink" htmlFor={upgrade.key} title={upgrade.label}>{upgrade.label}</label>
                  {upgrade.presentationSource !== "installed" ? <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">{t("status.detected")}</span> : null}
                </div>
                <div className="mt-3 flex flex-wrap items-start gap-3">
                  <input aria-describedby={description} aria-invalid={invalid ? "true" : undefined} aria-label={t("upgrades.input", { upgrade: upgrade.label, player: player.name })} className="w-32 rounded-sm border border-control bg-surface px-3 py-2 font-mono text-sm text-ink focus:border-accent" id={upgrade.key} min="0" step="1" type="number" value={input} onChange={(event) => {
                    const value = event.target.value;
                    setInputs((current) => ({ ...current, [inputKey]: value }));
                    const next = Number(value);
                    if (value.trim() && Number.isSafeInteger(next) && next >= 0) onChange(upgrade, player, next);
                  }} />
                  {edit ? <button className="rounded-sm border border-control px-3 py-2 text-sm font-semibold text-secondary hover:border-accent hover:text-accent" type="button" onClick={() => {
                    setInputs((current) => { const next = { ...current }; delete next[inputKey]; return next; });
                    onRevert(player.id, upgrade.key);
                  }}>{t("action.revert")}</button> : null}
                </div>
                {invalid ? <p className="mt-2 text-xs text-danger" id={errorId} role="alert">{t("upgrades.error")}</p> : null}
                {edit ? <p className="mt-2 text-xs font-medium text-accent" data-testid={`pending-upgrade-${upgrade.key}`} id={pendingId}>{t("status.pending", { before: edit.before, after: edit.after })}</p> : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
