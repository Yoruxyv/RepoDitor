import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PreferencesProvider } from "@/app/preferences/PreferencesProvider";
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
  it("explains an unavailable Save while retaining Review and Revert", async () => {
    const user = userEvent.setup();
    const revert = vi.fn();
    const save = vi.fn();
    render(
      <PreferencesProvider>
        <PendingChangesBar
          edits={[edit]}
          saving={false}
          error={null}
          backupPath={null}
          saveUnavailableReason="Saving this domain is unavailable."
          onRevert={revert}
          onSave={save}
        />
      </PreferencesProvider>,
    );
    const button = screen.getByRole("button", { name: "Save Changes" });
    expect(button.matches(":disabled")).toBe(true);
    expect(document.getElementById(button.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Saving this domain is unavailable.",
    );
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText("12 → 20")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Revert all" }));
    expect(revert).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });
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
    expect(review.className).toContain("overflow-y-auto");
    expect(reviewButton.getAttribute("aria-expanded")).toBe("true");
    expect(reviewButton.textContent).toBe("Hide review");
    expect(reviewButton.className).toContain("aria-expanded:border-accent");
    expect(reviewButton.className).toContain("aria-expanded:text-accent");
    expect(document.activeElement).toBe(reviewButton);
    expect(screen.getByText("12 → 20")).toBeTruthy();
    review.focus();
    await user.keyboard("{Escape}");
    expect(review.hasAttribute("hidden")).toBe(true);
    expect(reviewButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(reviewButton);
  });

  it.each([1, 20, 100])(
    "bounds review with %i pending edits without changing page scroll",
    async (count) => {
      const user = userEvent.setup();
      const scrollTo = vi.spyOn(window, "scrollTo");
      const edits = Array.from({ length: count }, (_, index): PendingEdit => ({
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
      expect(review.className).toContain("max-h-[min(32dvh,18rem)]");
      expect(review.className).toContain("overflow-y-auto");
      expect(review.querySelectorAll("li")).toHaveLength(count);
      expect(scrollTo).not.toHaveBeenCalled();
    },
  );

  it("collapses on save and lets review open and hide while saving without changing edits", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onRevert = vi.fn();
    const view = (saving: boolean) => (
      <PreferencesProvider>
        <PendingChangesBar
          backupPath={null}
          edits={[edit]}
          error={null}
          saving={saving}
          reviewPath="fixture.es3"
          onRevert={onRevert}
          onSave={onSave}
        />
      </PreferencesProvider>
    );
    const { rerender } = render(view(false));
    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    rerender(view(true));
    expect(screen.getByTestId("workspace-review").hidden).toBe(true);
    const progress = screen.getByRole("progressbar", { name: "Saving safely…" });
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText("12 → 20")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Hide review" }));
    expect(screen.getByRole("progressbar")).toBe(progress);
    expect(screen.getByTestId("workspace-review").hidden).toBe(true);
    expect(onSave).toHaveBeenCalledOnce();
    expect(onRevert).not.toHaveBeenCalled();
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

  it("opens required review from Save and waits for a separate confirmation", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const reviewPath = "C:\\fixture\\save.es3";
    render(
      <PreferencesProvider>
        <PendingChangesBar
          backupPath={null}
          edits={[edit]}
          error={null}
          saving={false}
          reviewPath={reviewPath}
          onRevert={vi.fn()}
          onSave={onSave}
        />
      </PreferencesProvider>,
    );

    const save = screen.getByRole("button", { name: "Save Changes" });
    const review = screen.getByRole("button", { name: "Review" });
    await user.dblClick(save);
    expect(screen.getByText(/Source .*save\.es3/)).toBeTruthy();
    expect(review.getAttribute("aria-expanded")).toBe("true");
    expect(onSave).not.toHaveBeenCalled();

    review.focus();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(save);
    await user.keyboard("{Enter}");
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

  it("shows indeterminate progress only while a save is active", () => {
    const props = {
      edits: [edit],
      onRevert: vi.fn(),
      onSave: vi.fn(),
    };
    const { rerender } = render(
      <PreferencesProvider>
        <PendingChangesBar {...props} backupPath={null} error={null} saving={false} />
      </PreferencesProvider>,
    );

    expect(screen.queryByRole("progressbar")).toBeNull();

    rerender(
      <PreferencesProvider>
        <PendingChangesBar {...props} backupPath={null} error={null} saving />
      </PreferencesProvider>,
    );
    const progress = screen.getByRole("progressbar", { name: "Saving safely…" });
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
    expect(progress.hasAttribute("aria-valuemin")).toBe(false);
    expect(progress.hasAttribute("aria-valuemax")).toBe(false);
    expect(screen.getByText("Saving safely…", { selector: "output" })).toBeTruthy();

    rerender(
      <PreferencesProvider>
        <PendingChangesBar
          {...props}
          backupPath="C:\\fixture\\save.es3.bak"
          error={null}
          saving={false}
        />
      </PreferencesProvider>,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();

    rerender(
      <PreferencesProvider>
        <PendingChangesBar {...props} backupPath={null} error="Write failed" saving={false} />
      </PreferencesProvider>,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
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
