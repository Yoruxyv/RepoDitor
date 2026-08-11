import type { DesktopOperationErrorCode } from "@electron/contracts";
import { zh } from "@/app/translation/chinese";
import { en } from "@/app/translation/english";
import { id } from "@/app/translation/indonesian";
import { ja } from "@/app/translation/japanese";
import { ko } from "@/app/translation/korean";

export type TranslationKey = keyof typeof en;
export type TranslationValues = Readonly<Record<string, string | number>>;
export type Translate = (key: TranslationKey, values?: TranslationValues) => string;

export const SUPPORTED_LOCALES = ["en", "ja", "ko", "zh", "id"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export function isLocale(value: string | null): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}

export const TRANSLATIONS: Record<Locale, Record<TranslationKey, string>> = {
  en,
  ja,
  ko,
  zh,
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

export function operationErrorKey(code: DesktopOperationErrorCode): TranslationKey {
  return ERROR_KEYS[code];
}
