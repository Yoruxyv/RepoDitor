/** Read-only MetaSave loading without pending changes, artwork preparation or writes. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CosmeticsViewDto, RepoDitorApi } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { operationErrorKey, type TranslationKey } from "@/app/i18n";

export function useCosmeticsRead(
  active: boolean,
  recoveryGeneration: number,
  get: RepoDitorApi["cosmetics"]["get"],
) {
  const { t } = usePreferences();
  const [refresh, setRefresh] = useState(0);
  // Hide retained tokens in the commit that precedes the read which revokes them.
  const request = useMemo(
    () => ({ active, recoveryGeneration, refresh, get }),
    [active, recoveryGeneration, refresh, get],
  );
  const [state, setState] = useState<{
    request: typeof request;
    view: CosmeticsViewDto | null;
    error: TranslationKey | null;
  } | null>(null);
  const committed = useRef<typeof request | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  useLayoutEffect(() => {
    committed.current = request;
    return () => {
      committed.current = null;
    };
  }, [request]);
  useEffect(() => {
    if (!request.active) return;
    let cancelled = false;
    const isCurrent = () => !cancelled && committed.current === request;
    async function read() {
      try {
        const result = await request.get();
        if (isCurrent())
          setState(
            result.ok
              ? { request, view: result.data, error: null }
              : { request, view: null, error: operationErrorKey(result.error.code) },
          );
      } catch {
        if (isCurrent()) setState({ request, view: null, error: "error.service" });
      }
    }
    async function load() {
      await inFlight.current;
      if (!isCurrent()) return;
      inFlight.current = read();
      await inFlight.current;
      inFlight.current = null;
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [request]);

  const current = active && state?.request === request;
  return {
    view: state?.view ?? null,
    error: current && state.error ? t(state.error) : null,
    loading: !current,
    reload() {
      if (current) setRefresh(refresh + 1);
    },
  };
}
