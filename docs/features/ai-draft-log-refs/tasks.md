# AI 초안 로그 코드블럭 자동 삽입 — 구현 태스크

## 선행 조건

- **`code-block-collapse` 선행 구현 권장.** 이 feature의 "로그 전문 유지" 결정은 collapse가 부피를 흡수한다는 전제 위에 있다. 순서가 뒤집히면 16KB 블록이 접히지 않은 채 화면을 먹는다(PRD "의존" 참조).
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
  - 컴파일 깨지는 곳을 따라가 수정: `draftRich.ts:116`, `draftCompact.ts:77/79`.
- **검증**
  - [ ] `pnpm typecheck` 통과 — 8개 이슈 빌더는 `errors.length`·카운트만 읽으므로 안 깨진다
  - [ ] 요약 항목의 `id`가 원본 `NetworkRequest.id`/`ConsoleEntry.id`와 일치
  - [ ] console 요약의 dedup 동작(first-line 기준)이 기존과 동일

### Task 2: 후보 집합 단일 출처

- **변경 대상**: `src/sidepanel/lib/prompts/logCandidates.ts` (신규)
- **작업 내용**
  - `selectLogCandidates(ctx)` — `supportsConsoleNetworkLog` 게이트 → network `method+path+status` dedup → `PROMPT_CAPS[style]` 캡 → **그 다음** `n1..`/`c1..` 부여.
  - `candidateRefs(c)`, `findCandidate(c, ref)` export.
  - 게이트는 **배열 길이로만** 판정 (rich의 `errorCount>0||warnCount>0` 헤더 조건을 따라가면 warn-only 캡처에서 compact와 갈린다).
- **검증**
  - [ ] compact 캡 3 / rich 캡 5
  - [ ] `ref` 집합 = 실제 인쇄될 집합 (필터·캡 통과 후 부여라 번호가 연속)
  - [ ] 같은 엔드포인트 500 × 5 → 후보 1개
  - [ ] `element` 모드 → 빈 후보

### Task 3: 프롬프트에 후보·지시 반영

- **변경 대상**: `src/sidepanel/lib/prompts/draftRich.ts`, `src/sidepanel/lib/prompts/draftCompact.ts`
- **작업 내용**
  - 수동 slice를 `selectLogCandidates(ctx)` 순회로 교체. rich `[n1] GET /api/pay → 500 Internal Server Error` / compact `[n1] GET /api/pay → 500`.
  - 후보가 있을 때만 `logRefs` 출력 키 지시 추가. **"빈 배열이 정상"·"직접 증거만"을 명시** — 기본값은 안 넣는 것이다.
  - rich 규칙에 역할 분담 추가: 산문엔 짧게 지목하되 **request/response body 전문은 붙여넣지 말고 id로 넘긴다**. 기존 `draftRich.ts:176`("verbatim 인용")과 반쯤 충돌하므로 함께 조정.
  - `COMPACT_DRAFT_FEW_SHOT_LOGREFS` 추가 — 기존 예시와 동일하되 `"logRefs":[]`. **값을 채운 예시(`["n1"]`) 금지** — 실제 런에 없는 ref를 가르친다(console-only 캡처엔 `n1`이 없다).
- **검증**
  - [ ] rich/compact 양쪽에 `[n1]` 태그가 인쇄됨
  - [ ] **원본 UUID가 프롬프트에 없음**
  - [ ] 후보 0이면 `logRefs` 지시 줄 없음
  - [ ] compact 본문이 `COMPACT_SYSTEM_TARGET_CHARS = 2000` 불변식 유지

### Task 4: 스키마·파싱

- **변경 대상**: `src/sidepanel/lib/buildAiDraftPrompt.ts`
- **작업 내용**
  - `buildAiDraftSchema(sectionIds, opts?: { logRefs: string[] })` — opts 있을 때만 `{type:"array", items:{type:"string", enum: opts.logRefs}}` + `required`. `minItems` 없음.
  - `AiDraftResponse` 신설, `parseAiDraftResponse` 반환 타입 교체. `logRefs = Array.isArray(…) ? filter(typeof === "string") : []`. **후보 대조는 여기서 하지 않는다.**
  - `getDraftFewShot(ctx)` — compact이고 후보가 있으면 LOGREFS 변형.
  - `import type { EditorDraft }` 제거.
- **검증**
  - [ ] `buildAiDraftSchema(["stepsToReproduce"])`에 `logRefs` **없음** — `generateReproPrefill.ts:48` 무변경, `generateReproPrefill.test.ts:89` 무수정 통과
  - [ ] `parseAiDraftResponse`가 누락/비배열/혼합배열에서 `[]` 반환
  - [ ] 스키마가 `logRefs`를 안 실으면 few-shot도 그 키를 안 보여줌

### Task 5: ref → 코드블럭 렌더

- **변경 대상**: `src/sidepanel/lib/renderLogRefs.ts` (신규), `src/sidepanel/lib/markdownBlocks.ts` (신규)
- **작업 내용**
  - `markdownBlocks.ts`: `extractCodeBlocks` / `stripCodeBlocks` / `stripPreservedContent`. 들여쓰기 0의 fence만 매칭(내부 fence는 `neutralizeFences`가 4칸 들여쓴 상태).
  - `renderLogRefs.ts`: `MAX_LOG_REFS = 3`, `renderLogRefBlocks`, `codeBlockMarkdown`, `appendLogBlocks`.
  - 순서: 미지 ref 스킵 → 중복 ref 제거 → **유효 개수 > 3이면 `[]` + `console.warn`**(버린 개수 포함 — 임계값 보정 데이터).
  - `kind` 디스패치는 `findCandidate`의 `kind`로. **`n`/`c` 접두 파싱 금지.**
  - `appendLogBlocks`는 섹션 내 동일 텍스트 블록이 있으면 스킵(누적 중복 방어).
- **검증**
  - [ ] 후보에 없는 ref → 스킵, throw 없음
  - [ ] compact에서 `n5`(요약엔 있지만 미인쇄) → 스킵
  - [ ] 유효 4개 → `[]` + warn / 3개 → 3블록
  - [ ] `responseBody`에 백틱 3개 → 결과 마크다운의 비들여쓰기 fence가 정확히 2개
  - [ ] 이미 같은 블록이 있는 섹션에 같은 로그 → 안 늘어남

### Task 6: 코드블럭 보존 + strip 기준 교체

- **변경 대상**: `src/sidepanel/lib/mergeAiDraftSections.ts` + strip 사용처 5곳
- **작업 내용**
  - `mergeAiSectionsPreservingImages` → `mergeAiSectionsPreservingBlocks`. `out[id] = [...images, aiText, ...prevCodeBlocks]`.
  - **`stripInlineImageRefs` → `stripPreservedContent` 교체를 5곳 전부**: `draftRich.ts:145`, `draftCompact.ts:102`, `promptBudget.ts:40`, `promptBudget.ts:53`, `mergeAiDraftSections.ts:32`.
- **검증**
  - [ ] 코드블럭만 있는 섹션이 "절삭된 원문"으로 오인되지 않음 — **하나라도 빠지면 사용자 텍스트가 조용히 삭제된다**
  - [ ] 수동 삽입 블록이 AI 재생성 후 남음
  - [ ] 이미지 + 코드블럭 + AI 텍스트 순서: 이미지 → AI 산문 → 기존 블록
  - [ ] 기존 가드 3개(미프롬프트 섹션 prev 우선 / AI 키 누락 시 보존 / 이미지 hoist) 회귀 없음

### Task 7: 배선

- **변경 대상**: `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**
  - `fitDraftContext` 직후: `canInsertLogs = sectionIds.includes("description")`, `candidates = selectLogCandidates(fitted.ctx)` — **`ctx`가 아니라 `fitted.ctx`**, `refs = canInsertLogs ? candidateRefs(candidates) : []`.
  - `buildAiDraftSchema(sectionIds, refs.length ? { logRefs: refs } : undefined)`.
  - merge 이후: `refs.length && "description" in parsed.sections`일 때만 `appendLogBlocks(merged.description ?? "", renderLogRefBlocks(parsed.logRefs, {candidates, requests, entries}))`.
  - `requests`/`entries`는 **await 이전에 잡은 스냅샷**(`:88-89`의 지역 변수) 사용.
- **검증**
  - [ ] `description` 비활성 → 스키마·프롬프트에 `logRefs` 없음, 다른 섹션 폴백 없음
  - [ ] AI가 `description` 키 누락 → 블록 미삽입 + prev 보존 유지
  - [ ] 절삭 level≥1 → 후보·스키마·few-shot 동시 소멸

---

## 테스트 계획

### 단위 테스트 (Vitest, node 트랙 — 전부 순수 함수)

| 파일 | 케이스 |
|---|---|
| `lib/__tests__/buildLogSummary.test.ts` (확장) | 항목에 원본 `id` 동행; console dedup 동작 불변 |
| `lib/prompts/__tests__/logCandidates.test.ts` (신규) | compact 3 / rich 5 캡; ref 번호 연속·유일; network dedup; `element` → 빈 후보; warn-only console → 빈 후보(양 스타일 동일) |
| `lib/__tests__/renderLogRefs.test.ts` (신규) | 미지 ref 스킵; compact `n5` 스킵; 중복 ref 제거; **유효 4개 → `[]`**; 3개 → 3블록; **fence 무결성**(백틱 3개 든 body → 비들여쓰기 fence 정확히 2개); `appendLogBlocks` 동일 텍스트 스킵·`[]` identity·빈 섹션 선행 개행 없음 |
| `lib/__tests__/markdownBlocks.test.ts` (신규) | 들여쓰기 0 fence만 추출; 4칸 들여쓴 내부 fence 미추출; 미닫힘 fence는 텍스트 취급; `stripPreservedContent`가 이미지+코드블럭 제거 |
| `lib/__tests__/buildAiDraftPrompt.test.ts` (확장) | `buildAiDraftSchema(ids)`에 `logRefs` **없음**(회귀 가드); `opts` 전달 시 enum 생성 + required; `parseAiDraftResponse` `logRefs` 방어적 파싱; rich/compact 프롬프트에 `[n1]` 인쇄; **UUID 미노출**; 후보 0이면 지시 줄 없음; few-shot 변형 선택 |
| `lib/prompts/__tests__/promptBudget.test.ts` (확장) | **level≥1 절삭 후 `selectLogCandidates(fitted.ctx)`가 빈 배열** — 절삭 결합 계약의 전부 |
| `lib/__tests__/mergeAiDraftSections.test.ts` (확장) | 코드블럭 보존; 코드블럭만 있는 섹션이 "절삭된 원문"으로 오인 안 됨; 이미지+블록+AI텍스트 순서; 기존 가드 3개 회귀 |
| `lib/__tests__/generateReproPrefill.test.ts` (무수정 통과) | `buildAiDraftSchema(["stepsToReproduce"])` 동등성 — **수정 없이 green이어야 오염 없음이 증명된다** |

**기존 리터럴 갱신(기계적, TS가 안내)**: `topErrors: string[]`를 인라인 구성하는 `buildNotionIssueBody.test.ts:498`, `buildLinearIssueBody.test.ts:303`, `promptBudget.test.ts:32`, `buildAiDraftPrompt.test.ts:162/262/382/690/773`.

### e2e 시나리오 (`/e2e-write` 입력)

`e2e/ai-draft.spec.ts`가 이미 BYOK `/chat/completions`를 고정 JSON으로 목킹한다(`:57`). **유닛으로 못 보는 유일한 구간(tiptap 마크다운 왕복 → 실제 `codeBlock` 노드)을 여기서 증명한다.**

- console 에러를 뱉는 fixture에서 화면 캡처 후 AI 초안을 돌리고 `MOCK_DRAFT`가 `"logRefs":["c1"]`을 반환하면, 발생 현상 에디터에 `codeBlock` 노드가 1개 생긴다.
- `MOCK_DRAFT`가 `"logRefs":[]`를 반환하면 `codeBlock` 노드가 0개다.
- `MOCK_DRAFT`가 후보에 없는 `"logRefs":["n9"]`를 반환하면 `codeBlock` 노드가 0개다.
- `MOCK_DRAFT`가 유효 ref 4개를 반환하면 `codeBlock` 노드가 0개다.
- 수동으로 로그를 삽입한 뒤 AI 초안을 돌리면 그 `codeBlock`이 그대로 남아 있다.

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
Task 5 (렌더)      ──┤  ← 3·5·6은 서로 독립, 병렬 가능
Task 6 (보존+strip) ──┘
  ↓
Task 4 (스키마·파싱)
  ↓
Task 7 (배선)
```

Task 1~2는 **동작 중립**이다(`[n1]` 태그가 프롬프트에 붙는 것 외엔 AI 가시 변화 없음). 실제 기능은 4~7에서 켜진다. Task 6은 회귀 위험이 가장 크므로(strip 기준 5곳 교체) 독립 커밋으로 분리하고 테스트를 먼저 박는다.

## 가이드 영향

**있음.** AI 초안이 로그를 자동 삽입하는 건 사용자 노출 동작 변화다. 구현 후 `/guide`로 처리하고, 작성 전 `guide/AUTHORING.md`를 먼저 읽는다.

대조·갱신 대상(ko·en 양쪽):
- `screenshot/issue.md` — 화면 캡처 AI 초안 설명에 "관련 로그를 코드블럭으로 함께 넣어준다" 반영
- `video/issue.md` — 동일
- `settings/ai.md` — AI 기능 범위 설명에 반영
- `element/issue.md` — **무관**(element 모드는 `supportsConsoleNetworkLog` 제외라 로그 자체가 없음). 대조만 하고 손대지 않는다.

`faq.md`는 "AI가 로그를 지어내나?"류 질문이 생길 수 있으므로 `/guide` 판단에 맡긴다 — id-only 불변식은 사용자에게 설명할 가치가 있는 privacy·정확성 서사다.
