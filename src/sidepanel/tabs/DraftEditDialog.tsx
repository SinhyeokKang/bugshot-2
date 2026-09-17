import { lazy, Suspense, useState } from "react";
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
  // 닫힘 exit 애니메이션 동안 target=null로 폴백돼 헤더 라벨이 깜빡이지 않도록 마지막 대상을 유지.
  // 값은 그 대상과 한 쌍으로 둔다 — 떠나는 Tiptap이 포커스 트랜잭션으로 onUpdate를 늦게 쏘면
  // 새 대상의 seed를 덮어써 제목 입력칸이 본문으로 채워졌다(#234). 소유 대상이 다르면 버린다.
  const [session, setSession] = useState<{
    active: DraftEditTarget | null;
    value: string;
  }>({ active: null, value: "" });
  const { active, value } = session;

  if (open && target && target !== active) {
    setSession({ active: target, value: target.value });
  }

  const setValue = (next: string) =>
    setSession((s) => (s.active === active ? { ...s, value: next } : s));

  const label =
    active?.kind === "section"
      ? active.section.labelOverride?.trim() ||
        t(sectionLabelKey(active.section.id))
      : t("section.issueTitle");
  const placeholder =
    active?.kind === "section"
      ? active.section.placeholderOverride?.trim() ||
        t(sectionPlaceholderKey(active.section.id))
      : "";

  const saveDisabled = active?.kind === "title" && !value.trim();

  function handleSave() {
    onSave(active?.kind === "title" ? value.trim() : value);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-[90vw] max-w-[800px] max-h-[80vh] flex-col gap-5 rounded-3xl p-6 sm:rounded-3xl"
        data-testid="draft-edit-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-xl">
            {t("draftDetail.editField.title", { label })}
          </DialogTitle>
        </DialogHeader>

        <div className="-m-1 min-h-0 flex-1 overflow-y-auto p-1">
          {active?.kind === "title" ? (
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={label}
              className="text-sm"
              autoFocus
            />
          ) : active?.kind === "section" &&
            active.section.renderAs === "orderedList" ? (
            <OrderedListEditor
              value={value}
              onChange={setValue}
              placeholder={placeholder}
            />
          ) : active ? (
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
          <Button
            variant="outline"
            data-testid="draft-edit-cancel"
            onClick={() => onOpenChange(false)}
          >
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
