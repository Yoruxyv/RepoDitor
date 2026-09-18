import { describe, expect, it } from "vitest";

import {
  isLocale,
  MAX_SUPPORTED_LOCALES,
  SUPPORTED_LOCALES,
  TRANSLATIONS,
  type TranslationKey,
} from "@/app/i18n";

const PLACEHOLDER_RE = /\{([A-Za-z]\w*)\}/g;

function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortedKeys(table: object): string[] {
  return sortStrings(Object.keys(table));
}

function extractPlaceholders(value: string): string[] {
  return sortStrings([...value.matchAll(PLACEHOLDER_RE)].map((match) => match[1]!));
}

function localeCodeFromPath(path: string): string {
  const filename = path.slice(path.lastIndexOf("/") + 1);
  return filename.slice(0, -".ts".length);
}

const englishKeys = sortedKeys(TRANSLATIONS.en);

/**
 * Discover locale modules from the real directory rather than maintaining a
 * second hardcoded list in the test. This catches both:
 *
 * - a locale file that exists but is not registered; and
 * - a registered locale whose source file is missing.
 */
const localeModules = import.meta.glob("./locales/*.ts", { eager: true });
const localeFiles = sortStrings(
  Object.keys(localeModules)
    .filter((path) => !path.endsWith(".d.ts"))
    .map(localeCodeFromPath),
);

describe("i18n locale integrity", () => {
  it.each(SUPPORTED_LOCALES)("%s has exactly the English translation keys", (locale) => {
    expect(sortedKeys(TRANSLATIONS[locale])).toEqual(englishKeys);
  });

  it("keeps locale files on disk aligned with the registered locale set", () => {
    expect(localeFiles).toEqual(sortStrings(SUPPORTED_LOCALES));
    expect(sortedKeys(TRANSLATIONS)).toEqual(sortStrings(SUPPORTED_LOCALES));
  });

  it("keeps English as a non-trivial canonical translation catalog", () => {
    expect(englishKeys.length).toBeGreaterThanOrEqual(100);
  });
});

describe("i18n translation values", () => {
  it.each(SUPPORTED_LOCALES)("%s contains only non-empty strings", (locale) => {
    const invalid = Object.entries(TRANSLATIONS[locale])
      .filter(([, value]) => typeof value !== "string" || value.trim().length === 0)
      .map(([key]) => key);

    expect(invalid).toEqual([]);
  });

  it.each(SUPPORTED_LOCALES.filter((locale) => locale !== "en"))(
    "%s preserves every English interpolation placeholder",
    (locale) => {
      const mismatches: string[] = [];

      for (const key of englishKeys as TranslationKey[]) {
        const expected = extractPlaceholders(TRANSLATIONS.en[key]);
        const actual = extractPlaceholders(TRANSLATIONS[locale][key]);

        if (expected.join("\0") !== actual.join("\0")) {
          mismatches.push(`${key}: en={${expected.join(", ")}} ${locale}={${actual.join(", ")}}`);
        }
      }

      expect(mismatches).toEqual([]);
    },
  );
});

describe("i18n facade", () => {
  it("recognizes only canonical supported locale preferences", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isLocale(locale)).toBe(true);
    }

    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("zh")).toBe(false);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("keeps the locale registry within the current five-language selector invariant", () => {
    expect(MAX_SUPPORTED_LOCALES).toBe(5);
    expect(SUPPORTED_LOCALES).toEqual(["en", "ja", "ko", "zh-CN", "id"]);
    expect(SUPPORTED_LOCALES).toHaveLength(MAX_SUPPORTED_LOCALES);
  });
});
