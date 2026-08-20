import { screen } from "@testing-library/react";
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
});
