import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getVersion } = vi.hoisted(() => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion }));

const request = vi.fn<typeof fetch>();
const releasedAt = "https://github.com/Yoruxyv/RepoDitor/releases/tag/";
const endpoint = "https://api.github.com/repos/Yoruxyv/RepoDitor/releases/latest";
const now = Date.UTC(2026, 0, 1);

function stable(tag: string) {
  return { tag_name: tag, html_url: releasedAt + tag, draft: false, prerelease: false };
}

async function newSession(reload = false) {
  if (!reload) sessionStorage.clear();
  vi.resetModules();
  return import("./tauriRelease");
}

beforeEach(() => {
  localStorage.clear();
  getVersion.mockReset().mockResolvedValue("0.3.9");
  request.mockReset();
  vi.stubGlobal("fetch", request);
  vi.spyOn(Date, "now").mockReturnValue(now);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Tauri release notices", () => {
  it.each([
    ["0.3.9", "v0.3.9", null],
    ["0.3.9", "v0.3.8", null],
    ["0.3.9", "v0.3.10", "0.3.10"],
    ["0.3.10", "v0.3.9", null],
    ["0.3.9", "v0.4.0", "0.4.0"],
    ["0.3.9+build.1", "v0.3.9+build.2", null],
    ["0.3.9-rc.1", "v0.3.9", "0.3.9"],
  ])("compares installed %s with release %s", async (installed, tag, expected) => {
    getVersion.mockResolvedValue(installed);
    request.mockResolvedValue(Response.json(stable(tag)));
    const { checkForUpdate } = await newSession();
    expect(await checkForUpdate()).toEqual(
      expected ? { version: expected, url: releasedAt + tag } : null,
    );
    expect(getVersion).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it.each([
    { ...stable("v0.4.0"), draft: true },
    { ...stable("v0.4.0"), prerelease: true },
    stable("v0.4.0-rc.1"),
    stable("v0.04.0"),
    stable("v0.4"),
    stable("v0.4.0\n"),
    { ...stable("v0.4.0"), html_url: releasedAt.replace(/^https/, "http") + "v0.4.0" },
    { ...stable("v0.4.0"), html_url: releasedAt + "v0.4.1" },
    { ...stable("v0.4.0"), html_url: releasedAt + "v0.4.0?download=true" },
    {
      ...stable("v0.4.0"),
      html_url: "https://github.com.evil.example/Yoruxyv/RepoDitor/releases/tag/v0.4.0",
    },
    { ...stable("v0.4.0"), html_url: "https://github.com/other/RepoDitor/releases/tag/v0.4.0" },
    { tag_name: "v0.4.0" },
    null,
  ])("ignores invalid, untrusted, or unpublished metadata %#", async (metadata) => {
    request.mockResolvedValue(Response.json(metadata));
    const { checkForUpdate } = await newSession();
    expect(await checkForUpdate()).toBeNull();
  });

  it.each([
    ["malformed JSON", () => new Response("{")],
    ["oversized JSON", () => new Response(" ".repeat(257 * 1024))],
    ["rate limited", () => new Response(null, { status: 403 })],
    ["unavailable", () => new Response(null, { status: 503 })],
  ])("fails silently for %s", async (_reason, response) => {
    request.mockResolvedValue(response());
    const { checkForUpdate } = await newSession();
    expect(await checkForUpdate()).toBeNull();
    expect(await checkForUpdate()).toBeNull();
    expect(request).toHaveBeenCalledOnce();
  });

  it("fails silently offline and still observes the cooldown", async () => {
    request.mockRejectedValue(new TypeError("offline"));
    const first = await newSession();
    expect(await first.checkForUpdate()).toBeNull();
    const second = await newSession();
    expect(await second.checkForUpdate()).toBeNull();
    expect(request).toHaveBeenCalledOnce();
  });

  it("passes a five-second abort signal to the request and absorbs timeouts", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    request.mockImplementation(
      (_, options) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
        }),
    );
    const { checkForUpdate } = await newSession();
    const result = checkForUpdate();
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalledExactlyOnceWith(5000);
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    expect(await result).toBeNull();
  });

  it("shares one session request, cools down across sessions, and remembers only the dismissed version", async () => {
    request.mockResolvedValueOnce(Response.json(stable("v0.3.10")));
    const first = await newSession();
    const initial = first.checkForUpdate();
    expect(first.checkForUpdate()).toBe(initial);
    expect(await initial).toMatchObject({ version: "0.3.10" });
    first.dismissUpdate("0.3.10");
    expect(await first.checkForUpdate()).toBeNull();
    const cooled = await newSession();
    expect(await cooled.checkForUpdate()).toBeNull();
    expect(request).toHaveBeenCalledOnce();

    vi.mocked(Date.now).mockReturnValue(now + 7 * 60 * 60 * 1000);
    request.mockResolvedValueOnce(Response.json(stable("v0.3.10")));
    const same = await newSession();
    expect(await same.checkForUpdate()).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);

    vi.mocked(Date.now).mockReturnValue(now + 14 * 60 * 60 * 1000);
    request.mockResolvedValueOnce(Response.json(stable("v0.3.11")));
    const later = await newSession();
    expect(await later.checkForUpdate()).toMatchObject({ version: "0.3.11" });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("does not recheck after a renderer reload in the same application session", async () => {
    request.mockResolvedValue(Response.json(stable("v0.3.10")));
    const first = await newSession();
    expect(await first.checkForUpdate()).toMatchObject({ version: "0.3.10" });
    vi.mocked(Date.now).mockReturnValue(now + 7 * 60 * 60 * 1000);
    const reloaded = await newSession(true);
    expect(await reloaded.checkForUpdate()).toBeNull();
    expect(request).toHaveBeenCalledOnce();
  });
});
