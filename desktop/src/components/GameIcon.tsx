import { useState } from "react";
import type { Icon } from "@phosphor-icons/react";

import { FeatureIcon } from "./FeatureIcon";
import { Skeleton } from "./Skeleton";

interface GameIconProps {
  readonly fallback: Icon;
  readonly fallbackSource: "category" | "fallback" | "specific";
  readonly loading?: "eager" | "lazy";
  readonly testId: string;
  readonly token: string | null;
  readonly variant: "item" | "upgrade" | "cosmetic";
}

const loadedIconTokens = new Set<string>();

function variantSize(variant: GameIconProps["variant"]): string {
  if (variant === "cosmetic") return "size-12";
  return variant === "upgrade" ? "size-20" : "size-14";
}

export function GameIcon({
  fallback,
  fallbackSource,
  loading = "lazy",
  testId,
  token,
  variant,
}: GameIconProps) {
  const [failedToken, setFailedToken] = useState<string | null>(null);
  const [loadedToken, setLoadedToken] = useState<string | null>(() =>
    token !== null && loadedIconTokens.has(token) ? token : null);
  const failed = token !== null && failedToken === token;
  const loaded = token !== null
    && (loadedToken === token || loadedIconTokens.has(token));

  if (token === null || failed) {
    return (
      <FeatureIcon
        icon={fallback}
        source={fallbackSource}
        testId={testId}
        variant={variant === "upgrade" ? "upgrade" : "item"}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      aria-busy={!loaded}
      className={`${variantSize(variant)} relative grid shrink-0 place-items-center overflow-hidden rounded-sm border border-line bg-app`}
      data-icon-source="local"
      data-testid={testId}
    >
      {!loaded ? (
        <Skeleton className="absolute inset-0 size-full" testId={`${testId}-loading`} />
      ) : null}
      <img
        alt=""
        className={`absolute inset-0 size-full object-contain ${loaded ? "opacity-100" : "opacity-0"}`}
        loading={loading}
        src={`repoditor-icon://local/${encodeURIComponent(token)}`}
        onError={() => setFailedToken(token)}
        onLoad={() => {
          loadedIconTokens.add(token);
          setLoadedToken(token);
        }}
      />
    </span>
  );
}
