import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Select } from "./Select";

const OPTIONS = [
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
  { value: "gamma", label: "Gamma" },
] as const;

function StatefulSelect({ disabled = false }: { readonly disabled?: boolean }) {
  const [value, setValue] = useState<(typeof OPTIONS)[number]["value"]>("alpha");
  return (
    <>
      <Select
        ariaLabel="Mode"
        disabled={disabled}
        options={OPTIONS}
        value={value}
        onValueChange={setValue}
      />
      <button type="button">After select</button>
    </>
  );
}

describe("Select", () => {
  it("renders the selected value and opens a themed listbox", async () => {
    const user = userEvent.setup();
    render(<StatefulSelect />);

    const control = screen.getByRole("combobox", { name: "Mode" });
    expect(control.textContent).toContain("Alpha");
    expect(control.getAttribute("aria-expanded")).toBe("false");

    await user.click(control);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    expect(control.className).toContain("bg-surface-raised");
    expect(control.className).toContain("rounded-md");
    const listbox = screen.getByRole("listbox", { name: "Mode" });
    expect(listbox.className).toContain("bg-surface-raised");
    expect(listbox.className).toContain("border-line");
    expect(listbox.className).toContain("rounded-md");
  });

  it("selects an option and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<StatefulSelect />);

    const control = screen.getByRole("combobox", { name: "Mode" });
    await user.click(control);
    await user.click(screen.getByRole("option", { name: "Beta" }));

    expect(control.textContent).toContain("Beta");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(control);
  });

  it("supports Arrow keys plus Home and End navigation", async () => {
    const user = userEvent.setup();
    render(<StatefulSelect />);

    const control = screen.getByRole("combobox", { name: "Mode" });
    control.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Alpha" }));

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Beta" }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Gamma" }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Alpha" }));
  });

  it("selects the keyboard-active option with Enter", async () => {
    const user = userEvent.setup();
    render(<StatefulSelect />);

    const control = screen.getByRole("combobox", { name: "Mode" });
    control.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(control.textContent).toContain("Beta");
  });

  it("closes on Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(<StatefulSelect />);

    const control = screen.getByRole("combobox", { name: "Mode" });
    await user.click(control);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(control);
  });

  it("lets Tab leave the open listbox normally", async () => {
    const user = userEvent.setup();
    render(<StatefulSelect />);

    await user.click(screen.getByRole("combobox", { name: "Mode" }));
    await user.tab();

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "After select" }));
  });

  it("does not open or change while disabled", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        ariaLabel="Mode"
        disabled
        options={OPTIONS}
        value="alpha"
        onValueChange={onValueChange}
      />,
    );

    const control = screen.getByRole("combobox", { name: "Mode" });
    expect((control as HTMLButtonElement).disabled).toBe(true);
    await user.click(control);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("marks the selected option separately from keyboard-active options", async () => {
    const user = userEvent.setup();
    render(<StatefulSelect />);

    await user.click(screen.getByRole("combobox", { name: "Mode" }));
    const selected = screen.getByRole("option", { name: "Alpha" });
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.className).toContain("bg-accent-muted");

    await user.keyboard("{ArrowDown}");
    const active = screen.getByRole("option", { name: "Beta" });
    expect(active.getAttribute("aria-selected")).toBe("false");
    expect(active.className).toContain("bg-surface");
  });

  it("truncates long values and constrains the popup to the trigger width", async () => {
    const user = userEvent.setup();
    const longLabel = "A very long selected option that should not force the editor wider";
    render(
      <Select
        ariaLabel="Long mode"
        options={[{ value: "long", label: longLabel }]}
        value="long"
        onValueChange={vi.fn()}
      />,
    );

    const control = screen.getByRole("combobox", { name: "Long mode" });
    expect(control.querySelector("span")?.className).toContain("truncate");
    await user.click(control);
    const listbox = screen.getByRole("listbox", { name: "Long mode" });
    expect(listbox.className).toContain("w-full");
    expect(listbox.className).toContain("max-w-full");
  });
});
