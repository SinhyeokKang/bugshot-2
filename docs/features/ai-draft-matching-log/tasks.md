# AI 초안 — 성공(200) 로그 매칭 증거 — 구현 태스크

## 선행 조건

- 신규 의존성 없음(기존 `requestMatchesQuery` 재사용, 새 pnpm 패키지 불필요 → `minimumReleaseAge` 정책 무관).
- 권한·env·OAuth·외부 API 변경 없음.
- **문서 영향 사전 인지**: `docs/privacy.{ko,en}.md`가 응답 본문 파생물(shape 다이제스트)의 LLM 전송을 반영해야 할 수 있음 → 구현 후 `/push` 신선도 검사 또는 `/doc-check`에서 대조.

## 태스크

### Task 1: `tokenizeUserQuery` (신규 순수 함수)
- **변경 대상**: `src/sidepanel/lib/prompts/queryTokens.ts` (+ `__tests__/queryTokens.test.ts`)
- **작업 내용**: `QueryTier`·`QueryTerm` 타입, `tokenizeUserQuery(sources: string[]): QueryTerm[]`. 3-tier 추출(quoted → ident → word, 앞 tier 추출분은 마스킹 후 다음 tier), `MIN_TERM_LEN=3`(quoted·숫자포함 예외), 소문자화, dedup, `MAX_QUERY_TERMS=20` 캡.
- **검증**:
  - [ ] quoted `"ORD-4821"` 추출, tier=quoted
  - [ ] ident 보존: `/api/v2/orders`, `ORD-4821`, `orderStatus`, `NullPointerException` 각각 통짜 term
  - [ ] `주문`·`the` 등 word tier로 분류(폐기 안 함), 2자 이하 폐기
  - [ ] 소문자 정규화 + 중복 term 제거 + distinct 20개 캡
  - [ ] 빈/공백 소스 → `[]`

### Task 2: `digestResponseShape` (신규 순수 함수)
- **변경 대상**: `src/sidepanel/lib/prompts/responseDigest.ts` (+ `__tests__/responseDigest.test.ts`)
- **작업 내용**: `digestResponseShape(body, contentType): string | undefined`. json contentType + string body만 처리. 최상위 객체 → `{key:type ...}`(type ∈ str/num/bool/null/obj/arr[N]), 최상위 배열 → `arr[N]`. **값 제외**, 키 개수·다이제스트 문자열 길이 캡, depth 1(중첩은 obj/arr[N]로 축약).
- **검증**:
  - [ ] `{"items":[],"total":0,"order_status":"SHIPPED"}` → `{items:arr[0] total:num order_status:str}` (값 없음)
  - [ ] `{"coupon":null}` → `null` 타입 표기
  - [ ] 중첩 객체/배열 → `obj`/`arr[N]` 축약
  - [ ] 마스킹된 json(`{"token":"***"}`) → 파싱 성공, 타입 str
  - [ ] 비-json contentType / `{kind:"binary"|"truncated"|"stream"|"omitted"}` / 파싱 실패 → `undefined`
  - [ ] 출력에 어떤 응답 **값도** 등장하지 않음(값 부재 단정)

### Task 3: `selectMatchedLogCandidates` + `MatchedLogCandidate`
- **변경 대상**: `src/sidepanel/lib/prompts/logCandidates.ts` (+ `__tests__/logCandidates.test.ts` 확장)
- **작업 내용**: `MatchedLogCandidate` 타입, `selectMatchedLogCandidates(terms, requests, excludeIds, cap)`. 모집단 필터(`!webSocket && phase==="complete" && !excludeIds`), term별 `requestMatchesQuery` 매칭 + `OVERMATCH_CEIL=8` 초과 term 폐기, id union·집계, 랭킹(tier > distinct term 히트 수 > startTime), 상위 cap개 `m1..` ref + `digestResponseShape` 부착.
- **검증**:
  - [ ] 콘솔 에러 term `orderStatus`가 200 응답 본문에 매칭 → 후보 1개, matchedTerm=`orderStatus`
  - [ ] `OVERMATCH_CEIL` 초과 term은 후보에 기여 안 함
  - [ ] `excludeIds`·WebSocket·비-complete 요청 제외
  - [ ] 랭킹: 다중 term 히트·최신 요청 우선, 상위 cap개만
  - [ ] ref `m1..` 연속·유일, digest 부착(json)·미부착(non-json)

### Task 4: `selectLogCandidates` 확장 + refs/find/canRequest
- **변경 대상**: `src/sidepanel/lib/prompts/logCandidates.ts` (+ 테스트 확장)
- **작업 내용**: `LogCandidates.matched` 추가. `selectLogCandidates`가 `promptStyle==="rich"` + `supportsConsoleNetworkLog` + `ctx.requests?.length`일 때만 토큰화 소스 결합 → `tokenizeUserQuery` → `selectMatchedLogCandidates`(excludeIds=network 후보 id) 호출. `candidateRefs`(matched 포함)·`findCandidate`(`m*`→network, 대소문자 무시)·`canRequestLogRefs`(matched 개수 포함) 확장.
- **검증**:
  - [ ] rich + requests 존재 → matched 채워짐 / compact → `matched: []`
  - [ ] `ctx.requests` 없음 → `matched: []`
  - [ ] excludeIds가 network 에러 후보 id로 구성돼 중복 인쇄 방지
  - [ ] `candidateRefs`에 `m*` 포함, `findCandidate("M1")` → network kind
  - [ ] `canRequestLogRefs`가 matched만 있어도 true(description 활성 시)

### Task 5: 컨텍스트 배선 + 예산 트리밍
- **변경 대상**: `src/sidepanel/lib/buildAiDraftPrompt.ts`, `src/sidepanel/lib/prompts/promptBudget.ts`, `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**: `AiDraftSessionContext`에 `requests?: NetworkRequest[]`. `trimDraftContext` level ≥ 1에 `delete out.requests`. `AiDraftDialog` ctx 조립에 `requests: includeCnLog && networkLog?.requests?.length ? networkLog.requests : undefined`.
- **검증**:
  - [ ] `trimDraftContext(ctx, 1)`가 `requests` 삭제 (단위 테스트)
  - [ ] `pnpm typecheck` 통과
  - [ ] AiDraftDialog가 요약과 별개로 full requests를 ctx에 전달

### Task 6: rich 프롬프트 매칭 섹션
- **변경 대상**: `src/sidepanel/lib/prompts/draftRich.ts`
- **작업 내용**: `cand.matched.length > 0`이면 "Possibly related requests (may look OK but could be the cause)" 섹션 인쇄. 줄: `[m1] GET /path → 200 · {digest} (matched "term")`(digest 없으면 생략). logRefs 지시문이 `m*`도 인용 대상임을 포함하도록 문구 조정. compact(`draftCompact.ts`)은 `matched` 미인쇄(변경 없음 확인).
- **검증**:
  - [ ] matched 있으면 rich 프롬프트에 섹션·`m1` 줄·digest 포함(문자열 단정)
  - [ ] compact 프롬프트엔 matched 미등장
  - [ ] `renderLogRefBlocks(["m1"], {candidates, requests, entries})`가 원문 코드블럭 반환(roundtrip 테스트)

## 테스트 계획

- **단위 테스트**(node `*.test.ts`):
  - `queryTokens.test.ts` — Task 1 검증 항목(추출·보존·필터·캡).
  - `responseDigest.test.ts` — Task 2 검증 항목(타입 매핑·값 부재·폴백).
  - `logCandidates.test.ts`(확장) — Task 3·4 검증 항목(매칭·랭킹·ceiling·rich게이트·ref·find/refs/canRequest).
  - `promptBudget` 트리밍 — `requests` level-1 삭제.
  - `draftRich`/`renderLogRefs` roundtrip — matched 인쇄 + `m*` → 원문 삽입.
- **e2e 시나리오**: 없음(자동화 부적합 — 매칭·다이제스트는 순수 함수 단위로 완결되고, 전체 경로는 실제 BYOK LLM 응답에 의존해 비결정적). e2e 영향: 없음(신규 UI·testid 없음).
- **수동 테스트**(Chrome):
  - [ ] 200 + `{items:[]}` 반환하고 콘솔에 해당 필드 언급 에러가 나는 실페이지에서 캡처 → 순수 한글 한 줄 입력 → AI 초안. 매칭된 200이 인용·원문 삽입되는지.
  - [ ] over-match term(흔한 `api` 등)만 있는 입력 → 매칭 후보가 노이즈로 안 뜨는지.
  - [ ] compact 프로바이더(Chrome Built-in nano) → 동작이 기존과 동일한지.

## 구현 순서 권장

- **Task 1, Task 2 병렬**(상호 독립 순수 함수).
- **Task 3**은 Task 1·2 타입 완성 후.
- **Task 4**는 Task 3 후.
- **Task 5, Task 6 병렬**(Task 4 후 — 배선과 인쇄는 독립).
- 마지막에 `pnpm typecheck` + `pnpm test`.

## 가이드 영향

사용자 노출 동작 변경(AI 초안이 에러가 아닌 정상 응답도 원인으로 인용·삽입) → `guide/ko`·`guide/en`의 AI 초안 설명 페이지를 대조·갱신 대상으로 표시. 정확한 페이지·문구는 `guide/AUTHORING.md` 규칙에 따라 구현 후 `/guide`로 처리한다.
- AI 초안/자동 작성 설명 페이지(ko·en) — "관련 있는 정상(200) 응답도 근거 로그로 인용될 수 있음" 취지 반영.
- 별개로 `docs/privacy.{ko,en}.md` — 응답 shape(키·타입, 값 제외)가 유저 선택 LLM으로 전송됨을 대조·갱신(가이드 아님, `/push`·`/doc-check` 경로).
