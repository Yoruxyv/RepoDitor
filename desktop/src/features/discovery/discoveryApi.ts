/** Narrow renderer adapter for the preload environment-discovery operation. */
import type { DesktopOperationResult, EnvironmentDiscovery } from "@electron/contracts";

const BRIDGE_FAILURE: DesktopOperationResult<EnvironmentDiscovery> = {
  ok: false,
  error: {
    code: "internal_error",
    message: "The desktop discovery bridge is unavailable.",
  },
};

export async function detectEnvironment(): Promise<DesktopOperationResult<EnvironmentDiscovery>> {
  try {
    return await window.repoditor.environment.detect();
  } catch {
    return BRIDGE_FAILURE;
  }
}
