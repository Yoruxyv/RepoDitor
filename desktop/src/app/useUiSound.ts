/** Reuses one optional local UI sound without making audio part of interaction state. */
import { useEffect } from "react";

import clickSound from "@/assets/sfx/mouse-click.mp3";

/**
 * Attach one fail-soft, delegated activation sound for eligible UI controls.
 *
 * @param enabled - Whether this hook should attach the document activation listener.
 */
export function useUiSound(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const audio = new Audio(clickSound);
    audio.preload = "auto";
    audio.volume = 0.12;

    const play = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>(".ui-feedback");
      if (!control || control.matches(":disabled, [aria-disabled='true']")) return;

      try {
        audio.pause();
        audio.currentTime = 0;
        void audio.play().catch(() => undefined);
      } catch {
        // UI audio is optional and must never interrupt the action.
      }
    };

    document.addEventListener("click", play);
    return () => {
      document.removeEventListener("click", play);
      audio.pause();
    };
  }, [enabled]);
}
