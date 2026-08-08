import type {
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

export type PendingEdit = PlayerHealthEdit | UpgradeValueEdit | RunStatEdit;

export function toSaveChange(edit: PendingEdit): SaveChange {
  return {
    feature: edit.feature,
    entity: edit.entity,
    field: edit.field,
    after: edit.after,
  } as SaveChange;
}
