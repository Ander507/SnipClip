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
        className="relative flex max-h-[85vh] max-w-4xl flex-col items-center rounded-xl border border-[#333333] bg-[#191919] p-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex w-full items-center justify-between border-b border-[#2d2d2d] px-2 pb-3">
          <span className="font-mono text-xs text-[#888888]">Screenshot Preview</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-[#888888] transition hover:bg-[#2d2d2d] hover:text-white"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto rounded-lg border border-[#262626] bg-[#121212] p-2">
          {loading || !imageSrc ? (
            <div className="flex h-48 w-72 items-center justify-center text-[12px] text-[#666666]">
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
            className="inline-flex items-center gap-2 rounded-lg border border-[#3d3d3d] bg-[#2a2a2a] px-4 py-2 text-xs font-medium text-zinc-200 transition hover:bg-[#333333] disabled:opacity-40"
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
            className="rounded-lg bg-[#00e8c6] px-4 py-2 text-xs font-semibold text-black transition hover:bg-[#00c4a7] disabled:opacity-40"
          >
            Copy to Clipboard
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#252525] px-4 py-2 text-xs text-zinc-300 transition hover:bg-[#303030]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
