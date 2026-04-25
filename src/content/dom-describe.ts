import { finder } from "@medv/finder";
import type {
  DescribeChildrenResponse,
  DescribeInitialResponse,
  TreeNode,
} from "@/types/picker";

import { HOST_ID } from "./overlay";

export function buildSelector(el: Element): string {
  try {
    return finder(el as HTMLElement, {
      seedMinLength: 2,
      optimizedMinLength: 2,
      timeoutMs: 500,
      maxNumberOfPathChecks: 2000,
    });
  } catch (err) {
    console.warn("[bugshot] finder failed, using path fallback", err);
    return pathSelector(el);
  }
}

export function buildInitialTree(
  selectedEl: Element | null,
): DescribeInitialResponse {
  const ancestorChain: Element[] = [];
  if (selectedEl) {
    let cur: Element | null = selectedEl;
    while (cur) {
      ancestorChain.unshift(cur);
      cur = cur.parentElement;
    }
  }
  const ancestorSet = new Set<Element>(ancestorChain);
  const ancestorPath = ancestorChain.map(buildSelector);

  function expand(el: Element): TreeNode {
    const node = describeShallow(el);
    const kids = Array.from(el.children).filter(isRenderable);
    node.children = kids.map((child) =>
      ancestorSet.has(child) ? expand(child) : describeShallow(child),
    );
    return node;
  }

  if (!selectedEl) {
    const root = describeShallow(document.documentElement);
    const kids = Array.from(document.documentElement.children).filter(
      isRenderable,
    );
    root.children = kids.map(describeShallow);
    return { tree: root, ancestorPath: [] };
  }

  return { tree: expand(document.documentElement), ancestorPath };
}

export function buildChildrenResponse(
  selector: string,
): DescribeChildrenResponse {
  let el: Element | null = null;
  try {
    el = document.querySelector(selector);
  } catch {
    el = null;
  }
  if (!el) return { children: [] };
  const kids = Array.from(el.children).filter(isRenderable);
  return { children: kids.map(describeShallow) };
}

export function parentOf(el: Element): Element | null {
  const p = el.parentElement;
  if (!p) return null;
  if (p === document.documentElement || p === document.body) return null;
  return p;
}

export function firstChildOf(el: Element): Element | null {
  for (const child of Array.from(el.children)) {
    const rect = child.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return child;
  }
  return el.children[0] ?? null;
}

/* ── internal ────────────────────────────────────── */

function isRenderable(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (
    tag === "script" ||
    tag === "style" ||
    tag === "meta" ||
    tag === "link" ||
    tag === "noscript" ||
    tag === "template" ||
    tag === "head"
  ) {
    return false;
  }
  if (el.id === HOST_ID) return false;
  return true;
}

function describeShallow(el: Element): TreeNode {
  const kids = Array.from(el.children).filter(isRenderable);
  return {
    selector: buildSelector(el),
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: Array.from(el.classList),
    childCount: kids.length,
  };
}

function pathSelector(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const same = Array.from(parent.children).filter(
      (s) => s.tagName === cur!.tagName,
    );
    if (same.length === 1) {
      parts.unshift(tag);
    } else {
      parts.unshift(`${tag}:nth-of-type(${same.indexOf(cur) + 1})`);
    }
    cur = parent;
  }
  return parts.join(" > ");
}
