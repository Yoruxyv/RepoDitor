/**
 * Owns renderer lifetime for local environment discovery and explicit refresh.
 *
 * The hook prevents stale responses from replacing newer state; Python/Electron own
 * path trust and discovery semantics.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopOperationError, EnvironmentDiscovery } from "@electron/contracts";
import { detectEnvironment } from "./discoveryApi";

interface DiscoveryState {
  data: EnvironmentDiscovery | null;
  error: DesktopOperationError | null;
  pending: boolean;
}

export interface EnvironmentDiscoveryController {
  data: EnvironmentDiscovery | null;
  error: DesktopOperationError | null;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

const INITIAL_STATE: DiscoveryState = {
  data: null,
  error: null,
  pending: false,
};

export function useEnvironmentDiscovery(
  active: boolean,
  refreshGeneration: number,
): EnvironmentDiscoveryController {
  const [state, setState] = useState<DiscoveryState>(INITIAL_STATE);
  const mounted = useRef(false);
  const activeRef = useRef(active);
  const requestInFlight = useRef(false);
  const refreshQueued = useRef(false);

  const refresh = useCallback(async () => {
    if (requestInFlight.current) {
      refreshQueued.current = true;
      return;
    }

    requestInFlight.current = true;
    do {
      refreshQueued.current = false;
      setState((current) => ({ ...current, error: null, pending: true }));
      const result = await detectEnvironment();

      if (mounted.current) {
        setState((current) =>
          result.ok
            ? { data: result.data, error: null, pending: false }
            : { data: current.data, error: result.error, pending: false },
        );
      }
    } while (mounted.current && activeRef.current && refreshQueued.current);

    requestInFlight.current = false;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    if (active) void refresh();
  }, [active, refresh, refreshGeneration]);

  return {
    data: state.data,
    error: state.error,
    isInitialLoading: state.pending && state.data === null,
    isRefreshing: state.pending && state.data !== null,
    refresh,
  };
}
