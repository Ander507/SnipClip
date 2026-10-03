import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import {
  AppWindow,
  Copy,
  Pin,
  Type,
  Trash2,
  ScanText,
  Pencil,
  ExternalLink,
  Check,
  X,
  Sigma,
  Languages,
} from "lucide-react";
import type { ClipboardItem } from "../lib/types";
import type { Density } from "../lib/uiPrefs";
import { detectLanguage, languageLabel } from "../lib/codeDetect";
import { parseTranslatedContent } from "../lib/translatedContent";
import { parseMathContent } from "../lib/mathContent";
import { charCountLabel, dimensionsLabel, sourceLabel } from "../lib/itemMeta";
import { useItemThumbnail } from "../lib/thumbnails";
import { CodePreview } from "./CodePreview";
import { SmartTextPreview } from "./SmartTextPreview";
import { displayUrl, isLinkItem, linkHrefFromText } from "../lib/urls";
import {
  ActionButton,
  MetaLine,
  ROW_METRICS,
  TypeIcon,
  coverEdge,
  imageFallback,
  isImageItem,
  isVideoItem,
  itemTimeLabel,
} from "./itemParts";

/** Enough for three wrapped lines; keeps huge clips cheap to lay out. */
const PREVIEW_CHARS = 600;

interface Props {
  item: ClipboardItem;
  selected: boolean;
  /** From `useNow()` in the list, so every row ticks together. */
  now: number;
  /** A day header sits above this row, so the time can leave the day out. */
  underDayHeader?: boolean;
  density?: Density;
  ocrAvailable?: boolean;
  onSelect: () => void;
  onCopy: () => void;
  /** Copy the pre-translation source text (translated items only). */
  onCopyOriginal?: () => void;
  /** Copy the evaluated math result without replacing the equation copy. */
  onCopyMathResult?: () => void;
  onExtractText: () => void;
  onPin: () => void;
  onDelete: () => void;
  onPreviewImage: () => void;
  onEditVideo?: () => void;
  onOpenLink: (url: string) => void;
  onUpdate: (id: number, content: string) => void;
}

export function ClipboardItemRow({
  item,
  selected,
  now,
  underDayHeader = false,
  density = "comfortable",
  ocrAvailable = false,
  onSelect,
  onCopy,
  onCopyOriginal,
  onCopyMathResult,
  onExtractText,
  onPin,
  onDelete,
  onPreviewImage,
  onEditVideo,
  onOpenLink,
  onUpdate,
}: Props) {
  const m = ROW_METRICS[density];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content || item.preview || "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const textBody = item.content || item.preview || "";
  const lang = item.contentType === "text" ? detectLanguage(textBody) : "plain";
  const isCode = lang !== "plain";
  const isImage = isImageItem(item);
  const isVideo = isVideoItem(item);
  const isMath = item.contentType === "math";
  const isTranslated = item.contentType === "translated";
  const translatedParts = isTranslated ? parseTranslatedContent(textBody) : null;
  const mathParts = isMath ? parseMathContent(item.content || "", item.preview || "") : null;
  const isLink =
    !isImage && !isVideo && !isMath && !isTranslated && !isCode && isLinkItem(item.contentType, textBody);
  const href = isLink ? linkHrefFromText(textBody) : null;
  const canEdit = !isImage && !isVideo && !isMath && !isTranslated && !isCode;

  const thumb = useItemThumbnail(
    item.id,
    coverEdge(item, m.thumbW, m.thumbH),
    imageFallback(item),
    isImage
  );
  const source = sourceLabel(item);
  const dims = dimensionsLabel(item);
  const chars =
    isImage || isVideo || isMath
      ? null
      : charCountLabel(isTranslated ? translatedParts?.translated ?? "" : textBody);
  const typeTag = isCode
    ? languageLabel(lang)
    : isLink && item.contentType === "text"
      ? "link"
      : item.contentType;

  useEffect(() => {
    if (!editing) setDraft(item.content || item.preview || "");
  }, [item.content, item.preview, editing]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

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

  const imageKind = item.contentType === "screenshot" ? "Screenshot" : "Image";
  const imageName =
    item.preview && !item.preview.startsWith("data:") ? item.preview : imageKind;

  return (
    <div
      role="option"
      aria-selected={selected}
      className={clsx(
        "group relative flex w-full cursor-pointer rounded-lg border transition-colors",
        m.pad,
        m.gap,
        isCode ? "items-start" : "items-center",
        selected
          ? "border-line-strong bg-hover"
          : "border-line bg-raised hover:border-line-strong hover:bg-hover"
      )}
      onClick={() => {
        if (!editing) onSelect();
      }}
      onDoubleClick={() => {
        if (editing) return;
        if (isImage) onPreviewImage();
        else if (isVideo) onEditVideo?.();
        else onCopy();
      }}
    >
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent"
        />
      )}

      {isImage ? (
        <div
          className="shrink-0 overflow-hidden rounded-md border border-line bg-inset"
          style={{ width: m.thumbW, height: m.thumbH }}
          title="Double-click to preview"
        >
          {thumb ? (
            <img
              src={thumb}
              alt=""
              draggable={false}
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-fg-muted">
              <TypeIcon type={item.contentType} />
            </div>
          )}
        </div>
      ) : (
        <div
          className={clsx(
            "flex shrink-0 items-center justify-center rounded-md border border-line bg-muted text-fg-muted",
            m.iconBox
          )}
          title={isVideo ? "Double-click to edit" : undefined}
        >
          <TypeIcon type={item.contentType} isCode={isCode} />
        </div>
      )}

      <div className="min-w-0 flex-1 pr-2">
        {isImage ? (
          <p className="truncate text-xs font-medium text-fg-secondary">
            {imageName}
            {source && <span className="font-normal text-fg-muted"> from {source}</span>}
            {dims && <span className="font-normal text-fg-muted"> · {dims}</span>}
          </p>
        ) : isVideo ? (
          <p className="truncate text-xs font-medium text-fg-secondary">
            {item.preview || (item.contentType === "gif" ? "GIF recording" : "Video recording")}
          </p>
        ) : isMath ? (
          <div className="min-w-0 space-y-1">
            <p className="truncate text-xs font-medium text-fg-secondary">
              {mathParts?.expression || item.content || "Equation"}
            </p>
            {mathParts?.result && (
              <button
                type="button"
                title="Copy result"
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent transition hover:brightness-110"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyMathResult?.();
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <Sigma size={11} />
                <span className="truncate">= {mathParts.result}</span>
                <Copy size={10} className="shrink-0 opacity-70" />
              </button>
            )}
          </div>
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
          <CodePreview content={textBody} maxLines={m.codeLines} />
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
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={12} className="shrink-0" />
            <span className="truncate">{displayUrl(textBody)}</span>
          </button>
        ) : (
          <SmartTextPreview text={textBody.slice(0, PREVIEW_CHARS)} lines={m.lines} compact />
        )}

        <MetaLine
          className="mt-1"
          parts={[
            !isImage && {
              key: "type",
              node: (
                <span className="font-mono uppercase tracking-wider text-fg-muted">{typeTag}</span>
              ),
            },
            {
              key: "time",
              node: (
                <time
                  dateTime={item.createdAt}
                  title={new Date(item.createdAt).toLocaleString()}
                  className="font-mono"
                >
                  {itemTimeLabel(item.createdAt, now, underDayHeader)}
                </time>
              ),
            },
            !isImage && source
              ? {
                  key: "source",
                  shrink: true,
                  node: (
                    <span
                      className="flex min-w-0 items-center gap-1 text-fg-muted"
                      title={`Copied from ${item.sourceApp}`}
                    >
                      <AppWindow size={9} className="shrink-0" />
                      <span className="truncate">{source}</span>
                    </span>
                  ),
                }
              : null,
            chars ? { key: "chars", node: <span className="font-mono">{chars}</span> } : null,
            item.isPinned && {
              key: "pinned",
              node: (
                <span className="inline-flex items-center gap-0.5 text-accent">
                  <Pin size={9} /> Pinned
                </span>
              ),
            },
          ]}
        />
      </div>

      <div
        className={clsx(
          "flex shrink-0 items-center gap-1 transition-opacity",
          editing || selected
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100"
        )}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {editing ? (
          <>
            <ActionButton title="Save (Ctrl+Enter)" onClick={saveEdit} active>
              <Check size={13} />
            </ActionButton>
            <ActionButton title="Cancel" tone="neutral" onClick={cancelEdit}>
              <X size={13} />
            </ActionButton>
          </>
        ) : (
          <>
            {canEdit && (
              <ActionButton title="Edit snippet" onClick={() => setEditing(true)}>
                <Pencil size={13} />
              </ActionButton>
            )}
            {isVideo && onEditVideo && (
              <ActionButton title="Edit recording" onClick={onEditVideo}>
                <Pencil size={13} />
              </ActionButton>
            )}
            {isLink && href && (
              <ActionButton title="Open in browser" onClick={() => onOpenLink(href)}>
                <ExternalLink size={13} />
              </ActionButton>
            )}
            {isImage && ocrAvailable && (
              <ActionButton title="Copy Text (OCR)" onClick={onExtractText}>
                <ScanText size={13} />
              </ActionButton>
            )}
            {isTranslated ? (
              <>
                <ActionButton title="Copy translation" onClick={onCopy}>
                  <Languages size={13} />
                </ActionButton>
                {onCopyOriginal && translatedParts?.original && (
                  <ActionButton title="Copy original" onClick={onCopyOriginal}>
                    <Type size={13} />
                  </ActionButton>
                )}
              </>
            ) : isMath ? (
              <>
                <ActionButton title="Copy equation" onClick={onCopy}>
                  <Copy size={13} />
                </ActionButton>
                {onCopyMathResult && mathParts?.result && (
                  <ActionButton title="Copy result" onClick={onCopyMathResult}>
                    <Sigma size={13} />
                  </ActionButton>
                )}
              </>
            ) : (
              <ActionButton title="Copy" onClick={onCopy}>
                <Copy size={13} />
              </ActionButton>
            )}
            <ActionButton
              title={item.isPinned ? "Unpin" : "Pin"}
              tone="neutral"
              active={item.isPinned}
              onClick={onPin}
            >
              <Pin size={13} />
            </ActionButton>
            <ActionButton title="Delete" tone="danger" onClick={onDelete}>
              <Trash2 size={13} />
            </ActionButton>
          </>
        )}
      </div>
    </div>
  );
}
