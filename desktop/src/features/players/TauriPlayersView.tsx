/** Bind the existing Players presentation to synthetic health authority. */
import { PlayersView } from "./PlayersView";
import type { usePlayers } from "./usePlayers";
import type { useTauriHealth } from "./useTauriHealth";

export function TauriPlayersView({
  players,
  health,
  avatarUrls,
  onRejectAvatar,
}: {
  readonly players: ReturnType<typeof usePlayers>;
  readonly health: ReturnType<typeof useTauriHealth>;
  readonly avatarUrls: Record<string, string | null>;
  readonly onRejectAvatar: (playerId: string) => void;
}) {
  const canEdit = health.enabled;
  return (
    <PlayersView
      avatarUrls={avatarUrls}
      error={players.error}
      loading={players.loading}
      players={players.players}
      selectedPlayerId={players.selectedPlayerId}
      pendingByPlayer={Object.fromEntries(health.healthEdits.map((edit) => [edit.entity, edit]))}
      onHealthChange={canEdit ? health.edit : null}
      onRevertHealth={canEdit ? health.revertHealth : null}
      healthEditingDisabled={canEdit && health.locked}
      onHealthValidityChange={health.setInvalid}
      resetVersion={health.resetVersion}
      onRejectAvatar={onRejectAvatar}
      onRetry={players.reload}
      onSelect={players.setSelectedPlayerId}
    />
  );
}
