import { useEffect, useState } from "react";
import type { Icon } from "@phosphor-icons/react";

import { FeatureIcon } from "./FeatureIcon";

interface GameIconProps {
  readonly fallback: Icon;
  readonly fallbackSource: "category" | "fallback" | "specific";
  readonly testId: string;
  readonly token: string | null;
  readonly variant: "item" | "cosmetic";
}

export function GameIcon({ fallback, fallbackSource, testId, token, variant }: GameIconProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [token]);

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
      className={`${variant === "cosmetic" ? "size-12" : "size-14"} grid shrink-0 place-items-center overflow-hidden rounded-sm border border-line bg-app`}
      data-icon-source="local"
      data-testid={testId}
    >
      <img
        alt=""
        className="size-full object-contain"
        src={`repoditor-icon://local/${encodeURIComponent(token)}`}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
