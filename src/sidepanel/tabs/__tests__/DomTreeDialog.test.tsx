import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "@/types/picker";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));
vi.mock("@/sidepanel/hooks/useBoundTabId", () => ({ useBoundTabId: () => 1 }));
vi.mock("@/sidepanel/hooks/useBufferThenSwitch", () => ({
  useBufferThenSwitch: () => async (_tabId: number, fn: () => Promise<void>) => {
    await fn();
  },
}));

const describeInitialTree = vi.hoisted(() => vi.fn());
const describeChildren = vi.hoisted(() => vi.fn());
vi.mock("@/sidepanel/picker-control", () => ({
  describeInitialTree,
  describeChildren,
  navigatePicker: vi.fn(),
  previewClear: vi.fn(),
  previewHover: vi.fn(),
  selectByPath: vi.fn(),
}));

import { DomTreeTitle } from "../DomTreeDialog";

const CHILD: TreeNode = {
  selector: "div > span",
  tag: "span",
  id: null,
  classes: [],
  childCount: 0,
};

const TREE: TreeNode = {
  selector: "div",
  tag: "div",
  id: null,
  classes: [],
  childCount: 1,
  children: [CHILD],
};

beforeEach(() => {
  describeInitialTree.mockReset();
  describeChildren.mockReset();
  describeInitialTree.mockResolvedValue({ tree: TREE, ancestorPath: ["div"] });
});

async function openTree(): Promise<void> {
  render(<DomTreeTitle tagName="div" classList={[]} />);
  await userEvent.click(screen.getByTestId("dom-tree-trigger"));
  await waitFor(() => expect(screen.getByTestId("dom-tree-scroll")).toBeTruthy());
}

function chevron(): HTMLElement {
  const el = document
    .querySelector('[data-testid="dom-tree-node"]')
    ?.querySelector("button");
  if (!el) throw new Error("chevron not found");
  return el as HTMLElement;
}

// JsonTreeViewer의 chevron과 className이 바이트 동일한 쌍둥이인데 aria-expanded가 한쪽에만
// 있었다. 공용 컴포넌트로 빼면서 접근성은 강한 쪽으로 수렴시킨다 — 여기가 그 그물이다.
describe("DomTreeDialog — chevron 펼침 상태", () => {
  it("chevron이 aria-expanded를 갖는다 (펼침 상태 노출)", async () => {
    await openTree();

    expect(chevron().getAttribute("aria-expanded")).toBe("true");
  });

  it("클릭하면 aria-expanded가 뒤집힌다", async () => {
    await openTree();

    await userEvent.click(chevron());

    expect(chevron().getAttribute("aria-expanded")).toBe("false");
  });

  // i18n 키는 도메인 문구를 유지한다(dom.* — JsonTreeViewer의 common.*와 갈린 채로 둔다).
  it("접근명은 dom.* 키를 유지한다", async () => {
    await openTree();

    expect(chevron().getAttribute("aria-label")).toBe("dom.collapse");

    await userEvent.click(chevron());

    expect(chevron().getAttribute("aria-label")).toBe("dom.expand");
  });
});
