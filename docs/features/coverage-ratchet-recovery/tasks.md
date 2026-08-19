# 커버리지 래칫 회복 — 구현 태스크

## 선행 조건

- `pnpm test` green 상태에서 시작한다(현재 353파일 / 5943테스트 green).
- 기준 측정치를 손에 둔다: 로직 스코프 **83.3% (20513/24632)**, 래칫 경고 8건. `pnpm test:coverage && pnpm coverage:report`로 재확인 가능.
- 의존성 추가 없음. `fake-indexeddb`(^6.2.5)·`@testing-library/*`는 이미 devDependencies에 있다.
- **프로덕션 코드는 red가 실제 버그를 드러낸 경우에만** 건드린다(그 경우 별도 커밋 + `/postmortem`).

## 태스크

Task 1~7이 테스트 추가, Task 8이 분모 교정, Task 9가 래칫 갱신이다. **Task 1~7은 서로 독립**이라 순서를 바꿔도 되고 병렬로 나눠도 된다.

---

### Task 1: 공용 fetch 목 헬퍼

- **변경 대상**: `src/test/fetch-mock.ts` (신규)
- **작업 내용**: `design.md`의 `MockResponse`·`MockRoute`·`MockFetch` 시그니처대로 `mockFetchOnce`·`mockFetchRoutes` 구현. 라우트 매칭 실패 시 `throw new Error("unmatched fetch: " + url)` — 무음 `undefined` 반환 금지. `jsonBodyAt`은 `init.body`가 `FormData`면 안내 메시지와 함께 throw하고 `formDataAt`을 쓰게 한다. `restore()`는 `vi.unstubAllGlobals()`.
- **기존 8벌 로컬 `mockFetch`는 건드리지 않는다** (외과적 범위).
- **검증**:
  - [ ] `src/test/__tests__/fetch-mock.test.ts`가 헬퍼 자체를 검증 — 큐 소비 순서, 마지막 응답 반복, 라우트 우선순위(먼저 선언한 것이 이김), 매칭 실패 throw, `formDataAt` 왕복.
  - [ ] `pnpm test` green.
  - [ ] `pnpm coverage:report`의 파일 목록에 `src/test/fetch-mock.ts`가 **나타나지 않는다** (`vitest.config.ts`의 `coverage.exclude`에 `src/test/**`가 이미 있음을 확인).

---

### Task 2: 골든 매트릭스가 고정한 두 축

래칫 8건 중 `buildSlackBody`·`buildNotionIssueBody` 2건이 이 태스크로 지워진다.

- **변경 대상**: `src/sidepanel/lib/__tests__/bodyOutputEdgeAxes.test.ts` (신규)
- **작업 내용**: 골든 파일(`bodyOutputGolden.test.ts`)의 `makeCtx`가 상수로 고정한 축을 뒤집어 **스냅샷 없이 명시적 assertion**으로 검증한다. 대상 빌더는 8개 전부(`buildIssueMarkdown`·`buildIssueAdf`·`buildMarkdownIssueBody`·`buildLinearIssueBody`·`buildAsanaIssueBody`·`buildClickupIssueBody`·`buildNotionIssueBody`·`buildSlackBody`).
  - **축 A — 빈 orderedList**: `stepsToReproduce`가 빈 문자열/공백일 때 `md.noValue`가 나오고 항목 마커(`1. `)가 없어야 한다. 현재 markdown(150)·linear(128)·clickup(133)·slack(91)·notion(289) **5빌더 전부 미커버**.
  - **축 B — 로그 에러 0건**: `networkLogSummary.errors`·`consoleLogSummary.errorCount`·`warnCount`가 0일 때 `logSummary.network.lineNoError`·`logSummary.console.lineNoError`를 타고 `errors=`/`warns=` 파라미터가 실리지 않아야 한다. 현재 adf(272,278)·slack(117,124)·notion(296) 미커버.
  - **축 C — notion 전용 잔여**: `video` categorize 3분기(image/video/other, notion 161-166)와 `userAttachments` file block(230-232, 248).
  - `t()` 목은 `slack-api.test.ts` 형태(키+파라미터 문자열 반환)를 재사용한다.
- **검증**:
  - [ ] 8빌더 × 축 A/B가 각각 assert된다.
  - [ ] `pnpm test:coverage` 후 `buildSlackBody.ts`·`buildIssueAdf.ts`·`buildMarkdownIssueBody.ts`·`buildLinearIssueBody.ts`의 미커버가 0이 된다.
  - [ ] `buildNotionIssueBody.ts` 미커버 9줄 → 0.
  - [ ] `bodyOutputGolden.test.ts.snap`의 장수·크기가 **변하지 않는다**(새 스냅샷을 만들지 않았음).

---

### Task 3: `blob-db` 로그 패밀리 4벌

- **변경 대상**: `src/store/__tests__/blob-db-logs.test.ts` (신규), `src/store/__tests__/blob-db-datauri.test.tsx` (신규)
- **작업 내용**:
  - `blob-db-logs.test.ts`: `import "fake-indexeddb/auto"` 후 video·network·console·action 네 패밀리를 **같은 표로 순회**한다. 각 패밀리마다 `save*` → `get*` 왕복(내용 보존) · `get*Keys` 목록 · `delete*` 단건 · `clear*` 전량. `beforeEach`에서 자기 패밀리를 `clear*`로 비운다(파일 간 실행 순서에 기대지 않는다). 기존 `blob-db-attachments.test.ts`의 형태를 따른다.
  - 네 패밀리가 12줄 형태의 복제이므로 **테이블 순회로 쓴다** — 한 패밀리만 키 스코프가 틀린 회귀를 잡는 게 목적이다.
  - `blob-db-datauri.test.tsx`: `blobToDataUrl`(FileReader). **파일 첫 줄에 왜 `.tsx`인지 주석**(`environmentMatchGlobs`가 확장자로만 jsdom을 분기하므로 `.ts`로 옮기면 `FileReader` 미정의로 죽는다). 왕복(`dataUrlToBlob` → `blobToDataUrl`) 검증.
- **검증**:
  - [ ] `saveVideoBlob`·`getVideoBlob`·`getVideoBlobKeys`·`clearVideoBlobs` 및 network/console/action 동형 12함수가 never-called에서 빠진다.
  - [ ] `clearImageBlobs`(10줄)도 함께 덮인다.
  - [ ] `blob-db.ts` 미커버 280 → 80줄 이하.
  - [ ] `pnpm test` green (기존 `blob-db-attachments.test.ts`·`blob-db-inline-origins.test.ts`도 함께 green — 전역 오염 없음 확인).

---

### Task 4: `notion-api:expandBlock` 15타입 전수 + 타입 래칫

- **변경 대상**: `src/background/__tests__/notion-expand-block.test.ts` (신규). 기존 `notion-api.test.ts`의 `describe("expandBlock mention_paragraph")`는 그대로 둔다.
- **작업 내용**: `Record<NotionBlock["type"], …>` 테이블로 15타입(`heading_2`·`heading_3`·`paragraph`·`code`·`bulleted_list_item`·`numbered_list_item`·`image`·`video`·`table`·`rich_paragraph`·`rich_bulleted_list_item`·`rich_numbered_list_item`·`rich_quote`·`mention_paragraph`·`divider`)을 전수 검증. `image`/`video`는 `attachmentMap`에 `placeholderId`가 있을 때와 **없을 때**(→ `null` 또는 폴백) 양쪽. `table`은 행/헤더 구조.
- **검증**:
  - [ ] 테이블이 `Record<NotionBlock["type"], …>`라서 `src/types/notion.ts`의 union에 타입을 하나 추가하면 `pnpm typecheck`가 **깨진다** (임시로 더미 타입을 추가해 실제로 red를 확인한 뒤 되돌린다).
  - [ ] `expandBlock` 미커버 95 → 0.
  - [ ] `expandRichText`(11줄)·`richText` 경로도 함께 덮인다.

---

### Task 5: 8 플랫폼 어댑터 fetch 래퍼 — 플랫폼별 8 서브태스크

**공통 검증 축**(design.md 위험 요소 1): 인코딩(특수문자 id, 이중 인코딩 금지) · 필수 쿼리 파라미터 · 요청 body가 이미 테스트된 매퍼 출력과 일치 · 응답 봉투에서 꺼내는 경로 · `!ok`일 때 `messageFor*Status`/`extract*Detail` 배선. **URL 문자열 전체를 구현에서 복사해 붙이는 방식 금지.**

각 서브태스크는 기존 `src/background/__tests__/<platform>-api.test.ts`를 확장하고 `@/test/fetch-mock`을 쓴다.

#### 5-1. notion (미커버 321 → 목표 60 이하)
- never-called: `createPage`(L623-666) · `sendFileUpload`(L316-348) · `searchDatabases`(L151-172) · `dataUrlToBlob`(L294-314) · `updatePageStatus`(L712-731) · `createFileUpload`(L274-292) · `getDatabaseSchema`(L257-266) · `uploadFile`(L350-359) · `getMyself`(L114-122) · `getPageStatus`(L704-710). partial: `notionFetch` 21u.
- `dataUrlToBlob`은 **blob-db 판본과 계약이 다르다** — base64 + percent-encoded 양쪽을 검증하고, *"blob-db 판본은 비-base64에서 throw한다"*를 주석으로 남긴다(design.md 위험 5).
- 3단 업로드(`createFileUpload` → `sendFileUpload` → `uploadFile`)는 `mockFetchRoutes` + `formDataAt`으로 multipart 검증.
- [ ] `pnpm test` green, notion-api 미커버 60줄 이하

#### 5-2. linear (161 → 30 이하)
- never-called: `updateIssueState`(41L) · `getIssueStatus`(33L) · `requestFileUpload`(29L) · `uploadFileToLinear`(27L) · `getWorkflowStates`(25L) · `getProjects`·`getLabels`(19L×2) · `getMembers`(17L) · `createAttachment`(16L) · `updateIssueDescription`(15L) · `getMyself`·`getTeams`(6L×2).
- GraphQL이라 검증 축이 URL이 아니라 **query 문서 + variables**다. 단일 엔드포인트이므로 `mockFetchOnce` + `jsonBodyAt`으로 `query`/`variables`를 본다.
- [ ] `pnpm test` green, linear-api 미커버 30줄 이하

#### 5-3. clickup (148 → 25 이하)
- never-called: `setTaskCompleted`(26L) · `getMembers`(19L) · `getLists`(15L) · `uploadAttachment`(15L) · `mapCreateTaskBody`(12L) · `createTask`(11L) · `getMyself`(10L) · `updateTaskMarkdown`(10L) · `messageForClickupStatus`(8L) · `normalizeTaskStatus`(8L) · `getTeams`(7L) · `getTaskStatus`(7L) · `isCompletedStatus`(3L).
- `mapCreateTaskBody`·`normalizeTaskStatus`·`isCompletedStatus`·`messageForClickupStatus`는 **순수 함수**라 fetch 목 없이 바로 덮인다 — 먼저 처리.
- 기존 `describe("URL 경로 인코딩")`의 형태를 `getLists`·`getMembers`로 확장.
- [ ] `pnpm test` green, clickup-api 미커버 25줄 이하

#### 5-4. slack (138 → 20 이하)
- never-called: `uploadFiles`(41L) · `listChannels`(31L) · `slackFetch`(29L) · `listMembers`(16L) · `postMessage`(13L) · `getMyself`(11L) · `getPermalink`(11L).
- Slack은 HTTP 200 + `{ok:false, error}` 봉투이므로 **`!res.ok`가 아니라 body의 `ok`로 에러 판정**한다 — `messageForSlackError` 배선을 그 경로로 검증한다(이미 테스트된 함수와의 연결).
- `listChannels`는 커서 페이지네이션 — `response_metadata.next_cursor`를 두 번 돌려 누적되는지 큐로 검증.
- `uploadFiles`는 external upload URL 3단 흐름 → `mockFetchRoutes`.
- [ ] `pnpm test` green, slack-api 미커버 20줄 이하

#### 5-5. gitlab (135 → 25 이하)
- never-called: `searchProjects`(18L) · `updateIssueState`(18L) · `getMyself`(16L) · `uploadFile`(15L) · `getProjectLabels`(14L) · `getProjectMembers`(14L) · `createIssue`(11L) · `getIssueStatus`(11L) · `updateIssueDescription`(11L). partial: `extractGitlabDetail` 6u.
- self-managed `baseUrl` 조합이 축 하나 더다 — 기존 `describe("gitlabFetch egress 자격증명 게이트")`가 http 차단을 이미 덮으므로, 여기선 **경로 결합**(baseUrl 말미 슬래시 유무 × project id URL 인코딩)을 본다.
- [ ] `pnpm test` green, gitlab-api 미커버 25줄 이하

#### 5-6. github (107 → 15 이하)
- never-called: `searchRepos`(24L) · `getRepoLabels`(23L) · `createIssue`(22L) · `updateIssueState`(21L) · `getRepoAssignees`(17L) · `getIssueStatus`(12L).
- `mapCreateIssueBody`는 이미 테스트됨 → `createIssue`는 **그 출력이 그대로 실려 나가는지**만 본다.
- 이 파일은 로컬 목이 `globalThis.fetch` 직접 대입이다. 신규 테스트는 `@/test/fetch-mock`을 쓰되 **기존 `mockFetchResponses`는 그대로 둔다**(같은 파일에 두 방식이 공존 — 통합은 스코프 밖).
- [ ] `pnpm test` green, github-api 미커버 15줄 이하

#### 5-7. asana (93 → 15 이하)
- never-called: `uploadAttachment`(17L) · `searchProjects`(14L) · `setTaskCompleted`(12L) · `createTask`(11L) · `getTaskStatus`(10L) · `normalizeTaskStatus`(8L) · `getMyself`(7L) · `getWorkspaces`(7L). partial: `asanaFetch` 6u, `extractAsanaDetail` 4u.
- 응답 봉투가 `{data: …}`다 — 빈 `data`·`null data`에서 죽지 않는지 함께 본다.
- `normalizeTaskStatus`는 순수 → 먼저 처리.
- [ ] `pnpm test` green, asana-api 미커버 15줄 이하

#### 5-8. jira (199 → 40 이하)
- never-called: `searchEpics`(36L) · `getIssueStatus`(18L) · `getUsersByAccountIds`(15L) · `createIssueLink`(15L) · `uploadAttachment`(14L) · `updateIssueDescription`(14L) · `transitionIssue`(14L) · `searchUsers`(13L) · `jiraMultipart`(12L) · `searchProjects`(12L) · `getIssueTypes`(10L) · `getTransitions`(10L) · `getPriorities`(5L) · `getMyself`(3L).
- 이 파일엔 이미 `mockFetchByUrl(routes)` 로컬 헬퍼가 있고 스프린트·401 갱신 경로를 덮는다. **신규는 `@/test/fetch-mock`을 쓰고 기존 로컬은 남긴다.**
- `jiraMultipart`는 `X-Atlassian-Token: no-check` 헤더가 빠지면 조용히 403이 되는 자리 → 헤더를 명시 검증.
- `transitionIssue`는 이미 테스트된 `parseTransitions`와의 배선을 본다.
- [ ] `pnpm test` green, jira-api 미커버 40줄 이하

---

### Task 6: `settings-store` 마이그레이션 + 플랫폼 patch 설정

래칫 8건 중 `settings-store.ts` 1건이 지워진다.

- **변경 대상**: `src/store/__tests__/settings-store.test.ts` (확장)
- **작업 내용**:
  - `migrateV1ToV2`(L104-121): `jiraConfig`의 `baseUrl`·`email`·`apiToken` 중 **하나라도 없으면 `{jiraConfig: null}`**, 셋 다 있으면 `auth.kind === "apiKey"`로 승격 + `projectKey`·`issueTypeId`·`issueTypeName`·`titlePrefix` 보존. 부분 결손 3케이스를 각각 본다.
  - `isV3Shape`(L183-186): `null`·비객체·`accounts` 없는 객체 → false, `accounts` 있으면 true.
  - `patch*Config` ×8(jira·github·linear·notion·gitlab·asana·clickup·slack): **계정이 없으면 no-op**(`if (!cur) return s`)이고, 있으면 얕은 병합. 8개가 동형이라 **테이블 순회로 쓴다** — 한 플랫폼만 병합이 틀린 회귀가 목적.
- **검증**:
  - [ ] `settings-store.ts` 미커버 77 → 15줄 이하.
  - [ ] `patch*Config` 8개가 각각 "계정 없음 → 상태 불변" / "계정 있음 → 병합" 두 케이스를 갖는다.
  - [ ] 래칫 리포트에서 `settings-store.ts`가 사라진다.

---

### Task 7: 나머지 래칫 잔여 3건

- **변경 대상**: `src/sidepanel/components/annotation/__tests__/presets.test.ts` · `src/sidepanel/lib/__tests__/submitToAsana.test.ts` · `src/sidepanel/lib/__tests__/submitToClickup.test.ts` (모두 확장)
- **작업 내용**:
  - `presets.ts:isStrokeTool`(L74-76): `arrow`·`rect`·`ellipse`·`pen`·`highlight` → true, 그 외 도형 → false. **`AnnotationTool` union 전수로 순회**해 새 도형이 추가되면 분류를 강제로 결정하게 한다.
  - `submitToAsana`: `renameStyleElementFilenames`의 미커버 분기(L102·105·117-118 — before/after 파일명이 rename 맵에 있을 때와 없을 때)와 `userAttachments` 매핑(L135-136, `displayName ?? filename` 폴백). **`webpToJpeg`(L68-84)는 비목표** — canvas 실동작이라 jsdom에 실구현이 없다.
  - `submitToClickup`: 2차 `updateTaskMarkdown`이 reject할 때(L138-140) **task·첨부가 보존되고 제출이 성공으로 끝나는지**. graceful degradation 계약을 봉인한다.
- **검증**:
  - [ ] `presets.ts` 미커버 0.
  - [ ] `submitToAsana.ts` 미커버 24 → 17줄 이하(잔여는 `webpToJpeg`뿐)이고 파일 %가 베이스라인 86.0% **위로** 회복된다.
  - [ ] `submitToClickup.ts` 미커버 0.

---

### Task 8: 분모 교정 — `usePickerMessages` 등재

- **변경 대상**: `scripts/coverage-report.mjs`
- **작업 내용**: `BROWSER_BOUND_EXACT`의 sidepanel 구획에 `"src/sidepanel/hooks/usePickerMessages.ts"` 추가. 함께 **등재 판정 기준을 주석으로 박는다**:
  > 훅은 (a) DOM·미디어·`chrome.*`를 직접 만지거나 그런 모듈만 오케스트레이션하고, (b) 그 파일의 순수 판정이 이미 별도 모듈로 떼어져 각각 테스트돼 있을 때만 등재한다. `usePickerMessages`는 `picker-control`·`capture`(둘 다 등재됨) 오케스트레이션이고, 순수 판정은 `log-persist-guard`·`log-prearm-filter`·`tab-scope`·`log-merge`로 분리·테스트돼 있다. `usePlatformFields`는 (a)를 만족하지 않아 등재하지 않는다 — 그건 테스트로 덮을 대상이다.
- **작업하지 않는 것**: `useEditorSessionSync`·`useBackgroundRecorder`는 순수 헬퍼(`migrateLegacyDraft`·`snapshotFromState`·`shouldPreserveBackgroundLogs`)를 **같은 파일 안에** 들고 있어 파일 단위 제외를 하면 그 헬퍼가 다이얼에서 함께 빠진다. 등재하지 않는다.
- **검증**:
  - [ ] `pnpm coverage:report`의 로직 분모가 24632 → 24161로 줄고, 개선 후보 목록에서 `usePickerMessages.ts`가 사라진다.
  - [ ] 다른 파일의 분류가 변하지 않는다(리포트의 파일 수 델타가 정확히 −1).
  - [ ] `git diff scripts/coverage-report.mjs`가 목록 1줄 + 주석뿐이다(로직 변경 없음).

---

### Task 9: 최종 측정 + 베이스라인 래칫

- **변경 대상**: `coverage/baseline.json`
- **작업 내용**: 전 태스크 완료 후 `pnpm test:coverage && pnpm coverage:report`로 판정하고, 래칫 하락 0 + 로직 ≥89%면 `pnpm coverage:update`. 커밋은 `chore(coverage): ratchet baseline` 단독으로.
- **검증**:
  - [ ] 래칫 경고 **0건**.
  - [ ] 로직 스코프 Lines **≥ 89%**.
  - [ ] `coverage/baseline.json`만 담긴 커밋(리포트 본체는 `.gitignore`).
  - [ ] 하락 파일이 남아 있으면 **갱신하지 않고** 원인을 보고한다(회귀를 덮으면 래칫이 무의미).

## 테스트 계획

- **단위 테스트**: 이 기획 자체가 단위 테스트 추가다. 신규 파일 5개(`fetch-mock.ts` + 그 자체 테스트, `blob-db-logs`, `blob-db-datauri`, `notion-expand-block`, `bodyOutputEdgeAxes`) + 기존 12개 파일 확장.
- **e2e 시나리오**: **없음.** 프로덕션 동작을 바꾸지 않으므로 e2e 대상이 아니다. (예외: Task 5의 red가 실제 버그를 드러내 프로덕션을 고치게 되면 그 픽스에 대해 별도로 `/e2e-write` 필요성을 판단한다.)
- **수동 테스트**: **없음** — 프로덕션 코드 무변경. Task 8만 `pnpm coverage:report` 출력을 눈으로 확인한다(분모·파일 수 델타).
- **회귀 그물 확인**: 기존 소스 스캔 테스트가 계속 green이어야 한다 — `store/__tests__/bundleBoundary.test.ts`(테스트 파일은 스캔 대상 아님), `src/lib/__tests__/import-convention.test.ts`(`background`·`store` 디렉터리 안 상대경로 유지), `builderLocaleWrap.test.ts`(빌더 진입점 미변경).

## 구현 순서 권장

```
Task 1 (fetch-mock)  ─┬─> Task 5-1 … 5-8  (8 플랫폼, 서로 병렬 가능)
                      │
Task 2 (골든 2축)  ────┤
Task 3 (blob-db)   ────┤ (Task 1과 무관 — 병렬 가능)
Task 4 (expandBlock) ──┤
Task 6 (settings-store)┤
Task 7 (래칫 잔여 3건) ─┘
                       └─> Task 8 (분모 교정) ─> Task 9 (최종 측정 + 래칫)
```

- **Task 1이 Task 5의 유일한 선행**이다. Task 2·3·4·6·7은 Task 1과 무관하니 먼저/동시에 해도 된다.
- **가성비 순서로 붙일 거면** Task 2 → 7 → 3 → 6 → 4 → 5 → 8 → 9. Task 2·7이 래칫 8건 중 5건을 지우고 비용이 가장 작다.
- Task 5의 8개 서브태스크는 완전히 독립이라 나눠 진행 가능. 다만 `pnpm test:coverage`는 전체 실행이므로 **미커버 목표치 확인은 Task 5를 다 끝낸 뒤 1회**로 묶는다.
- Task 8·9는 반드시 마지막. 중간에 돌리면 래칫 판정이 요동한다.

## 가이드 영향

없음. 사용자 노출 UX·기능 변경이 아니다.
