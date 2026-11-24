import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useThemeSync } from "./lib/themeSync";

interface ToastPayload {
  id: number;
  state: "saving" | "saved" | "error";
  title: string;
  detail: string;
}

/**
 * Corner "Clip saved" notice for instant replay. The window is click-through and never
 * activated (see replay_toast.rs), so this is display-only.
 */
export function ReplayToastPage() {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const [visible, setVisible] = useState(false);
  useThemeSync({ effects: false });

  useEffect(() => {
    let disposed = false;
    const unsubs: Array<() => void> = [];
    const keep = (u: () => void) => (disposed ? u() : void unsubs.push(u));

    void listen<ToastPayload>("replay-toast", (event) => {
      setToast(event.payload);
      requestAnimationFrame(() => setVisible(true));
    }).then(keep);
    void listen<number>("replay-toast-hide", (event) => {
      setToast((cur) => {
        if (cur && cur.id === event.payload) setVisible(false);
        return cur;
      });
    }).then(keep);

    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
    };
  }, []);

  if (!toast) return <div className="h-full w-full bg-transparent" />;

  const icon =
    toast.state === "saving" ? (
      <Loader2 size={18} className="animate-spin text-fg-secondary" />
    ) : toast.state === "saved" ? (
      <Check size={18} strokeWidth={3} className="text-white" />
    ) : (
      <AlertCircle size={18} className="text-white" />
    );
  const badge =
    toast.state === "saved"
      ? "bg-emerald-500"
      : toast.state === "error"
        ? "bg-red-500"
        : "bg-inset";

  return (
    <div
      className={`h-full w-full bg-transparent p-1.5 transition-all duration-200 ease-out ${
        visible ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
      }`}
    >
      <div className="flex h-full items-center gap-3 rounded-xl border border-line-strong bg-raised/95 px-3 shadow-2xl backdrop-blur-md">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${badge}`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-fg">{toast.title}</div>
          {toast.detail && (
            <div className="truncate text-[11px] text-fg-muted">{toast.detail}</div>
          )}
        </div>
      </div>
    </div>
  );
}
