import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import type { CaptureMode, EditorDraft } from "@/store/editor-store";
import type { LocaleMode } from "@/store/settings-ui-store";
import type { AiLanguage } from "@/sidepanel/lib/aiLanguage";
import type { ActionLog } from "@/types/action";
import type { AIProvider, ProviderCapabilities } from "@/sidepanel/lib/ai-provider";
import { supportsActionLog } from "@/sidepanel/lib/captureLogSupport";
import { buildActionLogSummary } from "@/sidepanel/lib/buildLogSummary";
import { generateReproStepsWithAI } from "@/sidepanel/lib/generateReproPrefill";
import { toastLlmError } from "@/sidepanel/lib/llmErrorToast";
import { useAiRun } from "./useAiRun";

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
  aiLanguage: AiLanguage;
  trimming: boolean;
  sectionEnabled: boolean;
  // 첫 렌더 값만 읽는다 — 이후 변경은 이번 작성 세션에 반영되지 않는다(반응형 아님).
  autoReproPrefill: boolean;
  reproPrefillDone: boolean;
  setReproPrefillDone: (done: boolean) => void;
  // 스토어의 setReproPrefillLoading — 로딩은 App.tsx AI 오버레이가 소비한다.
  setLoading: (loading: boolean) => void;
  // 스토어의 setAiCancel — 오버레이 '중단' 버튼이 호출할 소프트 취소 콜백을 등록한다.
  setAiCancel: (fn: (() => void) | null) => void;
  // 슬롯이 아직 이 훅의 canceller인지 판정용 — 남의 것을 덮어 지우지 않는다.
  getAiCancel: () => (() => void) | null;
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
    aiLanguage,
    trimming,
    sectionEnabled,
    autoReproPrefill,
    reproPrefillDone,
    setReproPrefillDone,
    setLoading,
    setAiCancel,
    getAiCancel,
  } = args;
  const [aiGenerated, setAiGenerated] = useState<string | null>(null);

  // 취소 레인 단일 출처. resumable이라 effect cleanup에서 abort하지 않는다.
  const aiRun = useAiRun({ kind: "resumable", setLoading, setAiCancel, getAiCancel });

  // drafting 진입 시점의 설정으로 고정(재대입 없음). deps에 두면 작성 중 설정을 켜는 순간
  // effect가 재실행돼 그 자리에서 발화한다 — 끄는 쪽도 대칭으로 이번 세션엔 반영하지 않는다.
  const autoEnabledRef = useRef(autoReproPrefill);

  // ref로 읽어야 deps를 원시 플래그로 좁힐 수 있다 — 객체를 deps에 넣으면 무관한 편집이 취소를 부른다.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const actionLogRef = useRef(actionLog);
  actionLogRef.current = actionLog;
  const doneRef = useRef(reproPrefillDone);
  doneRef.current = reproPrefillDone;

  const hasActionLog = !!actionLog && actionLog.captured > 0;
  const draftReady = !!draft;
  const stepsEmpty = !draft?.sections.stepsToReproduce?.trim();

  useEffect(() => {
    if (!autoEnabledRef.current) return;
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
      const prev = aiRun.readopt(); // 사용자가 중단한 요청은 null로 돌아온다.
      if (!prev) return;
      return () => aiRun.detach(prev);
    }

    setReproPrefillDone(true); // 이하 결과 무관하게 세션 1회(공백·실패여도 재시도 안 함).
    doneRef.current = true; // 리렌더 전에 래치 — store 왕복을 기다리면 이중 실행이 재발화한다.
    const log = actionLogRef.current!;
    const run = aiRun.begin();

    const apply = (steps: string) => {
      const current = draftRef.current;
      if (!aiRun.isActive(run) || !current) return; // 언마운트 후 무시.
      // 최신 draft에 병합 — 로딩 중 편집된 다른 섹션·제목 보존.
      setDraft({
        ...current,
        sections: { ...current.sections, stepsToReproduce: steps },
      });
    };

    // begin()이 로딩을 켜고 canceller를 슬롯에 등록한다. BYOK 요청은 abort하고
    // Chrome 세션 결과는 폐기 — done은 이미 래치돼 재발화 없으므로
    // 사용자 명시 중단 = 영구 포기(reproPrefillDone "결과무관 1회" 설계와 일치).
    void (async () => {
      try {
        const steps = await generateReproStepsWithAI({
          capabilities,
          createSession,
          captureMode,
          locale,
          aiLanguage,
          url,
          pageTitle,
          actionLogSummary: buildActionLogSummary(log),
          signal: run.signal,
        });
        if (!aiRun.isActive(run)) return;
        apply(steps);
        setAiGenerated(steps); // 사용자가 편집하면 고지 숨김.
      } catch (err) {
        // quota/auth/빈응답(LlmEmptyResponseError) 등 LLM 실패를 공통 토스트로 알린다.
        if (aiRun.isActive(run)) toastLlmError(err, t, "draft.reproPrefillError");
      } finally {
        // 취소(재실행/언마운트) 경로에서도 로딩을 반드시 해제 — 안 하면 스피너 소프트락.
        // detach는 현재 run 포인터를 유지하므로 여기서 여전히 자기 정리를 할 수 있다.
        aiRun.end(run);
      }
    })();

    // detach는 abort하지 않는다(kind: resumable) — 이 cleanup은 언마운트와 게이트
    // 왕복을 구분하지 못하고, 후자는 위 readopt가 되살려 이 요청의 결과를 이어받는다.
    // 여기서 끊으면 되살릴 요청이 이미 죽어 영구히 안 채워진다. 진짜 끊어야 하는
    // 사용자 명시 중단은 헬퍼의 canceller가 abort한다(POSTMORTEM 2026-07-28).
    return () => aiRun.detach(run);
    // deps는 발화 판정용 원시 플래그만 — draft/actionLog·locale/aiLanguage/url/pageTitle을 넣으면 로딩 중 무관한 변경이 재실행→취소를 유발해 AI 결과 유실·로딩 고착을 만든다(발화 시점 closure로 읽는다).
    // autoReproPrefill도 의도적으로 뺐다 — 위 autoEnabledRef로 진입 시점에 고정한다.
    // aiRun은 마운트 동안 참조가 안정적이라(useAiRun 규약 7) deps에 두어도 재실행을 만들지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    captureMode,
    trimming,
    sectionEnabled,
    hasActionLog,
    draftReady,
    stepsEmpty,
    aiStatus,
    setReproPrefillDone,
    setLoading,
    setAiCancel,
    setDraft,
    capabilities,
    createSession,
    aiRun,
  ]);

  // AI가 채운 값을 사용자가 편집해 달라지면 "AI 생성" 고지를 숨긴다.
  const aiFilled =
    aiGenerated !== null && draft?.sections.stepsToReproduce === aiGenerated;

  return { aiFilled };
}
