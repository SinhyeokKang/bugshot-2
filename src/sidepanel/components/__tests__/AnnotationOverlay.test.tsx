import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 이미지가 로드되기 전 분기만 렌더한다 — Konva Stage는 jsdom에 캔버스 2D 컨텍스트가 없어
// 마운트되지 않는다. 그래서 도형·완료 버튼은 여기서 못 잡고 e2e·수동이 맡는다.
// 여기서 고정하는 건 오버레이 **껍데기의 계약**: dialog 식별, Escape 처리, 전파 차단.
const loadImage = vi.hoisted(() => vi.fn(() => new Promise<never>(() => {})));
vi.mock("@/sidepanel/capture", () => ({ loadImage }));
vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import AnnotationOverlay from "../AnnotationOverlay";

afterEach(() => {
  vi.clearAllMocks();
});

function renderOverlay(props: Partial<{ onComplete: () => void; onCancel: () => void; testId: string }> = {}) {
  const onCancel = props.onCancel ?? vi.fn();
  const onComplete = props.onComplete ?? vi.fn();
  const utils = render(
    <AnnotationOverlay
      imageUrl="data:image/webp;base64,AAAA"
      onComplete={onComplete}
      onCancel={onCancel}
      testId={props.testId}
    />,
  );
  return { ...utils, onCancel, onComplete };
}

describe("AnnotationOverlay — 다이얼로그 식별", () => {
  it("role=dialog와 접근명을 갖는다", () => {
    renderOverlay();

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("annotation.title");
  });

  // 포커스 트랩도 초기 포커스 이동도 없으므로 aria-modal을 선언하면 안 지키는 약속이 된다.
  it("aria-modal은 선언하지 않는다", () => {
    renderOverlay();

    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBeNull();
  });

  it("testId를 주면 기본 testid 대신 그것이 붙는다 (슬롯 구분)", () => {
    renderOverlay({ testId: "diff-annotation-overlay" });

    expect(screen.getByTestId("diff-annotation-overlay")).toBeTruthy();
    expect(screen.queryByTestId("annotation-overlay")).toBeNull();
  });
});

describe("AnnotationOverlay — Escape", () => {
  it("Escape로 취소된다", () => {
    const { onCancel } = renderOverlay();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // Radix DismissableLayer는 document 캡처에서 Escape를 듣는다 — 전파를 안 막으면
  // DraftEditDialog 안 인라인 이미지 주석에서 부모 다이얼로그가 함께 닫힌다.
  it("전파를 막아 document의 Escape 리스너에 닿지 않는다", () => {
    const documentListener = vi.fn();
    document.addEventListener("keydown", documentListener, true);
    renderOverlay();

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(documentListener).not.toHaveBeenCalled();
    document.removeEventListener("keydown", documentListener, true);
  });

  // 줌 Select가 열려 있으면 그 Escape는 Radix 레이어 몫이다. 여기서 가로채면 드롭다운 대신
  // 주석 작업이 통째로 날아간다.
  it("Radix 팝퍼 레이어 안에서 온 Escape는 비켜준다", () => {
    const { onCancel } = renderOverlay();
    const popper = document.createElement("div");
    popper.setAttribute("data-radix-popper-content-wrapper", "");
    const inner = document.createElement("button");
    popper.appendChild(inner);
    document.body.appendChild(popper);

    fireEvent.keyDown(inner, { key: "Escape" });

    expect(onCancel).not.toHaveBeenCalled();
    popper.remove();
  });

  // 한글 조합 중 Escape는 조합 취소다 — 저장소 관용구와 같은 가드.
  it("IME 조합 중 Escape는 무시한다", () => {
    const { onCancel } = renderOverlay();

    fireEvent.keyDown(document.body, { key: "Escape", isComposing: true });

    expect(onCancel).not.toHaveBeenCalled();
  });

  // 가드가 전파 차단보다 앞서면, 우리가 처리하지 않는 Escape가 부모 Dialog까지 올라가
  // DraftEditDialog가 닫힌다 — 가드는 전파를 끊은 **뒤**에 와야 한다.
  it("우리가 처리하지 않는 Escape(IME 조합 중)도 전파는 막는다", () => {
    const documentListener = vi.fn();
    document.addEventListener("keydown", documentListener, true);
    renderOverlay();

    fireEvent.keyDown(document.body, { key: "Escape", isComposing: true });

    expect(documentListener).not.toHaveBeenCalled();
    document.removeEventListener("keydown", documentListener, true);
  });

  it("Escape가 아닌 키는 전파를 막지 않는다", () => {
    const documentListener = vi.fn();
    document.addEventListener("keydown", documentListener, true);
    renderOverlay();

    fireEvent.keyDown(document.body, { key: "a" });

    expect(documentListener).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", documentListener, true);
  });

  it("언마운트 후에는 Escape를 더 듣지 않는다", () => {
    const { unmount, onCancel } = renderOverlay();

    unmount();
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("AnnotationOverlay — 포커스 복귀", () => {
  // 오버레이는 초기 포커스를 가져가지 않으므로, 마운트 후 포커스를 **다른 곳으로 옮긴 뒤**
  // 언마운트해야 복귀가 실제로 측정된다(안 옮기면 activeElement가 처음부터 끝까지 트리거라
  // 복귀 effect를 지워도 통과하는 공허한 테스트가 된다).
  it("닫힌 뒤 열 때 포커스를 갖고 있던 트리거로 되돌린다", () => {
    const trigger = document.createElement("button");
    const other = document.createElement("button");
    document.body.append(trigger, other);
    trigger.focus();

    const { unmount } = renderOverlay();
    other.focus();
    expect(document.activeElement).toBe(other);
    unmount();

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
    other.remove();
  });
});
