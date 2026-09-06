import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Pin,
  Link2,
  Type,
  Image as ImageIcon,
  Trash2,
  Code2,
  ScanText,
  Pencil,
  ExternalLink,
  Check,
  X,
  Film,
  Sigma,
  Languages,
} from "lucide-react";
import type { ClipboardItem } from "../lib/types";
import {
  detectLanguage,
  languageLabel,
} from "../lib/codeDetect";
import { parseTranslatedContent } from "../lib/translatedContent";
import { CodePreview } from "./CodePreview";
import { SmartTextPreview } from "./SmartTextPreview";
import { displayUrl, isLinkItem, linkHrefFromText } from "../lib/urls";

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function TypeIcon({ type, isCode }: { type: string; isCode?: boolean }) {
  if (isCode) return <Code2 size={14} />;
  if (type === "image" || type === "screenshot") return <ImageIcon size={14} />;
  if (type === "video" || type === "gif") return <Film size={14} />;
  if (type === "link") return <Link2 size={14} />;
  if (type === "math") return <Sigma size={14} />;
  if (type === "translated") return <Languages size={14} />;
  return <Type size={14} />;
}

function thumbSrc(item: ClipboardItem): string | null {
  if (item.contentType !== "image" && item.contentType !== "screenshot") return null;
  if (item.preview?.startsWith("data:image")) return item.preview;
  if (item.content?.startsWith("data:image")) return item.content;
  return null;
}

interface Props {
  item: ClipboardItem;
  selected: boolean;
  ocrAvailable?: boolean;
  onSelect: () => void;
  onCopy: () => void;
  /** Copy the pre-translation source text (translated items only). */
  onCopyOriginal?: () => void;
  onExtractText: () => void;
  onPin: () => void;
  onDelete: () => void;
  onPreviewImage: () => void;
  onEditVideo?: () => void;
  onOpenLink: (url: string) => void;
  onUpdate: (id: number, content: string) => void;
  onEditLayout?: (editing: boolean, lineCount: number) => void;
}

export function ClipboardItemRow({
  item,
  selected,
  ocrAvailable = false,
  onSelect,
  onCopy,
  onCopyOriginal,
  onExtractText,
  onPin,
  onDelete,
  onPreviewImage,
  onEditVideo,
  onOpenLink,
  onUpdate,
  onEditLayout,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content || item.preview || "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const thumb = thumbSrc(item);
  const textBody = item.content || item.preview || "";
  const lang = item.contentType === "text" ? detectLanguage(textBody) : "plain";
  const isCode = lang !== "plain";
  const isImage = item.contentType === "image" || item.contentType === "screenshot";
  const isVideo = item.contentType === "video" || item.contentType === "gif";
  const isMath = item.contentType === "math";
  const isTranslated = item.contentType === "translated";
  const translatedParts = isTranslated ? parseTranslatedContent(textBody) : null;
  const isLink =
    !isImage && !isVideo && !isMath && !isTranslated && !isCode && isLinkItem(item.contentType, textBody);
  const href = isLink ? linkHrefFromText(textBody) : null;
  const canEdit = !isImage && !isVideo && !isMath && !isTranslated && !isCode;

  useEffect(() => {
    if (!editing) setDraft(item.content || item.preview || "");
  }, [item.content, item.preview, editing]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    const lines = Math.min(8, Math.max(2, draft.split("\n").length));
    onEditLayout?.(editing, lines);
  }, [editing, draft, onEditLayout]);

  function saveEdit() {
    const next = draft.trim();
    if (!next) return;
    if (next !== textBody) onUpdate(item.id, next);
    setEditing(false);
  }

  function cancelEdit() {
    setDraft(textBody);
    setEditing(false);
  }

  return (
    <div
      role="option"
      aria-selected={selected}
      className={clsx(
        "group flex w-full cursor-pointer items-center gap-3.5 rounded-lg border p-3.5 transition-all",
        selected
          ? "border-accent bg-accent-soft"
          : "border-line bg-raised hover:border-line-strong hover:bg-hover"
      )}
      onClick={() => {
        if (editing) return;
        onSelect();
        if (isImage) onPreviewImage();
        if (isVideo) onEditVideo?.();
      }}
      onDoubleClick={() => {
        if (!isImage && !isVideo && !editing) onCopy();
      }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-muted text-fg-muted">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <TypeIcon type={item.contentType} isCode={isCode} />
        )}
      </div>

      <div className="min-w-0 flex-1 pr-2">
        {isImage ? (
          <p className="truncate text-xs font-medium text-fg-secondary">
            {item.contentType === "screenshot"
              ? item.preview?.startsWith("data:")
                ? "Screenshot — click to preview"
                : item.preview || "Screenshot"
              : item.preview?.startsWith("data:")
                ? "Image — click to preview"
                : item.preview || "Image"}
          </p>
        ) : isVideo ? (
          <p className="truncate text-xs font-medium text-fg-secondary">
            {item.preview || (item.contentType === "gif" ? "GIF recording" : "Video recording")}
          </p>
        ) : isMath ? (
          <p className="truncate text-xs font-medium text-fg-secondary">
            {item.content || item.preview || "Solved math"}
          </p>
        ) : isTranslated ? (
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-xs font-medium text-fg-secondary">
              {translatedParts?.translated || item.preview || "Translation"}
            </p>
            {translatedParts?.original && (
              <p className="truncate text-[11px] text-fg-muted" title={translatedParts.original}>
                Copied: {translatedParts.original}
              </p>
            )}
          </div>
        ) : isCode ? (
          <CodePreview content={textBody} />
        ) : editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveEdit();
              }
            }}
            className="w-full resize-none rounded-md border border-accent bg-inset px-2.5 py-2 font-mono text-xs leading-relaxed text-fg-secondary outline-none ring-1 ring-accent/30"
            rows={Math.min(6, Math.max(2, draft.split("\n").length))}
          />
        ) : isLink && href ? (
          <button
            type="button"
            title={href}
            className="flex max-w-full items-center gap-1.5 truncate text-left text-xs font-medium text-accent hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onOpenLink(href);
            }}
          >
            <ExternalLink size={12} className="shrink-0" />
            <span className="truncate">{displayUrl(textBody)}</span>
          </button>
        ) : (
          <SmartTextPreview text={item.preview || item.content || ""} compact />
        )}

        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {isCode
              ? languageLabel(lang)
              : item.contentType === "screenshot"
                ? "screenshot"
                : item.contentType === "math"
                  ? "math"
                  : item.contentType === "translated"
                    ? "translated"
                    : item.contentType}
          </span>
          <span className="text-[10px] text-fg-faint">•</span>
          <span className="font-mono text-[10px] text-fg-faint">{formatTime(item.createdAt)}</span>
          {item.isPinned && (
            <>
              <span className="text-[10px] text-fg-faint">•</span>
              <span className="inline-flex items-center gap-0.5 text-[10px] text-accent">
                <Pin size={9} /> Pinned
              </span>
            </>
          )}
        </div>
      </div>

      <div
        className={clsx(
          "flex shrink-0 items-center gap-1 transition-opacity",
          editing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
      >
        {editing ? (
          <>
            <button
              type="button"
              title="Save (Ctrl+Enter)"
              className="rounded p-1.5 text-accent transition hover:bg-hover"
              onClick={(e) => {
                e.stopPropagation();
                saveEdit();
              }}
            >
              <Check size={13} />
            </button>
            <button
              type="button"
              title="Cancel"
              className="rounded p-1.5 text-fg-muted transition hover:bg-hover hover:text-fg"
              onClick={(e) => {
                e.stopPropagation();
                cancelEdit();
              }}
            >
              <X size={13} />
            </button>
          </>
        ) : (
          <>
            {canEdit && (
              <button
                type="button"
                title="Edit snippet"
                className="rounded p-1.5 text-fg-muted transition hover:bg-hover hover:text-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(true);
                }}
              >
                <Pencil size={13} />
              </button>
            )}
            {isVideo && (
              <button
                type="button"
                title="Edit recording"
                className="rounded p-1.5 text-fg-muted transition hover:bg-hover hover:text-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditVideo?.();
                }}
              >
                <Pencil size={13} />
              </button>
            )}
            {isLink && href && (
              <button
                type="button"
                title="Open in browser"
                className="rounded p-1.5 text-fg-muted transition hover:bg-hover hover:text-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenLink(href);
                }}
              >
                <ExternalLink size={13} />
              </button>
            )}
            {isImage && ocrAvailable && (
              <button
                type="button"
                title="Copy Text (OCR)"
                className="rounded p-1.5 text-fg-muted transition hover:bg-hover hover:text-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  onExtractText();
                }}
              >
                <ScanText size={13} />
              </button>
            )}
            {isTranslated ? (
              <>
                <button
                  type="button"
                  title="Copy translation"
                  className="rounded p-1.5 text-fg-muted transition hover:bg-hover hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopy();
                  }}
                >
                  <Languages size={13} />
                </button>
                {onCopyOriginal && translatedParts?.original && (
                  <button
                    type="button"
                    title="Copy original"
                    className="rounded p-1.5 text-fg-muted transition hover:bg-hover hover:text-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopyOriginal();
                    }}
                  >
                    <Type size={13} />
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                title="Copy"
                className="rounded p-1.5 text-fg-muted transition hover:bg-hover hover:text-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy();
                }}
              >
                <Copy size={13} />
              </button>
            )}
            <button
              type="button"
              title="Pin"
              className={clsx(
                "rounded p-1.5 transition hover:bg-hover",
                item.isPinned ? "text-accent" : "text-fg-muted hover:text-fg"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onPin();
              }}
            >
              <Pin size={13} />
            </button>
            <button
              type="button"
              title="Delete"
              className="rounded p-1.5 text-fg-muted transition hover:bg-hover hover:text-danger"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
