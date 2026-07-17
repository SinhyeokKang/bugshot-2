import { CODE_COLLAPSE_LINE_THRESHOLD, shouldCollapseCode } from "./codeCollapse";
import "@/sidepanel/components/code-collapse.css";

export interface CodeCollapseLabels {
  expand: (lines: number) => string;
  collapse: string;
}

export interface CodeCollapseShell {
  readonly wrapper: HTMLDivElement;
  /** stopEvent가 "pill에서 난 이벤트만"을 판정하는 데 쓴다. */
  readonly toggle: HTMLButtonElement;
  /** 펼침 상태의 단일 출처 — 호출자가 따로 미러링하지 않는다. */
  readonly expanded: boolean;
  /** 줄 수 갱신 → collapsible 여부·pill 라벨 재계산. expanded는 건드리지 않는다. */
  update(lineCount: number): void;
  setExpanded(expanded: boolean): void;
  /** click 리스너 해제. */
  destroy(): void;
  /** wrapper를 pre로 치환해 원래 자리를 복원. preview 훅 전용 —
   *  NodeView는 PM이 wrapper째 걷어가므로 부르면 에디터에 pre가 남는다. */
  unwrap(): void;
}

let preIdSeq = 0;

export function createCodeCollapseShell(
  pre: HTMLElement,
  labels: CodeCollapseLabels,
): CodeCollapseShell {
  const wrapper = document.createElement("div");
  wrapper.className = "code-collapse";
  wrapper.setAttribute("data-testid", "code-collapse");
  // 임계값의 유일한 출처는 TS 상수 — CSS는 이 custom property로 받아 쓴다.
  wrapper.style.setProperty("--code-collapse-lines", String(CODE_COLLAPSE_LINE_THRESHOLD));

  if (!pre.id) pre.id = `code-collapse-pre-${++preIdSeq}`;

  const fade = document.createElement("div");
  fade.className = "code-collapse-fade";
  fade.setAttribute("aria-hidden", "true");
  fade.setAttribute("contenteditable", "false");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "code-collapse-toggle";
  // 없으면 pill이 편집 영역으로 취급돼 커서가 들어가고, contenteditable 내부 button은
  // 브라우저별로 Tab 포커스가 도달하지 않는다.
  toggle.setAttribute("contenteditable", "false");
  toggle.setAttribute("aria-controls", pre.id);
  toggle.setAttribute("data-testid", "code-collapse-toggle");

  wrapper.append(pre, fade, toggle);

  let lineCount = 1;
  let expanded = false;

  function render() {
    wrapper.setAttribute("data-collapsible", String(shouldCollapseCode(lineCount)));
    wrapper.setAttribute("data-collapsed", String(!expanded));
    toggle.setAttribute("data-lines", String(lineCount));
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? labels.collapse : labels.expand(lineCount);
  }

  function onClick(e: MouseEvent) {
    e.preventDefault();
    shell.setExpanded(!expanded);
  }
  toggle.addEventListener("click", onClick);

  const shell: CodeCollapseShell = {
    wrapper,
    toggle,
    get expanded() {
      return expanded;
    },
    update(next) {
      lineCount = next;
      render();
    },
    setExpanded(next) {
      expanded = next;
      render();
    },
    destroy() {
      toggle.removeEventListener("click", onClick);
    },
    unwrap() {
      wrapper.replaceWith(pre);
    },
  };

  render();
  return shell;
}
