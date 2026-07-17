import { CODE_COLLAPSE_LINE_THRESHOLD, shouldCollapseCode } from "./codeCollapse";
import { createBlockActions, createBlockIcon, type BlockActionSpec } from "./blockActions";
import "@/sidepanel/components/code-collapse.css";

export interface CodeCollapseLabels {
  expand: (lines: number) => string;
  collapse: string;
  copy: string;
  copied: string;
}

export interface CodeCollapseShell {
  readonly wrapper: HTMLDivElement;
  /** stopEvent가 "pill에서 난 이벤트만"을 판정하는 데 쓴다. */
  readonly toggle: HTMLButtonElement;
  /** 우상단 액션 그룹(복사·삭제). stopEvent 판정용 — PM이 이 클릭을 가로채면 안 된다. */
  readonly actionsEl: HTMLDivElement;
  /** 펼침 상태의 단일 출처 — 호출자가 따로 미러링하지 않는다. */
  readonly expanded: boolean;
  /** 접혀 있어 편집 대상이 아닌 상태(= collapsible && !expanded). NodeView의 stopEvent 판정용. */
  readonly readonly: boolean;
  /** 접힘으로 전이하는 순간 호출. 프레임워크가 caret을 블럭 밖으로 빼는 자리 —
   *  셸은 DOM만 알아서 PM state.selection을 못 건드린다. preview는 caret이 없어 안 쓴다. */
  onCollapse?: () => void;
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
  /** 표면별 추가 액션(에디터의 삭제 등). label을 getter로 주면 locale을 따라간다. */
  extraActions: BlockActionSpec[] = [],
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

  let copied = false;
  let copiedTimer: number | undefined;

  const actions = createBlockActions([
    {
      icon: "copy",
      get label() {
        return copied ? labels.copied : labels.copy;
      },
      testId: "code-collapse-copy",
      onClick: () => void copyCode(),
    },
    ...extraActions,
  ]);

  wrapper.append(pre, fade, toggle, actions.el);

  let lineCount = 1;
  let expanded = false;

  const isReadonly = () => shouldCollapseCode(lineCount) && !expanded;

  function render() {
    wrapper.setAttribute("data-collapsible", String(shouldCollapseCode(lineCount)));
    wrapper.setAttribute("data-collapsed", String(!expanded));
    // 접힌 블럭은 readonly — 브라우저가 잘린 영역에 caret을 놓지 못하게 막는다(에디터 한정
    // 의미. preview엔 편집 가능 조상이 없어 무해). 펼치면 .ProseMirror의 true를 되물려받는다.
    if (isReadonly()) pre.setAttribute("contenteditable", "false");
    else pre.removeAttribute("contenteditable");
    toggle.setAttribute("data-lines", String(lineCount));
    toggle.setAttribute("aria-expanded", String(expanded));
    // 라벨은 텍스트 노드로만 넣는다(innerHTML 금지) — 아이콘만 상수 SVG다.
    toggle.replaceChildren(
      createBlockIcon(expanded ? "chevronUp" : "chevronDown"),
      document.createTextNode(expanded ? labels.collapse : labels.expand(lineCount)),
    );
    renderActions();
  }

  // 라벨을 매번 다시 읽는다 — getter로 주면 locale 전환이 그대로 따라온다.
  function renderActions() {
    actions.setIcon("code-collapse-copy", copied ? "check" : "copy");
    actions.setLabel("code-collapse-copy", copied ? labels.copied : labels.copy);
    for (const spec of extraActions) actions.setLabel(spec.testId, spec.label);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(pre.textContent ?? "");
    } catch {
      return; // 클립보드 거부는 조용히 — 되돌릴 상태가 없다
    }
    copied = true;
    renderActions();
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => {
      copied = false;
      renderActions();
    }, 1500);
  }

  // 접힌 블럭은 통째로 펼치기 버튼이다 — pill은 작아서 조준이 어렵고, 접힌 코드는 어차피
  // 읽기 전용이라 블럭 클릭에 다른 의미가 없다. 펼친 뒤엔 pill만 토글하고 코드는 편집에 넘긴다.
  function onClick(e: MouseEvent) {
    if (!shouldCollapseCode(lineCount)) return;
    if (toggle.contains(e.target as Node)) {
      e.preventDefault();
      shell.setExpanded(!expanded);
      return;
    }
    if (!expanded) shell.setExpanded(true);
  }
  wrapper.addEventListener("click", onClick);

  const shell: CodeCollapseShell = {
    wrapper,
    toggle,
    actionsEl: actions.el,
    get expanded() {
      return expanded;
    },
    get readonly() {
      return isReadonly();
    },
    update(next) {
      lineCount = next;
      render();
    },
    setExpanded(next) {
      expanded = next;
      render();
      if (!isReadonly()) return;
      // 접으면 caret이 잘린 영역에 갇히고, 브라우저가 그 caret을 보이게 pre를 스크롤해 둔
      // 상태라 overflow-y: hidden으로 잘라도 scrollTop이 남아 **로그 중간이 보인 채** 접힌다.
      // DOM selection만 지우는 걸론 못 이긴다 — ProseMirror가 state.selection에서 되돌려놓고
      // 다시 스크롤한다. 그래서 caret을 실제로 빼는 건 호출자(NodeView) 몫이고(onCollapse),
      // 여기선 그 뒤에 스크롤만 최상단으로 되돌린다. readonly 복귀 = 항상 로그 최상단.
      shell.onCollapse?.();
      pre.scrollTop = 0;
    },
    destroy() {
      window.clearTimeout(copiedTimer);
      actions.destroy();
      wrapper.removeEventListener("click", onClick);
    },
    unwrap() {
      wrapper.replaceWith(pre);
    },
  };

  render();
  return shell;
}
