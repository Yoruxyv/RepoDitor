import { ipcMain } from "electron";

import { assetPreparationService, type AssetPreparationService } from "../assets/preparation.cjs";
import { IPC_CHANNELS } from "../channels.cjs";
import { localIconRegistry } from "../icons/registry.cjs";
import { pythonClient, type PythonClient } from "../python/client.cjs";
import { getAdvancedSave } from "./items.cjs";
import { listMaps } from "./maps.cjs";
import { getRunState } from "./run.cjs";
import { listUpgrades, prepareUpgradesForEntry } from "./upgrades.cjs";

export { getAdvancedSave } from "./items.cjs";
export { listMaps } from "./maps.cjs";
export { getRunState } from "./run.cjs";
export { listUpgrades, prepareUpgradesForEntry } from "./upgrades.cjs";

type IpcRegistrar = Pick<typeof ipcMain, "handle">;

export function registerEditorIpc(
  client: PythonClient = pythonClient,
  registrar: IpcRegistrar = ipcMain,
  preparation: AssetPreparationService = assetPreparationService,
): void {
  registrar.handle(IPC_CHANNELS.upgradesList, (_event, saveId: unknown) =>
    listUpgrades(client, saveId, localIconRegistry, preparation),
  );
  registrar.handle(
    IPC_CHANNELS.upgradesPrepareEntry,
    (_event, saveId: unknown, requiredVisualKeys: unknown) =>
      prepareUpgradesForEntry(
        client,
        saveId,
        requiredVisualKeys,
        preparation,
        localIconRegistry,
      ),
  );
  registrar.handle(IPC_CHANNELS.runGet, (_event, saveId: unknown) => getRunState(client, saveId));
  registrar.handle(IPC_CHANNELS.advancedGet, (_event, saveId: unknown) =>
    getAdvancedSave(client, saveId),
  );
  registrar.handle(IPC_CHANNELS.mapsList, () => listMaps(client));
}
