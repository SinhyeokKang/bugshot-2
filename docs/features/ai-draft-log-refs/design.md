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
| `src/sidepanel/lib/prompts/context.ts` | `selectDraftSections` 단일 출처 | 4번째 `strip` 인자 제거 — 내부에서 `stripPreservedContent` 고정 (위험 1의 "더 단순한 대안" **채택**) |
| `src/sidepanel/tabs/AiDraftDialog.tsx` | 전체 호출 흐름 | 후보/스키마/삽입 배선 (유일한 배선 지점) |

### 손대지 않는 것

- `logToCodeBlock.ts` — 직렬화는 그대로 재사용. **AI 경로 전용 캡을 두지 않는다**(PRD 비목표).
- `generateReproPrefill.ts` — `buildAiDraftSchema(["stepsToReproduce"])` 호출이 **byte-identical로 유지**돼야 한다. 새 인자가 optional인 이유.
- 이슈 본문 8개 빌더 — 요약 타입이 바뀌지만 전부 `errors.length`·`errorCount`·`warnCount`만 읽는다(grep 확인: `buildIssueMarkdown.ts:497/523`, `buildIssueAdf.ts:273` 등). item 필드를 읽는 곳은 `draftRich.ts:116`·`draftCompact.ts:77/79` 셋뿐.
- **`buildIssueAdf.ts:128`·`buildNotionIssueBody.ts:261`의 `stripInlineImageRefs` 호출 — 의도적 비대상.** 아래 위험 1 참조. 이 둘은 AI draft 경로가 아니라 **트래커 export 빌더**이고, `stripPreservedContent`로 바꾸면 **이미지가 있는 섹션의 코드블럭이 Notion·Jira 이슈 본문에서 통째로 삭제된다** — 이 feature의 목적과 정반대인 조용한 데이터 손실이다.
- `stripInlineImageRefs` 자체 — **rename이 아니라 `stripPreservedContent` 신규 추가**다. 기존 계약 테스트(`resolveInlineImages.test.ts:134-149`)가 살아 있어야 한다.

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
        │                   ★ 게이트: refs.length && parsed.sections.description?.trim()
        │                                          ↓  (게이트 미통과면 여기서 끝 — 삽입 없음)
        └────────────────────────→ renderLogRefBlocks(logRefs, {candidates, requests, entries})
                                              ↓  (후보 대조 · 미지 ref 스킵 · >3이면 전부 버림)
                                   appendLogBlocks(merged.description, blocks)
                                              ↓  (기존 블록과 동일 텍스트면 스킵)
                                          setDraft()
```

**최종 `description` 조립 순서**: `이미지…` → `AI 산문` → `사용자 기존 코드블럭…` → `새 AI 로그 블록…`

**`parsed.sections.description?.trim()` truthy 게이트가 필수인 이유**: AI가 그 키를 누락하면 merge는 prev(사용자 원문)를 살리는데(`mergeAiDraftSections.ts:41-44`), 게이트 없이 `appendLogBlocks`를 무조건 호출하면 **그 사용자 원문 위에 블록이 붙는다.** 그리고 키 존재(`in`) 판정이 아니라 **truthy 판정**이어야 하는 이유: AI가 빈 문자열을 반환하면 `in`은 통과해 산문 없이 블록만 붙는 기형 출력이 된다 — **빈 문자열은 키 누락과 동일한 "실패 신호"로 취급해 삽입도 막는다**(PRD 엣지 케이스 표). merge 경로는 둘이 다르지만(빈 문자열은 `:41`의 `!aiText && !(id in aiSections)` 가드를 안 탄다) 삽입 게이트에서 같은 결과로 수렴시킨다.

**절삭 결합**: 프롬프트·스키마·few-shot이 **전부 `fitted.ctx`에서 파생**되므로 `fitDraftContext`가 level≥1로 로그 요약을 지우면(`promptBudget.ts:18-21`) 셋이 동시에 `logRefs`를 잃는다. `AiDraftDialog.tsx:154`가 이미 `getDraftFewShot(fitted.ctx)`로 호출 중이라 few-shot은 발판이 있다.

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
// AiDraftSessionContext는 반드시 `import type`으로만 들여온다 — buildAiDraftPrompt.ts에서
// 값을 하나라도 import하면 순환이 된다(그 파일이 getDraftFewShot에서 이 모듈을 값 참조한다).
export function selectLogCandidates(ctx: AiDraftSessionContext): LogCandidates;

export function candidateRefs(c: LogCandidates): string[];
export function findCandidate(
  c: LogCandidates,
  ref: string,
): { id: string; kind: LogCandidateKind } | undefined;
```

**`ref`를 `buildLogSummary`가 아니라 여기서 부여하는 이유**: `buildLogSummary.MAX_ERRORS = 5`인데 `PROMPT_CAPS.compact.networkErrors = 3`(`PROMPT_CAPS.rich.networkErrors = 5`)이고 여기서 dedup까지 한다. 요약 단계에서 번호를 매기면 인쇄되는 목록이 `n1, n3, n4`처럼 비게 되고, 더 나쁘게는 **요약엔 있지만 인쇄되지 않은 `n5`가 실재하는 ref가 된다**. 필터·캡을 전부 통과한 뒤 부여해야 `ref` 집합 = 인쇄된 집합이 성립한다.

**dedup 키**: `method + path + status`. **후보** 게이트는 배열 길이로만 판정한다 — rich의 헤더 조건(`errorCount > 0 || warnCount > 0`, `draftRich.ts:114`)을 따라가면 warn만 있는 캡처에서 헤더는 찍히는데 `topErrors`는 비어 compact와 갈린다.

> ⚠ **이건 후보 게이트 얘기지 헤더 얘기가 아니다.** rich의 `- Console: N errors, M warnings` 헤더(`draftRich.ts:114`)는 **그대로 유지**한다 — warn-only 캡처에서 후보는 0이지만 "경고 N건"은 AI에게 여전히 유효한 정보다. 후보 순회로 교체하면서 헤더까지 같이 지우지 않도록 주의(tasks Task 3 검증 항목).

### `renderLogRefs.ts` (신규)

```ts
// 상한이자 "나열해버림" 임계값. 근거 없는 임의값 — 조정 신호는 실사용에서 안 쌓이고
// (D/B 구분 불가 + warn 로컬 전용) dogfooding만이 트리거다(PRD 결정 2 참조).
export const MAX_LOG_REFS = 3;

export interface LogRefSource {
  candidates: LogCandidates;    // 프롬프트에 인쇄된 집합. 요약을 직접 넘기면 안 된다
  requests: NetworkRequest[];   // 요약을 만든 것과 같은 store 스냅샷
  entries: ConsoleEntry[];
}

// 미지 ref 스킵 → 중복 ref 제거 → 유효 개수가 MAX_LOG_REFS 초과면 [] + console.warn.
// warn 프리픽스는 저장소 관례대로 `[bugshot] …` (generateReproPrefill.ts:59).
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
// 4칸 들여쓰므로(logToCodeBlock.ts:20-22) 내부 fence는 여기 안 걸린다.
export function extractCodeBlocks(markdown: string): string[];
export function stripCodeBlocks(markdown: string): string;

// 병합 시 보존되는 것(이미지 + 코드블럭)을 뺀 "사용자가 쓴 산문". 
// selectDraftSections와 merge가 공유하는 단일 기준.
export function stripPreservedContent(markdown: string): string;
```

**`.trim()` 계약을 반드시 상속한다.** `stripInlineImageRefs`가 `.replace(/\n{3,}/g, "\n\n").trim()`으로 끝나는 건(`resolveInlineImages.ts:82`) 장식이 아니라 계약이다 — `selectDraftSections`가 `.trim()` 없이 truthy로만 판정하기 때문이다(`context.ts:105-106`의 `const text = strip(…); if (!text) continue;`).

`stripPreservedContent`가 코드블럭을 지우고 `"\n\n"`를 남기면 → truthy → **빈 `description:` 줄이 프롬프트에 실리고 `includedIds`에 들어간다** → merge가 그 섹션을 "prompted"로 오인 → 보호 가드가 풀린다. 테스트에 **"코드블럭만 있는 섹션 → 빈 문자열"**을 박는다.

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
**`properties`의 타입 확장이 선행돼야 한다** — 현재 선언이 `const properties: Record<string, { type: "string" }>`(`buildAiDraftPrompt.ts:21`)라 위 조각은 **그대로는 컴파일되지 않는다.**
`minItems` 없음 → `[]`가 "관련 로그 없음"의 표현. `enum`은 nano의 구조적 가드다. BYOK는 경로별로 갈리지만 **어느 쪽도 구조적 강제가 아니다** — OpenAI-compat은 스키마를 버리고(`ai-provider.ts:385`), Anthropic은 `JSON.stringify(responseSchema)`를 system prompt에 텍스트 주입만 하며(`:509`), LOCAL_BYOK(loopback Ollama)는 compact 스타일인데도 OpenAI-compat 경로라 enum 미강제("compact = nano" 등식의 예외). 따라서 `renderLogRefs`의 후보 대조가 프로바이더 무관한 실질 방어선이다.

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

> 🔴 **기존 early-return 분기를 반드시 제거해야 한다.** 현재 코드에 위 한 줄로는 안 보이는 분기가 있다:
>
> ```ts
> // mergeAiDraftSections.ts:46-49
> if (images.length === 0) {
>   out[id] = aiText;      // ← prevCodeBlocks가 여기서 증발한다
>   continue;
> }
> ```
>
> **이미지 없이 코드블럭만 있는 섹션**이 정확히 이 feature의 주 시나리오(PRD 시나리오 C: 수동 삽입 → AI 재생성)다. 이 분기를 안 지우면 그 블록이 조용히 날아간다. 성공 기준 5가 잡아주지만, 설계에 안 적으면 구현자가 `images.length === 0` 경로를 그대로 둔다.

## 기존 패턴 준수

- **단일 출처 강제** — `selectDraftSections`(`prompts/context.ts:79`, 주석은 `:76-78`)가 확립한 패턴. 후보 집합에 그대로 적용한다.
- **`Record` 디스패치** — `DRAFT_BUILDERS`(`buildAiDraftPrompt.ts:93`)/`DRAFT_FEW_SHOT`(`:102`)이 `Record<PromptStyle, …>`인 건 새 스타일이 조용히 rich로 흘러가지 않게 하려는 것. few-shot 선택이 2차원(style × 후보유무)이 되지만 **style 축의 `Record`는 유지**하고 후보 유무를 그 위에 얹는다.
- **compact은 긍정형 지시 + few-shot** — 부정 지시("Do not X")는 소형 모델에서 역효과(`draftCompact.ts:12`). JSON 형식 규칙은 `responseConstraint`가 강제하므로 넣지 않는다. `logRefs` 지시는 **형식이 아니라 선별 의미**라 한 줄 추가가 정당하다.
- **인젝션 방어** — 후보 줄은 페이지 통제 문자열(console 메시지·URL)이라 기존 `oneLine()`·`firstLine()` 경로를 그대로 탄다. **다만 방어의 실체는 `oneLine`이 아니다** — 아래 위험 5 참조.
- **테스트 2트랙** — 전부 순수 함수라 `*.test.ts`(node) 트랙.
- **i18n 영향** — 새 사용자 노출 문자열이 **없다**(코드블럭은 로그 원문이다). 단, 상한 초과 폐기에는 **어떤 토스트도 뜨지 않는다** — 기존 `aiDraft.contextTrimmed`는 `fitted.level >= 1 || fitted.omittedSections.length > 0`(`AiDraftDialog.tsx:186`)일 때만 뜨는 **예산 절삭 전용**이고, `MAX_LOG_REFS` 초과는 `level === 0`에서도 발생한다. 문구("내용이 많아 일부 참고 정보를 빼고 작성했습니다")도 **입력** 절삭 설명이라 **산출물** 폐기에 재사용할 수 없다. 침묵은 의도된 결정이다(PRD 시나리오 D).

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

**"더 단순한 대안"을 채택한다 — `selectDraftSections`의 4번째 `strip` 인자를 제거한다.** 그 인자는 3개 호출처(`draftRich.ts:145` · `draftCompact.ts:102` · `promptBudget.ts:41`(`selectionOf`))에서 **항상 같은 값**이 들어가고 다른 소비자가 없다 — 요청된 적 없는 유연성이다(CLAUDE.md 작업 원칙). 인자를 제거하고 `selectDraftSections` **내부에서 `stripPreservedContent`를 고정**하면:

- 기준 교체 지점이 **5곳 → 3곳**으로 준다: `context.ts` 내부 고정 1곳 + 직접 교체 2곳(`promptBudget.ts:52`(`contentfulSectionsOf`) · `mergeAiDraftSections.ts:32`)
- "5곳 동기화" 위험 축이 **구조적으로** 사라진다 — 다음에 보존 대상이 또 늘어도 고칠 곳이 한 군데다
- `markdownBlocks.ts`는 정규식만 있는 leaf 모듈이라 `context.ts`가 import해도 순환이 없다

남는 직접 교체 2곳이 갈리면 여전히 사용자 텍스트가 소리 없이 삭제된다 — 테스트로 잡는다(tasks Task 6).

> 🔴 **`grep stripInlineImageRefs`는 7곳을 뱉는다 — export 빌더 2곳은 교체 금지다.**
>
> `buildIssueAdf.ts:128` · `buildNotionIssueBody.ts:261`
>
> 이 둘은 AI draft 경로가 아니라 **트래커 export 빌더**다. `sectionRefs.length > 0`일 때 이미지 ref를 지우고 그 자리에 image/placeholder 블록을 재삽입하는 경로이고, 여기를 `stripPreservedContent`로 바꾸면 **이미지가 있는 섹션의 코드블럭이 Notion·Jira 이슈 본문에서 통째로 삭제된다.** 사용자가 수동으로 넣은 로그가 트래커로 안 나가는 조용한 데이터 손실 — 이 feature의 목적과 정반대이고, 위가 경고하는 "기준이 갈리는 틈"을 export 쪽에서 여는 셈이다. (strip 인자 제거 후에도 이 2곳은 `stripInlineImageRefs` 직접 호출로 남는다 — 그게 맞다.)
>
> **`stripPreservedContent`는 rename이 아니라 신규 함수다.** `stripInlineImageRefs`는 그대로 남고 계약 테스트(`resolveInlineImages.test.ts:134-149`)도 그대로 green이어야 한다.

**부수 효과(의도됨, 단 손실 범위를 정확히)**: 사용자가 첨부한 코드블럭이 `existingDraft`에서 빠져 프롬프트가 가벼워진다. **에러 로그에 한해서는** 실질 손실이 없다 — 같은 정보가 후보 목록(`[c1] TypeError: …`)으로 이미 도착한다. 그러나 후보 풀은 **에러만**이고(PRD 비목표) 수동 삽입(`LogInsertDialog`)은 **전체 로그**를 받으므로, **비에러 블록은 프롬프트에서 완전히 소실된다** — 잘못된 payload를 담은 200 응답(흔한 버그 리포트 소재), 사용자가 직접 붙인 코드 스니펫이 그 축이다. AI가 그 정보를 못 본 채 산문을 쓴다는 손실을 **수용한다**(코드블럭은 보존돼 본문엔 남는다 — AI 참고에서만 빠진다). 대가로 compact의 `existingDraftChars = 400`을 16KB 블록이 잡아먹던 문제가 사라진다.

### 2. 누적 중복

run 1에서 AI가 `c1` 블록을 넣는다 → run 2에서 그 블록이 `prev`에 있어 보존되고, AI가 `c1`을 또 지목하면 **같은 블록이 2개**가 된다. 재생성할수록 늘어난다.

방어: `appendLogBlocks`가 섹션 내 기존 블록과 **동일 텍스트**면 새 블록을 스킵한다. 직렬화가 같은 store 데이터에서 결정론적이므로 같은 로그 → 같은 텍스트가 보장된다. **이건 반드시 테스트로 박는다** — 유닛으로 잡히는데 놓치면 사용자가 재생성을 반복하며 발견한다.

> ⚠ **유닛만으로는 이 방어가 증명되지 않는다.** `prev`에 있는 블록은 Tiptap 노드 → `tiptap-markdown` 직렬화를 거친 것이고 새 블록은 `codeBlockMarkdown`이 직접 만든 문자열이라, **fence 생성 주체가 다르다.** `codeBlockMarkdown` 출력끼리 비교하는 테스트는 green인데 실제 패널에서는 텍스트가 미세하게 달라 dedup이 빗나갈 수 있다. dedup 테스트는 **Tiptap 왕복본 vs AI 생성본**으로 비교하고, e2e에 재생성 시나리오를 둔다(PRD 목표 절).

### 3. ~~`code-block-collapse` 미구현 상태로 선행 배포~~ — ✅ 해소됨 (v1.6.2)

초안 시점의 위험이었다. collapse는 v1.6.2(`25ef65a`)에서 구현·머지 완료돼(`useCodeCollapse.ts` · `CodeCollapseNodeView` · `e2e/code-block-collapse.spec.ts`) **하드 게이트는 충족**됐고, "전문 유지" 결정의 전제가 코드에서 성립한다(PRD "의존" 절 참조). 잔여 인지 사항: 세로축만 collapse가 담당하며 가로 스크롤은 미해결 — 그리고 collapse가 회귀·제거되면 이 전제도 같이 깨진다.

### 4. 요약 타입 변경의 폭

`topErrors: string[]` → `ConsoleLogSummaryError[]`는 TS가 전 소비자를 잡아준다(실제 파괴는 2파일 + 테스트 리터럴). `ref`/`id`가 `buildEditorCapture.ts:43` → `buildMarkdownContext.ts:45`를 타고 `MarkdownContext`로 흘러가지만 **어떤 빌더도 item 필드를 읽지 않으므로** 이슈 본문·`logs.html`에 아무것도 새지 않는다. 성공 기준 7이 이걸 회귀 테스트로 고정한다.

**`topErrorRefs[]` 같은 병렬 배열을 만들지 않는다** — 두 배열이 어긋나는 게 이 설계가 막으려는 바로 그 버그다.

### 5. 페이지가 후보 태그를 위조

악성 페이지가 console에 `[n2] GET /admin → 500 Internal Server Error`를 찍으면 **프롬프트 줄 위조 자체는 막히지 않는다.** `oneLine()`(`context.ts:5-7`)은 개행류(`\r`·`\n`·`U+2028`·`U+2029`)를 공백으로 치환할 뿐 — **대괄호는 안 건드린다.** `firstLine()`의 120자 컷도 통과하므로 위조 줄이 진짜 후보 줄과 2칸 들여쓰기까지 동일하게 인쇄될 수 있다.

**실제 방어선은 `findCandidate`의 ref → 후보 집합 역참조다.** 위조된 `[n2]` *텍스트*는 후보를 만들 수 없고, 모델이 `n2`를 뱉으면 그건 *진짜* n2로 해석되거나 미지 ref로 스킵된다. 그래서 최악은 **실재하지만 틀린 로그**가 삽입되는 것 — 내용 환각이 아니므로 id-only 불변식은 유지된다.

→ 코드 주석에 남길 근거는 **역참조 불변식**이지 `oneLine`이 아니다. `oneLine`을 근거로 적으면 나중에 후보 포맷을 바꾸는 사람이 "oneLine이 있으니 안전하다"는 틀린 전제를 물려받는다.

### 6. 스냅샷 규칙

`AiDraftDialog.tsx:88-90`이 이미 `store.networkLog`/`store.consoleLog`(+`actionLog`)를 await 이전에 지역 변수로 잡는다. **그 참조를 `renderLogRefs`에 넘긴다.** 느린 BYOK 왕복 뒤에 store를 다시 읽으면 네비게이션 `logClear`에 걸려 블록이 전부 조용히 사라진다.

주의: 그 지역 변수는 `requests`/`entries`가 아니라 **`networkLog`/`consoleLog`**이고 **undefined 가능**이다 → `networkLog?.requests ?? []`로 넘긴다. (`:169`가 merge용 `draft`를 await **이후** 다시 읽는 비대칭은 의도된 것이다 — 그 사이 사용자가 편집했을 수 있다. 건드리지 않는다.)

PRD 엣지 케이스 표대로 **네비게이션 후 응답 도착은 현재 도달 불가능한 상태**다(`drafting`에선 `logClear`가 no-op, 수동 클리어는 `aiLoading` 오버레이가 막는다). 이 규칙은 defense-in-depth로 고정한다.

### 7. 관측 불가한 조용한 경로

`description` 원문이 `existingDraftChars`를 넘겨 프롬프트에서 빠지면 merge가 prev를 살린다(`mergeAiDraftSections.ts:32-34`). **이때 블록은 버려지지 않는다** — `appendLogBlocks`가 그 prev 위에 블록을 붙인다. 후보는 `existingDraft`와 무관하게 로그에서 나오므로 AI의 `logRefs` 판단은 description 원문을 못 봤어도 유효하고, 삽입이 의도된 동작이다.

주의할 축 어긋남: `canInsertLogs = sectionIds.includes("description")`는 **enabled** 기준이고 merge의 보호 판정은 `fitted.includedSections`(**prompted**) 기준이다. rich는 `existingDraftChars = UNLIMITED`(`caps.ts:16`의 상수, 값은 `Number.MAX_SAFE_INTEGER` — `JSON.stringify(Infinity)`가 `"null"`이라)라 이 어긋남은 compact(400자)에서만 드러난다.

**상한 초과 폐기에는 어떤 토스트도 뜨지 않는다** — `aiDraft.contextTrimmed`는 예산 절삭 전용이라 `level === 0`인 폐기 경로에서는 발화하지 않는다. 새 토스트를 만들지 않기로 한 의도된 침묵이다(PRD 시나리오 D).

### 8. AI 초안 덮어쓰기에 undo 경로가 없다 (기존 결함, 이 feature가 증폭)

`setDraft: (draft) => set({ draft })`(`src/store/editor-store.ts:703`)는 히스토리를 안 남기고, Tiptap history는 살아 있으나 `setContent(displayMd, { emitUpdate: false })`(`src/sidepanel/components/TiptapEditor.tsx:512`)가 doc을 교체하므로 Ctrl+Z로 AI 이전 상태 복원이 보장되지 않는다. 대조군으로 AI 스타일링은 전체/행 단위 리셋이 완비돼 있다(`StyleChangesDialog.tsx:132-186`).

상한 초과로 블록이 안 붙은 사용자의 유일한 대응이 재생성인데(PRD 시나리오 D), **재생성이 본문을 또 덮어쓴다.** 여기에 위험 2(누적 중복)가 겹친다. 이 feature에서 해결하지 않되, 증폭 사실을 기록하고 **"AI 초안 undo/리셋"을 후속 feature 후보로 명시**해 둔다.

### 9. 접근성 — 자동 삽입 블록의 스크린리더 경험

수동 경로는 사용자가 `LogInsertDialog` 안에서 그 로그를 **이미 봤다**(`h-[80vh]` 다이얼로그 내부 스크롤로 — `components/LogInsertDialog.tsx:74`). AI 경로는 무엇이 얼마나 큰지 모른 채 결과를 받는다. 수백 줄짜리 `codeBlock`이 예고 없이 생기면 스크린리더·키보드 사용자에게 그 블록을 건너뛸 랜드마크가 없다. collapse는 이미 구현됐지만(`CodeCollapseNodeView` — `TiptapEditor.tsx:161/:279`) 접힘은 `overflow-y: hidden` **시각 처리**라 스크린리더는 여전히 전문을 읽는다 — 시각적 부피는 흡수해도 a11y 축은 별개로 남는다. 이 feature에서 해결하지 않는다. 원래 "collapse 구현 시 함께 볼 항목"으로 미뤘으나 그 시점은 이미 지나갔으므로, **별도 백로그 항목(코드블럭 a11y — 랜드마크/skip 처리)으로 귀속처를 재지정**한다.
