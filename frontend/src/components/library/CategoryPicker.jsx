import { useEffect, useState } from "react";
import { api } from "../../api";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineMessage } from "../common/States";

const NEW = "__new__";

function NewCategoryInput({ onCreate, onCancel, busy }) {
  const [name, setName] = useState("");
  return (
    <div className="flex gap-1.5">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name…"
        className="h-10"
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) {
            e.preventDefault();
            onCreate(name.trim());
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <Button type="button" size="sm" className="h-10" disabled={!name.trim() || busy} onClick={() => onCreate(name.trim())}>
        Add
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-10" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

// Lets an editor place a book under Category -> Subcategory, drawn from the
// shared taxonomy (GET /api/categories). A book only ever names its
// subcategory (`value`/`onChange` deal in that id) - the top-level select is
// local UI state used to narrow which subcategories are offered. "+ New…" in
// either dropdown creates that category on the spot via the API, so growing
// the taxonomy never requires SQL.
export default function CategoryPicker({ value, onChange }) {
  const [tree, setTree] = useState(null);
  const [error, setError] = useState("");
  const [topId, setTopId] = useState("");
  const [creating, setCreating] = useState(null); // "top" | "sub" | null
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    api
      .categories()
      .then((d) => setTree(d.categories))
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);

  // Once the tree loads, infer which top-level category the book's current
  // subcategory belongs to - the select itself only ever stores the leaf id.
  useEffect(() => {
    if (!tree || topId) return;
    const parent = tree.find((c) => c.children.some((s) => s.id === value));
    if (parent) setTopId(parent.id);
  }, [tree, value, topId]);

  if (!tree) return null;
  const top = tree.find((c) => c.id === topId);

  async function createCategory(name, parentId) {
    setBusy(true);
    setError("");
    try {
      const category = await api.createCategory({ name, parent_id: parentId });
      await refresh();
      return category;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Category">
        {creating === "top" ? (
          <NewCategoryInput
            busy={busy}
            onCancel={() => setCreating(null)}
            onCreate={async (name) => {
              const category = await createCategory(name, null);
              if (category) {
                setTopId(category.id);
                onChange(null);
                setCreating(null);
              }
            }}
          />
        ) : (
          <Select
            value={topId}
            onValueChange={(v) => {
              if (v === NEW) return setCreating("top");
              setTopId(v);
              onChange(null);
            }}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Choose a category…" />
            </SelectTrigger>
            <SelectContent>
              {tree.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
              <SelectItem value={NEW}>+ New category…</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label="Subcategory">
        {creating === "sub" ? (
          <NewCategoryInput
            busy={busy}
            onCancel={() => setCreating(null)}
            onCreate={async (name) => {
              const category = await createCategory(name, topId);
              if (category) {
                onChange(category.id);
                setCreating(null);
              }
            }}
          />
        ) : (
          <Select
            value={value || ""}
            disabled={!top}
            onValueChange={(v) => (v === NEW ? setCreating("sub") : onChange(v))}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder={top ? "Choose a subcategory…" : "Pick a category first"} />
            </SelectTrigger>
            <SelectContent>
              {top?.children.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
              {top && <SelectItem value={NEW}>+ New subcategory…</SelectItem>}
            </SelectContent>
          </Select>
        )}
      </Field>
      {error && <InlineMessage tone="error" className="sm:col-span-2">{error}</InlineMessage>}
    </div>
  );
}
