import { useCallback, useEffect, useRef, useState } from "react";

import type { InstalledMapsDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/translations";

interface State {
  discovery: InstalledMapsDto | null;
  error: TranslationKey | null;
  loading: boolean;
}

const INITIAL_STATE: State = { discovery: null, error: null, loading: true };

export function useMaps() {
  const { t } = usePreferences();
  const [state, setState] = useState<State>(INITIAL_STATE);
  const mounted = useRef(false);
  const load = useCallback(async () => {
    try {
      const result = await window.repoditor.maps.list();
      if (mounted.current) {
        setState(result.ok ? { discovery: result.data, error: null, loading: false } : { discovery: null, error: operationErrorKey(result.error.code), loading: false });
      }
    } catch {
      if (mounted.current) setState({ discovery: null, error: "error.service", loading: false });
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);
  return { ...state, error: state.error ? t(state.error) : null, reload: load };
}
