/** Publish cosmetic presentation progress without gating save/ownership actions. */
import { BrowserWindow, ipcMain } from "electron";

import { IPC_CHANNELS } from "../channels.cjs";
import { decodedCosmeticArtworkCache } from "../icons/cosmeticArtworkCache.cjs";

export function registerCosmeticArtworkProgressIpc(): () => void {
  ipcMain.handle(IPC_CHANNELS.cosmeticsArtworkState, () =>
    decodedCosmeticArtworkCache.getPreparationState(),
  );
  return decodedCosmeticArtworkCache.subscribePreparation((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.cosmeticsArtworkProgress, state);
      }
    }
  });
}
