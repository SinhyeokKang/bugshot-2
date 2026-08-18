# audit-refactor-7 — 구현 태스크

## 선행 조건

- `docs/POSTMORTEM.md`를 변경 영역으로 grep해 과거 함정을 소환한다(CLAUDE.md 소환 회로). 이 배치에 직접 걸리는 것: 2026-08-16(계획-태스크 불일치)·2026-08-15(import 혼용 반경 오산)·2026-07-16(단일 출처 승격 주석이 거짓)·2026-07-14(콤보박스 검색어 수명)·2026-06-28(복제 dict 미동기화).
- 새 의존성 없음. 권한·env·OAuth 앱 설정 변경 없음. manifest 변경 없음.
- 신규 i18n 키는 **1개**(`issueList.linear.noStates`) — 등록 로케일 전부 + 필요 시 log-viewer 복제 사전 확인.
- `pnpm build`는 돌리지 않는다(CLAUDE.md). 타입 확인은 `pnpm typecheck`. 예외는 G6·G7의 번들 경계 최종 확인 1회로, 사용자 승인 또는 `/build`로만 한다.

---

## 항목 ↔ 태스크 대조표

**이 표가 이 문서의 계약이다.** POSTMORTEM 2026-08-16이 "design.md가 편입했다고 명시한 항목이 tasks.md 어느 태스크에도 없어 배치가 조용히 약속을 어길 뻔했다"를 기록했다. 착수 전과 완료 후 두 번 대조하고, 미배정 행이 하나라도 있으면 배치를 닫지 않는다.

| # | 항목 요약 | 그룹 | 태스크 |
|---|---|---|---|
| 1 | 🔴 `IssueCreateModal` 비활성 이유 툴팁 미노출 | G4 | Task 4 |
| 2 | `serializeOAuthError` 401 fallthrough | G5 | Task 5-1 |
| 3 | `notion-oauth.exchangeCode` 본문 error 미검사 | G5 | Task 5-2 |
| 4 | 업로드 응답 4종 판별자 부재 | G5 | Task 5-3 |
| 5 | `scrollCaptureTo` settle 예외 시 무응답 | G1 | Task 1-1 |
| 6 | 클립보드 복사 첫 await가 IDB 왕복 | G3 | Task 3 |
| 7 | css 캐시 실패 promise 영구 메모이즈 | G1 | Task 1-3 |
| 8 | store → `annotation/presets` value import | G6 | Task 6-1 |
| 9 | store → `picker-control` value import | G6 | Task 6-2 |
| 10 | `apply()` read가 activation 큐 밖 | G9 | Task 9 |
| 11 | picker css 보강 IIFE `.catch` 부재 2곳 | G1 | Task 1-2 |
| 12 | `aria-labelledby` 다중 ID 미파싱 → 마스킹 우회 | G2 | Task 2 |
| 13 | `sidepanel/index.html` `lang="ko"` 고정 | G10 | Task 10-1 |
| 14 | `log-viewer/index.html` `lang="en"` 고정 | G10 | Task 10-2 |
| 15 | `FILTER_LABEL` 테이블이 i18n 스캐너 사각 | G10 | Task 10-3 |
| 16 | `markers.ts` 삼항 `t()`가 스캐너 사각 | G10 | Task 10-3 |
| 17 | `LinearStatusBadge` 빈 목록 분기 부재 | G11 | Task 11-1 |
| 18 | `PropertiesFieldset` FieldRow 손복제 | G11 | Task 11-2 |
| 19 | `JsonTreeViewer` "n개 더"가 div onClick | G11 | Task 11-3 |
| 20 | `LlmConnectForm` 빈 상태 아이콘 muted 누락 | G11 | Task 11-4 |
| 21 | `DomTreeDialog` raw button 직접 스타일링 | G11 | Task 11-5 |
| 22 | `imageCell` 3벌 + markdown판 escape 누락 | G7 | Task 7-2 |
| 23 | `escapeHtml` 사본 드리프트 | G7 | Task 7-1 |
| 25 | `MarkdownIt` 설정 4벌 | G7 | Task 7-3 |
| 28 | `SingleLazyCombobox` 미채택 6파일 | G8 | Task 8-1 |
| 29 | 원격 검색 3벌 + `useDebouncedSearch` 갇힘 | G8 | Task 8-2 |
| 30 | frozen phase 집합 3벌 | G7 | Task 7-4 |
| 32 | `setAnnotationTool` 인자 중복 | G12 | Task 12-1 |
| 33 | `readErrorBody` 테스트 0 | G12 | Task 12-2 |
| 34 | import 표기 이탈 2건 + 신규 유입 그물 | G12 | Task 12-3 |

> #24·#26·#27·#31은 **의도적 제외**(prd.md 스코프 표). #59는 ⚪라 애초에 스코프 밖. 배치 종료 시 Task 13-1이 이 사실을 `DROPPED.md`에 추기한다.

---

## P0 — 무음 유실 · 행 · Privacy

### Task 0: 회귀 그물 선행 (G0)

- **변경 대상**: `src/sidepanel/lib/__tests__/issueBodyShared.test.ts`, `src/content/__tests__/action-recorder-helpers.test.ts`(신설 가능)
- **작업 내용**: G2·G7이 건드릴 순수 함수의 **현재 동작을 먼저 고정**한다. 동작 보존이 목표이므로 TDD red가 아니라 characterization test다.
  - `imageCell` 3벌의 현재 출력을 같은 입력으로 대조하는 케이스 (통합 전에 차이를 표로 남긴다 — markdown판만 escape가 빠진 것이 여기서 red로 드러나야 한다).
  - `labelForText`의 현재 동작(단일 ID·`label[for]`·래핑 label) 고정. 다중 ID는 **아직 red**로 둔다(Task 2가 green으로 만든다).
- **검증**:
  - [ ] `pnpm test` — 신규 케이스 중 "다중 ID"와 "markdown판 escape"만 red, 나머지 green
  - [ ] red인 케이스가 정확히 2종인지 확인 (더 많으면 감사 리포트가 놓친 게 있다는 신호 — 보고 후 판단)

### Task 1-1: 스크롤 캡처 settle 예외 격리 (G1 · #5)

- **변경 대상**: `src/content/scroll-capture.ts`(`settle`), `src/content/picker.ts:316`
- **작업 내용**: design.md G1 그대로. `settle` 본문의 후보 수집·숨김을 `try/catch`로 감싸 `resolve`가 항상 불리게 하고, `picker.scrollCaptureTo` 수신부를 `.then(sendResponse, () => sendResponse(undefined))`로 바꾼다.
- **주의**: 실패 시 **절대 `{y: ...}`를 지어내지 않는다.** 오케스트레이터의 `if (!ack) throw`가 "스크롤 안 된 화면을 성공으로 스티치하지 않는다"는 계약이고, ack를 만들면 그 계약을 깬다.
- **검증**:
  - [ ] `src/content/__tests__/scroll-capture.test.ts`에 "후보 수집이 throw해도 promise가 resolve된다" 케이스 추가 → green
  - [ ] 기존 `scroll-capture` 유닛 전부 green (동작 보존)
  - [ ] `grep -n "then(sendResponse)" src/content/picker.ts` → 0건

### Task 1-2: picker 보강 IIFE `.catch` 부착 (G1 · #11)

- **변경 대상**: `src/content/picker.ts:142`, `src/content/picker.ts:1181`
- **작업 내용**: 두 async IIFE에 `.catch(() => {})`를 붙인다. 같은 파일 `respondAfterPaint:377`·`area-select.ts:36`이 지배 패턴이다. **삼킨다는 사실과 이유**를 한 줄 주석으로 남긴다(보강 실패 = 인스펙터 값이 덜 풍부해질 뿐, 캡처를 막지 않는다).
- **검증**:
  - [ ] `grep -n "void (async () =>" -A 1 src/content/picker.ts`로 `.catch` 없는 IIFE 0건
  - [ ] `pnpm typecheck` green

### Task 1-3: css 캐시 실패 promise 재시도 가능화 (G1 · #7)

- **변경 대상**: `src/content/css-source-cache.ts`(`ensureLoaded`·`ensureCrossOriginLoaded`)
- **작업 내용**: design.md G1의 코드 형태. 실패 시 슬롯을 비우되 **`loadPromise === p` 확인 필수** — `invalidate()`가 이미 `null`을 넣으므로, 확인 없이 지우면 invalidate 뒤 새로 깔린 promise를 죽인다.
- **주의**: 이 파일은 **회고 상위 영역**이다. 착수 전 ARCHITECTURE.md "CSSOM shorthand 한계 우회"와 `css-source-cache-epoch.test.tsx`를 읽는다. epoch·stale 판정에는 손대지 않는다.
- **검증**:
  - [ ] `src/content/__tests__/css-source-cache-epoch.test.tsx` 기존 케이스 전부 green
  - [ ] "로드 실패 후 재호출하면 새로 시도한다" 케이스 추가 → green
  - [ ] "invalidate 뒤 실패한 이전 promise가 새 슬롯을 지우지 않는다" 케이스 추가 → green

### Task 2: `aria-labelledby` 다중 ID 파싱 (G2 · #12)

- **변경 대상**: `src/content/action-recorder.ts`(`labelForText` 제거), `src/content/action-recorder-helpers.ts`(`labelForText` 이관·확장)
- **작업 내용**: `labelForText`를 헬퍼 파일로 옮기고 `aria-labelledby`를 공백으로 쪼개 각 ID를 조회·연결한다. `document` 의존은 **인자로 빼지 않는다**(요청되지 않은 유연성 — jsdom 트랙이 실제 DOM으로 검증한다).
- **검증**:
  - [ ] Task 0에서 red였던 "다중 ID" 케이스 green
  - [ ] `<input aria-labelledby="l1 l2">` + 민감 라벨 조합에서 `shouldMaskField`가 `true`를 내는 통합 케이스 추가 → green
  - [ ] 단일 ID·`label[for]`·래핑 label 3경로 무회귀
  - [ ] `grep -n "getElementById(labelledBy)" src/content/` → 0건

### Task 3: 클립보드 복사 gesture 보존 (G3 · #6)

- **변경 대상**: `src/sidepanel/tabs/PreviewPanel.tsx`(`handleCopyMarkdown`)
- **작업 내용**: 본문 조립을 `buildMarkdownForCopy(): Promise<string>`로 그대로 들어내고, `navigator.clipboard.write([new ClipboardItem({ "text/plain": <Promise<Blob>> })])`를 클릭 핸들러에서 **동기로** 호출한다. 조립 로직 자체는 한 줄도 바꾸지 않는다.
- **주의**: Promise가 reject되면 `write` 전체가 reject된다. 기존 실패 처리(토스트·폴백)가 그 경로로 도달하는지 확인한다.
- **검증**:
  - [ ] `pnpm typecheck` green
  - [ ] 복사 결과 문자열이 기존과 바이트 동일 — `buildMarkdownForCopy`를 직접 부르는 유닛으로 고정
  - [ ] **수동**: 인라인 이미지 3개 이상 붙인 프리뷰에서 복사 → 붙여넣기로 본문 확인 (jsdom에 `ClipboardItem`이 없어 자동화 불가)

### Task 4: 🔴 제출 버튼 비활성 이유 노출 (G4 · #1)

- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx:497`
- **작업 내용**: `IssueTab.tsx:368-386`의 형태를 그대로 복사한다 — `TooltipProvider delayDuration={0}` → `Tooltip` → `TooltipTrigger asChild` → `Button aria-disabled` + `aria-disabled:*` className 4종 → `onClick`에 `if (!canOpen) return;` 가드 → `{!canOpen && <TooltipContent>{t("platform.empty.title")}</TooltipContent>}`. 기존 `tooltip` 변수를 재사용하고 `data-testid="issue-submit-open"`을 유지한다.
- **검증**:
  - [ ] `IssueCreateModal.test.tsx`에 "연동 0개면 버튼이 `aria-disabled`이고 클릭해도 다이얼로그가 안 열린다" 케이스 → green
  - [ ] "연동 0개면 툴팁 문구가 렌더된다" 케이스 → green
  - [ ] 기존 e2e에서 `issue-submit-open`을 잡는 스펙 무회귀 (`grep -rn "issue-submit-open" e2e/`로 영향 스펙 먼저 확인)

---

## P1 — 계약 · 경계 · 단일 출처

### Task 5-1: OAuth 401 레인을 명시 플래그로 뒤집기 (G5 · #2)

- **변경 대상**: `src/background/oauth/errors.ts`(`OAuthError.refreshFailed` 추가), `src/background/oauth.ts:59`(`serializeOAuthError`), refresh 경로 전수
- **작업 내용**: design.md G5. 기본값을 400 + `oauthConnectFailed`로 내리고 401은 `error.refreshFailed === true`일 때만. `refreshFailed`를 세우는 지점을 **grep으로 전수 확인해 목록으로 박는다** — `background/lib/createRefreshRunner.ts` + `{github,gitlab,linear,asana}-oauth.ts`의 refresh + Jira 직접 경로.
- **주의**: 세우는 지점을 빠뜨리면 **반대 방향 회귀**다(진짜 만료인데 배너가 안 뜬다). 판독부(`readErrorBodyFlag` 소비처)는 무변경 — 새 플래그의 reader를 만들지 않는다(그 파일 주석의 명시 규칙).
- **검증**:
  - [ ] `src/background/__tests__/oauth.test.ts`에 케이스 추가: refresh 실패 → 401+`oauthRefreshFailed` / state mismatch → 400+`oauthConnectFailed` / cancelled·notConfigured·launchFailed 기존 동작 무회귀
  - [ ] refresh 경로 전수 목록이 태스크 결과에 적혀 있고 각 지점에 플래그가 세워짐
  - [ ] `pnpm test` green

### Task 5-2: notion 토큰 응답 error 검사 (G5 · #3)

- **변경 대상**: `src/background/notion-oauth.ts:72`(`exchangeCode`)
- **작업 내용**: 형제 5종에서 **정확한 관용구를 복사**한다(새로 설계하지 않는다). 200 + `{error}` 본문이면 `OAuthError`로 던져 `classifyConnectReason`이 `grantRejection` 레인을 타게 한다.
- **검증**:
  - [ ] `notion-oauth` 테스트에 "200 + error 본문이면 throw" 케이스 → green
  - [ ] 정상 토큰 응답 경로 무회귀
  - [ ] 다른 5종과 형태가 같은지 눈으로 대조 (diff를 나란히 본다)

### Task 5-3: 업로드 응답 판별자 통일 (G5 · #4)

- **변경 대상**: `src/types/messages.ts`(응답 타입 먼저), `src/background/messages.ts:575`(asana)·`:492`(gitlab)·`:647`(clickup), `src/background/github-upload.ts:139`, 그리고 **typecheck가 짚는 소비처 전부**
- **작업 내용**: **타입부터 바꾼다.** `{ ok: true; ... } | { ok: false; filename }` 판별자 union으로 바꾸면 컴파일러가 소비처를 전부 가리킨다. Slack 경로(`{ok: boolean}`)가 이미 준수하고 있으므로 그 형태에 맞춘다.
- **주의**: 이 응답은 **이슈 제출 경로**다. 회귀 시 첨부가 조용히 빠진다. 4개 플랫폼 각각의 성공/실패 분기를 개별로 확인한다.
- **검증**:
  - [ ] `pnpm typecheck` — 소비처 누락 0
  - [ ] 플랫폼 4종 각각 "업로드 1건 실패해도 나머지가 첨부되고, 실패분이 실패로 판정된다" 케이스 → green
  - [ ] `submitAdapters.test.ts`·`prepareUpload.test.ts` 무회귀
  - [ ] `grep -n "gid: null" src/background/messages.ts` 잔존이 판별자로 대체됐는지 확인

### Task 6-1: 어노테이션 기본값 leaf 승격 (G6 · #8)

- **변경 대상**: `src/sidepanel/lib/annotationDefaults.ts`(신규), `src/sidepanel/components/annotation/presets.ts`(re-export), `src/store/editor-store.ts:16`
- **작업 내용**: store가 실제로 쓰는 `DEFAULT_COLOR`·`DEFAULT_THICKNESS`·`ThicknessKey`만 leaf로 뗀다. `presets.ts`는 거기서 re-export해 **기존 소비처를 안 건드린다**(외과적 변경).
- **검증**:
  - [ ] `grep -rn '@/sidepanel/components' src/store/` → 0건
  - [ ] `pnpm typecheck` green, `pnpm test` green
  - [ ] `presets.ts`의 기존 소비처가 전부 그대로 동작 (import 경로 무변경)

### Task 6-2: `clearPicker` 분리 (G6 · #9)

- **변경 대상**: `src/sidepanel/picker-clear.ts`(신규), `src/sidepanel/picker-control.ts`(re-export), `src/store/issues-store.ts:8`
- **작업 내용**: `recorder-control.ts:2-4`가 기록한 분리 선례를 그대로 따른다. **착수 첫 단계로 `clearPicker` 본문을 읽고 store 의존 유무를 확인한다** — 의존이 있으면 분리가 순환을 못 끊으므로 design.md 대안 B로 전환하고 그 사실을 결과에 적는다.
- **검증**:
  - [ ] `grep -rn '@/sidepanel/picker-control' src/store/` → 0건
  - [ ] `pnpm typecheck` green, `pnpm test` green
  - [ ] `picker-control`의 기존 소비처 무변경

### Task 6-3: 번들 경계 최종 확인 (G6)

- **변경 대상**: 없음 (확인만)
- **작업 내용**: typecheck·테스트가 못 잡는 축이라 산출물로 확인한다. **`pnpm build`는 사용자 승인 또는 `/build`로만** 돌린다.
- **검증**:
  - [ ] `grep -rn '@/sidepanel' src/store/` → 0건
  - [ ] (승인 시) `pnpm build` 후 `dist/assets/` 청크 크기가 배치 전 대비 증가하지 않음
  - [ ] (승인 시) `pnpm check:prearm` green

### Task 7-1: `escapeHtml` 단일 출처 (G7 · #23)

- **변경 대상**: `src/lib/escapeHtml.ts`(승격), `src/sidepanel/lib/escapeHtml.ts`(제거 또는 re-export), `src/content/overlay.ts:685`(사본 제거)
- **작업 내용**: 정본을 `src/lib/`로 올리고 양쪽이 import. **동작 통일 방향은 `'` 포함**(넓은 쪽)이되, 정본 소비처의 골든 스냅샷이 흔들리는지 먼저 확인하고 흔들리면 overlay만 정본에 맞춘다.
- **검증**:
  - [ ] `grep -rn "replace(/&/g" src/` → 정의 1곳만
  - [ ] 골든 스냅샷 무변경 (흔들리면 방향 재판단)
  - [ ] `pnpm check:prearm` green (content가 `@/lib`를 끄는 것이 청크에 영향 없는지 — design.md 위험 ②)

### Task 7-2: `imageCell` 통합 (G7 · #22)

- **변경 대상**: `src/sidepanel/lib/issueBodyShared.ts`(추가), `buildMarkdownIssueBody.ts:45`·`buildClickupIssueBody.ts:35`·`buildLinearIssueBody.ts:32`
- **작업 내용**: url을 인자로 받는 `imageCell(filename, url)`로 올린다(미디어 타입을 leaf가 알면 순환 — 그 파일의 `LogSummaryContext` 선례). linear는 `assetUrl`을 넘긴다. `escapeMdLinkText`를 포함시킨다.
- **주의**: **여기서만 골든 스냅샷이 흔들릴 수 있다.** 흔들리면 markdown 경로의 escape 누락이 고쳐진 것이지만, 갱신 전에 diff를 눈으로 읽고 **바뀐 줄이 전부 링크 텍스트 이스케이프인지** 확인한다.
- **검증**:
  - [ ] Task 0의 "markdown판 escape 누락" red 케이스 green
  - [ ] `grep -rn "function imageCell" src/sidepanel/lib/` → 1건
  - [ ] 골든 스냅샷 diff의 모든 변경 줄이 이스케이프 차이로 설명됨 (아니면 중단·보고)

### Task 7-3: `MarkdownIt` 팩토리 (G7 · #25)

- **변경 대상**: `src/sidepanel/lib/markdownIt.ts`(신규), `markdownToAdf.ts:19`·`markdownToNotionBlocks.ts:7`·`markdownToAsanaHtml.ts:10`·`renderMarkdown.ts:16`
- **작업 내용**: `createMarkdownIt(options?)` 팩토리. **인스턴스는 파일별로 유지**한다(공유하면 한 파일의 `md.use()`가 나머지에 샌다).
- **주의**: `builderLocaleWrap.test.ts`가 `sidepanel/lib` 전체를 훑는다 — **신규 파일이 래핑·면제 어느 분류에도 없으면 red**다. 파서 팩토리라 면제 분류에 등록한다.
- **검증**:
  - [ ] `grep -rn "MarkdownIt({" src/` → `markdownIt.ts` 1곳만
  - [ ] `builderLocaleWrap.test.ts` green (면제 등록 후)
  - [ ] 골든 스냅샷 무변경 (동치 통합이라 흔들리면 오류 신호)

### Task 7-4: frozen phase 단일 출처 (G7 · #30)

- **변경 대상**: `src/sidepanel/hooks/useEditorSessionSync.ts:46`(`DRAFT_PHASES` 제거)·`:269-272`(인라인 재열거 → `FROZEN_PHASES.has`)
- **작업 내용**: `lib/session-keys.ts:42`의 `FROZEN_PHASES`로 수렴. 그 파일은 양 realm 공유 leaf라 import 방향 문제 없다.
- **검증**:
  - [ ] `grep -rn '"drafting"' src/sidepanel/hooks/useEditorSessionSync.ts` → 0건
  - [ ] `useEditorSessionSync.test.ts` 무회귀
  - [ ] phase 3종 각각에서 picker clear 동작 무변경

### Task 8-1: `SingleLazyCombobox` 수렴 (G8 · #28)

- **변경 대상**: `linearFields/{Label,Team,Project,Assignee}Combobox.tsx`, `tabs/ProjectCombobox.tsx`, `tabs/IssueTypeCombobox.tsx`
- **작업 내용**: 기존 prop 표면(11개)에 **들어가는 것만** 옮긴다. **prop을 새로 늘리지 않는다.** 못 들어가는 파일은 남기고 이유를 결과에 적는다 — 전량 이행을 약속하지 않는다.
- **주의**: POSTMORTEM 2026-07-14(콤보박스 검색어 state가 팝오버 언마운트와 수명이 달라 "선택자 상단 고정"이 영구히 꺼짐)와 2026-08-xx(cmdk controlled value 역통보)를 착수 전에 읽는다. `pinSelected` 동작이 이행 후에도 유지되는지가 핵심 회귀 지점이다.
- **검증**:
  - [ ] 파일별 기존 `*.test.tsx`가 있으면 전부 green, 없으면 이행한 파일마다 "열면 1회 로드 / 선택하면 onSelect / 선택 항목이 상단 고정" 3케이스 추가
  - [ ] 이행한 파일 수 + 남긴 파일 수 + 남긴 이유가 결과에 적혀 있음
  - [ ] `pnpm typecheck` green

### Task 8-2: `useDebouncedSearch` 승격·채택 (G8 · #29)

- **변경 대상**: `src/sidepanel/hooks/useDebouncedSearch.ts`(jiraFields에서 이동), `githubFields/RepoCombobox.tsx`·`gitlabFields/ProjectCombobox.tsx`·`notionFields/DatabaseCombobox.tsx`, 기존 jiraFields 소비처
- **작업 내용**: 훅 본문은 **바꾸지 않는다.** 3파일의 인라인판(`reqIdRef` + 300ms + seq 가드)과 동치인지 먼저 대조하고, 다르면(cleanup 반환 형태 등) 차이를 적고 **호출부를 훅에 맞춘다**.
- **검증**:
  - [ ] `grep -rn "reqIdRef" src/sidepanel/` → 0건
  - [ ] 훅에 "stale 응답을 무시한다" 케이스가 없으면 추가 → green
  - [ ] 3파일 각각 "타이핑 후 300ms에 1회만 조회 / 연속 입력 시 마지막 것만 반영" 케이스 → green
  - [ ] jiraFields 기존 소비처 무회귀

### Task 9: activation 큐에 `apply` 편입 (G9 · #10)

- **변경 대상**: `src/background/tab-bindings.ts:301-330`
- **작업 내용**: `apply()`의 read→`setOptions`를 write와 같은 큐에 태운다. 큐 헬퍼는 그 파일에 이미 있다 — 새 구조를 만들지 않는다.
- **주의**: **`apply`가 큐 안에서 자기 자신을 부르는 재진입이 없는지** 확인한다(있으면 데드락). `deactivatePanelIfCrossOrigin`·`clearIfPageChanged` 경로를 따라간다.
- **검증**:
  - [ ] `tab-bindings` 유닛에 "onActivated와 onUpdated가 겹쳐도 setOptions 커밋 순서가 큐 순서와 같다" 케이스 → green
  - [ ] 재진입 없음을 코드 경로로 확인 (결과에 근거 한 줄)
  - [ ] **수동**: 탭 A(지원)↔탭 B(미지원) 빠른 전환 + cross-origin 네비게이션 중 패널 깜빡임 없음 — 경합은 실동작에서만 난다

---

## P2 — 컨벤션 · 그물

### Task 10-1: 사이드패널 문서 언어 런타임 반영 (G10 · #13)

- **변경 대상**: `src/sidepanel/index.html:2`, `src/sidepanel/hooks/useThemeEffect.ts`(또는 같은 계층의 신규 lang effect)
- **작업 내용**: html을 중립값으로 두고 로케일 확정 지점에서 `document.documentElement.lang = BCP47[locale]`. `BCP47`은 **폴백 금지 테이블**이라 `Record<LocaleMode, …>`를 유지한 채 소비한다.
- **검증**:
  - [ ] `useThemeEffect.test.tsx`(또는 신규)에 "로케일이 en이면 documentElement.lang이 en" 케이스 → green
  - [ ] 로케일 전환 시 lang이 따라 바뀜
  - [ ] `src/i18n/locales.ts` 무변경 (런타임 import 0 규칙 유지)

### Task 10-2: log-viewer 문서 언어 반영 (G10 · #14)

- **변경 대상**: `src/log-viewer/index.html:2`, log-viewer 엔트리
- **작업 내용**: 별도 빌드라 `@/i18n` alias를 못 쓴다 — **상대경로로** 자기 사전의 로케일을 읽어 같은 방식으로 세운다.
- **검증**:
  - [ ] `pnpm build:log-viewer` 성공 (이 빌드는 허용 — 산출물이 테스트 선행 조건이다)
  - [ ] `src/log-viewer/__tests__/` 무회귀

### Task 10-3: log-viewer i18n 스캐너 사각 제거 (G10 · #15 #16)

- **변경 대상**: `src/log-viewer/components/TimelinePanel.tsx:23`, `src/log-viewer/markers.ts:147`, `src/log-viewer/__tests__/i18n.test.ts`(앵커 추가)
- **작업 내용**: 코드를 스캐너가 보는 형태로 바꾼다(design.md 대안 E — 정규식을 넓히는 쪽은 기각). `FILTER_LABEL` 테이블 조회와 삼항 `t()`를 리터럴 인자 호출로 펼친다.
- **검증**:
  - [ ] 수정 후 6개 키(`timeline.filter.*` 4 + `actionLog.verb.toggle.*` 2)가 `referencedKeys`에 들어오는지 **자기검증 앵커** 케이스로 고정 → green
  - [ ] `src/log-viewer/__tests__/i18n.test.ts` 전체 green
  - [ ] 화면 문구 무변경

### Task 11-1: Linear 상태 빈 목록 안내 (G11 · #17)

- **변경 대상**: `src/sidepanel/tabs/statusBadges/LinearStatusBadge.tsx:97`, `src/i18n/namespaces/*`(키 1개)
- **작업 내용**: `JiraStatusBadge.tsx:100`의 형태를 복사. 신규 키 `issueList.linear.noStates`를 **등록 로케일 전부** 채운다(훅이 `locales.test.ts`를 자동 실행해 red로 막는다).
- **검증**:
  - [ ] `locales.test.ts` green (전 로케일 대칭)
  - [ ] `LinearStatusBadge` 테스트에 "states가 빈 배열이면 안내 문구" 케이스 → green
  - [ ] 로딩·정상 목록 경로 무회귀

### Task 11-2: `PropertiesFieldset` FieldRow 이행 (G11 · #18)

- **변경 대상**: `src/sidepanel/tabs/notionFields/PropertiesFieldset.tsx:35`
- **작업 내용**: 손복제 마크업을 `FieldRow`로 교체하고 `htmlFor`를 채운다(현재 누락). `FieldRow`가 `grid gap-1.5` + `label text-xs text-muted-foreground`로 바이트 동일이라 drop-in이다.
- **검증**:
  - [ ] 렌더 결과 DOM이 기존과 동일 (`htmlFor` 추가분 제외)
  - [ ] 라벨 클릭 시 연결된 컨트롤로 포커스 이동 (`htmlFor`가 실제로 붙었는지)
  - [ ] `pnpm test` green

### Task 11-3: `JsonTreeViewer` "n개 더" 키보드 접근 (G11 · #19)

- **변경 대상**: `src/sidepanel/components/JsonTreeViewer.tsx:209`
- **작업 내용**: `<div onClick>`를 `<button type="button">`로. 기존 className과 자리맞춤 `<span className="inline-block h-4 w-4 shrink-0" />`를 유지한다.
- **검증**:
  - [ ] `JsonTreeViewer.test.tsx`에 "Enter/Space로 더 보기가 동작한다" 케이스 → green
  - [ ] 시각적 변화 없음 (className 유지 — 렌더 스냅샷이 있으면 대조)

### Task 11-4: 빈 상태 아이콘 muted (G11 · #20)

- **변경 대상**: `src/sidepanel/tabs/settings/LlmConnectForm.tsx:81`
- **작업 내용**: `<Bot className="h-6 w-6" />` → `h-6 w-6 text-muted-foreground`. 다른 6곳과 일치시킨다.
- **검증**:
  - [ ] `grep -rn 'className="h-6 w-6"' src/sidepanel/tabs/settings/` → 빈 상태 아이콘 잔존 0
  - [ ] 라이트·다크 양쪽 대비 확인 (수동 또는 스냅샷)

### Task 11-5: `DomTreeDialog` 트리거 shadcn 이행 (G11 · #21)

- **변경 대상**: `src/sidepanel/tabs/DomTreeDialog.tsx:66`
- **작업 내용**: raw `<button>` → `Button variant="ghost"`. `data-testid="dom-tree-trigger"`·`title`·`truncate`·`text-2xl font-semibold`를 유지한다.
- **주의**: **e2e가 이 testid를 잡는다.** `grep -rn "dom-tree-trigger" e2e/`로 영향 스펙을 먼저 확인하고, `Button`의 기본 패딩·높이가 레이아웃을 바꾸는지 본다(바꾸면 className으로 되돌린다).
- **검증**:
  - [ ] `DomTreeDialog.test.tsx` green
  - [ ] 해당 e2e 스펙 green
  - [ ] 트리거 텍스트가 여전히 `truncate`로 잘리고 중앙 정렬 유지

### Task 12-1: `setAnnotationTool` 시그니처 축소 (G12 · #32)

- **변경 대상**: `src/content/annotation.ts:252`, `src/content/picker.ts:328-333`
- **작업 내용**: `setAnnotationTool(style: PenStyle | null)` 단일 인자로. `tool === null` 게이트는 `style === null`로 대체된다(호출부가 이미 동치).
- **검증**:
  - [ ] `pnpm typecheck` green
  - [ ] 어노테이션 도구 on/off·전환 유닛 무회귀
  - [ ] **수동**: 실제 페이지에서 pen·rect·highlight 전환 + off (캔버스라 유닛으로 못 잡는다)

### Task 12-2: `readErrorBody` 테스트 (G12 · #33)

- **변경 대상**: `src/background/lib/__tests__/readErrorBody.test.ts`(신규)
- **작업 내용**: 3갈래 고정 — JSON 본문 → 파싱된 객체 / 비-JSON → 원문 문자열 / `res.text()` 자체 throw → `undefined`.
- **검증**:
  - [ ] 3케이스 green
  - [ ] 소비처 5파일(github·clickup·jira·gitlab·asana api)의 기존 테스트 무회귀

### Task 12-3: import 표기 이탈 + 신규 유입 그물 (G12 · #34)

- **변경 대상**: `src/background/lib/createRefreshRunner.ts:3`, `src/types/picker.ts:1-3`, `src/lib/__tests__/importConvention.test.ts`(신규)
- **작업 내용**: 두 이탈을 상대경로로. 소스 스캔 테스트는 `src/background`·`src/types`·`src/store`·`src/i18n`만 검사하고 **`src/sidepanel`은 대상에서 뺀다**(현재 혼용 70파일이라 즉시 red이고, 예외 목록을 박으면 그물이 아니라 장부가 된다 — 그 사실을 테스트 파일 주석에 남긴다).
- **검증**:
  - [ ] `grep -rn 'from "@/background/' src/background/` → 0건
  - [ ] `grep -rn 'from "@/types/' src/types/` → 0건
  - [ ] 신규 테스트가 일부러 넣은 위반에 red를 내는지 확인 후 되돌림 (vacuous green 방지)
  - [ ] sidepanel 측정치(441 / 502 / 혼용 70)를 테스트 주석 또는 design.md에 기록

### Task 13-1: DROPPED.md 추기 (배치 종료)

- **변경 대상**: `docs/features/DROPPED.md`
- **작업 내용**: audit-refactor-6 ④·⑥ 항목에 "2026-08-18 전체 재감사에서 같은 항목이 다시 나왔다(#24·#31). 다시 볼 조건은 여전히 미충족" 한 줄씩 추기. 이번 배치가 **새로** 안 하기로 한 것(#26 배지 셸·#27 PatDialog·#34 sidepanel 전량 통일) 3건을 새 섹션으로 추가하고, 각각 사유와 다시 볼 조건을 적는다.
- **검증**:
  - [ ] 추기 3+3건이 전부 "왜 안 하는지 + 무엇이 바뀌면 다시 볼 만한지" 형식
  - [ ] `pnpm postmortem:check` 형식 검사 통과 (해당되면)

---

## 테스트 계획

### 단위 테스트 — `*.test.ts` (node)

| 대상 | 케이스 |
|---|---|
| `scroll-capture.ts` | 후보 수집 throw → resolve 보장 |
| `css-source-cache.ts` | 실패 후 재시도 가능 / invalidate와 경합해도 새 슬롯 보존 |
| `action-recorder-helpers.labelForText` | 다중 ID·단일 ID·`label[for]`·래핑 label 4경로 |
| `oauth.serializeOAuthError` | refresh 실패 401 / 그 외 400 / cancelled·notConfigured·launchFailed 무회귀 |
| `issueBodyShared.imageCell` | url 없음 → 빈 문자열 / 링크 텍스트 이스케이프 |
| `readErrorBody` | JSON / 원문 / read 실패 3갈래 |
| `tab-bindings` | 큐 순서와 `setOptions` 커밋 순서 일치 |
| `importConvention` | 4개 패키지 내부 자기 별칭 참조 0 |

### 컴포넌트 테스트 — `*.test.tsx` (jsdom + testing-library)

| 대상 | 케이스 |
|---|---|
| `IssueCreateModal` | 연동 0개 → `aria-disabled` + 툴팁 문구 + 클릭 무반응 |
| `LinearStatusBadge` | 빈 목록 → 안내 문구 |
| `PropertiesFieldset` | FieldRow 이행 후 `htmlFor`가 컨트롤과 연결 |
| `JsonTreeViewer` | "n개 더"가 키보드로 동작 |
| `DomTreeDialog` | 트리거 클릭 시 다이얼로그 오픈 (testid 유지) |
| `useThemeEffect`(또는 lang effect) | 로케일 → `documentElement.lang` |
| 콤보박스 이행분 | 열면 1회 로드 / onSelect / 선택 항목 상단 고정 |
| `useDebouncedSearch` 채택 3파일 | 300ms 1회 조회 / 마지막 입력만 반영 |

### e2e 시나리오 (`/e2e-write` 입력)

- 연동이 하나도 없는 상태에서 이슈 제출 버튼에 hover하면 이유 툴팁이 보인다.
- 페이지 전체 캡처 중 content 세션이 사라지면 진행이 멈추지 않고 실패로 끝난다.
- DOM 트리 트리거를 클릭하면 다이얼로그가 열린다 (기존 스펙 무회귀 확인).

### 수동 테스트 (Chrome)

자동화가 불가능한 것만 남긴다.

- [ ] 인라인 이미지 3개 이상 프리뷰에서 마크다운 복사 → 붙여넣기 (jsdom에 `ClipboardItem` 없음)
- [ ] 탭 A↔B 빠른 전환 + cross-origin 네비게이션 중 패널 깜빡임 없음 (G9 경합)
- [ ] 어노테이션 pen·rect·highlight 전환 및 off (캔버스)
- [ ] overlay 라벨에 `'`가 포함된 값이 정상 표시 (G7 #23 이스케이프 방향)
- [ ] (승인 시) `pnpm build` → 청크 크기 무증가 + `pnpm check:prearm` green (G6 번들 경계)

---

## 구현 순서 권장

```
Task 0 (그물 선행)
  ↓
P0: Task 1-1 → 1-2 → 1-3   [G1: 같은 파일군, 순차]
    Task 2                  [G2: 독립, 병렬 가능]
    Task 3                  [G3: 독립, 병렬 가능]
    Task 4                  [G4: 독립, 병렬 가능]
  ↓
P1: Task 5-1 → 5-2 → 5-3   [G5: 5-3이 타입 선행이라 마지막]
    Task 6-1 ∥ 6-2 → 6-3   [G6: 6-3은 두 개 끝난 뒤 확인]
    Task 7-1 ∥ 7-2 ∥ 7-3 ∥ 7-4  [G7: 서로 독립]
    Task 8-1 ∥ 8-2          [G8: 서로 독립]
    Task 9                  [G9: 독립]
  ↓
P2: Task 10-1 ∥ 10-2 → 10-3  [G10: 10-3은 10-2 빌드 후]
    Task 11-1 … 11-5         [G11: 전부 독립, 병렬]
    Task 12-1 ∥ 12-2 ∥ 12-3  [G12: 전부 독립]
  ↓
Task 13-1 (DROPPED 추기)
  ↓
대조표 재확인 → 미배정 0 확인 → 배치 종료
```

**병렬 가능**: P0의 Task 2·3·4는 서로 다른 파일이라 동시 진행 가능. P1의 G6·G7·G8·G9는 서로 독립. P2의 G11 5개는 전부 독립.

**순차 필수**:
- Task 0이 먼저 — 그물 없이 통합하면 드리프트가 조용히 통과한다.
- Task 1-1 → 1-2 → 1-3은 같은 content 파일군이라 순차가 안전하다.
- Task 5-3은 타입 변경이 소비처를 끌고 오므로 G5 안에서 마지막.
- Task 6-3은 6-1·6-2 완료 후.
- Task 10-3은 10-2의 `build:log-viewer` 산출물이 있어야 테스트가 돈다.
- Task 13-1은 전부 끝난 뒤 — 무엇을 안 했는지가 확정돼야 적을 수 있다.

**커밋 단위**: 그룹당 1커밋(G1~G12). Task 0은 별도 선행 커밋. Task 13-1은 `docs(DROPPED): ...`로 분리.

## 가이드 영향

**없음.** prd.md "가이드 영향" 참조 — 사용자 노출 변화 3건은 전부 "원래 그래야 했던 것"이라 가이드에 새로 설명할 기능이 아니고, 툴팁 문구도 기존 i18n 키를 재사용한다.
