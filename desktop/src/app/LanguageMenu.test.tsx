import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { LanguageMenu } from "@/app/LanguageMenu";
import { PreferencesProvider } from "@/app/PreferencesProvider";

function renderMenu() {
  return render(
    <PreferencesProvider>
      <LanguageMenu />
    </PreferencesProvider>,
  );
}

describe("LanguageMenu", () => {
  beforeEach(() => localStorage.clear());

  it("uses a styled listbox with flags, native names, persistence, and outside dismissal", async () => {
    localStorage.setItem("repoditor.theme", "dark");
    const user = userEvent.setup();
    const { unmount } = renderMenu();

    const trigger = screen.getByRole("button", { name: "Language: English" });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
    expect(trigger.querySelector("img")?.getAttribute("src")).toBeTruthy();
    await user.click(trigger);

    expect(screen.getByRole("option", { name: "English" }).getAttribute("aria-selected"))
      .toBe("true");
    for (const name of ["English", "日本語", "한국어", "中文", "Bahasa Indonesia"]) {
      const option = screen.getByRole("option", { name });
      expect(option.textContent).toBe(name);
      expect(option.querySelector("img")?.getAttribute("src")).toBeTruthy();
    }

    await user.click(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "日本語" }));
    expect(screen.getByRole("button", { name: "言語: 日本語" })).toBeTruthy();
    expect(localStorage.getItem("repoditor.locale")).toBe("ja");

    unmount();
    renderMenu();
    expect(screen.getByRole("button", { name: "言語: 日本語" })).toBeTruthy();
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

  it("supports Home, End, and native-name type-ahead", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Language: English" }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Bahasa Indonesia" }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "English" }));
    await user.keyboard("b{Enter}");

    expect(localStorage.getItem("repoditor.locale")).toBe("id");
    expect(screen.getByRole("button", { name: "Bahasa: Bahasa Indonesia" })).toBeTruthy();
  });
});
