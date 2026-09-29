import { describe, it, expect, vi, beforeEach } from "vitest";

const warning = vi.fn();
vi.mock("sonner", () => ({ toast: { warning: (...a: unknown[]) => warning(...a) } }));

import { toastSubmitDropped } from "../submitDroppedToast";

const t = ((key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key) as never;

beforeEach(() => warning.mockReset());

describe("toastSubmitDropped", () => {
  it("누락이 없으면 아무것도 띄우지 않는다", () => {
    expect(toastSubmitDropped({ key: "K" }, "Jira", t)).toBe(false);
    expect(warning).not.toHaveBeenCalled();
  });

  it("캡처만 누락되면 그 문구 한 줄", () => {
    toastSubmitDropped({ key: "K", mediaDropped: true }, "Jira", t);
    expect(warning.mock.calls[0][0]).toBe("submit.mediaDropped:Jira");
    expect(warning.mock.calls[0][1].description).toBeUndefined();
  });

  it("로그만 누락되면 그 문구 한 줄", () => {
    toastSubmitDropped({ key: "K", logsDropped: true }, "Jira", t);
    expect(warning.mock.calls[0][0]).toBe("submit.logsDropped:Jira");
    expect(warning.mock.calls[0][1].description).toBeUndefined();
  });

  // 둘로 쪼개면 sonner 기본(expand=false)에서 뒤 토스트가 opacity 0으로 가려지고,
  // sonner.tsx의 클릭 핸들러가 인자 없는 dismiss()라 하나를 닫으면 둘 다 닫힌다.
  it("둘 다 누락돼도 토스트는 하나다 — 둘째 줄은 description으로 간다", () => {
    toastSubmitDropped({ key: "K", mediaDropped: true, logsDropped: true }, "Jira", t);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0][0]).toBe("submit.mediaDropped:Jira");
    expect(warning.mock.calls[0][1].description).toBe("submit.logsDropped:Jira");
  });

  it("제출 key로 id를 잡아 재렌더가 토스트를 쌓지 않는다", () => {
    toastSubmitDropped({ key: "BUG-42", logsDropped: true }, "Jira", t);
    expect(warning.mock.calls[0][1].id).toBe("submit-dropped-BUG-42");
  });

  // 기본 4초는 제출 성공 화면의 유일한 고지로는 짧다(DESIGN §14의 같은 실수 기록).
  it("기본보다 긴 수명을 준다", () => {
    toastSubmitDropped({ key: "K", logsDropped: true }, "Jira", t);
    expect(warning.mock.calls[0][1].duration).toBeGreaterThan(4000);
  });
});
