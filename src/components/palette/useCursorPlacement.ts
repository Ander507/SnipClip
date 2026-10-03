import { useLayoutEffect, useState, type RefObject } from "react";

export interface Point {
  x: number;
  y: number;
}

const GAP = 8;
const MARGIN = 12;

/** Start the panel just past the cursor; flip to the other side when it would overflow. */
function placeAxis(at: number, size: number, viewport: number): number {
  let start = at + GAP;
  if (start + size > viewport - MARGIN) start = at - GAP - size;
  return Math.max(MARGIN, Math.min(start, viewport - MARGIN - size));
}

/**
 * Top-left (CSS px) for a panel opened at `cursor`, kept fully inside the viewport. Re-measures
 * whenever the panel resizes (results arriving, width pref) so it never spills off-screen.
 * Null when `cursor` is null.
 */
export function useCursorPlacement(
  panelRef: RefObject<HTMLElement | null>,
  cursor: Point | null
): { left: number; top: number } | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const x = cursor?.x;
  const y = cursor?.y;

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (x === undefined || y === undefined || !el) {
      setPos(null);
      return;
    }
    const place = () => {
      const left = placeAxis(x, el.offsetWidth, window.innerWidth);
      const top = placeAxis(y, el.offsetHeight, window.innerHeight);
      setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [panelRef, x, y]);

  return pos;
}
