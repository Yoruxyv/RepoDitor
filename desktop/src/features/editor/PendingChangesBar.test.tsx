import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText("Saving…", { selector: "output" }).tagName).toBe("OUTPUT");

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
