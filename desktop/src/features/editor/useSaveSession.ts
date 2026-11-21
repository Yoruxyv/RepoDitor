/**
 * Renderer lifecycle for one opaque Run-save session during preparation.
 *
 */
import { useEffect, useRef, useState } from "react";

import type {
  DesktopOperationErrorCode,
  DesktopOperationResult,
  SaveOpenResult,
  SaveSession,
} from "@/app/desktopContracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/i18n";

type OpenSave = (
  saveId: string,
  signal: AbortSignal,
) => Promise<DesktopOperationResult<SaveOpenResult>>;

function openErrorKey(code: DesktopOperationErrorCode): TranslationKey {
  if (code === "save_stale") return "error.saveOpenStale";
  if (code === "process_timeout") return "error.saveOpenTimeout";
  return operationErrorKey(code);
}

/**
 * Own one Run-save session without exposing decrypted data to the renderer.
 *
 * @returns The renderer-safe session, operations, and translated failure state.
 */
export function useSaveSession(openSave: OpenSave) {
  const { t } = usePreferences();
  const [session, setSession] = useState<SaveSession | null>(null);
  const [openingSaveId, setOpeningSaveId] = useState<string | null>(null);
  const [drainingOpen, setDrainingOpen] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
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
    try {
      const result = await openSave(saveId, request.signal);
      if (request.signal.aborted) return null;
      if (result.ok) {
        return result.data;
      }
      setError(openErrorKey(result.error.code));
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
  }

  function close(): void {
    setSession(null);
  }

  return {
    session,
    openingSaveId,
    drainingOpen,
    error: error ? t(error) : null,
    open,
    cancelOpen,
    enter,
    close,
  };
}
