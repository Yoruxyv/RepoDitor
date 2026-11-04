/** Owns fail-soft renderer loading state for the read-only installed map catalog. */
import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopOperationResult, InstalledMapsDto, RepoDitorApi } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/i18n";

interface State {
  discovery: InstalledMapsDto | null;
  error: TranslationKey | null;
  loading: boolean;
  artworkAttempt: number;
}

const INITIAL_STATE: State = { discovery: null, error: null, loading: true, artworkAttempt: 0 };

const listDesktopMaps: RepoDitorApi["maps"]["list"] = () => window.repoditor.maps.list();

function initialState(result: DesktopOperationResult<InstalledMapsDto> | null): State {
  if (result === null) return INITIAL_STATE;
  return result.ok
    ? { discovery: result.data, error: null, loading: false, artworkAttempt: 0 }
    : {
        discovery: null,
        error: operationErrorKey(result.error.code),
        loading: false,
        artworkAttempt: 0,
      };
}

export function useMaps(
  initialResult: DesktopOperationResult<InstalledMapsDto> | null = null,
  list: RepoDitorApi["maps"]["list"] = listDesktopMaps,
) {
  const { t } = usePreferences();
  const [state, setState] = useState<State>(() => initialState(initialResult));
  const initialResultRef = useRef(initialResult);
  const mounted = useRef(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setState((old) => ({ ...old, loading: true, error: null }));
    try {
      const result = await list();
      if (mounted.current && current === request.current) {
        setState(
          result.ok
            ? { discovery: result.data, error: null, loading: false, artworkAttempt: current }
            : (old) => ({ ...old, error: operationErrorKey(result.error.code), loading: false }),
        );
      }
    } catch {
      if (mounted.current && current === request.current)
        setState((old) => ({ ...old, error: "error.service", loading: false }));
    }
  }, [list]);
  useEffect(() => {
    mounted.current = true;
    const initialRequest =
      initialResultRef.current === null ? window.setTimeout(() => void load()) : undefined;
    return () => {
      mounted.current = false;
      request.current += 1;
      if (initialRequest !== undefined) window.clearTimeout(initialRequest);
    };
  }, [load]);
  return { ...state, error: state.error ? t(state.error) : null, reload: load };
}
