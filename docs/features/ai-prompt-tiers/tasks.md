# AI 프롬프트 tier 분리 — 구현 태스크

> 용어: 등급 스칼라 `tier`는 폐기됐다. 능력은 `ProviderCapabilities` = `promptStyle`(compact|rich) · `supportsImages` · `contextBudgetChars` 3개 축이다. 이번에 출하하는 좌표는 **나노=`{compact, false, 10000}`** / **BYOK=`{rich, true, 무제한}`** (10000=절삭 예산, 정적 본문 목표 2000자는 별도 테스트 상수) 2개뿐. 근거는 design.md 개요.

## 선행 조건

- 권한·env·OAuth·외부 API 변경 **없음**. manifest 무변경 → `docs/PERMISSION.md`·`docs/privacy.{ko,en}.md` 갱신 불필요.
- 새 의존성 **없음** → `pnpm-workspace.yaml`의 `minimumReleaseAge` 정책에 걸리지 않는다.
- `src/i18n/` 수정 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행한다 — ko/en 동시 갱신 필수.
- **착수 전 필독**: `docs/POSTMORTEM.md`의 2026-07-08 / 2026-07-10 항목. 둘 다 AI 스타일 적용 → CodeMirror doc 재동기화 경로다. `AiStylingDialog`의 `setStyleEdits(merged)` → `setAiStylingLoading(false)` **호출 순서를 바꾸면 회귀**한다.

---

## 태스크

### Task 0: 테스트 결합 해제 (프롬프트 워딩 인질 제거)

프롬프트 본문을 고치려면 **먼저** 이걸 해야 한다. 지금은 테스트가 프로덕션 워딩을 고정하고 있다.

- **변경 대상**: `src/sidepanel/lib/__tests__/buildAiDraftPrompt.test.ts`
- **작업 내용**:
  - **워딩 결합 단정 전수 조사가 선행 작업이다** — 리뷰(QA)에서 아래 4개 외에 **15개 이상**이 추가 확인됐다: `:133 toMatch(/image|screenshot/i)`(positive), `:172-173`/`:377-379`의 `toContain("Network errors")` 등 리터럴 헤더, `:434 /plausibly relate/`, `:447-449 /no preamble/`, `:455-459 /terse technical/`, `:560 /text only/` 등. **Task 4가 compact 본문에서 이 문장들을 삭제·재작성하므로 방치하면 대량 red.** 전수 목록을 만들어 각각을 (a) Task 4의 스타일별 불변식으로 재작성할 것 / (b) rich 전용 단정으로 이관할 것 / (c) 삭제할 것으로 분류해 이 태스크에서 처분한다.
  - `:462-465` `not.toMatch(/sentence/i)` 제거, `:549-556` full-string 동등 단정(`expect(withEmpty).toBe(without)`) 제거 — 프롬프트 어떤 변화든 깨진다.
  - **`:223`/`:270`의 negative 이미지 단정은 여기서 지우지 않는다** — Task 2가 caps 게이팅 단정으로 원자적(red→green) 교체한다. 커버리지 공백(이미지 불변식이 무보호인 채 Task 2가 해당 파일을 수정) 방지.
- **검증**:
  - [x] 워딩 결합 단정 전수 목록 작성 완료 (처분 분류 포함)
  - [x] `pnpm test buildAiDraftPrompt` green
  - [x] 프로덕션 코드 무변경 (이 태스크는 테스트만 건드린다)

> ⚠️ 지운 단정의 커버리지는 Task 2(이미지 계약)와 Task 4(능력 계약 불변식)가 되메운다.

---

### Task 1: `AIProvider` 능력 표면 + 나노 세션 실측 배선

- **변경 대상**: `src/sidepanel/lib/ai-provider.ts`, `src/sidepanel/hooks/useAI.ts`
- **작업 내용**:
  - `PromptStyle = "compact" | "rich"`, `ProviderCapabilities`·`FewShotExample` 인터페이스, `NANO_CAPABILITIES`(budget 10_000)/`BYOK_CAPABILITIES` 상수, `AiContextOverflowError` 클래스, `mapQuotaError` 헬퍼(`QuotaExceededError` DOMException → `AiContextOverflowError`, 그 외 재던짐) 추가.
  - `AIProvider`에 `readonly capabilities: ProviderCapabilities` 추가. Chrome → `NANO_CAPABILITIES`, OpenAI·Anthropic → `BYOK_CAPABILITIES`.
  - **Chrome API 신명칭 마이그레이션**: `AISession`에 옵셔널 `measureContextUsage?`·`contextUsage?`·`contextWindow?` 추가. 모듈 스코프 `LanguageModelInstance` 인터페이스(`:3-9` — `declare global` 아님)에 신·구 두 세대 멤버를 옵셔널로 추가하고, Chrome 세션 래퍼는 **신명칭 우선 + 구명칭 폴백**(`contextUsage ?? inputUsage`)으로 노출. 구명칭은 "Deprecated in Extensions"라 신명칭 기준이 기본이다.
  - `createSession(systemPrompt, fewShot?: FewShotExample[])`로 시그니처 확장 — Chrome은 `create({ initialPrompts: [{role:"system"}, ...user/assistant 쌍] })`(레거시 `systemPrompt` 옵션에서 규정 경로로 마이그레이션), OpenAI/Anthropic은 `messages` 선주입. `create()` 호출을 try/catch로 감싸 `mapQuotaError` 적용.
  - `useAI()` 반환에 `capabilities` 추가 — **provider에서 파생**한다(새 판정 로직을 만들지 않는다. `llm?.modelId` 유무 판정은 이미 `:53`에 있다).
- **검증** — 이 경로는 현재 테스트 0개다. 여기서 처음 박는다:
  - [x] `ai-provider.test.ts`에 `createChromeAIProvider` 테스트 추가: `capabilities.promptStyle === "compact"`, `supportsImages === false`, `contextBudgetChars === 10_000`
  - [x] `createOpenAICompatibleProvider`·`createAnthropicProvider`: `promptStyle === "rich"`, `supportsImages === true`
  - [x] `createSession` 테스트: Chrome이 `LanguageModel.create`를 `initialPrompts`(system이 index 0) + `CHROME_AI_LANG_OPTIONS`로 호출, fewShot 쌍이 user/assistant로 이어짐, `destroy`가 네이티브 세션 destroy
  - [x] BYOK 세션: fewShot이 messages 선주입으로 들어가고 이후 대화가 그 뒤에 쌓임
  - [x] Chrome 세션이 신명칭(`contextUsage`/`contextWindow`/`measureContextUsage`)을 노출, 구명칭만 있는 네이티브에선 폴백, 둘 다 없으면 `undefined`
  - [x] `mapQuotaError`: `QuotaExceededError` → `AiContextOverflowError` / 다른 에러 → 원본 재던짐
  - [x] `pnpm typecheck`

---

### Task 2: 선행 픽스 A — 나노 이미지 모순

**지금 깨져 있는 버그.** BYOK 미설정 사용자 전원이 스크린샷 모드에서 환각 초안을 받고 있다.

- **변경 대상**: `src/sidepanel/lib/buildAiDraftRequest.ts`, `src/sidepanel/lib/buildAiDraftPrompt.ts`, `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**:
  - `AiDraftSessionContext`에 `caps: ProviderCapabilities` 추가.
  - `buildAiDraftRequest`: `supportsImages === false`면 `images: undefined` 반환 (modeImages·inlineImages 무시).
  - `AiDraftDialog`: `supportsImages === false`면 `resolveInlineImagesForSections` **호출 자체를 스킵**(`:109-114`) — 버릴 데이터를 만드느라 IndexedDB blob→dataURL resolve를 돌던 낭비 제거. 같은 조건으로 disclaimer 자리에 `aiDraft.nanoImageNotice`("Chrome 내장 AI는 이미지를 볼 수 없어 입력한 설명을 기반으로 작성합니다") 조건부 표시 — i18n ko/en 동시 추가.
  - 프롬프트의 스크린샷 지시(`buildAiDraftPrompt.ts:144`)를 `caps.supportsImages`로 게이팅. (Task 4에서 compact 본문은 언급 0으로 고정되고 rich 본문은 지시 포함으로 고정된다 — 이 게이트는 Task 4 전까지의 과도기 방어.)
  - **`buildAiDraftPrompt.test.ts:223`/`:270`의 negative 이미지 단정을 여기서 원자적으로 교체**: 기존 단정 제거와 동시에 "supportsImages:false → 전 캡처 모드에서 이미지·스크린샷 언급 없음 / true → screenshot 모드에 지시 있음" 계약 단정 추가 (red→green 한 커밋).
- **검증**:
  - [x] **회귀 재현 테스트(red 먼저)**: `buildAiDraftRequest.test.ts` — `supportsImages: false` + modeImages 있음 → `images === undefined`
  - [x] `supportsImages: true` → 기존 concat 동작 유지 (기존 **5개** 테스트 — 이미지 concat 4 + systemPrompt 반영 1 — 가 `caps` 필드 추가 후에도 green)
  - [x] `supportsImages: false` → 전 캡처 모드 프롬프트에 이미지·스크린샷 언급 없음 (:223/:270 대체 단정)
  - [x] `supportsImages: true` + screenshot 모드 → 스크린샷 지시 있음
  - [x] nanoImageNotice가 `supportsImages: false`에서만 렌더 (i18n 키 ko/en 대칭은 PostToolUse 훅이 검증)

---

### Task 3: 선행 픽스 B·C — 데이터 손실 2건

두 픽스는 독립적이라 **병렬 가능**.

**B. 섹션 누락 = 사용자 텍스트 삭제**

- **변경 대상**: `src/sidepanel/lib/mergeAiDraftSections.ts`
- **작업 내용**: 시그니처를 `mergeAiSectionsPreservingImages(prev, ai, promptedSections: string[])`로 확장. 규칙:
  - AI가 **키 자체를 누락**한 섹션 → 기존 텍스트 보존.
  - AI가 **`""`를 반환**한 섹션 → **`promptedSections`에 있을 때만** 비우기로 인정, 없으면 보존. (절삭으로 AI가 못 본 섹션에 `responseConstraint`가 `""`를 강제 반환시키는 케이스가 삭제로 새는 걸 차단 — 리뷰 CPO 🔴. 나노에선 스키마가 키를 강제해 "키 누락"보다 "`""` 반환"이 실전의 주 손실 경로다.)
  - `promptedSections`는 Task 5의 `fitDraftContext` 반환값에서 온다. Task 5 전까지의 과도기엔 호출부가 "활성 섹션 전부"를 넘긴다(현행 동작 보존 — 절삭이 아직 없으므로 안전).
  - 현재는 이미지가 있는 섹션도 AI가 키를 빠뜨리면 `[...images, ""]`로 축약돼 사용자 텍스트가 날아간다. 같이 고친다.
- **검증**:
  - [x] **회귀 재현 테스트(red 먼저)**: AI가 `notes` 키 누락 → 기존 `notes` 텍스트 보존
  - [x] AI가 `notes: ""` 명시 + `promptedSections`에 notes 포함 → 비워짐 (의도된 삭제 유지)
  - [x] AI가 `notes: ""` 명시 + `promptedSections`에 notes 없음(절삭됨) → 기존 텍스트 보존
  - [x] 이미지 있는 섹션에서 AI 키 누락 → 이미지 + 기존 텍스트 둘 다 보존
  - [x] 기존 `mergeAiDraftSections.test.ts`에 현재 동작(텍스트 드롭)을 고정하는 케이스는 **없음이 리뷰에서 확인됨**(95줄, 키 누락 2건은 이미지 보존만 단언) — 시그니처 변경 반영만 하면 된다

**C. 스타일 cap이 사용자 편집을 먼저 자름**

- **변경 대상**: `src/sidepanel/lib/prompts/context.ts` (신규 생성 — Task 4는 이 파일에 나머지 함수를 추가한다), `src/sidepanel/lib/buildAiStylingPrompt.ts`, `src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`
- **작업 내용**: `selectStyles(specifiedStyles, editedProps, limit)` 순수 함수 추가 — 사용자가 편집한 prop(`styleEdits.inlineStyle`의 키)을 cap에서 **우선 보존**. `AiStylingContext`에 `editedProps` 추가하고 `AiStylingDialog.buildContext`(`:55-65`)에서 채운다. **`buildAiStylingPrompt.ts`의 slice 2곳(`:43`, `:131`)을 `selectStyles` 호출로 교체** — 이 배선이 빠지면 순수 함수만 green이고 프로덕션 버그는 Task 4까지 생존한다(리뷰 QA 지적).
- **검증**:
  - [x] **회귀 재현 테스트(red 먼저)**: 원본 스타일 40개 + 사용자 편집 prop 2개(객체 tail) + limit 30 → 결과에 편집 prop 2개가 **포함**
  - [x] 편집 prop이 limit보다 많으면 편집 prop만으로 채움
  - [x] 편집 prop 없으면 기존 순서대로 slice
  - [x] **프롬프트 레벨 단언**: `buildAiStylingSystemPrompt` 출력에 편집 prop이 실려 있음 (배선 검증)

---

### Task 4: promptStyle별 프롬프트 분리

Task 0~3이 끝난 뒤. **이게 본체다.**

- **변경 대상**: `src/sidepanel/lib/prompts/{caps,context,draft.compact,draft.rich,styling.compact,styling.rich}.ts` (신규), `buildAiDraftPrompt.ts`·`buildAiStylingPrompt.ts` (디스패처로 축소)
- **작업 내용**:
  - `caps.ts`: `PROMPT_CAPS: Record<PromptStyle, PromptCaps>` (design.md 표대로). 무제한은 `Infinity`가 아니라 `Number.MAX_SAFE_INTEGER`. `buildLogSummary.ts`의 `MAX_ERRORS`/`MAX_ACTIONS`는 **건드리지 않는다** — 요약 생성기의 상한이고 다른 소비자가 있다. 프롬프트 캡은 싣는 시점에 추가 slice.
  - `context.ts`: `selectRelevantTokens`·`extractVarRefs`·`selectStyles`·`extractLayoutContext`·`buildStyleDeltaBlock`.
  - `draft.compact.ts`·`styling.compact.ts`: **독립 작성**. `responseConstraint`가 강제하는 규칙 전부 삭제(JSON only / no fences / no extra fields / denied prop 목록 / "빈 문자열 사용"). 지시는 긍정형만. few-shot 1개. 이미지 언급은 **게이트 없이 0으로 고정**(죽은 분기 금지 — `{compact, images:true}` 좌표가 생길 때 게이트 추가). few-shot은 `FewShotExample[]`로 분리 전달 — systemPrompt 문자열 밖이라 JSON 리터럴이 불변식과 충돌하지 않는다.
  - `draft.rich.ts`·`styling.rich.ts`: 역할 격상, 분석 절차, few-shot, 확대된 캡, 레이아웃 컨텍스트. **거절방지 문구 제거**. **JSON 형식 규칙은 유지** (BYOK structured output 연결이 비목표라 유일한 방어선).
  - 기존 두 파일은 `buildAiDraftSessionPrompt`/`buildAiStylingSystemPrompt` 디스패처 + 스키마 + 파서만 남긴다. **export 시그니처를 유지**해 호출부 import 변경이 없게.
  - `buildStyleContextBlock` 제거 → `buildStyleDeltaBlock`으로 대체.
- **검증** — Task 0에서 비운 자리를 **불변식 테스트**로 되메운다:
  - [x] compact 초안 system prompt가 컨텍스트 없는 기본 상태에서 `COMPACT_SYSTEM_TARGET_CHARS`(2000자) 이하 — few-shot은 별도 채널이라 계산 제외
  - [x] compact 프롬프트에 이미지·스크린샷 언급 없음 (전 캡처 모드, 본문 고정)
  - [x] compact 프롬프트에 `"JSON"`·`"fences"`·denied prop 목록 없음
  - [x] rich 프롬프트에는 JSON 형식 규칙이 **있음**
  - [x] rich 스타일링 프롬프트에 `"You CAN and MUST"` 없음
  - [x] rich 스타일링 프롬프트에 레이아웃 컨텍스트 포함 (`display` 등)
  - [x] promptStyle별 캡이 실제로 적용됨 (compact diffs 8 / rich diffs 50)
  - [x] `selectRelevantTokens`: 요소가 `var()`로 참조하는 토큰이 알파벳 순서와 무관하게 우선 선별
  - [x] `buildAiStylingPrompt.test.ts:97-128`의 `buildStyleContextBlock` 테스트 3개 삭제 → `buildStyleDeltaBlock` 테스트로 대체
  - [x] `pnpm typecheck`

---

### Task 5: 컨텍스트 예산 관리

- **변경 대상**: `src/sidepanel/lib/promptBudget.ts` (신규), `src/sidepanel/tabs/AiDraftDialog.tsx`, `src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`, `src/i18n/namespaces/settings.ts`
- **작업 내용**:
  - `trimDraftContext(ctx, level)`: level 0 캡만 → 1 로그 제거 → 2 기존 초안 제거 → 3 diff·토큰 제거.
  - `fitDraftContext(ctx, build, budgetChars)`: 예산(나노 10,000자)에 맞을 때까지 level을 올리며 재빌드. 최종 level에서도 초과면 **던지지 않고** 그대로 반환(2·3차 게이트가 판정). 예산 무제한(BYOK)이면 level 0 즉시 반환 no-op. **반환값에 `includedSections`**(실제 프롬프트에 실린 기존 초안 섹션 id — level 2면 빈 배열) 포함, `mergeAiSectionsPreservingImages`의 `promptedSections`로 전달(Task 3-B 연결).
  - `isPromptOverBudget(session, input, responseSchema?)`: **user turn 직전** `measureContextUsage(input, {responseConstraint})` + `contextUsage` 합산 vs `contextWindow` 실측. 미지원이면 `false`(통과). 세션 생성 직후 판정은 system prompt만 반영하므로 이 시점 실측이 진짜 2차 게이트다(리뷰 CTO·QA 지적).
  - **두 다이얼로그 공통 배선**: `AiDraftDialog`·`AiStylingDialog` 모두 — `createSession`/`prompt` catch에서 `mapQuotaError`(3차 게이트, 구버전 Chrome의 유일한 신호), `prompt` 직전 `isPromptOverBudget`(2차), catch 체인에 `AiContextOverflowError` → `llm.error.contextOverflow` 토스트. 스타일링만 generic 에러로 남기는 비일관 금지(리뷰 CDO 지적).
  - i18n: `settings.ts`의 `llm.error.contextOverflow` (관례 — AI 실행 에러는 `llm.error.*`에 동거, `ai.error.*` 신설 금지). **2단 문구**: main "분석할 내용이 너무 많아 Chrome 내장 AI가 처리할 수 없습니다" + description "API 키를 연결하면 더 큰 용량의 모델을 사용할 수 있습니다" (ko "-하세요"체 톤 일치, "로그를 줄이라"는 실행 불가 지시라 제외). 토스트는 `duration` 연장 고려(영구 조건인데 휘발 채널).
- **검증**:
  - [x] `trimDraftContext` 각 level이 기대한 필드를 제거 (순수 함수 테스트)
  - [x] `fitDraftContext`: 거대 컨텍스트 → level이 올라가며 예산 내로 수렴 + `includedSections` 정합
  - [x] 예산 내 컨텍스트 → level 0 유지 (불필요한 절삭 없음)
  - [x] 예산 무제한(BYOK) → level 0 no-op, 컨텍스트 무손실
  - [x] **거대 단일 항목**(userPrompt 하나가 예산 초과): level 3까지 가도 던지지 않고 그대로 반환
  - [x] **빈 컨텍스트**: level 0 + 유효한 프롬프트
  - [x] `isPromptOverBudget`: 미지원 → `false` / 지원+미초과 → `false` / **지원+초과 → `true`**
  - [x] mock 세션으로 overflow → `AiContextOverflowError` → `llm.error.contextOverflow` 매핑 경로 단언
  - [x] i18n ko/en 키 대칭 (PostToolUse 훅이 자동 검증)

---

### Task 6: 스타일링 멀티턴 중복·누적 정리

- **변경 대상**: `src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`
- **작업 내용**:
  - 첫 턴에 `[Current state]` 블록을 보내지 않는다 — 시스템 프롬프트에 이미 요소 상태가 있어 **완전 중복**이다(`buildAiStylingPrompt.ts:43-49` vs `:129-137`).
  - 이후 턴은 `buildStyleDeltaBlock(lastSentStyles, current)`로 **변경된 prop만** 보낸다. **promptStyle 무관 공통 적용** — compact는 창 보호, rich도 토큰 비용 절감(e2e 관찰이 BYOK mock 경로라 rich 적용이 검증의 전제이기도 하다).
  - `lastSentStylesRef` 기준선 초기화는 **세션 생성 직후 한 지점**(`:91-96`)에서 "시스템 프롬프트에 실제 실은 캡 적용 맵"으로 한다. 세션 파괴 경로가 3개(repick `:87-90` / 에러 catch `:154-156` / provider 변경·언마운트 cleanup `:47-53` — BYOK 연결·해제가 이 경로)라 파괴 지점마다 리셋을 흩뿌리면 누락된다 — 생성 지점 수렴으로 세 경로 전부 커버(리뷰 QA 🔴).
  - 다이얼로그 닫기는 세션을 파괴하지 않으므로(패널 상시 마운트) 닫힌 동안의 수동 편집은 "매 턴 기준선 갱신"이 흡수 — 매 턴 delta 계산 후 `lastSentStyles`를 현재 맵으로 갱신.
- **검증**:
  - [x] `buildStyleDeltaBlock`: 변경 없음 → 빈 문자열
  - [x] 변경된 prop만 포함, 미변경 prop 제외
  - [x] 삭제된 prop도 표현 (값이 사라진 경우)
  - [x] 기준선이 캡 적용 맵 기준 — 캡으로 잘린 prop이 이후 턴에 등장하면 delta에 포함됨
  - [x] ⚠️ **`setStyleEdits(merged)` → `setAiStylingLoading(false)` 호출 순서 불변** (POSTMORTEM 2026-07-08·07-10)
  - [ ] **"e2e 영향" 플래그로 보고** — e2e 실행(`build:e2e`+`test:e2e`)은 `/e2e-write`·`/e2e-run`·push/merge 게이트 전용이라 `/implement`가 직접 돌리지 않는다. `ai-styling.spec.ts`의 "CSS 탭 유지" 케이스(POSTMORTEM 2026-07-10 회귀 감지 지점)와 멀티턴 delta 신규 시나리오를 플래그에 명시

---

### Task 7: rich 레이아웃 컨텍스트 보강

- **변경 대상**: `src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`
- **작업 내용**:
  - `AiStylingDialog.buildContext`: `computedStyles`·`viewport`를 `EditorSelection`에서 실어준다(이미 수집돼 있다 — 새 수집 없음). rich 스타일링 프롬프트가 `extractLayoutContext`로 레이아웃 관련 prop만 추려 싣는다.
  - ~~`getModeImages` annotated+raw 2장 전송~~ — **기각됨**(리뷰 CPO·CDO: BYOK 이미지 비용 2배 대비 품질 근거 없음). 현행 1장(`annotated ?? raw`) 유지, `getModeImages`·테스트 무변경. 품질 근거가 생기면 별도 작업으로 재검토.
- **검증**:
  - [x] rich 스타일링 프롬프트에 `display`·뷰포트 폭이 실림
  - [x] compact 스타일링 프롬프트에는 레이아웃 블록 없음 (예산 보호)
  - [x] `getModeImages.test.ts` 무변경 green

---

## 테스트 계획

### 단위 테스트

| 대상 | 케이스 |
|---|---|
| `ai-provider.ts` (**신규 커버리지**) | Chrome/OpenAI/Anthropic의 `capabilities` 3축. `createSession` 라이프사이클 + `initialPrompts` few-shot 전달. Chrome 세션의 신명칭(`contextUsage`/`contextWindow`/`measureContextUsage`) 노출·구명칭 폴백·부재 `undefined`. `mapQuotaError` 매핑 |
| `buildAiDraftRequest.ts` | `supportsImages: false` → `images === undefined` (**회귀 재현**) |
| `mergeAiDraftSections.ts` | AI 키 누락 → 기존 보존 (**회귀 재현**) / `""`+promptedSections 포함 → 비우기 / `""`+미포함(절삭) → 보존 / 이미지 섹션에서 키 누락 |
| `prompts/context.ts` | `selectStyles` 편집 prop 우선 보존 (**회귀 재현**) / `selectRelevantTokens` 관련성 정렬 / `extractVarRefs` / `extractLayoutContext` / `buildStyleDeltaBlock` |
| `prompts/caps.ts` | promptStyle별 캡이 프롬프트에 실제 적용 |
| `promptBudget.ts` | `trimDraftContext` level별 / `fitDraftContext` 수렴 · 무제한 no-op · `includedSections` 정합 · 거대 단일 항목 · 빈 컨텍스트 / `isPromptOverBudget` 미지원 false·미초과 false·초과 true |
| `buildAiDraftPrompt.ts` | **능력 계약 불변식** (예산·이미지 언급 유무·JSON 규칙 유무) — Task 0에서 제거한 워딩 단정의 대체 |
| `buildAiStylingPrompt.ts` | 동상 + 거절방지 문구 부재(rich) / 레이아웃 컨텍스트 포함(rich) |

### e2e 시나리오

기존 `e2e/ai-draft.spec.ts`·`e2e/ai-styling.spec.ts`가 있다. **e2e 환경에서 `globalThis.LanguageModel`은 항상 unavailable이고(`e2e/GOTCHAS.md` 명문화) 기존 AI spec은 전부 BYOK mock**(`panel.route("**/chat/completions")` + llm seed)이다 — 나노 경로는 e2e로 관찰할 수 없다.

- ~~나노 프롬프트에 스크린샷 언급 없음~~ → **단위 테스트로 강등**(리뷰 QA 확정): Task 2의 이미지 계약 단정 + Task 4의 compact 불변식이 커버. 나노 mock 인프라 신규 구축은 하지 않는다.
- 같은 요소에 AI 스타일링을 2회 연속 실행하면(BYOK mock), 2번째 요청 body에 변경된 prop만 실려 있고 전체 스타일 블록이 재전송되지 않는다 — delta가 rich에도 적용되므로 BYOK mock으로 관찰 가능.
- AI 응답이 `notes` 키를 누락해도(BYOK mock 응답 조작) 사용자가 입력한 `notes` 텍스트가 초안에 남아 있다.

> ⚠️ `ai-styling.spec.ts`의 "CSS 탭 유지 상태에서 AI 스타일링" 케이스는 POSTMORTEM 2026-07-10 픽스의 회귀 감지 지점이다. **반드시 green 유지.**

### 수동 테스트 (Chrome 실제 확인)

- [ ] BYOK 미설정 상태(나노)에서 스크린샷 캡처 → AI 초안 → 결과가 사용자 설명에 근거하고 환각이 줄었는지
- [ ] 나노에서 **한국어 출력이 유지되는지** — 현 동작 보존이 목표다. 영어로 바뀌면 회귀(문서상 미지원 언어의 우발 동작이라 Chrome 업데이트가 깰 수 있는 지점 — 감시 항목)
- [ ] BYOK(Claude/GPT) 연결 후 같은 버그 → 초안 품질이 나노보다 눈에 띄게 나은지 (분석 절차·근거 인용)
- [ ] BYOK에서 "이거 가운데 정렬해줘" → 레이아웃 컨텍스트 덕에 맞는 속성을 고르는지
- [ ] 같은 요소 AI 스타일링 5턴 연속 → 나노에서 안 터지는지

> 리뷰(QA)에서 자동화로 강등된 2건: "편집 prop이 안 되돌아가는지"는 Task 3-C 프롬프트 단언이, "컨텍스트 초과 전용 문구"는 Task 5의 mock 세션 매핑 단언이 커버 — 수동 목록에서 제외(스모크로만 확인).

---

## 구현 순서 권장

```
Task 0 (테스트 결합 해제)  ← 반드시 첫 번째. 안 하면 프롬프트를 못 고친다
   │
Task 1 (능력 표면 + 나노 세션 테스트)  ← ProviderCapabilities의 단일 출처
   │
   ├─ Task 2 (선행 픽스 A: 이미지 모순)   ┐
   ├─ Task 3 (선행 픽스 B·C: 데이터 손실) ├─ 병렬 가능
   │                                      ┘
Task 4 (promptStyle별 프롬프트 분리)  ← 본체. Task 0~3 완료 후
   │
   ├─ Task 5 (나노 예산 관리)      ┐
   ├─ Task 6 (스타일링 멀티턴)     ├─ 병렬 가능 (Task 4의 context.ts에 의존)
   ├─ Task 7 (rich 컨텍스트)       ┘
   │
최종: pnpm test + pnpm typecheck. e2e는 "e2e 영향" 플래그로 보고 → /e2e-write·/push 게이트에서 실행
```

**Task 0이 첫 번째인 이유**: `not.toMatch(/image|이미지/i)` 같은 단정이 남아 있으면 Task 2·4에서 프롬프트에 "image"라는 단어를 쓰는 순간 무관한 테스트가 빨개진다. 지금 프로덕션이 "picture embeds"라는 어색한 표현을 쓰는 게 그 증거다.

**Task 1이 두 번째인 이유**: `capabilities`가 없으면 Task 2~7의 모든 분기가 성립하지 않는다. 동시에 나노 경로 테스트가 0개인 상태를 여기서 해소해, 이후 태스크가 안전망 위에서 진행된다.

## 가이드 영향

**있음** — `guide/ko/screenshot/issue.md`·`guide/en/screenshot/issue.md` (리뷰 CDO 지적으로 대조 완료).

- 두 파일의 AI 초안 절이 "스크린샷 모드에서는 **주석을 입힌 스크린샷 이미지**를 근거로 삼습니다" / "In screenshot mode, AI reads the **annotated screenshot** you attached"라고 서술한다(`:35`). 나노(BYOK 미설정) 사용자에겐 지금도 사실이 아니고(이미지가 전송되지 않음), 이번 변경 후엔 **BYOK 연결 시에만 참**이 된다 — Chrome 내장 AI는 설명 기반임을 조건부로 명시하도록 갱신 필요 (`docs(guide): ...` 커밋, ko/en 동시).
- Task 2의 나노 고지 문구(`aiDraft.nanoImageNotice`)·Task 5의 컨텍스트 초과 문구와 가이드 서술이 일치해야 한다. 작성 규칙은 `guide/AUTHORING.md` 선행 로드.
- 구현 후 `/guide`로 처리 — `/implement` 보고의 "가이드 영향" 플래그에 위 파일을 명시할 것.
