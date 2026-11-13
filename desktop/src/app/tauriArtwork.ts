/** One cancellable native decoder lane; completed pixels are never cached here. */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import type { DesktopOperationResult } from "@electron/contracts";

export interface NativeArtwork {
  readonly token: string;
  readonly revision: string;
  readonly dataUrl: string;
}
interface Request {
  readonly token: string;
  readonly scope: ArtworkScope;
  readonly listeners: Set<(image: NativeArtwork | null) => void>;
  settled: boolean;
  cancellation: Promise<unknown> | null;
}
const pending = new Map<string, Request>();
const queue: Request[] = [];
let active: Request | null = null;
const activityListeners = new Set<() => void>();
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
  return useSyncExternalStore(subscribeActivity, () => active?.scope === "cosmetic");
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
        release ??= acquireNativeArtwork(token, (image) => {
          if (!image) observer.disconnect();
          receive(image);
        });
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
  }, [allowed, element, hasObserver, scope, token]);
  const current = resolved && token && resolved.token === token ? resolved : null;
  return {
    native,
    image: current?.image ?? null,
    unavailable: native && (!allowed || current?.image === null),
  };
}
function validImage(image: NativeArtwork | null, token: string): boolean {
  return (
    image !== null &&
    image.token === token &&
    /^[0-9a-f]{64}$/.test(image.revision) &&
    image.dataUrl.length <= 1_398_126 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl)
  );
}
function pump(): void {
  if (active !== null) return;
  const request = queue.shift();
  if (!request) return;
  active = request;
  if (request.scope === "cosmetic") {
    for (const listener of activityListeners) listener();
  }
  void invoke<DesktopOperationResult<NativeArtwork | null>>(`${request.scope}_artwork_get`, {
    token: request.token,
  })
    .then((result) => {
      request.settled = true;
      const image = result.ok && validImage(result.data, request.token) ? result.data : null;
      for (const listener of request.listeners) listener(image);
    })
    .catch(() => {
      request.settled = true;
      for (const listener of request.listeners) listener(null);
    })
    .finally(async () => {
      await request.cancellation;
      if (pending.get(request.token) === request) pending.delete(request.token);
      active = null;
      pump();
      if (request.scope === "cosmetic") {
        for (const listener of activityListeners) listener();
      }
    });
}
export function acquireNativeArtwork(
  token: string,
  listener: (image: NativeArtwork | null) => void,
): () => void {
  const scope = artworkScope(token);
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
    request = { token, scope, listeners: new Set(), settled: false, cancellation: null };
    pending.set(token, request);
    queue.push(request);
  }
  const owned = request;
  owned.listeners.add(listener);
  pump();
  return () => {
    owned.listeners.delete(listener);
    if (owned.listeners.size > 0) return;
    if (active === owned && !owned.settled) {
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
