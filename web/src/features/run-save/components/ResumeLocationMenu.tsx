import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { useI18n } from "@/app/i18n/context";
import {
  canEditStoredResumeLocation,
  RESUME_LOCATION_LABELS,
  type ResumeLocation,
} from "@/features/run-save/model/runSave";

const OPTIONS = ["normal", "shop"] as const satisfies readonly ResumeLocation[];

interface ResumeLocationMenuProps {
  readonly onChange: (value: ResumeLocation) => void;
  readonly rawValue: number;
  readonly value: ResumeLocation | null;
}

export function ResumeLocationMenu({ onChange, rawValue, value }: ResumeLocationMenuProps) {
  const { t } = useI18n();
  const editable = canEditStoredResumeLocation(rawValue);
  const selectedIndex = value ? OPTIONS.indexOf(value) : 0;
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

  function openMenu(): void {
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function closeMenu(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  function select(next: ResumeLocation): void {
    onChange(next);
    closeMenu(true);
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
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
      select(OPTIONS[index]!);
      return;
    }

    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (index + 1) % OPTIONS.length;
    else if (event.key === "ArrowUp") nextIndex = (index - 1 + OPTIONS.length) % OPTIONS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = OPTIONS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveIndex(nextIndex);
  }

  return (
    <div className="relative mt-3 w-64 max-w-full" ref={container}>
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex w-full items-center justify-between gap-3 rounded-sm border bg-surface px-3 py-2.5 text-left text-sm text-ink transition-colors ${
          open ? "border-accent" : "border-control hover:border-accent"
        } disabled:cursor-not-allowed disabled:text-secondary`}
        disabled={!editable}
        id="run-resume-location"
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
        ref={trigger}
        type="button"
      >
        <span className="min-w-0 truncate">
          {value
            ? RESUME_LOCATION_LABELS[value]
            : t("run.run.unsupportedSpawn", { value: rawValue })}
        </span>
        <CaretDownIcon
          aria-hidden="true"
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          size={15}
          weight="bold"
        />
      </button>

      {open && editable ? (
        <>
          {/* Native select popups cannot use RepoDitor's themed full-row interaction state. */}
          {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role */}
          <div
            aria-label={t("run.run.nextSpawn")}
            className="absolute left-0 z-30 mt-1.5 w-full overflow-hidden rounded-sm border border-control bg-surface-raised p-1 shadow-panel"
            id={listboxId}
            role="listbox"
          >
            {OPTIONS.map((entry, index) => {
              const selected = entry === value;
              return (
                // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
                <button
                  aria-selected={selected}
                  className={`grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-semibold transition-colors ${
                    selected
                      ? "bg-accent-muted text-accent hover:bg-surface hover:text-ink"
                      : "text-secondary hover:bg-surface hover:text-ink"
                  }`}
                  key={entry}
                  onClick={() => select(entry)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  ref={(element) => {
                    options.current[index] = element;
                  }}
                  role="option"
                  tabIndex={index === activeIndex ? 0 : -1}
                  type="button"
                >
                  <CheckIcon
                    aria-hidden="true"
                    className={selected ? "opacity-100" : "opacity-0"}
                    size={14}
                    weight="bold"
                  />
                  <span>{RESUME_LOCATION_LABELS[entry]}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
