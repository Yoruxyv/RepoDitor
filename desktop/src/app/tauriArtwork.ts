/** One cancellable native decoder lane; completed pixels are never cached here. */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type RefObject } from "react";
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
// A validated 2 MiB Items frame has fewer rows than this even at 128 bytes per row.
const REQUEST_LIMITS = { item: 16_384, map: 128, upgrade: 16 };
type ArtworkScope = "item" | "upgrade" | "map";

export function closeNativeArtwork(saveId: string): Promise<void> {
  return invoke<void>("upgrade_artwork_cancel", { saveId }).catch(() => undefined);
}

function artworkScope(token: string | null): ArtworkScope | null {
  if (token?.startsWith("item-artwork:")) return "item";
  if (token?.startsWith("upgrade-artwork:")) return "upgrade";
  if (token?.startsWith("map-artwork:")) return "map";
  return null;
}

function isNativeArtworkToken(token: string): boolean {
  return /^(item|upgrade|map)-artwork:[0-9a-f]{32}$/.test(token);
}

export function useNativeArtwork(
  token: string | null,
  variant: "item" | "upgrade" | "cosmetic" | "map",
  element: RefObject<HTMLSpanElement | null>,
) {
  const scope = artworkScope(token);
  const native = scope !== null;
  const allowed = scope === variant && token !== null && isNativeArtworkToken(token);
  const [resolved, setResolved] = useState<{ token: string; image: NativeArtwork | null } | null>(
    null,
  );
  useEffect(() => {
    if (!token || !allowed) return;
    const receive = (image: NativeArtwork | null) => setResolved({ token, image });
    if (scope === "upgrade" || typeof IntersectionObserver === "undefined")
      return acquireNativeArtwork(token, receive);
    const node = element.current;
    if (!node) return;
    let release: (() => void) | undefined;
    const observer = new IntersectionObserver(([entry]) => {
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
      observer.disconnect();
      release?.();
    };
  }, [allowed, element, scope, token]);
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
    });
}
export function acquireNativeArtwork(
  token: string,
  listener: (image: NativeArtwork | null) => void,
): () => void {
  const scope = artworkScope(token);
  if (
    !scope ||
    !isNativeArtworkToken(token) ||
    (!pending.has(token) && pending.size >= REQUEST_LIMITS[scope])
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
