import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DesktopOperationResult,
  RunStateDto,
  RunStatDto,
  SaveCanonicalRun,
} from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/translations";
import type { RunStatEdit } from "@/features/pending-changes/pendingEdits";

interface State {
  run: RunStateDto | null;
  error: TranslationKey | null;
  loading: boolean;
}

const INITIAL_STATE: State = { run: null, error: null, loading: true };

function initialState(result: DesktopOperationResult<RunStateDto> | null): State {
  if (result === null) return INITIAL_STATE;
  return result.ok
    ? { run: result.data, error: null, loading: false }
    : { run: null, error: operationErrorKey(result.error.code), loading: false };
}

export function useRunState(
  saveId: string,
  initialResult: DesktopOperationResult<RunStateDto> | null = null,
) {
  const { t } = usePreferences();
  const [state, setState] = useState<State>(() => initialState(initialResult));
  const initialResultRef = useRef(initialResult);
  const [pendingByField, setPendingByField] = useState<Record<string, RunStatEdit>>({});
  const mounted = useRef(false);

  const load = useCallback(
    async (preserveExisting = false): Promise<boolean> => {
      try {
        const result = await window.repoditor.run.get(saveId);
        if (!mounted.current) return result.ok;
        if (result.ok) {
          setState({ run: result.data, error: null, loading: false });
          return true;
        }
        setState((current) => ({
          run: preserveExisting ? current.run : null,
          error: operationErrorKey(result.error.code),
          loading: false,
        }));
        return false;
      } catch {
        if (mounted.current) {
          setState((current) => ({
            run: preserveExisting ? current.run : null,
            error: "error.service",
            loading: false,
          }));
        }
        return false;
      }
    },
    [saveId],
  );

  useEffect(() => {
    mounted.current = true;
    if (initialResultRef.current === null) void load(false);
    return () => {
      mounted.current = false;
    };
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

  function applyAfterSave(value: SaveCanonicalRun): boolean {
    const current = state.run;
    if (current === null) return false;
    const byKey = new Map(value.stats.map((stat) => [stat.key, stat.value]));
    if (value.stats.some((stat) => !current.stats.some((entry) => entry.key === stat.key))) {
      return false;
    }
    const resumeLocation =
      value.resumeLocation === undefined
        ? current.resumeLocation
        : {
            value: value.resumeLocation,
            options: current.resumeLocation.options.includes(value.resumeLocation)
              ? current.resumeLocation.options
              : [...current.resumeLocation.options, value.resumeLocation],
          };
    const nextRun = {
      stats: current.stats.map((stat) =>
        byKey.has(stat.key) ? { ...stat, value: byKey.get(stat.key)! } : stat,
      ),
      resumeLocation,
    };
    setState({ run: nextRun, error: null, loading: false });
    return true;
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
    applyAfterSave,
    reload: () => load(false),
    refreshAfterSave: () => load(true),
  };
}
