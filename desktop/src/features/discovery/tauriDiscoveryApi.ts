/** Only the migrated discovery contract is exposed by the experimental host. */
import { invoke } from "@tauri-apps/api/core";

import type {
  DesktopOperationResult,
  EnvironmentDiscovery,
  RepoDitorApi,
} from "@electron/contracts";

export const tauriDiscoveryApi: RepoDitorApi["environment"] = {
  async detect() {
    try {
      return await invoke<DesktopOperationResult<EnvironmentDiscovery>>("environment_detect");
    } catch {
      return {
        ok: false,
        error: { code: "internal_error", message: "The desktop discovery bridge is unavailable." },
      };
    }
  },
};
