import {
  CheckCircle,
  Folder,
  GameController,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type {
  EnvironmentDiscovery,
  GameDiscoveryStatus,
  SaveRootStatus,
} from "../../../../electron/contracts.cts";
import { formatSaveCount } from "../formatters";
import { PathText } from "./PathText";

type StatusTone = "success" | "warning" | "danger";

interface EnvironmentStatusProps {
  environment: EnvironmentDiscovery;
}

interface EnvironmentRowProps {
  icon: ReactNode;
  label: string;
  path: string | null;
  status: string;
  detail: string;
  tone: StatusTone;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

function StatusIcon({ tone }: { tone: StatusTone }) {
  if (tone === "success") {
    return <CheckCircle aria-hidden="true" size={18} weight="fill" />;
  }
  if (tone === "warning") {
    return <WarningCircle aria-hidden="true" size={18} weight="fill" />;
  }
  return <XCircle aria-hidden="true" size={18} weight="fill" />;
}

function getSaveStatus(status: SaveRootStatus, count: number) {
  if (status === "available") {
    return {
      status: count === 0 ? "Folder detected" : `${formatSaveCount(count)} found`,
      detail: count === 0 ? "No valid save slots yet" : "Ready for selection",
      tone: "success" as const,
    };
  }
  if (status === "missing") {
    return {
      status: "Folder not found",
      detail: "Checked the standard location",
      tone: "warning" as const,
    };
  }
  return {
    status: "Folder unavailable",
    detail: "The location could not be read",
    tone: "danger" as const,
  };
}

function getGameStatus(status: GameDiscoveryStatus) {
  if (status === "found") {
    return {
      status: "Detected",
      detail: "Validated R.E.P.O. installation",
      tone: "success" as const,
    };
  }
  if (status === "steam_not_found") {
    return {
      status: "Steam not detected",
      detail: "Save discovery still works",
      tone: "warning" as const,
    };
  }
  if (status === "game_not_found") {
    return {
      status: "Game not found",
      detail: "Checked configured Steam libraries",
      tone: "warning" as const,
    };
  }
  return {
    status: "Libraries unavailable",
    detail: "Save discovery still works",
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
          <p className="mt-1 text-xs leading-5 text-muted">{detail}</p>
        </div>
      </div>
      {path !== null && (
        <PathText
          className="mt-3 font-mono text-[0.7rem] leading-5 text-secondary"
          path={path}
        />
      )}
    </div>
  );
}

export function EnvironmentStatus({ environment }: EnvironmentStatusProps) {
  const saveStatus = getSaveStatus(environment.saveRootStatus, environment.saves.length);
  const gameStatus = getGameStatus(environment.gameStatus);

  return (
    <aside className="self-start rounded-sm border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-base font-semibold text-ink">Local environment</h2>
      <p className="mt-1 text-xs leading-5 text-muted">Automatic discovery on this PC</p>

      <div className="mt-5">
        <EnvironmentRow
          detail={gameStatus.detail}
          icon={<GameController aria-hidden="true" size={20} weight="regular" />}
          label="R.E.P.O. game"
          path={environment.gameRoot}
          status={gameStatus.status}
          tone={gameStatus.tone}
        />
        <EnvironmentRow
          detail={saveStatus.detail}
          icon={<Folder aria-hidden="true" size={20} weight="regular" />}
          label="Save folder"
          path={environment.saveRoot}
          status={saveStatus.status}
          tone={saveStatus.tone}
        />
      </div>
    </aside>
  );
}
