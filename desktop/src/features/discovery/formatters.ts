const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatDateTime(value: string): string {
  return DATE_FORMATTER.format(new Date(value));
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const differenceSeconds = (new Date(value).getTime() - now) / 1000;
  const absoluteSeconds = Math.abs(differenceSeconds);

  if (absoluteSeconds < 60) {
    return "just now";
  }
  if (absoluteSeconds < 3_600) {
    return RELATIVE_FORMATTER.format(Math.round(differenceSeconds / 60), "minute");
  }
  if (absoluteSeconds < 86_400) {
    return RELATIVE_FORMATTER.format(Math.round(differenceSeconds / 3_600), "hour");
  }
  if (absoluteSeconds < 2_592_000) {
    return RELATIVE_FORMATTER.format(Math.round(differenceSeconds / 86_400), "day");
  }
  return formatDateTime(value);
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes === 0) {
    return "0 B";
  }
  const unitIndex = Math.min(
    Math.floor(Math.log(sizeBytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  );
  const value = sizeBytes / 1024 ** unitIndex;
  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${BYTE_UNITS[unitIndex]}`;
}

export function formatSaveCount(count: number): string {
  return `${count} ${count === 1 ? "save" : "saves"}`;
}
