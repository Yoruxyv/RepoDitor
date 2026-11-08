/**
 * Parallel loader for the typed projections needed when entering a Run workspace.
 *
 * One fresh save-open result establishes the source fingerprint; domain reads then
 * populate feature-local state. Reuse is limited to successful application-session
 * projections, while unresolved artwork is refreshed independently and fail-soft.
 */
import type {
  AdvancedSaveDto,
  DesktopOperationResult,
  InstalledMapsDto,
  PlayerDto,
  PlayerUpgradeDto,
  RunStateDto,
} from "@electron/contracts";
import { prefetchInitialAvatar, type AvatarPrefetch } from "@/features/players/usePlayerAvatars";

const UPGRADE_BRIDGE_FAILURE_MESSAGE = "The upgrade bridge failed unexpectedly.";

export type RunEntryTask = "items" | "upgrades" | "players" | "run" | "maps";
export type RunEntryTaskStatus = "waiting" | "running" | "completed";

export interface RunEntryProgress {
  readonly completed: number;
  readonly total: number;
  readonly currentTask: RunEntryTask | null;
  readonly tasks: Readonly<Partial<Record<RunEntryTask, RunEntryTaskStatus>>>;
}

export const RUN_ENTRY_TASK_PRIORITY: readonly RunEntryTask[] = [
  "items",
  "upgrades",
  "players",
  "run",
  "maps",
];

export interface RunEntryData {
  readonly artworkDegraded: boolean;
  readonly players: DesktopOperationResult<PlayerDto[]>;
  readonly avatarUrls: Readonly<Record<string, string | null>>;
  readonly avatarPrefetch?: AvatarPrefetch | undefined;
  readonly upgrades: DesktopOperationResult<PlayerUpgradeDto[]>;
  readonly run: DesktopOperationResult<RunStateDto>;
  readonly items: DesktopOperationResult<AdvancedSaveDto>;
  readonly maps: DesktopOperationResult<InstalledMapsDto>;
}

interface PrepareRunEntryOptions {
  readonly saveId: string;
  readonly requiredUpgradeVisualKeys: readonly string[];
  readonly presentationReadiness: "ready" | "unresolved";
  readonly maps: () => Promise<DesktopOperationResult<InstalledMapsDto>>;
  readonly existingData?: RunEntryData | null;
  readonly onProgressChange: (progress: RunEntryProgress) => void;
}

/** Create an honest initial lifecycle snapshot for the work planned on editor entry. */
export function initialRunEntryProgress(existingData: RunEntryData | null): RunEntryProgress {
  const planned = existingData === null ? RUN_ENTRY_TASK_PRIORITY : (["upgrades"] as const);
  return {
    completed: 0,
    total: planned.length,
    currentTask: planned[0] ?? null,
    tasks: Object.fromEntries(planned.map((task) => [task, "waiting"])),
  };
}

function bridgeFailure<T>(message: string): DesktopOperationResult<T> {
  return {
    ok: false,
    error: {
      code: "internal_error",
      message,
    },
  };
}

async function safeResult<T>(
  request: () => Promise<DesktopOperationResult<T>>,
  message: string,
): Promise<DesktopOperationResult<T>> {
  try {
    return await request();
  } catch {
    return bridgeFailure(message);
  }
}

async function currentArtworkDegraded(): Promise<boolean> {
  try {
    return (await window.repoditor.assets.state()).degraded;
  } catch {
    return true;
  }
}

/** Return whether every authoritative feature projection may be reused this session. */
export function runEntryDataReusable(data: RunEntryData): boolean {
  return data.players.ok && data.upgrades.ok && data.run.ok && data.items.ok && data.maps.ok;
}

/**
 * Load or refresh the renderer-safe projections required by the Run editor.
 *
 * @param options - Save identity, artwork readiness, map loader, and progress callback.
 * @returns Independent typed results; one optional-domain failure does not discard
 * the other successfully loaded projections.
 */
export async function prepareRunEntryData({
  saveId,
  requiredUpgradeVisualKeys,
  presentationReadiness,
  maps,
  existingData = null,
  onProgressChange,
}: PrepareRunEntryOptions): Promise<RunEntryData> {
  const initialProgress = initialRunEntryProgress(existingData);
  const tasks: Partial<Record<RunEntryTask, RunEntryTaskStatus>> = { ...initialProgress.tasks };
  const update = () => {
    const completed = Object.values(tasks).filter((status) => status === "completed").length;
    const currentTask =
      RUN_ENTRY_TASK_PRIORITY.find((task) => tasks[task] === "running") ??
      RUN_ENTRY_TASK_PRIORITY.find((task) => tasks[task] === "waiting") ??
      null;
    onProgressChange({ completed, total: initialProgress.total, currentTask, tasks: { ...tasks } });
  };

  update();

  const tracked = async <T>(task: RunEntryTask, request: () => Promise<T>): Promise<T> => {
    tasks[task] = "running";
    update();
    try {
      return await request();
    } finally {
      tasks[task] = "completed";
      update();
    }
  };

  if (existingData !== null) {
    const avatarPrefetch = prefetchInitialAvatar(saveId, existingData.players);
    if (presentationReadiness === "ready") {
      return { ...existingData, avatarPrefetch, artworkDegraded: false };
    }
    const upgrades = await tracked("upgrades", () =>
      safeResult(
        () => window.repoditor.upgrades.prepareEntry(saveId, [...requiredUpgradeVisualKeys]),
        UPGRADE_BRIDGE_FAILURE_MESSAGE,
      ),
    );
    return {
      ...existingData,
      avatarPrefetch,
      artworkDegraded: await currentArtworkDegraded(),
      upgrades,
    };
  }

  let avatarPrefetch: AvatarPrefetch | undefined;
  const playersPromise = tracked("players", () =>
    safeResult(
      () => window.repoditor.players.list(saveId),
      "The player bridge failed unexpectedly.",
    ),
  ).then((players) => {
    avatarPrefetch = prefetchInitialAvatar(saveId, players);
    return players;
  });
  const upgradesPromise = tracked("upgrades", () =>
    safeResult(
      () =>
        presentationReadiness === "ready"
          ? window.repoditor.upgrades.list(saveId)
          : window.repoditor.upgrades.prepareEntry(saveId, [...requiredUpgradeVisualKeys]),
      UPGRADE_BRIDGE_FAILURE_MESSAGE,
    ),
  );
  const runPromise = tracked("run", () =>
    safeResult(() => window.repoditor.run.get(saveId), "The run bridge failed unexpectedly."),
  );
  const itemsPromise = tracked("items", () =>
    safeResult(() => window.repoditor.advanced.get(saveId), "The item bridge failed unexpectedly."),
  );
  const mapsPromise = tracked("maps", () =>
    safeResult(maps, "The map bridge failed unexpectedly."),
  );
  const artworkDegradedPromise =
    presentationReadiness === "ready"
      ? Promise.resolve(false)
      : upgradesPromise.then(currentArtworkDegraded);

  const [artworkDegraded, players, upgrades, run, items, mapData] = await Promise.all([
    artworkDegradedPromise,
    playersPromise,
    upgradesPromise,
    runPromise,
    itemsPromise,
    mapsPromise,
  ]);

  return {
    artworkDegraded,
    players,
    avatarUrls: {},
    avatarPrefetch,
    upgrades,
    run,
    items,
    maps: mapData,
  };
}
