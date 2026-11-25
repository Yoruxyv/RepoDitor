import type { EnvironmentDiscovery } from "@/app/tauri/desktopContracts";

export type CompatibilityEnvironment = Pick<
  EnvironmentDiscovery,
  "gameDetected" | "healthWriteCompatibility"
>;
export type CompatibilityIssue = "unapproved" | "unknown" | "incompatible" | "missing";
export function installedWriteRestriction(
  environment: CompatibilityEnvironment,
): CompatibilityIssue {
  if (!environment.gameDetected) return "missing";
  return environment.healthWriteCompatibility?.status === "unsupported" ? "unapproved" : "unknown";
}
