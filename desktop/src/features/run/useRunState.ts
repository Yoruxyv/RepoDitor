import { useCallback, useEffect, useRef, useState } from "react";

import type { RunStateDto, RunStatDto } from "@electron/contracts";
import type { RunStatEdit } from "@/features/editor/pendingEdits";

interface State {
  run: RunStateDto | null;
  error: string | null;
  loading: boolean;
}

const INITIAL_STATE: State = { run: null, error: null, loading: true };

export function useRunState(saveId: string) {
  const [state, setState] = useState<State>(INITIAL_STATE);
  const [pendingByField, setPendingByField] = useState<Record<string, RunStatEdit>>({});
  const mounted = useRef(false);

  const load = useCallback(async () => {
    try {
      const result = await window.repoditor.run.get(saveId);
      if (mounted.current) {
        setState(
          result.ok
            ? { run: result.data, error: null, loading: false }
            : { run: null, error: result.error.message, loading: false },
        );
      }
    } catch {
      if (mounted.current) {
        setState({ run: null, error: "The desktop run bridge is unavailable.", loading: false });
      }
    }
  }, [saveId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  function updateStat(stat: RunStatDto, value: number): void {
    update(stat.key, stat.value, value);
  }

  function updateResume(value: string): void {
    if (state.run) update("resumeLocation", state.run.resumeLocation.value, value);
  }

  function update(field: string, before: number | string, after: number | string): void {
    setPendingByField((current) => {
      if (after === before) {
        const next = { ...current };
        delete next[field];
        return next;
      }
      return {
        ...current,
        [field]: { feature: "run", entity: "run", field, before, after },
      };
    });
  }

  function revert(field: string): void {
    setPendingByField((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  return {
    ...state,
    pendingByField,
    pendingEdits: Object.values(pendingByField),
    updateStat,
    updateResume,
    revert,
    reload: load,
  };
}
