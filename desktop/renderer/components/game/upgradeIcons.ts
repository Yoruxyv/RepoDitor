/**
 * Semantic Phosphor fallback registry for dynamic upgrade identities.
 *
 * Exact local game artwork takes precedence. This registry may improve presentation
 * for known meanings but never defines upgrade membership or mutation capability.
 */
import {
  ArrowUpIcon,
  BatteryHighIcon,
  BirdIcon,
  CrosshairIcon,
  HandFistIcon,
  HandGrabbingIcon,
  HeartIcon,
  LightningIcon,
  MapPinIcon,
  PackageIcon,
  ParachuteIcon,
  PersonSimpleRunIcon,
  PersonSimpleThrowIcon,
  StairsIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

const UPGRADE_ICONS: Record<string, Icon> = {
  playerUpgradeCrouchRest: ParachuteIcon,
  playerUpgradeDeathHeadBattery: BatteryHighIcon,
  playerUpgradeExtraJump: ArrowUpIcon,
  playerUpgradeHealth: HeartIcon,
  playerUpgradeLaunch: PersonSimpleThrowIcon,
  playerUpgradeMapPlayerCount: MapPinIcon,
  playerUpgradeRange: CrosshairIcon,
  playerUpgradeSpeed: PersonSimpleRunIcon,
  playerUpgradeStamina: LightningIcon,
  playerUpgradeStrength: HandFistIcon,
  playerUpgradeThrow: HandGrabbingIcon,
  playerUpgradeTumbleClimb: StairsIcon,
  playerUpgradeTumbleWings: BirdIcon,
};

const ITEM_UPGRADE_ALIASES: Readonly<Record<string, string>> = {
  Energy: "Stamina",
  "Grab Range": "Range",
  "Grab Strength": "Strength",
  "Grab Throw": "Throw",
  "Sprint Speed": "Speed",
  "Tumble Launch": "Launch",
};

/** Return a semantic fallback icon without defining upgrade membership. */
export function getUpgradeIcon(key: string): { icon: Icon; source: "fallback" | "specific" } {
  const icon = UPGRADE_ICONS[key];
  return icon ? { icon, source: "specific" } : { icon: PackageIcon, source: "fallback" };
}

/** Convert an installed upgrade-item label into the same presentation fallback lookup. */
export function getItemUpgradeIcon(name: string): ReturnType<typeof getUpgradeIcon> {
  const itemName = name
    .replace(/^Item\s+/, "")
    .replace(/^Upgrade\s+/, "")
    .replace(/^Player\s+/, "");
  const semanticName = itemName.endsWith(" Upgrade") ? itemName.slice(0, -8) : itemName;
  const iconName = ITEM_UPGRADE_ALIASES[semanticName] ?? semanticName;
  const suffix =
    iconName
      .match(/[A-Za-z0-9]+/g)
      ?.map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
      .join("") ?? "";
  return getUpgradeIcon(`playerUpgrade${suffix}`);
}
