import clsx from "clsx";
import type { ComponentType } from "react";

interface Option<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<{ size?: number }>;
}

interface Props<T extends string> {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  "aria-label"?: string;
}

/** Pill-style single choice (Dark / Light / System, Compact / Comfortable / …). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  "aria-label": ariaLabel,
}: Props<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex shrink-0 rounded-md border border-line bg-inset p-0.5"
    >
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12px] font-medium transition",
            value === v ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"
          )}
        >
          {Icon && <Icon size={12} />}
          {label}
        </button>
      ))}
    </div>
  );
}
