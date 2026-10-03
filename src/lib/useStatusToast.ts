import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

export interface ToastOptions {
  tone?: ToastTone;
  action?: ToastAction;
}

/** Status toast with auto-dismiss; clears pending timers on unmount. */
export function useStatusToast(duration = 1600) {
  const [status, setStatusRaw] = useState<Toast | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const setStatus = useCallback(
    (message: string | null, ms = duration, options: ToastOptions = {}) => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setStatusRaw(
        message ? { message, tone: options.tone ?? "info", action: options.action } : null
      );
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
