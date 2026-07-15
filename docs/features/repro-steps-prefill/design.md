# Repro Steps Prefill — 기술 설계

## 개요

drafting phase 진입 = `DraftingPanel` 마운트 시점에, 발화 조건을 만족하면 자동으로 재현 단계를 채운다. 채움 로직은 **하이브리드**: AI(나노/BYOK)가 가용하면 기존 AI draft 파이프라인을 `stepsToReproduce` 단일 섹션으로 좁혀 재사용하고, 없거나 실패하면 신규 룰 기반 순수 변환기(`buildReproSteps`)로 채운다. store는 React 훅(`useAI`)에 접근할 수 없으므로 트리거·오케스트레이션은 컴포넌트/훅 레이어(`useReproPrefill`)에 둔다. 채움 결과는 `setDraft`로 `draft.sections.stepsToReproduce`만 갱신한다. 세션 지속 가드(`reproPrefillDone`, persist)로 재발화를 막고, opt-out 토글로 사용자가 자동 채움을 끌 수 있다.

## 변경 범위

### 신규 파일

- **`src/sidepanel/lib/buildReproSteps.ts`** — 룰 기반 순수 변환기.
  - `buildReproSteps(log: ActionLog): string` — 액션 로그를 압축된 재현 단계 텍스트(줄바꿈 구분, 번호 없음)로 변환. `stepsToReproduce`는 `renderAs: "orderedList"`라 `OrderedListEditor`가 `value.split(/\r?\n/)`로 각 줄을 한 단계로 렌더하므로 출력은 "한 줄 = 한 단계"(구현 착수 시 `OrderedListEditor`의 split 계약 1줄 확인).
  - 기존 `buildActionLogSummary`(AI 프롬프트 참고용, 최근 20개, "Navigated to:" 톤)와 **분리**한다. 출력 계약이 다르다(사용자 노출용, 압축, 명령형).
  - **필터 후 0줄이면 빈 문자열 반환**(호출부가 이를 감지해 `setDraft` 스킵).

- **`src/sidepanel/lib/generateReproPrefill.ts`** — AI 경로 오케스트레이션(provider 주입형, 훅 아님).
  - `generateReproStepsWithAI(input: ReproPrefillInput): Promise<ReproPrefillResult>` — 기존 AI draft 조각을 `stepsToReproduce` 단일 섹션으로 재조립. 성공 시 steps 문자열, 실패 시 사유(quota/auth/기타)를 담은 결과 반환(호출부가 폴백·토스트 분기).

- **`src/sidepanel/hooks/useReproPrefill.ts`** — `DraftingPanel`에서 호출할 트리거 훅. `useAI()`와 store snapshot을 묶어 발화 판정 + 실행 + `setDraft`. 로딩은 **훅 로컬 `useState`**.

- 테스트: `src/sidepanel/lib/__tests__/buildReproSteps.test.ts`, `src/sidepanel/lib/__tests__/generateReproPrefill.test.ts`, `src/sidepanel/hooks/__tests__/useReproPrefill.test.tsx`.

### 변경 파일

- **`src/sidepanel/tabs/DraftingPanel.tsx`** — draft 시딩 useEffect(현재 119-129행) 이후에 `useReproPrefill(...)` 호출 추가. 이미 보유한 `captureMode`, `draft`, `setDraft`, `actionLog`, `aiStatus`, `capabilities`, `createSession`을 그대로 넘긴다. `stepsToReproduce` 섹션 렌더에서 `loading`이면 `OrderedListEditor`를 스피너로 **치환**(입력 차단). AI 경로 결과엔 disclaimer 힌트 노출.

- **`src/store/editor-store.ts`** — `reproPrefillDone: boolean` + `setReproPrefillDone` 추가. **`EditorSnapshot`(persist 대상)에 포함**해 패널 재개(hydrate) 후에도 재발화를 막는다. `reset`/새 캡처 진입 시 false로 초기화. (로딩 상태는 store에 두지 않는다 — 훅 로컬로 충분.)

- **`src/store/settings-ui-store.ts`** — `autoReproPrefill: boolean`(기본 `true`) + `setAutoReproPrefill` 추가(persist). 설정 UI에 토글 노출.

- **설정 UI 컴포넌트**(기존 설정 탭) — `autoReproPrefill` 토글 1개 추가. 기존 토글 패턴 재사용.

- **`src/i18n/namespaces/*`** — 로딩/disclaimer/설정 토글 문구 ko·en 동시 추가.

## 데이터 흐름

```
video 캡처 완료
  → onRecordingComplete (editor-store) : phase "drafting", captureMode "video", reproPrefillDone 초기 false
  → (30s Replay면) ReplayTrimDialog → applyReplayTrim → replaceVideo (로그 재트림 확정)
  → IssueTab: phase==="drafting" && !trimming → <DraftingPanel/> 마운트
  → DraftingPanel: draft 시딩 useEffect → draft.sections = {}
  → useReproPrefill useEffect 발화 판정 (모두 만족해야 발화):
       settings.autoReproPrefill === true                       // opt-out
       && captureMode === "video"
       && !trimming                                             // 명시 게이트(우연한 언마운트 의존 X)
       && stepsToReproduceSection?.enabled                      // 섹션 비활성 제외
       && supportsActionLog(captureMode)
       && actionLog?.captured > 0
       && !draft.sections.stepsToReproduce?.trim()
       && aiStatus !== "checking"                               // 상태 확정까지 보류
       && reproPrefillDone === false                            // 세션 지속 가드(persist)
  → 발화:
       setReproPrefillDone(true)   // persist. 이하 결과 무관하게 세션 1회 (공백/실패여도 재시도 안 함)
       if (aiStatus === "available"):
          setLoading(true)                                      // 편집기 → 스피너 치환
          result = await generateReproStepsWithAI({ ...ctx, signal })
          if (result.ok):        steps = result.steps
          else if (result.reason ∈ {quota, auth}): steps = buildReproSteps(actionLog); toast(사유)
          else:                  steps = buildReproSteps(actionLog)   // 조용한 폴백
          setLoading(false)
       else: // "unavailable"
          steps = buildReproSteps(actionLog)
  → if (!cancelled && steps.trim()):                            // 언마운트 후 무시 + 공백 스킵
       setDraft({ ...draft, sections: { ...draft.sections, stepsToReproduce: steps } })
```

가드 요약:
- **opt-out**: `autoReproPrefill` off면 아예 미발화.
- **checking 보류**: `aiStatus !== "checking"`. 확정 후 useEffect 재실행 시 판정(의존성에 `aiStatus` 포함).
- **세션 지속 1회(`reproPrefillDone`, persist)**: 마운트 스코프 ref가 아니라 persist 플래그. 패널 닫았다 열어도, 사용자가 지운 뒤여도 재발화 안 함.
- **공백 스킵**: `steps.trim()` 없으면 `setDraft` 안 함(빈 값 주입·재시도 루프 방지). 단 `reproPrefillDone`은 이미 true.
- **abort/언마운트**: `generateReproStepsWithAI`에 `AbortSignal` 전달, cleanup에서 abort + `cancelled` 플래그로 늦은 응답의 `setDraft` 차단.
- **clobber 방지**: AI 로딩 중 편집기를 스피너로 치환 → 사용자 입력 자체가 불가.

## 인터페이스 설계

```ts
// editor-store.ts
reproPrefillDone: boolean;                 // EditorSnapshot persist 포함, reset/새 캡처 시 false
setReproPrefillDone: (v: boolean) => void;

// settings-ui-store.ts
autoReproPrefill: boolean;                 // 기본 true, persist
setAutoReproPrefill: (v: boolean) => void;

// buildReproSteps.ts
export function buildReproSteps(log: ActionLog): string;   // 필터 후 0줄이면 ""

// generateReproPrefill.ts
export interface ReproPrefillInput {
  capabilities: ProviderCapabilities;
  createSession: AIProvider["createSession"];
  captureMode: CaptureMode;                // "video"
  locale: LocaleMode;
  url: string;
  pageTitle: string;
  actionLogSummary: ActionLogSummary;      // buildActionLogSummary(actionLog)
  signal?: AbortSignal;
}
export type ReproPrefillResult =
  | { ok: true; steps: string }
  | { ok: false; reason: "quota" | "auth" | "other" };
export function generateReproStepsWithAI(
  input: ReproPrefillInput,
): Promise<ReproPrefillResult>;

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
  trimming: boolean;
  sectionEnabled: boolean;                 // stepsToReproduce 섹션 enabled
  autoReproPrefill: boolean;
  reproPrefillDone: boolean;
  setReproPrefillDone: (v: boolean) => void;
}): { loading: boolean };                  // 로컬 로딩 상태만 반환
```

`generateReproStepsWithAI` 내부(기존 조각 재사용):
- `enabledSections = [{ id: "stepsToReproduce" }]`
- `buildAiDraftSchema(["stepsToReproduce"])` — properties `{ title, stepsToReproduce }`, required 동일. **title은 항상 강제되지만 응답에서 무시**한다.
- `AiDraftSessionContext` 조립: `caps`, `captureMode`, `locale`, `url`, `pageTitle`, `actionLogSummary`, `enabledSections`. `userPrompt`·`existingDraft`·이미지·스타일 diff **없음**(재현 단계는 액션 로그만으로 충분, 이미지 미첨부).
- 프롬프트 빌더(`buildRichDraftPrompt`/`buildCompactDraftPrompt`)는 `ctx.enabledSections`를 순회해 섹션 설명을 좁힌다(rich 167-169행, compact 114-116행) → stepsToReproduce 설명만 나감.
- **few-shot 재사용**: 기존 `handleGenerate`처럼 `createSession(systemPrompt, getDraftFewShot(ctx))`로 few-shot을 주입한다(`AiDraftDialog.tsx:152-155` 패턴). compact(소형) 모델이 단일 섹션을 채울 때 few-shot 부재는 빈 값/형식 이탈을 유발하므로 생략하지 않는다.
- **`fitDraftContext`(예산 트리밍) 생략**: 컨텍스트가 로그 요약 한 덩어리뿐이라 예산 초과 위험이 낮다. 생략은 의도된 단순화(초과 시 provider가 quota 에러 → 룰 폴백).
- `createSession(...)` → `session.prompt(msg, { responseSchema, signal })` → `parseAiDraftResponse(raw, ["stepsToReproduce"])` → `sections.stepsToReproduce`. 빈 값이면 `{ ok:false, reason:"other" }`.
- provider throw는 `mapQuotaError`류 분류로 `reason` 판별(quota/auth/other). `parseAiDraftResponse`가 `stripLineNumbering`을 이미 적용(buildAiDraftPrompt.ts 56-58행)하므로 번호 접두는 제거된 채 반환.

## 룰 기반 변환 규칙 (`buildReproSteps`)

"길고 기계적"이라는 우려를 압축으로 완화한다:
- **포함**: `navigation`(load 제외, 실사용자 이동만), `input`(연속 같은 selector dedup — 마지막 값), `toggle`, `select`, `drag`, 의미 있는 `click`(target/role 있는 것 우선).
- **제외**: `keypress`(모디파이어 조합 노이즈), `navType === "load"` 초기 로드.
- **압축**: 연속 중복 줄 병합, 상한 `MAX_STEPS`(≈15). 초과 시 앞부분을 자르고 최근 단계 우선(사용자 시연 흐름의 끝이 재현에 더 유의). 대량 로그(액션 상한 1000)에서 앞부분 손실은 설계상 수용(초안이므로).
- **표현**: 로케일 무관 중립 서술(기존 `buildActionLogSummary` 톤과 일관). 예: `Go to <url>`, `Type "<value>" in "<field>"`, `Click "<target>"`, `Select "<value>" in "<field>"`. locale별 번역은 이번 스코프 밖(룰 baseline은 초안이고 사용자가 편집 — ko 사용자가 영어 초안을 받는 것은 의도된 결정, 수동 검증 항목으로 명시).
- 마스킹 값(`masked`)은 `***` 그대로 유지. 액션 로그는 캡처 시점에 이미 `e.value`가 마스킹돼 있어(buildLogSummary.ts:49 주석) 룰·AI 두 경로 모두 신규 누출이 없다.
- **필터 후 0줄이면 `""` 반환**(호출부 스킵 신호).

## 기존 패턴 준수

- **store는 AI를 하지 않는다**: 트리거는 컴포넌트/훅. `editor-store.ts`는 provider·useAI를 import하지 않는 기존 경계 유지(`reproPrefillDone`은 순수 상태 플래그일 뿐).
- **AI 조각 재사용**: `buildAiDraftSchema`/`parseAiDraftResponse`/프롬프트 빌더/`createSession`/`getDraftFewShot`은 부분집합·few-shot을 이미 지원 — 신규 프롬프트를 만들지 않고 `enabledSections`만 좁힌다.
- **로그 게이트 단일 출처**: `supportsActionLog(captureMode)`(`sidepanel/lib/captureLogSupport.ts`) 재사용. `captureMode === "video"` 추가 조건으로 30s Replay 포함(replay는 별도 union 값 없이 video로 수렴), screenshot/freeform 자동 제외.
- **persist 패턴**: `reproPrefillDone`은 `EditorSnapshot`에, `autoReproPrefill`은 settings-ui-store persist에 — 기존 세션 영속화 관례.
- **로딩 게이트 분리**: 기존 `aiDraftLoading`(전역, preview 버튼·AI 배너·inline capture 3곳 게이팅)을 재사용하지 않는다. reproPrefill 로딩은 DraftingPanel 서브트리 안에서만 쓰이므로 훅 로컬 `useState`. 단 로딩 중 preview 제출을 막을지는 구현 시 판단(막을 필요가 크지 않으면 로컬로 종결).
- **테스트 우선**: 신규 순수 함수(`buildReproSteps`)·AI 오케스트레이션은 테스트 먼저 작성.
- **draft-preservation과의 관계(정정)**: prefill은 `setDraft`로 `stepsToReproduce`만 채운다. 이후 AI draft 버튼을 누르면 채운 값이 `existingDraft.sections`로 프롬프트에 실리고, `mergeAiSectionsPreservingImages`가 그 섹션이 프롬프트에 포함됐으면 **AI 값으로 갱신(덮어쓰기)** 한다 — "연계 코드 0"은 맞지만 "무간섭"은 아니다. 이 상호작용(prefill 값이 AI draft 후 어떻게 되는지)은 회귀 테스트로 못박는다.

## 대안 검토

1. **트리거를 `editor-store`의 `onRecordingComplete`에 두기** — 기각. store는 React 훅(`useAI`)에 접근 못 하고, AI provider·settings-ui-store를 store로 끌어오면 "store는 AI를 안 한다"는 아키텍처 경계가 깨진다. 또 30s Replay는 trim 확정 후에야 로그가 최종이라 `onRecordingComplete` 시점은 이르다. → `DraftingPanel` 마운트 useEffect + `!trimming` 명시 게이트가 타이밍·경계 모두 자연스럽다.

2. **룰 없이 AI 전용** — 기각. 나노·BYOK 없는 사용자가 아무 값도 못 받는다. 이 기능의 핵심 가치(무-AI 사용자 커버)가 사라진다.

3. **AI로 full draft 자동 생성** — 기각(사용자 결정). 사용자 버그 설명(userPrompt) 없이 제목·설명까지 자동 생성하면 환각 위험이 크고, 재현 단계와 달리 관찰만으로 안 나온다.

4. **룰 baseline을 먼저 표시 후 AI 결과로 교체** — 기각. 깜빡임(rule→AI 치환)이 생긴다. AI 가용 시엔 로딩 스피너만 보이고 AI 결과로 한 번에 채운다(실패 시에만 룰 폴백).

5. **`attemptedRef`(마운트 스코프)로 1회 가드** — 기각. 패널을 닫았다 열면 ref가 리셋되고 hydrate로 빈 draft가 복원돼, 사용자가 지운 steps를 다시 채운다(prd 성공기준 위반). → persist된 `reproPrefillDone`으로 세션 지속 가드.

6. **`reproPrefillLoading`을 store에 두기** — 기각(CTO 지적). 로딩은 DraftingPanel 서브트리에서만 표시되므로 훅 로컬 `useState`로 충분. store 표면을 늘리지 않는다.

## 위험 요소

- **프라이버시/비용(코어밸류 관련)**: BYOK 자동 호출은 drafting 진입마다(세션 1회) 액션 로그를 외부 LLM으로 전송 + API 비용을 유발한다. 기존엔 AI draft 버튼(명시 동의)으로만 나가던 데이터가 이제 **자동** 발화한다. 완화: (1) `autoReproPrefill` **opt-out 토글**(설정에서 끌 수 있음), (2) "비어 있을 때만 + 세션 1회". 마스킹은 캡처 시점에 이미 걸려 있어 신규 누출은 없다. **BugShot 서버는 여전히 안 거친다**(사용자→BYOK 직행) — 코어밸류의 "서버 무경유"는 유지, "명시 동의"만 opt-out 가능한 자동으로 완화. → `docs/privacy.{ko,en}.md` 대조·갱신 필요(자동 외부 전송 동작 + opt-out 존재 기술).
- **30s Replay trim 타이밍**: `!trimming` 명시 게이트로 trim 확정 후에만 발화하도록 방어한다(과거 `IssueTab`의 언마운트에만 의존하면 그 언마운트가 회귀할 때 stale 채움 위험). trim 오버레이 언마운트 + 명시 게이트 이중 방어.
- **AI 부분 섹션 응답 신뢰성**: 소형 모델(compact)이 `stepsToReproduce`를 비우거나 title만 채울 수 있다 → `generateReproStepsWithAI`가 빈 값이면 `ok:false` 반환해 룰 폴백. few-shot 주입으로 품질 보강.
- **checking 레이스**: `aiStatus !== "checking"` 게이트 없으면 AI 가용자가 룰 결과를 받고 이후 재발화도 안 된다 → 게이트로 차단, `aiStatus`를 useEffect 의존성에 포함해 확정 후 재판정.
- **hydrate 재발화**: `reproPrefillDone`을 persist하지 않으면 패널 재개 시 삭제분 부활 → persist로 차단.
