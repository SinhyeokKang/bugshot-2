import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { IssueAlreadySubmittedError } from "@/store/issues-store";
import { toastSubmitBlocked } from "../submitBlockedToast";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn() }),
}));

const t = ((key: string, params?: Record<string, string>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key) as never;

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
});

describe("toastSubmitBlocked", () => {
  // key가 문구에 안 실리면 사용자에게 `이미 {key}로 제출된 이슈입니다`가 날것으로 노출된다.
  it("기존 티켓 key를 문구에 싣고 힌트를 description으로 준다", () => {
    expect(toastSubmitBlocked(new IssueAlreadySubmittedError("BUG-7"), t)).toBe(true);

    expect(toast.error).toHaveBeenCalledWith("submit.alreadySubmittedAs:BUG-7", {
      description: "submit.alreadySubmittedHint",
      id: "submit-already-submitted",
    });
  });

  it("key가 없으면 key 없는 문구를 쓴다", () => {
    toastSubmitBlocked(new IssueAlreadySubmittedError(), t);

    expect(toast.error).toHaveBeenCalledWith("submit.alreadySubmitted", {
      description: "submit.alreadySubmittedHint",
      id: "submit-already-submitted",
    });
  });

  // 차단돼도 [제출]은 계속 눌린다 — 고정 id가 없으면 클릭마다 toast가 쌓인다.
  it("재호출이 toast를 쌓지 않고 같은 id로 대체한다", () => {
    toastSubmitBlocked(new IssueAlreadySubmittedError("BUG-7"), t);
    toastSubmitBlocked(new IssueAlreadySubmittedError("BUG-7"), t);

    const ids = vi.mocked(toast.error).mock.calls.map((c) => (c[1] as { id: string }).id);
    expect(new Set(ids).size).toBe(1);
  });

  it("일반 제출 실패는 처리하지 않는다 (기존 err.message 경로 유지)", () => {
    expect(toastSubmitBlocked(new Error("network down"), t)).toBe(false);
    expect(toastSubmitBlocked("boom", t)).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
