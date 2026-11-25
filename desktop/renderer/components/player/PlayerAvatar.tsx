/**
 * Fixed-geometry optional player avatar with bounded retry and local fallback.
 *
 * URLs are already validated by the desktop backend. Image failure remains presentation-only and
 * never prevents the player projection from rendering.
 */
import { useState } from "react";

import { usePreferences } from "@/app/preferences/preferences";
import { Skeleton } from "@/components/Skeleton";

interface PlayerAvatarProps {
  readonly avatarUrl: string | null | undefined;
  readonly name: string;
  readonly className: string;
  readonly fallbackTestId?: string;
  readonly onError: (url: string) => void;
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
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const loaded = avatarUrl === loadedUrl;
  const label = t("players.avatar", { player: name });
  const loading = avatarUrl === undefined || (avatarUrl !== null && !loaded);

  return (
    <figure
      aria-busy={loading}
      className={`relative m-0 grid shrink-0 place-items-center overflow-hidden rounded-sm border border-line-strong bg-accent-muted font-semibold text-accent ${className}`}
    >
      {loading ? (
        <Skeleton
          className="absolute inset-0 size-full"
          testId={fallbackTestId ? `${fallbackTestId}-loading` : undefined}
        />
      ) : null}
      {avatarUrl ? (
        <img
          alt={label}
          className={`absolute inset-0 size-full object-cover ${loaded ? "opacity-100" : "opacity-0"}`}
          src={avatarUrl}
          key={avatarUrl}
          onError={() => onError(avatarUrl)}
          onLoad={() => setLoadedUrl(avatarUrl)}
        />
      ) : null}
      {avatarUrl === null ? (
        <>
          <span aria-hidden="true" data-testid={fallbackTestId}>
            {initials(name)}
          </span>
          <figcaption className="sr-only">{label}</figcaption>
        </>
      ) : null}
    </figure>
  );
}
