/** Read-only MetaSave loading without pending changes, artwork preparation or writes. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CosmeticsViewDto, RepoDitorApi } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/i18n";

export function useCosmeticsRead(
  active: boolean,
  recoveryGeneration: number,
  get: RepoDitorApi["cosmetics"]["get"],
) {
  const { t } = usePreferences();
  const [state, setState] = useState<{
    view: CosmeticsViewDto | null;
    error: TranslationKey | null;
    loading: boolean;
  }>({ view: null, error: null, loading: true });
  const mounted = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const current = ++request.current;
    const read = async () => {
      setState((old) => ({ ...old, error: null, loading: true }));
      try {
        const result = await get();
        if (mounted.current && current === request.current)
          setState(
            result.ok
              ? { view: result.data, error: null, loading: false }
              : { view: null, error: operationErrorKey(result.error.code), loading: false },
          );
      } catch {
        if (mounted.current && current === request.current)
          setState({ view: null, error: "error.service", loading: false });
      }
    };
    inFlight.current = read();
    try {
      await inFlight.current;
    } finally {
      inFlight.current = null;
    }
  }, [get]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, []);
  useEffect(() => {
    const generation = ++request.current;
    if (!active) return;
    const initial = window.setTimeout(() => {
      const start = () => {
        if (mounted.current && generation === request.current) void load();
      };
      if (inFlight.current) void inFlight.current.then(start);
      else start();
    });
    return () => {
      window.clearTimeout(initial);
      request.current += 1;
    };
  }, [active, load, recoveryGeneration]);
  return { ...state, error: state.error ? t(state.error) : null, reload: load };
}
