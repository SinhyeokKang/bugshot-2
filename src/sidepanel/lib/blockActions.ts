import "@/sidepanel/components/block-actions.css";

const SVG_NS = "http://www.w3.org/2000/svg";

// lucide-react는 React 컴포넌트만 내보내고 아이콘 데이터(iconNode)는 공개하지 않아서,
// React가 닿지 않는 DOM(ProseMirror NodeView·renderMarkdown 후처리)에선 쓸 수 없다.
// 그래서 lucide 원본 path를 그대로 인라인한다 — 두 번째 출처지만 아이콘은 값이 안정적이고
// 대안(코드블럭마다 React 루트를 심는 것)이 훨씬 무겁다. lucide를 올릴 땐 이 표를 확인한다.
// 출처: lucide `copy` / `check` / `trash-2` / `chevron-down` / `chevron-up`.
const ICON_PATHS = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
} as const;

export type BlockActionIcon = keyof typeof ICON_PATHS;

export function createBlockIcon(icon: BlockActionIcon): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICON_PATHS[icon]; // 위 상수 전용 — 사용자 입력이 닿지 않는다
  return svg;
}

export interface BlockActionSpec {
  icon: BlockActionIcon;
  /** aria-label + 툴팁. 아이콘만 있는 버튼이라 필수. */
  label: string;
  testId: string;
  onClick: () => void;
}

export interface BlockActions {
  /** 블럭 우상단에 얹을 컨테이너. 배치는 호출자 CSS 몫. */
  el: HTMLDivElement;
  /** 아이콘 교체(복사→체크 피드백 등). */
  setIcon(testId: string, icon: BlockActionIcon): void;
  setLabel(testId: string, label: string): void;
  destroy(): void;
}

/** 블럭(코드블럭·이미지 등) 우상단 아이콘 버튼 그룹. React 밖 DOM에서 쓰는 vanilla 팩토리. */
export function createBlockActions(specs: BlockActionSpec[]): BlockActions {
  const el = document.createElement("div");
  el.className = "block-actions";
  el.setAttribute("contenteditable", "false");

  const buttons = new Map<string, HTMLButtonElement>();
  const cleanups: (() => void)[] = [];

  for (const spec of specs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "block-actions-button";
    btn.setAttribute("contenteditable", "false");
    btn.setAttribute("data-testid", spec.testId);
    btn.setAttribute("aria-label", spec.label);
    btn.title = spec.label;
    btn.append(createBlockIcon(spec.icon));

    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      spec.onClick();
    };
    btn.addEventListener("click", onClick);
    cleanups.push(() => btn.removeEventListener("click", onClick));

    buttons.set(spec.testId, btn);
    el.append(btn);
  }

  return {
    el,
    setIcon(testId, icon) {
      const btn = buttons.get(testId);
      if (!btn) return;
      btn.replaceChildren(createBlockIcon(icon));
    },
    setLabel(testId, label) {
      const btn = buttons.get(testId);
      if (!btn) return;
      btn.setAttribute("aria-label", label);
      btn.title = label;
    },
    destroy() {
      for (const fn of cleanups) fn();
    },
  };
}
