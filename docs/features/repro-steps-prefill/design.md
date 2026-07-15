# Repro Steps Prefill — 기술 설계

## 개요

drafting phase 진입 = `DraftingPanel` 마운트 시점에, `captureMode === "video"` && 액션 로그 존재 && `stepsToReproduce` 비어 있음이면 자동으로 재현 단계를 채운다. 채움 로직은 **하이브리드**: AI(나노/BYOK)가 가용하면 기존 AI draft 파이프라인을 `stepsToReproduce` 단일 섹션으로 좁혀 재사용하고, 없거나 실패하면 신규 룰 기반 순수 변환기(`buildReproSteps`)로 채운다. store는 React 훅(`useAI`)에 접근할 수 없으므로 트리거·오케스트레이션은 컴포넌트/훅 레이어(`useReproPrefill`)에 둔다. 채움 결과는 `setDraft`로 `draft.sections.stepsToReproduce`만 갱신한다.

## 변경 범위

### 신규 파일

- **`src/sidepanel/lib/buildReproSteps.ts`** — 룰 기반 순수 변환기.
  - `buildReproSteps(log: ActionLog): string` — 액션 로그를 압축된 재현 단계 텍스트(줄바꿈 구분, 번호 없음)로 변환. `stepsToReproduce`는 `renderAs: "orderedList"`라 `OrderedListEditor`가 `value.split(/\r?\n/)`로 각 줄을 한 단계로 렌더하므로 출력은 "한 줄 = 한 단계".
  - 기존 `buildActionLogSummary`(AI 프롬프트 참고용, 20개, "Navigated to:" 톤)와 **분리**한다. 출력 계약이 다르다(사용자 노출용, 압축, 명령형).

- **`src/sidepanel/lib/generateReproPrefill.ts`** — AI 경로 오케스트레이션(provider 주입형, 훅 아님).
  - `generateReproStepsWithAI(input: ReproPrefillInput): Promise<string | null>` — 기존 AI draft 조각을 `stepsToReproduce` 단일 섹션으로 재조립. 실패/파싱불가 시 `null` 반환(호출부가 룰로 폴백).

- **`src/sidepanel/hooks/useReproPrefill.ts`** — `DraftingPanel`에서 호출할 트리거 훅. `useAI()`와 store snapshot을 묶어 조건 판정 + 발화 + `setDraft`.

- 테스트: `src/sidepanel/lib/__tests__/buildReproSteps.test.ts`, `src/sidepanel/lib/__tests__/generateReproPrefill.test.ts`(스키마·섹션 좁힘·폴백 로직).

### 변경 파일

- **`src/sidepanel/tabs/DraftingPanel.tsx`** — draft 시딩 useEffect(현재 119-129행) 이후에 `useReproPrefill(...)` 호출 추가. 이미 보유한 `captureMode`, `draft`, `setDraft`, `actionLog`, `aiStatus`, `capabilities`, `createSession`을 그대로 넘긴다. 신규 store 셀렉터 없이 처리 가능.

- **`src/store/editor-store.ts`** — 로딩 표시가 필요하면 `reproPrefillLoading: boolean` + `setReproPrefillLoading` 추가(기존 `aiDraftLoading` 패턴 재사용). AI draft와 의미가 다르므로 `aiDraftLoading`을 재사용하지 않는다. 채움 자체는 기존 `setDraft`로 충분 — 새 store action 불필요.

## 데이터 흐름

```
video 캡처 완료
  → onRecordingComplete (editor-store) : phase "drafting", captureMode "video"
  → (30s Replay면) ReplayTrimDialog → applyReplayTrim → replaceVideo (로그 재트림 확정)
  → IssueTab: phase==="drafting" && !trimming → <DraftingPanel/> 마운트
  → DraftingPanel: draft 시딩 useEffect → draft.sections = {}
  → useReproPrefill useEffect 발화 판정:
       captureMode==="video"
       && supportsActionLog(captureMode)
       && actionLog?.captured > 0
       && !draft.sections.stepsToReproduce?.trim()
       && attemptedRef.current === false   // 세션당 1회 가드
  → 발화:
       attemptedRef.current = true
       if (aiStatus === "available"):
          setReproPrefillLoading(true)
          steps = await generateReproStepsWithAI(...)   // null이면 실패
          if (!steps) steps = buildReproSteps(actionLog) // 폴백
          setReproPrefillLoading(false)
       else:
          steps = buildReproSteps(actionLog)
  → setDraft({ ...draft, sections: { ...draft.sections, stepsToReproduce: steps } })
```

가드:
- **1회 시도(`attemptedRef`)**: 마운트당 최대 1회. AI 로딩 중 리렌더로 재발화 방지.
- **비어 있을 때만**: 사용자 편집분 보존. 사용자가 지운 뒤 재마운트되어도 `attemptedRef`가 새 인스턴스면 다시 채울 수 있으나, 실무상 같은 세션 내 언마운트는 30s Replay trim뿐이고 그 경로는 채움 전이므로 충돌 없음.
- **AI 결과 반영 전 언마운트**: `generateReproStepsWithAI`에 `AbortSignal`을 넘기고 cleanup에서 abort. 완료 후 마운트 여부(`cancelled` 플래그) 확인 후 `setDraft`.

## 인터페이스 설계

```ts
// buildReproSteps.ts
export function buildReproSteps(log: ActionLog): string;

// generateReproPrefill.ts
export interface ReproPrefillInput {
  capabilities: ProviderCapabilities;
  createSession: AIProvider["createSession"];
  captureMode: CaptureMode;          // "video"
  locale: LocaleMode;
  url: string;
  pageTitle: string;
  actionLogSummary: ActionLogSummary; // buildActionLogSummary(actionLog)
  signal?: AbortSignal;
}
// stepsToReproduce 문자열 반환. 실패/파싱불가/빈값이면 null.
export function generateReproStepsWithAI(
  input: ReproPrefillInput,
): Promise<string | null>;

// useReproPrefill.ts
export function useReproPrefill(args: {
  captureMode: CaptureMode;
  actionLog: ActionLog | null;
  draft: EditorDraft | null;
  setDraft: (draft: EditorDraft) => void;
  aiStatus: "checking" | "available" | "unavailable";
  capabilities: ProviderCapabilities;
  createSession: AIProvider["createSession"];
  url: string;
  pageTitle: string;
}): void;
```

`generateReproStepsWithAI` 내부(기존 조각 재사용):
- `enabledSections = [{ id: "stepsToReproduce" }]`
- `buildAiDraftSchema(["stepsToReproduce"])` — properties `{ title, stepsToReproduce }`, required 동일. **title은 항상 강제되지만 응답에서 무시**한다.
- `AiDraftSessionContext` 조립: `caps`, `captureMode`, `locale`, `url`, `pageTitle`, `actionLogSummary`, `enabledSections`. `userPrompt`·`existingDraft`·이미지·스타일 diff **없음**(재현 단계는 액션 로그만으로 충분, 이미지 미첨부).
- 프롬프트 빌더(`buildRichDraftPrompt`/`buildCompactDraftPrompt`)는 `ctx.enabledSections`를 순회해 섹션 설명을 좁힌다(rich 167-169행, compact 114-116행) → stepsToReproduce 설명만 나감.
- `createSession(systemPrompt, fewShot?)` → `session.prompt(msg, { responseSchema })` → `parseAiDraftResponse(raw, ["stepsToReproduce"])` → `result?.sections.stepsToReproduce ?? null`.
- `parseAiDraftResponse`가 `stepsToReproduce`에 `stripLineNumbering`을 이미 적용(buildAiDraftPrompt.ts 56-58행)하므로 번호 접두는 제거된 채 반환된다.

## 룰 기반 변환 규칙 (`buildReproSteps`)

"길고 기계적"이라는 우려를 압축으로 완화한다:
- **포함**: `navigation`(load 제외, 실사용자 이동만), `input`(연속 같은 selector dedup — 마지막 값), `toggle`, `select`, `drag`, 의미 있는 `click`(target/role 있는 것 우선).
- **제외**: `keypress`(모디파이어 조합 노이즈), `navType === "load"` 초기 로드, 값 없는 click 중 selector만 있는 것은 후순위.
- **압축**: 연속 중복 줄 병합, 상한 `MAX_STEPS`(≈15). 초과 시 앞부분을 자르고 최근 단계 우선(사용자 시연 흐름의 끝이 재현에 더 유의).
- **표현**: 명령형 한국어/영어? — 출력은 **로케일 무관 중립 서술**(기존 `buildActionLogSummary`가 영어 서술이므로 톤 일관). 예: `Go to <url>`, `Type "<value>" in "<field>"`, `Click "<target>"`, `Select "<value>" in "<field>"`. locale별 번역은 이번 스코프 밖(룰 baseline은 초안이고 사용자가 편집).
- 마스킹 값(`masked`)은 `***` 그대로 유지(민감정보 보호 — 액션 로그의 기존 마스킹 계약 준수).

## 기존 패턴 준수

- **store는 AI를 하지 않는다**: 트리거는 컴포넌트/훅. `editor-store.ts`는 provider·useAI를 import하지 않는 기존 경계 유지.
- **AI 조각 재사용**: `buildAiDraftSchema`/`parseAiDraftResponse`/프롬프트 빌더/`createSession`은 부분집합을 이미 지원 — 신규 프롬프트를 만들지 않고 `enabledSections`만 좁힌다.
- **로그 게이트 단일 출처**: `supportsActionLog(captureMode)`(`sidepanel/lib/captureLogSupport.ts`) 재사용. `captureMode === "video"` 추가 조건으로 30s Replay 포함(replay는 별도 union 값 없이 video로 수렴), screenshot/freeform 자동 제외.
- **테스트 우선**: 신규 순수 함수(`buildReproSteps`)는 테스트 먼저 작성.
- **draft-preservation 무간섭**: prefill은 단순히 `setDraft`로 `stepsToReproduce`만 채운다. 이후 AI draft 버튼을 눌러도 기존 `selectDraftSections`/`mergeAiSectionsPreservingImages` 규칙이 그대로 이 값을 `existingDraft`로 취급 — 별도 연계 코드 0.

## 대안 검토

1. **트리거를 `editor-store`의 `onRecordingComplete`에 두기** — 기각. store는 React 훅(`useAI`)에 접근 못 하고, AI provider·settings-ui-store를 store로 끌어오면 "store는 AI를 안 한다"는 아키텍처 경계가 깨진다. 또 30s Replay는 trim 확정 후에야 로그가 최종이라 `onRecordingComplete` 시점은 이르다. → `DraftingPanel` 마운트 useEffect가 타이밍·경계 모두 자연스럽다.

2. **룰 없이 AI 전용** — 기각. 나노·BYOK 없는 사용자가 아무 값도 못 받는다. 이 기능의 핵심 가치(무-AI 사용자 커버)가 사라진다.

3. **AI로 full draft 자동 생성** — 기각(사용자 결정). 사용자 버그 설명(userPrompt) 없이 제목·설명까지 자동 생성하면 환각 위험이 크고, 재현 단계와 달리 관찰만으로 안 나온다.

4. **룰 baseline을 먼저 표시 후 AI 결과로 교체** — 기각. 깜빡임(rule→AI 치환)이 생긴다. AI 가용 시엔 로딩 인디케이터만 보이고 AI 결과로 한 번에 채운다(실패 시에만 룰 폴백).

## 위험 요소

- **프라이버시/비용(코어밸류 관련)**: BYOK 자동 호출은 drafting 진입마다 액션 로그를 외부 LLM으로 전송 + API 비용을 유발한다. 기존엔 AI draft 버튼(명시 동의)으로만 나가던 데이터가 이제 **자동** 발화한다. 완화: "비어 있을 때만 + 세션당 1회"로 남발 억제. 단 **BugShot 서버는 여전히 안 거친다**(사용자→BYOK 직행, OAuth 프록시·PostHog 무관) — 코어밸류의 "서버 무경유"는 유지, "명시 동의"만 자동으로 완화됨. → `docs/privacy.{ko,en}.md` 대조·갱신 필요(자동 외부 전송 동작 추가).
- **30s Replay trim 타이밍**: prefill이 trim 확정 전 로그로 돌면 stale. `DraftingPanel`이 trim 오버레이 중 언마운트(`IssueTab` `if (trimming) return null`)됨을 전제로 마운트 useEffect에 의존한다. 이 언마운트/재마운트 동작이 회귀하면 prefill이 잘못된 로그로 채워질 수 있다 → e2e/수동 검증 필수.
- **AI 부분 섹션 응답 신뢰성**: 소형 모델(compact)이 `stepsToReproduce`를 비우거나 title만 채울 수 있다 → `generateReproStepsWithAI`가 빈 값이면 `null` 반환해 룰 폴백.
- **비디오 아닌 로그 오염**: 상시 백그라운드 레코더가 video 진입 전 액션까지 누적할 수 있으나, `prepareRecorders`가 녹화 시작 시 `clear`하고 30s Replay는 시간창 트림하므로 video 구간 로그만 남는다(기존 동작 신뢰).
