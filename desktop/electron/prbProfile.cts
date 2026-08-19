import { appendFileSync } from "node:fs";

export function rechargeProfileEvent(event: string, fields: Record<string, unknown> = {}): void {
  if (process.env.REPODITOR_PROFILE_RECHARGE !== "1") return;
  const file = process.env.REPODITOR_RECHARGE_PROFILE_FILE;
  if (!file) return;
  appendFileSync(
    file,
    `${JSON.stringify({ source: "electron", event, timestamp: Date.now() / 1000, ...fields })}\n`,
    "utf8",
  );
}
