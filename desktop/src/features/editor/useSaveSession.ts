/**
 * Renderer lifecycle for one opaque Run-save session and explicit writes.
 *
 * Pending feature edits remain outside this hook; it sends their typed union only on
 * explicit save and accepts Python's returned fingerprint/session as authoritative.
 */
import { useRef, useState } from "react";

import type { SaveChange, SaveOpenResult, SaveSession, SaveWriteResult } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/translations";

/**
 * Own one Run-save session without exposing decrypted data to the renderer.
 *
 * @returns The renderer-safe session, operations, and translated failure state.
 */
export function useSaveSession() {
  const { t } = usePreferences();
  const [session, setSession] = useState<SaveSession | null>(null);
  const [openingSaveId, setOpeningSaveId] = useState<string | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [saveError, setSaveError] = useState<TranslationKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastBackupPath, setLastBackupPath] = useState<string | null>(null);
  const requestInFlight = useRef(false);

  async function open(saveId: string): Promise<SaveOpenResult | null> {
    if (requestInFlight.current) {
      return null;
    }
    requestInFlight.current = true;
    setOpeningSaveId(saveId);
    setError(null);
    setSaveError(null);
    setLastBackupPath(null);
    try {
      const result = await window.repoditor.saves.open(saveId);
      if (result.ok) {
        return result.data;
      }
      setError(operationErrorKey(result.error.code));
    } catch {
      setError("error.service");
    } finally {
      requestInFlight.current = false;
      setOpeningSaveId(null);
    }
    return null;
  }

  function enter(opened: SaveOpenResult): void {
    setSession(opened.session);
    setError(null);
    setSaveError(null);
    setLastBackupPath(null);
  }

  async function write(changes: SaveChange[]): Promise<SaveWriteResult | null> {
    if (requestInFlight.current || session === null || changes.length === 0) {
      return null;
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
        return result.data;
      } else {
        setSaveError(operationErrorKey(result.error.code));
        return null;
      }
    } catch {
      setSaveError("error.write");
      return null;
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
    enter,
    write,
    close,
  };
}
