import { useRef, useState } from "react";

import type { SaveChange, SaveSession } from "@electron/contracts";

export function useSaveSession() {
  const [session, setSession] = useState<SaveSession | null>(null);
  const [openingSaveId, setOpeningSaveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastBackupPath, setLastBackupPath] = useState<string | null>(null);
  const requestInFlight = useRef(false);

  async function open(saveId: string): Promise<void> {
    if (requestInFlight.current) {
      return;
    }
    requestInFlight.current = true;
    setOpeningSaveId(saveId);
    setError(null);
    setSaveError(null);
    setLastBackupPath(null);
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

  async function write(changes: SaveChange[]): Promise<boolean> {
    if (requestInFlight.current || session === null || changes.length === 0) {
      return false;
    }
    requestInFlight.current = true;
    setSaving(true);
    setSaveError(null);
    setLastBackupPath(null);
    try {
      const result = await window.repoditor.saves.write(session.id, session.fingerprint, changes);
      if (result.ok) {
        setLastBackupPath(result.data.backupPath);
        setSession(result.data.session);
        return true;
      } else {
        setSaveError(result.error.message);
        return false;
      }
    } catch {
      setSaveError("The desktop save bridge is unavailable. Nothing was written.");
      return false;
    } finally {
      requestInFlight.current = false;
      setSaving(false);
    }
  }

  function close(): void {
    setSession(null);
    setSaveError(null);
    setLastBackupPath(null);
  }

  return {
    session,
    openingSaveId,
    error,
    saveError,
    saving,
    lastBackupPath,
    open,
    write,
    close,
  };
}
