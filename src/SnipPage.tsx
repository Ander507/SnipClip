import { useEffect, useState } from "react";
import { listen, emitTo } from "@tauri-apps/api/event";
import { SnipSelector } from "./components/SnipSelector";
import { closeSnipper } from "./lib/api";
import type { CaptureResult } from "./lib/types";

/**
 * Preloaded snipper window — translucent overlay, instant show via begin_snip.
 */
export function SnipPage() {
  const [active, setActive] = useState(true);

  useEffect(() => {
    // Transparent shell so the desktop shows through
    document.documentElement.classList.add("snip-mode");
    document.body.classList.add("snip-mode");

    let unlisten: (() => void) | undefined;
    void listen("snip-ready", () => {
      setActive(true);
    }).then((u) => {
      unlisten = u;
    });

    return () => {
      unlisten?.();
      document.documentElement.classList.remove("snip-mode");
      document.body.classList.remove("snip-mode");
    };
  }, []);

  async function finish(result: CaptureResult | null) {
    setActive(false);
    if (result) {
      await emitTo("main", "snip-complete", result);
    }
    await closeSnipper();
  }

  return (
    <div className="h-full w-full bg-transparent">
      <SnipSelector
        active={active}
        onCaptured={(result) => void finish(result)}
        onCancel={() => void finish(null)}
      />
    </div>
  );
}
