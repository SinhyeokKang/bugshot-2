import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import type { CaptureMode, EditorDraft } from "@/store/editor-store";
import type { LocaleMode } from "@/store/settings-ui-store";
import type { ActionLog } from "@/types/action";
import type { AIProvider, ProviderCapabilities } from "@/sidepanel/lib/ai-provider";
import { supportsActionLog } from "@/sidepanel/lib/captureLogSupport";
import { buildActionLogSummary } from "@/sidepanel/lib/buildLogSummary";
import { generateReproStepsWithAI } from "@/sidepanel/lib/generateReproPrefill";
import { toastLlmError } from "@/sidepanel/lib/llmErrorToast";

interface UseReproPrefillArgs {
  captureMode: CaptureMode;
  actionLog: ActionLog | null;
  draft: EditorDraft | null;
  setDraft: (draft: EditorDraft) => void;
  aiStatus: "checking" | "available" | "unavailable";
  capabilities: ProviderCapabilities;
  createSession: AIProvider["createSession"];
  url: string;
  pageTitle: string;
  locale: LocaleMode;
  trimming: boolean;
  sectionEnabled: boolean;
  autoReproPrefill: boolean;
  reproPrefillDone: boolean;
  setReproPrefillDone: (done: boolean) => void;
  // 스토어의 setReproPrefillLoading — 로딩은 App.tsx AI 오버레이가 소비한다.
  setLoading: (loading: boolean) => void;
}

// drafting 진입 시 stepsToReproduce가 비어 있고 AI(나노/BYOK)가 가용하면, 액션 로그를 AI로
// 정리해 자동 채운다. AI가 없으면 채우지 않는다. 세션 지속 가드(reproPrefillDone, persist)로 1회 발화.
export function useReproPrefill(args: UseReproPrefillArgs): {
  aiFilled: boolean;
} {
  const {
    captureMode,
    actionLog,
    draft,
    setDraft,
    aiStatus,
    capabilities,
    createSession,
    url,
    pageTitle,
    locale,
    trimming,
    sectionEnabled,
    autoReproPrefill,
    reproPrefillDone,
    setReproPrefillDone,
    setLoading,
  } = args;
  const [aiGenerated, setAiGenerated] = useState<string | null>(null);

  // ref로 읽어야 deps를 원시 플래그로 좁힐 수 있다 — 객체를 deps에 넣으면 무관한 편집이 취소를 부른다.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const actionLogRef = useRef(actionLog);
  actionLogRef.current = actionLog;
  const doneRef = useRef(reproPrefillDone);
  doneRef.current = reproPrefillDone;
  const runRef = useRef<{ cancelled: boolean } | null>(null);

  const hasActionLog = !!actionLog && actionLog.captured > 0;
  const draftReady = !!draft;
  const stepsEmpty = !draft?.sections.stepsToReproduce?.trim();

  useEffect(() => {
    if (!autoReproPrefill) return;
    // video 게이트는 1차 릴리스 스코프 제한, 아래 supportsActionLog는 로그 정책 단일 출처다 — video가 늘 후자를 통과해 겹쳐 보여도 스코프가 넓어질 때를 위해 남긴다(POSTMORTEM 2026-07-14).
    if (captureMode !== "video") return;
    if (trimming) return;
    if (!sectionEnabled) return;
    if (!supportsActionLog(captureMode)) return;
    if (!hasActionLog) return;
    if (!draftReady) return;
    if (!stepsEmpty) return;
    if (aiStatus !== "available") return; // AI 가용 시에만 자동 채움(checking 보류·unavailable 미발화).
    // done 래치 후 게이트가 다시 열린 재실행(게이트 왕복·StrictMode 이중 마운트)은 직전 요청을 이어받는다 — 취소된 채 두면 AI 호출만 소진하고 영구히 안 채워진다.
    if (doneRef.current) {
      const prev = runRef.current;
      if (!prev) return;
      prev.cancelled = false;
      return () => {
        prev.cancelled = true;
      };
    }

    setReproPrefillDone(true); // 이하 결과 무관하게 세션 1회(공백·실패여도 재시도 안 함).
    doneRef.current = true; // 리렌더 전에 래치 — store 왕복을 기다리면 이중 실행이 재발화한다.
    const log = actionLogRef.current!;
    const run = { cancelled: false };
    runRef.current = run;

    const apply = (steps: string) => {
      const current = draftRef.current;
      if (run.cancelled || !current) return; // 언마운트 후 무시.
      // 최신 draft에 병합 — 로딩 중 편집된 다른 섹션·제목 보존.
      setDraft({
        ...current,
        sections: { ...current.sections, stepsToReproduce: steps },
      });
    };

    setLoading(true);
    void (async () => {
      try {
        const steps = await generateReproStepsWithAI({
          capabilities,
          createSession,
          captureMode,
          locale,
          url,
          pageTitle,
          actionLogSummary: buildActionLogSummary(log),
        });
        if (run.cancelled) return;
        apply(steps);
        setAiGenerated(steps); // 사용자가 편집하면 고지 숨김.
      } catch (err) {
        // quota/auth/빈응답(LlmEmptyResponseError) 등 LLM 실패를 공통 토스트로 알린다.
        if (!run.cancelled) toastLlmError(err, t, "draft.reproPrefillError");
      } finally {
        // 취소(재실행/언마운트) 경로에서도 로딩을 반드시 해제 — 안 하면 스피너 소프트락.
        setLoading(false);
      }
    })();

    return () => {
      run.cancelled = true;
    };
    // deps는 발화 판정용 원시 플래그만 — draft/actionLog·locale/url/pageTitle을 넣으면 로딩 중 무관한 변경이 재실행→취소를 유발해 AI 결과 유실·로딩 고착을 만든다(발화 시점 closure로 읽는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoReproPrefill,
    captureMode,
    trimming,
    sectionEnabled,
    hasActionLog,
    draftReady,
    stepsEmpty,
    aiStatus,
    setReproPrefillDone,
    setLoading,
    setDraft,
    capabilities,
    createSession,
  ]);

  // AI가 채운 값을 사용자가 편집해 달라지면 "AI 생성" 고지를 숨긴다.
  const aiFilled =
    aiGenerated !== null && draft?.sections.stepsToReproduce === aiGenerated;

  return { aiFilled };
}
