import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PreferencesProvider } from "@/app/PreferencesProvider";
import { PendingChangesBar } from "@/features/pending-changes/PendingChangesBar";
import type { PendingEdit } from "@/features/pending-changes/pendingEdits";

const edit: PendingEdit = {
  feature: "run",
  entity: "run",
  field: "currency",
  before: 12,
  after: 20,
  label: "Currency",
  subject: "Run",
};

describe("PendingChangesBar", () => {
  it("keeps exact changes collapsed until Review is requested", async () => {
    const user = userEvent.setup();
    render(
      <PreferencesProvider>
        <PendingChangesBar
          backupPath={null}
          edits={[edit]}
          error={null}
          saving={false}
          onRevert={vi.fn()}
          onSave={vi.fn()}
        />
      </PreferencesProvider>,
    );

    const review = screen.getByTestId("workspace-review");
    const actionBar = screen.getByTestId("workspace-action-bar");
    expect(review.hasAttribute("hidden")).toBe(true);
    expect(actionBar.contains(review)).toBe(true);
    const reviewButton = screen.getByRole("button", { name: "Review" });
    await user.click(reviewButton);
    expect(review.hasAttribute("hidden")).toBe(false);
    expect(review.className).not.toContain("overflow");
    expect(review.querySelector("ul")?.className).toContain("overflow-y-auto");
    expect(reviewButton.getAttribute("aria-expanded")).toBe("true");
    expect(reviewButton.className).toContain("aria-expanded:border-accent");
    expect(reviewButton.className).toContain("aria-expanded:text-accent");
    expect(document.activeElement).toBe(reviewButton);
    expect(screen.getByText("12 → 20")).toBeTruthy();
    await user.click(reviewButton);
    expect(review.hasAttribute("hidden")).toBe(true);
    expect(reviewButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("bounds only the review list for many changes without changing page scroll", async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, "scrollTo");
    const edits = Array.from({ length: 20 }, (_, index): PendingEdit => ({
      feature: "players",
      entity: `player-${index}`,
      field: "health",
      before: 12,
      after: index + 20,
      label: "Health",
      subject: `Player ${index}`,
    }));
    render(
      <PreferencesProvider>
        <PendingChangesBar
          backupPath={null}
          edits={edits}
          error={null}
          saving={false}
          onRevert={vi.fn()}
          onSave={vi.fn()}
        />
      </PreferencesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Review" }));
    const review = screen.getByTestId("workspace-review");
    expect(review.querySelector("ul")?.className).toContain("max-h-[min(45dvh,24rem)]");
    expect(review.className).not.toContain("overflow");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("keeps Revert All and Save Changes usable while review is open", async () => {
    const user = userEvent.setup();
    const onRevert = vi.fn();
    const onSave = vi.fn();
    render(
      <PreferencesProvider>
        <PendingChangesBar
          backupPath={null}
          edits={[edit]}
          error={null}
          saving={false}
          onRevert={onRevert}
          onSave={onSave}
        />
      </PreferencesProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(onRevert).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("closes review automatically when pending edits reach zero", async () => {
    const user = userEvent.setup();
    const props = {
      backupPath: null,
      error: null,
      saving: false,
      onRevert: vi.fn(),
      onSave: vi.fn(),
    };
    const { rerender } = render(
      <PreferencesProvider>
        <PendingChangesBar {...props} edits={[edit]} />
      </PreferencesProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Review" }));

    rerender(
      <PreferencesProvider>
        <PendingChangesBar {...props} edits={[]} />
      </PreferencesProvider>,
    );
    expect(screen.queryByTestId("workspace-review")).toBeNull();
  });

  it("announces pending counts, saving progress, success, and durable errors", () => {
    const { rerender } = render(
      <PreferencesProvider>
        <PendingChangesBar
          backupPath={null}
          edits={[edit]}
          error={null}
          saving={false}
          onRevert={vi.fn()}
          onSave={vi.fn()}
        />
      </PreferencesProvider>,
    );
    expect(screen.getByText("1 pending change").tagName).toBe("OUTPUT");

    rerender(
      <PreferencesProvider>
        <PendingChangesBar
          backupPath={null}
          edits={[edit]}
          error={null}
          saving
          onRevert={vi.fn()}
          onSave={vi.fn()}
        />
      </PreferencesProvider>,
    );
    expect(screen.getByText("Saving safely…", { selector: "output" }).tagName).toBe("OUTPUT");

    rerender(
      <PreferencesProvider>
        <PendingChangesBar
          backupPath="C:\\fixture\\save.es3.bak"
          edits={[]}
          error="Write failed"
          saving={false}
          onRevert={vi.fn()}
          onSave={vi.fn()}
        />
      </PreferencesProvider>,
    );
    expect(screen.getByText("Write failed").getAttribute("role")).toBe("alert");
    expect(screen.getByText(/Saved safely/).closest("output")?.tagName).toBe("OUTPUT");
    expect(screen.queryByText("C:\\fixture\\save.es3.bak")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
  });

  it("keeps long localized status text wrappable above the sticky actions", () => {
    localStorage.setItem("repoditor.locale", "id");
    const error = "RepoDitor tidak dapat menyimpan perubahan karena file berubah di disk. ".repeat(
      4,
    );
    render(
      <PreferencesProvider>
        <PendingChangesBar
          backupPath={null}
          edits={[edit]}
          error={error}
          saving={false}
          onRevert={vi.fn()}
          onSave={vi.fn()}
        />
      </PreferencesProvider>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(error);
    expect(alert.className).toContain("wrap-break-word");
    expect(screen.getByTestId("workspace-action-bar").textContent).toContain("Simpan Perubahan");
  });
});
