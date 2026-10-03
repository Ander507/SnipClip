import { useCallback, useEffect, useState, type PointerEvent, type RefObject } from "react";

const STORAGE_KEY = "snipclip.palette.position";
const MARGIN = 8;

export interface PanelPos {
  left: number;
  top: number;
}

function clampToViewport(pos: PanelPos, panel: HTMLElement | null): PanelPos {
  const w = panel?.offsetWidth ?? 0;
  const h = panel?.offsetHeight ?? 0;
  return {
    left: Math.round(Math.max(MARGIN, Math.min(pos.left, window.innerWidth - w - MARGIN))),
    top: Math.round(Math.max(MARGIN, Math.min(pos.top, window.innerHeight - h - MARGIN))),
  };
}

function loadSaved(anchor: string): PanelPos | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as
      | (PanelPos & { anchor?: string })
      | null;
    if (!saved || saved.anchor !== anchor) return null;
    if (!Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return null;
    return { left: saved.left, top: saved.top };
  } catch {
    return null;
  }
}

/**
 * Drag the popup panel by its header (the popup window itself is fullscreen and transparent,
 * so this just positions the panel inside it). A dragged spot is remembered per anchor setting
 * and reused on the next open; with the "cursor" anchor it only lasts until the popup closes.
 * Double-click the header to snap back to the anchor.
 */
export function useDragPosition(
  panelRef: RefObject<HTMLElement | null>,
  anchor: string,
  /** Changes on every popup show. */
  sessionKey: number
) {
  const [pos, setPos] = useState<PanelPos | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setPos(anchor === "cursor" ? null : loadSaved(anchor));
  }, [anchor, sessionKey]);

  // Keep a remembered spot on-screen when the monitor or panel size differs from last time
  useEffect(() => {
    if (!pos) return;
    const panel = panelRef.current;
    const reclamp = () =>
      setPos((prev) => {
        if (!prev) return prev;
        const next = clampToViewport(prev, panelRef.current);
        return next.left === prev.left && next.top === prev.top ? prev : next;
      });
    reclamp();
    const observer = panel ? new ResizeObserver(reclamp) : null;
    if (panel) observer?.observe(panel);
    window.addEventListener("resize", reclamp);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", reclamp);
    };
    // Only (re)attach when dragging starts/stops being active
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos !== null, panelRef]);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, input, a, [data-no-drag]")) return;
      const panel = panelRef.current;
      if (!panel) return;
      e.preventDefault();
      const handle = e.currentTarget;
      const rect = panel.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      let latest: PanelPos = { left: rect.left, top: rect.top };
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // Pointer already released — the drag still tracks while over the header
      }
      setDragging(true);

      const move = (ev: globalThis.PointerEvent) => {
        latest = clampToViewport(
          { left: rect.left + ev.clientX - startX, top: rect.top + ev.clientY - startY },
          panel
        );
        setPos(latest);
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        setDragging(false);
        if (anchor === "cursor") return;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...latest, anchor }));
        } catch {
          // Not remembered — the drag still applies for this open.
        }
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    },
    [anchor, panelRef]
  );

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setPos(null);
  }, []);

  return { pos, dragging, onPointerDown, reset };
}
