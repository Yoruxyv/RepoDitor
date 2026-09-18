import { describe, expect, it } from "vitest";

import { LANGUAGE_NAMES, resolveLocalizedMessage, type TranslationKey } from "@/app/i18n/catalog";
import { enMessages } from "@/app/i18n/locales/en";
import { idMessages } from "@/app/i18n/locales/id";
import { jaMessages } from "@/app/i18n/locales/ja";
import { koMessages } from "@/app/i18n/locales/ko";
import { zhCnMessages } from "@/app/i18n/locales/zh-CN";
import { LOCALES } from "@/app/i18n/types";

const catalogs = {
  en: enMessages,
  id: idMessages,
  ja: jaMessages,
  ko: koMessages,
  "zh-CN": zhCnMessages,
} as const;

function flattenMessages(value: unknown, prefix = "", result = new Map<string, string>()) {
  if (typeof value === "string") result.set(prefix, value);
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenMessages(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)]
    .map((match) => match[1]!)
    .sort((left, right) => left.localeCompare(right));
}

const localeIndexModules = import.meta.glob("./locales/*/index.ts", { eager: true });
const localeDirectories = Object.keys(localeIndexModules)
  .map((path) => /^\.\/locales\/([^/]+)\/index\.ts$/u.exec(path)?.[1])
  .filter((locale): locale is string => locale !== undefined)
  .sort((left, right) => left.localeCompare(right));

describe("localization catalog", () => {
  it("assembles every supported locale with a language name", () => {
    expect(LOCALES.map((locale) => LANGUAGE_NAMES[locale])).toEqual([
      "English",
      "Bahasa Indonesia",
      "日本語",
      "한국어",
      "简体中文",
    ]);
  });

  it("keeps locale directories on disk aligned with the runtime registry", () => {
    expect(localeDirectories).toEqual(
      [...LOCALES].sort((left, right) => left.localeCompare(right)),
    );
    expect(
      Object.keys(catalogs).sort((left, right) => left.localeCompare(right)),
    ).toEqual([...LOCALES].sort((left, right) => left.localeCompare(right)));
  });

  it("keeps English as a non-trivial canonical message catalog", () => {
    expect(flattenMessages(enMessages).size).toBeGreaterThanOrEqual(100);
  });

  it("interpolates and pluralizes without composing translated sentences", () => {
    const key: TranslationKey = "save.pending.count";
    expect(resolveLocalizedMessage("en", key, { count: 1 }, 1)).toBe("1 pending change");
    expect(resolveLocalizedMessage("en", key, { count: 2 }, 2)).toBe("2 pending changes");
    expect(resolveLocalizedMessage("ja", key, { count: 2 }, 2)).toBe("保留中の変更 2 件");
  });

  it("falls back to canonical English when a requested message is absent", () => {
    expect(resolveLocalizedMessage("id", "save.picker.drop", {}, undefined, {})).toBe(
      "Drop a save here",
    );
    expect(
      resolveLocalizedMessage("id", "save.picker.drop", {}, undefined, {
        save: { picker: { drop: "" } },
      }),
    ).toBe("Drop a save here");
  });

  it("keeps technical and game-owned literals stable in every locale", () => {
    for (const locale of LOCALES) {
      expect(resolveLocalizedMessage(locale, "save.picker.help")).toContain("MetaSave.es3");
      expect(resolveLocalizedMessage(locale, "save.picker.idleMessage")).toContain(".es3");
      expect(resolveLocalizedMessage(locale, "save.find.locateSteam")).toContain("3241660");
      expect(resolveLocalizedMessage(locale, "save.find.linuxInstruction")).toContain("saves/");
      expect(resolveLocalizedMessage(locale, "save.find.linuxInstruction")).toContain(
        "MetaSave.es3",
      );
    }
  });

  it("provides representative UI copy for every feature in every locale", () => {
    const keys = [
      "app.footerPrivacy",
      "policies.privacyTitle",
      "save.landing.title",
      "run.players.currentHealth",
      "cosmetics.action",
      "recharge.action",
    ] as const satisfies readonly TranslationKey[];

    for (const locale of LOCALES) {
      for (const key of keys) {
        expect(resolveLocalizedMessage(locale, key).trim()).not.toBe("");
      }
    }
  });

  it.each(LOCALES)("%s contains no empty translation leaves", (locale) => {
    const emptyKeys = [...flattenMessages(catalogs[locale])]
      .filter(([, message]) => message.trim() === "")
      .map(([key]) => key);

    expect(emptyKeys).toEqual([]);
  });

  it("keeps every runtime key and interpolation placeholder aligned with English", () => {
    const english = flattenMessages(enMessages);

    for (const locale of LOCALES) {
      const translated = flattenMessages(catalogs[locale]);
      const sortKeys = (keys: Iterable<string>) =>
        [...keys].sort((left, right) => left.localeCompare(right));

      // Comparing flattened leaf paths also catches shape drift, such as a
      // plural { one, other } object becoming a plain string in one locale.
      expect(sortKeys(translated.keys())).toEqual(sortKeys(english.keys()));

      for (const [key, message] of english) {
        expect(placeholders(translated.get(key)!)).toEqual(placeholders(message));
      }
    }
  });
});
