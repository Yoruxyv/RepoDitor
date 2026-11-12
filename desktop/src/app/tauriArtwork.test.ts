import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { acquireNativeArtwork } from "./tauriArtwork";

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

describe("native upgrade artwork admission", () => {
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
