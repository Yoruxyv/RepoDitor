import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { RunStateDto } from "@electron/contracts";
import { renderWithPreferences } from "@/test/render";
import { RunView } from "./RunView";

const run: RunStateDto = {
  stats: [
    { key: "level", label: "Level", value: 5 },
    { key: "currency", label: "Currency", value: 12 },
  ],
  resumeLocation: { value: "Normal", options: ["Normal", "Shop / Service Station"] },
};
const handlers = {
  pendingByField: {},
  onResumeChange: vi.fn(),
  onRetry: vi.fn(),
  onRevert: vi.fn(),
  onStatChange: vi.fn(),
};

describe("RunView", () => {
  it("shows signed and boundary values and observed resume locations as copyable read-only fields", async () => {
    const user = userEvent.setup();
    renderWithPreferences(
      <RunView
        {...handlers}
        loading={false}
        error={null}
        run={{
          stats: [
            { key: "level", label: "Level", value: 2147483648 },
            { key: "currency", label: "Currency", value: -9007199254740991 },
            { key: "lives", label: "Lives", value: 0 },
            { key: "totalHaul", label: "Total Haul", value: 9007199254740991 },
          ],
          resumeLocation: { value: "Unknown (9)", options: ["Normal", "Unknown (9)"] },
        }}
        onStatChange={null}
        onResumeChange={null}
        onRevert={null}
      />,
    );
    for (const [name, value] of [
      ["Level", "2147483648"],
      ["Currency", "-9007199254740991"],
      ["Lives", "0"],
      ["Total Haul", "9007199254740991"],
      ["Resume location", "Unknown (9)"],
    ] as const) {
      const field = screen.getByRole("textbox", { name });
      expect(field.getAttribute("value")).toBe(value);
      expect(field.hasAttribute("readonly")).toBe(true);
      field.focus();
      await user.keyboard("{ArrowUp}7");
      expect((field as HTMLInputElement).value).toBe(value);
      expect(document.activeElement).toBe(field);
    }
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector('[data-testid^="pending-run-"]')).toBeNull();
  });
  it("keeps resume-location selection behavior through the reusable Select", async () => {
    const user = userEvent.setup();
    const onResumeChange = vi.fn();
    renderWithPreferences(
      <RunView
        {...handlers}
        error={null}
        loading={false}
        run={run}
        onResumeChange={onResumeChange}
      />,
    );

    const control = screen.getByRole("combobox", { name: "Resume location" });
    await user.click(control);
    await user.click(screen.getByRole("option", { name: "Shop / Service Station" }));
    expect(onResumeChange).toHaveBeenCalledWith("Shop / Service Station");
  });

  it("uses stat-row skeletons for initial loading and keeps existing refresh data", () => {
    const { rerender } = renderWithPreferences(
      <RunView {...handlers} error={null} loading run={null} />,
    );

    expect(screen.getByTestId("run-skeleton").getAttribute("aria-busy")).toBe("true");
    expect(document.querySelectorAll('[data-skeleton-kind="run-stat"]')).toHaveLength(4);
    expect(screen.queryByText("Loading run state…")).toBeNull();

    rerender(<RunView {...handlers} error={null} loading run={run} />);
    expect(screen.queryByTestId("run-skeleton")).toBeNull();
    expect(screen.getByRole("spinbutton", { name: "Level" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Run" }).getAttribute("aria-busy")).toBe("true");
  });

  it("does not stage Run values outside their stored Int32 representation", () => {
    const onStatChange = vi.fn();
    const onRevert = vi.fn();
    renderWithPreferences(
      <RunView
        {...handlers}
        error={null}
        loading={false}
        run={run}
        onRevert={onRevert}
        onStatChange={onStatChange}
      />,
    );

    const currency = screen.getByRole("spinbutton", { name: "Currency" });
    fireEvent.change(currency, { target: { value: "2147483648" } });

    expect(currency.getAttribute("aria-invalid")).toBe("true");
    expect(onStatChange).not.toHaveBeenCalled();
    expect(onRevert).toHaveBeenCalledWith("currency");
  });
});
