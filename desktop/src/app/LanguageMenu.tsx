/** Accessible locale selector backed by renderer-only persisted preferences. */
import { CheckIcon, TranslateIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { usePreferences } from "@/app/preferences";
import {
  menuSurfaceClassName,
  utilityMenuItemStateClassName,
  utilityTriggerClassName,
} from "@/app/utilityMenuStyles";
import {
  MAX_SUPPORTED_LOCALES,
  SUPPORTED_LOCALES,
  TRANSLATIONS,
  type Locale,
  type TranslationKey,
} from "@/app/i18n";
import chinaFlag from "@/assets/flags/china.svg?no-inline";
import indonesiaFlag from "@/assets/flags/indonesia.svg?no-inline";
import japanFlag from "@/assets/flags/japan.svg?no-inline";
import southKoreaFlag from "@/assets/flags/south-korea.svg?no-inline";
import unitedStatesFlag from "@/assets/flags/united-states.svg?no-inline";

interface LanguageMetadata {
  readonly aliases: readonly string[];
  readonly flag: string;
  readonly nativeLabel: string;
  readonly translationKey: TranslationKey;
}

/**
 * Locale IDs and ordering stay authoritative in SUPPORTED_LOCALES.
 * Country names below are search aliases only; the canonical entity remains the language.
 */
const LANGUAGE_METADATA = {
  en: {
    aliases: [],
    flag: unitedStatesFlag,
    nativeLabel: "English",
    translationKey: "language.en",
  },
  ja: {
    aliases: ["japan"],
    flag: japanFlag,
    nativeLabel: "日本語",
    translationKey: "language.ja",
  },
  ko: {
    aliases: ["korea", "south korea"],
    flag: southKoreaFlag,
    nativeLabel: "한국어",
    translationKey: "language.ko",
  },
  "zh-CN": {
    aliases: ["china", "simplified chinese"],
    flag: chinaFlag,
    nativeLabel: "中文",
    translationKey: "language.zh-CN",
  },
  id: {
    aliases: ["indonesia", "bahasa indonesia"],
    flag: indonesiaFlag,
    nativeLabel: "Bahasa Indonesia",
    translationKey: "language.id",
  },
} satisfies Readonly<Record<Locale, LanguageMetadata>>;

const LANGUAGES = SUPPORTED_LOCALES.map((locale) => ({
  locale,
  ...LANGUAGE_METADATA[locale],
}));

if (LANGUAGES.length > MAX_SUPPORTED_LOCALES) {
  throw new Error(
    `LanguageMenu supports at most ${MAX_SUPPORTED_LOCALES} locales without a selector redesign.`,
  );
}

export const LANGUAGE_TYPEAHEAD_RESET_MS = 800;

function normalizeLanguageSearch(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

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
  const typeaheadBuffer = useRef("");
  const typeaheadResetTimer = useRef<number | null>(null);
  const listboxId = useId();

  useEffect(() => {
    if (open) options.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    return () => {
      if (typeaheadResetTimer.current !== null) {
        window.clearTimeout(typeaheadResetTimer.current);
      }
    };
  }, []);

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

  function resetTypeaheadBuffer(): void {
    typeaheadBuffer.current = "";
    if (typeaheadResetTimer.current !== null) {
      window.clearTimeout(typeaheadResetTimer.current);
      typeaheadResetTimer.current = null;
    }
  }

  function scheduleTypeaheadReset(): void {
    if (typeaheadResetTimer.current !== null) {
      window.clearTimeout(typeaheadResetTimer.current);
    }
    typeaheadResetTimer.current = window.setTimeout(() => {
      typeaheadBuffer.current = "";
      typeaheadResetTimer.current = null;
    }, LANGUAGE_TYPEAHEAD_RESET_MS);
  }

  function openMenu(index = selectedIndex): void {
    resetTypeaheadBuffer();
    setActiveIndex(index);
    setOpen(true);
  }

  function closeMenu(returnFocus: boolean): void {
    resetTypeaheadBuffer();
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  function selectLanguage(nextLocale: Locale): void {
    setLocale(nextLocale);
    closeMenu(true);
  }

  function secondaryLabel(language: (typeof LANGUAGES)[number]): string | null {
    const localizedLabel = t(language.translationKey);
    return normalizeLanguageSearch(localizedLabel) === normalizeLanguageSearch(language.nativeLabel)
      ? null
      : localizedLabel;
  }

  function languageSearchTerms(language: (typeof LANGUAGES)[number]): readonly string[] {
    return [
      language.nativeLabel,
      TRANSLATIONS.en[language.translationKey],
      t(language.translationKey),
      language.locale,
      ...language.aliases,
    ];
  }

  function findTypeaheadMatch(query: string, index: number, cycleFromNext: boolean): number | null {
    const normalizedQuery = normalizeLanguageSearch(query);
    const startOffset = cycleFromNext ? 1 : 0;

    for (let offset = 0; offset < LANGUAGES.length; offset += 1) {
      const candidateIndex = (index + startOffset + offset) % LANGUAGES.length;
      const candidate = LANGUAGES[candidateIndex]!;
      if (
        languageSearchTerms(candidate).some((term) =>
          normalizeLanguageSearch(term).startsWith(normalizedQuery),
        )
      ) {
        return candidateIndex;
      }
    }

    return null;
  }

  function typeaheadMatch(key: string, index: number): number | null {
    const normalizedKey = normalizeLanguageSearch(key);
    const bufferedQuery = `${typeaheadBuffer.current}${normalizedKey}`;
    typeaheadBuffer.current = bufferedQuery;
    scheduleTypeaheadReset();

    const characters = Array.from(bufferedQuery);
    const firstCharacter = characters[0]!;
    const repeatedCharacterQuery =
      characters.length > 1 && characters.every((character) => character === firstCharacter);
    const effectiveQuery = repeatedCharacterQuery ? firstCharacter : bufferedQuery;
    const cycleFromNext = characters.length === 1 || repeatedCharacterQuery;

    const bufferedMatch = findTypeaheadMatch(effectiveQuery, index, cycleFromNext);
    if (bufferedMatch !== null) return bufferedMatch;

    if (characters.length > 1) {
      const fallbackMatch = findTypeaheadMatch(normalizedKey, index, true);
      if (fallbackMatch !== null) {
        typeaheadBuffer.current = normalizedKey;
        return fallbackMatch;
      }
    }

    return null;
  }

  function moveOption(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      resetTypeaheadBuffer();
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectLanguage(LANGUAGES[index]!.locale);
      return;
    }

    let nextIndex: number | null;
    if (event.key === "ArrowDown") {
      resetTypeaheadBuffer();
      nextIndex = (index + 1) % LANGUAGES.length;
    } else if (event.key === "ArrowUp") {
      resetTypeaheadBuffer();
      nextIndex = (index - 1 + LANGUAGES.length) % LANGUAGES.length;
    } else if (event.key === "Home") {
      resetTypeaheadBuffer();
      nextIndex = 0;
    } else if (event.key === "End") {
      resetTypeaheadBuffer();
      nextIndex = LANGUAGES.length - 1;
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      nextIndex = typeaheadMatch(event.key, index);
    } else {
      resetTypeaheadBuffer();
      return;
    }

    if (nextIndex === null) return;
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
        aria-label={`${t("utility.language")}: ${selectedLanguage.nativeLabel}`}
        className={utilityTriggerClassName(open)}
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
        <span>{selectedLanguage.nativeLabel}</span>
      </button>

      {open ? (
        <>
          {/* Native select popups cannot honor RepoDitor's dark/light surface tokens. */}
          {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role */}
          <div
            aria-label={t("utility.language")}
            className={`${menuSurfaceClassName} absolute right-0 z-30 mt-1.5 w-max min-w-[17rem] max-w-[22rem] overflow-hidden`}
            id={listboxId}
            role="listbox"
          >
            {LANGUAGES.map((language, index) => {
              const selected = language.locale === locale;
              const localizedSecondaryLabel = secondaryLabel(language);
              const accessibleLabel = localizedSecondaryLabel
                ? `${language.nativeLabel} \u00b7 ${localizedSecondaryLabel}`
                : language.nativeLabel;
              return (
                <div key={language.locale}>
                  {/* eslint-disable-next-line jsx-a11y/prefer-tag-over-role */}
                  <button
                    ref={(element) => {
                      options.current[index] = element;
                    }}
                    aria-label={accessibleLabel}
                    aria-selected={selected}
                    className={`ui-feedback grid h-9 w-full grid-cols-[1rem_1.25rem_minmax(0,1fr)] items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm font-semibold ${utilityMenuItemStateClassName(selected, index === activeIndex)}`}
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
                    <span className="min-w-0 whitespace-nowrap">
                      <span lang={language.locale}>{language.nativeLabel}</span>
                      {localizedSecondaryLabel ? (
                        <span className="text-xs font-medium opacity-70" lang={locale}>
                          {" · "}
                          {localizedSecondaryLabel}
                        </span>
                      ) : null}
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
