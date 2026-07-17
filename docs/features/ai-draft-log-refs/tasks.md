# AI 초안 로그 코드블럭 자동 삽입 — 구현 태스크

## 선행 조건

- 🚧 **`code-block-collapse` 선행 구현 필수 (하드 게이트).** 이 feature의 "로그 전문 유지" 결정은 collapse가 부피를 흡수한다는 전제 위에 있다. collapse 없이 배포하면 ~32.8KB 블록(body당 16KB × 2)이 접히지 않은 채 화면을 먹는다 — 400px 실측으로 3블록 = 약 84화면. **collapse 구현 전에는 이 feature를 배포하지 않는다**(PRD "의존" 참조). 구현·테스트 착수는 무방하다.
- 권한·env·외부 API·의존성 추가 **없음**. manifest 무변경 → `docs/PERMISSION.md`·`docs/privacy.{ko,en}.md` 트리거 아님(새 캡처·수집·전송 동작이 없고, 이미 수집 중인 로그를 본문에 넣는 것뿐).
- 새 i18n 키 **없음**.
- 착수 전 `docs/POSTMORTEM.md`를 `AI 초안|프롬프트|merge|로그`로 grep해 과거 함정 소환.

---

## 태스크

### Task 1: 요약에 원본 id 동행

- **변경 대상**: `src/sidepanel/lib/buildLogSummary.ts`
- **작업 내용**
  - `NetworkLogSummaryError`(`id` 추가) / `ConsoleLogSummaryError`(`{id, message}`) export.
  - `topErrors: string[]` → `ConsoleLogSummaryError[]`. **병렬 배열(`topErrorRefs[]` 등)을 만들지 않는다.**
  - `ref`는 여기서 부여하지 **않는다** (Task 2에서).
  - 컴파일 깨지는 곳을 따라가 수정: `draftRich.ts:116`, `draftCompact.ts:79`. (`draftCompact.ts:77`은 `topErrors.length`만 읽어 안 깨진다.)
- **검증**
  - [ ] `pnpm typecheck` 통과 — 8개 이슈 빌더는 `errors.length`·카운트만 읽으므로 안 깨진다
  - [ ] `buildMarkdownContext.test.ts:64/70`은 `baseArgs(overrides: Record<string, unknown>)`가 타입을 지워서 **TS가 안 잡는다** — `topErrors` 없이 요약을 구성하지만 그 필드를 안 읽으므로 통과가 맞다. "TS가 전 소비자를 잡아준다"의 예외로 인지만 할 것
  - [ ] 요약 항목의 `id`가 원본 `NetworkRequest.id`/`ConsoleEntry.id`와 일치
  - [ ] console 요약의 dedup 동작(first-line 기준)이 기존과 동일

### Task 2: 후보 집합 단일 출처

- **변경 대상**: `src/sidepanel/lib/prompts/logCandidates.ts` (신규)
- **작업 내용**
  - `selectLogCandidates(ctx)` — `supportsConsoleNetworkLog` 게이트 → network `method+path+status` dedup → `PROMPT_CAPS[style]` 캡 → **그 다음** `n1..`/`c1..` 부여.
  - `candidateRefs(c)`, `findCandidate(c, ref)` export.
  - **후보** 게이트는 **배열 길이로만** 판정 (rich의 `errorCount>0||warnCount>0` 헤더 조건을 따라가면 warn-only 캡처에서 compact와 갈린다). ⚠ 이건 후보 게이트 얘기지 **헤더 얘기가 아니다** — Task 3 참조.
  - `AiDraftSessionContext`는 **`import type`으로만** 들여온다. `buildAiDraftPrompt.ts`에서 값을 하나라도 import하면 순환이 된다(Task 4가 `getDraftFewShot`에서 이 모듈을 값 참조하므로).
- **검증**
  - [ ] 캡은 **kind별**이다: `PROMPT_CAPS.compact.networkErrors = 3` / `.consoleErrors = 3`(합계 최대 6), `PROMPT_CAPS.rich.networkErrors = 5` / `.consoleErrors = 5`(합계 최대 10)
  - [ ] `ref` 집합 = 실제 인쇄될 집합 (필터·캡 통과 후 부여라 번호가 연속)
  - [ ] 같은 엔드포인트 500 × 5 → 후보 1개
  - [ ] `element` 모드 → 빈 후보
  - [ ] warn-only console → 양 스타일 모두 빈 후보

> 참고: **rich에선 캡이 절대 안 걸린다** — `buildLogSummary.MAX_ERRORS = 5` == rich 캡 5라 요약이 이미 5개로 잘려 온다. rich의 유일한 후보 감소 요인은 dedup뿐이고, 그래서 "compact `n5` 스킵" 테스트(Task 5)가 compact 전용이다.

### Task 3: 프롬프트에 후보·지시 반영

- **변경 대상**: `src/sidepanel/lib/prompts/draftRich.ts`, `src/sidepanel/lib/prompts/draftCompact.ts`
- **작업 내용**
  - 수동 slice를 `selectLogCandidates(ctx)` 순회로 교체. rich `[n1] GET /api/pay → 500 Internal Server Error` / compact `[n1] GET /api/pay → 500`.
  - 후보가 있을 때만 `logRefs` 출력 키 지시 추가. **"빈 배열이 정상"·"직접 증거만"을 명시** — 기본값은 안 넣는 것이다.
  - rich 규칙에 역할 분담 추가: 산문엔 짧게 지목하되 **request/response body 전문은 붙여넣지 말고 id로 넘긴다**. 기존 `draftRich.ts:175`("verbatim 인용")과 반쯤 충돌하므로 함께 조정.
  - ⚠ **rich의 console 헤더를 지우지 말 것.** `draftRich.ts:114`의 `errorCount > 0 || warnCount > 0` → `- Console: N errors, M warnings`는 그대로 유지한다. 후보 순회로 교체하면서 같이 지우면 **warn-only 캡처에서 "경고 N건"이라는 유효 정보가 사라진다**(후보는 0이지만 헤더는 남아야 한다).
  - `COMPACT_DRAFT_FEW_SHOT_LOGREFS` 추가 — 기존 예시와 동일하되 `"logRefs":[]`. **값을 채운 예시(`["n1"]`) 금지** — 실제 런에 없는 ref를 가르친다(console-only 캡처엔 `n1`이 없다).
- **검증**
  - [ ] rich/compact 양쪽에 `[n1]` 태그가 인쇄됨
  - [ ] **원본 `id`가 프롬프트에 없음** — UUID 정규식이 아니라 `id` 값 자체를 `not.toContain`으로 검사(`crypto.randomUUID()` 부재 시 `nw-`/`cl-` 폴백이라 정규식은 그 경로를 못 잡는다)
  - [ ] 후보 0이면 `logRefs` 지시 줄 없음
  - [ ] **warn-only 캡처에서 rich의 `- Console: 0 errors, N warnings` 헤더가 유지되고 후보만 0**
  - [ ] compact 본문이 `COMPACT_SYSTEM_TARGET_CHARS = 2000` 불변식 유지

### Task 4: 스키마·파싱

- **변경 대상**: `src/sidepanel/lib/buildAiDraftPrompt.ts`
- **작업 내용**
  - `buildAiDraftSchema(sectionIds, opts?: { logRefs: string[] })` — opts 있을 때만 `{type:"array", items:{type:"string", enum: opts.logRefs}}` + `required`. `minItems` 없음.
  - **`properties` 타입 확장 선행**: 현재 `const properties: Record<string, { type: "string" }>`(`buildAiDraftPrompt.ts:21`)라 배열 스키마가 **그대로는 컴파일되지 않는다.**
  - `AiDraftResponse` 신설, `parseAiDraftResponse` 반환 타입 교체. `logRefs = Array.isArray(…) ? filter(typeof === "string") : []`. **후보 대조는 여기서 하지 않는다.**
  - `getDraftFewShot(ctx)` — compact이고 후보가 있으면 LOGREFS 변형.
  - `import type { EditorDraft }` 제거.
- **검증**
  - [ ] `buildAiDraftSchema(["stepsToReproduce"])`에 `logRefs` **없음** — `generateReproPrefill.ts:48` 무변경, `generateReproPrefill.test.ts:89` 무수정 통과
  - [ ] `generateReproPrefill.test.ts:86`(`fewShot === COMPACT_DRAFT_FEW_SHOT` 고정)도 **무수정 통과** — few-shot을 후보 유무로 분기시키므로 이것도 회귀 가드다. repro ctx는 로그 요약을 아예 안 넣어(`generateReproPrefill.ts:38-46`) 후보 0 → 기본 few-shot 유지가 성립한다. 단 `captureMode`는 screenshot/video/freeform이 올 수 있어 `supportsConsoleNetworkLog` 게이트는 통과하므로, **Task 2의 "배열 길이로만 판정"이 지켜져야만 이게 성립한다**
  - [ ] `parseAiDraftResponse`가 누락/비배열/혼합배열에서 `[]` 반환
  - [ ] 스키마가 `logRefs`를 안 실으면 few-shot도 그 키를 안 보여줌

### Task 5: ref → 코드블럭 렌더

- **변경 대상**: `src/sidepanel/lib/renderLogRefs.ts` (신규)
- **작업 내용**
  - `renderLogRefs.ts`: `MAX_LOG_REFS = 3`, `renderLogRefBlocks`, `codeBlockMarkdown`, `appendLogBlocks`.
  - 순서: 미지 ref 스킵 → 중복 ref 제거 → **유효 개수 > 3이면 `[]` + `console.warn`**(버린 개수 포함). warn 프리픽스는 저장소 관례대로 **`[bugshot] …`**(`generateReproPrefill.ts:59`). 이 warn은 **로컬 디버깅용**이지 보정 데이터 수집 수단이 아니다(PRD 결정 2).
  - `kind` 디스패치는 `findCandidate`의 `kind`로. **`n`/`c` 접두 파싱 금지.**
  - `appendLogBlocks`는 섹션 내 동일 텍스트 블록이 있으면 스킵(누적 중복 방어).

> ⚠ `markdownBlocks.ts`는 **Task 6으로 이관**했다 — 코드블럭 추출·strip 기준은 Task 6(보존)의 본질이고, 여기 두면 Task 6이 Task 5에 하드 의존해 "3·5·6 병렬"이 성립하지 않는다.
- **검증**
  - [ ] 후보에 없는 ref → 스킵, throw 없음
  - [ ] compact에서 `n5`(요약엔 있지만 미인쇄) → 스킵
  - [ ] 유효 4개 → `[]` + warn / 3개 → 3블록
  - [ ] `responseBody`에 백틱 3개 → 결과 마크다운의 비들여쓰기 fence가 정확히 2개
  - [ ] 이미 같은 블록이 있는 섹션에 같은 로그 → 안 늘어남. **비교 기준은 `codeBlockMarkdown` 출력끼리가 아니라 Tiptap 왕복본 vs AI 생성본이다** — fence 생성 주체가 달라(수동은 `tiptap-markdown` 직렬화, AI는 직접 문자열) 출력끼리 비교하면 유닛만 green이고 실제 패널에서 블록이 늘어난다(PRD 목표 절)
  - [ ] **Slack 부피**: AI 삽입 3블록이 `splitSlackText`(`SLACK_TEXT_LIMIT = 3800`) 분할을 타도 fence가 짝수로 보존된다 — 또는 기존 `submitToSlack.test.ts > 긴 본문 분할`이 커버함을 확인. 수동은 사용자가 1건을 의도적으로 넣지만 **AI는 최대 3건을 사용자 인지 없이 자동 삽입하는 새 부피 축**이다(POSTMORTEM 2026-07-16: "상한은 가장 빡빡한 소비처 기준으로 센다")

### Task 6: 코드블럭 보존 + strip 기준 교체

- **변경 대상**: `src/sidepanel/lib/markdownBlocks.ts` (신규), `src/sidepanel/lib/mergeAiDraftSections.ts` + AI draft 경로 strip 사용처 5곳
- **작업 내용**
  - `markdownBlocks.ts`: `extractCodeBlocks` / `stripCodeBlocks` / `stripPreservedContent`. 들여쓰기 0의 fence만 매칭(내부 fence는 `neutralizeFences`가 4칸 들여쓴 상태 — `logToCodeBlock.ts:20-22`).
  - **`stripPreservedContent`는 `.trim()` 계약을 상속한다** — `stripInlineImageRefs`의 `.replace(/\n{3,}/g, "\n\n").trim()`(`resolveInlineImages.ts:82`)이 계약인 이유는 `selectDraftSections`가 `.trim()` 없이 truthy로만 판정하기 때문이다(`context.ts:105-106`). `"\n\n"`를 남기면 빈 섹션이 프롬프트에 실리고 `includedIds`에 들어가 **merge의 보호 가드가 풀린다.**
  - `mergeAiSectionsPreservingImages` → `mergeAiSectionsPreservingBlocks`. `out[id] = [...images, aiText, ...prevCodeBlocks]`.
  - 🔴 **`mergeAiDraftSections.ts:46-49`의 early-return 분기를 제거한다**: `if (images.length === 0) { out[id] = aiText; continue; }` — 여기서 `prevCodeBlocks`가 증발한다. **이미지 없이 코드블럭만 있는 섹션**이 이 feature의 주 시나리오(PRD C)다.
  - **`stripInlineImageRefs` → `stripPreservedContent` 교체는 AI draft 경로 5곳만**: `draftRich.ts:145`, `draftCompact.ts:102`, `promptBudget.ts:41`, `promptBudget.ts:52`, `mergeAiDraftSections.ts:32`.

> 🔴 **`grep stripInlineImageRefs`는 7곳을 뱉는다. 나머지 2곳은 교체 금지다.**
>
> `buildIssueAdf.ts:128` · `buildNotionIssueBody.ts:261` — **의도적 비대상.** 트래커 export 빌더이고, 여기를 바꾸면 **이미지가 있는 섹션의 코드블럭이 Notion·Jira 이슈 본문에서 삭제된다**(사용자가 수동으로 넣은 로그가 트래커로 안 나가는 조용한 데이터 손실 — 이 feature의 목적과 정반대).
>
> **`stripPreservedContent`는 rename이 아니라 신규 함수다.** `stripInlineImageRefs`는 그대로 남고 계약 테스트(`resolveInlineImages.test.ts:134-149`) 4개도 green이어야 한다.
>
> (더 단순한 대안: `selectDraftSections`의 4번째 `strip` 인자는 3개 호출처에서 항상 같은 값이라, 제거하면 교체 대상이 5곳 → 2곳으로 줄고 동기화 위험이 구조적으로 사라진다. 외과적 범위를 넘으면 채택 안 함 — design 위험 1 참조.)

- **검증**
  - [ ] 코드블럭만 있는 섹션이 "절삭된 원문"으로 오인되지 않음 — **하나라도 빠지면 사용자 텍스트가 조용히 삭제된다**
  - [ ] `stripPreservedContent("```\n…\n```")` → **빈 문자열**(`"\n\n"` 아님 — `.trim()` 계약)
  - [ ] 수동 삽입 블록이 AI 재생성 후 남음 (**이미지 없는 섹션에서도** — early-return 제거 확인)
  - [ ] 이미지 + 코드블럭 + AI 텍스트 순서: 이미지 → AI 산문 → 기존 블록
  - [ ] 기존 가드 3개(미프롬프트 섹션 prev 우선 / AI 키 누락 시 보존 / 이미지 hoist) 회귀 없음
  - [ ] `buildIssueAdf.ts:128`·`buildNotionIssueBody.ts:261` **무변경** — Notion·Jira 본문에서 코드블럭이 살아남는다
  - [ ] `resolveInlineImages.test.ts` 무수정 green

### Task 7: 배선

- **변경 대상**: `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**
  - `fitDraftContext` 직후: `canInsertLogs = sectionIds.includes("description")`, `candidates = selectLogCandidates(fitted.ctx)` — **`ctx`가 아니라 `fitted.ctx`**, `refs = canInsertLogs ? candidateRefs(candidates) : []`.
  - `buildAiDraftSchema(sectionIds, refs.length ? { logRefs: refs } : undefined)`.
  - merge 이후: `refs.length && "description" in parsed.sections`일 때만 `appendLogBlocks(merged.description ?? "", renderLogRefBlocks(parsed.logRefs, {candidates, requests, entries}))`. **이 게이트가 없으면 AI가 키를 누락했을 때 merge가 살린 사용자 원문 위에 블록이 붙는다**(PRD 엣지 케이스).
  - 스냅샷은 **await 이전에 잡은 지역 변수**(`:88-90`)를 쓴다. ⚠ 그 변수명은 `requests`/`entries`가 아니라 **`networkLog`/`consoleLog`**이고 **undefined 가능** → `networkLog?.requests ?? []`, `consoleLog?.entries ?? []`로 넘긴다.
- **검증**
  - [ ] `description` 비활성 → 스키마·프롬프트에 `logRefs` 없음, 다른 섹션 폴백 없음
  - [ ] AI가 `description` 키 누락 → 블록 미삽입 + prev 보존 유지
  - [ ] AI가 `description`을 **빈 문자열로** 반환 → 게이트 판정과 기대 동작이 정의돼 있음(`mergeAiDraftSections.ts:41`의 `!aiText && !(id in aiSections)` 가드를 안 타는 별개 경로)
  - [ ] 절삭 level≥1 → 후보·스키마·few-shot 동시 소멸
  - [ ] **기존 동작 유지**: `e2e/ai-draft.spec.ts` 기존 3개 시나리오 green, `mergeAiDraftSections.test.ts` 기존 호출 전부 green

---

## 테스트 계획

### 단위 테스트 (Vitest, node 트랙 — 전부 순수 함수)

| 파일 | 케이스 |
|---|---|
| `lib/__tests__/buildLogSummary.test.ts` (확장) | 항목에 원본 `id` 동행; console dedup 동작 불변 |
| `lib/prompts/__tests__/logCandidates.test.ts` (신규) | kind별 캡(compact `networkErrors`/`consoleErrors` 각 3, rich 각 5); ref 번호 연속·유일; network dedup; `element` → 빈 후보; warn-only console → 빈 후보(양 스타일 동일) |
| `lib/__tests__/renderLogRefs.test.ts` (신규) | 미지 ref 스킵; compact `n5` 스킵; 중복 ref 제거; **유효 4개 → `[]`**; 3개 → 3블록; **fence 무결성**(백틱 3개 든 body → 비들여쓰기 fence 정확히 2개); `appendLogBlocks` 동일 텍스트 스킵(**Tiptap 왕복본 기준**)·`[]` identity·빈 섹션 선행 개행 없음 |
| `lib/__tests__/markdownBlocks.test.ts` (신규, Task 6) | 들여쓰기 0 fence만 추출; 4칸 들여쓴 내부 fence 미추출; 미닫힘 fence는 텍스트 취급; `stripPreservedContent`가 이미지+코드블럭 제거; **코드블럭만 있는 섹션 → 빈 문자열**(`.trim()` 계약) |
| `lib/__tests__/buildAiDraftPrompt.test.ts` (확장) | `buildAiDraftSchema(ids)`에 `logRefs` **없음**(회귀 가드); `opts` 전달 시 enum 생성 + required; `parseAiDraftResponse` `logRefs` 방어적 파싱; rich/compact 프롬프트에 `[n1]` 인쇄; **원본 `id` 미노출**(정규식 아니라 `id` 값 `not.toContain`); 후보 0이면 지시 줄 없음; **warn-only에서 rich 헤더 유지**; few-shot 변형 선택 |
| `lib/prompts/__tests__/promptBudget.test.ts` (확장) | **level≥1 절삭 후 `selectLogCandidates(fitted.ctx)`가 빈 배열** — 절삭 결합 계약의 전부 |
| `lib/__tests__/mergeAiDraftSections.test.ts` (확장) | 코드블럭 보존; 코드블럭만 있는 섹션이 "절삭된 원문"으로 오인 안 됨; 이미지+블록+AI텍스트 순서; 기존 가드 3개 회귀 |
| `lib/__tests__/generateReproPrefill.test.ts` (무수정 통과) | `:89` 스키마 동등성 + `:86` few-shot 고정(`fewShot === COMPACT_DRAFT_FEW_SHOT`) — **둘 다 수정 없이 green이어야 오염 없음이 증명된다** |
| `lib/__tests__/submitToSlack.test.ts` (확인) | AI 삽입 3블록이 `splitSlackText` 분할을 타도 fence 짝수 보존 — 기존 `긴 본문 분할` 케이스가 커버하면 신규 불요 |

**기존 리터럴 갱신(기계적, TS가 안내)**: `topErrors: string[]`를 인라인 구성하는 `buildNotionIssueBody.test.ts:498`, `buildLinearIssueBody.test.ts:303`, `promptBudget.test.ts:32`, `buildAiDraftPrompt.test.ts:162/262/382/690/773`.

### e2e 시나리오 (`/e2e-write` 입력)

`e2e/ai-draft.spec.ts`가 이미 BYOK `/chat/completions`를 고정 JSON으로 목킹한다(`:60-69`). **유닛으로 못 보는 유일한 구간(tiptap 마크다운 왕복 → 실제 `codeBlock` 노드)을 여기서 증명한다.**

**선행 개조 (tasks에 없던 전제)**
- **`MOCK_DRAFT`를 가변으로.** 현재 상수 고정(`:16-21`)이고 `logRefs` 키가 없다. 시나리오별로 다른 `logRefs`를 반환하려면 `let mockDraft` + route 핸들러가 매번 읽는 구조로 바꾼다.
- **`mode-freeform` 사용.** `supportsConsoleNetworkLog`가 freeform도 통과시키고 `ai-draft.spec.ts:72`가 이미 freeform을 쓴다. "화면 캡처 후"는 `captureUntilDrafting` 재시도 하네스 복제 + `captureVisibleTab` rate-limit flake를 새로 들이는데 로그 스코프상 얻는 게 없다.
- **셀렉터**: `descEditor(panel).locator("pre")`로 카운트. `StarterKit`이 `codeBlock`을 끄지 않고 `JsonCodeHighlight`가 NodeView 없이 Decoration만 쓰므로 표준 `<pre><code>`가 나온다. 단 **스위트 전체에 `pre`/`.ProseMirror` locator 선례가 0건**이고 기존 관례는 `preview-section-*` 판정(`log-insert.spec.ts:4`)이므로, 새 패턴 도입 근거를 spec에 주석으로 남긴다.
- **접힌 섹션은 에디터가 언마운트된다**(`DraftingPanel.tsx:755-756`). `pre` 카운트 전에 섹션이 열려 있어야 한다 — POSTMORTEM 2026-07-16 "접힌 섹션 로그 삽입 no-op"과 같은 계열.
- 콘솔 에러 fixture는 `logs-error-warn.spec.ts:17-23`의 `console.error` + `toPass` 폴링 패턴(저장소 표준)을 따른다.

**시나리오**
- console 에러가 있는 상태에서 AI 초안을 돌리고 `mockDraft`가 `"logRefs":["c1"]`을 반환하면, 발생 현상 에디터에 `codeBlock` 노드가 1개 생긴다.
- `mockDraft`가 `"logRefs":[]`를 반환하면 `codeBlock` 노드가 0개다.
- `mockDraft`가 후보에 없는 `"logRefs":["n9"]`를 반환하면 `codeBlock` 노드가 0개다.
- 수동으로 로그를 삽입한 뒤 AI 초안을 돌리면 그 `codeBlock`이 그대로 남아 있다.
- **재생성 dedup**: 같은 ref로 AI 초안을 2회 돌려도 `codeBlock` 노드가 1개다 — Tiptap 왕복 후에도 dedup이 성립하는지가 유닛으로 안 잡히는 지점이다(design 위험 2).

> **유효 ref 4개 → 0개 시나리오는 e2e에서 뺀다** — 콘솔 에러 4건을 결정적으로 만들어야 해서 취약하고, 유닛(`renderLogRefs.test.ts`)으로 충분하다.
>
> `c1`의 결정성도 약하다: ref 번호는 필터·캡 통과 후 부여라 패널이 열린 동안 콘솔 노이즈가 섞이면 `c1`이 엉뚱한 항목을 가리킨다. "노드 1개" 단언은 통과하지만 의도가 흐려지므로 fixture의 콘솔 출력을 최소로 통제한다.

### 수동 테스트 (자동화 불가만)

- [ ] 실제 Chrome nano로 AI 초안 → `logRefs` enum이 실제로 걸리는지(`responseConstraint`는 목킹으로 검증 불가)
- [ ] 실제 BYOK(원격 모델)로 → 스키마가 버려지는 경로에서 프롬프트 지시만으로 유효 ref가 오는지, 오지 않을 때 후보 대조가 조용히 막는지
- [ ] `code-block-collapse` 적용 후 AI 삽입 블록이 15줄로 접히는지

---

## 구현 순서 권장

```
Task 1 (요약 id)
  ↓
Task 2 (후보 단일 출처)
  ↓
Task 3 (프롬프트)  ──┐
Task 5 (렌더)      ──┤  ← 3·5·6 병렬 가능 (markdownBlocks가 Task 6에 있을 때만)
Task 6 (markdownBlocks + 보존 + strip) ──┘
  ↓
Task 4 (스키마·파싱)
  ↓
Task 7 (배선)
```

> ⚠ **`markdownBlocks.ts`가 Task 5에 있으면 이 병렬은 거짓이다.** Task 6이 `stripPreservedContent`(5곳에서 소비)와 `extractCodeBlocks`(merge에서 소비)를 **Task 5가 만든 심볼로 의존**하게 되기 때문이다. 그래서 `markdownBlocks.ts`를 Task 6으로 옮겼다. 대안으로 순서를 `2 → {3,5} → 6 → 4 → 7`로 직렬화해도 된다.
>
> Task 3과 6은 같은 파일 2개(`draftRich.ts`·`draftCompact.ts`)를 건드린다 — 구간이 달라 병렬 자체는 되지만 "서로 독립"은 아니다.

Task 1~2는 **동작 중립**이다(`[n1]` 태그가 프롬프트에 붙는 것 외엔 AI 가시 변화 없음). 실제 기능은 4~7에서 켜진다. Task 6은 회귀 위험이 가장 크므로(strip 기준 5곳 교체 + early-return 제거) 독립 커밋으로 분리하고 테스트를 먼저 박는다.

## 가이드 영향

**있음.** AI 초안이 로그를 자동 삽입하는 건 사용자 노출 동작 변화다. 구현 후 `/guide`로 처리하고, 작성 전 `guide/AUTHORING.md`를 먼저 읽는다.

대조·갱신 대상(ko·en 양쪽):
- `screenshot/issue.md` — 화면 캡처 AI 초안 설명에 "관련 로그를 코드블럭으로 함께 넣어준다" 반영
- `video/issue.md` — 동일
- `settings/ai.md` — AI 기능 범위 설명에 반영
- `element/issue.md` — **무관**(element 모드는 `supportsConsoleNetworkLog` 제외라 로그 자체가 없음). 대조만 하고 손대지 않는다.

`faq.md`는 "AI가 로그를 지어내나?"류 질문이 생길 수 있으므로 `/guide` 판단에 맡긴다 — id-only 불변식은 사용자에게 설명할 가치가 있는 privacy·정확성 서사다.
