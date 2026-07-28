import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));
vi.mock("@/sidepanel/lib/llmErrorToast", () => ({ toastLlmError: vi.fn() }));

import { AiDraftDialog } from "../AiDraftDialog";
import { useEditorStore } from "@/store/editor-store";
import { toastLlmError } from "@/sidepanel/lib/llmErrorToast";
import { NANO_CAPABILITIES, type AISession } from "@/sidepanel/lib/ai-provider";

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

// 취소하지 않으면 실제로 적용되는 응답 — 아래 대조군이 이를 실증한다.
const VALID_RESPONSE = JSON.stringify({
  title: "AI title",
  sections: { description: "AI description" },
});

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    captureMode: "screenshot",
    draft: { title: "", sections: {}, environment: [] },
    aiCancel: null,
    aiDraftLoading: false,
  });
});

async function submit(text: string) {
  const user = userEvent.setup();
  const box = screen.getByRole("textbox");
  await user.clear(box);
  await user.type(box, text);
  await user.keyboard("{Enter}");
}

function renderDialog(createSession: () => Promise<AISession>) {
  return render(
    <AiDraftDialog
      open
      onOpenChange={vi.fn()}
      createSession={createSession}
      capabilities={NANO_CAPABILITIES}
    />,
  );
}

describe("AiDraftDialog 취소 레인", () => {
  // 대조군 — 이게 없으면 아래 "적용 안 됨" 단언이 공허해진다(POSTMORTEM 2026-07-28).
  it("취소하지 않으면 응답이 draft에 적용된다", async () => {
    const { session, calls, pending } = makeSession();
    renderDialog(vi.fn(async () => session));

    await submit("write it");
    await waitFor(() => expect(calls.length).toBe(1));
    pending[0].resolve(VALID_RESPONSE);

    await waitFor(() =>
      expect(useEditorStore.getState().draft?.title).toBe("AI title"),
    );
  });

  it("중단하면 prompt에 넘긴 signal이 abort되고 본문이 안 바뀌며 에러 토스트도 없다", async () => {
    const { session, calls, pending } = makeSession();
    renderDialog(vi.fn(async () => session));

    await submit("write it");
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].signal).toBeDefined();
    expect(calls[0].signal!.aborted).toBe(false);

    useEditorStore.getState().aiCancel!();
    expect(calls[0].signal!.aborted).toBe(true);

    pending[0].resolve(VALID_RESPONSE);
    await waitFor(() =>
      expect(useEditorStore.getState().aiDraftLoading).toBe(false),
    );
    expect(useEditorStore.getState().draft?.title).toBe("");
    expect(toastLlmError).not.toHaveBeenCalled();
  });

  // cleanup deps가 [createSession]이라 provider 교체에서도 도는 경로 — 언마운트만
  // 덮으면 이 자리에서 오버레이·중단 슬롯이 남는 회귀를 못 잡는다.
  it("provider가 교체되면 진행 중 요청이 abort되고 로딩·슬롯이 즉시 정리된다", async () => {
    const { session, calls } = makeSession();
    const other = makeSession();
    const view = render(
      <AiDraftDialog
        open
        onOpenChange={vi.fn()}
        createSession={vi.fn(async () => session)}
        capabilities={NANO_CAPABILITIES}
      />,
    );

    await submit("write it");
    await waitFor(() => expect(calls.length).toBe(1));
    expect(useEditorStore.getState().aiDraftLoading).toBe(true);

    // createSession identity만 바뀐다 = AI provider 설정 변경.
    view.rerender(
      <AiDraftDialog
        open
        onOpenChange={vi.fn()}
        createSession={vi.fn(async () => other.session)}
        capabilities={NANO_CAPABILITIES}
      />,
    );

    expect(calls[0].signal!.aborted).toBe(true);
    expect(useEditorStore.getState().aiDraftLoading).toBe(false);
    expect(useEditorStore.getState().aiCancel).toBeNull();
  });

  it("중단하면 세션이 destroy되고 다음 실행이 새 세션을 만든다", async () => {
    const first = makeSession();
    const second = makeSession();
    const createSession = vi
      .fn<() => Promise<AISession>>()
      .mockResolvedValueOnce(first.session)
      .mockResolvedValueOnce(second.session);

    renderDialog(createSession);
    await submit("write it");
    await waitFor(() => expect(first.calls.length).toBe(1));

    useEditorStore.getState().aiCancel!();
    expect(first.destroy).toHaveBeenCalled();
    first.pending[0].resolve(VALID_RESPONSE);
    await waitFor(() =>
      expect(useEditorStore.getState().aiDraftLoading).toBe(false),
    );

    await submit("again");
    await waitFor(() => expect(second.calls.length).toBe(1));
    expect(second.calls[0].signal!.aborted).toBe(false);
  });

  it("언마운트하면 진행 중 요청이 abort되고 로딩이 걷힌다", async () => {
    const { session, calls } = makeSession();
    const view = renderDialog(vi.fn(async () => session));

    await submit("write it");
    await waitFor(() => expect(calls.length).toBe(1));
    expect(useEditorStore.getState().aiDraftLoading).toBe(true);

    view.unmount();

    expect(calls[0].signal!.aborted).toBe(true);
    expect(useEditorStore.getState().aiDraftLoading).toBe(false);
    expect(useEditorStore.getState().aiCancel).toBeNull();
  });
});
