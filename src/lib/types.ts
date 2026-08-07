export type ContentType = "text" | "image" | "link";

export type Category = "all" | "text" | "images" | "links" | "pinned";

export interface ClipboardItem {
  id: number;
  contentType: ContentType | string;
  content: string;
  preview: string;
  isPinned: boolean;
  createdAt: string;
}

export interface CaptureResult {
  dataUrl: string;
  width: number;
  height: number;
  monitorName: string;
}

export interface AppSettings {
  hotkeyClipboard: string;
  hotkeySnip: string;
  clearOnBoot: boolean;
  /** "never" | "reboot" | "daily" | "weekly" */
  clearInterval: string;
  lastCleanup: number;
}

export type ClearInterval = "never" | "reboot" | "daily" | "weekly";

export type AnnotateTool =
  | "select"
  | "pen"
  | "arrow"
  | "rect"
  | "highlight"
  | "blur"
  | "number"
  | "eyedropper";
