import { CaretDownIcon, CheckIcon, TranslateIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { usePreferences } from "@/app/preferences";
import type { Locale } from "@/app/translations";
import chinaFlag from "@/assets/flags/china.svg?no-inline";
import indonesiaFlag from "@/assets/flags/indonesia.svg?no-inline";
import japanFlag from "@/assets/flags/japan.svg?no-inline";
import southKoreaFlag from "@/assets/flags/south-korea.svg?no-inline";
import unitedStatesFlag from "@/assets/flags/united-states.svg?no-inline";

const LANGUAGES = [
  { locale: "en", flag: unitedStatesFlag, label: "English" },
  { locale: "ja", flag: japanFlag, label: "日本語" },
  { locale: "ko", flag: southKoreaFlag, label: "한국어" },
  { locale: "zh", flag: chinaFlag, label: "中文" },
  { locale: "id", flag: indonesiaFlag, label: "Bahasa Indonesia" },
] as const satisfies ReadonlyArray<{ locale: Locale; flag: string; label: string }>;

function LanguageFlag({ src }: { readonly src: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="h-3 w-4.5 rounded-[1px] border border-line object-cover"
      height="12"
      src={src}
      width="18"
    />
  );
}

export function LanguageMenu() {
  const { locale, setLocale, t } = usePreferences();
  const selectedIndex = LANGUAGES.findIndex((language) => language.locale === locale);
  const selectedLanguage = LANGUAGES[selectedIndex]!;
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

  function selectLanguage(nextLocale: Locale): void {
    setLocale(nextLocale);
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
      selectLanguage(LANGUAGES[index]!.locale);
      return;
    }

    let nextIndex: number;
    if (event.key === "ArrowDown") nextIndex = (index + 1) % LANGUAGES.length;
    else if (event.key === "ArrowUp") nextIndex = (index - 1 + LANGUAGES.length) % LANGUAGES.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = LANGUAGES.length - 1;
    else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const query = event.key.toLocaleLowerCase();
      const offset = LANGUAGES.slice(index + 1).findIndex((language) =>
        language.label.toLocaleLowerCase().startsWith(query),
      );
      const wrappedOffset = LANGUAGES.slice(0, index + 1).findIndex((language) =>
        language.label.toLocaleLowerCase().startsWith(query),
      );
      if (offset >= 0) nextIndex = index + 1 + offset;
      else if (wrappedOffset >= 0) nextIndex = wrappedOffset;
      else return;
    } else return;

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
        aria-label={`${t("utility.language")}: ${selectedLanguage.label}`}
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
        <TranslateIcon aria-hidden="true" size={16} />
        <LanguageFlag src={selectedLanguage.flag} />
        <span>{selectedLanguage.label}</span>
        <CaretDownIcon
          aria-hidden="true"
          className={`ml-1 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          size={14}
          weight="bold"
        />
      </button>

      {open ? (
        <>
          {/* Native select popups cannot honor RepoDitor's dark/light surface tokens. */}
          {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role */}
          <div
            aria-label={t("utility.language")}
            className="absolute right-0 z-30 mt-2 min-w-60 overflow-hidden rounded-sm border border-control bg-surface p-1.5 shadow-xl"
            id={listboxId}
            role="listbox"
          >
            {LANGUAGES.map((language, index) => {
              const selected = language.locale === locale;
              return (
                <div key={language.locale}>
                  {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role */}
                  <button
                    ref={(element) => {
                      options.current[index] = element;
                    }}
                    aria-selected={selected}
                    className={`ui-feedback grid w-full grid-cols-[1rem_1.25rem_minmax(0,1fr)] items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm font-semibold ${
                      selected
                        ? "bg-accent-muted text-accent"
                        : "text-secondary hover:bg-surface-raised hover:text-ink"
                    }`}
                    role="option"
                    tabIndex={index === activeIndex ? 0 : -1}
                    type="button"
                    onClick={() => selectLanguage(language.locale)}
                    onKeyDown={(event) => moveOption(event, index)}
                  >
                    <CheckIcon
                      aria-hidden="true"
                      className={selected ? "opacity-100" : "opacity-0"}
                      size={14}
                      weight="bold"
                    />
                    <LanguageFlag src={language.flag} />
                    <span className="whitespace-nowrap" lang={language.locale}>
                      {language.label}
                    </span>
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
