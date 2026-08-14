import {
  type DesktopOperationResult,
  type PlayerUpgradeDto,
} from "../contracts.cjs";
import type {
  AssetPreparationService,
  UpgradeVisualPreparationRequest,
} from "../assets/preparation.cjs";
import { type PythonClient } from "../python/client.cjs";
import {
  localIconRegistry,
  readIconKey,
  readUpgradeVisualKey,
  type LocalIconRegistry,
} from "../icons/registry.cjs";
import {
  EditorProtocolError,
  failure,
  invalidSaveId,
  isRecord,
  parseError,
  readInteger,
  readNullableInteger,
  readString,
  validSaveId,
} from "./protocol.cjs";

const PLAYER_ID_PATTERN = /^\d{1,20}$/;

type ParsedUpgrade = Omit<PlayerUpgradeDto, "iconToken"> & { readonly iconKey: string | null };

function parseUpgrade(value: unknown): ParsedUpgrade {
  if (!isRecord(value) || !Array.isArray(value.values)) {
    throw new EditorProtocolError("Invalid upgrade.");
  }
  const key = readString(value.key, "upgrade key");
  if (readUpgradeVisualKey(key) === null) {
    throw new EditorProtocolError("Invalid upgrade key.");
  }
  const presentationSource = readString(value.presentationSource, "upgrade presentation source");
  const gameplayCap = readNullableInteger(value.gameplayCap, "upgrade gameplay cap");
  if (
    !["installed", "alias", "humanized"].includes(presentationSource)
    || (gameplayCap !== null && gameplayCap < 0)
  ) {
    throw new EditorProtocolError("Invalid upgrade presentation.");
  }
  let iconKey: string | null;
  try {
    iconKey = readIconKey(value.iconKey);
  } catch {
    throw new EditorProtocolError("Invalid upgrade icon.");
  }
  return {
    key,
    label: readString(value.label, "upgrade label"),
    presentationSource: presentationSource as PlayerUpgradeDto["presentationSource"],
    gameplayCap,
    iconKey,
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

function parseUpgrades(
  value: unknown,
  icons: LocalIconRegistry,
): {
  readonly result: DesktopOperationResult<PlayerUpgradeDto[]>;
  readonly visuals: readonly UpgradeVisualPreparationRequest[];
} {
  if (!isRecord(value)) {
    throw new EditorProtocolError("Invalid upgrades response.");
  }
  if (value.ok !== true) {
    return { result: parseError(value), visuals: [] };
  }
  if (!Array.isArray(value.upgrades)) {
    throw new EditorProtocolError("Invalid upgrades.");
  }
  const upgrades = value.upgrades.map(parseUpgrade);
  const visuals = upgrades.map((upgrade) => ({
    cacheKey: upgrade.iconKey,
    upgradeKey: upgrade.key,
  }));
  const tokens = icons.replaceVisuals("upgrade", visuals);
  return {
    result: {
      ok: true,
      data: upgrades.map(({ iconKey: _iconKey, ...upgrade }, index) => ({
        ...upgrade,
        iconToken: tokens[index] ?? null,
      })),
    },
    visuals,
  };
}

export async function listUpgrades(
  client: PythonClient,
  saveId: unknown,
  icons: LocalIconRegistry = localIconRegistry,
  preparation: Pick<AssetPreparationService, "prepareUpgradeVisuals"> | null = null,
): Promise<DesktopOperationResult<PlayerUpgradeDto[]>> {
  if (!validSaveId(saveId)) {
    return invalidSaveId();
  }
  try {
    const parsed = parseUpgrades(await client.run("upgrades-list", [saveId]), icons);
    if (!parsed.result.ok) return parsed.result;
    if (preparation !== null) {
      void preparation.prepareUpgradeVisuals(parsed.visuals).catch(() => undefined);
    }
    return parsed.result;
  } catch (error) {
    return failure("upgrades", error);
  }
}
