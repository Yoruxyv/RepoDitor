/** Validate the current MetaSave and prepare its artwork before publishing the catalog. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CosmeticsViewDto, RepoDitorApi } from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { prepareNativeCosmeticArtwork } from "@/app/tauriArtwork";
import { operationErrorKey, type TranslationKey } from "@/app/i18n";

export function useCosmeticsRead(
  active: boolean,
  recoveryGeneration: number,
  get: RepoDitorApi["cosmetics"]["get"],
  sourceFingerprint?: string,
) {
  const { t } = usePreferences();
  const [refresh, setRefresh] = useState(0);
  // Hide retained tokens in the commit that precedes the read which revokes them.
  const request = useMemo(
    () => ({ active, recoveryGeneration, refresh, get, sourceFingerprint }),
    [active, recoveryGeneration, refresh, get, sourceFingerprint],
  );
  const [state, setState] = useState<{
    request: typeof request;
    view: CosmeticsViewDto | null;
    error: TranslationKey | null;
  } | null>(null);
  const [artwork, setArtwork] = useState<{
    request: typeof request;
    completed: number;
    total: number;
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
    const work = new AbortController();
    const isCurrent = () => !work.signal.aborted && committed.current === request;
    async function read() {
      try {
        const result = await request.get();
        if (!isCurrent()) return;
        if (!result.ok) {
          setState({ request, view: null, error: operationErrorKey(result.error.code) });
          return;
        }
        const view = await prepareNativeCosmeticArtwork(result.data, work.signal, (progress) => {
          if (isCurrent()) setArtwork({ request, ...progress });
        });
        if (isCurrent()) setState({ request, view, error: null });
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
    return () => work.abort();
  }, [request]);

  const current = active && state?.request === request;
  return {
    view: state?.view ?? null,
    error: current && state.error ? t(state.error) : null,
    loading: !current,
    artwork:
      artwork?.request === request ? { completed: artwork.completed, total: artwork.total } : null,
    reload() {
      if (current) setRefresh(refresh + 1);
    },
  };
}
