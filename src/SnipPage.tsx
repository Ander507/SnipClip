import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  SnipSelector,
  type OverlayMode,
  type OverlayOrigin,
} from "./components/SnipSelector";
import { closeSnipper, finalizeScreenshot, getSettings } from "./lib/api";
import type { CaptureResult } from "./lib/types";
import { applyThemeFromSettings } from "./lib/theme";

interface SnipReadyPayload {
  mode?: OverlayMode;
  showControls?: boolean;
  originX?: number;
  originY?: number;
  desktopOriginX?: number;
  desktopOriginY?: number;
}

/**
 * Preloaded snipper window — translucent overlay, instant show via begin_snip.
 */
export function SnipPage() {
  const [active, setActive] = useState(true);
  const [session, setSession] = useState(0);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("snip");
  const [showControls, setShowControls] = useState(true);
  const [overlayOrigin, setOverlayOrigin] = useState<OverlayOrigin | null>(null);

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
      const payload = event.payload;
      setOverlayMode(payload?.mode === "record" ? "record" : "snip");
      setShowControls(payload?.showControls !== false);
      if (
        typeof payload?.originX === "number" &&
        typeof payload?.originY === "number"
      ) {
        setOverlayOrigin({ originX: payload.originX, originY: payload.originY });
      }
      // Remount selector so a parked record handoff can't leave a stuck REC freeze
      setSession((n) => n + 1);
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
        key={session}
        active={active}
        initialMode={overlayMode}
        showControls={showControls}
        overlayOrigin={overlayOrigin}
        onCaptured={(capture) => void finish(capture)}
        onCancel={() => void finish(null)}
      />
    </div>
  );
}
