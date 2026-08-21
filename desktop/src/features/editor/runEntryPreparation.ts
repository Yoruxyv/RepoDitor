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

export type RunEntryTask = "items" | "upgrades" | "players" | "avatars" | "run" | "maps";

export interface RunEntryData {
  readonly players: DesktopOperationResult<PlayerDto[]>;
  readonly avatarUrls: Readonly<Record<string, string | null>>;
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
  readonly onPendingTasksChange: (tasks: ReadonlySet<RunEntryTask>) => void;
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

async function loadAvatarUrls(
  saveId: string,
  players: DesktopOperationResult<PlayerDto[]>,
): Promise<Record<string, string | null>> {
  if (!players.ok || players.data.length === 0) return {};

  const entries = await Promise.all(
    players.data.map(async (player) => {
      try {
        const result = await window.repoditor.players.avatar(saveId, player.id);
        return [player.id, result.ok ? result.data.avatarUrl : null] as const;
      } catch {
        return [player.id, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
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
  onPendingTasksChange,
}: PrepareRunEntryOptions): Promise<RunEntryData> {
  const pending = new Set<RunEntryTask>();
  const update = () => onPendingTasksChange(new Set(pending));

  const tracked = async <T>(task: RunEntryTask, request: () => Promise<T>): Promise<T> => {
    pending.add(task);
    update();
    try {
      return await request();
    } finally {
      pending.delete(task);
      update();
    }
  };

  if (existingData !== null) {
    if (presentationReadiness === "ready") return existingData;
    const upgrades = await tracked("upgrades", () =>
      safeResult(
        () => window.repoditor.upgrades.prepareEntry(saveId, [...requiredUpgradeVisualKeys]),
        "The upgrade bridge failed unexpectedly.",
      ),
    );
    return { ...existingData, upgrades };
  }

  const playersPromise = tracked("players", () =>
    safeResult(
      () => window.repoditor.players.list(saveId),
      "The player bridge failed unexpectedly.",
    ),
  );
  const upgradesPromise = tracked("upgrades", () =>
    safeResult(
      () =>
        presentationReadiness === "ready"
          ? window.repoditor.upgrades.list(saveId)
          : window.repoditor.upgrades.prepareEntry(saveId, [...requiredUpgradeVisualKeys]),
      "The upgrade bridge failed unexpectedly.",
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
  const avatarUrlsPromise = playersPromise.then((players) =>
    tracked("avatars", () => loadAvatarUrls(saveId, players)),
  );

  const [players, avatarUrls, upgrades, run, items, mapData] = await Promise.all([
    playersPromise,
    avatarUrlsPromise,
    upgradesPromise,
    runPromise,
    itemsPromise,
    mapsPromise,
  ]);

  return {
    players,
    avatarUrls,
    upgrades,
    run,
    items,
    maps: mapData,
  };
}
