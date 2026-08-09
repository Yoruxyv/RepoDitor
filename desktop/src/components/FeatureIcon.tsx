import type { Icon } from "@phosphor-icons/react";

interface FeatureIconProps {
  readonly icon: Icon;
  readonly testId: string;
  readonly variant: "item" | "upgrade";
  readonly source: "category" | "fallback" | "specific";
}

export function FeatureIcon({ icon: IconComponent, testId, variant, source }: FeatureIconProps) {
  const size = variant === "upgrade" ? 46 : 34;
  const classes = variant === "upgrade" ? "size-20" : "size-14";

  return (
    <span
      aria-hidden="true"
      className={`${classes} grid shrink-0 place-items-center rounded-sm border border-line bg-app text-accent`}
      data-icon-source={source}
      data-testid={testId}
    >
      <IconComponent size={size} weight="duotone" />
    </span>
  );
}
