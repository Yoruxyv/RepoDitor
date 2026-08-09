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

export function getUpgradeIcon(key: string): { icon: Icon; source: "fallback" | "specific" } {
  const icon = UPGRADE_ICONS[key];
  return icon ? { icon, source: "specific" } : { icon: PackageIcon, source: "fallback" };
}
