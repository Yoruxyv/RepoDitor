import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LANGUAGE_TYPEAHEAD_RESET_MS, LanguageMenu } from "@/app/LanguageMenu";
import { PreferencesProvider } from "@/app/PreferencesProvider";

function renderMenu() {
  return render(
    <PreferencesProvider>
      <LanguageMenu />
    </PreferencesProvider>,
  );
}

function typeAhead(value: string): void {
  for (const key of value) {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) throw new Error("Expected an active language option.");
    fireEvent.keyDown(active, { key });
  }
}

function advancePastTypeaheadReset(): void {
  act(() => vi.advanceTimersByTime(LANGUAGE_TYPEAHEAD_RESET_MS + 1));
}

describe("LanguageMenu", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("renders the five languages in fixed order with compact localized secondary labels", async () => {
    localStorage.setItem("repoditor.theme", "dark");
    const user = userEvent.setup();
    const { unmount } = renderMenu();

    const trigger = screen.getByRole("button", { name: "Language: English" });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
    expect(trigger.querySelector("img")?.getAttribute("src")).toBeTruthy();
    await user.click(trigger);

    const expectedLabels = [
      "English",
      "日本語 · Japanese",
      "한국어 · Korean",
      "中文 · Chinese",
      "Bahasa Indonesia · Indonesian",
    ];
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(
      expectedLabels,
    );
    expect(screen.getByRole("option", { name: "English" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    for (const name of expectedLabels) {
      expect(
        screen.getByRole("option", { name }).querySelector("img")?.getAttribute("src"),
      ).toBeTruthy();
    }
    expect(screen.queryByRole("option", { name: "English · English" })).toBeNull();

    await user.click(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "日本語 · Japanese" }));
    expect(screen.getByRole("button", { name: "言語: 日本語" })).toBeTruthy();
    expect(localStorage.getItem("repoditor.locale")).toBe("ja");

    unmount();
    renderMenu();
    expect(screen.getByRole("button", { name: "言語: 日本語" })).toBeTruthy();
  });

  it("omits a secondary label when the current translation duplicates the native name", async () => {
    localStorage.setItem("repoditor.locale", "ja");
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "言語: 日本語" }));

    expect(screen.getByRole("option", { name: "日本語" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "日本語 · 日本語" })).toBeNull();
  });

  it("migrates a persisted legacy Chinese locale to zh-CN", () => {
    localStorage.setItem("repoditor.locale", "zh");

    renderMenu();

    expect(screen.getByRole("button", { name: "语言: 中文" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(localStorage.getItem("repoditor.locale")).toBe("zh-CN");
  });

  it("keeps selected state distinct from keyboard focus", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Language: English" }));

    const english = screen.getByRole("option", { name: "English" });
    const japanese = screen.getByRole("option", { name: "日本語 · Japanese" });
    fireEvent.keyDown(english, { key: "ArrowDown" });

    expect(document.activeElement).toBe(japanese);
    expect(english.getAttribute("aria-selected")).toBe("true");
    expect(japanese.getAttribute("aria-selected")).toBe("false");
  });

  it("supports arrow navigation, Space selection, and Escape focus restoration", async () => {
    const user = userEvent.setup();
    renderMenu();

    const trigger = screen.getByRole("button", { name: "Language: English" });
    trigger.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown} ");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "言語: 日本語" }));

    await user.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "言語: 日本語" }));
  });

  it("supports Home, End, Enter selection, and Tab dismissal without trapping focus", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Language: English" }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: "Bahasa Indonesia · Indonesian" }),
    );
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "English" }));
    await user.keyboard("{End}{Enter}");

    const indonesianTrigger = screen.getByRole("button", { name: "Bahasa: Bahasa Indonesia" });
    expect(localStorage.getItem("repoditor.locale")).toBe("id");

    await user.click(indonesianTrigger);
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("buffers multi-character typeahead across canonical language names", () => {
    vi.useFakeTimers();
    try {
      renderMenu();
      fireEvent.click(screen.getByRole("button", { name: "Language: English" }));

      const cases = [
        ["jap", "日本語 · Japanese"],
        ["japan", "日本語 · Japanese"],
        ["japanese", "日本語 · Japanese"],
        ["kor", "한국어 · Korean"],
        ["korean", "한국어 · Korean"],
        ["chi", "中文 · Chinese"],
        ["chinese", "中文 · Chinese"],
        ["indo", "Bahasa Indonesia · Indonesian"],
        ["indonesian", "Bahasa Indonesia · Indonesian"],
      ] as const;

      for (const [query, expectedName] of cases) {
        advancePastTypeaheadReset();
        typeAhead(query);
        expect(document.activeElement).toBe(screen.getByRole("option", { name: expectedName }));
      }
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("matches localized, native, locale-code, and country-alias typeahead terms", () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("repoditor.locale", "id");
      renderMenu();
      fireEvent.click(screen.getByRole("button", { name: "Bahasa: Bahasa Indonesia" }));

      typeAhead("jep");
      expect(document.activeElement).toBe(screen.getByRole("option", { name: "日本語 · Jepang" }));

      advancePastTypeaheadReset();
      typeAhead("日");
      expect(document.activeElement).toBe(screen.getByRole("option", { name: "日本語 · Jepang" }));

      advancePastTypeaheadReset();
      typeAhead("zh-");
      expect(document.activeElement).toBe(screen.getByRole("option", { name: "中文 · Tionghoa" }));

      advancePastTypeaheadReset();
      typeAhead("china");
      expect(document.activeElement).toBe(screen.getByRole("option", { name: "中文 · Tionghoa" }));
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("resets the typeahead buffer after the inactivity timeout", () => {
    vi.useFakeTimers();
    try {
      renderMenu();
      fireEvent.click(screen.getByRole("button", { name: "Language: English" }));

      typeAhead("j");
      expect(document.activeElement).toBe(
        screen.getByRole("option", { name: "日本語 · Japanese" }),
      );

      advancePastTypeaheadReset();
      typeAhead("k");
      expect(document.activeElement).toBe(screen.getByRole("option", { name: "한국어 · Korean" }));
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});
