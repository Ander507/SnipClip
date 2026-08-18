import { useEffect } from "react";
import { Pencil, X } from "lucide-react";

interface Props {
  imageSrc: string | null;
  loading?: boolean;
  onClose: () => void;
  onCopy: () => void;
  onEdit: (imageSrc: string) => void;
}

export function ImageViewerModal({
  imageSrc,
  loading,
  onClose,
  onCopy,
  onEdit,
}: Props) {
  useEffect(() => {
    if (!imageSrc && !loading) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imageSrc, loading, onClose]);

  if (!imageSrc && !loading) return null;

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 p-6 select-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot preview"
    >
      <div
        className="relative flex max-h-[85vh] max-w-4xl flex-col items-center rounded-xl border border-line-strong bg-raised p-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex w-full items-center justify-between border-b border-line px-2 pb-3">
          <span className="font-mono text-xs text-fg-muted">Screenshot Preview</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-fg-muted transition hover:bg-hover hover:text-fg"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto rounded-lg border border-line bg-inset p-2">
          {loading || !imageSrc ? (
            <div className="flex h-48 w-72 items-center justify-center text-[12px] text-fg-faint">
              Loading…
            </div>
          ) : (
            <img
              src={imageSrc}
              alt="Clipboard screenshot"
              className="h-auto max-w-full rounded object-contain"
            />
          )}
        </div>

        <div className="mt-4 flex w-full items-center justify-center gap-3">
          <button
            type="button"
            disabled={loading || !imageSrc}
            onClick={() => {
              if (!imageSrc) return;
              onEdit(imageSrc);
              onClose();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-hover px-4 py-2 text-xs font-medium text-fg-secondary transition hover:bg-muted disabled:opacity-40"
          >
            <Pencil size={13} />
            Edit Image
          </button>
          <button
            type="button"
            disabled={loading || !imageSrc}
            onClick={() => {
              onCopy();
              onClose();
            }}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-fg transition hover:brightness-110 disabled:opacity-40"
          >
            Copy to Clipboard
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-muted px-4 py-2 text-xs text-fg-secondary transition hover:bg-hover"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
