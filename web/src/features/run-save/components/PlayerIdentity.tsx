import { useEffect, useState } from "react";

import { useI18n } from "@/app/i18n/context";
import type { RunPlayer } from "@/features/run-save/model/runSave";

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

interface SelectedPlayerIdentityProps {
  readonly avatarUrl: string | null | undefined;
  readonly onRejectAvatar: () => void;
  readonly player: RunPlayer;
}

export function SelectedPlayerIdentity({
  avatarUrl,
  onRejectAvatar,
  player,
}: SelectedPlayerIdentityProps) {
  const [loaded, setLoaded] = useState(false);
  const { t } = useI18n();

  useEffect(() => setLoaded(false), [avatarUrl]);

  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="selected-player-identity">
      <figure
        aria-busy={avatarUrl === undefined || (avatarUrl !== null && !loaded)}
        className="m-0 grid size-14 shrink-0 place-items-center overflow-hidden rounded-sm border border-control bg-accent-muted text-xl font-semibold text-accent"
      >
        {avatarUrl ? (
          <img
            alt={t("run.players.steamAvatar", { name: player.name })}
            className={`size-full object-cover ${loaded ? "opacity-100" : "opacity-0"}`}
            src={avatarUrl}
            onError={onRejectAvatar}
            onLoad={() => setLoaded(true)}
          />
        ) : null}
        {!avatarUrl || !loaded ? (
          <>
            <span aria-hidden="true" data-testid="player-avatar-fallback">
              {initials(player.name)}
            </span>
            <figcaption className="sr-only">
              {t("run.players.avatarFallback", { name: player.name })}
            </figcaption>
          </>
        ) : null}
      </figure>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
          {t("run.players.selected")}
        </p>
        <h2 className="mt-0.5 truncate text-xl font-semibold text-ink">{player.name}</h2>
        <p className="mt-0.5 truncate font-mono text-xs text-secondary">{player.id}</p>
      </div>
    </div>
  );
}
