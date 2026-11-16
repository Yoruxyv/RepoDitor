import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { cosmetics } from "@/test/repoditorApiFixture";
import {
  acquireNativeArtwork,
  cancelEntryArtwork,
  preloadEntryArtwork,
  restoreNativeCosmeticPreviews,
} from "./tauriArtwork";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const token = (n: number) => `upgrade-artwork:${n.toString(16).padStart(32, "0")}`;
const image = (n: number) => ({
  token: token(n),
  revision: "a".repeat(64),
  dataUrl: "data:image/png;base64,AAAA",
});
const flush = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

it("settles a grouped preparation before workspace entry", async () => {
  const first = image(100);
  const second = image(101);
  vi.mocked(invoke)
    .mockReset()
    .mockResolvedValueOnce({ ok: true, data: [first, second] });
  const report = vi.fn();
  try {
    await expect(
      preloadEntryArtwork(
        { upgrade: [first.token, second.token], map: [], item: [first.token] },
        new AbortController().signal,
        report,
      ),
    ).resolves.toMatchObject({
      upgrade: { ready: 2, unavailable: 0, issues: {} },
      item: { ready: 1, unavailable: 0, issues: {} },
    });
    expect(report.mock.calls.map(([progress]) => progress)).toEqual([
      { scope: "upgrade", settled: 0, total: 3 },
      { scope: "upgrade", settled: 1, total: 3 },
      { scope: "upgrade", settled: 2, total: 3 },
      { scope: "map", settled: 2, total: 3 },
      { scope: "item", settled: 3, total: 3 },
      { scope: null, settled: 3, total: 3 },
    ]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("upgrade_artwork_get", {
      tokens: [first.token, second.token],
    });
  } finally {
    cancelEntryArtwork();
  }
});

it("discards pending native artwork after cancellation", async () => {
  const first = image(102);
  const item = token(103).replace("upgrade-", "item-");
  let complete!: (result: unknown) => void;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)))
    .mockResolvedValue({ ok: true, data: null });
  const stop = new AbortController();
  const pending = preloadEntryArtwork(
    { upgrade: [first.token], map: [], item: [item] },
    stop.signal,
    vi.fn(),
  );
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  stop.abort();
  await expect(pending).resolves.toMatchObject({
    upgrade: { ready: 0, issues: { timeout: 1 } },
    item: { ready: 0, issues: { timeout: 1 } },
  });
  expect(invoke).toHaveBeenLastCalledWith("upgrade_artwork_cancel", { token: first.token });
  complete({ ok: true, data: first });
  await flush();
  const receive = vi.fn();
  const release = acquireNativeArtwork(first.token, receive);
  await flush();
  expect(receive).toHaveBeenCalledExactlyOnceWith(null);
  expect(invoke).toHaveBeenCalledTimes(3);
  release();
});

it("checks the first 64 Items in one batch and reports missing, rejected and deferred results", async () => {
  const items = Array.from({ length: 65 }, (_, index) => token(index).replace("upgrade-", "item-"));
  const images = items.slice(0, 64).map((item, index) => ({ ...image(index), token: item }));
  vi.mocked(invoke)
    .mockReset()
    .mockResolvedValue({
      ok: true,
      data: [null, true, false, ...images.slice(3)],
    });
  const report = vi.fn();
  try {
    const results = await preloadEntryArtwork(
      { upgrade: [], map: [], item: items },
      new AbortController().signal,
      report,
    );
    expect(results.item).toEqual({
      ready: 61,
      unavailable: 1,
      issues: { failed: 1, response: 1, limit: 1 },
    });
    expect(report).toHaveBeenLastCalledWith({ scope: null, settled: 64, total: 65 });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("item_artwork_get", {
      tokens: items.slice(0, 64),
    });
  } finally {
    cancelEntryArtwork();
  }
});

describe("native upgrade artwork admission", () => {
  it("reserves the Upgrade queue limit independently of concurrent preloads", async () => {
    let finish!: (result: unknown) => void;
    vi.mocked(invoke)
      .mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue({ ok: true, data: null });
    const map = token(200).replace("upgrade-", "map-");
    const releaseMap = acquireNativeArtwork(map, vi.fn());
    const allowed = Array.from({ length: 16 }, (_, n) =>
      acquireNativeArtwork(token(n + 1), vi.fn()),
    );
    const rejected = vi.fn();
    const releaseRejected = acquireNativeArtwork(token(17), rejected);
    await flush();
    expect(rejected).toHaveBeenCalledExactlyOnceWith(null);
    finish({ ok: true, data: null });
    await flush();
    expect(invoke).toHaveBeenCalledWith("upgrade_artwork_get", { token: token(16) });
    expect(invoke).not.toHaveBeenCalledWith("upgrade_artwork_get", { token: token(17) });
    allowed.forEach((release) => release());
    releaseMap();
    releaseRejected();
  });
  it("deduplicates subscribers, serializes work and never caches completed pixels", async () => {
    const pending: Array<(value: unknown) => void> = [];
    vi.mocked(invoke)
      .mockReset()
      .mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const first = vi.fn();
    const second = vi.fn();
    const next = vi.fn();
    const releaseFirst = acquireNativeArtwork(token(1), first);
    const releaseSecond = acquireNativeArtwork(token(1), second);
    const releaseNext = acquireNativeArtwork(token(2), next);
    expect(invoke).toHaveBeenCalledTimes(1);
    releaseFirst();
    expect(invoke).toHaveBeenCalledTimes(1);
    pending[0]!({ ok: true, data: image(1) });
    await flush();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(image(1));
    expect(invoke).toHaveBeenNthCalledWith(2, "upgrade_artwork_get", { token: token(2) });
    pending[1]!({ ok: true, data: null });
    await flush();
    expect(next).toHaveBeenCalledWith(null);
    releaseSecond();
    releaseNext();
    const releaseAgain = acquireNativeArtwork(token(1), first);
    expect(invoke).toHaveBeenCalledTimes(3);
    pending[2]!({ ok: true, data: null });
    await flush();
    releaseAgain();
    expect(first).toHaveBeenCalledWith(null);
  });
  it("bounds the queue, drops abandoned requests and rejects forged namespaces", async () => {
    let complete!: (value: unknown) => void;
    vi.mocked(invoke)
      .mockReset()
      .mockImplementation((command) =>
        command === "upgrade_artwork_cancel"
          ? Promise.resolve()
          : new Promise((resolve) => {
              complete = resolve;
            }),
      );
    const rejected = vi.fn();
    const releases = Array.from({ length: 16 }, (_, n) =>
      acquireNativeArtwork(token(n + 1), vi.fn()),
    );
    const releaseOverflow = acquireNativeArtwork(token(17), rejected);
    const releaseForged = acquireNativeArtwork("../private/file", rejected);
    await flush();
    expect(rejected).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledTimes(1);
    for (const release of releases) release();
    expect(invoke).toHaveBeenLastCalledWith("upgrade_artwork_cancel", { token: token(1) });
    complete({ ok: true, data: image(1) });
    await flush();
    expect(invoke).toHaveBeenCalledTimes(2);
    releaseOverflow();
    releaseForged();
  });
});

it("keeps Map requests in the shared lane and drops replies after Map cancellation", async () => {
  const map = token(1).replace("upgrade-", "map-");
  let resolveMap!: (response: unknown) => void;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation((command) => {
      if (command === "map_artwork_get")
        return new Promise((resolve) => {
          resolveMap = resolve;
        });
      return Promise.resolve({ ok: true, data: null });
    });
  const abandoned = vi.fn();
  const next = vi.fn();
  const releaseMap = acquireNativeArtwork(map, abandoned);
  const releaseNext = acquireNativeArtwork(token(2), next);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("map_artwork_get", { token: map });
  releaseMap();
  expect(invoke).toHaveBeenLastCalledWith("map_artwork_cancel", { token: map });
  resolveMap({ ok: true, data: { ...image(1), token: map } });
  await flush();
  expect(abandoned).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenLastCalledWith("upgrade_artwork_get", { token: token(2) });
  expect(next).toHaveBeenCalledWith(null);
  releaseNext();
});

it("keeps visible Cosmetics queued behind other domains without losing their slots", async () => {
  let finishUpgrade!: (response: unknown) => void;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation((command) => {
      if (command === "upgrade_artwork_get") {
        return new Promise((resolve) => {
          finishUpgrade = resolve;
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });
  const releaseUpgrade = acquireNativeArtwork(token(1), vi.fn());
  const receivers = Array.from({ length: 40 }, () => vi.fn());
  const releases = receivers.map((receive, index) =>
    acquireNativeArtwork(token(index + 1).replace("upgrade-", "cosmetic-"), receive),
  );
  await flush();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(receivers.every((receiver) => receiver.mock.calls.length === 0)).toBe(true);
  releases[10]!();
  finishUpgrade({ ok: true, data: null });
  await flush();
  expect(invoke).toHaveBeenCalledTimes(40);
  expect(receivers[10]).not.toHaveBeenCalled();
  expect(receivers[39]).toHaveBeenCalledExactlyOnceWith(null);
  releaseUpgrade();
  releases.forEach((release) => release());
});

it("uses the current viewport to prioritize queued Cosmetics without crossing other domains", async () => {
  const cosmeticToken = (id: number) => token(id).replace("upgrade-", "cosmetic-");
  const completions: Array<(response: unknown) => void> = [];
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(() => new Promise((resolve) => completions.push(resolve)));
  const midpoint = window.innerHeight / 2;
  const card = (top: () => number) => {
    const node = document.createElement("span");
    document.body.append(node);
    vi.spyOn(node, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, top(), 48, 48));
    return node;
  };
  let scrolled = false;
  const first = card(() => midpoint - (scrolled ? 160 : 24));
  const second = card(() => midpoint - (scrolled ? 24 : 160));
  const afterUpgrade = card(() => midpoint - 24);
  const releases = [
    acquireNativeArtwork(cosmeticToken(1), vi.fn()),
    acquireNativeArtwork(cosmeticToken(2), vi.fn(), undefined, first),
    acquireNativeArtwork(cosmeticToken(3), vi.fn(), undefined, second),
    acquireNativeArtwork(token(4), vi.fn()),
    acquireNativeArtwork(cosmeticToken(5), vi.fn(), undefined, afterUpgrade),
  ];
  expect(invoke).toHaveBeenCalledExactlyOnceWith("cosmetic_artwork_get", {
    token: cosmeticToken(1),
  });
  scrolled = true;
  for (const [index, [command, args]] of [
    ["cosmetic_artwork_get", { tokens: [cosmeticToken(3), cosmeticToken(2)] }],
    ["upgrade_artwork_get", { token: token(4) }],
    ["cosmetic_artwork_get", { token: cosmeticToken(5) }],
  ].entries()) {
    completions[index]!({ ok: true, data: null });
    await vi.waitFor(() => expect(invoke).toHaveBeenLastCalledWith(command, args));
  }
  completions[3]!({ ok: true, data: null });
  await flush();
  releases.forEach((release) => release());
  [first, second, afterUpgrade].forEach((node) => node.remove());
});

it("bounds visible batches, drops cancelled replies, and defers oversized images behind queued work", async () => {
  const tokens = Array.from({ length: 5 }, (_, i) => token(i + 1).replace("upgrade-", "cosmetic-"));
  const cards = tokens.map(() => document.body.appendChild(document.createElement("span")));
  const listeners = tokens.map(() => vi.fn());
  const resolveImages: Array<(reply: unknown) => void> = [];
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation((command) =>
      command.endsWith("_cancel")
        ? Promise.resolve()
        : new Promise((resolve) => resolveImages.push(resolve)),
    );
  const release = tokens.map((id, i) =>
    acquireNativeArtwork(id, listeners[i]!, undefined, cards[i]),
  );
  await vi.waitFor(() => expect(resolveImages).toHaveLength(1));
  expect(invoke).toHaveBeenCalledExactlyOnceWith("cosmetic_artwork_get", {
    tokens: tokens.slice(0, 4),
  });
  release[1]!();
  expect(invoke).toHaveBeenLastCalledWith("cosmetic_artwork_cancel", { token: tokens[1] });
  const good = { ...image(1), token: tokens[0] };
  resolveImages[0]!({ ok: true, data: [good, { ...good, token: tokens[1] }, good, false] });
  await vi.waitFor(() => expect(resolveImages).toHaveLength(2));
  expect(listeners[0]).toHaveBeenCalledExactlyOnceWith(good);
  expect(listeners[1]).not.toHaveBeenCalled();
  expect(listeners[2]).toHaveBeenCalledExactlyOnceWith(null);
  expect(listeners[3]).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenLastCalledWith("cosmetic_artwork_get", { token: tokens[4] });
  resolveImages[1]!({ ok: true, data: null });
  await vi.waitFor(() => expect(resolveImages).toHaveLength(3));
  expect(invoke).toHaveBeenLastCalledWith("cosmetic_artwork_get", { token: tokens[3] });
  resolveImages[2]!({ ok: true, data: false });
  await flush();
  expect(listeners[3]).toHaveBeenCalledExactlyOnceWith(null);
  expect(resolveImages).toHaveLength(3);
  release.forEach((done) => done());
  cards.forEach((node) => node.remove());
});

it("reuses only completed Cosmetics thumbnails with the same validated source and PNG key", async () => {
  const first = token(51).replace("upgrade-", "cosmetic-");
  const next = token(52).replace("upgrade-", "cosmetic-");
  const last = token(53).replace("upgrade-", "cosmetic-");
  const prefix = `${"b".repeat(64)}:51:${"a".repeat(64)}:`;
  const key = prefix + "c".repeat(64);
  const changedKey = prefix + "d".repeat(64);
  const responses: Array<(value: unknown) => void> = [];
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation((command) =>
      command === "cosmetic_artwork_get"
        ? new Promise((resolve) => responses.push(resolve))
        : Promise.resolve(),
    );
  const abandoned = vi.fn();
  const releaseAbandoned = acquireNativeArtwork(first, abandoned, key);
  releaseAbandoned();
  responses[0]!({ ok: true, data: { ...image(51), token: first } });
  await flush();
  expect(abandoned).not.toHaveBeenCalled();

  const receive = vi.fn();
  const release = acquireNativeArtwork(next, receive, key);
  const releaseOverlap = acquireNativeArtwork(next, vi.fn(), key);
  expect(responses).toHaveLength(2);
  responses[1]!({ ok: true, data: { ...image(52), token: next } });
  await flush();
  expect(receive).toHaveBeenCalledExactlyOnceWith({ ...image(52), token: next });
  release();
  releaseOverlap();
  receive.mockClear();
  acquireNativeArtwork(last, receive, key)();
  expect(receive).toHaveBeenCalledExactlyOnceWith({ ...image(52), token: last });
  expect(responses).toHaveLength(2);

  const releaseChanged = acquireNativeArtwork(last, receive, changedKey);
  expect(responses).toHaveLength(3);
  responses[2]!({ ok: true, data: null });
  await flush();
  releaseChanged();
  const releaseRetry = acquireNativeArtwork(last, receive, changedKey);
  expect(responses).toHaveLength(4);
  responses[3]!({ ok: true, data: { ...image(53), token: last } });
  await flush();
  releaseRetry();
});

it("restores a warm thumbnail through the bounded lane only for its current key and token", async () => {
  const current = token(61).replace("upgrade-", "cosmetic-");
  const wrong = token(62).replace("upgrade-", "cosmetic-");
  const key = `${"b".repeat(64)}:0:${"a".repeat(64)}:${"e".repeat(64)}`;
  const row = { ...cosmetics.cosmetics[0]!, iconToken: current, iconReuseKey: key };
  const preview = { ...image(61), token: current };
  const restored = restoreNativeCosmeticPreviews({
    ...cosmetics,
    cosmetics: [{ ...row, iconPreview: preview }],
  });
  expect(restored.cosmetics).toEqual([row]);
  vi.mocked(invoke).mockReset().mockResolvedValue({ ok: true, data: null });
  const receive = vi.fn();
  acquireNativeArtwork(current, receive, key)();
  expect(receive).toHaveBeenCalledExactlyOnceWith(preview);
  expect(invoke).not.toHaveBeenCalled();

  const changedKey = key.slice(0, -1) + "f";
  restoreNativeCosmeticPreviews({
    ...cosmetics,
    cosmetics: [{ ...row, iconReuseKey: changedKey, iconPreview: { ...preview, token: wrong } }],
  });
  const release = acquireNativeArtwork(current, receive, changedKey);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("cosmetic_artwork_get", { token: current });
  await flush();
  expect(receive).toHaveBeenLastCalledWith(null);
  release();
});
