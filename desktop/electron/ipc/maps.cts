/**
 * Read-only installed-map IPC boundary.
 *
 * Validates Python-discovered display data and exposes no map selection, local path,
 * injection, or game-control capability.
 */
import {
  type DesktopOperationResult,
  type InstalledMapDto,
  type InstalledMapsDto,
} from "../contracts.cjs";
import { localIconRegistry, validMapFamily } from "../icons/registry.cjs";
import { mapArtwork } from "../icons/mapArtwork.cjs";
import { type PythonClient } from "../python/client.cjs";
import {
  EditorProtocolError,
  failure,
  isRecord,
  parseError,
  readBoolean,
  readString,
} from "./protocol.cjs";

function parseMap(value: unknown): InstalledMapDto {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid installed map.");
  }
  if (
    !validMapFamily(value.internalName) ||
    typeof value.displayName !== "string" ||
    value.displayName.length > 128 ||
    Array.from(value.displayName).some((char) => char.charCodeAt(0) < 32)
  )
    throw new EditorProtocolError("Invalid map identity.");
  return {
    iconToken: null,
    internalName: readString(value.internalName, "map internal name"),
    displayName: readString(value.displayName, "map display name"),
    knownLabel: readBoolean(value.knownLabel, "known map label flag"),
  };
}

function parseMaps(value: unknown): DesktopOperationResult<InstalledMapsDto> {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid maps response.");
  }
  if (value.ok !== true) {
    return parseError(value);
  }
  const available = readBoolean(value.available, "map availability");
  if (!Array.isArray(value.maps) || value.maps.length > 128) {
    throw new EditorProtocolError("Invalid maps.");
  }
  let catalogPath: string | null;
  if (available) {
    catalogPath = readString(value.catalogPath, "map catalog path");
  } else {
    if (value.catalogPath !== null) {
      throw new EditorProtocolError("Invalid map catalog path.");
    }
    catalogPath = null;
  }
  const maps = value.maps.map(parseMap);
  if (
    new Set(maps.map((m) => m.internalName)).size !== maps.length ||
    (!available && maps.length !== 0)
  )
    throw new EditorProtocolError("Invalid installed map roster.");
  const requests = value.maps.map((entry: unknown, index: number) => {
    if (!isRecord(entry)) throw new EditorProtocolError("Invalid map.");
    const revision = entry.artworkRevision;
    if (revision == null) return { cacheKey: null, upgradeKey: null };
    if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision))
      throw new EditorProtocolError("Invalid map source identity.");
    return {
      cacheKey: null,
      upgradeKey: null,
      mapFamily: maps[index].internalName,
      sourceIdentity: revision,
    };
  });
  // Empty registrations revoke old map tokens while preserving every other icon domain.
  const tokens = localIconRegistry.replaceVisuals(
    "map",
    requests.filter((r) => r.mapFamily !== undefined),
  );
  let tokenIndex = 0;
  maps.forEach((m, i) => {
    if (requests[i].mapFamily !== undefined) m.iconToken = tokens[tokenIndex++];
  });
  return {
    ok: true,
    data: {
      available,
      catalogPath,
      maps,
    },
  };
}

export async function listMaps(
  client: PythonClient,
): Promise<DesktopOperationResult<InstalledMapsDto>> {
  try {
    const result = parseMaps(await client.run("maps-list"));
    if (result.ok) mapArtwork.refresh();
    return result;
  } catch (error) {
    return failure("maps", error);
  }
}
