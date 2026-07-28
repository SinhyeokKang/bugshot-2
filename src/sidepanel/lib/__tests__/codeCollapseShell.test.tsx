// .tsx라 jsdom 환경 — 셸은 vanilla DOM 팩토리라 노드 환경으론 못 돌린다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCodeCollapseShell, type CodeCollapseLabels } from "../codeCollapseShell";

const labels: CodeCollapseLabels = {
  expand: (lines) => `expand ${lines}`,
  collapse: "collapse",
  copy: "copy",
  copied: "copied",
};

function makeShell() {
  const pre = document.createElement("pre");
  pre.textContent = "code";
  const shell = createCodeCollapseShell(pre, labels);
  shell.update(20);
  const copyBtn = shell.actionsEl.querySelector<HTMLButtonElement>(
    '[data-testid="code-collapse-copy"]',
  );
  expect(copyBtn).not.toBeNull();
  return { shell, copyBtn: copyBtn! };
}

describe("codeCollapseShell 행 번호 gutter", () => {
  function gutterOf(shell: ReturnType<typeof createCodeCollapseShell>) {
    const el = shell.wrapper.querySelector<HTMLElement>('[data-testid="code-collapse-gutter"]');
    expect(el, "gutter를 못 찾음").not.toBeNull();
    return el!;
  }

  const numbers = (gutter: HTMLElement) =>
    Array.from(gutter.children).map((el) => el.textContent);

  function makeBare(lineCount: number) {
    const pre = document.createElement("pre");
    pre.textContent = Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join("\n");
    const shell = createCodeCollapseShell(pre, labels);
    shell.update(lineCount);
    return { pre, shell };
  }

  it("번호 개수가 줄 수와 같고 1부터 연속한다", () => {
    const { shell } = makeBare(3);
    expect(numbers(gutterOf(shell))).toEqual(["1", "2", "3"]);
    shell.destroy();
  });

  it("한 줄짜리 블럭에도 번호가 붙는다 — 줄 수와 무관하게 항상 표시", () => {
    const { shell } = makeBare(1);
    expect(numbers(gutterOf(shell))).toEqual(["1"]);
    shell.destroy();
  });

  it("줄 수가 늘고 줄어도 번호가 1..n으로 따라간다", () => {
    const { shell } = makeBare(2);
    shell.update(5);
    expect(numbers(gutterOf(shell))).toEqual(["1", "2", "3", "4", "5"]);
    shell.update(3);
    expect(numbers(gutterOf(shell))).toEqual(["1", "2", "3"]);
    shell.destroy();
  });

  // 에디터는 키 입력마다 update()를 부른다 — 매번 전체를 다시 만들면 낭비이고,
  // 살아있는 노드를 갈아치우면 브라우저가 caret·선택을 잃는다.
  it("줄 수가 바뀌어도 기존 번호 노드를 재사용한다 (증분 갱신)", () => {
    const { shell } = makeBare(2);
    const first = gutterOf(shell).children[0];
    shell.update(9);
    expect(gutterOf(shell).children[0]).toBe(first);
    shell.update(2);
    expect(gutterOf(shell).children[0]).toBe(first);
    shell.destroy();
  });

  // gutter가 pre 안에 있으면 복사 버튼(pre.textContent)과 마크다운 직렬화에 번호가 섞인다.
  it("번호가 pre 밖에 있어 복사 텍스트를 오염시키지 않는다", () => {
    const { pre, shell } = makeBare(3);
    expect(pre.contains(gutterOf(shell))).toBe(false);
    expect(pre.textContent).toBe("line 1\nline 2\nline 3");
    shell.destroy();
  });

  // contenteditable 조상(에디터) 안에서 번호에 caret이 들어가거나 드래그 복사에 섞이면 안 된다.
  it("gutter는 편집 대상도 선택 대상도 아니다", () => {
    const { shell } = makeBare(3);
    const gutter = gutterOf(shell);
    expect(gutter.getAttribute("contenteditable")).toBe("false");
    expect(gutter.getAttribute("aria-hidden")).toBe("true");
    shell.destroy();
  });

  // gutter는 absolute라 폭이 내용 기반이다 — pre의 padding-left가 그 폭을 알아야 코드가
  // 번호 아래로 파고들지 않는다. 자릿수를 custom property로 넘겨 CSS가 ch로 환산한다.
  it("자릿수를 custom property로 넘겨 pre 들여쓰기를 맞춘다", () => {
    const { shell } = makeBare(9);
    const digits = () => shell.wrapper.style.getPropertyValue("--code-gutter-digits").trim();
    expect(digits()).toBe("1");
    shell.update(10);
    expect(digits()).toBe("2");
    shell.update(100);
    expect(digits()).toBe("3");
    shell.destroy();
  });
});

describe("codeCollapseShell copy 피드백 타이머", () => {
  let resolveWrite: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("클립보드 성공 시 copied 피드백이 1.5초 뒤 원상 복귀한다", async () => {
    const { shell, copyBtn } = makeShell();
    copyBtn.click();
    resolveWrite();
    await Promise.resolve();
    await Promise.resolve();

    expect(copyBtn.getAttribute("aria-label")).toBe("copied");
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1500);
    expect(copyBtn.getAttribute("aria-label")).toBe("copy");
    expect(vi.getTimerCount()).toBe(0);
    shell.destroy();
  });

  it("destroy 뒤 클립보드가 성공해도 타이머를 재장전하지 않는다", async () => {
    const { shell, copyBtn } = makeShell();
    copyBtn.click();
    shell.destroy();
    resolveWrite();
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.getTimerCount()).toBe(0);
  });
});
