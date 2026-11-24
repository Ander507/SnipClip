import { Search, X } from "lucide-react";
import { forwardRef, useState } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export const SearchBar = forwardRef<HTMLInputElement, Props>(
  function SearchBar({ value, onChange }, ref) {
    const [focused, setFocused] = useState(false);
    return (
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
        />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search clips, text, links…"
          className="h-9 w-full rounded-lg border border-line bg-inset pl-9 pr-14 text-[13px] text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
        {!value && !focused && (
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-muted px-1.5 text-[10px] text-fg-muted"
          >
            /
          </kbd>
        )}
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            onClick={() => onChange("")}
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  }
);
