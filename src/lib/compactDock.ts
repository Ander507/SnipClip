import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";

const STUDIO_SIZE = { width: 960, height: 660 };
const DOCK_SIZE = { width: 360, height: 560 };
const DOCK_MARGIN = 16;

/** Shrink and park the vault above the taskbar (primary monitor, bottom-right). */
export async function applyCompactDockLayout(): Promise<void> {
  const win = getCurrentWindow();
  const monitor = await primaryMonitor().catch(() => null);
  await win.setMinSize(new LogicalSize(320, 420));
  await win.setSize(new LogicalSize(DOCK_SIZE.width, DOCK_SIZE.height));
  if (monitor) {
    const area = monitor.workArea;
    const scale = monitor.scaleFactor || 1;
    const widthLogical = area.size.width / scale;
    const heightLogical = area.size.height / scale;
    const originX = area.position.x / scale;
    const originY = area.position.y / scale;
    const x = originX + widthLogical - DOCK_SIZE.width - DOCK_MARGIN;
    const y = originY + heightLogical - DOCK_SIZE.height - DOCK_MARGIN;
    await win.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
  }
  // toggling always on top property dynamically for compact clipboard docking
}

/** Restore the full studio window size (user can re-maximize after). */
export async function applyStudioLayout(): Promise<void> {
  const win = getCurrentWindow();
  await win.setMinSize(new LogicalSize(720, 480));
  await win.setSize(new LogicalSize(STUDIO_SIZE.width, STUDIO_SIZE.height));
  await win.center().catch(() => undefined);
}

export async function setMainAlwaysOnTop(enabled: boolean): Promise<void> {
  await getCurrentWindow().setAlwaysOnTop(enabled);
}
