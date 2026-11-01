import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/app/i18n/I18nProvider";
import { CosmeticsEditor } from "@/features/cosmetics/CosmeticsEditor";
import { KNOWN_COSMETIC_IDS, inspectCosmeticBulkLock } from "@/features/cosmetics/cosmetics";
import { getCosmeticPendingEdits } from "@/features/cosmetics/pendingEdits";
import { createEditSession, type EditSession } from "@/features/save-file/session";
import { parseSaveJson, serializeSaveJson } from "@/features/save-file/serialization";

function metaSession(
  owned: readonly number[] = KNOWN_COSMETIC_IDS.filter((id) => id !== 0),
  equipped: readonly number[] = [],
  presets: readonly (readonly number[])[] = [[]],
): EditSession {
  const data = parseSaveJson(
    JSON.stringify({
      cosmeticHistory: { value: [...owned, 999] },
      cosmeticUnlocks: { value: [...owned, 999] },
      cosmeticEquipped: { value: equipped },
      cosmeticPresets: { value: presets },
      colorPresets: { value: [[1, 2]] },
      future: { sentinel: "preserve" },
    }),
  );
  return createEditSession({ data, kind: "meta", fileName: "MetaSave.es3" });
}
function Harness({
  initial,
  busy = false,
}: {
  readonly initial: EditSession;
  readonly busy?: boolean;
}) {
  const [session, setSession] = useState(initial);
  return (
    <>
      <CosmeticsEditor busy={busy} session={session} onSessionChange={setSession} />
      <output data-testid="pending-count">{getCosmeticPendingEdits(session).length}</output>
    </>
  );
}
function renderEditor(initial = metaSession(), busy = false) {
  return render(
    <I18nProvider>
      <Harness initial={initial} busy={busy} />
    </I18nProvider>,
  );
}
function disabled(element: HTMLElement): boolean {
  if (!(element instanceof HTMLButtonElement)) throw new Error("Expected button");
  return element.disabled;
}

describe("streamlined Web cosmetic bulk actions", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.locale = "en";
  });
  it("allows the unreferenced 556/557 case with ID 0 unowned and no raw-ID controls", () => {
    const session = metaSession();
    renderEditor(session);
    expect(screen.getByText("556 of 557 supported cosmetics unlocked")).toBeTruthy();
    expect(screen.queryByLabelText("Cosmetic ID")).toBeNull();
    expect(screen.queryByRole("button", { name: "Unlock cosmetic" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove ownership" })).toBeNull();
    expect(disabled(screen.getByRole("button", { name: "Lock All Cosmetics" }))).toBe(false);
    expect(inspectCosmeticBulkLock(session.working).ownedIds).not.toContain(0);
  });
  it("ignores references to an unowned ID without clearing those references", () => {
    const session = metaSession(undefined, [0], [[0]]);
    renderEditor(session);
    expect(disabled(screen.getByRole("button", { name: "Lock All Cosmetics" }))).toBe(false);
    expect(inspectCosmeticBulkLock(session.working).blockedReason).toBeNull();
  });
  it.each([
    ["equipped", [27], [[]]],
    ["saved preset", [], [[27]]],
  ] as const)(
    "explains blocking %s references independently of an unowned ID 0",
    (_label, equipped, presets) => {
      renderEditor(metaSession(undefined, equipped, presets));
      const button = screen.getByRole("button", { name: "Lock All Cosmetics" });
      expect(disabled(button)).toBe(true);
      expect(button.getAttribute("aria-describedby")).toBe("cosmetics-lock-reason");
      expect(screen.getByText(/Lock All is blocked because/).textContent).toContain(_label);
      expect(screen.getByText(/import the updated MetaSave/)).toBeTruthy();
      expect(disabled(screen.getByRole("button", { name: "Unlock Remaining Cosmetics" }))).toBe(
        false,
      );
    },
  );
  it("explains unverifiable references, busy state and zero eligible ownership", () => {
    const session = metaSession();
    delete session.working.cosmeticEquipped;
    const { unmount } = renderEditor(session);
    expect(disabled(screen.getByRole("button", { name: "Lock All Cosmetics" }))).toBe(true);
    expect(screen.getByText(/Equipment or preset references could not be verified/)).toBeTruthy();
    unmount();
    const busy = renderEditor(metaSession(), true);
    expect(document.getElementById("cosmetics-lock-reason")?.textContent).toContain(
      "A file operation is in progress",
    );
    busy.unmount();
    renderEditor(metaSession([]));
    expect(disabled(screen.getByRole("button", { name: "Lock All Cosmetics" }))).toBe(true);
    expect(screen.getByText("No supported cosmetics are currently unlocked.")).toBeTruthy();
    expect(screen.getByText("1 unsupported owned cosmetic is preserved.")).toBeTruthy();
  });
  it("confirmation cancellation and Escape preserve all working data and restore trigger focus", () => {
    const session = metaSession();
    const before = serializeSaveJson(session.working);
    renderEditor(session);
    const trigger = screen.getByRole("button", { name: "Lock All Cosmetics" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Lock All Cosmetics?" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    expect(within(dialog).getByText(/556 supported cosmetics/)).toBeTruthy();
    expect(within(dialog).getByText("1 unsupported owned cosmetic is preserved.")).toBeTruthy();
    fireEvent.click(cancel);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(serializeSaveJson(session.working)).toBe(before);
    fireEvent.click(trigger);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(serializeSaveJson(session.working)).toBe(before);
    expect(screen.getByTestId("pending-count").textContent).toBe("0");
  });
  it("confirmed Lock All removes only eligible ownership and updates counts and pending review", () => {
    const session = metaSession();
    const unrelated = serializeSaveJson({
      equipment: session.working.cosmeticEquipped,
      presets: session.working.cosmeticPresets,
      colors: session.working.colorPresets,
      future: session.working.future,
    });
    renderEditor(session);
    fireEvent.click(screen.getByRole("button", { name: "Lock All Cosmetics" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Lock 556 cosmetics",
      }),
    );
    expect(screen.getByText("0 of 557 supported cosmetics unlocked")).toBeTruthy();
    expect(screen.getByText("1 unsupported owned cosmetic is preserved.")).toBeTruthy();
    expect(screen.getByTestId("pending-count").textContent).toBe("1");
    expect(disabled(screen.getByRole("button", { name: "Lock All Cosmetics" }))).toBe(true);
    expect(inspectCosmeticBulkLock(session.working).preservedCount).toBe(1);
    expect(
      serializeSaveJson({
        equipment: session.working.cosmeticEquipped,
        presets: session.working.cosmeticPresets,
        colors: session.working.colorPresets,
        future: session.working.future,
      }),
    ).toBe(unrelated);
    expect(session.baselineSource).toContain("547");
  });
  it("does not let a confirmation apply to a different file/session", () => {
    const first = metaSession();
    const second = metaSession([1, 547]);
    const onChange = vi.fn();
    const { rerender } = render(
      <I18nProvider>
        <CosmeticsEditor busy={false} session={first} onSessionChange={onChange} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Lock All Cosmetics" }));
    rerender(
      <I18nProvider>
        <CosmeticsEditor busy={false} session={second} onSessionChange={onChange} />
      </I18nProvider>,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/The save or its ownership changed/)).toBeTruthy();
    expect(disabled(within(dialog).getByRole("button", { name: "Lock 556 cosmetics" }))).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
