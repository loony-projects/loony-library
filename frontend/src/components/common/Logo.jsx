import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

// Wordmark: two stacked "pages" as the mark, serif name beside it.
export default function Logo({ className, compact = false }) {
  return (
    <Link
      to="/"
      className={cn(
        "group inline-flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
        className,
      )}
      aria-label="Loony Library home"
    >
      <svg viewBox="0 0 24 24" className="size-6 shrink-0 text-primary" aria-hidden>
        <rect x="3" y="4" width="8" height="16" rx="1.5" fill="currentColor" opacity="0.35" />
        <rect x="8" y="2.5" width="8" height="17" rx="1.5" fill="currentColor" opacity="0.65" transform="rotate(-2 12 11)" />
        <rect x="13" y="4" width="8" height="16" rx="1.5" fill="currentColor" />
      </svg>
      {!compact && (
        <span className="font-serif text-[21px] font-medium leading-none tracking-tight text-foreground">
          Loony Library
        </span>
      )}
    </Link>
  );
}
