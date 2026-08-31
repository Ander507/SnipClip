import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// Every Tauri window loads this same entry, so static imports made the snip overlay and the
// recorder bar parse the entire main app before they could draw. Splitting per window means
// each one only downloads its own chunk.
const App = lazy(() => import("./App"));
const SnipPage = lazy(() => import("./SnipPage").then((m) => ({ default: m.SnipPage })));
const RecorderBarPage = lazy(() =>
  import("./RecorderBarPage").then((m) => ({ default: m.RecorderBarPage }))
);
const CommandPalette = lazy(() =>
  import("./CommandPalettePage").then((m) => ({ default: m.CommandPalette }))
);
const ScreenshotPopup = lazy(() =>
  import("./ScreenshotPopupPage").then((m) => ({ default: m.ScreenshotPopup }))
);

const params = new URLSearchParams(window.location.search);
const isSnipMode = params.get("mode") === "snip";
// isolating the react popup component via url flags so the secondary window doesn't crash trying to load the full app
const isPopupView = params.get("view") === "popup";
const isRecorderView = params.get("view") === "recorder";
const isPaletteView = params.get("view") === "palette";

if (isSnipMode) {
  document.documentElement.classList.add("snip-mode");
  document.body.classList.add("snip-mode");
}

if (isPopupView || isRecorderView || isPaletteView) {
  document.documentElement.classList.add("popup-mode");
  document.body.classList.add("popup-mode");
  const root = document.getElementById("root");
  document.documentElement.style.backgroundColor = "transparent";
  document.body.style.backgroundColor = "transparent";
  if (root) root.style.backgroundColor = "transparent";
}

if (isPaletteView) {
  document.documentElement.classList.add("palette-mode");
  document.body.classList.add("palette-mode");
}

if (isRecorderView) {
  document.documentElement.classList.add("recorder-mode");
  document.body.classList.add("recorder-mode");
}

// Disable the WebView / Edge right-click menu in the desktop shell
document.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* null fallback keeps the transparent overlay windows from flashing a background */}
    <Suspense fallback={null}>
      {isPopupView ? (
        <ScreenshotPopup />
      ) : isPaletteView ? (
        <CommandPalette />
      ) : isRecorderView ? (
        <RecorderBarPage />
      ) : isSnipMode ? (
        <SnipPage />
      ) : (
        <App />
      )}
    </Suspense>
  </React.StrictMode>
);
