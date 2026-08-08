import {
  ArrowClockwiseIcon,
  FolderIcon,
  FolderOpenIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

import type {
  DesktopOperationError,
  SaveRootStatus,
} from "@electron/contracts";
import { PathText } from "./PathText";

interface DiscoveryStateProps {
  readonly saveRoot: string;
  readonly status: SaveRootStatus;
}

interface DiscoveryFailureProps {
  readonly error: DesktopOperationError;
  readonly onRetry: () => void;
}

function getContent(status: SaveRootStatus) {
  if (status === "missing") {
    return {
      icon: <FolderIcon aria-hidden="true" size={28} weight="regular" />,
      title: "Standard save folder not found",
      description:
        "RepoDitor checked the normal R.E.P.O. save location. The folder may appear after the game creates its first save.",
    };
  }
  if (status === "unreadable") {
    return {
      icon: <WarningCircleIcon aria-hidden="true" size={28} weight="regular" />,
      title: "Save folder could not be read",
      description:
        "The save location exists, but RepoDitor could not inspect it. Check folder access, then refresh discovery.",
    };
  }
  return {
    icon: <FolderOpenIcon aria-hidden="true" size={28} weight="regular" />,
    title: "No valid saves yet",
    description: "The save folder is ready, but it does not contain a valid R.E.P.O. save slot yet.",
  };
}

export function DiscoveryState({ saveRoot, status }: DiscoveryStateProps) {
  const content = getContent(status);

  return (
    <section className="rounded-sm border border-line bg-surface p-6 sm:p-8">
      <div className="mb-5 text-accent">{content.icon}</div>
      <h2 className="text-xl font-semibold text-ink">{content.title}</h2>
      <p className="mt-2 max-w-[60ch] text-sm/6 text-secondary">
        {content.description}
      </p>
      <div className="mt-6 border-t border-line pt-4">
        <span className="text-xs font-medium text-muted">Path checked</span>
        <PathText
          className="mt-1 font-mono text-xs/5 text-secondary"
          path={saveRoot}
        />
      </div>
    </section>
  );
}

export function DiscoveryFailure({ error, onRetry }: DiscoveryFailureProps) {
  return (
    <section className="mx-auto max-w-2xl border-l-2 border-danger bg-surface px-6 py-8 sm:px-8">
      <WarningCircleIcon
        aria-hidden="true"
        className="text-danger"
        size={30}
        weight="regular"
      />
      <h1 className="font-display mt-5 text-4xl font-semibold uppercase leading-none text-ink sm:text-5xl">
        Local discovery is unavailable
      </h1>
      <p className="mt-4 max-w-[58ch] text-sm/6 text-secondary">
        {error.message} RepoDitor has not changed any save files.
      </p>
      <button
        className="mt-7 inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition duration-150 hover:bg-accent-strong active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
        type="button"
        onClick={onRetry}
      >
        <ArrowClockwiseIcon aria-hidden="true" size={17} weight="bold" />
        Try again
      </button>
    </section>
  );
}
