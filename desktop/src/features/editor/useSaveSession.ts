/**
 * Renderer lifecycle for one opaque Run-save session and explicit writes.
 *
 * Pending feature edits remain outside this hook; it sends their typed union only on
 * explicit save and accepts Python's returned fingerprint/session as authoritative.
 */
import { useEffect, useRef, useState } from "react";

import type {
  RepoDitorApi,
  SaveChange,
  SaveOpenResult,
  SaveSession,
  SaveWriteResult,
} from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/i18n";

const desktopOpen: RepoDitorApi["saves"]["open"] = (saveId) => window.repoditor.saves.open(saveId);
type OpenSave = (saveId: string, signal: AbortSignal) => ReturnType<typeof desktopOpen>;

/**
 * Own one Run-save session without exposing decrypted data to the renderer.
 *
 * @returns The renderer-safe session, operations, and translated failure state.
 */
export function useSaveSession(openSave: OpenSave = desktopOpen) {
  const { t } = usePreferences();
  const [session, setSession] = useState<SaveSession | null>(null);
  const [openingSaveId, setOpeningSaveId] = useState<string | null>(null);
  const [drainingOpen, setDrainingOpen] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [saveError, setSaveError] = useState<TranslationKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastBackupPath, setLastBackupPath] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const activeOpen = useRef<AbortController | null>(null);
  useEffect(() => () => activeOpen.current?.abort(), []);

  async function open(saveId: string): Promise<SaveOpenResult | null> {
    if (requestInFlight.current) {
      return null;
    }
    requestInFlight.current = true;
    const request = new AbortController();
    activeOpen.current = request;
    setOpeningSaveId(saveId);
    setError(null);
    setSaveError(null);
    setLastBackupPath(null);
    try {
      const result = await openSave(saveId, request.signal);
      if (request.signal.aborted) return null;
      if (result.ok) {
        return result.data;
      }
      setError(
        result.error.code === "save_stale"
          ? "error.saveOpenStale"
          : operationErrorKey(result.error.code),
      );
    } catch {
      if (!request.signal.aborted) setError("error.service");
    } finally {
      requestInFlight.current = false;
      activeOpen.current = null;
      setOpeningSaveId(null);
      if (request.signal.aborted) setDrainingOpen(false);
    }
    return null;
  }

  function cancelOpen(): void {
    if (!activeOpen.current) return;
    // Wait for the current read to drain before opening another save.
    activeOpen.current.abort();
    setOpeningSaveId(null);
    setDrainingOpen(true);
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
    drainingOpen,
    error: error ? t(error) : null,
    saveError: saveError ? t(saveError) : null,
    saving,
    lastBackupPath,
    open,
    cancelOpen,
    enter,
    write,
    close,
  };
}
