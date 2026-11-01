/** Optional cosmetic-artwork progress; independent from save and ownership controls. */
import { useEffect, useState } from "react";

import type { CosmeticArtworkPreparationState } from "@electron/contracts";

const INITIAL: CosmeticArtworkPreparationState = {
  phase: "idle",
  completed: 0,
  total: 0,
  cached: 0,
  failed: 0,
};

export function useCosmeticArtworkPreparation(): CosmeticArtworkPreparationState {
  const [state, setState] = useState<CosmeticArtworkPreparationState>(INITIAL);

  useEffect(() => {
    let mounted = true;
    let eventArrived = false;
    const unsubscribe = window.repoditor.cosmetics.onArtworkProgress((next) => {
      eventArrived = true;
      if (mounted) setState(next);
    });
    void window.repoditor.cosmetics
      .artworkState()
      .then((next) => {
        if (mounted && !eventArrived) setState(next);
      })
      .catch(() => {
        if (mounted && !eventArrived) {
          setState((previous) => ({ ...previous, phase: "degraded" }));
        }
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return state;
}
