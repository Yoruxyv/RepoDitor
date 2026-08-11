import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PreferencesProvider } from "@/app/PreferencesProvider";
import { PendingChangesBar } from "@/features/editor/PendingChangesBar";
import type { PendingEdit } from "@/features/editor/pendingEdits";

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

    const changes = document.querySelector('ul[aria-label="Unsaved changes"]')!;
    expect(changes.hasAttribute("hidden")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(changes.hasAttribute("hidden")).toBe(false);
    expect(screen.getByText("12 → 20")).toBeTruthy();
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
  });
});
