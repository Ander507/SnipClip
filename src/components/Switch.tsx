import clsx from "clsx";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name when no visible <label> wraps the switch. */
  label?: string;
}

/** Toggle switch for on/off settings (replaces native checkboxes). */
export function Switch({ checked, onChange, disabled, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        checked ? "border-accent bg-accent" : "border-line-strong bg-inset hover:bg-hover",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={clsx(
          "inline-block h-3.5 w-3.5 rounded-full shadow transition-transform",
          checked ? "translate-x-[18px] bg-accent-fg" : "translate-x-[2px] bg-fg-muted"
        )}
      />
    </button>
  );
}
