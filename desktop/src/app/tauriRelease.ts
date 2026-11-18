import { getVersion } from "@tauri-apps/api/app";

const LATEST_RELEASE = "https://api.github.com/repos/Yoruxyv/RepoDitor/releases/latest";
const RELEASE_PAGE = "https://github.com/Yoruxyv/RepoDitor/releases/tag/";
const LAST_CHECK = "repoditor.update.lastCheck";
const DISMISSED = "repoditor.update.dismissed.";
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const SEMVER = /^(\d+\.\d+\.\d+)(?:-([\da-z.-]+))?(?:\+([\da-z.-]+))?$/i;
const LEADING_ZERO = /^0\d+$/;

type Release = { version: string; url: string };
let sessionCheck: Promise<Release | null> | undefined;

function parseVersion(version: string) {
  if (version.length > 128) return null;
  const match = SEMVER.exec(version);
  if (match?.[0] !== version) return null;
  const [, core, prerelease, build] = match;
  if (
    !core ||
    core.split(".").some((part) => LEADING_ZERO.test(part)) ||
    prerelease?.split(".").some((part) => !part || LEADING_ZERO.test(part)) ||
    build?.split(".").includes("")
  ) {
    return null;
  }
  return { core, prerelease };
}

function readRelease(value: unknown, installed: string): Release | null {
  if (!value || typeof value !== "object") return null;
  const { draft, prerelease, tag_name: tag, html_url: url } = value as Record<string, unknown>;
  if (draft !== false || prerelease !== false || typeof tag !== "string") return null;
  const latest = parseVersion(tag.replace(/^v/, ""));
  const current = parseVersion(installed);
  if (!current || !latest || latest.prerelease || url !== RELEASE_PAGE + tag) return null;

  const from = current.core.split(".").map(BigInt);
  const to = latest.core.split(".").map(BigInt);
  const different = to.findIndex((part, index) => part !== from[index]);
  const newer = different < 0 ? !!current.prerelease : to[different]! > from[different]!;
  return newer ? { version: latest.core, url } : null;
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const bytes = new Uint8Array(MAX_RESPONSE_BYTES);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(new TextDecoder().decode(bytes.subarray(0, size)));
      if (size + value.byteLength > bytes.byteLength) return null;
      bytes.set(value, size);
      size += value.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

function readStorage(key: string, scope: "localStorage" | "sessionStorage" = "localStorage") {
  try {
    return window[scope].getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(
  key: string,
  value: string,
  scope: "localStorage" | "sessionStorage" = "localStorage",
) {
  try {
    window[scope].setItem(key, value);
  } catch {
    // The in-memory session still limits checks if storage is unavailable.
  }
}

async function requestRelease(): Promise<Release | null> {
  if (readStorage(LAST_CHECK, "sessionStorage")) return null;
  const checked = readStorage(LAST_CHECK);
  const now = Date.now();
  const elapsed = now - Number(checked);
  if (checked !== null && elapsed >= 0 && elapsed < COOLDOWN_MS) return null;

  try {
    const installed = await getVersion();
    writeStorage(LAST_CHECK, String(now), "sessionStorage");
    writeStorage(LAST_CHECK, String(now));
    const response = await fetch(LATEST_RELEASE, {
      headers: { Accept: "application/vnd.github+json" },
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return null;
    }
    const release = readRelease(await readJson(response), installed);
    return release && !readStorage(DISMISSED + release.version) ? release : null;
  } catch {
    return null;
  }
}

export function checkForUpdate() {
  sessionCheck ??= requestRelease();
  return sessionCheck;
}

export function dismissUpdate(version: string) {
  writeStorage(DISMISSED + version, "1");
  sessionCheck = Promise.resolve(null);
}
