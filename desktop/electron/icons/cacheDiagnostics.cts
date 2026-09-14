/** Bounded local support diagnostics for presentation-cache decisions. */
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  PresentationCacheDiagnostic,
  PresentationCacheDiagnosticSink,
} from "./upgradeTextureCache.cjs";

const MAX_LOG_BYTES = 64 * 1024;
const ROTATED_LOG_BYTES = MAX_LOG_BYTES / 2;
const MAX_DEDUPLICATION_KEYS = 512;
const SAFE_UPGRADE_KEY = /^[A-Za-z0-9._-]{1,128}$/;

function logRecord(diagnostic: PresentationCacheDiagnostic): string {
  const record: { timestamp: string; reason: string; upgradeKey?: string } = {
    timestamp: new Date().toISOString(),
    reason: diagnostic.reason,
  };
  if (diagnostic.upgradeKey !== undefined && SAFE_UPGRADE_KEY.test(diagnostic.upgradeKey)) {
    record.upgradeKey = diagnostic.upgradeKey;
  }
  return `${JSON.stringify(record)}\n`;
}

async function rotateIfNeeded(logPath: string): Promise<void> {
  const details = await fs.stat(logPath);
  if (details.size <= MAX_LOG_BYTES) return;
  const lines = (await fs.readFile(logPath, "utf8")).trimEnd().split("\n");
  const kept: string[] = [];
  let keptBytes = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const bytes = Buffer.byteLength(`${line}\n`, "utf8");
    if (keptBytes + bytes > ROTATED_LOG_BYTES) break;
    kept.unshift(line);
    keptBytes += bytes;
  }
  await fs.writeFile(logPath, kept.length === 0 ? "" : `${kept.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

/** Create a fail-soft, bounded sink containing no save data or filesystem identity. */
export function createPresentationCacheDiagnosticSink(
  logPath: string,
): PresentationCacheDiagnosticSink {
  const seen = new Set<string>();
  let tail = Promise.resolve();
  return (diagnostic) => {
    const safeKey =
      diagnostic.upgradeKey !== undefined && SAFE_UPGRADE_KEY.test(diagnostic.upgradeKey)
        ? diagnostic.upgradeKey
        : "";
    const signature = `${diagnostic.reason}:${safeKey}`;
    if (seen.has(signature)) return;
    if (seen.size >= MAX_DEDUPLICATION_KEYS) seen.clear();
    seen.add(signature);
    tail = tail.then(async () => {
      try {
        await fs.mkdir(path.dirname(logPath), { recursive: true });
        await fs.appendFile(logPath, logRecord(diagnostic), { encoding: "utf8", mode: 0o600 });
        await rotateIfNeeded(logPath);
      } catch {
        // Support diagnostics must never affect optional artwork or save editing.
      }
    });
    return tail;
  };
}
