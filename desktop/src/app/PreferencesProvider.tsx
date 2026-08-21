/**
 * Owns renderer preference lifetime and synchronization with browser/OS state.
 *
 * Theme and locale are presentation preferences stored locally in the renderer; they
 * never enter the save protocol or Python backend.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

import { PreferencesContext, type ResolvedTheme, type ThemePreference } from "@/app/preferences";
import {
  isLocale,
  TRANSLATIONS,
  type Locale,
  type TranslationKey,
  type TranslationValues,
} from "@/app/translations";

const THEME_STORAGE_KEY = "repoditor.theme";
const LOCALE_STORAGE_KEY = "repoditor.locale";
const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

function readTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "light" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

function readLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : "en";
  } catch {
    return "en";
  }
}

function systemIsDark(): boolean {
  return window.matchMedia?.(SYSTEM_THEME_QUERY).matches ?? true;
}

function resolveTheme(theme: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (theme !== "system") return theme;
  return systemDark ? "dark" : "light";
}

export function PreferencesProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePreference>(readTheme);
  const [locale, setLocale] = useState<Locale>(readLocale);
  const [systemDark, setSystemDark] = useState(systemIsDark);
  const resolvedTheme = resolveTheme(theme, systemDark);

  useEffect(() => {
    const query = window.matchMedia?.(SYSTEM_THEME_QUERY);
    if (!query) return;
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Renderer preferences are best-effort when storage is unavailable.
    }
  }, [resolvedTheme, theme]);

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Renderer preferences are best-effort when storage is unavailable.
    }
  }, [locale]);

  const t = useCallback(
    (key: TranslationKey, values: TranslationValues = {}) => {
      return Object.entries(values).reduce(
        (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
        TRANSLATIONS[locale][key],
      );
    },
    [locale],
  );

  const preferences = useMemo(
    () => ({
      locale,
      theme,
      resolvedTheme,
      setLocale,
      setTheme,
      t,
    }),
    [locale, resolvedTheme, t, theme],
  );

  return <PreferencesContext value={preferences}>{children}</PreferencesContext>;
}
