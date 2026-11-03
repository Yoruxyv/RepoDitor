/** Read-only native workspace using the production save header and Overview. */
import type { SaveSession } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { OverviewView } from "./OverviewView";
import { SaveHeader } from "./SaveHeader";

export function TauriOverview({
  session,
  onClose,
}: {
  readonly session: SaveSession;
  readonly onClose: () => void;
}) {
  const { t } = usePreferences();
  return (
    <section aria-labelledby="workspace-title" className="pb-4" data-testid="workspace">
      <SaveHeader session={session} onClose={onClose} />
      <nav className="overflow-x-auto border-b border-line" aria-label={t("workspace.sections")}>
        <div className="flex min-w-max gap-1 py-2" role="tablist">
          <button
            aria-controls="workspace-panel"
            aria-selected="true"
            className="ui-feedback rounded-sm bg-accent py-2.5 pr-1.5 pl-4 text-sm font-semibold text-accent-ink"
            id="overview-tab"
            role="tab"
            type="button"
          >
            {t("nav.overview")}
            <span aria-hidden="true" className="ml-1 inline-block size-1.5 align-middle" />
          </button>
        </div>
      </nav>
      <div className="pt-6">
        <div
          aria-labelledby="overview-tab"
          className="min-w-0"
          id="workspace-panel"
          role="tabpanel"
          tabIndex={0}
        >
          <OverviewView session={session} onNavigate={null} />
        </div>
      </div>
    </section>
  );
}
