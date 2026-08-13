import { useEffect, useState } from "react";
import type { Icon } from "@phosphor-icons/react";

import { FeatureIcon } from "./FeatureIcon";
import { Skeleton } from "./Skeleton";

interface GameIconProps {
  readonly fallback: Icon;
  readonly fallbackSource: "category" | "fallback" | "specific";
  readonly testId: string;
  readonly token: string | null;
  readonly variant: "item" | "cosmetic";
}

export function GameIcon({ fallback, fallbackSource, testId, token, variant }: GameIconProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [token]);

  if (token === null || failed) {
    return (
      <FeatureIcon
        icon={fallback}
        source={fallbackSource}
        testId={testId}
        variant="item"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      aria-busy={!loaded}
      className={`${variant === "cosmetic" ? "size-12" : "size-14"} relative grid shrink-0 place-items-center overflow-hidden rounded-sm border border-line bg-app`}
      data-icon-source="local"
      data-testid={testId}
    >
      {!loaded ? (
        <Skeleton className="absolute inset-0 size-full" testId={`${testId}-loading`} />
      ) : null}
      <img
        alt=""
        className={`absolute inset-0 size-full object-contain ${loaded ? "opacity-100" : "opacity-0"}`}
        src={`repoditor-icon://local/${encodeURIComponent(token)}`}
        onError={() => setFailed(true)}
        onLoad={() => setLoaded(true)}
      />
    </span>
  );
}
