# AI 초안 로그 코드블럭 자동 삽입 — 기술 설계

## 개요

AI 응답 스키마에 `logRefs: string[]`를 추가해 모델이 **로그 id만** 반환하게 하고, 앱이 그 id를 원본 `NetworkRequest`/`ConsoleEntry`로 되짚어 기존 `serializeNetworkRequest`/`serializeConsoleEntry`로 코드블럭을 만들어 `description` 섹션 끝에 붙인다. 모델은 후보 목록에서 **고르기만** 하므로 로그 내용 환각이 데이터 경로상 불가능하다.

설계의 축은 **"프롬프트에 실제로 인쇄된 후보 집합"이 단일 출처**라는 것이다. 새 모듈 `prompts/logCandidates.ts`가 그 집합을 만들고, 프롬프트 인쇄·스키마 `enum`·응답 해석이 **전부 같은 집합**에서 파생된다. 이 셋 중 하나라도 독자적으로 추정하면 그 틈으로 "모델이 본 적 없는 로그"가 본문에 삽입된다. 저장소는 같은 함정을 이미 `selectDraftSections`에서 겪고 단일 출처로 봉합했다(`prompts/context.ts:76-78`) — 같은 패턴을 따른다.

## 변경 범위

### 신규

| 파일 | 역할 |
|---|---|
| `src/sidepanel/lib/prompts/logCandidates.ts` | 후보 집합 단일 출처. `supportsConsoleNetworkLog` 게이트 + network dedup + 스타일별 캡 + `ref` 부여 |
| `src/sidepanel/lib/renderLogRefs.ts` | ref → 원본 로그 → `LogCodeBlock` → fenced markdown. 상한 판정·미지 ref 스킵·중복 제거 |
| `src/sidepanel/lib/markdownBlocks.ts` | fenced code block 추출/제거 + 보존 대상(이미지·코드블럭)을 뺀 strip 기준 |

`logCandidates.ts`를 `prompts/context.ts`에 합치지 않는 이유: `context.ts`가 `caps.ts`·`captureLogSupport.ts`를 런타임 import하게 되고, `AiDraftSessionContext` type-only import(`draftRich.ts:3`이 이미 하는 방식)를 국소화하는 편이 낫다.

### 수정

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/sidepanel/lib/buildLogSummary.ts` | 로그 → AI 프롬프트용 요약 | 요약 항목에 원본 `id` 동행. `topErrors: string[]` → `ConsoleLogSummaryError[]` |
| `src/sidepanel/lib/prompts/draftRich.ts` | rich 프롬프트 본문 | 로그 줄을 `selectLogCandidates`로 교체(`[n1]` 접두), `logRefs` 출력 키·규칙 추가 |
| `src/sidepanel/lib/prompts/draftCompact.ts` | compact 프롬프트 본문 | 동일 + few-shot 변형 추가 |
| `src/sidepanel/lib/buildAiDraftPrompt.ts` | 스키마·파싱·스타일 디스패치 | `buildAiDraftSchema` optional 2번째 인자, `AiDraftResponse` 타입, few-shot 선택 |
| `src/sidepanel/lib/mergeAiDraftSections.ts` | AI 섹션 병합 + 이미지 보존 | 코드블럭도 보존. 함수명 `…PreservingImages` → `…PreservingBlocks` |
| `src/sidepanel/tabs/AiDraftDialog.tsx` | 전체 호출 흐름 | 후보/스키마/삽입 배선 (유일한 배선 지점) |

### 손대지 않는 것

- `logToCodeBlock.ts` — 직렬화는 그대로 재사용. **AI 경로 전용 캡을 두지 않는다**(PRD 비목표).
- `generateReproPrefill.ts` — `buildAiDraftSchema(["stepsToReproduce"])` 호출이 **byte-identical로 유지**돼야 한다. 새 인자가 optional인 이유.
- 이슈 본문 8개 빌더 — 요약 타입이 바뀌지만 전부 `errors.length`·`errorCount`·`warnCount`만 읽는다(grep 확인: `buildIssueMarkdown.ts:497/523`, `buildIssueAdf.ts:273` 등). item 필드를 읽는 곳은 `draftRich.ts:108/116`·`draftCompact.ts:73/79` 둘뿐.

## 데이터 흐름

```
editor-store: networkLog.requests / consoleLog.entries      ← 스냅샷(await 이전에 잡음)
        │
        ├─ buildNetworkLogSummary / buildConsoleLogSummary   … id 동행
        │        ↓
        │   AiDraftSessionContext
        │        ↓
        │   fitDraftContext(…)  → fitted.ctx                 … level≥1이면 요약 삭제
        │        ↓
        │   selectLogCandidates(fitted.ctx)  ★ 단일 출처
        │        ├──────────────┬───────────────┐
        │        ↓              ↓               ↓
        │   프롬프트 인쇄    스키마 enum      few-shot 선택
        │   [n1] GET /… → 500                      ↓
        │                                    session.prompt()
        │                                          ↓
        │                             parseAiDraftResponse → { title, sections, logRefs }
        │                                          ↓
        │                     mergeAiSectionsPreservingBlocks(prev, ai, promptedSections)
        │                          → [...images, aiText, ...prevCodeBlocks]
        │                                          ↓
        └────────────────────────→ renderLogRefBlocks(logRefs, {candidates, requests, entries})
                                              ↓  (후보 대조 · 미지 ref 스킵 · >3이면 전부 버림)
                                   appendLogBlocks(merged.description, blocks)
                                              ↓  (기존 블록과 동일 텍스트면 스킵)
                                          setDraft()
```

**최종 `description` 조립 순서**: `이미지…` → `AI 산문` → `사용자 기존 코드블럭…` → `새 AI 로그 블록…`

**절삭 결합**: 프롬프트·스키마·few-shot이 **전부 `fitted.ctx`에서 파생**되므로 `fitDraftContext`가 level≥1로 로그 요약을 지우면(`promptBudget.ts:19-22`) 셋이 동시에 `logRefs`를 잃는다. `AiDraftDialog.tsx:155`가 이미 `getDraftFewShot(fitted.ctx)`로 호출 중이라 few-shot은 발판이 있다.

## 인터페이스 설계

### `buildLogSummary.ts`

```ts
export interface NetworkLogSummaryError {
  id: string;        // NetworkRequest.id — 프롬프트에 절대 노출하지 않는다
  method: string;
  path: string;
  status: number;
  statusText: string;
}
export interface ConsoleLogSummaryError {
  id: string;        // ConsoleEntry.id
  message: string;   // 기존 firstLine() 결과
}

export interface NetworkLogSummary { captured: number; errors: NetworkLogSummaryError[] }
export interface ConsoleLogSummary {
  captured: number;
  errorCount: number;
  warnCount: number;
  topErrors: ConsoleLogSummaryError[];   // string[]에서 변경
}
```

`ref`는 여기서 부여하지 **않는다** — 아래 참조.

### `prompts/logCandidates.ts` (신규)

```ts
export type LogCandidateKind = "network" | "console";

export interface NetworkLogCandidate extends NetworkLogSummaryError { ref: string }   // "n1"…
export interface ConsoleLogCandidate extends ConsoleLogSummaryError { ref: string }   // "c1"…

export interface LogCandidates {
  network: NetworkLogCandidate[];
  console: ConsoleLogCandidate[];
}

// 프롬프트에 실제로 인쇄될 후보의 단일 출처.
// supportsConsoleNetworkLog 게이트 → network dedup → PROMPT_CAPS[style] 캡 → ref 부여 순.
export function selectLogCandidates(ctx: AiDraftSessionContext): LogCandidates;

export function candidateRefs(c: LogCandidates): string[];
export function findCandidate(
  c: LogCandidates,
  ref: string,
): { id: string; kind: LogCandidateKind } | undefined;
```

**`ref`를 `buildLogSummary`가 아니라 여기서 부여하는 이유**: `buildLogSummary.MAX_ERRORS = 5`인데 `PROMPT_CAPS.compact.networkErrors = 3`이고 여기서 dedup까지 한다. 요약 단계에서 번호를 매기면 인쇄되는 목록이 `n1, n3, n4`처럼 비게 되고, 더 나쁘게는 **요약엔 있지만 인쇄되지 않은 `n5`가 실재하는 ref가 된다**. 필터·캡을 전부 통과한 뒤 부여해야 `ref` 집합 = 인쇄된 집합이 성립한다.

**dedup 키**: `method + path + status`. 게이트는 배열 길이로만 판정한다 — rich의 헤더 조건(`errorCount > 0 || warnCount > 0`, `draftRich.ts:114`)을 따라가면 warn만 있는 캡처에서 헤더는 찍히는데 `topErrors`는 비어 compact와 갈린다.

### `renderLogRefs.ts` (신규)

```ts
// 상한이자 "나열해버림" 임계값. 근거 없는 임의값 — 실사용 데이터로 보정한다(PRD 참조).
export const MAX_LOG_REFS = 3;

export interface LogRefSource {
  candidates: LogCandidates;    // 프롬프트에 인쇄된 집합. 요약을 직접 넘기면 안 된다
  requests: NetworkRequest[];   // 요약을 만든 것과 같은 store 스냅샷
  entries: ConsoleEntry[];
}

// 미지 ref 스킵 → 중복 ref 제거 → 유효 개수가 MAX_LOG_REFS 초과면 [] + console.warn.
export function renderLogRefBlocks(refs: string[], src: LogRefSource): LogCodeBlock[];

// LogCodeBlock → ```lang\n…\n``` (language 없으면 bare fence)
export function codeBlockMarkdown(block: LogCodeBlock): string;

// 섹션 끝에 블록 추가. 섹션에 이미 같은 텍스트의 블록이 있으면 그 블록은 건너뛴다.
export function appendLogBlocks(section: string, blocks: LogCodeBlock[]): string;
```

`kind` 디스패치는 `findCandidate`가 돌려주는 `kind`로 한다 — **`n`/`c` 접두 문자열을 파싱하지 않는다.** 태그 포맷이 load-bearing한 곳을 한 군데로 묶는다.

### `markdownBlocks.ts` (신규)

```ts
// 들여쓰기 0의 fenced block만 매칭한다. neutralizeFences가 본문 내 백틱 런을
// 4칸 들여쓰므로(logToCodeBlock.ts:21) 내부 fence는 여기 안 걸린다.
export function extractCodeBlocks(markdown: string): string[];
export function stripCodeBlocks(markdown: string): string;

// 병합 시 보존되는 것(이미지 + 코드블럭)을 뺀 "사용자가 쓴 산문". 
// selectDraftSections와 merge가 공유하는 단일 기준.
export function stripPreservedContent(markdown: string): string;
```

### `buildAiDraftPrompt.ts`

```ts
// opts.logRefs는 non-empty여야 한다. enum: []는 퇴화 스키마이고 nano의 문법 컴파일이
// 깨질 수 있다 — 후보가 없으면 호출부가 opts를 생략한다.
export function buildAiDraftSchema(
  sectionIds: IssueSectionId[],
  opts?: { logRefs: string[] },
);

export interface AiDraftResponse {
  title: string;
  sections: Record<string, string>;
  logRefs: string[];   // 없거나 형식이 깨지면 []
}

export function parseAiDraftResponse(
  raw: string,
  enabledSectionIds: IssueSectionId[],
): AiDraftResponse | null;
```

`EditorDraft`(store 타입)를 반환하지 않는 이유: `logRefs`는 `setDraft` 이전에 소비되는 transient 값이라 **store가 절대 들고 있으면 안 된다.** 덤으로 `buildAiDraftPrompt.ts`에서 `import type { EditorDraft }`가 사라진다.

`parseAiDraftResponse`는 **후보 대조를 하지 않는다** — 순수 JSON 디코더로 남기고, 검증·해석은 `renderLogRefs` 한 곳에만 둔다.

스키마 조각:
```ts
properties.logRefs = { type: "array", items: { type: "string", enum: opts.logRefs } };
required.push("logRefs");
```
`minItems` 없음 → `[]`가 "관련 로그 없음"의 표현. `enum`은 nano의 구조적 가드고, **BYOK엔 아무 효력이 없으므로**(`ai-provider.ts:385`) `renderLogRefs`의 후보 대조가 실질 방어선이다.

### `mergeAiDraftSections.ts`

```ts
export function mergeAiSectionsPreservingBlocks(
  prevSections: Record<string, string>,
  aiSections: Record<string, string>,
  promptedSections: string[],
): Record<string, string>;
// out[id] = [...images, aiText, ...prevCodeBlocks].filter(Boolean).join("\n\n")
```

기존 가드 3개(프롬프트 미포함 섹션은 prev 우선 / AI 키 누락 시 prev 보존 / 이미지 상단 hoist)는 그대로다.

## 기존 패턴 준수

- **단일 출처 강제** — `selectDraftSections`(`prompts/context.ts:76-78`)가 확립한 패턴. 후보 집합에 그대로 적용한다.
- **`Record` 디스패치** — `DRAFT_BUILDERS`/`DRAFT_FEW_SHOT`이 `Record<PromptStyle, …>`인 건 새 스타일이 조용히 rich로 흘러가지 않게 하려는 것(`buildAiDraftPrompt.ts:91-92`). few-shot 선택이 2차원(style × 후보유무)이 되지만 **style 축의 `Record`는 유지**하고 후보 유무를 그 위에 얹는다.
- **compact은 긍정형 지시 + few-shot** — 부정 지시("Do not X")는 소형 모델에서 역효과(`draftCompact.ts:12`). JSON 형식 규칙은 `responseConstraint`가 강제하므로 넣지 않는다. `logRefs` 지시는 **형식이 아니라 선별 의미**라 한 줄 추가가 정당하다.
- **인젝션 방어** — 후보 줄은 페이지 통제 문자열(console 메시지·URL)이므로 기존 `oneLine()` 경로를 그대로 탄다.
- **테스트 2트랙** — 전부 순수 함수라 `*.test.ts`(node) 트랙.
- **i18n 영향 없음** — 새 사용자 노출 문자열이 없다. 코드블럭은 로그 원문이고 토스트는 기존 `aiDraft.contextTrimmed`를 재사용한다.

## 대안 검토

### 1. AI가 로그 텍스트를 직접 출력 — 기각

배선이 가장 쉽고 섹션·위치를 AI가 자유롭게 정할 수 있다. 그러나 **로그를 환각한다.** 버그 리포트에서 로그의 가치는 전부 정확성이라 지어낸 스택 트레이스는 개발자를 잘못된 곳으로 보낸다. 이 feature의 존재 이유 자체가 이 기각이다.

### 2. `logRef: string` 단일 선택 — 기각

상한이 1이던 시점의 후보안. 순위·초과 개념이 사라지고 모델이 커밋하도록 강제된다는 장점이 있었다. 상한이 3으로 정해지면서 무의미해졌고, `logRefs.length`를 관측할 수 없어 임계값 보정 데이터가 안 쌓인다는 단점도 있었다.

### 3. `logRefs: [{ref, section}]` — 섹션까지 AI가 선택 — 기각

AI 의도와 일치하고 `notes`에 보조 증거를 둘 수 있다. 그러나 BYOK는 스키마가 무력해서(`json_object`만 강제) 중첩 구조는 파싱 실패·잘못된 섹션명 분기를 늘린다. 그리고 섹션 계약상 raw 증거의 자리는 `description`뿐이다(PRD 결정 3). **드문 케이스 하나와 상시 파싱 위험을 맞바꾸지 않는다.**

### 4. 상한 초과 시 top-1만 취함 — 기각

`logRefs[0]`을 관련도 1순위로 보고 하나만 삽입. 절벽이 없고 정답 케이스를 처벌하지 않는다. 그러나 **"관련도순 정렬"이라는 소프트 지시에 의존**하고(모델이 그렇게 준다는 보장 없음), "AI가 후보 10개 중 5개를 나열했다"는 명백한 선별 실패 신호를 무시하고 뭐라도 넣는다. 절벽을 4에 두면 정당한 복수 증거(2~3개) 구간을 비켜가면서 나열만 잡고, **순위 의존이 설계에서 사라진다**(3개 이하는 전부 삽입하므로 순서 무의미).

### 5. rich만 적용 — 기각

compact(nano) 비용을 아끼고 few-shot을 안 건드려도 된다. 그러나 nano가 스택 트레이스를 지어낼 위험이 가장 큰 모델이라 가드가 가장 필요한 곳에 없게 되고, 같은 캡처가 프로바이더에 따라 다른 본문을 낸다. 비용은 10,000자 중 ~90자다.

### 6. 삽입 블록에 마커를 심어 로그 블록만 보존 — 기각

`code-block-collapse` PRD의 "결정된 전제 1·2"가 이미 기각했다. 마커를 넣으려면 마크다운이 바뀌고 그 마크다운은 `buildIssueHtml()`을 타고 **클립보드 복사 본문과 8개 트래커로 샌다.** 출처를 안 가리고 전부 보존하는 게 유일하게 안전하다.

## 위험 요소

### 1. ⚠ `stripPreservedContent`로의 기준 교체가 회귀 지뢰

코드블럭을 이미지처럼 hoist하기 시작하면 **"원문 있음" 판정 기준도 코드블럭을 빼야 한다.** 안 그러면 코드블럭만 있고 산문이 없는 섹션이 "절삭된 원문"으로 오인돼 AI 본문이 통째로 버려진다 — `mergeAiDraftSections.ts:13-16` 주석이 이미지에 대해 정확히 경고하는 그 함정이다.

`stripInlineImageRefs`를 `stripPreservedContent`로 바꿔야 하는 곳 **5군데, 전부**:
`draftRich.ts:145` · `draftCompact.ts:102` · `promptBudget.ts:40`(`selectionOf`) · `promptBudget.ts:53`(`contentfulSectionsOf`) · `mergeAiDraftSections.ts:32`

하나라도 빠지면 기준이 갈리고, 그 틈에서 사용자 텍스트가 소리 없이 삭제된다.

**부수 효과(의도됨)**: 사용자가 첨부한 로그 전문이 `existingDraft`에서 빠져 프롬프트가 가벼워진다. AI가 그 로그를 못 보게 되지만 **같은 정보가 후보 목록(`[c1] TypeError: …`)으로 이미 도착**하므로 실질 손실이 없다. 오히려 compact의 `existingDraftChars = 400`을 16KB 블록이 잡아먹던 문제가 사라진다.

### 2. 누적 중복

run 1에서 AI가 `c1` 블록을 넣는다 → run 2에서 그 블록이 `prev`에 있어 보존되고, AI가 `c1`을 또 지목하면 **같은 블록이 2개**가 된다. 재생성할수록 늘어난다.

방어: `appendLogBlocks`가 섹션 내 기존 블록과 **동일 텍스트**면 새 블록을 스킵한다. 직렬화가 같은 store 데이터에서 결정론적이므로 같은 로그 → 같은 텍스트가 보장된다. **이건 반드시 테스트로 박는다** — 유닛으로 잡히는데 놓치면 사용자가 재생성을 반복하며 발견한다.

### 3. `code-block-collapse` 미구현 상태로 선행 배포

이 feature가 먼저 나가면 AI가 넣은 16KB 블록이 접히지 않는다. "전문 유지" 결정의 전제가 collapse다. **구현·배포 순서에서 collapse를 선행시킨다.**

### 4. 요약 타입 변경의 폭

`topErrors: string[]` → `ConsoleLogSummaryError[]`는 TS가 전 소비자를 잡아준다(실제 파괴는 2파일 + 테스트 리터럴). `ref`/`id`가 `buildEditorCapture.ts:43` → `buildMarkdownContext.ts:45`를 타고 `MarkdownContext`로 흘러가지만 **어떤 빌더도 item 필드를 읽지 않으므로** 이슈 본문·`logs.html`에 아무것도 새지 않는다. 성공 기준 7이 이걸 회귀 테스트로 고정한다.

**`topErrorRefs[]` 같은 병렬 배열을 만들지 않는다** — 두 배열이 어긋나는 게 이 설계가 막으려는 바로 그 버그다.

### 5. 페이지가 후보 태그를 위조

악성 페이지가 console에 `[n2] ...`를 찍어도 `oneLine()`(`context.ts:5`)이 프롬프트 **줄** 위조를 막고 `firstLine()`이 120자로 자른다. 최악은 **실재하지만 틀린 로그**가 삽입되는 것이다 — 내용 환각이 아니므로 id-only 불변식은 유지된다. 코드에 한 줄 주석으로 남긴다.

### 6. 스냅샷 규칙

`AiDraftDialog.tsx:88-89`가 이미 `store.networkLog`/`store.consoleLog`를 await 이전에 지역 변수로 잡는다. **그 참조를 `renderLogRefs`에 넘긴다.** 느린 BYOK 왕복 뒤에 store를 다시 읽으면 네비게이션 `logClear`에 걸려 블록이 전부 조용히 사라진다.

### 7. 관측 불가한 조용한 경로

`description` 원문이 `existingDraftChars`를 넘겨 프롬프트에서 빠지면 merge가 prev를 살리며 **AI 본문과 우리 블록을 같이 버린다.** 기존 `aiDraft.contextTrimmed` 토스트(`AiDraftDialog.tsx:186`)가 이미 뜨는 경우라 사용자가 침묵 속에 남지는 않는다. 새 토스트를 만들지 않는다.
