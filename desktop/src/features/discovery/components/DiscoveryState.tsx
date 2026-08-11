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
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type Translate } from "@/app/translations";
import { PathText } from "./PathText";

interface DiscoveryStateProps {
  readonly saveRoot: string;
  readonly status: SaveRootStatus;
}

interface DiscoveryFailureProps {
  readonly error: DesktopOperationError;
  readonly onRetry: () => void;
}

function getContent(status: SaveRootStatus, t: Translate) {
  if (status === "missing") {
    return {
      icon: <FolderIcon aria-hidden="true" size={28} weight="regular" />,
      title: t("discovery.state.missingTitle"),
      description: t("discovery.state.missingDescription"),
    };
  }
  if (status === "unreadable") {
    return {
      icon: <WarningCircleIcon aria-hidden="true" size={28} weight="regular" />,
      title: t("discovery.state.unreadableTitle"),
      description: t("discovery.state.unreadableDescription"),
    };
  }
  return {
    icon: <FolderOpenIcon aria-hidden="true" size={28} weight="regular" />,
    title: t("discovery.state.emptyTitle"),
    description: t("discovery.state.emptyDescription"),
  };
}

export function DiscoveryState({ saveRoot, status }: DiscoveryStateProps) {
  const { t } = usePreferences();
  const content = getContent(status, t);

  return (
    <section className="rounded-sm border border-line bg-surface p-6 sm:p-8">
      <div className="mb-5 text-accent">{content.icon}</div>
      <h2 className="text-xl font-semibold text-ink">{content.title}</h2>
      <p className="mt-2 max-w-[60ch] text-sm/6 text-secondary">
        {content.description}
      </p>
      <div className="mt-6 border-t border-line pt-4">
        <span className="text-xs font-medium text-muted">{t("discovery.pathChecked")}</span>
        <PathText
          className="mt-1 font-mono text-xs/5 text-secondary"
          path={saveRoot}
        />
      </div>
    </section>
  );
}

export function DiscoveryFailure({ error, onRetry }: DiscoveryFailureProps) {
  const { t } = usePreferences();
  return (
    <section className="mx-auto max-w-2xl border-l-2 border-danger bg-surface px-6 py-8 sm:px-8">
      <WarningCircleIcon
        aria-hidden="true"
        className="text-danger"
        size={30}
        weight="regular"
      />
      <h1 className="font-display mt-3 text-4xl font-semibold uppercase leading-none text-ink sm:text-[2.5rem]">
        {t("discovery.failureTitle")}
      </h1>
      <p className="mt-4 max-w-[58ch] text-sm/6 text-secondary">
        {t("discovery.failureDescription", { error: t(operationErrorKey(error.code)) })}
      </p>
      <button
        className="ui-feedback mt-7 inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
        type="button"
        onClick={onRetry}
      >
        <ArrowClockwiseIcon aria-hidden="true" size={17} weight="bold" />
        {t("action.tryAgain")}
      </button>
    </section>
  );
}
