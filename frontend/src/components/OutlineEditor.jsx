import { useState } from "react";
import { ArrowDown, ArrowUp, Check, GripVertical } from "lucide-react";
import { api } from "../api";
import { cn } from "@/lib/utils";
import { InlineMessage } from "./common/States";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export default function OutlineEditor({ toc, refresh, open, onOpenChange }) {
  const [error, setError] = useState(""),
    [drag, setDrag] = useState(null),
    [over, setOver] = useState(null);
  async function move(kind, nodes, from, to) {
    if (to < 0 || to >= nodes.length || from === to) return;
    try {
      const ids = nodes.map((n) => n.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      await api.put("/api/reorder", { kind, ids });
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  function list(nodes, kind, depth = 0) {
    return (
      <ol className={cn("grid gap-1.5", depth > 0 && "ml-4 mt-1.5 border-l pl-3")}>
        {nodes.map((n, i) => (
          <li
            key={n.id}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              setDrag({
                kind,
                ids: nodes.map((x) => x.id).join(","),
                index: i,
              });
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOver(n.id);
            }}
            onDragLeave={() => setOver((o) => (o === n.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (
                drag?.kind === kind &&
                drag.ids === nodes.map((x) => x.id).join(",")
              )
                move(kind, nodes, drag.index, i);
              setDrag(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
          >
            <form
              className={cn(
                "group flex items-center gap-1.5 rounded-lg border bg-card p-1.5 pl-1 shadow-xs transition-[border-color,box-shadow]",
                over === n.id && drag && "border-primary/60 ring-[3px] ring-ring/40",
              )}
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const f = Object.fromEntries(new FormData(e.currentTarget));
                  await api.patch(`/api/${kind}/${n.id}`, f);
                  await refresh();
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/60" aria-hidden />
              {kind === "chapters" && (
                <input
                  name="number"
                  aria-label={`Number for ${n.title}`}
                  placeholder="#"
                  defaultValue={n.number || ""}
                  className="h-8 w-10 rounded-md bg-transparent px-1.5 text-center text-sm tabular-nums text-muted-foreground outline-none hover:bg-accent focus:bg-card focus:ring-[3px] focus:ring-ring"
                />
              )}
              <input
                name="title"
                required
                aria-label="Title"
                defaultValue={n.title}
                key={n.title}
                className={cn(
                  "h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm outline-none hover:bg-accent focus:bg-card focus:ring-[3px] focus:ring-ring",
                  kind === "chapters" && "font-medium",
                )}
              />
              <div className="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <Button type="submit" variant="ghost" size="icon-sm" aria-label={`Rename ${n.title}`} title="Save name">
                  <Check />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${n.title} up`}
                  disabled={i === 0}
                  onClick={() => move(kind, nodes, i, i - 1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${n.title} down`}
                  disabled={i === nodes.length - 1}
                  onClick={() => move(kind, nodes, i, i + 1)}
                >
                  <ArrowDown />
                </Button>
              </div>
            </form>
            {(n.sections || n.children || []).length > 0 &&
              list(n.sections || n.children, "sections", depth + 1)}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Edit & reorder contents</SheetTitle>
          <SheetDescription>
            Drag siblings to reorder, or use the arrows. Press Enter to save a name.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 scrollbar-thin">
          {error && <InlineMessage tone="error" className="mb-4">{error}</InlineMessage>}
          {toc.chapters.length ? (
            list(toc.chapters, "chapters")
          ) : (
            <p className="py-8 text-center text-muted-foreground">No chapters yet.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
