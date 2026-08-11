import type { PlayerDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { PlayerAvatar } from "@/features/players/PlayerAvatar";

interface SelectedPlayerIdentityProps {
  readonly player: PlayerDto;
  readonly avatarUrl: string | null | undefined;
  readonly fallbackTestId: string;
  readonly headingId?: string;
  readonly onRejectAvatar: () => void;
}

export function SelectedPlayerIdentity({
  player,
  avatarUrl,
  fallbackTestId,
  headingId,
  onRejectAvatar,
}: SelectedPlayerIdentityProps) {
  const { t } = usePreferences();
  const Name = headingId ? "h2" : "p";

  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="selected-player-identity">
      <PlayerAvatar
        avatarUrl={avatarUrl}
        className="size-14 text-xl"
        fallbackTestId={fallbackTestId}
        name={player.name}
        onError={onRejectAvatar}
      />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
          {t("players.selected")}
        </p>
        <Name className="mt-0.5 truncate text-xl font-semibold text-ink" id={headingId}>
          {player.name}
        </Name>
        <p className="mt-0.5 truncate font-mono text-xs text-muted">{player.id}</p>
      </div>
    </div>
  );
}
