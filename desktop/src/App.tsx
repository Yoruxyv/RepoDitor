import { useState } from "react";

function App() {
  const [status, setStatus] =
    useState("Not tested");

  const handlePing = async () => {
    try {
      const response =
        await window.repoditor.ping();

      setStatus(
        response.ok
          ? response.message
          : "Bridge failed",
      );
    } catch {
      setStatus("Bridge unavailable");
    }
  };

  return (
    <main>
      <h1>RepoDitor</h1>

      <p>
        Electron foundation test
      </p>

      <button
        type="button"
        onClick={handlePing}
      >
        Test Electron bridge
      </button>

      <p>
        Bridge: {status}
      </p>
    </main>
  );
}

export default App;
