import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

export type SelectValue = string | number;

export interface SelectOption<T extends SelectValue> {
  readonly value: T;
  readonly label: string;
}

interface SelectProps<T extends SelectValue> {
  readonly value: T;
  readonly options: readonly SelectOption<T>[];
  readonly onValueChange: (value: T) => void;
  readonly ariaLabel: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly id?: string;
}

export function Select<T extends SelectValue>({
  value,
  options,
  onValueChange,
  ariaLabel,
  className = "",
  disabled = false,
  id,
}: SelectProps<T>) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const unavailable = options.length === 0;
  const controlDisabled = disabled || unavailable;

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function openMenu(index = selectedIndex >= 0 ? selectedIndex : 0): void {
    if (controlDisabled) return;
    setActiveIndex(Math.min(Math.max(index, 0), options.length - 1));
    setOpen(true);
  }

  function closeMenu(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  function choose(index: number): void {
    const option = options[index];
    if (!option) return;
    onValueChange(option.value);
    closeMenu(true);
  }

  function optionStateClass(selected: boolean, active: boolean): string {
    if (selected) return "bg-accent-muted font-semibold text-accent";
    if (active) return "bg-surface-raised text-ink";
    return "text-secondary hover:bg-surface-raised hover:text-ink";
  }

  function closeWhenFocusLeaves(event: FocusEvent<HTMLDivElement>): void {
    const nextFocus = event.relatedTarget;
    if (nextFocus instanceof Node && event.currentTarget.contains(nextFocus)) return;
    setOpen(false);
  }

  function moveOption(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(index);
      return;
    }

    let nextIndex: number;
    if (event.key === "ArrowDown") nextIndex = (index + 1) % options.length;
    else if (event.key === "ArrowUp") nextIndex = (index - 1 + options.length) % options.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    else return;

    event.preventDefault();
    setActiveIndex(nextIndex);
  }

  return (
    <div
      className={`relative min-w-0 max-w-full ${className}`}
      ref={container}
      onBlur={closeWhenFocusLeaves}
    >
      {/* Native select popups cannot consistently honor RepoDitor's surface tokens. */}
      {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      <button
        ref={trigger}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={`ui-feedback flex h-10 w-full min-w-0 items-center gap-2 rounded-sm border bg-surface px-3 text-left text-sm text-ink disabled:cursor-not-allowed disabled:text-muted disabled:opacity-60 ${
          open ? "border-accent" : "border-control hover:border-accent"
        }`}
        disabled={controlDisabled}
        id={id}
        role="combobox"
        type="button"
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          } else if (event.key === "Home") {
            event.preventDefault();
            openMenu(0);
          } else if (event.key === "End") {
            event.preventDefault();
            openMenu(options.length - 1);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu(true);
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate" title={selectedOption?.label}>
          {selectedOption?.label ?? String(value)}
        </span>
        <CaretDownIcon
          aria-hidden="true"
          className={`shrink-0 transition-transform duration-150 motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
          size={14}
          weight="bold"
        />
      </button>

      {open ? (
        <div
          aria-label={ariaLabel}
          className="absolute left-0 z-30 mt-1.5 max-h-60 w-full min-w-0 max-w-full overflow-y-auto rounded-sm border border-control bg-surface p-1.5 shadow-xl"
          id={listboxId}
          role="listbox"
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            return (
              <div key={`${typeof option.value}:${String(option.value)}`}>
                {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role */}
                <button
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  aria-selected={selected}
                  className={`ui-feedback grid w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm ${optionStateClass(selected, active)}`}
                  data-value={String(option.value)}
                  role="option"
                  tabIndex={active ? 0 : -1}
                  type="button"
                  onClick={() => choose(index)}
                  onFocus={() => setActiveIndex(index)}
                  onKeyDown={(event) => moveOption(event, index)}
                >
                  <CheckIcon
                    aria-hidden="true"
                    className={selected ? "opacity-100" : "opacity-0"}
                    size={14}
                    weight="bold"
                  />
                  <span className="min-w-0 truncate" title={option.label}>
                    {option.label}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
