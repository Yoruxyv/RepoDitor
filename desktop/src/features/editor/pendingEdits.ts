export interface PlayerHealthEdit {
  feature: "players";
  entity: string;
  field: "health";
  before: number;
  after: number;
}

export interface UpgradeValueEdit {
  feature: "upgrades";
  entity: string;
  field: string;
  before: number;
  after: number;
}

export interface RunStatEdit {
  feature: "run";
  entity: "run";
  field: string;
  before: number | string;
  after: number | string;
}

export type PendingEdit = PlayerHealthEdit | UpgradeValueEdit | RunStatEdit;
