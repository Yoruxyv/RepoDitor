import { CaretDownIcon } from "@phosphor-icons/react";

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

export function UtilityMenuCaret({ open }: { readonly open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`-mr-1 ml-1 flex h-6 w-7 shrink-0 items-center justify-end border-l border-line pl-2 transition-colors duration-150 motion-reduce:transition-none ${
        open ? "text-accent" : "text-muted"
      }`}
    >
      <CaretDownIcon
        className={`transition-transform duration-150 motion-reduce:transition-none ${
          open ? "rotate-180" : ""
        }`}
        size={14}
        weight="bold"
      />
    </span>
  );
}
