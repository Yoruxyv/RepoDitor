import { useCallback, useEffect, useRef, useState } from "react";

import type { RunStateDto, RunStatDto } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/translations";
import type { RunStatEdit } from "@/features/editor/pendingEdits";

interface State {
  run: RunStateDto | null;
  error: TranslationKey | null;
  loading: boolean;
}

const INITIAL_STATE: State = { run: null, error: null, loading: true };

export function useRunState(saveId: string) {
  const { t } = usePreferences();
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
            : { run: null, error: operationErrorKey(result.error.code), loading: false },
        );
      }
    } catch {
      if (mounted.current) {
        setState({ run: null, error: "error.service", loading: false });
      }
    }
  }, [saveId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  function updateStat(stat: RunStatDto, value: number): void {
    update({
      feature: "run",
      entity: "run",
      field: stat.key,
      before: stat.value,
      after: value,
      label: stat.label,
      subject: "Run",
    });
  }

  function updateResume(value: string): void {
    if (state.run) {
      update({
        feature: "run",
        entity: "run",
        field: "resumeLocation",
        before: state.run.resumeLocation.value,
        after: value,
        label: "Resume location",
        subject: "Run",
      });
    }
  }

  function update(edit: RunStatEdit): void {
    setPendingByField((current) => {
      if (edit.after === edit.before) {
        const next = { ...current };
        delete next[edit.field];
        return next;
      }
      return {
        ...current,
        [edit.field]: edit,
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

  function revertAll(): void {
    setPendingByField({});
  }

  return {
    ...state,
    error: state.error ? t(state.error) : null,
    pendingByField,
    pendingEdits: Object.values(pendingByField),
    updateStat,
    updateResume,
    revert,
    revertAll,
    reload: load,
  };
}
