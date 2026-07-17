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
