/** Shared decorative caret for accessible utility menu triggers. */
import { CaretDownIcon } from "@phosphor-icons/react";

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
