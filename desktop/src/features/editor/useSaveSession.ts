import { useRef, useState } from "react";

import type { SaveChange, SaveSession } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/translations";

export function useSaveSession() {
  const { t } = usePreferences();
  const [session, setSession] = useState<SaveSession | null>(null);
  const [openingSaveId, setOpeningSaveId] = useState<string | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [saveError, setSaveError] = useState<TranslationKey | null>(null);
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
        setError(operationErrorKey(result.error.code));
      }
    } catch {
      setError("error.service");
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
        setSaveError(operationErrorKey(result.error.code));
        return false;
      }
    } catch {
      setSaveError("error.write");
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
    error: error ? t(error) : null,
    saveError: saveError ? t(saveError) : null,
    saving,
    lastBackupPath,
    open,
    write,
    close,
  };
}
