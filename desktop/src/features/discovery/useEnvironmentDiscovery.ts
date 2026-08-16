import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopOperationError, EnvironmentDiscovery } from "@electron/contracts";
import { detectEnvironment } from "./discoveryApi";

interface DiscoveryState {
  data: EnvironmentDiscovery | null;
  error: DesktopOperationError | null;
  pending: boolean;
}

interface EnvironmentDiscoveryController {
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

export function useEnvironmentDiscovery(): EnvironmentDiscoveryController {
  const [state, setState] = useState<DiscoveryState>(INITIAL_STATE);
  const mounted = useRef(false);
  const requestInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (requestInFlight.current) {
      return;
    }

    requestInFlight.current = true;
    setState((current) => ({ ...current, error: null, pending: true }));
    const result = await detectEnvironment();

    if (mounted.current) {
      setState((current) =>
        result.ok
          ? { data: result.data, error: null, pending: false }
          : { data: current.data, error: result.error, pending: false },
      );
    }

    requestInFlight.current = false;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return {
    data: state.data,
    error: state.error,
    isInitialLoading: state.pending && state.data === null,
    isRefreshing: state.pending && state.data !== null,
    refresh,
  };
}
