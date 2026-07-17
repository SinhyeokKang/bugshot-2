# AI 초안 로그 코드블럭 자동 삽입

## 배경

v1.6.0의 `symptom-log-attach`(커밋 `23a2af5`)로 **수동** 로그 삽입이 들어왔다. 사용자가 본문 섹션 헤더의 `FileCode` 버튼을 눌러 `LogInsertDialog`에서 console/network 로그를 하나 고르면, 앱이 그걸 직렬화해 Tiptap 코드블럭으로 꽂는다.

AI 초안은 이 경로와 단절돼 있다. AI는 로그를 **한 줄 요약**(`buildLogSummary`)으로만 받고, 프롬프트가 *"Write plain text"*라 코드블럭을 만들 수단이 없다. 그래서 AI가 "`/api/pay`에서 500 발생"이라고 써놔도 **실제 로그 전문은 사용자가 로그 탭에서 다시 찾아 수동으로 넣어야 한다.** AI는 어느 로그가 문제인지 이미 판단했는데 그 판단이 본문에 반영되지 않는다.

동시에 반대 방향의 유혹이 있다. AI에게 로그 원문을 뱉게 하면 배선은 쉽지만 **로그를 환각한다** — 존재하지 않는 스택 트레이스가 이슈로 나가면 그 리포트는 개발자를 잘못된 곳으로 보낸다. 버그 리포트에서 로그의 가치는 전부 **정확성**에서 오므로, 한 글자라도 지어낸 로그는 없느니만 못하다.

## 목표

- AI 초안 생성 시 AI가 관련 로그를 **지목**하고, 앱이 원본 store 데이터에서 만든 **실제 코드블럭**을 발생 현상 섹션에 삽입한다.
- **로그 본문은 모델을 거치지 않는다.** AI는 id만 반환하고 직렬화는 `serializeNetworkRequest`/`serializeConsoleEntry`가 한다 → 로그 내용 환각이 **구조적으로 불가능**하다. 프롬프트 훈계가 아니라 데이터 경로로 보장한다.
- 삽입된 블록은 **Tiptap 왕복 후 수동 삽입 블록과 동일**하다(같은 직렬화 함수, 같은 마크다운). 두 경로가 다른 결과를 내지 않는다.

  > ⚠ **"바이트 동일"이 아니라 "왕복 후 동일"인 이유**: 수동 블록은 Tiptap 노드로 들어와 `tiptap-markdown`이 `onUpdate`에서 직렬화한 결과가 마크다운이 되고, AI 블록은 `codeBlockMarkdown`이 직접 만든 문자열이다. **fence를 만드는 주체가 다르다.** 직렬화 입력이 같아도 바이트 동일은 보장되지 않으며, 이게 깨지면 `appendLogBlocks`의 "동일 텍스트면 스킵"이 **유닛에선 green인데 실제 패널에선 재생성마다 블록이 늘어난다**. 그래서 dedup 테스트는 `codeBlockMarkdown` 출력끼리가 아니라 **Tiptap 왕복본 vs AI 생성본**으로 비교한다(tasks 참조).
- 사용자가 수동으로 넣은 코드블럭이 AI 재생성으로 **사라지지 않는다**.
- 관련 로그가 없으면 **아무것도 넣지 않는 것이 정상 동작**이다.

## 비목표 (Non-goals)

- **설정 토글 없음.** AI 로그 삽입을 끄는 스위치를 만들지 않는다. 토글이 필요하다는 건 선별 기준이 실패했다는 자백이다 — 기준으로 해결한다.
- **로그 블록 부피 축소 없음.** `logToCodeBlock.MAX_CHARS = 16384` 전문을 그대로 쓴다. 화면을 먹는 문제는 `code-block-collapse` feature가 담당한다(아래 "의존" 참조).

  > **`MAX_CHARS`는 블록당이 아니라 body당이다.** `truncate()`가 `requestBody`·`responseBody`에 **각각** 걸리므로(`serializeNetworkRequest`) 블록 하나의 실제 상한은 **~32.8KB**(16KB × 2)다. `serializeConsoleEntry`도 args + stack으로 동일. 상한 3개면 최대 ~98KB — 400px 패널 실측으로 약 84화면이다.
- **섹션 선택 없음.** 블록은 `description` 고정이다. AI가 섹션을 고르게 하지 않는다.
- **`stepsToReproduce` 미지원.** `renderAs: "orderedList"`라 코드블럭이 들어갈 자리가 아니고, 수동 버튼도 안 붙는다.
- **후보 풀 확장 없음.** 후보는 지금처럼 **에러만**이다(network `phase==="error" || status>=400`, console `level==="error"`). warn·정상 요청은 후보가 아니다.
- **관련도 순위 사용 안 함.** 상한 이하는 전부 삽입하므로 배열 순서에 의미를 두지 않는다. "AI가 관련도순으로 정렬한다"는 소프트 가정에 의존하지 않는다.
- **`aiStyling`·`generateReproPrefill` 미적용.** 전자는 로그와 무관하고, 후자는 `stepsToReproduce` 전용이다.

## 의존: `code-block-collapse`

이 feature는 **선별**만 책임진다. **부피**는 `docs/features/code-block-collapse/`가 담당한다 — 16줄 이상 코드블럭을 15줄로 접는 기능이고, 그 PRD의 배경이 정확히 *"삽입한 네트워크 응답 하나가 사이드패널 한 화면을 통째로 먹는다"*이다.

**⚠ code-block-collapse는 문서만 있고 아직 미구현이다**(`23a2af5`에 docs만 커밋, `grep -rn "useCodeCollapse" src/` → 0건).

> ### 🚧 하드 게이트: collapse 선행 필수
>
> **code-block-collapse가 구현되기 전에는 이 feature를 배포하지 않는다.** 권장이 아니라 게이트다 — "전문 유지"(비목표)라는 이 feature의 결정 전체가 collapse가 부피를 흡수한다는 전제 위에 서 있고, 순서가 뒤집히면 그 전제가 깨진 채 ~98KB 블록이 사용자에게 도달한다. 시나리오 A-4("블록은 15줄로 접혀 있다")는 이 게이트 하에서만 성립하는 서술이다.

**collapse의 위임 범위는 세로축까지다.** `tiptap-editor.css`가 `white-space: pre` + `overflow-x: auto`(의도적 — 줄을 접으면 들여쓰기가 소실된다)라 개행 없는 body(minified JSON·HTML)는 **1줄 16384자 → 약 118,000px 가로 스크롤**이 되고, collapse는 `overflow-y: hidden`만 걸므로 **접힘이 끝나도 가로축은 남는다.**

→ **가로 스크롤은 두 feature 모두 미해결이며, 이 feature가 새로 만드는 문제가 아니다** — 수동 삽입 블록도 지금 똑같은 상태다. 이 feature의 위임은 세로축에 한정하고, 가로축은 별건으로 남긴다.

`code-block-collapse` PRD의 "결정된 전제 2"가 이 feature의 설계 하나를 이미 확정해준다: *"로그 코드블럭만 타게팅은 불가능하다"* — `serializeConsoleEntry()`는 language를 안 붙이므로 삽입된 콘솔 로그는 사용자가 손으로 친 코드블럭과 **마크다운상 완전히 동일**하다. 그래서 아래 "코드블럭 보존"이 출처를 가리지 않는다.

## 결정된 사항과 근거

### 1. AI는 id만, 앱이 직렬화

핵심 불변식. AI가 로그 텍스트를 만들 경로가 아예 없다.

### 2. 상한 3개, 초과하면 전부 버림

- `logRefs.length === 0` → 삽입 없음 (정상)
- `1..3` → **전부 삽입**
- `4` 이상 → **전부 버림** + `console.warn`

**근거**: 후보를 4개 집었다는 건 선별에 실패하고 나열했다는 신호다. 반면 2~3개는 진짜로 증거가 복수일 수 있다 — 401 응답과 그 응답을 파싱하다 터진 console TypeError는 같은 버그의 증거 2개지 AI가 헷갈린 게 아니다. 절벽을 4에 두면 정당한 구간을 비켜간다.

> **⚠ `3`은 임의값이다.** "단일 버그의 직접 증거가 3을 넘는 경우는 드물다"는 경험칙 외에 근거가 없다. 후보 풀 비율로 정의하려 했으나 rich(합계 최대 10)와 compact(합계 최대 6)에서 의미가 갈려 오히려 나빠진다. **`MAX_LOG_REFS` 상수 하나로 빼고, 임의값으로 못박은 뒤 이슈 리포트가 오면 조정한다.**
>
> `console.warn`은 **로컬 디버깅용**이다 — 그 warn은 사용자 브라우저 사이드패널 콘솔에 찍히므로 개발자에게 도달하지 않는다. 실사용 보정 데이터를 쌓는 수단이 아니다(그러려면 PostHog 익명 카운트가 필요하고, 이 feature는 그 스코프를 열지 않는다).

**후보 풀 크기의 단위**: `PROMPT_CAPS[style]`는 kind별 캡이다 — compact은 `networkErrors: 3` / `consoleErrors: 3`(합계 최대 6), rich는 `networkErrors: 5` / `consoleErrors: 5`(합계 최대 10). "10개 중 4개"는 network·console이 **둘 다 포화**해야 성립하는 상한이므로, 실제 후보 수는 대개 그보다 훨씬 적다. 아래 문서 전체에서 합계로 쓸 때는 명시한다.

### 3. 블록은 `description` 고정

임의 선택이 아니라 **프롬프트의 섹션 계약**에서 따라 나온다:

| 섹션 | 계약 (`draftRich.ts`) | raw 로그의 자리인가 |
|---|---|---|
| `description` | "현재 관찰되는 문제 현상만" (`:14`) | **그렇다** — 에러 로그 원문이 정확히 관찰된 현상 |
| `expectedResult` | "수정 후 기대되는 동작" (`:16`) | 아니다 — 캡처된 에러가 "기대 결과"일 수 없다 |
| `notes` | "확신이 서지 않는 추론은 '가설:' 접두로" (`:17`) | 아니다 — 추론의 자리지 증거의 자리가 아니다 |
| `stepsToReproduce` | 재현 단계 (orderedList) | 아니다 — 수동 버튼도 안 붙는다 |

수동 버튼이 paragraph 섹션 3개에 다 붙어 있는 건 **사용자가 뭘 하든 자유**라서지 AI도 그래야 한다는 근거가 아니다. 제대로 추론한 LLM이라면 `description`, 넓어야 `notes`에 쓸 뿐 `expectedResult`엔 넣지 않는다.

**받아들이는 손실**: AI가 "이 로그는 비고에 어울린다"고 판단해도 자리가 없다. 그 대가로 `logRefs: string[]` 평면 구조를 지킨다 — BYOK는 스키마가 무력해서(아래 4) 구조가 중첩될수록 파싱 실패·잘못된 섹션명 분기가 늘어난다. 드문 케이스 하나와 상시 파싱 위험을 맞바꾸지 않는다.

### 4. compact(Chrome nano)·rich(BYOK) 둘 다 적용

- nano가 스택 트레이스를 지어낼 위험이 **가장 큰** 모델이다. 여기서 빼면 가드가 가장 필요한 곳에 없다.
- 비용: `[n1]` 접두 ~5자 × ≤6줄 + 지시 1줄 + few-shot `"logRefs":[]` — **10,000자 예산 중 ~90자**.
- `DRAFT_BUILDERS`가 `Record<PromptStyle, …>`인 이유가 스타일 간 정합 강제(`buildAiDraftPrompt.ts:93`, `DRAFT_FEW_SHOT`은 `:102`)다. 스타일 분기는 부채다.

> **BYOK에선 스키마가 무력하다.** `ai-provider.ts:414/427`이 `!!responseSchema → response_format: {type:"json_object"}`(`:385`)로만 번역하고 스키마 자체를 버린다. `enum` 제약은 **Chrome nano의 `responseConstraint`에만** 걸린다. → BYOK는 프롬프트 문장이 유일한 통제 채널이고, **앱단 ref 검증은 선택이 아니라 필수**다.

### 5. network 후보 중복 제거

`buildConsoleLogSummary`는 first-line 기준 dedup이 있지만(`buildLogSummary.ts:36-45`) `buildNetworkLogSummary`엔 없다. 같은 엔드포인트가 5번 500이면 후보 `n1..n5`가 전부 같은 요청이라 **AI가 같은 정보를 5번 본다.**

→ **후보 선별 단계에서만** `method+path+status` 기준으로 접는다. `buildNetworkLogSummary` 자체를 고치면 이슈 본문의 `errors.length` 카운트까지 바뀐다(8개 빌더가 그 값을 읽는다) — 외과적 범위를 지킨다.

> **이 dedup은 노이즈 제거지 후보 슬롯 회수가 아니다.** `buildNetworkLogSummary`가 `MAX_ERRORS = 5`로 **먼저 자르고**(`buildLogSummary.ts:21-23`) dedup은 그 뒤 후보 단계에서 돈다. 그래서 `POST /api/pay → 500` × 5 + `GET /api/user → 404` 1개인 캡처에서 404는 slice 단계에서 이미 증발했고, dedup은 5→1로 접기만 할 뿐 **빈 슬롯을 못 채운다.** 슬롯 회수를 하려면 dedup을 요약 단계 slice 앞으로 옮겨야 하는데, 그러면 `errors.length`가 바뀌어 8개 빌더 출력이 변한다 — 외과적 범위를 이유로 받아들이는 한계다. (참고: rich는 `networkErrors: 5` == `MAX_ERRORS: 5`라 캡이 아예 안 걸리고, 유일한 후보 감소 요인이 dedup뿐이다.)

### 6. 모든 코드블럭 보존

수동 삽입 블록이 AI 재생성에 날아가지 않아야 한다. 그런데 삽입된 로그와 손으로 친 코드블럭은 **마크다운상 구분이 불가능**하다(위 "의존" 참조). → **출처를 가리지 않고 섹션 내 모든 fenced code block을 보존**한다. inline 이미지와 같은 취급이다. 마커를 새로 만들면 마크다운이 바뀌고, 그건 트래커 본문으로 샌다.

AI는 어차피 코드블럭을 쓰면 안 되므로(규칙상 plain text) 손실이 없다.

**받아들이는 손실 — 보존은 제자리가 아니라 하단 hoist다.** 병합 결과가 `[...images, aiText, ...prevCodeBlocks]`이므로 사용자가 **산문 중간에 넣은 코드블럭은 섹션 맨 아래로 밀린다.** 이미지 hoist와 같은 취급이고, "원위치"를 정의하려면 AI가 새로 쓴 산문 안의 어디인지를 정해야 해서 복잡도가 급증한다. 그리고 이 재배치는 `description`·`logRefs`와 무관하게 **모든 섹션 × 모든 AI 초안 실행**에 적용된다(element 모드 포함).

## 사용자 시나리오

### A. AI가 로그를 지목해 삽입

1. 화면 캡처로 버그를 찍는다. console에 `TypeError`, network에 `POST /api/pay → 500`이 잡혀 있다.
2. AI 초안 버튼 → "결제 누르면 아무 반응이 없어요" 입력 → 생성.
3. 발생 현상 섹션에 AI가 쓴 산문이 들어오고, **그 아래에 실제 로그 코드블럭**이 붙는다. 내용은 `LogInsertDialog`로 직접 골랐을 때와 한 글자도 다르지 않다.
4. 블록은 15줄로 접혀 있다(`code-block-collapse`). 펼쳐서 확인하거나, 필요 없으면 지운다.

### B. 관련 로그가 없음

1. 광고 스크립트가 뱉은 무관한 console 에러만 있는 페이지에서 레이아웃 깨짐을 리포트한다.
2. AI가 `logRefs: []`를 반환한다 → **코드블럭이 안 붙는다.** 이게 정상이다.

### C. 사용자가 넣은 블록 + AI 재생성

1. 수동으로 network 로그를 발생 현상에 삽입한다.
2. 내용을 보강하려고 **`drafting` phase에서** AI 초안을 다시 돌린다 — `AiDraftDialog`는 프리필하지 않으므로(`input`은 제출 시 비워지는 로컬 상태이고 빈 입력이면 제출 버튼이 비활성) **프롬프트를 다시 입력해야 한다.** draft를 confirm한 뒤에는 AI 초안 진입 자체가 불가능하다.
3. AI가 산문을 새로 쓰지만 **수동 블록은 남는다** — 단 섹션 하단으로 밀린다(결정 6의 "받아들이는 손실").
4. AI가 같은 로그를 지목했다면 블록이 **두 개로 늘지 않는다**(동일 텍스트 dedup).

### D. AI가 나열해버림

1. 에러가 많은 페이지에서 AI가 `logRefs`에 5개를 던진다.
2. 상한 3 초과 → **아무것도 안 넣는다.** `console.warn`에 버린 개수가 남는다.
3. 사용자는 로그가 필요하면 수동 버튼으로 직접 고른다.

**받아들이는 손실 — 사용자는 D와 B를 구분할 수 없다.** `console.warn`은 개발자용이라 사용자 화면에서 "4개 찾았는데 버렸다"(D)와 "관련 로그가 없었다"(B)는 완전히 동일하다(둘 다 코드블럭 0개). 전용 토스트를 만들지 않는 결정이며, 이는 "설정 토글 없음"과 **별개의 축**이다 — 피드백을 안 주기로 명시적으로 택한 것이다.

### E. 엣지 케이스

| 상황 | 기대 동작 |
|---|---|
| `description` 섹션이 설정에서 비활성 | `logRefs`를 스키마·프롬프트에서 **아예 요청하지 않는다** (다른 섹션 폴백 없음) |
| AI가 `description` 키를 누락 | 블록 삽입 안 함. 기존 내용 보존(`mergeAiDraftSections.ts:41`)이 유지돼야 한다. **게이트는 `"description" in parsed.sections`** — 이게 없으면 merge가 살린 사용자 원문 위에 블록이 붙는다 |
| AI가 `description`을 **빈 문자열로** 반환 | 키 누락과 다른 경로다(`mergeAiDraftSections.ts:41`의 `!aiText && !(id in aiSections)` 가드를 안 탄다). 게이트 판정과 기대 동작을 명시할 것 |
| AI가 존재하지 않는 ref를 반환 (BYOK) | 조용히 스킵. 유효 ref만 남기고 그 개수로 상한을 판정 |
| compact에서 `n5`를 반환 (요약엔 있지만 프롬프트엔 미인쇄) | 후보가 아니므로 스킵 — 모델이 본 적 없는 로그는 절대 안 들어간다 |
| 예산 절삭으로 로그 요약이 빠짐 (`fitDraftContext` level≥1) | 후보 0 → 스키마·프롬프트·few-shot에서 `logRefs` 동시 소멸 |
| 캡처 모드가 `element` | 로그가 없는 모드(`supportsConsoleNetworkLog`) → 후보 0 |
| 로그 본문에 백틱 3개가 들어있음 | `neutralizeFences`가 이미 4칸 들여쓴다 → fence 조기 종료 없음 |
| 같은 로그를 AI가 중복 지목 (`["n1","n1"]`) | dedup 후 1개 |
| 같은 console 메시지가 다른 스택으로 재발 | 후보 `id`는 first-line dedup의 **첫 발생**으로 고정된다 → AI가 본 한 줄과 삽입되는 전문의 스택이 어긋날 수 있다. 수용된 손실 |
| 네비게이션으로 로그가 초기화된 뒤 응답 도착 | **현재는 도달 불가능한 상태다** — AI 초안은 `drafting`에서만 돌고 `drafting`에선 `logClear`가 no-op이며(`shouldPreserveBackgroundLogs`), 수동 클리어 버튼도 `aiLoading` 오버레이가 클릭을 먹는다. await 이전 스냅샷 규칙은 defense-in-depth로 **고정**한다 |

## 성공 기준

1. 로그가 있는 캡처에서 AI 초안을 돌리면 발생 현상에 **실제 로그와 동일한** 코드블럭이 붙는다. **Tiptap 왕복 후** 수동 삽입 결과와 같다(바이트 동일이 아니라 왕복 후 동일 — 목표 절 참조).
2. AI가 반환한 ref 중 **후보 집합에 없는 것은 절대 삽입되지 않는다** — 유닛 테스트로 증명.
3. 프롬프트 어디에도 원본 `id`가 새지 않는다 — 유닛 테스트로 증명(`buildAiDraftPrompt.test.ts:773`의 인젝션 테스트와 같은 결). **UUID 정규식으로 검사하지 않는다** — `crypto.randomUUID()`가 없으면 `nw-${Date.now()}-…`/`cl-${Date.now()}-…`로 폴백하므로 정규식은 그 경로를 못 잡는다. `id` 값 자체를 `not.toContain`으로 검사한다.
4. 유효 ref가 4개 이상이면 아무것도 삽입되지 않고 `console.warn`이 남는다.
5. 수동 삽입 코드블럭이 AI 재생성 후에도 남아 있고, AI가 같은 로그를 지목해도 중복되지 않는다.
6. `buildAiDraftSchema(["stepsToReproduce"])`(= `generateReproPrefill` 호출 형태)에 `logRefs`가 **없다** — 회귀 테스트로 증명.
7. 이슈 본문 8개 빌더의 출력이 이 기능 도입 전후로 동일하다(요약 타입이 바뀌지만 빌더는 `errors.length`·카운트만 읽는다).
8. `pnpm test` 통과, `pnpm test:e2e` green.
