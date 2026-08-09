import { useCallback, useEffect, useRef, useState } from "react";

import type { AdvancedSaveDto } from "@electron/contracts";

interface State {
  advanced: AdvancedSaveDto | null;
  error: string | null;
  loading: boolean;
}

const INITIAL_STATE: State = { advanced: null, error: null, loading: true };

export function useAdvanced(saveId: string) {
  const [state, setState] = useState<State>(INITIAL_STATE);
  const mounted = useRef(false);

  const load = useCallback(async () => {
    try {
      const result = await window.repoditor.advanced.get(saveId);
      if (mounted.current) {
        setState(
          result.ok
            ? { advanced: result.data, error: null, loading: false }
            : { advanced: null, error: result.error.message, loading: false },
        );
      }
    } catch {
      if (mounted.current) {
        setState({
          advanced: null,
          error: "The desktop advanced-data bridge is unavailable.",
          loading: false,
        });
      }
    }
  }, [saveId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  return { ...state, reload: load };
}
