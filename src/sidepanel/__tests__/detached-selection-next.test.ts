import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../picker-clear", () => ({
  clearPicker: vi.fn(() => Promise.resolve()),
  tabFrameTokens: new Map<number, string>(),
}));

import { isCaptureEntryScreen } from "@/lib/capture-commands";
import { useEditorStore } from "@/store/editor-store";
import { releaseDetachedSelection } from "../picker-control";

// #264: 스타일을 바꾼 요소를 페이지에서 지우고 [다음]을 누르면 after 캡처의 prepare가 소실을
// 감지해 picker.selectionDetached를 보내고(→ releaseDetachedSelection), 같은 시각 handleNext는
// null 결과로 confirmStyles를 부른다. 두 전이의 도착 순서는 메시지 왕복에 달려 정해지지 않는다 —
// 어느 순서든 패널은 캡처 진입 화면이어야 한다(빈 drafting이면 패널 전체가 빈다).
function seedStyling(): void {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useEditorStore.setState({
    captureMode: "element",
    phase: "styling",
    target: { tabId: 1, url: "https://example.com", title: "t" },
    selection: { selector: "p" } as never,
    styleEdits: { classList: [], inlineStyle: { color: "red" }, text: "", cssText: null },
    beforeImage: "data:before",
  });
}

function rendersEntryScreen(): boolean {
  const s = useEditorStore.getState();
  return s.phase !== "drafting" && s.phase !== "previewing" && isCaptureEntryScreen(s);
}

describe("요소 소실 뒤 [다음] — 해제와 확정의 도착 순서 (#264)", () => {
  beforeEach(seedStyling);

  it("해제가 먼저 착지하면 확정이 drafting으로 넘기지 않는다", async () => {
    await releaseDetachedSelection(1);
    useEditorStore.getState().confirmStyles();

    expect(rendersEntryScreen()).toBe(true);
  });

  it("확정이 먼저 착지하면 해제가 drafting을 진입 화면으로 접는다", async () => {
    useEditorStore.getState().confirmStyles();
    expect(useEditorStore.getState().phase).toBe("drafting");

    await releaseDetachedSelection(1);

    expect(rendersEntryScreen()).toBe(true);
  });
});
