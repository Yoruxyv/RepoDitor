import { useEffect, useState } from "react";

interface IntegerInputProps {
  readonly error: string;
  readonly id: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly onValueChange: (value: number) => void;
  readonly resetToken: object;
  readonly value: number;
}

function acceptedInteger(draft: string, minimum: number, maximum: number): number | null {
  const parsed = Number(draft);
  return draft.trim() !== "" &&
    Number.isSafeInteger(parsed) &&
    parsed >= minimum &&
    parsed <= maximum
    ? parsed
    : null;
}

export function IntegerInput({
  error,
  id,
  maximum,
  minimum,
  onValueChange,
  resetToken,
  value,
}: IntegerInputProps) {
  const [draft, setDraft] = useState(String(value));
  const invalid = acceptedInteger(draft, minimum, maximum) === null;

  useEffect(() => setDraft(String(value)), [resetToken, value]);

  return (
    <>
      <input
        aria-describedby={invalid ? `${id}-error` : undefined}
        aria-invalid={invalid || undefined}
        className="block w-36 max-w-full rounded-sm border border-control bg-surface px-3 py-2 font-mono text-sm text-ink focus:border-accent"
        id={id}
        inputMode="numeric"
        max={maximum}
        min={minimum}
        step="1"
        type="number"
        value={draft}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
          const nextValue = acceptedInteger(nextDraft, minimum, maximum);
          if (nextValue !== null && nextValue !== value) {
            onValueChange(nextValue);
          }
        }}
      />
      {invalid ? (
        <p className="mt-2 text-xs text-accent" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
