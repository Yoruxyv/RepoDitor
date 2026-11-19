import type {
  DesktopOperationError,
  DesktopOperationResult,
  SaveOpenResult,
} from "@electron/contracts";
import {
  tauriReadApi,
  type NativeInstalledMaps,
  type NativeSaveOpenResult,
} from "@/app/tauriReadApi";
import {
  clearEntryArtwork,
  preloadEntryArtwork,
  rememberEntryArtwork,
  restoreEntryArtwork,
  type EntryArtworkProgress,
  type EntryArtworkResults,
} from "@/app/tauriArtwork";
import { prefetchInitialAvatar, type AvatarPrefetch } from "@/features/players/usePlayerAvatars";
import type { RunEntryData, RunEntryTask } from "./runEntryPreparation";

type EntryProjections = Pick<RunEntryData, RunEntryTask>;
export type TauriEntryProgress = {
  stage: "data" | "artwork" | "verifying";
  artwork?: EntryArtworkProgress;
};
export type TauriEntrySnapshot = EntryProjections & {
  readonly artwork: EntryArtworkResults;
  readonly artworkRevision: string | undefined;
  readonly avatarPrefetch?: AvatarPrefetch;
};

class EntrySourceError extends Error {
  readonly error: DesktopOperationError;

  constructor(error: DesktopOperationError) {
    super(error.message);
    this.error = error;
  }
}

function isSourceError({ code }: DesktopOperationError) {
  return ["save_stale", "save_source_unverified", "save_missing", "invalid_request"].includes(code);
}

function prepareArtworkPlan({
  upgrades,
  items,
  maps,
}: Pick<RunEntryData, "upgrades" | "items"> & {
  maps: DesktopOperationResult<NativeInstalledMaps>;
}) {
  // Keep the first instance of each name, in the initial Items list order.
  const groups = new Map<string, string | null>();
  if (items.ok) {
    for (const item of items.data.items)
      if (!groups.has(item.name)) groups.set(item.name, item.iconToken);
  }
  const itemGroups = [...groups].sort(([left], [right]) => left.localeCompare(right));
  const plan = {
    upgrade: upgrades.ok ? upgrades.data.map((row) => row.iconToken) : [],
    map: maps.ok ? maps.data.maps.map((row) => row.iconToken) : [],
    item: itemGroups.map(([, token]) => token),
  };
  const revision = maps.ok ? maps.data.entryArtworkRevision : undefined;
  // Native projections bind current-session tokens to these installed artwork identities.
  // The Run's save and player data never enter the artwork cache.
  const key =
    revision && upgrades.ok && items.ok && maps.ok
      ? JSON.stringify([
          revision,
          upgrades.data.map((row) => row.key),
          maps.data.maps.map((row) => row.internalName),
          itemGroups.map(([name]) => name),
        ])
      : null;
  return { plan, revision, key };
}

async function verifyEntrySources(
  save: Pick<SaveOpenResult["session"], "id" | "fingerprint">,
  signal: AbortSignal,
  revision: string | undefined,
  saveVerified: boolean,
): Promise<DesktopOperationResult<boolean>> {
  let artworkVerified = true;
  if (revision !== undefined) {
    const verified = await tauriReadApi.maps.list("verify", save);
    signal.throwIfAborted();
    if (!verified.ok && isSourceError(verified.error)) return verified;
    artworkVerified = verified.ok && verified.data.entryArtworkRevision === revision;
    saveVerified = verified.ok && verified.data.entrySaveVerified === true;
  }
  if (saveVerified) return { ok: true, data: artworkVerified };
  const current = await tauriReadApi.saves.open(save.id, save.fingerprint);
  signal.throwIfAborted();
  if (!current.ok) return current;
  if (current.data.session.id !== save.id)
    return {
      ok: false,
      error: { code: "invalid_response", message: "The selected save ID did not match." },
    };
  if (current.data.session.fingerprint !== save.fingerprint)
    return { ok: false, error: { code: "save_stale", message: "The selected save changed." } };
  return { ok: true, data: artworkVerified };
}

export async function prepareTauriEntry(
  opened: NativeSaveOpenResult,
  signal: AbortSignal,
  report: (progress: TauriEntryProgress) => void,
): Promise<DesktopOperationResult<TauriEntrySnapshot>> {
  const { id, fingerprint } = opened.session;
  const saveProof = { id, fingerprint };
  let avatarPrefetch: AvatarPrefetch | undefined;
  async function load<T>(request: () => Promise<DesktopOperationResult<T>>) {
    signal.throwIfAborted();
    const result = await request();
    signal.throwIfAborted();
    if (
      !result.ok &&
      (result.error.code === "save_stale" || result.error.code === "save_source_unverified")
    )
      throw new EntrySourceError(result.error);
    return result;
  }

  async function loadProjections() {
    if (opened.supportsEntryBatch) {
      const entry = await tauriReadApi.saves.prepareEntry(saveProof);
      signal.throwIfAborted();
      if (!entry.ok) {
        if (isSourceError(entry.error)) throw new EntrySourceError(entry.error);
        // A failed batch has no trustworthy projections. Verify the open save separately.
        return { players: entry, upgrades: entry, run: entry, items: entry, maps: entry };
      }
      avatarPrefetch = prefetchInitialAvatar(id, entry.data.players, tauriReadApi.players.avatar);
      return entry.data;
    }
    const players = await load(() => tauriReadApi.players.list(id, fingerprint));
    avatarPrefetch = prefetchInitialAvatar(id, players, tauriReadApi.players.avatar);
    // Item artwork can reference tokens registered by the Upgrade read.
    const upgrades = await load(() => tauriReadApi.upgrades.list(id, fingerprint));
    const [run, items] = await Promise.all([
      load(() => tauriReadApi.run.get(id, fingerprint)),
      load(() => tauriReadApi.advanced.get(id, fingerprint, true)),
    ]);
    const maps = await load(() => tauriReadApi.maps.list("entry", saveProof));
    return { players, upgrades, run, items, maps };
  }

  try {
    report({ stage: "data" });
    const projections = await loadProjections();
    signal.throwIfAborted();
    const { plan, revision, key } = prepareArtworkPlan(projections);
    const reused = restoreEntryArtwork(key, plan);
    let artworkProgress: EntryArtworkProgress | undefined;
    const artwork =
      reused ??
      (await preloadEntryArtwork(plan, signal, (progress) => {
        if (signal.aborted) return;
        artworkProgress = progress;
        report({ stage: "artwork", artwork: progress });
      }));
    signal.throwIfAborted();
    report(
      artworkProgress ? { stage: "verifying", artwork: artworkProgress } : { stage: "verifying" },
    );
    const incomplete = Object.values(artwork).some(({ issues }) => Object.keys(issues).length > 0);
    const verification = await verifyEntrySources(
      saveProof,
      signal,
      key !== null && !reused && !incomplete ? revision : undefined,
      reused !== null && projections.maps.ok && projections.maps.data.entrySaveVerified === true,
    );
    signal.throwIfAborted();
    if (!verification.ok) return verification;
    if (!verification.data) {
      clearEntryArtwork();
      for (const scope of Object.values(artwork)) {
        if (!scope.ready) continue;
        scope.issues.failed = (scope.issues.failed ?? 0) + scope.ready;
        scope.ready = 0;
      }
    } else if (key !== null && !reused && !incomplete) rememberEntryArtwork(key, plan, artwork);
    return {
      ok: true,
      data: {
        ...projections,
        artwork,
        artworkRevision: verification.data ? revision : undefined,
        ...(avatarPrefetch ? { avatarPrefetch } : {}),
      },
    };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      ok: false,
      error:
        error instanceof EntrySourceError
          ? error.error
          : {
              code: "internal_error",
              message: "The desktop editor preparation failed unexpectedly.",
            },
    };
  }
}
