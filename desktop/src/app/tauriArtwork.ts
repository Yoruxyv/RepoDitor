/** One cancellable native decoder lane with bounded artwork groups and Cosmetics reuse. */
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
  readonly allowBatch: boolean;
  readonly listeners: Set<(image: NativeArtwork | null, issue?: ArtworkIssue) => void>;
  settled: boolean;
  singleOnly: boolean;
  cancellation: Promise<unknown> | null;
  prefetchOnly: boolean;
}
const pending = new Map<string, Request>();
const queue: Request[] = [];
let active: Request[] = [];
let scheduled = false;
const MAX_ARTWORK_BATCH = 4;
const activityListeners = new Set<() => void>();
// At most 12 MiB of string storage even with two bytes per base64 character.
const cosmeticThumbnails = new Map<string, NativeArtwork>();
const MAX_REUSED_THUMBNAILS = 24;
const MAX_REUSED_DATA_URL = 256 * 1024;
const entryArtwork = {
  upgrade: new Map<string, NativeArtwork | null>(),
  map: new Map<string, NativeArtwork | null>(),
  item: new Map<string, NativeArtwork | null>(),
};
let entryWork: AbortController | null = null;
let entryBytes = 0;
let retainedEntry: {
  key: string;
  plan: EntryArtworkPlan;
  images: Record<EntryArtworkScope, Map<string, NativeArtwork | null>>;
  results: EntryArtworkResults;
  bytes: number;
} | null = null;
// A validated 2 MiB Items frame has fewer rows than this even at 128 bytes per row.
const REQUEST_LIMITS = { item: 16_384, map: 128, upgrade: 16, cosmetic: 2_000 };
type ArtworkScope = keyof typeof REQUEST_LIMITS;
export const ENTRY_ARTWORK_SCOPES = ["upgrade", "map", "item"] as const;
export type EntryArtworkScope = (typeof ENTRY_ARTWORK_SCOPES)[number];
type EntryArtworkPlan = Readonly<Record<EntryArtworkScope, readonly (string | null)[]>>;
type ArtworkIssue = "limit" | "memory" | "response" | "timeout" | "failed";
export type EntryArtworkResults = Record<
  EntryArtworkScope,
  {
    ready: number;
    unavailable: number;
    issues: Partial<Record<ArtworkIssue, number>>;
  }
>;
export interface EntryArtworkProgress {
  readonly scope: EntryArtworkScope | null;
  readonly settled: number;
  readonly total: number;
}
const ENTRY_ARTWORK_LIMIT = { upgrade: 16, map: 5, item: 64 };
const ENTRY_ARTWORK_BATCH = { ...ENTRY_ARTWORK_LIMIT, cosmetic: MAX_ARTWORK_BATCH };

function subscribeActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
  };
}

export function useCosmeticArtworkActivity(): boolean {
  return useSyncExternalStore(subscribeActivity, () => active[0]?.scope === "cosmetic");
}

export function cancelEntryArtwork(): void {
  entryWork?.abort();
  clearEntryArtwork();
}

export function clearEntryArtwork(scope?: EntryArtworkScope): void {
  let changed = false;
  for (const kind of scope ? [scope] : ENTRY_ARTWORK_SCOPES) {
    if (entryArtwork[kind].size === 0) continue;
    entryArtwork[kind].clear();
    changed = true;
  }
  if (!scope) entryBytes = 0;
  if (changed) for (const listener of activityListeners) listener();
}

export function rememberEntryArtwork(
  key: string,
  plan: EntryArtworkPlan,
  results: EntryArtworkResults,
): void {
  retainedEntry = {
    key,
    plan,
    results,
    bytes: entryBytes,
    images: {
      upgrade: new Map(entryArtwork.upgrade),
      map: new Map(entryArtwork.map),
      item: new Map(entryArtwork.item),
    },
  };
}

export function restoreEntryArtwork(key: string | null, plan: EntryArtworkPlan) {
  cancelEntryArtwork();
  const previous = retainedEntry;
  retainedEntry = null;
  if (key === null || previous?.key !== key) return null;
  for (const scope of ENTRY_ARTWORK_SCOPES) {
    if (
      previous.plan[scope].length !== plan[scope].length ||
      plan[scope].some(
        (token, i) => artworkScope(token) !== artworkScope(previous.plan[scope][i] ?? null),
      )
    )
      return null;
  }
  for (const scope of ENTRY_ARTWORK_SCOPES) {
    for (const [i, token] of plan[scope].entries()) {
      const priorToken = previous.plan[scope][i];
      if (token === null || typeof priorToken !== "string") continue;
      const image = previous.images[scope].get(priorToken);
      if (image !== undefined) entryArtwork[scope].set(token, image && { ...image, token });
    }
  }
  entryBytes = previous.bytes;
  return previous.results;
}

export async function closeNativeWorkspace(saveId: string): Promise<boolean> {
  try {
    await invoke<void>("upgrade_artwork_cancel", { saveId });
    return true;
  } catch {
    return false;
  }
}

function reuseUpgradeItemArtwork(tokens: readonly string[], result: EntryArtworkResults["item"]) {
  for (const token of tokens) {
    const image = entryArtwork.upgrade.get(token);
    if (image === undefined) recordIssue(result, "failed");
    else {
      entryArtwork.item.set(token, image);
      if (image === null) result.unavailable += 1;
      else result.ready += 1;
    }
  }
}

export async function preloadEntryArtwork(
  plan: EntryArtworkPlan,
  stop: AbortSignal,
  report: (progress: EntryArtworkProgress) => void,
): Promise<EntryArtworkResults> {
  cancelEntryArtwork();
  const work = new AbortController();
  entryWork = work;
  const signal = AbortSignal.any([work.signal, stop, AbortSignal.timeout(45_000)]);
  const emptyResult = () => ({ ready: 0, unavailable: 0, issues: {} });
  const results: EntryArtworkResults = {
    upgrade: emptyResult(),
    map: emptyResult(),
    item: emptyResult(),
  };
  const groups = ENTRY_ARTWORK_SCOPES.map((scope) => {
    const tokens = plan[scope];
    const unique = [...new Set(tokens)].filter((token): token is string => token !== null);
    const aliases =
      scope === "item" ? unique.filter((token) => artworkScope(token) === "upgrade") : [];
    const admitted = unique.filter(
      (token) => isNativeArtworkToken(token) && artworkScope(token) === scope,
    );
    return {
      scope,
      aliases,
      admitted,
      unavailable: tokens.filter((token) => token === null).length,
    };
  });
  const total = groups.reduce(
    (count, group) => count + group.admitted.length + group.aliases.length + group.unavailable,
    0,
  );
  let settled = 0;
  try {
    for (const { scope, admitted, aliases, unavailable } of groups) {
      if (work.signal.aborted) break;
      const result = results[scope];
      result.unavailable = unavailable;
      reuseUpgradeItemArtwork(aliases, result);
      const limit = ENTRY_ARTWORK_LIMIT[scope];
      if (admitted.length > limit) result.issues.limit = admitted.length - limit;
      let groupSettled = 0;
      await prepareEntryGroup(scope, admitted.slice(0, limit), result, signal, (count) => {
        groupSettled = count;
        report({ scope, settled: settled + count, total });
      });
      settled += groupSettled;
    }
    return results;
  } finally {
    if (entryWork === work) entryWork = null;
    report({ scope: null, settled, total });
  }
}

function recordIssue(
  result: EntryArtworkResults[EntryArtworkScope],
  issue: ArtworkIssue,
  count = 1,
) {
  result.issues[issue] = (result.issues[issue] ?? 0) + count;
}

async function retainEntryImage(
  scope: EntryArtworkScope,
  token: string,
  image: NativeArtwork | null,
  signal: AbortSignal,
) {
  if (entryBytes + (image?.dataUrl.length ?? 0) > 16 * 1024 * 1024) return "memory";
  if (image) {
    const preview = new Image();
    if (typeof preview.decode === "function") {
      preview.src = image.dataUrl;
      try {
        await preview.decode();
      } catch {
        return "failed";
      }
    }
  }
  if (signal.aborted) return "timeout";
  const length = image?.dataUrl.length ?? 0;
  if (entryBytes + length > 16 * 1024 * 1024) return "memory";
  entryArtwork[scope].set(token, image);
  entryBytes += length;
}

async function prepareEntryGroup(
  scope: EntryArtworkScope,
  tokens: readonly string[],
  result: EntryArtworkResults[EntryArtworkScope],
  signal: AbortSignal,
  report: (settled: number) => void,
): Promise<void> {
  let settled = result.ready + result.unavailable;
  const total = tokens.length + settled;
  report(settled);
  if (!tokens.length) return;
  if (signal.aborted) {
    recordIssue(result, "timeout", tokens.length);
    return;
  }
  const releases: (() => void)[] = [];
  let decoding = Promise.resolve();
  await new Promise<void>((resolve) => {
    function finish() {
      signal.removeEventListener("abort", finish);
      for (const release of releases) release();
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
    for (const token of tokens) {
      const receive = async (image: NativeArtwork | null, issue?: ArtworkIssue) => {
        if (signal.aborted) return;
        const problem = issue ?? (await retainEntryImage(scope, token, image, signal));
        if (signal.aborted) return;
        if (problem) recordIssue(result, problem);
        else if (image) result.ready += 1;
        else result.unavailable += 1;
        settled += 1;
        report(settled);
        if (settled === total) finish();
      };
      releases.push(
        acquireNativeArtwork(
          token,
          (image, issue) => {
            decoding = decoding.then(() => receive(image, issue));
          },
          undefined,
          undefined,
          true,
        ),
      );
    }
  });
  if (settled < total) recordIssue(result, "timeout", total - settled);
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
  upgradeItem = false,
) {
  const scope = artworkScope(token);
  const native = scope !== null;
  const hasObserver = typeof IntersectionObserver !== "undefined";
  const allowed =
    (scope === variant || (scope === "upgrade" && variant === "item" && upgradeItem)) &&
    token !== null &&
    isNativeArtworkToken(token) &&
    (scope !== "cosmetic" || hasObserver);
  const prepared = useSyncExternalStore(subscribeActivity, () =>
    allowed && variant !== "cosmetic" ? entryArtwork[variant].get(token) : undefined,
  );
  const [resolved, setResolved] = useState<{ token: string; image: NativeArtwork | null } | null>(
    null,
  );
  useEffect(() => {
    if (!token || !allowed || prepared !== undefined) return;
    const receive = (image: NativeArtwork | null) => setResolved({ token, image });
    if (variant === "upgrade" || scope === "map" || !hasObserver) {
      return acquireNativeArtwork(token, receive, undefined, element.current ?? undefined);
    }
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
          node,
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
  }, [allowed, element, hasObserver, prepared, reuseKey, scope, token, variant]);
  const current = resolved && token && resolved.token === token ? resolved : null;
  return {
    native,
    image: prepared === undefined ? (current?.image ?? null) : prepared,
    prepared: prepared != null,
    unavailable:
      native &&
      (!allowed || prepared === null || (prepared === undefined && current?.image === null)),
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

function batchable(request: Request | undefined, scope = request?.scope): boolean {
  return (
    request !== undefined && request.scope === scope && !request.singleOnly && request.allowBatch
  );
}

function takeNext(): Request | undefined {
  let index = 0;
  const first = queue[0]?.element;
  if (first && batchable(queue[0], "cosmetic")) {
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
      if (!candidate || !batchable(queue[i], "cosmetic")) break;
      const candidateDistance = distance(candidate);
      if (candidateDistance < nearest) {
        index = i;
        nearest = candidateDistance;
      }
    }
  }
  return queue.splice(index, 1)[0];
}

function prioritize(request: Request): void {
  const index = queue.indexOf(request);
  if (index < 0) return;
  queue.splice(index, 1);
  const background = queue.findIndex((candidate) => candidate.prefetchOnly);
  if (background < 0) queue.push(request);
  else queue.splice(background, 0, request);
}

function pump(): void {
  if (active.length || scheduled || !queue.length) return;
  if (batchable(queue[0])) {
    // Collect cards from this turn before dispatching the group.
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
  const limit =
    request.prefetchOnly || request.scope === "map"
      ? ENTRY_ARTWORK_BATCH[request.scope]
      : MAX_ARTWORK_BATCH;
  while (collect && requests.length < limit && batchable(queue[0], request.scope)) {
    requests.push(takeNext()!);
  }
  active = requests;
  if (request.scope === "cosmetic") {
    for (const listener of activityListeners) listener();
  }
  void runRequests(request, requests);
}

function settleImage(
  request: Request,
  value: unknown,
  batch: boolean,
  issue?: ArtworkIssue,
): boolean {
  request.settled = true;
  if (batch && value === false) {
    if (!request.prefetchOnly || request.scope !== "item") return false;
    issue = "response";
  }
  const image = validImage(value, request.token) ? value : null;
  if (image && request.reuseKey && request.listeners.size > 0) {
    retainCosmeticThumbnail(request.reuseKey, image);
  }
  for (const listener of request.listeners) {
    const problem = issue ?? (value !== null && image === null ? "failed" : undefined);
    if (problem && request.prefetchOnly) listener(null, problem);
    else listener(image);
  }
  return true;
}

function finishRequests(requests: Request[], deferred: Request[]): void {
  for (const request of requests) {
    if (pending.get(request.token) !== request) continue;
    if (deferred.includes(request) && request.listeners.size > 0) {
      request.singleOnly = true;
      request.settled = false;
      queue.push(request);
      if (!request.prefetchOnly) prioritize(request);
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
  const failure =
    result?.ok === false && result.error.code === "process_timeout" ? "timeout" : "failed";
  const issue = result?.ok && images.length ? undefined : failure;
  try {
    for (const [index, request] of requests.entries()) {
      if (!settleImage(request, images[index], batch, issue)) deferred.push(request);
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
function scopeQueueFull(scope: ArtworkScope): boolean {
  // Other workspaces' preloads must leave each scope's slots available.
  const limit = REQUEST_LIMITS[scope];
  return (
    pending.size >= limit &&
    Array.from(pending.values()).filter(
      (request) => request.scope === scope && request.listeners.size > 0,
    ).length >= limit
  );
}

export function acquireNativeArtwork(
  token: string,
  listener: (image: NativeArtwork | null, issue?: ArtworkIssue) => void,
  reuseKey?: string,
  element?: HTMLSpanElement,
  prefetchOnly = false,
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
  if (!scope || !isNativeArtworkToken(token) || (!pending.has(token) && scopeQueueFull(scope))) {
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
      element: scope === "cosmetic" || scope === "upgrade" ? element : undefined,
      allowBatch: prefetchOnly || element !== undefined,
      listeners: new Set(),
      settled: false,
      singleOnly: false,
      cancellation: null,
      prefetchOnly,
    };
    pending.set(token, request);
    queue.push(request);
    if (!prefetchOnly) prioritize(request);
  } else if (!prefetchOnly && request.prefetchOnly) {
    request.prefetchOnly = false;
    prioritize(request);
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
