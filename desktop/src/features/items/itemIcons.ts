import {
  BaseballIcon,
  BatteryHighIcon,
  BombIcon,
  CookingPotIcon,
  CrosshairIcon,
  FeatherIcon,
  FirstAidKitIcon,
  GaugeIcon,
  HammerIcon,
  LightningIcon,
  MotorcycleIcon,
  PackageIcon,
  PlanetIcon,
  RadioIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  SwordIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

type IconSource = "category" | "fallback" | "specific";

const ITEM_ICONS: Record<string, Icon> = {
  "Drone Battery": BatteryHighIcon,
  "Drone Feather": FeatherIcon,
  "Drone Indestructible": ShieldCheckIcon,
  "Drone Torque": GaugeIcon,
  "Drone Zero Gravity": PlanetIcon,
  "Grenade Explosive": BombIcon,
  "Grenade Stun": LightningIcon,
  "Melee Baseball Bat": BaseballIcon,
  "Melee Frying Pan": CookingPotIcon,
  "Melee Inflatable Hammer": HammerIcon,
  "Melee Sledge Hammer": HammerIcon,
  "Melee Sword": SwordIcon,
  "Orb Zero Gravity": PlanetIcon,
};

const CATEGORY_ICONS: ReadonlyArray<readonly [RegExp, Icon]> = [
  [/\bgun\b/i, CrosshairIcon],
  [/health pack/i, FirstAidKitIcon],
  [/\bcart\b/i, ShoppingCartIcon],
  [/\bmine\b/i, BombIcon],
  [/tracker/i, CrosshairIcon],
  [/walkie|communication/i, RadioIcon],
  [/semiscooter|vehicle/i, MotorcycleIcon],
];

export function getItemIcon(name: string): { icon: Icon; source: IconSource } {
  const normalized = name.replace(/^Item\s+/, "");
  const icon = ITEM_ICONS[normalized];
  if (icon) return { icon, source: "specific" };

  const category = CATEGORY_ICONS.find(([pattern]) => pattern.test(normalized));
  return category
    ? { icon: category[1], source: "category" }
    : { icon: PackageIcon, source: "fallback" };
}
