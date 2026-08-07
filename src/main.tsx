import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SnipPage } from "./SnipPage";
import "./index.css";

const isSnipMode = new URLSearchParams(window.location.search).get("mode") === "snip";

if (isSnipMode) {
  document.documentElement.classList.add("snip-mode");
  document.body.classList.add("snip-mode");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isSnipMode ? <SnipPage /> : <App />}
  </React.StrictMode>
);
