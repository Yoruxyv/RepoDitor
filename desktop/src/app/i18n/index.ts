/**
 * Translation facade and formatter for RepoDitor-owned interface text.
 *
 * English defines the compile-time key set; every locale must implement that set.
 * Game-derived names and save values remain opaque data and are never translated here.
 */
import type { DesktopOperationErrorCode } from "@electron/contracts";
import { zhCN } from "@/app/i18n/locales/zh-CN";
import { en } from "@/app/i18n/locales/en";
import { id } from "@/app/i18n/locales/id";
import { ja } from "@/app/i18n/locales/ja";
import { ko } from "@/app/i18n/locales/ko";

export type TranslationKey = keyof typeof en;
export type TranslationValues = Readonly<Record<string, string | number>>;
export type Translate = (key: TranslationKey, values?: TranslationValues) => string;

export const SUPPORTED_LOCALES = ["en", "ja", "ko", "zh-CN", "id"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Validate a persisted or external locale value against the shipped catalog.
 *
 * @param value - Candidate preference value.
 * @returns Whether the value can safely index every translation table.
 */
export function isLocale(value: string | null): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}

export const TRANSLATIONS: Record<Locale, Record<TranslationKey, string>> = {
  en,
  ja,
  ko,
  "zh-CN": zhCN,
  id,
};

const ERROR_KEYS: Record<DesktopOperationErrorCode, TranslationKey> = {
  python_unavailable: "error.service",
  process_failed: "error.service",
  process_timeout: "error.service",
  empty_response: "error.service",
  malformed_response: "error.service",
  invalid_response: "error.service",
  invalid_request: "error.invalidRequest",
  game_running: "error.gameRunning",
  game_status_unknown: "error.gameUnknown",
  save_missing: "error.saveMissing",
  meta_missing: "error.saveMissing",
  save_corrupt: "error.saveInvalid",
  save_decrypt_failed: "error.saveInvalid",
  save_unsupported: "error.saveInvalid",
  save_stale: "error.saveStale",
  save_validation_failed: "error.saveInvalid",
  backup_failed: "error.write",
  save_write_failed: "error.write",
  save_verification_failed: "error.write",
  backend_unavailable: "error.service",
  internal_error: "error.service",
};

/**
 * Map a stable desktop error code to RepoDitor-owned interface copy.
 *
 * @param code - Validated error code returned through preload.
 * @returns Translation key appropriate for user-facing failure presentation.
 */
export function operationErrorKey(code: DesktopOperationErrorCode): TranslationKey {
  return ERROR_KEYS[code];
}
