/** One cancellable native decoder lane and bounded Cosmetics thumbnail reuse. */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import type { CosmeticsViewDto, DesktopOperationResult } from "@electron/contracts";

export interface NativeArtwork {
  readonly token: string;
  readonly revision: string;
  readonly dataUrl: string;
}
interface Request {
  readonly token: string;
  readonly scope: ArtworkScope;
  readonly reuseKey: string | undefined;
  readonly element: HTMLSpanElement | undefined;
  readonly listeners: Set<(image: NativeArtwork | null) => void>;
  settled: boolean;
  singleOnly: boolean;
  cancellation: Promise<unknown> | null;
}
const pending = new Map<string, Request>();
const queue: Request[] = [];
let active: Request[] = [];
let scheduled = false;
const MAX_COSMETIC_BATCH = 4;
const activityListeners = new Set<() => void>();
// At most 12 MiB of string storage even with two bytes per base64 character.
const cosmeticThumbnails = new Map<string, NativeArtwork>();
const MAX_REUSED_THUMBNAILS = 24;
const MAX_REUSED_DATA_URL = 256 * 1024;
// A validated 2 MiB Items frame has fewer rows than this even at 128 bytes per row.
const REQUEST_LIMITS = { item: 16_384, map: 128, upgrade: 16, cosmetic: 2_000 };
type ArtworkScope = keyof typeof REQUEST_LIMITS;

function subscribeActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}

export function useCosmeticArtworkActivity(): boolean {
  return useSyncExternalStore(subscribeActivity, () => active[0]?.scope === "cosmetic");
}

export function closeNativeArtwork(saveId: string): Promise<void> {
  return invoke<void>("upgrade_artwork_cancel", { saveId }).catch(() => undefined);
}

export function closeNativeCosmeticArtwork(): void {
  void invoke<void>("cosmetic_artwork_cancel").catch(() => undefined);
}

function artworkScope(token: string | null): ArtworkScope | null {
  if (token?.startsWith("item-artwork:")) return "item";
  if (token?.startsWith("upgrade-artwork:")) return "upgrade";
  if (token?.startsWith("map-artwork:")) return "map";
  if (token?.startsWith("cosmetic-artwork:")) return "cosmetic";
  return null;
}

function isNativeArtworkToken(token: string): boolean {
  return /^(item|upgrade|map|cosmetic)-artwork:[0-9a-f]{32}$/.test(token);
}

export function useNativeArtwork(
  token: string | null,
  variant: "item" | "upgrade" | "cosmetic" | "map",
  element: RefObject<HTMLSpanElement | null>,
  reuseKey?: string,
) {
  const scope = artworkScope(token);
  const native = scope !== null;
  const hasObserver = typeof IntersectionObserver !== "undefined";
  const allowed =
    scope === variant &&
    token !== null &&
    isNativeArtworkToken(token) &&
    (scope !== "cosmetic" || hasObserver);
  const [resolved, setResolved] = useState<{ token: string; image: NativeArtwork | null } | null>(
    null,
  );
  useEffect(() => {
    if (!token || !allowed) return;
    const receive = (image: NativeArtwork | null) => setResolved({ token, image });
    if (scope === "upgrade" || !hasObserver) return acquireNativeArtwork(token, receive);
    const node = element.current;
    if (!node) return;
    let release: (() => void) | undefined;
    let observing = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (!observing) return;
      if (entry?.isIntersecting) {
        release ??= acquireNativeArtwork(
          token,
          (image) => {
            if (!image) observer.disconnect();
            receive(image);
          },
          reuseKey,
          scope === "cosmetic" ? node : undefined,
        );
      } else if (release) {
        release();
        release = undefined;
        setResolved(null);
      }
    });
    observer.observe(node);
    return () => {
      observing = false;
      observer.disconnect();
      release?.();
    };
  }, [allowed, element, hasObserver, reuseKey, scope, token]);
  const current = resolved && token && resolved.token === token ? resolved : null;
  return {
    native,
    image: current?.image ?? null,
    unavailable: native && (!allowed || current?.image === null),
  };
}
function validImage(image: unknown, token: string): image is NativeArtwork {
  if (!image || typeof image !== "object") return false;
  const { token: reply, revision, dataUrl } = image as Partial<NativeArtwork>;
  return (
    reply === token &&
    typeof revision === "string" &&
    /^[0-9a-f]{64}$/.test(revision) &&
    typeof dataUrl === "string" &&
    dataUrl.length <= 1_398_126 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)
  );
}

function cosmeticReuseKey(token: string, reuseKey?: string) {
  return artworkScope(token) === "cosmetic" &&
    isNativeArtworkToken(token) &&
    /^[0-9a-f]{64}:\d{1,4}:[0-9a-f]{64}:[0-9a-f]{64}$/.test(reuseKey ?? "")
    ? reuseKey
    : undefined;
}

function retainCosmeticThumbnail(key: string, image: NativeArtwork) {
  if (image.dataUrl.length > MAX_REUSED_DATA_URL) return;
  cosmeticThumbnails.set(key, image);
  if (cosmeticThumbnails.size > MAX_REUSED_THUMBNAILS) {
    const oldest = cosmeticThumbnails.keys().next().value!;
    cosmeticThumbnails.delete(oldest);
  }
}

export function restoreNativeCosmeticPreviews(view: CosmeticsViewDto): CosmeticsViewDto {
  if (!view.cosmetics.some((row) => row.iconPreview)) return view;
  return {
    ...view,
    cosmetics: view.cosmetics.map(({ iconPreview, ...row }) => {
      if (row.iconToken && iconPreview && validImage(iconPreview, row.iconToken)) {
        const key = cosmeticReuseKey(row.iconToken, row.iconReuseKey);
        if (key) retainCosmeticThumbnail(key, iconPreview);
      }
      return row;
    }),
  };
}

function batchable(request: Request | undefined): boolean {
  return !!request?.element && !request.singleOnly;
}

function takeNext(): Request | undefined {
  let index = 0;
  const first = queue[0]?.element;
  if (first && batchable(queue[0])) {
    // Scroll can change which cards are central while the native decoder is busy.
    const viewportCenter = window.innerHeight / 2;
    const distance = (node: HTMLSpanElement) => {
      if (!node.isConnected) return Infinity;
      const { top, height } = node.getBoundingClientRect();
      return Math.abs(top + height / 2 - viewportCenter);
    };
    let nearest = distance(first);
    for (let i = 1; i < queue.length; i++) {
      const candidate = queue[i]?.element;
      if (!candidate || !batchable(queue[i])) break;
      const candidateDistance = distance(candidate);
      if (candidateDistance < nearest) {
        index = i;
        nearest = candidateDistance;
      }
    }
  }
  return queue.splice(index, 1)[0];
}

function pump(): void {
  if (active.length || scheduled || !queue.length) return;
  if (batchable(queue[0])) {
    // Collect the visible observer callbacks from this turn before choosing up to four cards.
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      startNext();
    }, 0);
  } else {
    startNext();
  }
}

function startNext(): void {
  const collect = batchable(queue[0]);
  const request = takeNext();
  if (!request) return;
  const requests = [request];
  while (collect && requests.length < MAX_COSMETIC_BATCH && batchable(queue[0])) {
    requests.push(takeNext()!);
  }
  active = requests;
  if (request.scope === "cosmetic") {
    for (const listener of activityListeners) listener();
  }
  void runRequests(request, requests);
}

function settleImage(request: Request, value: unknown, batch: boolean): boolean {
  request.settled = true;
  if (batch && value === false) return false;
  const image = validImage(value, request.token) ? value : null;
  if (image && request.reuseKey && request.listeners.size > 0) {
    retainCosmeticThumbnail(request.reuseKey, image);
  }
  for (const listener of request.listeners) listener(image);
  return true;
}

function finishRequests(requests: Request[], deferred: Request[]): void {
  for (const request of requests) {
    if (pending.get(request.token) !== request) continue;
    if (deferred.includes(request) && request.listeners.size > 0) {
      request.singleOnly = true;
      request.settled = false;
      queue.push(request);
    } else {
      pending.delete(request.token);
    }
  }
}

async function runRequests(first: Request, requests: Request[]): Promise<void> {
  const batch = requests.length > 1;
  const result = await invoke<DesktopOperationResult<unknown>>(
    `${first.scope}_artwork_get`,
    batch ? { tokens: requests.map(({ token }) => token) } : { token: first.token },
  ).catch(() => null);
  const data = result?.ok ? result.data : null;
  const replies = batch ? data : [data];
  const images: unknown[] =
    Array.isArray(replies) && replies.length === requests.length ? replies : [];
  const deferred: Request[] = [];
  try {
    for (const [index, request] of requests.entries()) {
      if (!settleImage(request, images[index], batch)) deferred.push(request);
    }
  } finally {
    await Promise.all(requests.map(({ cancellation }) => cancellation));
    finishRequests(requests, deferred);
    active = [];
    pump();
    if (first.scope === "cosmetic") {
      for (const listener of activityListeners) listener();
    }
  }
}
export function acquireNativeArtwork(
  token: string,
  listener: (image: NativeArtwork | null) => void,
  reuseKey?: string,
  element?: HTMLSpanElement,
): () => void {
  const scope = artworkScope(token);
  const key = cosmeticReuseKey(token, reuseKey);
  if (key) {
    const image = cosmeticThumbnails.get(key);
    if (image) {
      cosmeticThumbnails.delete(key);
      cosmeticThumbnails.set(key, image);
      listener({ ...image, token });
      return () => undefined;
    }
  }
  // One visible catalog can subscribe to at most the verified catalog bound. Abandoned requests
  // and other scopes cannot use up those places while the shared decoder finishes cancelling.
  const queued =
    scope === "cosmetic"
      ? Array.from(pending.values()).filter(
          (request) => request.scope === scope && request.listeners.size > 0,
        ).length
      : pending.size;
  if (
    !scope ||
    !isNativeArtworkToken(token) ||
    (!pending.has(token) && queued >= REQUEST_LIMITS[scope])
  ) {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) listener(null);
    });
    return () => {
      cancelled = true;
    };
  }
  let request = pending.get(token);
  if (!request || request.listeners.size === 0) {
    request = {
      token,
      scope,
      reuseKey: key,
      element: scope === "cosmetic" ? element : undefined,
      listeners: new Set(),
      settled: false,
      singleOnly: false,
      cancellation: null,
    };
    pending.set(token, request);
    queue.push(request);
  }
  const owned = request;
  owned.listeners.add(listener);
  pump();
  return () => {
    owned.listeners.delete(listener);
    if (owned.listeners.size > 0) return;
    if (active.includes(owned) && !owned.settled) {
      owned.cancellation ??= invoke(`${owned.scope}_artwork_cancel`, { token }).catch(
        () => undefined,
      );
    } else {
      const index = queue.indexOf(owned);
      if (index >= 0) queue.splice(index, 1);
      if (pending.get(token) === owned) pending.delete(token);
    }
  };
}
