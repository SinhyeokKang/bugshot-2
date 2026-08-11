import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CornerLeftUp,
  CornerRightDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatElementName, visibleClasses } from "@/lib/element-label";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/store/editor-store";
import type { TreeNode } from "@/types/picker";
import { useBoundTabId } from "@/sidepanel/hooks/useBoundTabId";
import { useBufferThenSwitch } from "@/sidepanel/hooks/useBufferThenSwitch";
import {
  describeChildren,
  describeInitialTree,
  navigatePicker,
  previewClear,
  previewHover,
  selectByPath,
} from "@/sidepanel/picker-control";

export function DomNavButton({ direction }: { direction: "parent" | "child" }) {
  const t = useT();
  const tabId = useBoundTabId();
  const frameId = useEditorStore((s) => s.selection?.frameId ?? 0);
  const canNavigate = useEditorStore((s) =>
    direction === "parent"
      ? (s.selection?.hasParent ?? false)
      : (s.selection?.hasChild ?? false),
  );
  const bufferThenSwitch = useBufferThenSwitch();
  const Icon = direction === "parent" ? CornerLeftUp : CornerRightDown;
  const label = direction === "parent" ? t("dom.parent") : t("dom.child");
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className="h-8 w-8 shrink-0"
      title={label}
      aria-label={label}
      disabled={!canNavigate}
      onClick={() => {
        if (tabId) void bufferThenSwitch(tabId, () => navigatePicker(tabId, frameId, direction));
      }}
    >
      <Icon />
    </Button>
  );
}

export function DomTreeTitle({ tagName, classList }: { tagName: string; classList: string[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = formatElementName({ tag: tagName, classList });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="block w-full truncate text-center text-2xl font-semibold outline-none hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring"
          title={label}
          data-testid="dom-tree-trigger"
        >
          {label}
        </button>
      </DialogTrigger>
      <DialogContent className="w-[90vw] max-w-[800px] max-h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("dom.dialogTitle")}</DialogTitle>
        </DialogHeader>
        <DomTree onPicked={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function injectChildren(
  tree: TreeNode,
  selector: string,
  children: TreeNode[],
): TreeNode {
  if (tree.selector === selector) return { ...tree, children };
  if (!tree.children) return tree;
  return {
    ...tree,
    children: tree.children.map((c) => injectChildren(c, selector, children)),
  };
}

function DomTree({ onPicked }: { onPicked: () => void }) {
  const t = useT();
  const tabId = useBoundTabId();
  const bufferThenSwitch = useBufferThenSwitch();
  const frameId = useEditorStore((s) => s.selection?.frameId ?? 0);
  const [tree, setTree] = useState<TreeNode | null>(null);
  // 현재 노드 판정은 스토어의 selection.selector가 아니라 트리 응답에서 가져온다.
  // 그쪽은 buildStableSelector(2단계) 산출이고 node.selector는 buildSelector(compat)
  // 산출이라 앵커가 채택되는 요소에서 두 문자열이 갈린다 — 즉 이 기능이 일할 때만
  // 하이라이트가 무음으로 죽는다. ancestorPath의 마지막 항목이 같은 빌더로 만든
  // 선택 요소 selector다.
  const [currentSelector, setCurrentSelector] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tabId) return;
    let cancelled = false;
    setLoading(true);
    void describeInitialTree(tabId, frameId).then((resp) => {
      if (cancelled || !resp) {
        setLoading(false);
        return;
      }
      setTree(resp.tree);
      setExpanded(new Set(resp.ancestorPath));
      setCurrentSelector(resp.ancestorPath.at(-1));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tabId, frameId]);

  useEffect(() => {
    return () => {
      if (tabId) void previewClear(tabId, frameId);
    };
  }, [tabId, frameId]);

  const handleHover = (selector: string | null) => {
    if (!tabId) return;
    if (selector) void previewHover(tabId, frameId, selector);
    else void previewClear(tabId, frameId);
  };

  const handleSelect = (selector: string) => {
    if (!tabId) return;
    void previewClear(tabId, frameId);
    // DomNav·repick과 동일하게 현재 요소 편집을 버퍼에 담고 전환 — 안 그러면 트리 이동 시
    // 편집이 버퍼에 안 담겨 변경사항에서 소실된다(DOM 편집은 페이지에 남은 채).
    void bufferThenSwitch(tabId, async () => {
      await selectByPath(tabId, frameId, selector);
    });
    onPicked();
  };

  const handleToggle = (node: TreeNode) => {
    const willOpen = !expanded.has(node.selector);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.selector)) next.delete(node.selector);
      else next.add(node.selector);
      return next;
    });
    if (
      willOpen &&
      node.children === undefined &&
      node.childCount > 0 &&
      tabId
    ) {
      void describeChildren(tabId, frameId, node.selector)
        .then((resp) => {
          setTree((prev) => {
            if (!prev) return prev;
            return injectChildren(prev, node.selector, resp.children);
          });
        })
        .catch(() => {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(node.selector);
            return next;
          });
        });
    }
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t("dom.loading")}
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t("dom.error")}
      </div>
    );
  }

  return (
    <Card
      className="min-h-0 flex-1 overflow-auto overscroll-contain bg-background py-2 font-mono text-mono shadow-none"
      data-testid="dom-tree-scroll"
    >
      {/* w-max로 가장 넓은 행에 맞춰 폭을 잡고, 그 안의 행은 block이라 그 폭을 채운다 —
          안 그러면 가로 스크롤 시 짧은 행의 hover 배경이 컨테이너 폭에서 끊긴다.
          min-w-full은 트리가 좁을 때 행이 쪼그라드는 걸 막는다. */}
      <div className="w-max min-w-full">
        <DomTreeNode
          node={tree}
          depth={0}
          currentSelector={currentSelector}
          expanded={expanded}
          onHover={handleHover}
          onSelect={handleSelect}
          onToggle={handleToggle}
        />
      </div>
    </Card>
  );
}

function DomTreeNode({
  node,
  depth,
  currentSelector,
  expanded,
  onHover,
  onSelect,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  currentSelector?: string;
  expanded: Set<string>;
  onHover: (selector: string | null) => void;
  onSelect: (selector: string) => void;
  onToggle: (node: TreeNode) => void;
}) {
  const t = useT();
  const isOpen = expanded.has(node.selector);
  const kids = node.children;
  const isCurrent = node.selector === currentSelector;
  const indent = depth * 12 + 4;

  return (
    <div>
      <div
        className={cn(
          "flex cursor-pointer items-center gap-1 py-0.5 pr-2 hover:bg-muted",
          isCurrent && "bg-primary/10",
        )}
        style={{ paddingLeft: `${indent}px` }}
        data-testid="dom-tree-node"
        data-selector={node.selector}
        onMouseEnter={() => onHover(node.selector)}
        onMouseLeave={() => onHover(null)}
        onClick={() => onSelect(node.selector)}
      >
        {node.childCount > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void onToggle(node);
            }}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/15"
            aria-label={isOpen ? t("dom.collapse") : t("dom.expand")}
          >
            {isOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" />
        )}
        {/* 크기는 Card의 text-mono에 맡긴다. 말줄임 대신 nowrap — 들여쓰기가 폭을 먹은
            깊은 노드에서 태그명까지 잘려나가던 걸 Card의 가로 스크롤로 대체했다. */}
        <span
          className="whitespace-nowrap"
          data-testid="dom-tree-label"
          title={formatElementName({
            tag: node.tag,
            classList: node.classes,
            id: node.id,
            brackets: true,
          })}
        >
          <span className="text-muted-foreground">&lt;</span>
          <span className="text-sky-600 dark:text-sky-400">{node.tag}</span>
          {node.id ? (
            <span className="text-fuchsia-600 dark:text-fuchsia-400">#{node.id}</span>
          ) : null}
          {(() => {
            const { shown, extra } = visibleClasses(node.classes);
            return (
              <>
                {shown.map((c) => (
                  <span key={c} className="text-amber-600 dark:text-amber-400">
                    .{c}
                  </span>
                ))}
                {extra > 0 ? (
                  <span className="text-muted-foreground">+{extra}</span>
                ) : null}
              </>
            );
          })()}
          <span className="text-muted-foreground">&gt;</span>
          {node.childCount > 0 && !isOpen ? (
            <span className="ml-1 text-muted-foreground">
              ({node.childCount})
            </span>
          ) : null}
        </span>
      </div>
      {isOpen && kids
        ? kids.map((c) => (
            <DomTreeNode
              key={c.selector}
              node={c}
              depth={depth + 1}
              currentSelector={currentSelector}
              expanded={expanded}
              onHover={onHover}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))
        : null}
    </div>
  );
}
