/** Shared visual tokens for utility triggers and popovers; behavior stays component-owned. */
const UTILITY_TRIGGER_BASE =
  "ui-feedback inline-flex h-10 items-center gap-2 rounded-md border bg-surface-raised px-3 text-sm font-semibold text-secondary";

export function utilityTriggerClassName(open = false): string {
  const borderState = open
    ? "border-line-strong"
    : "border-line hover:border-control hover:text-accent";
  return `${UTILITY_TRIGGER_BASE} ${borderState}`;
}

export const menuSurfaceClassName = "rounded-md border border-line bg-surface-raised p-1 shadow-lg";

export function menuOptionClassName(selected: boolean, active: boolean): string {
  let state: string;
  if (selected) state = "bg-accent-muted font-semibold text-accent";
  else if (active) state = "bg-surface text-ink";
  else state = "text-secondary hover:bg-surface hover:text-ink";

  return `ui-feedback grid w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${state}`;
}

export function utilityMenuItemStateClassName(selected: boolean, active: boolean): string {
  if (selected) return "bg-accent-muted text-accent";
  if (active) return "bg-surface text-ink";
  return "text-secondary hover:bg-surface hover:text-ink";
}
