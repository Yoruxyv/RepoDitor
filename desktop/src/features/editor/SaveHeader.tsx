/** Selected-save identity and navigation, shared by native and Electron workspaces. */
import { ArrowLeftIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import type { SaveSession } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { PathDetails } from "@/components/PathDetails";
import { formatDateTime } from "@/features/discovery/formatters";

export function SaveHeader({
  session,
  onClose,
}: {
  readonly session: SaveSession;
  readonly onClose: () => void;
}) {
  const { locale, t } = usePreferences();
  return (
    <header className="grid gap-4 border-b border-line pb-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          {t("workspace.selectedSave")}
        </p>
        <h1
          className="font-display mt-1 truncate text-4xl font-semibold uppercase leading-none tracking-[-0.02em] text-ink"
          id="workspace-title"
          title={session.name}
        >
          {session.name}
        </h1>
        <div
          className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-secondary"
          data-testid="selected-save-metadata"
        >
          <span>
            {t("workspace.modified", { date: formatDateTime(session.modifiedAt, locale) })}
          </span>
          <span className="inline-flex items-center gap-1.5 text-success">
            <ShieldCheckIcon aria-hidden="true" size={15} />
            {t("workspace.validatedShort")}
          </span>
        </div>
        <PathDetails
          className="mt-2 max-w-full"
          label={t("workspace.source")}
          testId="selected-save-path"
          value={session.path}
        />
      </div>
      <button
        className="ui-feedback inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-sm border border-control bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
        type="button"
        onClick={onClose}
      >
        <ArrowLeftIcon aria-hidden="true" size={17} weight="bold" />
        {t("action.changeSave")}
      </button>
    </header>
  );
}
