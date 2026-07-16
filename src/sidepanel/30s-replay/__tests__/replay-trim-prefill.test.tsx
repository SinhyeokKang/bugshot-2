// 30s 리플레이 trim 진입 시 재현 단계 자동 채움이 영구 미발화되던 회귀(POSTMORTEM 2026-07-17).
// 커버 범위: store 계약(실물 onRecordingComplete/resolveReplayTrim) + 실물 useReproPrefill의 발화·유실.
// **커버 못 하는 것**: App/IssueTab이 그 게이트를 실제로 읽는지(배선). 아래 fixture는 실물 게이트를
// 복사한 것이라 App.tsx를 pendingTrim 게이트로 되돌려도 여기선 green이다 — tiptap/konva lazy 청크
// 때문에 실물 렌더가 불가하다. 배선의 안전망은 e2e·수동뿐(CLAUDE.md "jsdom으로 못 잡는 것").
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState, useEffect } from "react";
import { render, act } from "@testing-library/react";

vi.mock("@/sidepanel/lib/generateReproPrefill", () => ({
  generateReproStepsWithAI: vi.fn(),
}));
vi.mock("@/sidepanel/lib/llmErrorToast", () => ({ toastLlmError: vi.fn() }));

import { useReproPrefill } from "@/sidepanel/hooks/useReproPrefill";
import { generateReproStepsWithAI } from "@/sidepanel/lib/generateReproPrefill";
import { toastLlmError } from "@/sidepanel/lib/llmErrorToast";
import { NANO_CAPABILITIES } from "@/sidepanel/lib/ai-provider";
import { useEditorStore } from "@/store/editor-store";
import type { ActionLog } from "@/types/action";

const actionLog = (): ActionLog => ({
  id: "a",
  startedAt: 0,
  endedAt: 2,
  totalSeen: 2,
  captured: 2,
  entries: [0, 1].map((i) => ({
    id: String(i),
    kind: "click" as const,
    timestamp: i,
    pageUrl: "https://ex.com",
    target: `t${i}`,
  })),
});

// DraftingPanel 축약 — draft 생성 effect + useReproPrefill 배선만 재현.
// 실물은 tiptap/konva lazy 청크를 끌고 와 jsdom에 못 올린다.
function DraftingPanelLike({ trimming }: { trimming: boolean }) {
  const draft = useEditorStore((s) => s.draft);
  const setDraft = useEditorStore((s) => s.setDraft);
  const captureMode = useEditorStore((s) => s.captureMode);
  const actLog = useEditorStore((s) => s.actionLog);
  const reproPrefillDone = useEditorStore((s) => s.reproPrefillDone);
  const setReproPrefillDone = useEditorStore((s) => s.setReproPrefillDone);

  useEffect(() => {
    if (draft) return;
    setDraft({ title: "bug", sections: {}, environment: [] });
  }, [draft, setDraft]);

  useReproPrefill({
    captureMode,
    actionLog: actLog,
    draft,
    setDraft,
    aiStatus: "available", // BYOK — 즉시 available이라 마운트되면 바로 발화한다.
    capabilities: NANO_CAPABILITIES,
    createSession: vi.fn(),
    url: "https://ex.com",
    pageTitle: "Example",
    locale: "en",
    trimming,
    sectionEnabled: true,
    autoReproPrefill: true,
    reproPrefillDone,
    setReproPrefillDone,
    setLoading: useEditorStore.getState().setReproPrefillLoading,
  });
  return null;
}

function ReplayTrimDialogLike() {
  return null;
}

// IssueTab(211-219행) + App(ReplayTrimDialog 렌더) 축약. 두 마운트를 같은 store 플래그가 게이팅한다.
function IssueTabLike() {
  const phase = useEditorStore((s) => s.phase);
  const trimming = useEditorStore((s) => s.replayTrimPending);
  const [pendingTrim, setPendingTrim] = useState<object | null>(null);

  useEffect(() => {
    // use-30s-replay.ts capture() 꼬리 — await 이후 promise continuation에서 두 스토어를 연달아 갱신.
    (window as never as Record<string, () => void>).__capture = () => {
      useEditorStore
        .getState()
        .onRecordingComplete(new Blob(["v"]), "thumb", { width: 100, height: 100 }, 0, 10, true);
      setPendingTrim({ frames: [1, 2] });
    };
    (window as never as Record<string, () => void>).__resolveTrim = () => {
      setPendingTrim(null);
      useEditorStore.getState().resolveReplayTrim();
    };
  }, []);

  return (
    <>
      {phase === "drafting" && !trimming && <DraftingPanelLike trimming={trimming} />}
      {/* App.tsx — 게이트는 store 플래그, pendingTrim은 페이로드. */}
      {trimming && pendingTrim && <ReplayTrimDialogLike />}
    </>
  );
}

const capture = () => (window as never as Record<string, () => void>).__capture();
const resolveTrim = () => (window as never as Record<string, () => void>).__resolveTrim();

beforeEach(() => {
  vi.mocked(toastLlmError).mockReset();
  vi.mocked(generateReproStepsWithAI).mockReset();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useEditorStore.setState({
    actionLog: actionLog(),
    target: { tabId: 1, url: "https://ex.com", title: "Example" },
  });
});

describe("30s replay trim — 재현 과정 미리 채우기", () => {
  it("trim 대기 중엔 DraftingPanel이 안 뜨므로 prefill이 발화하지 않는다", async () => {
    vi.mocked(generateReproStepsWithAI).mockResolvedValue("AI a");
    render(<IssueTabLike />);

    await act(async () => {
      await Promise.resolve();
      capture();
    });

    // drafting 전이와 trim 게이트가 같은 set이면 열린 렌더가 없다 → 발화 0, 래치 없음.
    expect(generateReproStepsWithAI).not.toHaveBeenCalled();
    expect(useEditorStore.getState().reproPrefillDone).toBe(false);
  });

  it("trim 확정 후 AI 결과가 재현 과정에 채워진다(응답이 trim 중 도착해도 유실 없음)", async () => {
    let resolveAI: (v: string) => void = () => {};
    vi.mocked(generateReproStepsWithAI).mockReturnValue(
      new Promise<string>((res) => {
        resolveAI = res;
      }),
    );
    render(<IssueTabLike />);

    await act(async () => {
      await Promise.resolve();
      capture();
    });

    await act(async () => {
      resolveTrim();
      await Promise.resolve();
    });
    await act(async () => {
      resolveAI("1. 버튼 클릭\n2. 에러 확인");
      await Promise.resolve();
    });

    expect(useEditorStore.getState().draft?.sections.stepsToReproduce).toBe(
      "1. 버튼 클릭\n2. 에러 확인",
    );
    expect(generateReproStepsWithAI).toHaveBeenCalledTimes(1);
  });

});
