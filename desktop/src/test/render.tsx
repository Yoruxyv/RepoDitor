import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import { PreferencesProvider } from "@/app/PreferencesProvider";

export function renderWithPreferences(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: PreferencesProvider });
}
