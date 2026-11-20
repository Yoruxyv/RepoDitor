/** Keep the last complete catalog visible while checking its sources. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CosmeticsViewDto,
  DesktopOperationErrorCode,
  RepoDitorApi,
} from "@electron/contracts";
import { usePreferences } from "@/app/preferences";
import { prepareNativeCosmeticArtwork } from "@/app/tauriArtwork";
import { operationErrorKey } from "@/app/i18n";

export function sameCosmeticsSource(previous: CosmeticsViewDto, current: CosmeticsViewDto) {
  return previous.artworkRevision && current.artworkRevision
    ? previous.artworkRevision === current.artworkRevision
    : previous.fingerprint === current.fingerprint;
}

function samePresentation(previous: CosmeticsViewDto, current: CosmeticsViewDto) {
  return (
    sameCosmeticsSource(previous, current) &&
    previous.cosmetics.length === current.cosmetics.length &&
    previous.cosmetics.every((row, index) => {
      const next = current.cosmetics[index];
      return row.id === next?.id && row.iconReuseKey?.slice(65) === next.iconReuseKey?.slice(65);
    })
  );
}

function canRetryRead(error: DesktopOperationErrorCode) {
  return ["process_timeout", "process_failed", "process_cancelled", "backend_unavailable"].includes(
    error,
  );
}

export function useCosmeticsRead(
  active: boolean,
  recoveryGeneration: number,
  get: RepoDitorApi["cosmetics"]["get"],
  sourceIdentity?: string,
) {
  const { t } = usePreferences();
  const [refresh, setRefresh] = useState(0);
  // Each visit revalidates the sources. Retained thumbnails are already decoded.
  const request = useMemo(
    () => ({ active, recoveryGeneration, refresh, get, sourceIdentity }),
    [active, recoveryGeneration, refresh, get, sourceIdentity],
  );
  const [state, setState] = useState<{
    request: typeof request;
    view: CosmeticsViewDto | null;
    error: DesktopOperationErrorCode | null;
    replacing?: boolean;
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
          const code = result.error.code;
          setState((previous) => ({
            request,
            view: canRetryRead(code) && !previous?.replacing ? (previous?.view ?? null) : null,
            error: code,
          }));
          return;
        }
        setState((previous) => {
          if (!previous?.view || previous.replacing || samePresentation(previous.view, result.data))
            return previous;
          return { ...previous, replacing: true };
        });
        const view = await prepareNativeCosmeticArtwork(result.data, work.signal, (progress) => {
          if (isCurrent()) setArtwork({ request, ...progress });
        });
        if (isCurrent()) setState({ request, view, error: null });
      } catch {
        if (isCurrent()) setState({ request, view: null, error: "internal_error" });
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
    error: current && state.error ? t(operationErrorKey(state.error)) : null,
    incompatible: current && state.error === "save_unsupported",
    loading: !current,
    replacing: state?.replacing === true,
    artwork:
      artwork?.request === request ? { completed: artwork.completed, total: artwork.total } : null,
    reload() {
      if (current) setRefresh(refresh + 1);
    },
  };
}
