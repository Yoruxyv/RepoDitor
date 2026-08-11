import {
  CheckCircleIcon,
  FolderIcon,
  GameControllerIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type {
  EnvironmentDiscovery,
  GameDiscoveryStatus,
  SaveRootStatus,
} from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import type { Translate } from "@/app/translations";
import { formatSaveCount } from "@/features/discovery/formatters";
import { PathText } from "./PathText";

type StatusTone = "success" | "warning" | "danger";

interface EnvironmentStatusProps {
  readonly environment: EnvironmentDiscovery;
}

interface EnvironmentRowProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly path: string | null;
  readonly status: string;
  readonly detail: string;
  readonly tone: StatusTone;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

function StatusIcon({ tone }: { readonly tone: StatusTone }) {
  if (tone === "success") {
    return <CheckCircleIcon aria-hidden="true" size={18} weight="fill" />;
  }
  if (tone === "warning") {
    return <WarningCircleIcon aria-hidden="true" size={18} weight="fill" />;
  }
  return <XCircleIcon aria-hidden="true" size={18} weight="fill" />;
}

function getSaveStatus(status: SaveRootStatus, count: number, t: Translate) {
  if (status === "available") {
    return {
      status: count === 0
        ? t("environment.folderDetected")
        : t("environment.savesFound", { saves: formatSaveCount(count, t) }),
      detail: count === 0 ? t("environment.noSlots") : t("environment.ready"),
      tone: "success" as const,
    };
  }
  if (status === "missing") {
    return {
      status: t("environment.folderMissing"),
      detail: t("environment.checkedStandard"),
      tone: "warning" as const,
    };
  }
  return {
    status: t("environment.folderUnavailable"),
    detail: t("environment.couldNotRead"),
    tone: "danger" as const,
  };
}

function getGameStatus(status: GameDiscoveryStatus, t: Translate) {
  if (status === "found") {
    return {
      status: t("environment.gameDetected"),
      detail: t("environment.validatedGame"),
      tone: "success" as const,
    };
  }
  if (status === "steam_not_found") {
    return {
      status: t("environment.steamMissing"),
      detail: t("environment.discoveryWorks"),
      tone: "warning" as const,
    };
  }
  if (status === "game_not_found") {
    return {
      status: t("environment.gameMissing"),
      detail: t("environment.checkedLibraries"),
      tone: "warning" as const,
    };
  }
  return {
    status: t("environment.librariesUnavailable"),
    detail: t("environment.discoveryWorks"),
    tone: "danger" as const,
  };
}

function EnvironmentRow({
  icon,
  label,
  path,
  status,
  detail,
  tone,
}: EnvironmentRowProps) {
  return (
    <div className="border-t border-line py-5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-muted">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{label}</p>
          <div className={`mt-2 flex items-center gap-2 text-sm font-medium ${TONE_CLASSES[tone]}`}>
            <StatusIcon tone={tone} />
            <span>{status}</span>
          </div>
          <p className="mt-1 text-xs/5 text-muted">{detail}</p>
        </div>
      </div>
      {path !== null && (
        <PathText
          className="mt-3 font-mono text-[0.7rem]/5 text-secondary"
          path={path}
        />
      )}
    </div>
  );
}

export function EnvironmentStatus({ environment }: EnvironmentStatusProps) {
  const { t } = usePreferences();
  const saveStatus = getSaveStatus(environment.saveRootStatus, environment.saves.length, t);
  const gameStatus = getGameStatus(environment.gameStatus, t);

  return (
    <aside className="self-start rounded-sm border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-base font-semibold text-ink">{t("environment.title")}</h2>
      <p className="mt-1 text-xs/5 text-muted">{t("environment.subtitle")}</p>

      <div className="mt-5">
        <EnvironmentRow
          detail={gameStatus.detail}
          icon={<GameControllerIcon aria-hidden="true" size={20} weight="regular" />}
          label={t("environment.game")}
          path={environment.gameRoot}
          status={gameStatus.status}
          tone={gameStatus.tone}
        />
        <EnvironmentRow
          detail={saveStatus.detail}
          icon={<FolderIcon aria-hidden="true" size={20} weight="regular" />}
          label={t("environment.saveFolder")}
          path={environment.saveRoot}
          status={saveStatus.status}
          tone={saveStatus.tone}
        />
      </div>
    </aside>
  );
}
