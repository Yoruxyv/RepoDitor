/**
 * Pure renderer helpers for the typed in-memory pending-change union.
 *
 * These helpers preserve exact domain identity and support replacement/revert; they
 * do not validate game semantics or persist anything.
 */
import type {
  AdvancedRefillChange,
  CosmeticChange,
  PlayerHealthChange,
  RunResumeChange,
  RunStatChange,
  SaveChange,
  UpgradeValueChange,
} from "@electron/contracts";

interface PendingDetails {
  before: number;
  label: string;
  subject: string;
}

export interface PlayerHealthEdit extends PlayerHealthChange, PendingDetails {}

export interface UpgradeValueEdit extends UpgradeValueChange, PendingDetails {}

export type RunStatEdit = (RunStatChange | RunResumeChange) & {
  before: number | string;
  label: string;
  subject: "Run";
};

export interface AdvancedRefillEdit extends AdvancedRefillChange {
  before: number;
  label: "Stored charge";
  subject: string;
}

export type CosmeticOwnershipEdit = Extract<CosmeticChange, { field: "owned" }> & {
  before: boolean;
  label: "Ownership";
  subject: string;
};

export type CosmeticUnlockAllEdit = Extract<CosmeticChange, { field: "unlockAll" }> & {
  before: number;
  label: "Known ownership";
  subject: "Cosmetics";
};

export type CosmeticLockAllEdit = Extract<CosmeticChange, { field: "lockAll" }> & {
  before: number;
  label: "Known ownership";
  subject: "Cosmetics";
};

export type CosmeticClearAllPresetsEdit = Extract<CosmeticChange, { field: "clearAll" }> & {
  before: number;
  label: "Saved presets";
  subject: "Cosmetics";
};

export type CosmeticPendingEdit =
  CosmeticOwnershipEdit | CosmeticUnlockAllEdit | CosmeticLockAllEdit | CosmeticClearAllPresetsEdit;

export type RunSavePendingEdit =
  PlayerHealthEdit | UpgradeValueEdit | RunStatEdit | AdvancedRefillEdit;

export type PendingEdit = RunSavePendingEdit | CosmeticPendingEdit;

/** Strip renderer-only review fields before crossing the Run-save write boundary. */
export function toSaveChange(edit: RunSavePendingEdit): SaveChange {
  return {
    feature: edit.feature,
    entity: edit.entity,
    field: edit.field,
    after: edit.after,
  } as SaveChange;
}

/** Strip renderer-only review fields before crossing the Cosmetics write boundary. */
export function toCosmeticChange(edit: CosmeticPendingEdit): CosmeticChange {
  return {
    feature: edit.feature,
    entity: edit.entity,
    field: edit.field,
    after: edit.after,
  } as CosmeticChange;
}
