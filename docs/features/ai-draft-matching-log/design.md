# AI 초안 — 성공(200) 로그 매칭 증거 — 기술 설계

## 개요

AI 초안의 후보 단일 출처인 `selectLogCandidates(ctx)`에 세 번째 배열 `matched`를 추가한다. 매칭 후보는 (1) 유저·캡처 컨텍스트를 term으로 쪼갠 뒤(`tokenizeUserQuery`), (2) 그 term들로 full `NetworkRequest[]`를 `requestMatchesQuery`로 exact 매칭하고, (3) 에러 후보와 dedup·랭킹·캡한 결과다. 매칭 후보는 `m1..` ref를 받아 기존 refs·schema enum·`renderLogRefBlocks` 배관에 그대로 편입되므로 삽입 경로는 신규 코드가 없다. rich 프롬프트만 매칭 섹션을 인쇄하고, 각 후보 줄에 응답의 shape 다이제스트(키·타입, 값 제외)를 붙인다. 검색 타깃인 full requests를 프롬프트 컨텍스트에 새로 배선하는 것이 유일한 구조 변경이다.

## 변경 범위

### 신규 파일

- **`src/sidepanel/lib/prompts/queryTokens.ts`** — 유저·캡처 텍스트를 검색 term으로 쪼개는 순수 함수. 3-tier 추출(quoted/ident/word) + 필터 + 캡.
- **`src/sidepanel/lib/prompts/responseDigest.ts`** — 응답 본문의 shape 다이제스트(키·타입·길이, 값 제외) 순수 함수.
- 각 신규 파일의 `__tests__/*.test.ts` (node 트랙).

### 변경 파일

- **`src/sidepanel/lib/prompts/logCandidates.ts`**
  - 현재 역할: 프롬프트 인쇄·schema enum·응답 해석의 후보 단일 출처(`network`/`console`).
  - 변경: `LogCandidates`에 `matched: MatchedLogCandidate[]` 추가. `selectLogCandidates`가 `promptStyle==="rich"` + `ctx.requests` 존재 시 `selectMatchedLogCandidates`를 호출해 채운다. `MatchedLogCandidate` 타입, `selectMatchedLogCandidates` 함수 추가. `candidateRefs`(matched ref 포함)·`findCandidate`(`m*` → network)·`canRequestLogRefs`(matched 개수 포함) 확장.

- **`src/sidepanel/lib/buildAiDraftPrompt.ts`**
  - 현재 역할: `AiDraftSessionContext` 정의 + 프롬프트/스키마/few-shot 오케스트레이션.
  - 변경: `AiDraftSessionContext`에 `requests?: NetworkRequest[]` 추가(검색 타깃, 본문 포함 full).

- **`src/sidepanel/lib/prompts/promptBudget.ts`**
  - 현재 역할: `trimDraftContext`가 예산 초과 시 손실 작은 것부터 트리밍.
  - 변경: level ≥ 1 브랜치에 `delete out.requests` 추가(로그와 동일 취급 — 매칭 후보도 함께 소멸).

- **`src/sidepanel/lib/prompts/draftRich.ts`**
  - 현재 역할: rich 프롬프트 본문 구성.
  - 변경: `cand.matched.length > 0`이면 "Possibly related requests" 섹션 인쇄. 줄 포맷 `[m1] GET /path → 200 · {digest} (matched "term")`. logRefs 지시문에 `m*`도 인용 대상임을 반영.

- **`src/sidepanel/tabs/AiDraftDialog.tsx`**
  - 현재 역할: ctx 조립 + 프롬프트 실행 + logRefs 렌더.
  - 변경: ctx에 `requests: includeCnLog && networkLog?.requests?.length ? networkLog.requests : undefined` 추가(이미 로컬 변수 `networkLog` 보유, 227줄 렌더에서 사용 중).

- **`src/sidepanel/lib/prompts/draftCompact.ts`** — 변경 없음(compact은 매칭 미지원, `cand.matched` 무시). 명시적으로 인쇄 안 함.

- **`src/sidepanel/lib/renderLogRefs.ts`** — 변경 없음. `findCandidate`가 `m*`를 network kind로 되짚고 `src.requests`에서 id 매칭 → `serializeNetworkRequest`(원문 삽입)까지 자동. **회귀 확인만** 필요(별도 코드 없음).

## 데이터 흐름

```
AiDraftDialog.handleSubmit
  networkLog.requests ─────────────┐ (신규 배선)
  ctx = { ...요약, requests }       │
        │                          │
  fitDraftContext(ctx) ── level≥1 → requests 삭제(트리밍)
        │ fitted.ctx
        ▼
  selectLogCandidates(fitted.ctx)
        ├─ network/console  (기존: 요약 → 캡·ref n*/c*)
        └─ matched (rich only):
              tokenizeUserQuery([userPrompt, existingDraft, consoleTopErrors,
                                 actionSummary, selector, tagName])
                  → QueryTerm[]
              selectMatchedLogCandidates(terms, fitted.ctx.requests,
                                         excludeIds=network후보 id, cap=3)
                  → per-term requestMatchesQuery → union → over-match 폐기
                    → exclude(에러후보·WS·비-complete) → rank → cap → m* ref
                    → digestResponseShape(responseBody) 부착
        │
        ▼
  candidateRefs(cand) → schema enum (n*,c*,m*)
  draftRich 프롬프트에 matched 섹션 인쇄
        │  모델 응답 logRefs:["m1"]
        ▼
  renderLogRefBlocks(logRefs, {candidates, requests, entries})
        findCandidate("m1") → {id, kind:"network"}
        requests.find(id) → serializeNetworkRequest → 원문 코드블럭
```

## 인터페이스 설계

```ts
// prompts/queryTokens.ts
export type QueryTier = "quoted" | "ident" | "word";
export interface QueryTerm {
  term: string;   // 소문자 정규화
  tier: QueryTier;
}
// sources를 3-tier로 추출·정규화·dedup·캡. 랭킹은 selectMatchedLogCandidates가 tier로 함.
export function tokenizeUserQuery(sources: string[]): QueryTerm[];

// prompts/responseDigest.ts
// json 응답만 다이제스트. 최상위 키:타입(str/num/bool/null/obj/arr[N]) 나열, 값 제외.
// 비-json·omission 변종·파싱 실패 → undefined(호출부는 다이제스트 없이 provenance만 인쇄).
export function digestResponseShape(
  body: NetworkRequestBody | undefined,
  contentType: string,
): string | undefined;

// prompts/logCandidates.ts
export interface MatchedLogCandidate {
  ref: string;         // "m1"..
  id: string;          // 원본 NetworkRequest.id
  method: string;
  path: string;
  status: number;
  matchedTerm: string; // 인쇄용 provenance
  digest?: string;     // shape 다이제스트(없으면 provenance만)
}
export interface LogCandidates {
  network: NetworkLogCandidate[];
  console: ConsoleLogCandidate[];
  matched: MatchedLogCandidate[];   // 신규
}
export function selectMatchedLogCandidates(
  terms: QueryTerm[],
  requests: NetworkRequest[],
  excludeIds: Set<string>,   // 이미 인쇄되는 에러 후보 id
  cap: number,               // MATCHED_CAP = 3
): MatchedLogCandidate[];
```

상수(근거 없는 시작값 — dogfooding 조정): `MATCHED_CAP = 3`, `OVERMATCH_CEIL = 8`(term당 매칭 초과 시 폐기), `MAX_QUERY_TERMS = 20`, `MIN_TERM_LEN = 3`.

### 토큰화 규칙 (`tokenizeUserQuery`)

- **소스 결합**: `[userPrompt, existingDraft.title, ...existingDraft.sections values, ...consoleLogSummary.topErrors[].message, ...actionLogSummary, selector, tagName]` 중 존재하는 것.
- **추출 순서**(식별자 보존 — 순진한 split은 `ORD-4821`을 부순다):
  1. **quoted**: `"…"`/`'…'`/`` `…` `` 내부(2자+). 추출 후 원문에서 마스킹.
  2. **ident**: 경로(`/…`), 숫자 포함, camelCase, `_`·`-`·`.` 내부 구분, ALLCAPS(3자+), `*Error`/`*Exception`. 추출 후 마스킹.
  3. **word**: 잔여 `[\p{L}\p{N}]{3,}`.
- **필터**: `MIN_TERM_LEN` 미만 폐기(단 quoted·숫자 포함은 예외), 소문자화, dedup, distinct `MAX_QUERY_TERMS`개 캡.
- **불용어 사전 없음**: `MIN_TERM_LEN` + (매칭 단계의) `OVERMATCH_CEIL`이 대체. 진짜 불용어(`the`·`그리고`)는 영문 payload에 안 걸려 매칭 0으로 무해, 트래픽 절반에 걸리는 `api`류는 ceiling이 폐기.

### 매칭·랭킹 (`selectMatchedLogCandidates`)

1. 후보 모집단 = `requests.filter(r => !r.webSocket && r.phase === "complete" && !excludeIds.has(r.id))`.
2. 각 `QueryTerm`마다 모집단에 `requestMatchesQuery(r, term.term)` → 매칭 id 수집. term의 매칭이 `OVERMATCH_CEIL` 초과면 그 term 전체 폐기.
3. id로 union하며 요청별 (매칭된 최고 tier, 매칭된 distinct term 수, `startTime`) 집계.
4. 랭킹: tier(quoted > ident > word) → distinct term 히트 수 → `startTime` 내림차순.
5. 상위 `cap`개에 `m1..` ref 부여, `digestResponseShape(r.responseBody, r.contentType)` 부착, `matchedTerm`은 그 요청을 올린 최고-tier term.

## 기존 패턴 준수

- **후보 단일 출처 불변식**(`logCandidates.ts:24-27`): 프롬프트 인쇄·schema enum·응답 해석이 모두 `selectLogCandidates` 파생. `matched`도 이 함수 안에서 ref 부여 → 세 경로 자동 일치. 위조 `[m2]` 텍스트는 후보를 못 만들고 미지 ref는 `renderLogRefBlocks` 역참조에서 폐기(기존 방어선).
- **예산 트리밍 사다리**(`promptBudget.ts`): `requests`를 level-1 삭제에 편입 → 로그·매칭 후보가 한 덩어리로 트리밍. `selectLogCandidates(fitted.ctx)` 재실행이 트리밍 후 빈 매칭을 반환(결정론적).
- **마스킹**: `requestMatchesQuery`·다이제스트·삽입 전부 이미 마스킹된 본문(`maskBody`) 위에서 동작. 민감 키는 캡처 시점에 `***`.
- **테스트 우선**: 신규 순수 함수 3종은 `/tdd interface`로 시그니처를 테스트로 먼저 박고 구현.

## 대안 검토

1. **timeline-proximity 선별** — 캡처 순간 근처 200을 담기. exact-match의 리콜 구멍(순수 한글 입력 시 매칭 0)을 메우지만, anchor 시점 선정 + API 아닌 200 denoise가 필요해 휴리스틱을 재유입. 대신 **캡처신호(콘솔 에러·액션·selector)를 토큰 소스에 추가**해 exact 유지하며 리콜을 확보하는 쪽 채택.
2. **응답 본문 원문을 LLM에** — 다이제스트 대신 본문 전송. 컨텍스트 폭발 + 실제 값이 LLM으로 유출. 다이제스트는 5MB 응답도 ~100자로 축약(설계상 bounded)하고 값을 제외해 기각.
3. **provenance만, 다이제스트 없음** — LLM 본문 파생물 0으로 프라이버시 최상. 그러나 모델이 "empty vs present"를 못 갈라 상태매핑·데이터누락(타깃 케이스)에 무력. 키·타입만의 다이제스트가 균형점.
4. **compact도 지원** — 소형 모델은 "정상 200이 사실 버그"를 추론 못 하고 예산도 좁음. rich 전용.
5. **요약(`networkLogSummary`)으로 검색** — 요약엔 본문이 없어 매칭·다이제스트 불가. full `requests` 배선 불가피.

## 위험 요소

- **`MAX_LOG_REFS = 3` 공유 캡 회귀**(`renderLogRefs.ts:17`): 모델이 에러 ref + 매칭 ref 합쳐 3개 초과 반환하면 `renderLogRefBlocks`가 **전부 폐기** → 기존 에러 로그 삽입까지 사라질 수 있다. 완화: 프롬프트 지시("direct evidence만, empty가 정상") 유지 + `MATCHED_CAP=3`. 수동/e2e로 다중 인용 시 삽입 관찰. (캡 자체는 외과적 범위 밖 — 변경하지 않음.)
- **리콜 한계**: 캡처신호를 더해도 매칭은 여전히 literal 겹침에 의존. 콘솔·액션이 순수 한글이고 payload가 영문이면 여전히 빈다. PRD 비목표로 명시된 수용 한계.
- **프라이버시 신규 데이터 범주**: shape 다이제스트(키·타입, 값 제외)가 **응답 본문 파생물을 LLM으로 보내는 첫 케이스**. 유저 선택 provider 직행이라 무서버·데이터 직행 구조는 유지되나, `docs/privacy.{ko,en}.md`가 "본문은 안 나감"을 함의하면 대조·갱신 필요(값은 미전송이라는 사실 포함). ko/en·시행일 동시 갱신.
- **over-match 튜닝**: `OVERMATCH_CEIL=8`은 임의값. 낮으면 유효 term 손실, 높으면 노이즈. dogfooding 신호로 조정.
- **다이제스트 파싱 견고성**: 마스킹된 json은 valid(값만 `***`)라 파싱 OK. 하지만 truncated·非json·비정형 본문 다수 → `undefined` 폴백을 테스트로 잠근다(크래시·값 유출 없이).
