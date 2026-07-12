# AI 프롬프트 tier 분리 — 구현 태스크

> 용어: 등급 스칼라 `tier`는 폐기됐다. 능력은 `ProviderCapabilities` = `promptStyle`(compact|rich) · `supportsImages` · `contextBudgetChars` 3개 축이다. 이번에 출하하는 좌표는 **나노=`{compact, false, 2000}`** / **BYOK=`{rich, true, 무제한}`** 2개뿐. 근거는 design.md 개요.

## 선행 조건

- 권한·env·OAuth·외부 API 변경 **없음**. manifest 무변경 → `docs/PERMISSION.md`·`docs/privacy.{ko,en}.md` 갱신 불필요.
- 새 의존성 **없음** → `pnpm-workspace.yaml`의 `minimumReleaseAge` 정책에 걸리지 않는다.
- `src/i18n/` 수정 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행한다 — ko/en 동시 갱신 필수.
- **착수 전 필독**: `docs/POSTMORTEM.md`의 2026-07-08 / 2026-07-09 항목. 둘 다 AI 스타일 적용 → CodeMirror doc 재동기화 경로다. `AiStylingDialog`의 `setStyleEdits(merged)` → `setAiStylingLoading(false)` **호출 순서를 바꾸면 회귀**한다.

---

## 태스크

### Task 0: 테스트 결합 해제 (프롬프트 워딩 인질 제거)

프롬프트 본문을 고치려면 **먼저** 이걸 해야 한다. 지금은 테스트가 프로덕션 워딩을 고정하고 있다.

- **변경 대상**: `src/sidepanel/lib/__tests__/buildAiDraftPrompt.test.ts`
- **작업 내용**:
  - `:223` `expect(prompt).not.toMatch(/image|이미지/i)` (video 모드) 제거 — 이 단정 때문에 프로덕션이 `"markdown picture embeds"`(`buildAiDraftPrompt.ts:238`)라는 우회 표현을 쓴다.
  - `:270` `not.toMatch(/image|screenshot|스크린샷/i)` (freeform) 제거.
  - `:462-465` `not.toMatch(/sentence/i)` 제거.
  - `:549-556` full-string 동등 단정(`expect(withEmpty).toBe(without)`) 제거 — 프롬프트 어떤 변화든 깨진다.
  - 대체: **능력 계약 불변식 테스트**로. (Task 4 이후 채워지므로 여기선 제거만 하고 빈 자리를 남긴다.)
- **검증**:
  - [ ] `pnpm test buildAiDraftPrompt` green (제거만 했으므로 남은 테스트는 전부 통과)
  - [ ] 프로덕션 코드 무변경 (이 태스크는 테스트만 건드린다)

> ⚠️ 워딩을 강제하던 단정을 지우는 것이라 커버리지가 일시적으로 준다. Task 4에서 불변식 테스트로 되메운다.

---

### Task 1: `AIProvider` 능력 표면 + 나노 세션 실측 배선

- **변경 대상**: `src/sidepanel/lib/ai-provider.ts`, `src/sidepanel/hooks/useAI.ts`
- **작업 내용**:
  - `PromptStyle = "compact" | "rich"`, `ProviderCapabilities` 인터페이스, `NANO_CAPABILITIES`/`BYOK_CAPABILITIES` 상수, `AiContextOverflowError` 클래스 추가.
  - `AIProvider`에 `readonly capabilities: ProviderCapabilities` 추가. Chrome → `NANO_CAPABILITIES`, OpenAI·Anthropic → `BYOK_CAPABILITIES`.
  - `AISession`에 옵셔널 `measureInputUsage?`·`inputUsage?`·`inputQuota?` 추가. 전역 `LanguageModelInstance` 타입 선언(`:3-9`)에 그 3개를 옵셔널로 추가하고, Chrome 세션 래퍼가 네이티브 값을 그대로 노출.
  - `useAI()` 반환에 `capabilities` 추가 — **provider에서 파생**한다(새 판정 로직을 만들지 않는다. `llm?.modelId` 유무 판정은 이미 `:53`에 있다).
- **검증** — 이 경로는 현재 테스트 0개다. 여기서 처음 박는다:
  - [ ] `ai-provider.test.ts`에 `createChromeAIProvider` 테스트 추가: `capabilities.promptStyle === "compact"`, `supportsImages === false`, `contextBudgetChars === 2000`
  - [ ] `createOpenAICompatibleProvider`·`createAnthropicProvider`: `promptStyle === "rich"`, `supportsImages === true`
  - [ ] `createSession` 테스트 추가: Chrome 세션이 `globalThis.LanguageModel.create`를 `CHROME_AI_LANG_OPTIONS`와 함께 호출하고, `destroy`가 네이티브 세션을 destroy
  - [ ] Chrome 세션이 `measureInputUsage`/`inputQuota`를 노출 (네이티브에 있을 때) / 없으면 `undefined` (구버전 폴백)
  - [ ] `pnpm typecheck`

---

### Task 2: 선행 픽스 A — 나노 이미지 모순

**지금 깨져 있는 버그.** BYOK 미설정 사용자 전원이 스크린샷 모드에서 환각 초안을 받고 있다.

- **변경 대상**: `src/sidepanel/lib/buildAiDraftRequest.ts`, `src/sidepanel/lib/buildAiDraftPrompt.ts`, `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**:
  - `AiDraftSessionContext`에 `caps: ProviderCapabilities` 추가.
  - `buildAiDraftRequest`: `supportsImages === false`면 `images: undefined` 반환 (modeImages·inlineImages 무시).
  - `AiDraftDialog`: `supportsImages === false`면 `resolveInlineImagesForSections` **호출 자체를 스킵**(`:109-114`) — 버릴 데이터를 만드느라 IndexedDB blob→dataURL resolve를 돌던 낭비 제거.
  - 프롬프트의 스크린샷 지시(`buildAiDraftPrompt.ts:144`)를 `caps.supportsImages`로 게이팅. (Task 4에서 스타일별 파일로 이관되지만, 그 전에 이 게이트부터 세운다.)
- **검증**:
  - [ ] **회귀 재현 테스트(red 먼저)**: `buildAiDraftRequest.test.ts` — `supportsImages: false` + modeImages 있음 → `images === undefined`
  - [ ] `supportsImages: true` → 기존 concat 동작 유지 (기존 4개 테스트가 `caps` 필드 추가 후에도 green)
  - [ ] `buildAiDraftPrompt.test.ts` — `supportsImages: false` + screenshot 모드 → 프롬프트에 스크린샷 지시 없음
  - [ ] `supportsImages: true` + screenshot 모드 → 스크린샷 지시 있음

---

### Task 3: 선행 픽스 B·C — 데이터 손실 2건

두 픽스는 독립적이라 **병렬 가능**.

**B. 섹션 누락 = 사용자 텍스트 삭제**

- **변경 대상**: `src/sidepanel/lib/mergeAiDraftSections.ts`
- **작업 내용**: `if (id in aiSections)` 게이트(`:20-23`)를 고쳐, **AI가 키 자체를 누락한 섹션은 기존 텍스트를 그대로 보존**한다. 단 **AI가 빈 문자열을 명시적으로 준 경우(= 비우기 의도)와 구분**해야 한다 — 전자는 비우고 후자는 보존.
  - 현재는 이미지가 있는 섹션도 AI가 키를 빠뜨리면 `[...images, ""]`로 축약돼 사용자 텍스트가 날아간다. 같이 고친다.
- **검증**:
  - [ ] **회귀 재현 테스트(red 먼저)**: AI가 `notes` 키 누락 → 기존 `notes` 텍스트 보존
  - [ ] AI가 `notes: ""` 명시 → 비워짐 (의도된 삭제는 유지)
  - [ ] 이미지 있는 섹션에서 AI 키 누락 → 이미지 + 기존 텍스트 둘 다 보존
  - [ ] 기존 `mergeAiDraftSections.test.ts` (95줄) 중 현재 동작에 의존하는 케이스가 있는지 먼저 확인 — 있으면 그게 "버그를 고정한 테스트"인지 판단해 갱신

**C. 스타일 cap이 사용자 편집을 먼저 자름**

- **변경 대상**: `src/sidepanel/lib/prompts/context.ts` (신규), `src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`
- **작업 내용**: `selectStyles(specifiedStyles, editedProps, limit)` 순수 함수 추가 — 사용자가 편집한 prop(`styleEdits.inlineStyle`의 키)을 cap에서 **우선 보존**. `AiStylingContext`에 `editedProps` 추가하고 `AiStylingDialog.buildContext`(`:55-65`)에서 채운다.
- **검증**:
  - [ ] **회귀 재현 테스트(red 먼저)**: 원본 스타일 40개 + 사용자 편집 prop 2개(객체 tail) + limit 30 → 결과에 편집 prop 2개가 **포함**
  - [ ] 편집 prop이 limit보다 많으면 편집 prop만으로 채움
  - [ ] 편집 prop 없으면 기존 순서대로 slice

---

### Task 4: promptStyle별 프롬프트 분리

Task 0~3이 끝난 뒤. **이게 본체다.**

- **변경 대상**: `src/sidepanel/lib/prompts/{caps,context,draft.compact,draft.rich,styling.compact,styling.rich}.ts` (신규), `buildAiDraftPrompt.ts`·`buildAiStylingPrompt.ts` (디스패처로 축소)
- **작업 내용**:
  - `caps.ts`: `PROMPT_CAPS: Record<PromptStyle, PromptCaps>` (design.md 표대로). 무제한은 `Infinity`가 아니라 `Number.MAX_SAFE_INTEGER`. `buildLogSummary.ts`의 `MAX_ERRORS`/`MAX_ACTIONS`는 **건드리지 않는다** — 요약 생성기의 상한이고 다른 소비자가 있다. 프롬프트 캡은 싣는 시점에 추가 slice.
  - `context.ts`: `selectRelevantTokens`·`extractVarRefs`·`selectStyles`·`extractLayoutContext`·`buildStyleDeltaBlock`.
  - `draft.compact.ts`·`styling.compact.ts`: **독립 작성**. `responseConstraint`가 강제하는 규칙 전부 삭제(JSON only / no fences / no extra fields / denied prop 목록 / "빈 문자열 사용"). 지시는 긍정형만. few-shot 1개. 이미지 언급은 `caps.supportsImages`로 게이팅(현 소비자인 나노는 false라 결과적으로 0줄).
  - `draft.rich.ts`·`styling.rich.ts`: 역할 격상, 분석 절차, few-shot, 확대된 캡, 레이아웃 컨텍스트. **거절방지 문구 제거**. **JSON 형식 규칙은 유지** (BYOK structured output 연결이 비목표라 유일한 방어선).
  - 기존 두 파일은 `buildAiDraftSessionPrompt`/`buildAiStylingSystemPrompt` 디스패처 + 스키마 + 파서만 남긴다. **export 시그니처를 유지**해 호출부 import 변경이 없게.
  - `buildStyleContextBlock` 제거 → `buildStyleDeltaBlock`으로 대체.
- **검증** — Task 0에서 비운 자리를 **불변식 테스트**로 되메운다:
  - [ ] compact 초안 system prompt가 컨텍스트 없는 기본 상태에서 `NANO_CAPABILITIES.contextBudgetChars`(2000자) 이하
  - [ ] `supportsImages: false`면 프롬프트에 이미지·스크린샷 언급 없음 (전 캡처 모드)
  - [ ] compact 프롬프트에 `"JSON"`·`"fences"`·denied prop 목록 없음
  - [ ] rich 프롬프트에는 JSON 형식 규칙이 **있음**
  - [ ] rich 스타일링 프롬프트에 `"You CAN and MUST"` 없음
  - [ ] rich 스타일링 프롬프트에 레이아웃 컨텍스트 포함 (`display` 등)
  - [ ] promptStyle별 캡이 실제로 적용됨 (compact diffs 8 / rich diffs 50)
  - [ ] `selectRelevantTokens`: 요소가 `var()`로 참조하는 토큰이 알파벳 순서와 무관하게 우선 선별
  - [ ] `buildAiStylingPrompt.test.ts:97-128`의 `buildStyleContextBlock` 테스트 3개 삭제 → `buildStyleDeltaBlock` 테스트로 대체
  - [ ] `pnpm typecheck`

---

### Task 5: 컨텍스트 예산 관리

- **변경 대상**: `src/sidepanel/lib/promptBudget.ts` (신규), `src/sidepanel/tabs/AiDraftDialog.tsx`, `src/i18n/namespaces/ai.ts`
- **작업 내용**:
  - `trimDraftContext(ctx, level)`: level 0 캡만 → 1 로그 제거 → 2 기존 초안 제거 → 3 diff·토큰 제거.
  - `fitDraftContext(ctx, build, budgetChars)`: 예산에 맞을 때까지 level을 올리며 재빌드. 최종 level에서도 초과면 **던지지 않고** 그대로 반환(2차 게이트가 판정). 예산이 무제한(BYOK)이면 level 0으로 즉시 반환하는 no-op.
  - `isSessionOverBudget(session)`: 세션 생성 후 `inputUsage` vs `inputQuota` 실측. 미지원이면 `false`(통과).
  - `AiDraftDialog`: `fitDraftContext(caps.contextBudgetChars)` 적용 → 세션 생성 → 2차 게이트 초과 시 `AiContextOverflowError` → 전용 토스트.
  - i18n: `ai.error.contextOverflow` (ko/en). **재시도가 무의미함을 알리는 문구** — "컨텍스트가 너무 큽니다. 로그를 줄이거나 API 키를 연결하세요."
- **검증**:
  - [ ] `trimDraftContext` 각 level이 기대한 필드를 제거 (순수 함수 테스트)
  - [ ] `fitDraftContext`: 거대 컨텍스트 → level이 올라가며 예산 내로 수렴
  - [ ] 예산 내 컨텍스트 → level 0 유지 (불필요한 절삭 없음)
  - [ ] 예산 무제한(BYOK) → level 0 no-op, 컨텍스트 무손실
  - [ ] `isSessionOverBudget`: `inputQuota` 미지원 세션 → `false`
  - [ ] i18n ko/en 키 대칭 (PostToolUse 훅이 자동 검증)

---

### Task 6: 스타일링 멀티턴 중복·누적 정리

- **변경 대상**: `src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`
- **작업 내용**:
  - 첫 턴에 `[Current state]` 블록을 보내지 않는다 — 시스템 프롬프트에 이미 요소 상태가 있어 **완전 중복**이다(`buildAiStylingPrompt.ts:43-49` vs `:129-137`).
  - 이후 턴은 `buildStyleDeltaBlock(lastSentStyles, current)`로 **변경된 prop만** 보낸다.
  - `lastSentStylesRef`의 기준선은 **시스템 프롬프트에 실제로 실은 스타일 맵**으로 초기화한다(원본 `specifiedStyles` 전체가 아니라 — 캡으로 잘린 뒤의 맵). 어긋나면 AI가 못 본 prop을 delta가 "변경 없음"으로 판단해 영원히 안 보낸다.
  - 세션 재생성(repick) 시 `lastSentStylesRef`도 리셋.
- **검증**:
  - [ ] `buildStyleDeltaBlock`: 변경 없음 → 빈 문자열
  - [ ] 변경된 prop만 포함, 미변경 prop 제외
  - [ ] 삭제된 prop도 표현 (값이 사라진 경우)
  - [ ] ⚠️ **`setStyleEdits(merged)` → `setAiStylingLoading(false)` 호출 순서 불변** (POSTMORTEM 2026-07-08)
  - [ ] `pnpm test:e2e -- ai-styling` green — 특히 "CSS 탭 유지 상태에서 AI 스타일링" 케이스

---

### Task 7: rich 이미지·레이아웃 컨텍스트 보강

- **변경 대상**: `src/sidepanel/tabs/AiDraftDialog.tsx` (`getModeImages`), `src/sidepanel/tabs/styleEditor/AiStylingDialog.tsx`
- **작업 내용**:
  - `getModeImages`: screenshot 모드에서 `screenshotAnnotated ?? screenshotRaw` → **둘 다** 반환(사용자가 표시한 곳과 원본을 대조 가능). `caps.supportsImages` 게이트 뒤에 있으므로 나노엔 영향 없다.
  - `AiStylingDialog.buildContext`: `computedStyles`·`viewport`를 `EditorSelection`에서 실어준다(이미 수집돼 있다 — 새 수집 없음).
- **검증**:
  - [ ] `getModeImages.test.ts` 갱신 — screenshot 모드에서 2장 반환. annotated만 있으면 1장, raw만 있으면 1장
  - [ ] rich 스타일링 프롬프트에 `display`·뷰포트 폭이 실림
  - [ ] ⚠️ 토큰 비용 증가 주의 — 이미지 수가 2배가 된다

---

## 테스트 계획

### 단위 테스트

| 대상 | 케이스 |
|---|---|
| `ai-provider.ts` (**신규 커버리지**) | Chrome/OpenAI/Anthropic의 `capabilities` 3축. `createSession` 라이프사이클. Chrome 세션의 `measureInputUsage`/`inputQuota` 노출·부재 폴백 |
| `buildAiDraftRequest.ts` | `supportsImages: false` → `images === undefined` (**회귀 재현**) |
| `mergeAiDraftSections.ts` | AI 키 누락 → 기존 보존 (**회귀 재현**) / AI 빈 문자열 → 비우기 / 이미지 섹션에서 키 누락 |
| `prompts/context.ts` | `selectStyles` 편집 prop 우선 보존 (**회귀 재현**) / `selectRelevantTokens` 관련성 정렬 / `extractVarRefs` / `extractLayoutContext` / `buildStyleDeltaBlock` |
| `prompts/caps.ts` | promptStyle별 캡이 프롬프트에 실제 적용 |
| `promptBudget.ts` | `trimDraftContext` level별 / `fitDraftContext` 수렴 · 무제한 no-op / `isSessionOverBudget` 폴백 |
| `buildAiDraftPrompt.ts` | **능력 계약 불변식** (예산·이미지 언급 유무·JSON 규칙 유무) — Task 0에서 제거한 워딩 단정의 대체 |
| `buildAiStylingPrompt.ts` | 동상 + 거절방지 문구 부재(rich) / 레이아웃 컨텍스트 포함(rich) |

### e2e 시나리오

기존 `e2e/ai-draft.spec.ts`·`e2e/ai-styling.spec.ts`가 있다. 신규 시나리오:

- 나노(Chrome AI) 상태에서 스크린샷 모드 AI 초안을 실행하면, 세션에 전달된 프롬프트에 스크린샷 언급이 없고 이미지가 전달되지 않는다.
- 같은 요소에 AI 스타일링을 2회 연속 실행하면, 2번째 요청의 입력에 변경된 prop만 실려 있고 전체 스타일 블록이 재전송되지 않는다.
- AI 응답이 `notes` 키를 누락해도 사용자가 입력한 `notes` 텍스트가 초안에 남아 있다.

> ⚠️ `ai-styling.spec.ts`의 "CSS 탭 유지 상태에서 AI 스타일링" 케이스는 POSTMORTEM 2026-07-09 픽스의 회귀 감지 지점이다. **반드시 green 유지.**

### 수동 테스트 (Chrome 실제 확인)

- [ ] BYOK 미설정 상태(나노)에서 스크린샷 캡처 → AI 초안 → 결과가 사용자 설명에 근거하고 환각이 줄었는지
- [ ] 나노에서 로그가 많은 페이지(video 모드) → 컨텍스트 초과 시 전용 안내 문구가 뜨는지 (generic "다시 시도" 아님)
- [ ] 나노에서 **한국어 출력이 유지되는지** — 현 동작 보존이 목표다. 영어로 바뀌면 회귀
- [ ] BYOK(Claude/GPT) 연결 후 같은 버그 → 초안 품질이 나노보다 눈에 띄게 나은지 (분석 절차·근거 인용)
- [ ] BYOK에서 "이거 가운데 정렬해줘" → 레이아웃 컨텍스트 덕에 맞는 속성을 고르는지
- [ ] 선언 30개 넘는 Tailwind 요소에서 스타일 편집 후 AI 스타일링 → 편집이 되돌아가지 않는지
- [ ] 같은 요소 AI 스타일링 5턴 연속 → 나노에서 안 터지는지

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
최종: pnpm test + pnpm typecheck + pnpm test:e2e (ai-draft, ai-styling)
```

**Task 0이 첫 번째인 이유**: `not.toMatch(/image|이미지/i)` 같은 단정이 남아 있으면 Task 2·4에서 프롬프트에 "image"라는 단어를 쓰는 순간 무관한 테스트가 빨개진다. 지금 프로덕션이 "picture embeds"라는 어색한 표현을 쓰는 게 그 증거다.

**Task 1이 두 번째인 이유**: `capabilities`가 없으면 Task 2~7의 모든 분기가 성립하지 않는다. 동시에 나노 경로 테스트가 0개인 상태를 여기서 해소해, 이후 태스크가 안전망 위에서 진행된다.

## 가이드 영향

**없음.**

사용자에게 노출되는 UI·플로우는 그대로다(같은 버튼, 같은 다이얼로그, 같은 배지). 프롬프트 품질과 내부 능력 분기만 바뀐다.

예외적으로 **Task 5의 컨텍스트 초과 안내 문구**(`ai.error.contextOverflow`)는 새 사용자 노출 문자열이지만, 에러 토스트 1줄이라 가이드 페이지를 새로 쓸 정도는 아니다. 다만 나노 사용자가 이 문구를 자주 보게 되면 `guide/ko`·`guide/en`의 AI 관련 페이지에 "Chrome 내장 AI는 컨텍스트가 작아 로그가 많으면 실패할 수 있다 — API 키 연결 권장" 한 줄을 추가하는 것을 **구현 후 재평가**한다. 판단 기준은 `guide/AUTHORING.md`.
