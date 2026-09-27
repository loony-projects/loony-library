import { Bookmark, BookOpen, Heart, Languages, Library, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

function FacetGroup({ title, children }) {
  return (
    <div>
      <h3 className="mb-2 px-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h3>
      <ul className="grid gap-0.5">{children}</ul>
    </div>
  );
}

function FacetItem({ active, label, count, icon: Icon, onClick }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
          active
            ? "bg-primary-soft font-medium text-primary-soft-foreground"
            : "text-foreground/85 hover:bg-accent hover:text-foreground",
        )}
      >
        {Icon && (
          <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span
          className={cn(
            "text-xs tabular-nums",
            active ? "text-primary-soft-foreground/80" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      </button>
    </li>
  );
}

const SHELVES = [
  { key: "reading", label: "Reading", icon: BookOpen },
  { key: "favorite", label: "Favorites", icon: Heart },
  { key: "wishlist", label: "Wishlist", icon: Bookmark },
];

// Facets: personal shelves, genres and languages. Each facet narrows the
// catalogue independently; picking the active one again clears it.
export default function FilterPanel({ facets, filters, onChange, className }) {
  const set = (key, value) =>
    onChange({ ...filters, [key]: filters[key] === value ? "" : value });
  const noFilter = !filters.shelf && !filters.genre && !filters.language;
  return (
    <nav aria-label="Filter books" className={cn("grid gap-8", className)}>
      <FacetGroup title="Library">
        <FacetItem
          active={noFilter}
          label="All books"
          count={facets.total}
          icon={Library}
          onClick={() => onChange({ shelf: "", genre: "", language: "" })}
        />
        {facets.shelves &&
          SHELVES.map((s) => (
            <FacetItem
              key={s.key}
              active={filters.shelf === s.key}
              label={s.label}
              count={facets.shelves[s.key]}
              icon={s.icon}
              onClick={() => set("shelf", s.key)}
            />
          ))}
      </FacetGroup>
      {facets.genres.length > 0 && (
        <FacetGroup title="Genres">
          {facets.genres.map(([g, n]) => (
            <FacetItem key={g} active={filters.genre === g} label={g} count={n} icon={Tag} onClick={() => set("genre", g)} />
          ))}
        </FacetGroup>
      )}
      {facets.languages.length > 1 && (
        <FacetGroup title="Languages">
          {facets.languages.map(([code, label, n]) => (
            <FacetItem
              key={code}
              active={filters.language === code}
              label={label}
              count={n}
              icon={Languages}
              onClick={() => set("language", code)}
            />
          ))}
        </FacetGroup>
      )}
    </nav>
  );
}
