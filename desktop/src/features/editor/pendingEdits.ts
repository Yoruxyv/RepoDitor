import type {
  AdvancedRefillChange,
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

export type PendingEdit =
  | PlayerHealthEdit
  | UpgradeValueEdit
  | RunStatEdit
  | AdvancedRefillEdit;

export function toSaveChange(edit: PendingEdit): SaveChange {
  return {
    feature: edit.feature,
    entity: edit.entity,
    field: edit.field,
    after: edit.after,
  } as SaveChange;
}
