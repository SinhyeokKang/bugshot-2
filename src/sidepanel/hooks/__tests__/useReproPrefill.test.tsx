import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/sidepanel/lib/generateReproPrefill", () => ({
  generateReproStepsWithAI: vi.fn(),
}));
vi.mock("@/sidepanel/lib/llmErrorToast", () => ({
  toastLlmError: vi.fn(),
}));

import { useReproPrefill } from "../useReproPrefill";
import { generateReproStepsWithAI } from "@/sidepanel/lib/generateReproPrefill";
import { toastLlmError } from "@/sidepanel/lib/llmErrorToast";
import {
  LlmQuotaError,
  LlmEmptyResponseError,
  NANO_CAPABILITIES,
} from "@/sidepanel/lib/ai-provider";
import type { ActionLog } from "@/types/action";

function actionLog(captured = 2): ActionLog {
  return {
    id: "a",
    startedAt: 0,
    endedAt: 2,
    totalSeen: captured,
    captured,
    entries: Array.from({ length: captured }, (_, i) => ({
      id: String(i),
      kind: "click" as const,
      timestamp: i,
      pageUrl: "https://ex.com",
      target: `t${i}`,
    })),
  };
}

// 발화 조건을 전부 만족하는 baseline. over로 개별 게이트를 뒤집는다.
function baseArgs(over: Record<string, unknown> = {}) {
  return {
    captureMode: "video",
    actionLog: actionLog(),
    draft: { title: "", sections: {} },
    setDraft: vi.fn(),
    setLoading: vi.fn(),
    aiStatus: "available",
    capabilities: NANO_CAPABILITIES,
    createSession: vi.fn(),
    url: "https://ex.com",
    pageTitle: "Example",
    locale: "en",
    trimming: false,
    sectionEnabled: true,
    autoReproPrefill: true,
    reproPrefillDone: false,
    setReproPrefillDone: vi.fn(),
    ...over,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const render = (over: Record<string, unknown> = {}) => {
  const args = baseArgs(over);
  const utils = renderHook((p: any) => useReproPrefill(p), { initialProps: args });
  return { args, ...utils };
};

const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.mocked(generateReproStepsWithAI).mockReset().mockResolvedValue("AI a\nAI b");
  vi.mocked(toastLlmError).mockReset();
});

describe("useReproPrefill", () => {
  it("조건 만족(available)이면 AI로 setDraft 1회 + reproPrefillDone(true)", async () => {
    const { args } = render();
    await waitFor(() => expect(args.setDraft).toHaveBeenCalledTimes(1));
    expect((args.setDraft as any).mock.calls[0][0].sections.stepsToReproduce).toBe("AI a\nAI b");
    expect(args.setReproPrefillDone).toHaveBeenCalledWith(true);
    expect(generateReproStepsWithAI).toHaveBeenCalledTimes(1);
  });

  it("AI가 없으면(unavailable) 미발화 — 자동 채움 안 함", async () => {
    const { args } = render({ aiStatus: "unavailable" });
    await flush();
    expect(args.setDraft).not.toHaveBeenCalled();
    expect(args.setReproPrefillDone).not.toHaveBeenCalled();
    expect(generateReproStepsWithAI).not.toHaveBeenCalled();
  });

  it("available이면 AI 결과로 채운다", async () => {
    vi.mocked(generateReproStepsWithAI).mockResolvedValue("AI a\nAI b");
    const { args } = render({ aiStatus: "available" });
    await waitFor(() => expect(args.setDraft).toHaveBeenCalledTimes(1));
    expect((args.setDraft as any).mock.calls[0][0].sections.stepsToReproduce).toBe("AI a\nAI b");
    expect(generateReproStepsWithAI).toHaveBeenCalledTimes(1);
    expect(generateReproStepsWithAI).toHaveBeenCalledWith(
      expect.objectContaining({ captureMode: "video", locale: "en" }),
    );
  });

  it("aiFilled는 AI 값이 draft에 그대로일 때만 true — 사용자가 편집하면 false", async () => {
    vi.mocked(generateReproStepsWithAI).mockResolvedValue("AI a");
    const setDraft = vi.fn();
    const setDone = vi.fn();
    const createSession = vi.fn();
    const al = actionLog();
    const mk = (over: Record<string, unknown> = {}) =>
      baseArgs({
        setDraft,
        setReproPrefillDone: setDone,
        createSession,
        actionLog: al,
        aiStatus: "available",
        ...over,
      });
    const { result, rerender } = renderHook((p: any) => useReproPrefill(p), {
      initialProps: mk({ draft: { title: "", sections: {} } }),
    });
    await waitFor(() => expect(setDraft).toHaveBeenCalledTimes(1));

    // store가 AI 값을 반영한 상태로 리렌더 → 고지 노출.
    rerender(mk({ draft: { title: "", sections: { stepsToReproduce: "AI a" } } }));
    expect(result.current.aiFilled).toBe(true);

    // 사용자가 값을 바꾸면 고지 숨김.
    rerender(mk({ draft: { title: "", sections: { stepsToReproduce: "edited" } } }));
    expect(result.current.aiFilled).toBe(false);
  });

  it("stepsToReproduce에 기존 값이 있으면 미발화", async () => {
    const { args } = render({ draft: { title: "", sections: { stepsToReproduce: "already here" } } });
    await flush();
    expect(args.setDraft).not.toHaveBeenCalled();
    expect(args.setReproPrefillDone).not.toHaveBeenCalled();
  });

  it("captureMode가 video가 아니면 미발화", async () => {
    const { args } = render({ captureMode: "screenshot" });
    await flush();
    expect(args.setDraft).not.toHaveBeenCalled();
  });

  it("actionLog가 null이거나 captured 0이면 미발화", async () => {
    const a = render({ actionLog: null });
    await flush();
    expect(a.args.setDraft).not.toHaveBeenCalled();
    const b = render({ actionLog: actionLog(0) });
    await flush();
    expect(b.args.setDraft).not.toHaveBeenCalled();
  });

  it("aiStatus가 checking이면 보류, available로 바뀌면 그때 AI 발화(레이스 방지)", async () => {
    vi.mocked(generateReproStepsWithAI).mockResolvedValue("AI a");
    const setDraft = vi.fn();
    const setDone = vi.fn();
    const mk = (over: Record<string, unknown> = {}) =>
      baseArgs({ setDraft, setReproPrefillDone: setDone, ...over });
    const { rerender } = renderHook((p: any) => useReproPrefill(p), {
      initialProps: mk({ aiStatus: "checking" }),
    });
    await flush();
    expect(setDraft).not.toHaveBeenCalled();
    expect(generateReproStepsWithAI).not.toHaveBeenCalled();

    rerender(mk({ aiStatus: "available" }));
    await waitFor(() => expect(setDraft).toHaveBeenCalledTimes(1));
    expect(setDraft.mock.calls[0][0].sections.stepsToReproduce).toBe("AI a");
  });

  it("reproPrefillDone이 true면 미발화(재개·삭제 후 부활 방지)", async () => {
    const { args } = render({ reproPrefillDone: true });
    await flush();
    expect(args.setDraft).not.toHaveBeenCalled();
    expect(generateReproStepsWithAI).not.toHaveBeenCalled();
  });

  it("autoReproPrefill이 false면 미발화(opt-out)", async () => {
    const { args } = render({ autoReproPrefill: false });
    await flush();
    expect(args.setDraft).not.toHaveBeenCalled();
  });

  it("sectionEnabled가 false면 미발화", async () => {
    const { args } = render({ sectionEnabled: false });
    await flush();
    expect(args.setDraft).not.toHaveBeenCalled();
  });

  it("trimming이 true면 미발화", async () => {
    const { args } = render({ trimming: true });
    await flush();
    expect(args.setDraft).not.toHaveBeenCalled();
  });

  it("AI 빈응답이면 채우지 않고 toastLlmError로 알린다", async () => {
    vi.mocked(generateReproStepsWithAI).mockRejectedValue(new LlmEmptyResponseError());
    const { args } = render();
    await waitFor(() => expect(toastLlmError).toHaveBeenCalled());
    expect(args.setDraft).not.toHaveBeenCalled();
  });

  it("AI quota 실패면 채우지 않고 toastLlmError로 알린다", async () => {
    vi.mocked(generateReproStepsWithAI).mockRejectedValue(new LlmQuotaError());
    const { args } = render();
    await waitFor(() => expect(toastLlmError).toHaveBeenCalled());
    expect(args.setDraft).not.toHaveBeenCalled();
  });

  it("AI 실패여도 done은 소진(재시도 루프 방지)하되 setDraft 미호출", async () => {
    vi.mocked(generateReproStepsWithAI).mockRejectedValue(new LlmEmptyResponseError());
    const { args } = render();
    await flush();
    expect(args.setDraft).not.toHaveBeenCalled();
    expect(args.setReproPrefillDone).toHaveBeenCalledWith(true);
  });

  it("발화가 reproPrefillDone을 true로 뒤집어 리렌더돼도 AI in-flight 결과가 유실되지 않는다", async () => {
    // 실제 store에선 setReproPrefillDone(true)가 reproPrefillDone prop을 뒤집어 리렌더한다.
    // 이때 effect가 재실행되며 in-flight 요청을 취소하면 안 된다(회귀 가드).
    let resolveFn: (v: unknown) => void = () => {};
    vi.mocked(generateReproStepsWithAI).mockReturnValue(
      new Promise((res) => {
        resolveFn = res;
      }) as any,
    );
    // draft·actionLog·createSession은 실제 store처럼 안정 참조로 고정(reproPrefill 발화가 안 바꾸는 값).
    const setDraft = vi.fn();
    const setDone = vi.fn();
    const stable = {
      setDraft,
      setReproPrefillDone: setDone,
      setLoading: vi.fn(),
      createSession: vi.fn(),
      draft: { title: "", sections: {} },
      actionLog: actionLog(),
    };
    const mk = (over: Record<string, unknown> = {}) =>
      baseArgs({ ...stable, aiStatus: "available", ...over });
    const { rerender } = renderHook((p: any) => useReproPrefill(p), {
      initialProps: mk(),
    });
    await flush();
    expect(generateReproStepsWithAI).toHaveBeenCalledTimes(1);

    rerender(mk({ reproPrefillDone: true })); // 발화가 유발한 리렌더 재현.
    await act(async () => {
      resolveFn("AI a");
      await Promise.resolve();
    });
    expect(setDraft).toHaveBeenCalledTimes(1);
    expect((setDraft as any).mock.calls[0][0].sections.stepsToReproduce).toBe("AI a");
  });

  it("AI in-flight 중 다른 섹션(제목 등)을 편집해도 취소되지 않고 최신 draft에 병합된다", async () => {
    // 로딩 중 사용자가 제목을 입력하면 draft 참조가 바뀐다. 이때 in-flight AI를 취소하거나
    // 사용자 입력을 덮으면 안 된다(스피너 고착·입력 유실 회귀 가드).
    let resolveFn: (v: unknown) => void = () => {};
    vi.mocked(generateReproStepsWithAI).mockReturnValue(
      new Promise((res) => {
        resolveFn = res;
      }) as any,
    );
    const setDraft = vi.fn();
    const setDone = vi.fn();
    const setLoading = vi.fn();
    const createSession = vi.fn();
    const al = actionLog();
    const mk = (draftObj: Record<string, unknown>) =>
      baseArgs({
        setDraft,
        setReproPrefillDone: setDone,
        setLoading,
        createSession,
        actionLog: al,
        aiStatus: "available",
        draft: draftObj,
      });
    const { rerender } = renderHook((p: any) => useReproPrefill(p), {
      initialProps: mk({ title: "", sections: {} }),
    });
    await flush();
    expect(generateReproStepsWithAI).toHaveBeenCalledTimes(1);

    rerender(mk({ title: "typed", sections: {} })); // 로딩 중 제목 편집(steps는 여전히 빈값).
    await act(async () => {
      resolveFn("AI a");
      await Promise.resolve();
    });
    expect(setDraft).toHaveBeenCalledTimes(1);
    const arg = (setDraft as any).mock.calls[0][0];
    expect(arg.sections.stepsToReproduce).toBe("AI a"); // 취소 안 됨.
    expect(arg.title).toBe("typed"); // 최신 draft에 병합 — 사용자 입력 보존.
  });

  it("AI in-flight 중 locale이 바뀌어도 취소되지 않고 채워지며 로딩이 풀린다", async () => {
    // locale/url/pageTitle은 fire-input이라 in-flight 중 변경돼도 취소를 유발하면 안 된다.
    let resolveFn: (v: unknown) => void = () => {};
    vi.mocked(generateReproStepsWithAI).mockReturnValue(
      new Promise((res) => {
        resolveFn = res;
      }) as any,
    );
    const setDraft = vi.fn();
    const setDone = vi.fn();
    const setLoading = vi.fn();
    const createSession = vi.fn();
    const stable = {
      setDraft,
      setReproPrefillDone: setDone,
      setLoading,
      createSession,
      actionLog: actionLog(),
      draft: { title: "", sections: {} },
      aiStatus: "available",
    };
    const mk = (over: Record<string, unknown> = {}) => baseArgs({ ...stable, ...over });
    const { rerender } = renderHook((p: any) => useReproPrefill(p), {
      initialProps: mk({ locale: "en" }),
    });
    await flush();
    expect(setLoading).toHaveBeenLastCalledWith(true);

    // 발화가 done을 latch한 뒤 언어 변경으로 리렌더되는 실제 상황(재발화 없음).
    rerender(mk({ locale: "ko", reproPrefillDone: true }));
    await act(async () => {
      resolveFn("AI a");
      await Promise.resolve();
    });
    expect(setDraft).toHaveBeenCalledTimes(1);
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });

  it("AI in-flight 중 autoReproPrefill이 꺼지면 취소되더라도 로딩은 풀린다", async () => {
    // gating dep가 바뀌어 취소되는 경우에도 setLoading(false)가 finally로 보장돼야 소프트락이 안 걸린다.
    let resolveFn: (v: unknown) => void = () => {};
    vi.mocked(generateReproStepsWithAI).mockReturnValue(
      new Promise((res) => {
        resolveFn = res;
      }) as any,
    );
    const setDraft = vi.fn();
    const setDone = vi.fn();
    const setLoading = vi.fn();
    const createSession = vi.fn();
    const stable = {
      setDraft,
      setReproPrefillDone: setDone,
      setLoading,
      createSession,
      actionLog: actionLog(),
      draft: { title: "", sections: {} },
      aiStatus: "available",
    };
    const mk = (over: Record<string, unknown> = {}) => baseArgs({ ...stable, ...over });
    const { rerender } = renderHook((p: any) => useReproPrefill(p), {
      initialProps: mk({ autoReproPrefill: true }),
    });
    await flush();
    expect(setLoading).toHaveBeenLastCalledWith(true);

    rerender(mk({ autoReproPrefill: false, reproPrefillDone: true })); // 로딩 중 opt-out.
    await act(async () => {
      resolveFn("AI a");
      await Promise.resolve();
    });
    expect(setDraft).not.toHaveBeenCalled(); // 취소됨.
    expect(setLoading).toHaveBeenLastCalledWith(false); // finally로 로딩 해제.
  });

  it("AI in-flight 중 언마운트되면 응답 도착해도 setDraft 미호출", async () => {
    let resolveFn: (v: unknown) => void = () => {};
    vi.mocked(generateReproStepsWithAI).mockReturnValue(
      new Promise((res) => {
        resolveFn = res;
      }) as any,
    );
    const { args, unmount } = render({ aiStatus: "available" });
    await flush();
    expect(generateReproStepsWithAI).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      resolveFn("late");
      await Promise.resolve();
    });
    expect(args.setDraft).not.toHaveBeenCalled();
  });
});
