import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useT } from "@/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatElementName } from "@/lib/element-label";
import { useEditorStore, type EditorStyleEdits } from "@/store/editor-store";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { captureElementSnapshotBySelector } from "@/sidepanel/capture";
import {
  buildStyleDiff,
  DiffValue,
} from "@/sidepanel/components/StyleChangesTable";
import {
  buildChangeGroups,
  countChangeRows,
  removeDiffRow,
  type ChangeGroup,
} from "@/sidepanel/lib/styleChangeGroups";
import {
  applyClasses,
  applyEditsBySelector,
  applyStyles,
  applyText,
  resetAllEdits,
  selectByPath,
} from "@/sidepanel/picker-control";

export function StyleChangesDialog() {
  const t = useT();
  const tabId = useBoundTabId();
  const selection = useEditorStore((s) => s.selection);
  const styleEdits = useEditorStore((s) => s.styleEdits);
  const bufferedElements = useEditorStore((s) => s.bufferedElements);
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const groups = useMemo(
    () => buildChangeGroups(selection, styleEdits, bufferedElements),
    [selection, styleEdits, bufferedElements],
  );
  const count = countChangeRows(groups);
  const busy = busyKey !== null;

  // 0건 자동 닫힘은 reactive — 비동기 재선택(selectByPath)·페이지 reload 세션 리셋까지 커버.
  useEffect(() => {
    if (open && count === 0) setOpen(false);
  }, [open, count]);

  const applyBufferedReset = async (group: ChangeGroup, next: EditorStyleEdits) => {
    if (!tabId) return;
    // found=false(요소 소실)여도 store 갱신은 진행해 UI 일관성 유지 — 원복 불가는 restoreAll과 동일 한계.
    const found = await applyEditsBySelector(tabId, group.selector, {
      classList: next.classList,
      inlineStyle: next.inlineStyle,
      text: group.snapshot.text === null ? null : next.text,
    });
    const remaining = buildStyleDiff(group.snapshot, next);
    if (remaining.length === 0) {
      useEditorStore.getState().removeBufferedElement(group.selector);
    } else {
      useEditorStore.getState().patchBufferedElement(group.selector, {
        styleEdits: next,
      });
      // DOM 미원복 상태(found=false)의 재캡처는 잔여 diff와 모순된 이미지를 만들므로 기존 afterImage 유지.
      if (found) {
        const img = await captureElementSnapshotBySelector(tabId, group.selector);
        if (img) {
          useEditorStore.getState().patchBufferedElement(group.selector, {
            afterImage: img,
          });
        }
      }
    }
    // 재선택된 버퍼 항목(중복 케이스): 재선택으로 selection·styleEdits 베이스라인 갱신.
    if (group.selector === useEditorStore.getState().selection?.selector) {
      await selectByPath(tabId, group.selector);
    }
  };

  const handleResetRow = async (group: ChangeGroup, prop: string, key: string) => {
    if (!tabId || busy) return;
    setBusyKey(key);
    try {
      const next = removeDiffRow(group.snapshot, group.edits, prop);
      if (group.source === "current") {
        useEditorStore.getState().setStyleEdits(next);
        if (prop === "class") await applyClasses(tabId, next.classList);
        else if (prop === "text") await applyText(tabId, next.text);
        else await applyStyles(tabId, next.inlineStyle);
      } else {
        await applyBufferedReset(group, next);
      }
    } finally {
      setBusyKey(null);
    }
  };

  const handleResetAll = () => {
    useEditorStore.getState().resetAllStyleEdits();
    if (tabId) void resetAllEdits(tabId);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={count === 0} data-testid="changes-trigger">
          {t("editor.changesDialog.trigger")}
          {count > 0 && (
            <span className="font-normal text-muted-foreground">{count}</span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="w-[80vw] max-w-[80vw] max-h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl"
        data-testid="changes-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-xl">
            {t("editor.changesDialog.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
          {groups.map((group) => (
            <GroupCard
              key={`${group.source}:${group.selector}`}
              group={group}
              busyKey={busyKey}
              onResetRow={handleResetRow}
            />
          ))}
        </div>
        <DialogFooter className="!flex-row items-center !justify-between">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                data-testid="reset-all"
              >
                {t("editor.changesDialog.resetAll")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("editor.resetChanges")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("editor.resetChanges.body", { count })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleResetAll} data-testid="reset-all-confirm">
                  {t("common.reset")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button onClick={() => setOpen(false)}>{t("common.ok")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupCard({
  group,
  busyKey,
  onResetRow,
}: {
  group: ChangeGroup;
  busyKey: string | null;
  onResetRow: (group: ChangeGroup, prop: string, key: string) => Promise<void>;
}) {
  const t = useT();
  const busy = busyKey !== null;
  const label = formatElementName({
    tag: group.tagName,
    classList: group.classList,
  });
  const elementKey = `${group.source}:${group.selector}`;

  return (
    <Card
      className="p-3"
      data-testid="changes-card"
      data-source={group.source}
      data-selector={group.selector}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-medium" title={label}>
          {label}
        </span>
        {group.source === "current" && (
          <Badge variant="secondary" className="shrink-0">
            {t("editor.changesDialog.current")}
          </Badge>
        )}
      </div>
      <div className="mt-2 space-y-2">
        {group.rows.map((row) => {
          const rowKey = `${elementKey}:${row.prop}`;
          return (
            <div
              key={row.prop}
              className="flex items-center gap-2 rounded-lg bg-muted/40 p-3"
              data-testid="changes-row"
              data-prop={row.prop}
            >
              <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                <div className="font-medium">{row.prop}</div>
                <div>
                  <DiffValue value={row.asIs} muted data-testid="changes-asis" />
                  <span className="mx-1 text-muted-foreground">→</span>
                  <DiffValue value={row.toBe} data-testid="changes-tobe" />
                </div>
              </div>
              <ResetButton
                label={t("editor.changesDialog.resetRow")}
                spinning={busyKey === rowKey}
                disabled={busy}
                onClick={() => void onResetRow(group, row.prop, rowKey)}
                data-testid="reset-row"
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ResetButton({
  label,
  spinning,
  disabled,
  onClick,
  "data-testid": testid,
}: {
  label: string;
  spinning: boolean;
  disabled: boolean;
  onClick: () => void;
  "data-testid": string;
}) {
  return (
    <Button
      size="icon"
      variant="outline"
      className="h-8 w-8 shrink-0"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testid}
    >
      {spinning ? <Loader2 className="animate-spin" /> : <Trash2 />}
    </Button>
  );
}
