import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InlineMessage } from "./common/States";

/**
 * A small centered modal for creating a chapter or section - just enough
 * to name and place the new item. Writing a section's content happens
 * afterward in the full-screen MarkdownEditor (see Layout.jsx), so this
 * dialog stays minimal: a title, plus one optional extra field the caller
 * can ask for (a chapter's number).
 */
export default function NewItemDialog({
  heading,
  extraField,
  onCreate,
  onCancel,
}) {
  const [title, setTitle] = useState("");
  const [extraValue, setExtraValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      if (!title.trim()) return;
      setSaving(true);
      setError(null);
      try {
        await onCreate({
          title: title.trim(),
          ...(extraField && {
            [extraField.key]: extraValue.trim() || undefined,
          }),
        });
      } catch (err) {
        setError(err.message);
        setSaving(false);
      }
    },
    [title, extraValue, extraField, onCreate],
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent className="max-w-[26rem]">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>
            You’ll go straight to the editor to write it.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={submit}>
          <Field label="Title" htmlFor="new-item-title">
            <Input
              id="new-item-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </Field>
          {extraField && (
            <Field label={extraField.label} htmlFor="new-item-extra" optional>
              <Input
                id="new-item-extra"
                value={extraValue}
                onChange={(e) => setExtraValue(e.target.value)}
                className="w-28"
              />
            </Field>
          )}
          <InlineMessage tone="error">{error}</InlineMessage>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving && <Loader2 className="animate-spin" />}
              {saving ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
