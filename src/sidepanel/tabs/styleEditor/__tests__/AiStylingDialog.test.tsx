import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));
vi.mock("@/sidepanel/lib/llmErrorToast", () => ({ toastLlmError: vi.fn() }));
vi.mock("@/sidepanel/lib/prompts/promptBudget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/sidepanel/lib/prompts/promptBudget")>()),
  isPromptOverBudget: vi.fn(async () => false),
}));
vi.mock("@/sidepanel/picker-control", () => ({
  applyStyles: vi.fn(),
  applyClasses: vi.fn(),
}));
vi.mock("@/sidepanel/hooks/useBoundTabId", () => ({
  useBoundTabId: () => 1,
}));

import { AiStylingDialog } from "../AiStylingDialog";
import { useEditorStore } from "@/store/editor-store";
import { toastLlmError } from "@/sidepanel/lib/llmErrorToast";
import { NANO_CAPABILITIES, type AISession } from "@/sidepanel/lib/ai-provider";
import { makeSession, deferred } from "@/test/ai-session";
import { isPromptOverBudget } from "@/sidepanel/lib/prompts/promptBudget";

// 실제로 적용되는 응답이어야 "취소하면 적용 안 된다"는 단언이 공허해지지 않는다
// — 아래 "대조군" 케이스가 이 응답의 적용을 실증한다(POSTMORTEM 2026-07-28).
const VALID_RESPONSE = JSON.stringify({
  explanation: "reddened",
  inlineStyle: { color: "red" },
});

function selection(selector: string) {
  return {
    selector,
    tagName: "div",
    classList: [],
    computedStyles: { color: "rgb(0, 0, 0)" },
    specifiedStyles: { color: "black" },
    propSources: {},
    hasParent: false,
    hasChild: false,
    text: null,
    viewport: { width: 800, height: 600 },
    capturedAt: 0,
    frameId: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    selection: selection("#a"),
    styleEdits: { classList: [], inlineStyle: {}, text: "" },
    tokens: [],
    aiCancel: null,
    aiStylingLoading: false,
  });
});

async function submit(text: string) {
  const user = userEvent.setup();
  const box = screen.getByRole("textbox");
  await user.clear(box);
  await user.type(box, text);
  await user.keyboard("{Enter}");
}

describe("AiStylingDialog 취소 레인", () => {
  // 대조군 — 취소하지 않으면 같은 응답이 실제로 적용된다.
  it("취소하지 않으면 응답이 styleEdits에 적용된다", async () => {
    const { session, calls, pending } = makeSession();
    render(
      <AiStylingDialog
        open
        onOpenChange={vi.fn()}
        createSession={vi.fn(async () => session)}
        capabilities={NANO_CAPABILITIES}
      />,
    );
    await submit("make it red");
    await waitFor(() => expect(calls.length).toBe(1));

    pending[0].resolve(VALID_RESPONSE);

    await waitFor(() =>
      expect(useEditorStore.getState().styleEdits.inlineStyle).toEqual({
        color: "red",
      }),
    );
  });

  it("중단하면 prompt에 넘긴 signal이 abort되고 결과가 적용되지 않으며 에러 토스트도 없다", async () => {
    const { session, calls, pending } = makeSession();
    const createSession = vi.fn(async () => session);

    render(
      <AiStylingDialog
        open
        onOpenChange={vi.fn()}
        createSession={createSession}
        capabilities={NANO_CAPABILITIES}
      />,
    );
    await submit("make it red");
    await waitFor(() => expect(calls.length).toBe(1));

    expect(calls[0].signal).toBeDefined();
    expect(calls[0].signal!.aborted).toBe(false);

    // 오버레이 '중단'이 부르는 슬롯.
    useEditorStore.getState().aiCancel!();
    expect(calls[0].signal!.aborted).toBe(true);

    // 늦게 도착한 응답은 폐기된다.
    pending[0].resolve(VALID_RESPONSE);
    await waitFor(() =>
      expect(useEditorStore.getState().aiStylingLoading).toBe(false),
    );
    expect(useEditorStore.getState().styleEdits.inlineStyle).toEqual({});
    expect(toastLlmError).not.toHaveBeenCalled();
  });

  // cleanup deps가 [createSession]이라 provider 교체에서도 도는 경로.
  it("provider가 교체되면 진행 중 요청이 abort되고 로딩·슬롯이 즉시 정리된다", async () => {
    const { session, calls } = makeSession();
    const other = makeSession();
    const view = render(
      <AiStylingDialog
        open
        onOpenChange={vi.fn()}
        createSession={vi.fn(async () => session)}
        capabilities={NANO_CAPABILITIES}
      />,
    );

    await submit("make it red");
    await waitFor(() => expect(calls.length).toBe(1));
    expect(useEditorStore.getState().aiStylingLoading).toBe(true);

    view.rerender(
      <AiStylingDialog
        open
        onOpenChange={vi.fn()}
        createSession={vi.fn(async () => other.session)}
        capabilities={NANO_CAPABILITIES}
      />,
    );

    expect(calls[0].signal!.aborted).toBe(true);
    expect(useEditorStore.getState().aiStylingLoading).toBe(false);
    expect(useEditorStore.getState().aiCancel).toBeNull();
  });

  it("중단 뒤 재실행은 새 세션을 만든다", async () => {
    const first = makeSession();
    const second = makeSession();
    const createSession = vi
      .fn<() => Promise<AISession>>()
      .mockResolvedValueOnce(first.session)
      .mockResolvedValueOnce(second.session);

    render(
      <AiStylingDialog
        open
        onOpenChange={vi.fn()}
        createSession={createSession}
        capabilities={NANO_CAPABILITIES}
      />,
    );
    await submit("bigger");
    await waitFor(() => expect(first.calls.length).toBe(1));

    useEditorStore.getState().aiCancel!();
    expect(first.destroy).toHaveBeenCalled();
    first.pending[0].resolve("{}");
    await waitFor(() =>
      expect(useEditorStore.getState().aiStylingLoading).toBe(false),
    );

    await submit("smaller");
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
  });

  // sessionRef는 run보다 오래 살고 Styling은 세션을 재사용한다 — await 재개 지점에서
  // ref를 다시 읽으면 옛 run의 turn이 새 run의 멀티턴 대화에 섞인다.
  it("예산 확인 await 중 중단·재제출되면 옛 run이 새 run의 세션에 prompt하지 않는다", async () => {
    const first = makeSession();
    const second = makeSession();
    const createSession = vi
      .fn<() => Promise<AISession>>()
      .mockResolvedValueOnce(first.session)
      .mockResolvedValueOnce(second.session);

    const gate = deferred<boolean>();
    vi.mocked(isPromptOverBudget)
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue(false);

    render(
      <AiStylingDialog
        open
        onOpenChange={vi.fn()}
        createSession={createSession}
        capabilities={NANO_CAPABILITIES}
      />,
    );
    await submit("turn A");
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));

    useEditorStore.getState().aiCancel!();
    await submit("turn B");
    await waitFor(() => expect(second.calls.length).toBe(1));
    expect(second.calls[0].input).toContain("turn B");

    second.pending[0].resolve(VALID_RESPONSE);
    await waitFor(() =>
      expect(useEditorStore.getState().aiStylingLoading).toBe(false),
    );

    await act(async () => {
      gate.resolve(false);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(second.calls).toHaveLength(1);
    // run-local 세션만 되돌려도 red가 되도록 — A가 자기 세션에 prompt하는 것도 막는다.
    expect(first.calls).toHaveLength(0);
  });

  // 규약 1·2 회귀 가드 — end()가 current를 비우지 않거나 begin()이 종료된 run까지
  // dispose하면 매 제출마다 세션이 파괴돼 멀티턴 대화가 조용히 소실된다.
  it("정상 종료 후 재제출은 같은 세션을 재사용한다", async () => {
    const { session, calls, pending, destroy } = makeSession();
    const createSession = vi.fn(async () => session);

    render(
      <AiStylingDialog
        open
        onOpenChange={vi.fn()}
        createSession={createSession}
        capabilities={NANO_CAPABILITIES}
      />,
    );
    await submit("bigger");
    await waitFor(() => expect(calls.length).toBe(1));
    pending[0].resolve(VALID_RESPONSE);
    await waitFor(() =>
      expect(useEditorStore.getState().aiStylingLoading).toBe(false),
    );

    await submit("even bigger");
    await waitFor(() => expect(calls.length).toBe(2));

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });
});
