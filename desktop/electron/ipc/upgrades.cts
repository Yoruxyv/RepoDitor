import {
  type DesktopOperationResult,
  type PlayerUpgradeDto,
} from "../contracts.cjs";
import { type PythonClient } from "../python/client.cjs";
import {
  EditorProtocolError,
  failure,
  invalidSaveId,
  isRecord,
  parseError,
  readBoolean,
  readInteger,
  readString,
  validSaveId,
} from "./protocol.cjs";

const PLAYER_ID_PATTERN = /^\d{1,20}$/;

function parseUpgrade(value: unknown): PlayerUpgradeDto {
  if (!isRecord(value) || !Array.isArray(value.values)) {
    throw new EditorProtocolError("Invalid upgrade.");
  }
  const key = readString(value.key, "upgrade key");
  if (!key.startsWith("playerUpgrade")) {
    throw new EditorProtocolError("Invalid upgrade key.");
  }
  return {
    key,
    label: readString(value.label, "upgrade label"),
    known: readBoolean(value.known, "known upgrade flag"),
    values: value.values.map((entry) => {
      if (!isRecord(entry)) {
        throw new EditorProtocolError("Invalid upgrade value.");
      }
      const playerId = readString(entry.playerId, "player ID");
      const upgradeValue = readInteger(entry.value, "upgrade value");
      if (!PLAYER_ID_PATTERN.test(playerId) || upgradeValue < 0) {
        throw new EditorProtocolError("Invalid upgrade value.");
      }
      return { playerId, value: upgradeValue };
    }),
  };
}

function parseUpgrades(value: unknown): DesktopOperationResult<PlayerUpgradeDto[]> {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid upgrades response.");
  }
  if (value.ok !== true) {
    return parseError(value);
  }
  if (!Array.isArray(value.upgrades)) {
    throw new EditorProtocolError("Invalid upgrades.");
  }
  return { ok: true, data: value.upgrades.map(parseUpgrade) };
}

export async function listUpgrades(
  client: PythonClient,
  saveId: unknown,
): Promise<DesktopOperationResult<PlayerUpgradeDto[]>> {
  if (!validSaveId(saveId)) {
    return invalidSaveId();
  }
  try {
    return parseUpgrades(await client.run("upgrades-list", [saveId]));
  } catch (error) {
    return failure("upgrades", error);
  }
}
