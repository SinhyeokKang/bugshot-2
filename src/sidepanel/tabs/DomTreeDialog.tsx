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
import { useBoundTabId } from "../hooks/useBoundTabId";
import {
  describeChildren,
  describeInitialTree,
  navigatePicker,
  previewClear,
  previewHover,
  selectByPath,
} from "../picker-control";

export function DomNavButton({ direction }: { direction: "parent" | "child" }) {
  const t = useT();
  const tabId = useBoundTabId();
  const canNavigate = useEditorStore((s) =>
    direction === "parent"
      ? (s.selection?.hasParent ?? false)
      : (s.selection?.hasChild ?? false),
  );
  const Icon = direction === "parent" ? CornerLeftUp : CornerRightDown;
  const label = direction === "parent" ? t("dom.parent") : t("dom.child");
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className="h-8 w-8 shrink-0"
      title={label}
      disabled={!canNavigate}
      onClick={() => {
        if (tabId) void navigatePicker(tabId, direction);
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
          className="block w-full truncate text-center text-2xl font-semibold outline-none hover:opacity-70 focus-visible:ring-1 focus-visible:ring-ring"
          title={label}
        >
          {label}
        </button>
      </DialogTrigger>
      <DialogContent className="w-[80vw] max-w-[80vw] max-h-[80vh] gap-5 rounded-3xl p-6 sm:rounded-3xl">
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
  const currentSelector = useEditorStore((s) => s.selection?.selector);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tabId) return;
    let cancelled = false;
    setLoading(true);
    void describeInitialTree(tabId).then((resp) => {
      if (cancelled || !resp) {
        setLoading(false);
        return;
      }
      setTree(resp.tree);
      setExpanded(new Set(resp.ancestorPath));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tabId]);

  useEffect(() => {
    return () => {
      if (tabId) void previewClear(tabId);
    };
  }, [tabId]);

  const handleHover = (selector: string | null) => {
    if (!tabId) return;
    if (selector) void previewHover(tabId, selector);
    else void previewClear(tabId);
  };

  const handleSelect = (selector: string) => {
    if (!tabId) return;
    void previewClear(tabId);
    void selectByPath(tabId, selector);
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
      void describeChildren(tabId, node.selector)
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
    <Card className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background py-2 text-[13px]">
      <DomTreeNode
        node={tree}
        depth={0}
        currentSelector={currentSelector}
        expanded={expanded}
        onHover={handleHover}
        onSelect={handleSelect}
        onToggle={handleToggle}
      />
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
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="text-muted-foreground">&lt;</span>
          <span className="text-sky-600">{node.tag}</span>
          {node.id ? (
            <span className="text-fuchsia-600">#{node.id}</span>
          ) : null}
          {(() => {
            const { shown, extra } = visibleClasses(node.classes);
            return (
              <>
                {shown.map((c) => (
                  <span key={c} className="text-amber-600">
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
