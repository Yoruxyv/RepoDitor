import { describe, expect, it } from "vitest";

import { isLocale, SUPPORTED_LOCALES, TRANSLATIONS } from "@/app/translations";

describe("translations facade", () => {
  it("keeps every locale aligned with the English dictionary", () => {
    const englishKeys = Object.keys(TRANSLATIONS.en);

    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(TRANSLATIONS[locale])).toEqual(englishKeys);
    }
  });

  it("recognizes only supported locale preferences", () => {
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
