import { useRef, useState } from "react";

import type { SaveSession } from "../../../electron/contracts.cts";

export function useSaveSession() {
  const [session, setSession] = useState<SaveSession | null>(null);
  const [openingSaveId, setOpeningSaveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestInFlight = useRef(false);

  async function open(saveId: string): Promise<void> {
    if (requestInFlight.current) {
      return;
    }
    requestInFlight.current = true;
    setOpeningSaveId(saveId);
    setError(null);
    try {
      const result = await window.repoditor.saves.open(saveId);
      if (result.ok) {
        setSession(result.data);
      } else {
        setError(result.error.message);
      }
    } catch {
      setError("The desktop save bridge is unavailable.");
    } finally {
      requestInFlight.current = false;
      setOpeningSaveId(null);
    }
  }

  return {
    session,
    openingSaveId,
    error,
    open,
    close: () => setSession(null),
  };
}
