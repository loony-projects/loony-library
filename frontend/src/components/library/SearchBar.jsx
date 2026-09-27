import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Large, calm search field. "/" focuses it from anywhere on the page.
export default function SearchBar({ value, onChange, placeholder, className, label = "Search" }) {
  const ref = useRef(null);
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      ref.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className={cn("group relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-5 size-[18px] text-muted-foreground transition-colors group-focus-within:text-primary" />
      <input
        ref={ref}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && value && onChange("")}
        className="h-14 w-full rounded-xl border border-input bg-card pl-13 pr-14 text-base text-foreground shadow-sm transition-[border-color,box-shadow] duration-200 outline-none placeholder:text-muted-foreground/80 hover:border-muted-foreground/30 focus:border-primary/50 focus:shadow-md focus:ring-4 focus:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
          className="absolute right-3 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-4" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-4 hidden h-6 min-w-6 items-center justify-center rounded-[5px] border bg-muted px-1.5 font-sans text-xs text-muted-foreground sm:flex">
          /
        </kbd>
      )}
    </div>
  );
}
