import { Search, X } from "lucide-react";
import { forwardRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export const SearchBar = forwardRef<HTMLInputElement, Props>(
  function SearchBar({ value, onChange }, ref) {
    return (
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#777777]"
        />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search clipboard history"
          className="w-full rounded-md border border-[#2d2d2d] bg-[#191919] py-2.5 pl-9 pr-9 text-[13px] text-[#eeeeee] outline-none transition placeholder:text-[#666666] focus:border-[#3d3d3d] focus:bg-[#1e1e1e]"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#777777] hover:text-white"
            onClick={() => onChange("")}
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  }
);
