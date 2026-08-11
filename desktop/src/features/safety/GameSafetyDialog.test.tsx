import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import { PreferencesProvider } from "@/app/PreferencesProvider";
import { GameSafetyDialog } from "@/features/safety/GameSafetyDialog";

function Harness() {
  const [blocked, setBlocked] = useState(false);
  const fallback = useRef<HTMLButtonElement>(null);

  return (
    <PreferencesProvider>
      <button ref={fallback} type="button" onClick={() => setBlocked(true)}>
        Open safety dialog
      </button>
      {blocked ? (
        <GameSafetyDialog
          checking={false}
          fallbackFocusRef={fallback}
          status="running"
          onCheckAgain={() => setBlocked(false)}
          onExit={() => undefined}
        />
      ) : null}
    </PreferencesProvider>
  );
}

describe("GameSafetyDialog", () => {
  it("opens modally, owns focus, blocks Escape, and restores focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open safety dialog" });

    await user.click(trigger);
    const dialog = screen.getByRole("dialog") as HTMLDialogElement;
    const checkAgain = screen.getByRole("button", { name: "Check Again" });
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(checkAgain);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Exit RepoDitor" }));
    await user.tab();
    expect(document.activeElement).toBe(checkAgain);

    const cancel = new Event("cancel", { bubbles: false, cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(checkAgain);

    await user.click(checkAgain);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
