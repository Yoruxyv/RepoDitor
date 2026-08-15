import {
  CaretDownIcon,
  CheckIcon,
  DesktopIcon,
  MoonIcon,
  SunIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { usePreferences, type ThemePreference } from "@/app/preferences";

const THEMES = [
  { value: "system", labelKey: "utility.theme.system", icon: DesktopIcon },
  { value: "dark", labelKey: "utility.theme.dark", icon: MoonIcon },
  { value: "light", labelKey: "utility.theme.light", icon: SunIcon },
] as const satisfies ReadonlyArray<{
  value: ThemePreference;
  labelKey: "utility.theme.system" | "utility.theme.dark" | "utility.theme.light";
  icon: Icon;
}>;

export function ThemeMenu() {
  const { theme, setTheme, t } = usePreferences();
  const selectedIndex = THEMES.findIndex((option) => option.value === theme);
  const selectedTheme = THEMES[selectedIndex]!;
  const SelectedThemeIcon = selectedTheme.icon;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  useEffect(() => {
    if (open) options.current[activeIndex]?.focus();
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

  function openMenu(index = selectedIndex): void {
    setActiveIndex(index);
    setOpen(true);
  }

  function closeMenu(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  function selectTheme(nextTheme: ThemePreference): void {
    setTheme(nextTheme);
    closeMenu(true);
  }

  function moveOption(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectTheme(THEMES[index]!.value);
      return;
    }

    let nextIndex: number;
    if (event.key === "ArrowDown") nextIndex = (index + 1) % THEMES.length;
    else if (event.key === "ArrowUp") nextIndex = (index - 1 + THEMES.length) % THEMES.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = THEMES.length - 1;
    else return;

    event.preventDefault();
    setActiveIndex(nextIndex);
  }

  return (
    <div className="relative" ref={container}>
      <button
        ref={trigger}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${t("utility.theme")}: ${t(selectedTheme.labelKey)}`}
        className="ui-feedback inline-flex h-10 items-center gap-2 rounded-sm border border-control bg-surface px-3 text-sm font-semibold text-secondary hover:border-accent hover:text-accent"
        type="button"
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu(true);
          }
        }}
      >
        <SelectedThemeIcon aria-hidden="true" size={16} />
        <span>{t(selectedTheme.labelKey)}</span>
        <CaretDownIcon
          aria-hidden="true"
          className={`ml-1 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          size={14}
          weight="bold"
        />
      </button>

      {open ? (
        <>
          {/* Custom listbox keeps theme choices visually aligned with the language menu. */}
          {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role */}
          <div
            aria-label={t("utility.theme")}
            className="absolute right-0 z-30 mt-2 min-w-40 overflow-hidden rounded-sm border border-control bg-surface p-1.5 shadow-xl"
            id={listboxId}
            role="listbox"
          >
            {THEMES.map((option, index) => {
              const selected = option.value === theme;
              return (
                <div key={option.value}>
                  {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role */}
                  <button
                    ref={(element) => {
                      options.current[index] = element;
                    }}
                    aria-selected={selected}
                    className={`ui-feedback grid w-full grid-cols-[1rem_1rem_minmax(0,1fr)] items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm font-semibold ${
                      selected
                        ? "bg-accent-muted text-accent"
                        : "text-secondary hover:bg-surface-raised hover:text-ink"
                    }`}
                    role="option"
                    tabIndex={index === activeIndex ? 0 : -1}
                    type="button"
                    onClick={() => selectTheme(option.value)}
                    onKeyDown={(event) => moveOption(event, index)}
                  >
                    <CheckIcon
                      aria-hidden="true"
                      className={selected ? "opacity-100" : "opacity-0"}
                      size={14}
                      weight="bold"
                    />
                    <option.icon aria-hidden="true" size={15} />
                    <span className="whitespace-nowrap">{t(option.labelKey)}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
