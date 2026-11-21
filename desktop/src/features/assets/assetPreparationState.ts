import type { AssetPreparationState } from "@/app/desktopContracts";

export const INITIAL_ASSET_PREPARATION: AssetPreparationState = {
  stage: "idle",
  installationFound: false,
  buildVerified: false,
  completed: null,
  total: null,
  currentAsset: null,
  currentAssetLabel: null,
  degraded: false,
};
