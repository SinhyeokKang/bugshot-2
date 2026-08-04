import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImageActions } from "../ImageActions";

// 키 반환 모킹 — 실제 ko/en 문구는 locales.test.ts가 맡는다. 여기서 고정하는 건
// "어느 키 계열을 쓰는가"다(editor.image.* 가 아니라 draft.* — 같은 화면의 스크린샷 주석과 동일 계열).
vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
}));

describe("ImageActions", () => {
  it("onReset이 없으면 버튼이 하나(주석 추가)뿐이다", () => {
    render(<ImageActions onAnnotate={() => {}} />);

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByTestId("diff-image-reset")).toBeNull();
    expect(
      screen.getByTestId("diff-image-annotate").getAttribute("aria-label"),
    ).toBe("draft.addAnnotation");
  });

  it("onReset이 있으면 버튼이 둘이고 주석 버튼 문구가 '수정'으로 갈린다", () => {
    render(<ImageActions onAnnotate={() => {}} onReset={() => {}} />);

    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(
      screen.getByTestId("diff-image-reset").getAttribute("aria-label"),
    ).toBe("draft.removeAnnotation");
    expect(
      screen.getByTestId("diff-image-annotate").getAttribute("aria-label"),
    ).toBe("draft.editAnnotation");
  });

  // 인라인 이미지 액션과 같은 순서 — 사용자가 두 번 배우지 않는다.
  it("아이콘 순서는 [제거][주석]이다", () => {
    render(<ImageActions onAnnotate={() => {}} onReset={() => {}} />);

    const ids = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("data-testid"));
    expect(ids).toEqual(["diff-image-reset", "diff-image-annotate"]);
  });

  it("주석 버튼 클릭이 onAnnotate를 1회 호출한다", async () => {
    const onAnnotate = vi.fn();
    render(<ImageActions onAnnotate={onAnnotate} onReset={() => {}} />);

    await userEvent.click(screen.getByTestId("diff-image-annotate"));

    expect(onAnnotate).toHaveBeenCalledTimes(1);
  });

  it("제거 버튼 클릭이 onReset을 1회 호출한다 (확인 다이얼로그 없음)", async () => {
    const onReset = vi.fn();
    render(<ImageActions onAnnotate={() => {}} onReset={onReset} />);

    await userEvent.click(screen.getByTestId("diff-image-reset"));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  // hidden 속성으로 숨기면 :first-child를 계속 점유해 ButtonGroup 좌측 모서리가 각진다
  // (POSTMORTEM 2026-07-18). React에서는 조건부 렌더라 그 함정이 없어야 한다.
  it("제거 버튼을 hidden 속성으로 숨기지 않는다 — DOM에 아예 없다", () => {
    const { container } = render(<ImageActions onAnnotate={() => {}} />);

    expect(container.querySelector("[hidden]")).toBeNull();
  });

  it("role=group으로 묶인다", () => {
    render(<ImageActions onAnnotate={() => {}} onReset={() => {}} />);

    expect(screen.getByRole("group")).toBeTruthy();
  });
});
