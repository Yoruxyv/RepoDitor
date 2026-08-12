import { usePreferences } from "@/app/preferences";

interface PlayerAvatarProps {
  readonly avatarUrl: string | null | undefined;
  readonly name: string;
  readonly className: string;
  readonly fallbackTestId?: string;
  readonly onError: () => void;
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function PlayerAvatar({
  avatarUrl,
  name,
  className,
  fallbackTestId,
  onError,
}: PlayerAvatarProps) {
  const { t } = usePreferences();
  const label = t("players.avatar", { player: name });
  return (
    <figure
      className={`m-0 grid shrink-0 place-items-center overflow-hidden rounded-sm border border-line-strong bg-accent-muted font-semibold text-accent ${className}`}
    >
      {avatarUrl ? (
        <img alt={label} className="size-full object-cover" src={avatarUrl} onError={onError} />
      ) : (
        <>
          <span aria-hidden="true" data-testid={fallbackTestId}>{initials(name)}</span>
          <figcaption className="sr-only">{label}</figcaption>
        </>
      )}
    </figure>
  );
}
