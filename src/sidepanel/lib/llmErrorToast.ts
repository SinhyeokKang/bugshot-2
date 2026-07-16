import { toast } from "sonner";
import type { TranslationFn } from "@/i18n";
import type { TranslationKey } from "@/i18n/ko";
import {
  AiContextOverflowError,
  LlmAuthError,
  LlmEmptyResponseError,
  LlmOverloadedError,
  LlmQuotaError,
} from "./ai-provider";

// 컨텍스트 초과는 원인·해법이 한 줄에 안 담겨 description까지 읽힐 시간이 필요하다.
const CONTEXT_OVERFLOW_TOAST_MS = 8000;

export function toastLlmError(
  err: unknown,
  t: TranslationFn,
  fallbackKey: TranslationKey,
): void {
  if (err instanceof AiContextOverflowError) {
    toast.error(t("llm.error.contextOverflow"), {
      description: t("llm.error.contextOverflow.hint"),
      duration: CONTEXT_OVERFLOW_TOAST_MS,
    });
  } else if (err instanceof LlmAuthError) {
    toast.error(t("llm.error.auth"));
  } else if (err instanceof LlmEmptyResponseError) {
    toast.error(t("llm.error.empty"));
  } else if (err instanceof LlmQuotaError) {
    toast.error(t("llm.error.quota"));
  } else if (err instanceof LlmOverloadedError) {
    toast.error(t("llm.error.overloaded"));
  } else {
    toast.error(t(fallbackKey));
  }
}
