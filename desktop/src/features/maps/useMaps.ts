import { useCallback, useEffect, useRef, useState } from "react";

import type { InstalledMapsDto } from "@electron/contracts";

interface State {
  discovery: InstalledMapsDto | null;
  error: string | null;
  loading: boolean;
}

const INITIAL_STATE: State = { discovery: null, error: null, loading: true };

export function useMaps() {
  const [state, setState] = useState<State>(INITIAL_STATE);
  const mounted = useRef(false);
  const load = useCallback(async () => {
    try {
      const result = await window.repoditor.maps.list();
      if (mounted.current) {
        setState(result.ok ? { discovery: result.data, error: null, loading: false } : { discovery: null, error: result.error.message, loading: false });
      }
    } catch {
      if (mounted.current) setState({ discovery: null, error: "The desktop maps bridge is unavailable.", loading: false });
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);
  return { ...state, reload: load };
}
