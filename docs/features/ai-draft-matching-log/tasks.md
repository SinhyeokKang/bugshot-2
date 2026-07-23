# AI 초안 — 성공(200) 로그 매칭 증거 — 구현 태스크

## 선행 조건

- 신규 의존성 없음(기존 `requestMatchesQuery` 재사용, 새 pnpm 패키지 불필요 → `minimumReleaseAge` 정책 무관).
- 권한·env·OAuth·외부 API 변경 없음.
- **문서 영향(필수)**: `docs/privacy.{ko,en}.md`가 삽입 네트워크 로그 본문은 "AI 프로바이더로 전송 안 됨"을 명시하는데 shape 다이제스트 전송과 직접 충돌 → **필수 갱신**(조건부 아님). ko/en 본문 + 상단 시행일 동시 갱신: 충돌 문장 교정 + LLM 전송 인벤토리에 "응답 shape 다이제스트(키 이름·타입, 값 제외)" 추가 + **키 이름은 마스킹 안 되고 그대로 전송됨** 명시. 구현 후 `/push`·`/doc-check` 경로에서 처리.

## 태스크

### Task 1: `tokenizeUserQuery` (신규 순수 함수)
- **변경 대상**: `src/sidepanel/lib/prompts/queryTokens.ts` (+ `__tests__/queryTokens.test.ts`)
- **작업 내용**: `QueryTier`·`QueryTerm` 타입, `tokenizeUserQuery(sources: string[]): QueryTerm[]`. 3-tier 추출(quoted → ident → word, 앞 tier 추출분은 마스킹 후 다음 tier), `MIN_TERM_LEN=3`(quoted·숫자포함 예외), 소문자화, dedup, `MAX_QUERY_TERMS=20` 캡.
- **검증**:
  - [ ] quoted `"ORD-4821"` 추출, tier=quoted
  - [ ] ident 보존: `/api/v2/orders`, `ORD-4821`, `orderStatus`, `NullPointerException` 각각 통짜 term
  - [ ] `주문서`(3자)·`the`(3자) 등 word tier로 분류(폐기 안 함), `주문`(2자)·2자 이하는 `MIN_TERM_LEN=3`으로 폐기 (※ quoted·숫자포함은 예외로 유지)
  - [ ] 소문자 정규화 + 중복 term 제거 + distinct 20개 캡
  - [ ] 빈/공백 소스 → `[]`
  - [ ] **빈 문자열 term을 절대 방출하지 않음**(단정). `requestMatchesQuery`는 빈 term에 `includes("")===true`로 전 요청 매칭하므로, tokenizer가 빈 term을 뱉으면 매칭이 오염된다 — 방출 부재를 잠근다.

### Task 2: `digestResponseShape` (신규 순수 함수)
- **변경 대상**: `src/sidepanel/lib/prompts/responseDigest.ts` (+ `__tests__/responseDigest.test.ts`)
- **작업 내용**: `digestResponseShape(body, contentType): string | undefined`. json contentType + string body만 처리. 최상위 객체 → `{key:type ...}`(type ∈ str/num/bool/null/obj/arr[N]), 최상위 배열 → `arr[N]`, **최상위 primitive(`true`/`123`/`"OK"`/`null`) → `undefined`**. **값 제외**, 키 개수·다이제스트 문자열 길이 캡, depth 1(중첩은 obj/arr[N]로 축약).
- **검증**:
  - [ ] `{"items":[],"total":0,"order_status":"SHIPPED"}` → `{items:arr[0] total:num order_status:str}` (값 없음)
  - [ ] `{"coupon":null}` → `null` 타입 표기
  - [ ] 중첩 객체/배열 → `obj`/`arr[N]` 축약
  - [ ] 마스킹된 json(`{"token":"***"}`) → 파싱 성공, 타입 str
  - [ ] 비-json contentType / `{kind:"binary"|"truncated"|"stream"|"omitted"}` / 파싱 실패 → `undefined`
  - [ ] **최상위 primitive(top-level `true`/`123`/`"OK"`) → `undefined`**
  - [ ] **대형 객체(수백 키) → 키 개수·문자열 길이 캡이 발동해 bounded 출력**(캡 초과분 절삭 단정 — "대량 데이터" 엣지)
  - [ ] 출력에 어떤 응답 **값도** 등장하지 않음(값 부재 단정). 키 이름은 등장함(마스킹 대상 아님 — 의도된 동작).

### Task 3: `selectMatchedLogCandidates` + `MatchedLogCandidate`
- **변경 대상**: `src/sidepanel/lib/prompts/logCandidates.ts` (+ `__tests__/logCandidates.test.ts` 확장)
- **작업 내용**: `MatchedLogCandidate` 타입, `selectMatchedLogCandidates(terms, requests, excludeIds, cap)`. 모집단 필터(`!webSocket && phase==="complete" && status 2xx(>=200 && <300) && !excludeIds`), term별 `requestMatchesQuery` 매칭 + `OVERMATCH_CEIL=8` 초과 term 폐기, id union·집계, 랭킹(tier > distinct term 히트 수 > startTime), 상위 cap개 `m1..` ref + `digestResponseShape` 부착. `path`는 `extractPath(r.url)` 파생. **빈 term(`term.term===""`)은 방어적 skip**(tokenizer가 안 뱉는 게 1차 방어, 여기가 2차).
- **검증**:
  - [ ] 콘솔 에러 term `orderStatus`가 200 응답 본문에 매칭 → 후보 1개, matchedTerm=`orderStatus`
  - [ ] `OVERMATCH_CEIL` 초과 term은 후보에 기여 안 함
  - [ ] `excludeIds`·WebSocket·비-complete·**비-2xx(4xx/5xx/3xx)** 요청 제외
  - [ ] 랭킹: 다중 term 히트·최신 요청 우선, 상위 cap개만
  - [ ] ref `m1..` 연속·유일, digest 부착(json)·미부착(non-json)
  - [ ] `terms=[]`(빈 배열) → `[]` 조기 반환
  - [ ] 빈 term이 섞여 들어와도 전 요청 오매칭 없이 skip
  - [ ] `path`가 `r.url`에서 파생됨(`NetworkRequest`에 `path` 필드 없음 — malformed URL 폴백은 extractPath 규칙)

### Task 4: `AiDraftSessionContext.requests` 필드 + `selectLogCandidates` 확장 + refs/find/canRequest
- **변경 대상**: `src/sidepanel/lib/buildAiDraftPrompt.ts`(필드 정의), `src/sidepanel/lib/prompts/logCandidates.ts` (+ 테스트 확장)
- **선(先)작업(ORDER)**: `AiDraftSessionContext`에 `requests?: NetworkRequest[]` 필드를 **여기서 먼저 추가**한다. Task 4가 `ctx.requests?.length`를 읽으므로 필드 정의가 이 태스크(또는 그 앞)에 있어야 typecheck가 통과한다 — 필드 추가를 Task 5에 두면 `Property 'requests' does not exist` 컴파일 에러(QA 지적).
- **작업 내용**: `LogCandidates.matched` 추가. `selectLogCandidates`가 rich 스타일(`ctx.caps.promptStyle==="rich"` — 신규 게이트) + `supportsConsoleNetworkLog` + `ctx.requests?.length`일 때만 토큰화 소스 결합 → `tokenizeUserQuery` → `selectMatchedLogCandidates`(excludeIds=network 후보 id) 호출. `candidateRefs`(matched 포함)·`findCandidate`(`m*`→network, 대소문자 무시)·`canRequestLogRefs`(matched 개수 포함) 확장.
- **검증**:
  - [ ] rich + requests 존재 → matched 채워짐 / compact → `matched: []`
  - [ ] `ctx.requests` 없음 → `matched: []`
  - [ ] excludeIds가 network 에러 후보 id로 구성돼 중복 인쇄 방지
  - [ ] `candidateRefs`에 `m*` 포함, `findCandidate("M1")` → network kind
  - [ ] `canRequestLogRefs`가 matched만 있어도 true(description 활성 시)

### Task 5: 컨텍스트 배선 + 예산 트리밍
- **변경 대상**: `src/sidepanel/lib/prompts/promptBudget.ts`, `src/sidepanel/tabs/AiDraftDialog.tsx` (필드 정의는 Task 4에서 완료)
- **작업 내용**: `trimDraftContext` level ≥ 1에 `delete out.requests`. `AiDraftDialog` ctx 조립에 `requests: includeCnLog && networkLog?.requests?.length ? networkLog.requests : undefined`(226줄 렌더에서 쓰는 로컬 `networkLog` 재사용).
- **검증**:
  - [ ] `trimDraftContext(ctx, 1)`가 `requests` 삭제 (단위 테스트)
  - [ ] `pnpm typecheck` 통과
  - [ ] AiDraftDialog가 요약과 별개로 full requests를 ctx에 전달

### Task 5b: `renderLogRefs` 공유 캡 회귀 수정 (CAP)
- **변경 대상**: `src/sidepanel/lib/renderLogRefs.ts` (+ `__tests__` 확장)
- **작업 내용**: `resolved.length > MAX_LOG_REFS`에서 `return []` → **상위 `MAX_LOG_REFS`개 `slice`**. `resolved`가 모델 반환 순서라 slice 전에 **에러 ref(`n*`/`c*`)를 매칭 ref(`m*`)보다 앞으로 안정 정렬**(`ref.startsWith("m")` 판별)해 에러 로그가 항상 생존하게 한다. warn 로그는 유지.
- **검증**:
  - [ ] `["n1","n2","m1","m2"]`(4개) → 3블록 반환, **에러 우선**(n1·n2·m1 생존, m2 절삭) — 기존 `return []`(전멸) 회귀 방어 고정
  - [ ] `["m1","n1"]` → 정렬 후 n1이 m1 앞
  - [ ] 3개 이하 → 순서·개수 기존과 동일(무회귀)

### Task 6: rich 프롬프트 매칭 섹션
- **변경 대상**: `src/sidepanel/lib/prompts/draftRich.ts`
- **작업 내용**: `cand.matched.length > 0`이면 "Possibly related requests (may look OK but could be the cause)" 섹션 인쇄. 줄: `[m1] GET /path → 200 · {digest} (matched "term")`(digest 없으면 생략). logRefs 지시문이 `m*`도 인용 대상임을 포함하도록 문구 조정. **추가로 지시문에 "인용한 각 `m*`는 반드시 description 산문에서 왜 원인인지 설명하라"를 잠금**(LABEL) — `serializeNetworkRequest`가 `→ 200 OK`를 라벨 없이 렌더해 200 블록이 "정상"으로 읽히므로 산문 설명이 유일한 맥락 전달 수단. compact(`draftCompact.ts`)은 `matched` 미인쇄(변경 없음 확인).
- **검증**:
  - [ ] matched 있으면 rich 프롬프트에 섹션·`m1` 줄·digest 포함(문자열 단정)
  - [ ] **rich 지시문에 "각 m*를 산문에서 설명" 요구 문구가 포함됨(문자열 단정)**
  - [ ] compact 프롬프트엔 matched 미등장
  - [ ] `renderLogRefBlocks(["m1"], {candidates, requests, entries})`가 원문 코드블럭 반환(roundtrip 테스트)

## 테스트 계획

**테스트 비중이 이 기능의 안전망 전부다.** 신규 UI·testid가 없고 전체 경로가 LLM 응답에 얽혀 **수동 테스트가 매우 제한적**이므로, 결정론적 경계를 유닛 + e2e로 최대한 덮는다. 비결정적인 건 오직 LLM의 "판단"뿐이고, e2e는 그 판단을 **BYOK 목**으로 대체해 나머지 전 구간을 결정론화한다.

파이프라인과 커버 지점:
```
로그 포함(시딩) > 유저 입력(fill) > AI 초안 요청(submit)
  > 전송할 데이터 결정 ─ [E2E 단정] 목 route가 postData 읽어 매칭 섹션·digest 검증
  > LLM 전송(목 가로챔) > LLM 응답(고정) > 파싱 후 패널 입력 ─ [E2E 단정] m* 원문 삽입
```

- **단위 테스트**(node `*.test.ts`):
  - `queryTokens.test.ts` — Task 1(추출·보존·필터·캡·빈 term 미방출).
  - `responseDigest.test.ts` — Task 2(타입 매핑·값 부재·키명 존재·최상위 primitive→undefined·대형 객체 캡·폴백).
  - `logCandidates.test.ts`(확장) — Task 3·4(매칭·랭킹·ceiling·status 2xx 필터·rich게이트·terms=[]·ref·find/refs/canRequest).
  - `promptBudget` 트리밍 — `requests` level-1 삭제.
  - `renderLogRefs`(확장, Task 5b) — **`["n1","n2","m1","m2"]→3블록(에러 우선)` CAP 회귀 고정** + 3개 이하 무회귀.
  - `draftRich` — matched 섹션·digest·"각 m* 산문 설명" 지시문 인쇄, compact 미인쇄.
- **e2e 시나리오**(있음 — `ai-draft-log-refs.spec.ts` 패턴 확장. BYOK 목 route + 가변 mockDraft + 후보 로그 결정론 시딩이 이미 확립):
  - **E2E-1(전송할 데이터 결정 + 삽입)**: 콘솔 에러(`orderStatus` 언급) + 200 네트워크 응답(본문에 `orderStatus` 키 포함) 시딩 → **순수 한글 한 줄** 입력 → submit. ① 목 `/chat/completions` route의 `postDataJSON().messages[].content`에 `Possibly related requests` 섹션 + `[m1] … → 200 · {…orderStatus…} (matched "orderstatus")` 단정(토크나이저→매칭→digest→프롬프트 인쇄 전 배선 증명). ② 목이 `logRefs:["m1"]` 반환 → 200 원문이 description 코드블럭으로 삽입 단정.
  - **E2E-2(CAP 회귀)**: 에러 후보 2 + 매칭 후보 2 시딩 → 목이 `logRefs:["n1","n2","m1","m2"]`(4개) 반환 → description 블록 **3개(에러 우선 생존)** 단정. 기존 `return []`(전멸)이면 0개라 회귀를 잡는다.
  - **E2E-3(게이트)**: 매칭 0(어떤 응답에도 term 미포함) 또는 compact 경로 → postData에 매칭 섹션 미등장 단정.
  - e2e 영향: **있음** — 위 3 spec 추가(신규 UI·testid는 없고, `ai-draft-*` 기존 testid 재사용). `/e2e-write`로 green까지.
- **수동 테스트**(Chrome, e2e가 못 덮는 실LLM 판단 스팟체크만):
  - [ ] 200 + `{items:[]}` 반환하고 콘솔에 해당 필드 언급 에러가 나는 실페이지에서 캡처 → 순수 한글 한 줄 입력 → AI 초안. 실제 모델이 매칭된 200을 원인으로 인용·산문 설명하는지(판단 품질).
  - [ ] over-match term(흔한 `api` 등)만 있는 입력 → 매칭 후보가 노이즈로 안 뜨는지.
  - [ ] compact 프로바이더(Chrome Built-in nano) → 동작이 기존과 동일한지.

## 구현 순서 권장

- **Task 1, Task 2 병렬**(상호 독립 순수 함수).
- **Task 3**은 Task 1·2 타입 완성 후.
- **Task 4**는 Task 3 후. `AiDraftSessionContext.requests` 필드를 여기서 추가하므로(ORDER) 이후 태스크가 typecheck 통과.
- **Task 5, Task 5b, Task 6 병렬**(Task 4 후 — 배선·캡 수정·인쇄는 독립). ※ Task 6 rich-print 테스트는 `ctx.requests`를 세팅해야 matched 인쇄를 검증할 수 있어 Task 4의 필드에 의존(그래서 필드를 Task 4로 당김).
- e2e(E2E-1~3)는 위 태스크 green 후 `/e2e-write`.
- 마지막에 `pnpm typecheck` + `pnpm test`.

## 가이드 영향

사용자 노출 동작 변경(AI 초안이 에러가 아닌 정상 응답도 원인으로 인용·삽입) → `guide/ko`·`guide/en`의 AI 초안 설명 페이지를 대조·갱신 대상으로 표시. 정확한 페이지·문구는 `guide/AUTHORING.md` 규칙에 따라 구현 후 `/guide`로 처리한다.
- AI 초안/자동 작성 설명 페이지(ko·en) — "관련 있는 정상(200) 응답도 근거 로그로 인용될 수 있음" 취지 반영.
- 별개로 `docs/privacy.{ko,en}.md` — 응답 shape(키·타입, 값 제외)가 유저 선택 LLM으로 전송됨을 대조·갱신(가이드 아님, `/push`·`/doc-check` 경로).
