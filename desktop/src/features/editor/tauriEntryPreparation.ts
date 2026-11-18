import type {
  DesktopOperationError,
  DesktopOperationResult,
  SaveOpenResult,
} from "@electron/contracts";
import type { HealthState } from "@/app/tauriHealthApi";
import {
  tauriReadApi,
  type NativeInstalledMaps,
  type NativeSaveOpenResult,
} from "@/app/tauriReadApi";
import {
  preloadEntryArtwork,
  rememberEntryArtwork,
  restoreEntryArtwork,
  type EntryArtworkResults,
} from "@/app/tauriArtwork";
import { prefetchInitialAvatar, type AvatarPrefetch } from "@/features/players/usePlayerAvatars";
import type { RunEntryData, RunEntryTask } from "./runEntryPreparation";

const TASKS = ["players", "upgrades", "run", "items", "maps"] as const;
type Status = "waiting" | "running" | "completed" | "degraded";
export type TauriEntryProgress = Readonly<Record<RunEntryTask, Status>>;
export type TauriEntrySnapshot = Pick<RunEntryData, RunEntryTask> & {
  readonly initialHealth?: HealthState;
  readonly session: SaveOpenResult["session"];
  readonly artwork: EntryArtworkResults;
  readonly artworkRevision: string | undefined;
  readonly avatarPrefetch: AvatarPrefetch | undefined;
};

const WAITING: TauriEntryProgress = {
  players: "waiting",
  upgrades: "waiting",
  run: "waiting",
  items: "waiting",
  maps: "waiting",
};

class EntrySourceError extends Error {
  readonly error: DesktopOperationError;

  constructor(error: DesktopOperationError) {
    super(error.message);
    this.error = error;
  }
}

function prepareArtworkPlan(
  { id, fingerprint }: SaveOpenResult["session"],
  {
    upgrades,
    items,
    maps,
  }: Pick<RunEntryData, "upgrades" | "items"> & {
    maps: DesktopOperationResult<NativeInstalledMaps>;
  },
) {
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
  const key =
    revision && upgrades.ok && items.ok && maps.ok
      ? JSON.stringify([
          id,
          fingerprint,
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
): Promise<DesktopOperationResult<null>> {
  if (revision !== undefined) {
    const verified = await tauriReadApi.maps.list("verify", save);
    signal.throwIfAborted();
    if (!verified.ok) return verified;
    if (verified.data.entryArtworkRevision !== revision)
      return {
        ok: false,
        error: {
          code: "invalid_response",
          message: "Installed artwork changed during preparation.",
        },
      };
    saveVerified = verified.data.entrySaveVerified === true;
  }
  if (saveVerified) return { ok: true, data: null };
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
  return { ok: true, data: null };
}

export async function prepareTauriEntry(
  opened: NativeSaveOpenResult,
  signal: AbortSignal,
  report: (progress: TauriEntryProgress) => void,
  reportArtwork: Parameters<typeof preloadEntryArtwork>[2],
  confirmArtwork: (result: EntryArtworkResults) => Promise<void>,
): Promise<DesktopOperationResult<TauriEntrySnapshot>> {
  const { id, fingerprint } = opened.session;
  const saveProof = { id, fingerprint };
  const tasks = { ...WAITING };
  function update(task: RunEntryTask, status: Status) {
    tasks[task] = status;
    report({ ...tasks });
  }
  async function load<T>(
    task: RunEntryTask,
    request: () => Promise<DesktopOperationResult<T>>,
    available: (value: T) => boolean = () => true,
  ) {
    signal.throwIfAborted();
    update(task, "running");
    const result = await request();
    signal.throwIfAborted();
    update(task, result.ok && available(result.data) ? "completed" : "degraded");
    if (
      !result.ok &&
      (result.error.code === "save_stale" || result.error.code === "save_source_unverified")
    )
      throw new EntrySourceError(result.error);
    return result;
  }

  async function loadProjections() {
    if (opened.supportsEntryBatch) {
      update("upgrades", "running");
      const entry = await tauriReadApi.saves.prepareEntry(saveProof);
      signal.throwIfAborted();
      if (!entry.ok) throw new EntrySourceError(entry.error);
      for (const task of TASKS) {
        const projection = entry.data[task];
        const available = task !== "maps" || (entry.data.maps.ok && entry.data.maps.data.available);
        update(task, projection.ok && available ? "completed" : "degraded");
      }
      return {
        ...entry.data,
        avatarPrefetch: prefetchInitialAvatar(id, entry.data.players, tauriReadApi.players.avatar),
      };
    }
    const players = await load("players", () => tauriReadApi.players.list(id, fingerprint));
    const avatarPrefetch = prefetchInitialAvatar(id, players, tauriReadApi.players.avatar);
    // Item artwork can reference tokens registered by the Upgrade read.
    const upgrades = await load("upgrades", () => tauriReadApi.upgrades.list(id, fingerprint));
    const [run, items] = await Promise.all([
      load("run", () => tauriReadApi.run.get(id, fingerprint)),
      load("items", () => tauriReadApi.advanced.get(id, fingerprint, true)),
    ]);
    const maps = await load(
      "maps",
      () => tauriReadApi.maps.list("entry", saveProof),
      (catalog) => catalog.available,
    );
    return { players, upgrades, run, items, maps, avatarPrefetch };
  }

  try {
    const { players, upgrades, run, items, maps, avatarPrefetch } = await loadProjections();
    const { plan, revision, key } = prepareArtworkPlan(opened.session, { upgrades, items, maps });
    const reused = restoreEntryArtwork(key, plan);
    if (reused) {
      const settled = Object.values(reused).reduce(
        (sum, result) => sum + result.ready + result.unavailable,
        0,
      );
      reportArtwork({ scope: null, settled, total: settled });
    }
    const artwork = reused ?? (await preloadEntryArtwork(plan, signal, reportArtwork));
    signal.throwIfAborted();
    const incomplete = Object.values(artwork).some(({ issues }) => Object.keys(issues).length > 0);
    if (incomplete) {
      await confirmArtwork(artwork);
      signal.throwIfAborted();
    }
    const verification = await verifyEntrySources(
      saveProof,
      signal,
      key !== null && !reused && !incomplete ? revision : undefined,
      reused !== null && maps.ok && maps.data.entrySaveVerified === true,
    );
    signal.throwIfAborted();
    if (!verification.ok) return verification;
    if (key !== null && !incomplete) rememberEntryArtwork(key, plan, artwork);
    return {
      ok: true,
      data: {
        session: opened.session,
        players,
        upgrades,
        run,
        items,
        maps,
        artwork,
        artworkRevision: revision,
        avatarPrefetch,
      },
    };
  } catch (error) {
    if (!(error instanceof EntrySourceError)) throw error;
    return { ok: false, error: error.error };
  }
}

export function entryProgressCounts(progress: TauriEntryProgress) {
  return {
    current: TASKS.find((task) => progress[task] === "running"),
    completed: TASKS.filter(
      (task) => progress[task] === "completed" || progress[task] === "degraded",
    ).length,
    total: TASKS.length,
  };
}
