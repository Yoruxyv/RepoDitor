import { useState } from "react";

import type {
  DesktopOperationResult,
  EnvironmentDiscovery,
  SaveSummary,
} from "../electron/contracts.cts";

function App() {
  const [bridgeStatus, setBridgeStatus] =
    useState("Not tested");
  const [environmentPending, setEnvironmentPending] =
    useState(false);
  const [environmentResult, setEnvironmentResult] =
    useState<
      DesktopOperationResult<EnvironmentDiscovery> | null
    >(null);
  const [saveResult, setSaveResult] =
    useState<
      DesktopOperationResult<SaveSummary[]> | null
    >(null);

  const handlePing = async () => {
    try {
      const response =
        await window.repoditor.app.ping();
      setBridgeStatus(
        response.ok
          ? response.message
          : "Bridge failed",
      );
    } catch {
      setBridgeStatus("Bridge unavailable");
    }
  };

  const handleEnvironmentDetect = async () => {
    setEnvironmentPending(true);
    try {
      setEnvironmentResult(
        await window.repoditor.environment.detect(),
      );
    } catch {
      setEnvironmentResult({
        ok: false,
        error: {
          code: "internal_error",
          message:
            "The preload bridge is unavailable.",
        },
      });
    } finally {
      setEnvironmentPending(false);
    }
  };

  const handleSaveList = async () => {
    try {
      setSaveResult(
        await window.repoditor.saves.list(),
      );
    } catch {
      setSaveResult({
        ok: false,
        error: {
          code: "internal_error",
          message:
            "The preload bridge is unavailable.",
        },
      });
    }
  };

  return (
    <main>
      <h1>RepoDitor</h1>

      <p>Desktop bridge diagnostics</p>

      <button
        type="button"
        onClick={handlePing}
      >
        Test Electron bridge
      </button>

      <p>Bridge: {bridgeStatus}</p>

      <button
        type="button"
        onClick={handleEnvironmentDetect}
        disabled={environmentPending}
      >
        {environmentPending
          ? "Detecting environment"
          : "Detect environment"}
      </button>

      {environmentResult &&
        (environmentResult.ok ? (
          <section aria-live="polite">
            <h2>Environment</h2>
            <p>
              Save root: {environmentResult.data.saveRootStatus}
            </p>
            <p>
              Saves: {environmentResult.data.saves.length}
            </p>
            <p>
              Game: {environmentResult.data.gameStatus}
            </p>
            <p>
              Game root: {environmentResult.data.gameRoot ?? "Not found"}
            </p>
          </section>
        ) : (
          <p role="alert">
            {environmentResult.error.code}: {environmentResult.error.message}
          </p>
        ))}

      <button
        type="button"
        onClick={handleSaveList}
      >
        Test save list
      </button>

      {saveResult &&
        (saveResult.ok ? (
          <p aria-live="polite">
            Save list returned {saveResult.data.length} entries.
          </p>
        ) : (
          <p role="alert">
            {saveResult.error.code}: {saveResult.error.message}
          </p>
        ))}
    </main>
  );
}

export default App;
