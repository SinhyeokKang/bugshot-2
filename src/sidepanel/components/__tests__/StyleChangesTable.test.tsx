import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StyleChangesTable } from "../StyleChangesTable";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
}));

const DIFFS = [{ prop: "padding", asIs: "10px", toBe: "20px" }];

function cellOf(testId: "snapshot-before" | "snapshot-after"): HTMLElement {
  const img = screen.getByTestId(testId);
  return img.closest("[data-slot=card]") ?? (img.parentElement as HTMLElement);
}

describe("StyleChangesTable — 읽기 전용 화면 보호(핸들러 없으면 액션 없음)", () => {
  // PreviewPanel의 실제 호출부 형태: annotated는 주지만 핸들러는 주지 않는다.
  it("PreviewPanel 형태(annotated만) — 표시는 주석본이고 액션 버튼은 없다", () => {
    render(
      <StyleChangesTable
        beforeImage="data:before"
        afterImage="data:after"
        beforeAnnotated="data:before-ann"
        afterAnnotated="data:after-ann"
        diffs={DIFFS}
      />,
    );

    expect(screen.getByTestId("snapshot-before").getAttribute("src")).toBe(
      "data:before-ann",
    );
    expect(screen.getByTestId("snapshot-after").getAttribute("src")).toBe(
      "data:after-ann",
    );
    expect(screen.queryByTestId("diff-image-annotate")).toBeNull();
    expect(screen.queryByTestId("diff-image-reset")).toBeNull();
  });

  // DraftDetailDialog의 실제 호출부 형태: IDB에 이미 resolve된 이미지 한 장뿐이라 annotated도 안 준다.
  it("DraftDetailDialog 형태(핸들러·annotated 모두 없음) — 액션 버튼이 없고 탭 정지점도 없다", () => {
    const { container } = render(
      <StyleChangesTable
        beforeImage="data:before"
        afterImage="data:after"
        diffs={DIFFS}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[tabindex]")).toBeNull();
  });
});

describe("StyleChangesTable — annotated 표시 규칙(annotated ?? raw)", () => {
  it("annotated가 있으면 img src가 주석본이다", () => {
    render(
      <StyleChangesTable
        beforeImage="data:before"
        afterImage={null}
        beforeAnnotated="data:before-ann"
        diffs={DIFFS}
      />,
    );

    expect(screen.getByTestId("snapshot-before").getAttribute("src")).toBe(
      "data:before-ann",
    );
  });

  it("annotated가 없으면 img src가 원본이다", () => {
    render(
      <StyleChangesTable beforeImage="data:before" afterImage={null} diffs={DIFFS} />,
    );

    expect(screen.getByTestId("snapshot-before").getAttribute("src")).toBe(
      "data:before",
    );
  });

  it("before/after 칸의 alt가 서로 다르다 — 스크린 리더가 두 칸을 구분한다", () => {
    render(
      <StyleChangesTable beforeImage="data:before" afterImage="data:after" diffs={DIFFS} />,
    );

    const before = screen.getByTestId("snapshot-before").getAttribute("alt");
    const after = screen.getByTestId("snapshot-after").getAttribute("alt");
    expect(before).toBeTruthy();
    expect(after).toBeTruthy();
    expect(before).not.toBe(after);
  });

  it("주석본일 때 alt 문구가 원본과 다르다", () => {
    const { rerender } = render(
      <StyleChangesTable beforeImage="data:before" afterImage={null} diffs={DIFFS} />,
    );
    const raw = screen.getByTestId("snapshot-before").getAttribute("alt");

    rerender(
      <StyleChangesTable
        beforeImage="data:before"
        afterImage={null}
        beforeAnnotated="data:before-ann"
        diffs={DIFFS}
      />,
    );

    expect(screen.getByTestId("snapshot-before").getAttribute("alt")).not.toBe(raw);
  });
});

describe("StyleChangesTable — 액션 노출 조건", () => {
  function renderEditable(props: Record<string, unknown> = {}) {
    return render(
      <StyleChangesTable
        beforeImage="data:before"
        afterImage="data:after"
        diffs={DIFFS}
        onAnnotate={() => {}}
        onReset={() => {}}
        {...props}
      />,
    );
  }

  // opacity-0으로 숨기면 투명해도 탭 순서에 남아 요소당 최대 4개의 유령 정지점이 생긴다.
  it("hover·focus 전에는 액션 버튼이 DOM에 아예 없다", () => {
    const { container } = renderEditable();

    expect(screen.queryByTestId("diff-image-annotate")).toBeNull();
    expect(container.querySelector("[data-slot=button-group]")).toBeNull();
  });

  it("이미지에 hover하면 액션 버튼이 나타난다", async () => {
    renderEditable();

    await userEvent.hover(cellOf("snapshot-before"));

    expect(screen.getByTestId("diff-image-annotate")).toBeTruthy();
  });

  it("hover가 빠지면 액션 버튼이 다시 사라진다", async () => {
    renderEditable();
    const cell = cellOf("snapshot-before");

    await userEvent.hover(cell);
    await userEvent.unhover(cell);

    expect(screen.queryByTestId("diff-image-annotate")).toBeNull();
  });

  it("Tab으로 이미지 칸에 진입하면 액션 버튼이 나타난다", async () => {
    renderEditable();

    await userEvent.tab();

    expect(document.activeElement).toBe(cellOf("snapshot-before"));
    expect(screen.getByTestId("diff-image-annotate")).toBeTruthy();
  });

  // React onBlur는 focusout이라 버블한다 — 안쪽 이동을 안 거르면 탭해 들어가는 순간 사라진다.
  // userEvent.tab()으로는 못 잡는다: focusout/focusin이 한 배치에 묶여 최종값이 true로 수렴해
  // relatedTarget 가드를 지워도 통과한다. focusout만 단독 dispatch해야 갈린다.
  it("포커스가 카드 안쪽 버튼으로 이동하는 focusout은 그룹을 접지 않는다", async () => {
    renderEditable({ beforeAnnotated: "data:before-ann" });
    const cell = cellOf("snapshot-before");
    await userEvent.tab();

    const inner = screen.getByTestId("diff-image-reset");
    fireEvent.focusOut(cell, { relatedTarget: inner });

    expect(screen.getByTestId("diff-image-annotate")).toBeTruthy();
  });

  it("포커스가 카드 밖으로 나가는 focusout은 그룹을 접는다", async () => {
    renderEditable();
    const cell = cellOf("snapshot-before");
    await userEvent.tab();

    fireEvent.focusOut(cell, { relatedTarget: document.body });

    expect(screen.queryByTestId("diff-image-annotate")).toBeNull();
  });

  // hovered/focused를 한 플래그로 합치면 이 케이스가 깨진다 — 마우스는 그대로인데 포커스만
  // 밖으로 나갔다고 커서 밑 그룹이 사라진다. (제거 버튼 언마운트로는 focusout이 발화하지 않아
  // 그 경로로는 두 플래그가 갈리지 않는다.)
  it("마우스를 올린 채 포커스만 밖으로 나가도 그룹이 유지된다", async () => {
    renderEditable();
    const cell = cellOf("snapshot-before");

    await userEvent.hover(cell);
    await userEvent.tab();
    fireEvent.focusOut(cell, { relatedTarget: document.body });

    expect(screen.getByTestId("diff-image-annotate")).toBeTruthy();
  });

  // 제거 버튼이 언마운트되면 포커스가 body로 떨어진다 — 진입점인 카드로 되돌려야 키보드
  // 사용자가 남은 [주석 추가]에 이어서 닿을 수 있다.
  it("제거를 누르면 포커스가 카드로 돌아온다", async () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <StyleChangesTable
        beforeImage="data:before"
        afterImage="data:after"
        beforeAnnotated="data:before-ann"
        diffs={DIFFS}
        onAnnotate={() => {}}
        onReset={onReset}
      />,
    );

    await userEvent.tab();
    await userEvent.click(screen.getByTestId("diff-image-reset"));
    rerender(
      <StyleChangesTable
        beforeImage="data:before"
        afterImage="data:after"
        diffs={DIFFS}
        onAnnotate={() => {}}
        onReset={onReset}
      />,
    );

    expect(onReset).toHaveBeenCalledWith("before");
    expect(document.activeElement).toBe(cellOf("snapshot-before"));
    expect(screen.getByTestId("diff-image-annotate")).toBeTruthy();
  });

  it("액션이 있는 칸은 group role과 접근명을 갖는다", () => {
    renderEditable();

    const cell = cellOf("snapshot-before");
    expect(cell.getAttribute("role")).toBe("group");
    expect(cell.getAttribute("aria-label")).toBe("alt.beforeSnapshot");
  });

  it("주석이 없으면 제거 버튼이 없다", async () => {
    renderEditable();

    await userEvent.hover(cellOf("snapshot-before"));

    expect(screen.queryByTestId("diff-image-reset")).toBeNull();
  });

  it("주석이 있으면 제거 버튼이 함께 뜬다", async () => {
    renderEditable({ beforeAnnotated: "data:before-ann" });

    await userEvent.hover(cellOf("snapshot-before"));

    expect(screen.getByTestId("diff-image-reset")).toBeTruthy();
  });

  it("이미지가 없는 칸은 버튼 없이 noSnapshot만 낸다", () => {
    render(
      <StyleChangesTable
        beforeImage={null}
        afterImage={null}
        diffs={DIFFS}
        onAnnotate={() => {}}
      />,
    );

    expect(screen.getAllByText("styleTable.noSnapshot")).toHaveLength(2);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("StyleChangesTable — slot 전달", () => {
  it("before 칸의 주석 버튼은 onAnnotate('before')를 부른다", async () => {
    const onAnnotate = vi.fn();
    render(
      <StyleChangesTable
        beforeImage="data:before"
        afterImage="data:after"
        diffs={DIFFS}
        onAnnotate={onAnnotate}
      />,
    );

    await userEvent.hover(cellOf("snapshot-before"));
    await userEvent.click(screen.getByTestId("diff-image-annotate"));

    expect(onAnnotate).toHaveBeenCalledWith("before");
  });

  it("after 칸의 주석 버튼은 onAnnotate('after')를 부른다", async () => {
    const onAnnotate = vi.fn();
    render(
      <StyleChangesTable
        beforeImage="data:before"
        afterImage="data:after"
        diffs={DIFFS}
        onAnnotate={onAnnotate}
      />,
    );

    await userEvent.hover(cellOf("snapshot-after"));
    await userEvent.click(screen.getByTestId("diff-image-annotate"));

    expect(onAnnotate).toHaveBeenCalledWith("after");
  });

  it("after 칸의 제거 버튼은 onReset('after')를 부른다", async () => {
    const onReset = vi.fn();
    render(
      <StyleChangesTable
        beforeImage="data:before"
        afterImage="data:after"
        afterAnnotated="data:after-ann"
        diffs={DIFFS}
        onAnnotate={() => {}}
        onReset={onReset}
      />,
    );

    await userEvent.hover(cellOf("snapshot-after"));
    await userEvent.click(screen.getByTestId("diff-image-reset"));

    expect(onReset).toHaveBeenCalledWith("after");
  });
});
