export const cosmeticsEn = {
  unavailable: "Cosmetics unavailable",
  unavailableMessage: "Cosmetics editing is unavailable for this MetaSave.",
  eyebrow: "Account save",
  title: "Cosmetics",
  unlocked: "{owned} of {total} supported cosmetics unlocked",
  complete: "All supported cosmetics are already unlocked.",
  remaining: {
    one: "{count} supported cosmetic remains locked.",
    other: "{count} supported cosmetics remain locked.",
  },
  action: "Unlock Remaining Cosmetics",
  cosmeticId: "Cosmetic ID",
  lockAll: "Lock All Cosmetics",
  presets: "Equipment and presets are not modified.",
  lockBlocked: {
    equipped:
      "Lock All is blocked because an unlocked cosmetic is equipped. Unequip it in R.E.P.O., close the game, then import the updated MetaSave.",
    preset:
      "Lock All is blocked because an unlocked cosmetic is used by a saved preset. Remove its preset references in R.E.P.O., close the game, then import the updated MetaSave.",
    unverified:
      "Equipment or preset references could not be verified. Import a complete MetaSave from the game. References will not be cleared here.",
    busy: "A file operation is in progress. Wait for it to finish.",
    empty: "No supported cosmetics are currently unlocked.",
  },
  lockConfirmTitle: "Lock All Cosmetics?",
  lockConfirmBody: {
    one: "This removes ownership of {count} supported cosmetic from this working copy.",
    other: "This removes ownership of {count} supported cosmetics from this working copy.",
  },
  lockRestrictions:
    "Equipped or preset-referenced cosmetics block this action. Equipment, presets and unsupported ownership will not be cleared. Download the verified copy to keep your changes.",
  preservedOwnership: {
    one: "{count} unsupported owned cosmetic is preserved.",
    other: "{count} unsupported owned cosmetics are preserved.",
  },
  confirmLock: {
    one: "Lock {count} cosmetic",
    other: "Lock {count} cosmetics",
  },
  cancelLock: "Cancel",
  lockChanged: "The save or its ownership changed. Cancel and review Lock All again.",
  pendingHistoryField: "Cosmetic history",
  pendingHistoryOriginal: "Original history",
  pendingHistoryUpdated: "Updated history",
  pendingField: "Supported cosmetics",
  pendingValue: "{count} unlocked",
} as const;
