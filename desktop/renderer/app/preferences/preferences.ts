/** Stable preference context contract used by theme, locale, and utility controls. */
import { createContext, useContext } from "react";

import type { Locale, Translate } from "@/app/i18n";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export interface Preferences {
  readonly locale: Locale;
  readonly theme: ThemePreference;
  readonly resolvedTheme: ResolvedTheme;
  readonly setLocale: (locale: Locale) => void;
  readonly setTheme: (theme: ThemePreference) => void;
  readonly t: Translate;
}

export const PreferencesContext = createContext<Preferences | null>(null);

/**
 * Access renderer-local appearance, locale, and translation preferences.
 *
 * @returns The active preferences context.
 * @throws When called outside `PreferencesProvider`.
 */
export function usePreferences(): Preferences {
  const preferences = useContext(PreferencesContext);
  if (!preferences) throw new Error("usePreferences must be used within PreferencesProvider.");
  return preferences;
}
