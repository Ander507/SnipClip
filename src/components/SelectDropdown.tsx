import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface Props<T extends string = string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  /** Wider trigger for longer labels */
  wide?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}

interface MenuPos {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUp: boolean;
}

export function SelectDropdown<T extends string = string>({
  value,
  options,
  onChange,
  className,
  wide = false,
  disabled = false,
  "aria-label": ariaLabel,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value) ?? options[0];

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setPos(null);
      return;
    }
    function place() {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const gap = 4;
      const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
      const spaceAbove = rect.top - gap - 8;
      const preferDown = spaceBelow >= 160 || spaceBelow >= spaceAbove;
      const maxHeight = Math.min(224, preferDown ? spaceBelow : spaceAbove);
      const width = Math.max(rect.width, wide ? 184 : 120);
      const left = Math.min(
        Math.max(8, rect.right - width),
        window.innerWidth - width - 8
      );
      setPos({
        top: preferDown ? rect.bottom + gap : rect.top - gap,
        left,
        width,
        maxHeight: Math.max(120, maxHeight),
        openUp: !preferDown,
      });
    }
    place();
    window.addEventListener("resize", place);
    // Capture scroll from nested overflow containers
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, wide]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menu =
    open &&
    pos &&
    createPortal(
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        style={{
          position: "fixed",
          top: pos.openUp ? undefined : pos.top,
          bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
          left: pos.left,
          width: pos.width,
          maxHeight: pos.maxHeight,
        }}
        className="z-[1000] overflow-y-auto rounded-md border border-line bg-raised py-1 shadow-xl"
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <li key={opt.value} role="option" aria-selected={active}>
              <button
                type="button"
                className={clsx(
                  "flex w-full px-3 py-2 text-left text-[12px] transition",
                  active
                    ? "bg-hover text-fg"
                    : "text-fg-secondary hover:bg-muted hover:text-fg"
                )}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            </li>
          );
        })}
      </ul>,
      document.body
    );

  return (
    <div ref={rootRef} className={clsx("relative shrink-0", className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "flex items-center justify-between gap-2 rounded-md border bg-inset px-3 py-2 text-left text-[12px] text-fg-secondary outline-none transition",
          wide ? "min-w-[11.5rem]" : "min-w-[7.5rem]",
          open ? "border-accent" : "border-line hover:border-line-strong",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown
          size={14}
          className={clsx("shrink-0 text-fg-muted transition", open && "rotate-180")}
        />
      </button>
      {menu}
    </div>
  );
}
