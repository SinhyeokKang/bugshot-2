import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));
vi.mock("@/sidepanel/lib/llmErrorToast", () => ({ toastLlmError: vi.fn() }));
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

// prompt 호출 하나를 붙잡아 두고 테스트가 원할 때 resolve한다 — 중단 시점을 제어해야
// signal.aborted를 의미 있게 단언할 수 있다.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeSession() {
  const calls: { input: string; signal?: AbortSignal }[] = [];
  const pending: ReturnType<typeof deferred<string>>[] = [];
  const destroy = vi.fn();
  const session = {
    prompt: vi.fn((input: string, opts?: { signal?: AbortSignal }) => {
      calls.push({ input, signal: opts?.signal });
      const d = deferred<string>();
      pending.push(d);
      return d.promise;
    }),
    destroy,
  } as unknown as AISession;
  return { session, calls, pending, destroy };
}

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
