import type { ReactNode } from "react";

interface SkeletonProps {
  readonly className: string;
  readonly testId?: string | undefined;
}

interface SkeletonRegionProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly label: string;
  readonly testId: string;
}

export function Skeleton({ className, testId }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-sm bg-surface-raised ${className}`}
      data-testid={testId}
    />
  );
}

export function SkeletonRegion({ children, className = "", label, testId }: SkeletonRegionProps) {
  return (
    <output
      aria-busy="true"
      aria-label={label}
      className={`block animate-pulse motion-reduce:animate-none ${className}`}
      data-testid={testId}
    >
      {children}
    </output>
  );
}
