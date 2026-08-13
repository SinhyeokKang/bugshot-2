import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JiraSprintFieldMeta } from "@/types/jira";
import { useSprintFieldMeta } from "../useSprintFieldMeta";

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
vi.mock("@/types/messages", () => ({
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

  it("프로젝트가 없으면 요청하지 않는다", () => {
    const { result } = renderHook(() => useSprintFieldMeta(undefined, "T1"));

    expect(sendBg).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("이슈타입이 없으면 요청하지 않는다", () => {
    renderHook(() => useSprintFieldMeta("P1", undefined));

    expect(sendBg).not.toHaveBeenCalled();
  });

  it("판정 실패는 삼키고 필드 없음과 같은 상태로 수렴한다", async () => {
    sendBg.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useSprintFieldMeta("P2", "T1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.meta).toBeNull();
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
