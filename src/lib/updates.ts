import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateProgress = {
  downloaded: number;
  total: number | null;
  status: "started" | "progress" | "finished";
};

/** Turn updater/plugin errors into a short user-facing reason. */
export function formatUpdateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes("404") ||
    lower.includes("not found") ||
    lower.includes("could not fetch") ||
    lower.includes("failed to fetch")
  ) {
    return "No update feed found yet. Publish a signed release (v1.1+) to enable checks.";
  }
  if (
    lower.includes("network") ||
    lower.includes("dns") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("connection")
  ) {
    return "Could not reach the update server. Check your connection and try again.";
  }
  if (
    lower.includes("signature") ||
    lower.includes("pubkey") ||
    lower.includes("minisign") ||
    lower.includes("verify")
  ) {
    return "Update signature check failed. The release may be unsigned or mismatched.";
  }
  if (lower.includes("dangerous") || lower.includes("dev") || lower.includes("debug")) {
    return "Updates only work in a packaged install, not during tauri dev.";
  }

  // Keep message short if the plugin already gave something readable
  const trimmed = raw.replace(/^error:\s*/i, "").trim();
  if (trimmed && trimmed.length < 120) {
    return trimmed;
  }
  return "Failed to check for updates. Try again later.";
}

export async function checkForAppUpdate(): Promise<Update | null> {
  return check();
}

export async function installAppUpdate(
  update: Update,
  onProgress: (progress: UpdateProgress) => void
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        downloaded = 0;
        onProgress({ downloaded, total, status: "started" });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress({ downloaded, total, status: "progress" });
        break;
      case "Finished":
        onProgress({ downloaded, total, status: "finished" });
        break;
    }
  });
  await relaunch();
}
