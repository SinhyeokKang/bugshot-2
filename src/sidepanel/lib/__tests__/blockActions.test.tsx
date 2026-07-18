import { describe, expect, it, vi } from "vitest";
import { createBlockActions } from "../blockActions";

// 인라인 이미지 NodeView가 쓰는 신규 아이콘(rotateCcw·pencil)과 조건부 노출용 setHidden 검증.
// 코드블럭 소비처(copy·trash)와의 회귀도 함께 본다.

describe("createBlockActions — 신규 아이콘", () => {
  it("rotateCcw·pencil 아이콘이 svg path로 렌더된다", () => {
    const actions = createBlockActions([
      { icon: "rotateCcw", label: "reset", testId: "reset", onClick: () => {} },
      { icon: "pencil", label: "annotate", testId: "annotate", onClick: () => {} },
      { icon: "trash", label: "delete", testId: "delete", onClick: () => {} },
    ]);

    const buttons = actions.el.querySelectorAll("button");
    expect(buttons).toHaveLength(3);
    for (const btn of buttons) {
      const svg = btn.querySelector("svg");
      expect(svg).not.toBeNull();
      // path/line 등 실제 도형 노드가 있어야 함(빈 innerHTML = 아이콘 미정의).
      expect(svg!.childElementCount).toBeGreaterThan(0);
    }
  });
});

describe("createBlockActions — setHidden", () => {
  it("setHidden(testId, true/false)로 버튼 표시를 토글한다", () => {
    const actions = createBlockActions([
      { icon: "rotateCcw", label: "reset", testId: "reset", onClick: () => {} },
      { icon: "pencil", label: "annotate", testId: "annotate", onClick: () => {} },
    ]);
    const resetBtn = actions.el.querySelector<HTMLButtonElement>('[data-testid="reset"]')!;

    expect(resetBtn.hidden).toBe(false);
    actions.setHidden("reset", true);
    expect(resetBtn.hidden).toBe(true);
    actions.setHidden("reset", false);
    expect(resetBtn.hidden).toBe(false);
  });

  it("없는 testId엔 no-op(throw 안 함)", () => {
    const actions = createBlockActions([
      { icon: "trash", label: "delete", testId: "delete", onClick: () => {} },
    ]);
    expect(() => actions.setHidden("nope", true)).not.toThrow();
  });
});

describe("createBlockActions — 기존 소비처 회귀", () => {
  it("copy 아이콘 클릭이 onClick을 부른다(코드블럭 경로 유지)", () => {
    const onClick = vi.fn();
    const actions = createBlockActions([
      { icon: "copy", label: "copy", testId: "copy", onClick },
    ]);
    actions.el.querySelector<HTMLButtonElement>('[data-testid="copy"]')!.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
