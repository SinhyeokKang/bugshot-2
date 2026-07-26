import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import { toastLlmError } from "../llmErrorToast";
import {
  AiContextOverflowError,
  LlmAuthError,
  LlmEmptyResponseError,
  LlmOverloadedError,
  LlmQuotaError,
  LlmRedirectError,
} from "../ai-provider";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn() }),
}));

const t = ((key: string) => key) as never;

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
});

describe("toastLlmError", () => {
  it("컨텍스트 초과 → 해법 힌트를 description으로, 읽을 시간을 주는 duration", () => {
    toastLlmError(new AiContextOverflowError(), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith("llm.error.contextOverflow", {
      description: "llm.error.contextOverflow.hint",
      duration: 8000,
    });
  });

  it("허용량 초과 → 전용 문구", () => {
    toastLlmError(new LlmQuotaError(), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith("llm.error.quota");
  });

  it("오버로드 → 전용 문구", () => {
    toastLlmError(new LlmOverloadedError(), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith("llm.error.overloaded");
  });

  it("인증 실패 → 전용 문구", () => {
    toastLlmError(new LlmAuthError(), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith("llm.error.auth");
  });

  it("빈/파싱실패 응답 → 재시도 유도 공통 문구", () => {
    toastLlmError(new LlmEmptyResponseError(), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith("llm.error.empty");
  });

  // 리다이렉트 차단은 fallback("요청 실패")으로 뭉개면 사용자가 Base URL 오타를
  // 네트워크 장애로 오독한다. 전용 문구로 원인을 지목한다.
  it("리다이렉트 차단 → 전용 문구", () => {
    toastLlmError(new LlmRedirectError(), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith("llm.error.redirect");
  });

  it("그 외 에러 → 호출부가 준 fallback 키", () => {
    toastLlmError(new Error("boom"), t, "aiStyling.error");
    expect(toast.error).toHaveBeenCalledWith("aiStyling.error");
  });

  it("Error가 아닌 값도 fallback으로 처리 (throw 안 함)", () => {
    expect(() => toastLlmError("문자열", t, "draft.aiError")).not.toThrow();
    expect(toast.error).toHaveBeenCalledWith("draft.aiError");
  });
});
