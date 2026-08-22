import { useCallback, useEffect, useRef, useState } from "react";

/** Status line with auto-dismiss; clears pending timers on unmount. */
export function useStatusToast(duration = 1600) {
  const [status, setStatusRaw] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const setStatus = useCallback(
    (message: string | null, ms = duration) => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setStatusRaw(message);
      if (message) {
        timerRef.current = window.setTimeout(() => {
          setStatusRaw(null);
          timerRef.current = null;
        }, ms);
      }
    },
    [duration]
  );

  return [status, setStatus] as const;
}
