import { createContext, useContext } from "react";

import type { Locale, Translate } from "@/app/translations";

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

export function usePreferences(): Preferences {
  const preferences = useContext(PreferencesContext);
  if (!preferences) throw new Error("usePreferences must be used within PreferencesProvider.");
  return preferences;
}
