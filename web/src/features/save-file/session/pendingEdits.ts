export interface PendingEdit {
  readonly after: number | string;
  readonly before: number | string;
  readonly field: string;
  readonly id: string;
  readonly subject: string;
}
