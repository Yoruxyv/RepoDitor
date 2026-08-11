import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { useUiSound } from "@/app/useUiSound";

function SoundHarness({ onActivate }: { readonly onActivate: () => void }) {
  useUiSound();
  return (
    <button className="ui-feedback" type="button" onClick={onActivate}>
      Activate
    </button>
  );
}

it("keeps the interaction working when optional UI audio fails", async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play")
    .mockRejectedValue(new Error("Audio unavailable"));
  const onActivate = vi.fn();
  const user = userEvent.setup();
  render(<SoundHarness onActivate={onActivate} />);

  await user.click(screen.getByRole("button", { name: "Activate" }));

  expect(play).toHaveBeenCalledOnce();
  expect(onActivate).toHaveBeenCalledOnce();
  play.mockRestore();
});
