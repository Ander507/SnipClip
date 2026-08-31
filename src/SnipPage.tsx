import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { SnipSelector, type OverlayMode } from "./components/SnipSelector";
import { closeSnipper, finalizeScreenshot, getSettings } from "./lib/api";
import type { CaptureResult } from "./lib/types";
import { applyThemeFromSettings } from "./lib/theme";

interface SnipReadyPayload {
  mode?: OverlayMode;
}

/**
 * Preloaded snipper window — translucent overlay, instant show via begin_snip.
 */
export function SnipPage() {
  const [active, setActive] = useState(true);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("snip");

  useEffect(() => {
    document.documentElement.classList.add("snip-mode");
    document.body.classList.add("snip-mode");
    void getSettings()
      .then((s) =>
        applyThemeFromSettings({
          themeMode: s.themeMode,
          accentColor: s.accentColor,
          themeUseCustom: s.themeUseCustom ?? false,
          themeCustom: s.themeCustom ?? null,
          themeGlassmorphic: s.themeGlassmorphic ?? false,
          themeTranslucency: s.themeTranslucency ?? 0,
          themeBackgroundImage: s.themeBackgroundImage ?? null,
        })
      )
      .catch(console.error);

    let unlisten: (() => void) | undefined;
    void listen<SnipReadyPayload>("snip-ready", (event) => {
      setOverlayMode(event.payload?.mode === "record" ? "record" : "snip");
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
    try {
      if (result) {
        // Finalize from snipper — avoids waking the main vault window via emitTo("main")
        await finalizeScreenshot(result.dataUrl, result.width, result.height);
      }
    } catch (err) {
      console.error(err);
    } finally {
      await closeSnipper(false);
    }
  }

  return (
    <div className="h-full w-full bg-transparent">
      <SnipSelector
        active={active}
        initialMode={overlayMode}
        onCaptured={(capture) => void finish(capture)}
        onCancel={() => void finish(null)}
      />
    </div>
  );
}
