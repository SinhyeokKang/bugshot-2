import { lazy, Suspense, useEffect, useState } from "react";
import { useT } from "@/i18n";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  sectionLabelKey,
  sectionPlaceholderKey,
} from "@/store/settings-ui-store";
import { OrderedListEditor } from "@/sidepanel/components/OrderedListEditor";
import type { DraftEditTarget } from "@/sidepanel/lib/applyDraftFieldEdit";

const LazyTiptapEditor = lazy(() => import("../components/TiptapEditor"));

export function DraftEditDialog({
  open,
  target,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  target: DraftEditTarget | null;
  onOpenChange: (open: boolean) => void;
  onSave: (nextValue: string) => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open && target) setValue(target.value);
  }, [open, target]);

  const label =
    target?.kind === "section"
      ? target.section.labelOverride?.trim() ||
        t(sectionLabelKey(target.section.id))
      : t("section.issueTitle");
  const placeholder =
    target?.kind === "section"
      ? target.section.placeholderOverride?.trim() ||
        t(sectionPlaceholderKey(target.section.id))
      : "";

  const saveDisabled = target?.kind === "title" && !value.trim();

  function handleSave() {
    onSave(value);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-[80vw] max-w-[80vw] max-h-[80vh] flex-col gap-5 rounded-3xl p-6 sm:rounded-3xl"
        data-testid="draft-edit-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-xl">
            {t("draftDetail.editField.title", { label })}
          </DialogTitle>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
          {target?.kind === "title" ? (
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={label}
              className="text-sm"
              autoFocus
            />
          ) : target?.kind === "section" &&
            target.section.renderAs === "orderedList" ? (
            <OrderedListEditor
              value={value}
              onChange={setValue}
              placeholder={placeholder}
            />
          ) : target ? (
            <Suspense
              fallback={
                <Textarea
                  disabled
                  placeholder={placeholder}
                  className="min-h-32 resize-none text-sm"
                />
              }
            >
              <LazyTiptapEditor
                value={value}
                onChange={setValue}
                placeholder={placeholder}
                ariaLabel={label}
              />
            </Suspense>
          ) : null}
        </div>

        <DialogFooter className="!flex-row items-center !justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            data-testid="draft-edit-save"
            onClick={handleSave}
            disabled={saveDisabled}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
