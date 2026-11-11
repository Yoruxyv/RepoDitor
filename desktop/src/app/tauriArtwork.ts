/** One cancellable native decoder lane; completed pixels are never cached here. */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { DesktopOperationResult } from "@electron/contracts";

export interface NativeArtwork {
  readonly token: string;
  readonly revision: string;
  readonly dataUrl: string;
}
interface Request {
  readonly token: string;
  readonly listeners: Set<(image: NativeArtwork | null) => void>;
  settled: boolean;
  cancellation: Promise<unknown> | null;
}
const pending = new Map<string, Request>();
const queue: Request[] = [];
let active: Request | null = null;

export function closeNativeArtwork(saveId: string): Promise<void> {
  return invoke<void>("upgrade_artwork_cancel", { saveId }).catch(() => undefined);
}

export function isNativeArtworkToken(token: string): boolean {
  return /^upgrade-artwork:[0-9a-f]{32}$/.test(token);
}

export function useNativeArtwork(token: string | null, enabled: boolean) {
  const native = token?.startsWith("upgrade-artwork:") ?? false;
  const allowed = enabled && token !== null && isNativeArtworkToken(token);
  const [resolved, setResolved] = useState<{ token: string; image: NativeArtwork | null } | null>(
    null,
  );
  useEffect(() => {
    if (token && allowed)
      return acquireNativeArtwork(token, (image) => setResolved({ token, image }));
  }, [allowed, token]);
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
  void invoke<DesktopOperationResult<NativeArtwork | null>>("upgrade_artwork_get", {
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
  if (!isNativeArtworkToken(token) || (!pending.has(token) && pending.size >= 16)) {
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
    request = { token, listeners: new Set(), settled: false, cancellation: null };
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
      owned.cancellation ??= invoke("upgrade_artwork_cancel", { token }).catch(() => undefined);
    } else {
      const index = queue.indexOf(owned);
      if (index >= 0) queue.splice(index, 1);
      if (pending.get(token) === owned) pending.delete(token);
    }
  };
}
