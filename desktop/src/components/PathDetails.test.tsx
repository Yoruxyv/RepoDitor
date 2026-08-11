import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PathDetails } from "@/components/PathDetails";
import { renderWithPreferences } from "@/test/render";

describe("PathDetails", () => {
  it("shows only the source identity until expanded and copies the full path", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const path = String.raw`C:\fixture\save\slot.es3`;

    renderWithPreferences(<PathDetails label="Source" value={path} />);

    expect(screen.getByText("slot.es3")).toBeTruthy();
    expect(screen.getByText(path).closest("details")?.open).toBe(false);
    await user.click(screen.getByText(/Source:/));
    await user.click(screen.getByRole("button", { name: "Copy Source" }));

    expect(writeText).toHaveBeenCalledWith(path);
    expect(screen.getByText("Path copied")).toBeTruthy();
  });

  it("reports clipboard failure without breaking disclosure", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("blocked"));
    renderWithPreferences(<PathDetails label="Source" value={String.raw`C:\slot.es3`} />);

    await user.click(screen.getByText(/Source:/));
    await user.click(screen.getByRole("button", { name: "Copy Source" }));
    expect(await screen.findByText("Path could not be copied")).toBeTruthy();
  });
});
