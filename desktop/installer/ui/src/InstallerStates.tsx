import type { InstallerMode, InstallerScope, InstallerStage } from "./bridge/webview";

interface ReadyStateProps {
  readonly initialized: boolean;
  readonly mode: InstallerMode;
  readonly updating: boolean;
  readonly scope: InstallerScope;
  readonly scopeLocked: boolean;
  readonly showScope: boolean;
  readonly path: string;
  readonly onScopeChange: (scope: InstallerScope) => void;
  readonly onChoosePath: () => void;
  readonly onCancel: () => void;
  readonly onStart: () => void;
}

export function ReadyState({
  initialized,
  mode,
  updating,
  scope,
  scopeLocked,
  showScope,
  path,
  onScopeChange,
  onChoosePath,
  onCancel,
  onStart,
}: ReadyStateProps) {
  const uninstalling = mode === "uninstall";
  const scopeDisabled = updating || scopeLocked;
  let heading = "Ready to install";
  let action = "Install";
  if (uninstalling) {
    heading = "Uninstall RepoDitor?";
    action = "Uninstall";
  } else if (updating) {
    heading = "Ready to update";
    action = "Update";
  }

  return (
    <div className="installer-state state-install">
      <h1>{heading}</h1>
      <p className="intro">
        {uninstalling
          ? "RepoDitor application data will be removed. R.E.P.O. saves and game data stay untouched."
          : "Choose where RepoDitor should live. Your R.E.P.O. saves stay untouched."}
      </p>

      {showScope ? (
        <fieldset className="group scope-group">
          <legend className="label">{uninstalling ? "REMOVE INSTALLATION" : "INSTALL FOR"}</legend>
          <div className="scope">
            <input
              id="current"
              name="scope"
              type="radio"
              checked={scope === "current"}
              disabled={scopeDisabled}
              onChange={() => onScopeChange("current")}
            />
            <label htmlFor="current">Current user</label>

            <input
              id="all"
              name="scope"
              type="radio"
              checked={scope === "all"}
              disabled={scopeDisabled}
              onChange={() => onScopeChange("all")}
            />
            <label htmlFor="all">All users</label>
          </div>
        </fieldset>
      ) : null}

      {!uninstalling ? (
        <div className="group">
          <label className="label" htmlFor="pathField">
            INSTALL LOCATION
          </label>
          <div className="location-row">
            <input
              id="pathField"
              className="path"
              type="text"
              value={path}
              title={path}
              readOnly
              aria-readonly="true"
              spellCheck={false}
            />
            <button className="change" type="button" disabled={updating} onClick={onChoosePath}>
              Change
            </button>
          </div>
        </div>
      ) : null}

      <div className="spacer" />

      <div className="actions">
        <button className="btn secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" type="button" disabled={!initialized} onClick={onStart}>
          {action}
        </button>
      </div>
    </div>
  );
}

interface ProgressStateProps {
  readonly mode: InstallerMode;
  readonly stage: InstallerStage;
}

const stageMessages: Record<InstallerMode, Record<InstallerStage, string>> = {
  install: {
    preparing: "Preparing installation…",
    installing: "Running installation…",
    finalizing: "Verifying installation…",
  },
  uninstall: {
    preparing: "Preparing removal…",
    installing: "Running removal…",
    finalizing: "Verifying removal…",
  },
};

export function ProgressState({ mode, stage }: ProgressStateProps) {
  const uninstalling = mode === "uninstall";
  return (
    <div className="installer-state state-progress">
      <h1>{uninstalling ? "Removing RepoDitor" : "Installing RepoDitor"}</h1>
      <p className="intro">
        {uninstalling
          ? "Removing the application. Your R.E.P.O. saves and game data are not being modified."
          : "Setting up the application. Your game data is not being modified."}
      </p>
      <div className="progress-track">
        <progress
          className="progress-bar"
          aria-label={uninstalling ? "Removal progress" : "Installation progress"}
          aria-valuetext={stageMessages[mode][stage]}
        />
      </div>
      <output className="status-note">{stageMessages[mode][stage]}</output>
      <div className="spacer" />
    </div>
  );
}

interface ResultStateProps {
  readonly mode: InstallerMode;
  readonly failed: boolean;
  readonly message: string;
  readonly onClose: () => void;
  readonly onResult: () => void;
}

export function ResultState({ mode, failed, message, onClose, onResult }: ResultStateProps) {
  const uninstalling = mode === "uninstall";
  let action = "Launch RepoDitor";
  let heading = "RepoDitor is ready";
  if (failed) {
    action = "Retry";
    heading = uninstalling ? "Uninstall failed" : "Installation failed";
  } else if (uninstalling) {
    action = "Close";
    heading = "Uninstall finished";
  }
  const description =
    message ||
    (uninstalling
      ? "RepoDitor application data was removed. R.E.P.O. saves and game data were not targeted."
      : "Installation finished successfully.");

  return (
    <div className={`installer-state state-done${failed ? " is-error" : ""}`}>
      <div className="check" aria-hidden="true">
        {failed ? "!" : "✓"}
      </div>
      <h1>{heading}</h1>
      <p className="intro" role={failed ? "alert" : "status"}>
        {description}
      </p>
      <div className="spacer" />
      <div className="actions">
        {!uninstalling || failed ? (
          <button className="btn secondary" type="button" onClick={onClose}>
            Close
          </button>
        ) : null}
        <button className="btn primary" type="button" onClick={onResult}>
          {action}
        </button>
      </div>
    </div>
  );
}
