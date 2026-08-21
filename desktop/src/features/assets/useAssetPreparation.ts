/** Subscribes to Electron-owned optional artwork preparation progress. */
import { useEffect, useState } from "react";

import type { AssetPreparationState } from "@electron/contracts";

const INITIAL_STATE: AssetPreparationState = {
  stage: "idle",
  installationFound: false,
  buildVerified: false,
  completed: null,
  total: null,
  currentAsset: null,
  currentAssetLabel: null,
  degraded: false,
};

export function useAssetPreparation(): AssetPreparationState {
  const [state, setState] = useState<AssetPreparationState>(INITIAL_STATE);

  useEffect(() => {
    let mounted = true;
    let receivedEvent = false;
    const unsubscribe = window.repoditor.assets.onState((next) => {
      receivedEvent = true;
      if (mounted) setState(next);
    });
    void window.repoditor.assets
      .state()
      .then((next) => {
        if (mounted && !receivedEvent) setState(next);
      })
      .catch(() => {
        if (mounted) {
          setState((current) => ({ ...current, stage: "degraded", degraded: true }));
        }
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return state;
}
