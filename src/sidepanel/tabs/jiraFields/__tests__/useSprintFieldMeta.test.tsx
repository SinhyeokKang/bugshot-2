import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraSprintFieldMeta } from "@/types/jira";
import { peekSprintFieldMeta, useSprintFieldMeta } from "../useSprintFieldMeta";

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));

// 세션 캐시 키에 siteId가 들어가는지 보려면 계정을 바꿔 끼울 수 있어야 한다.
let ACCOUNT: unknown = {
  platform: "jira",
  projectKey: "WEB",
  auth: { kind: "oauth", cloudId: "cloud-1" },
};

vi.mock("@/store/settings-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/settings-store")>();
  return {
    ...actual,
    useSettingsStore: (sel: (s: { accounts: Record<string, unknown> }) => unknown) =>
      sel({ accounts: { jira: ACCOUNT } }),
  };
});

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({
  sendBg: (req: unknown) => sendBg(req),
}));

const META: JiraSprintFieldMeta = { fieldId: "customfield_10020", isArray: true };

// 모듈 스코프 캐시라 테스트끼리 키가 겹치면 서로를 오염시킨다 — 케이스마다 다른 키를 쓴다.
beforeEach(() => {
  ACCOUNT = {
    platform: "jira",
    projectKey: "WEB",
    auth: { kind: "oauth", cloudId: "cloud-1" },
  };
  sendBg.mockReset();
  sendBg.mockResolvedValue(META);
});

describe("useSprintFieldMeta", () => {
  it("프로젝트와 이슈타입이 둘 다 있으면 판정을 조회한다", async () => {
    const { result } = renderHook(() => useSprintFieldMeta("P1", "T1"));

    await waitFor(() => expect(result.current.meta).toEqual(META));
    expect(sendBg).toHaveBeenCalledWith({
      type: "jira.sprintFieldMeta",
      projectKey: "P1",
      issueTypeId: "T1",
    });
  });

  // "안 물어봤다"와 "서버가 없다고 답했다"가 같은 값이면 상위의 값 비우기가 인증·입력이
  // 잠깐 빈 순간에 사용자 선택을 지운다. 키 입력을 상위가 손으로 다시 세지 않게 훅이 답한다.
  it("판정을 물어볼 입력이 없으면 answered가 아니다", () => {
    const { result } = renderHook(() => useSprintFieldMeta(undefined, "T1"));

    expect(sendBg).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.answered).toBe(false);
  });

  it("인증이 없으면 answered가 아니다", () => {
    ACCOUNT = { platform: "jira", projectKey: "WEB" };
    const { result } = renderHook(() => useSprintFieldMeta("P1b", "T1"));

    expect(sendBg).not.toHaveBeenCalled();
    expect(result.current.answered).toBe(false);
  });

  it("서버가 답하면 answered가 된다", async () => {
    sendBg.mockResolvedValue(null);
    const { result } = renderHook(() => useSprintFieldMeta("P1c", "T1"));

    await waitFor(() => expect(result.current.answered).toBe(true));
    expect(result.current.meta).toBeNull();
  });

  it("이슈타입이 없으면 요청하지 않는다", () => {
    renderHook(() => useSprintFieldMeta("P1", undefined));

    expect(sendBg).not.toHaveBeenCalled();
  });

  // 화면은 "필드 없음"과 같게 두되 값 삭제 판정과는 갈라야 한다 — 실패를 "없음 확정"으로
  // 읽으면 429 한 번에 사용자가 고른 스프린트가 지워진다.
  it("판정 실패는 삼키되 '없음 확정'과 구분된다", async () => {
    sendBg.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useSprintFieldMeta("P2", "T1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.meta).toBeNull();
    expect(result.current.failed).toBe(true);
  });

  it("판정에 성공하면 failed가 아니다", async () => {
    const { result } = renderHook(() => useSprintFieldMeta("P2b", "T1"));

    await waitFor(() => expect(result.current.meta).toEqual(META));
    expect(result.current.failed).toBe(false);
  });

  // Jira의 create 화면 구성은 세션 중 거의 바뀌지 않고, stale이 400으로 이어지지도 않는다
  // (제출 시 background가 어차피 재해석한다).
  it("같은 키를 다시 조회하면 요청이 나가지 않고 로딩도 뜨지 않는다", async () => {
    const first = renderHook(() => useSprintFieldMeta("P3", "T1"));
    await waitFor(() => expect(first.result.current.meta).toEqual(META));
    first.unmount();

    const second = renderHook(() => useSprintFieldMeta("P3", "T1"));

    expect(second.result.current.meta).toEqual(META);
    expect(second.result.current.loading).toBe(false);
    expect(sendBg).toHaveBeenCalledTimes(1);
  });

  // 연동을 갈아끼우면 이전 사이트의 판정이 남으면 안 된다.
  it("siteId가 다르면 캐시가 갈린다", async () => {
    const first = renderHook(() => useSprintFieldMeta("P4", "T1"));
    await waitFor(() => expect(first.result.current.meta).toEqual(META));
    first.unmount();

    ACCOUNT = {
      platform: "jira",
      projectKey: "WEB",
      auth: { kind: "oauth", cloudId: "cloud-2" },
    };
    const second = renderHook(() => useSprintFieldMeta("P4", "T1"));

    await waitFor(() => expect(sendBg).toHaveBeenCalledTimes(2));
    expect(second.result.current.meta).toEqual(META);
  });

  // 실패는 캐시에 안 남으므로 entry에만 기록된다. 그 사이 캐시 히트 키를 거쳐 돌아오면
  // entry가 갱신되지 않아 옛 실패가 "이미 답을 받았다"로 읽힌다.
  it("실패한 키로 되돌아오면 옛 실패 기록을 쓰지 않고 다시 물어본다", async () => {
    let failKeyCalls = 0;
    sendBg.mockImplementation((req: { issueTypeId?: string }) => {
      if (req.issueTypeId !== "TF") return Promise.resolve(META);
      failKeyCalls++;
      return failKeyCalls === 1
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(META);
    });

    // 경유할 키를 먼저 캐시에 올린다 — 캐시 히트 경로는 entry를 건드리지 않는다.
    const warm = renderHook(() => useSprintFieldMeta("P7", "TG"));
    await waitFor(() => expect(warm.result.current.answered).toBe(true));
    warm.unmount();

    const { result, rerender } = renderHook(
      ({ issueTypeId }: { issueTypeId: string }) =>
        useSprintFieldMeta("P7", issueTypeId),
      { initialProps: { issueTypeId: "TF" } },
    );
    await waitFor(() => expect(result.current.failed).toBe(true));

    rerender({ issueTypeId: "TG" });
    rerender({ issueTypeId: "TF" });

    expect(result.current.answered).toBe(false);
    await waitFor(() => expect(result.current.meta).toEqual(META));
  });

  // 제출 시점 분석 축을 훅으로 구독하면 다이얼로그가 닫혀 있어도, Jira가 아닌 플랫폼으로
  // 제출해도 createmeta가 나간다. peek은 읽기만 한다.
  it("peekSprintFieldMeta는 캐시만 읽고 요청하지 않는다", async () => {
    const auth = { kind: "oauth", cloudId: "cloud-1" } as never;

    expect(peekSprintFieldMeta(auth, "P6", "T1")).toBeNull();
    expect(sendBg).not.toHaveBeenCalled();

    const { result } = renderHook(() => useSprintFieldMeta("P6", "T1"));
    await waitFor(() => expect(result.current.meta).toEqual(META));

    expect(peekSprintFieldMeta(auth, "P6", "T1")).toEqual(META);
    expect(sendBg).toHaveBeenCalledTimes(1);
  });

  it("peekSprintFieldMeta는 인자가 비면 null", () => {
    const auth = { kind: "oauth", cloudId: "cloud-1" } as never;

    expect(peekSprintFieldMeta(auth, undefined, "T1")).toBeNull();
    expect(peekSprintFieldMeta(undefined, "P6", "T1")).toBeNull();
    expect(sendBg).not.toHaveBeenCalled();
  });

  // 이슈타입을 빠르게 바꾸면 먼저 보낸 요청이 나중에 도착한다.
  it("늦게 도착한 이전 이슈타입의 응답이 현재 판정을 덮지 않는다", async () => {
    const METB: JiraSprintFieldMeta = { fieldId: "customfield_10030", isArray: false };
    let releaseA: ((v: JiraSprintFieldMeta) => void) | undefined;
    sendBg.mockImplementation((req: { issueTypeId?: string }) => {
      if (req.issueTypeId === "TA")
        return new Promise<JiraSprintFieldMeta>((resolve) => {
          releaseA = resolve;
        });
      return Promise.resolve(METB);
    });

    const { result, rerender } = renderHook(
      ({ issueTypeId }: { issueTypeId: string }) =>
        useSprintFieldMeta("P5", issueTypeId),
      { initialProps: { issueTypeId: "TA" } },
    );
    rerender({ issueTypeId: "TB" });
    await waitFor(() => expect(result.current.meta).toEqual(METB));

    await act(async () => {
      releaseA?.(META);
    });

    expect(result.current.meta).toEqual(METB);
  });
});
