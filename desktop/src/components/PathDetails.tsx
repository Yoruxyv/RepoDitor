/**
 * Selected-save source disclosure with bounded clipboard feedback.
 *
 * This is the intentional user-visible path exception; ordinary discovery cards and
 * feature views avoid exposing filesystem details.
 */
import { CheckIcon, CopyIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { usePreferences } from "@/app/preferences";

interface PathDetailsProps {
  readonly label: string;
  readonly value: string;
  readonly className?: string;
  readonly testId?: string;
}

function pathName(value: string): string {
  return value.split(/[\\/]/).at(-1) || value;
}

export function PathDetails({ label, value, className = "", testId }: PathDetailsProps) {
  const { t } = usePreferences();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <details className={className} data-testid={testId}>
      <summary className="cursor-pointer text-xs font-semibold text-accent">
        {label}: <span className="font-mono font-normal text-secondary">{pathName(value)}</span>
      </summary>
      <div className="mt-2 flex min-w-0 flex-wrap items-start gap-2">
        <code className="min-w-0 flex-1 break-all text-xs/5 text-muted">{value}</code>
        <button
          aria-label={t("action.copyPath", { label })}
          className="ui-feedback inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-control px-2.5 py-1.5 text-xs font-semibold text-secondary hover:border-accent hover:text-accent"
          type="button"
          onClick={() => void copy()}
        >
          <CopyIcon aria-hidden="true" size={14} />
          {t("action.copy")}
        </button>
      </div>
      {copyState !== "idle" ? (
        <output
          aria-live="polite"
          className={`mt-1 flex items-center gap-1.5 text-xs ${copyState === "copied" ? "text-success" : "text-danger"}`}
        >
          {copyState === "copied" ? (
            <CheckIcon aria-hidden="true" size={14} />
          ) : (
            <WarningCircleIcon aria-hidden="true" size={14} />
          )}
          {t(copyState === "copied" ? "status.pathCopied" : "error.copyPath")}
        </output>
      ) : null}
    </details>
  );
}
