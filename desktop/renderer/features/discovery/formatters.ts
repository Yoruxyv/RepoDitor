/** Locale-aware formatting for already-sanitized save discovery metadata. */
import type { Locale, TranslationValues, TranslationKey } from "@/app/i18n";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;

const INTL_LOCALES: Record<Locale, string> = {
  en: "en-US",
  ja: "ja-JP",
  ko: "ko-KR",
  "zh-CN": "zh-CN",
  id: "id-ID",
};

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatDateTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatRelativeTime(
  value: string,
  locale: Locale,
  t: Translate,
  now = Date.now(),
): string {
  const differenceSeconds = (new Date(value).getTime() - now) / 1000;
  const absoluteSeconds = Math.abs(differenceSeconds);

  if (absoluteSeconds < 60) {
    return t("time.justNow");
  }
  const formatter = new Intl.RelativeTimeFormat(INTL_LOCALES[locale], { numeric: "auto" });
  if (absoluteSeconds < 3_600) {
    return formatter.format(Math.round(differenceSeconds / 60), "minute");
  }
  if (absoluteSeconds < 86_400) {
    return formatter.format(Math.round(differenceSeconds / 3_600), "hour");
  }
  if (absoluteSeconds < 2_592_000) {
    return formatter.format(Math.round(differenceSeconds / 86_400), "day");
  }
  return formatDateTime(value, locale);
}

export function formatFileSize(sizeBytes: number, locale: Locale): string {
  if (sizeBytes === 0) {
    return "0 B";
  }
  const unitIndex = Math.min(
    Math.floor(Math.log(sizeBytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  );
  const value = sizeBytes / 1024 ** unitIndex;
  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toLocaleString(INTL_LOCALES[locale], {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  })} ${BYTE_UNITS[unitIndex]}`;
}

export function formatSaveCount(count: number, t: Translate): string {
  return t(count === 1 ? "discovery.save.one" : "discovery.save.many", { count });
}
