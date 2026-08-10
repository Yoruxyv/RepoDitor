import { useCallback, useEffect, useRef, useState } from "react";

import type { GameProcessStatus } from "@electron/contracts";

export type GameSafetyStatus = GameProcessStatus | null;

export function useGameSafety() {
  const [status, setStatus] = useState<GameSafetyStatus>(null);
  const [checking, setChecking] = useState(true);
  const [recoveryGeneration, setRecoveryGeneration] = useState(0);
  const sequence = useRef(0);
  const lastResolvedStatus = useRef<GameProcessStatus | null>(null);
  const mounted = useRef(false);

  const check = useCallback(async () => {
    const request = ++sequence.current;
    if (mounted.current) setChecking(true);

    try {
      const result = await window.repoditor.game.status();
      if (mounted.current && sequence.current === request) {
        const nextStatus = result.ok ? result.data.status : "unknown";
        if (
          nextStatus === "not_running" &&
          (lastResolvedStatus.current === "running" || lastResolvedStatus.current === "unknown")
        ) {
          setRecoveryGeneration((current) => current + 1);
        }
        lastResolvedStatus.current = nextStatus;
        setStatus(nextStatus);
      }
    } catch {
      if (mounted.current && sequence.current === request) {
        lastResolvedStatus.current = "unknown";
        setStatus("unknown");
      }
    } finally {
      if (mounted.current && sequence.current === request) setChecking(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void check();

    function handleFocus(): void {
      void check();
    }

    window.addEventListener("focus", handleFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", handleFocus);
    };
  }, [check]);

  return { status, checking, recoveryGeneration, check };
}
