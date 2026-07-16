import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import type { CaptureMode, EditorDraft } from "@/store/editor-store";
import type { LocaleMode } from "@/store/settings-ui-store";
import type { ActionLog } from "@/types/action";
import type { AIProvider, ProviderCapabilities } from "@/sidepanel/lib/ai-provider";
import { supportsActionLog } from "@/sidepanel/lib/captureLogSupport";
import { buildActionLogSummary } from "@/sidepanel/lib/buildLogSummary";
import { buildReproSteps } from "@/sidepanel/lib/buildReproSteps";
import { generateReproStepsWithAI } from "@/sidepanel/lib/generateReproPrefill";

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
}

// drafting 진입 시 stepsToReproduce가 비어 있으면 액션 로그로 자동 채운다. AI 가용 시 AI,
// 없거나 실패 시 룰 baseline. 세션 지속 가드(reproPrefillDone, persist)로 1회 발화.
export function useReproPrefill(args: UseReproPrefillArgs): {
  loading: boolean;
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
  } = args;
  const [loading, setLoading] = useState(false);
  const [aiFilled, setAiFilled] = useState(false);

  // draft·actionLog·reproPrefillDone은 최신 값을 ref로 읽는다 — deps에는 원시 플래그만 넣어
  // AI in-flight 중 무관한 편집(제목 등)이 effect 재실행→취소를 일으키지 않게 한다. apply는
  // ref의 최신 draft에 병합해 로딩 중 사용자가 편집한 다른 섹션을 덮지 않는다.
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
    if (!autoReproPrefill) return;
    // 두 게이트는 서로 다른 관심사다: captureMode==="video"는 1차 릴리스 기능 스코프 제한이고,
    // supportsActionLog는 로그 정책 단일 출처(하드코딩 우회 금지 — docs/POSTMORTEM 2026-07-14).
    // video는 항상 supportsActionLog이라 지금은 후자가 통과하지만, 스코프가 넓어질 때 단일 출처를 탄다.
    if (captureMode !== "video") return;
    if (trimming) return;
    if (!sectionEnabled) return;
    if (!supportsActionLog(captureMode)) return;
    if (!hasActionLog) return;
    if (!draftReady) return;
    if (!stepsEmpty) return;
    if (aiStatus === "checking") return; // 상태 확정까지 보류(AI 가용자가 룰 결과 받는 레이스 방지).
    if (doneRef.current) return;

    setReproPrefillDone(true); // 이하 결과 무관하게 세션 1회(공백·실패여도 재시도 안 함).
    const log = actionLogRef.current!;
    let cancelled = false;

    const apply = (steps: string) => {
      const current = draftRef.current;
      if (cancelled || !steps.trim() || !current) return; // 언마운트 후 무시 + 공백 스킵.
      // 최신 draft에 병합 — 로딩 중 편집된 다른 섹션·제목 보존.
      setDraft({
        ...current,
        sections: { ...current.sections, stepsToReproduce: steps },
      });
    };

    if (aiStatus === "available") {
      setLoading(true);
      void (async () => {
        try {
          const result = await generateReproStepsWithAI({
            capabilities,
            createSession,
            captureMode,
            locale,
            url,
            pageTitle,
            actionLogSummary: buildActionLogSummary(log),
          });
          if (cancelled) return;
          if (result.ok) {
            apply(result.steps);
            if (result.steps.trim()) setAiFilled(true); // AI 생성 고지용.
          } else {
            if (result.reason === "quota") toast.error(t("llm.error.quota"));
            else if (result.reason === "auth") toast.error(t("llm.error.auth"));
            apply(buildReproSteps(log)); // 룰 baseline 폴백.
          }
        } finally {
          // 취소(재실행/언마운트) 경로에서도 로딩을 반드시 해제 — 안 하면 스피너 소프트락.
          setLoading(false);
        }
      })();
    } else {
      apply(buildReproSteps(log));
    }

    return () => {
      cancelled = true;
    };
    // deps는 발화 판정용 원시 플래그만. draft/actionLog 객체나 locale/url/pageTitle(fire-input)을
    // 넣으면 로딩 중 무관한 변경이 재실행→cleanup 취소를 유발해 AI 결과 유실·로딩 고착을 만든다
    // (이 값들은 발화 시점 closure로 읽는다).
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
    setDraft,
    capabilities,
    createSession,
  ]);

  return { loading, aiFilled };
}
