import { describe, expect, it } from "vitest";

import {
  isLocale,
  MAX_SUPPORTED_LOCALES,
  SUPPORTED_LOCALES,
  TRANSLATIONS,
} from "@/app/i18n";

describe("i18n facade", () => {
  it("keeps every locale aligned with the English dictionary", () => {
    const englishKeys = Object.keys(TRANSLATIONS.en);

    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(TRANSLATIONS[locale])).toEqual(englishKeys);
    }
  });

  it("recognizes only canonical supported locale preferences", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isLocale(locale)).toBe(true);
    }
    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("zh")).toBe(false);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("keeps the shipped locale count within the current language-menu capacity", () => {
    // This is an intentional UI contract. Change it only with a selector redesign.
    expect(MAX_SUPPORTED_LOCALES).toBe(5);
    expect(SUPPORTED_LOCALES).toHaveLength(MAX_SUPPORTED_LOCALES);
  });
});
