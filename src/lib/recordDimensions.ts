import type { RecordRegion } from "../components/RecordControls";

/** forcing even width and height so libx264 doesn't panic on odd pixel dimensions */
export function evenRecordingExtent(n: number): number {
  const rounded = Math.max(1, Math.round(n));
  return rounded - (rounded % 2);
}

export function sanitizeRecordRegion(region: RecordRegion): RecordRegion {
  const physW = Math.max(2, evenRecordingExtent(region.physW));
  const physH = Math.max(2, evenRecordingExtent(region.physH));
  return { ...region, physW, physH };
}

export function isValidRecordRegion(region: RecordRegion): boolean {
  return region.physW >= 2 && region.physH >= 2;
}
