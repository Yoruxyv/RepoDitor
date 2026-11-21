/**
 * Renderer-safe game-content thumbnail with deterministic semantic fallback.
 *
 * The component consumes only opaque native artwork tokens. Loading affects the thumbnail
 * box alone; missing or rejected local artwork immediately falls back to Phosphor.
 */
import { useRef, useState } from "react";
import { useNativeArtwork } from "@/app/tauriArtwork";
import type { Icon } from "@phosphor-icons/react";

import { FeatureIcon } from "./FeatureIcon";
import { Skeleton } from "./Skeleton";

interface GameIconProps {
  readonly fallback: Icon;
  readonly fallbackSource: "category" | "fallback" | "specific";
  readonly loading?: "eager" | "lazy";
  readonly testId: string;
  readonly token: string | null;
  readonly reuseKey?: string | undefined;
  readonly upgradeItem?: boolean;
  readonly variant: "item" | "upgrade" | "cosmetic" | "map";
}

export const COSMETIC_ICON_SIZE = "size-[48px]";

function variantSize(variant: GameIconProps["variant"]): string {
  if (variant === "map") return "aspect-2/1 w-full";
  if (variant === "cosmetic") return COSMETIC_ICON_SIZE;
  return variant === "upgrade" ? "size-20" : "size-14";
}

function placeholderStyle(variant: GameIconProps["variant"]): string {
  if (variant !== "upgrade") {
    return `absolute inset-0 size-full motion-safe:animate-pulse`;
  }
  return `absolute inset-y-0 left-1/2 h-full w-2/3 -translate-x-1/2 border border-control motion-safe:animate-pulse`;
}

export function GameIcon({
  fallback,
  fallbackSource,
  loading = "lazy",
  testId,
  token,
  reuseKey,
  upgradeItem,
  variant,
}: GameIconProps) {
  const element = useRef<HTMLSpanElement>(null);
  const { image, prepared, unavailable } = useNativeArtwork(
    token,
    variant,
    element,
    reuseKey,
    upgradeItem,
  );
  const [failedToken, setFailedToken] = useState<string | null>(null);
  const [loadedToken, setLoadedToken] = useState<string | null>(null);
  const frameClassName = variantSize(variant);
  if (token === null || failedToken === token || unavailable) {
    return (
      <FeatureIcon
        frameClassName={frameClassName}
        icon={fallback}
        iconSize={variant === "upgrade" ? 46 : 34}
        source={fallbackSource}
        testId={testId}
      />
    );
  }
  const loaded = image !== null && (prepared || loadedToken === token);
  const eager = prepared || variant === "upgrade";

  return (
    <span
      ref={element}
      aria-hidden="true"
      aria-busy={!loaded}
      className={`${frameClassName} relative grid shrink-0 place-items-center overflow-hidden rounded-sm border ${
        loaded || variant === "upgrade" ? "border-transparent bg-transparent" : "border-line bg-app"
      }`}
      data-icon-source="local"
      data-artwork-revision={image?.revision}
      data-testid={testId}
    >
      {!loaded ? (
        <Skeleton className={placeholderStyle(variant)} testId={`${testId}-loading`} />
      ) : null}
      {image ? (
        <img
          alt=""
          className={`absolute inset-0 size-full object-contain ${loaded ? "opacity-100" : "opacity-0"}`}
          loading={eager ? "eager" : loading}
          src={image.dataUrl}
          onError={() => setFailedToken(token)}
          onLoad={() => setLoadedToken(token)}
        />
      ) : null}
    </span>
  );
}
