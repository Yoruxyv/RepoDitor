/** Small semantic Phosphor icon wrapper used by RepoDitor feature headings. */
import type { Icon } from "@phosphor-icons/react";

interface FeatureIconProps {
  readonly icon: Icon;
  readonly testId: string;
  readonly frameClassName: string;
  readonly iconSize: number;
  readonly source: "category" | "fallback" | "specific";
}

export function FeatureIcon({
  icon: IconComponent,
  testId,
  frameClassName,
  iconSize,
  source,
}: FeatureIconProps) {
  return (
    <span
      aria-hidden="true"
      className={`${frameClassName} grid shrink-0 place-items-center rounded-sm border border-line bg-app text-accent`}
      data-icon-source={source}
      data-testid={testId}
    >
      <IconComponent size={iconSize} weight="duotone" />
    </span>
  );
}
