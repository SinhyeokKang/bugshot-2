# 커버리지 래칫 회복 — 구현 태스크

## 선행 조건

- `pnpm test` green에서 시작(현재 353파일 / 5943테스트).
- 기준 측정치: 로직 스코프 **83.3% (20513/24632)**, 래칫 경고 8건. 재확인은 `pnpm test:coverage && pnpm coverage:report`.
- **파일별 미커버 수치는 `coverage/report/coverage-summary.json`을 직접 읽는다.** `pnpm coverage:report`의 개선 후보 목록은 상위 15(asana-api 93줄)에서 끊겨 Task 2·6·7의 대상 파일이 안 나온다. 그리고 `coverage/coverage-summary.json`(루트, 2026-07-25 구파일)을 잡지 않도록 주의 — 정본은 `coverage/report/` 아래다.
- **never-called 함수 재조사가 필요하면** design.md "데이터 흐름"의 `coverage-final.json` 절차를 쓴다. 아래 라인 번호는 stale이 될 수 있으므로 **의심되면 다시 센다**(다른 문서의 숫자를 옮기는 게 이 저장소 회고 1위 계열이다).
- **`export` 추가를 허용한다** — 테스트 진입을 위한 것이고 동작 변경이 0이다. 대상 5개: `migrateV1ToV2`·`isV3Shape`(`store/settings-store.ts:104,183`) · `notionFetch`·`dataUrlToBlob`(`background/notion-api.ts:53,294`) · `isCompletedStatus`(`background/clickup-api.ts:222`). 선례는 `settings-store.test.ts`가 이미 import하는 `migrateV2ToV3`·`migrateToV5`·`migrateToV11`. **`NotionBlockObject`는 export하지 않는다**(module-local `interface` + `type: string`이라 전수성 0).
- 그 밖의 프로덕션 변경은 **Task 8의 계획된 픽스 3건**과, red가 **4번째** 버그를 드러낸 경우의 중단·이월뿐이다.
- 의존성 추가 없음.

## 전 태스크 공통 규칙

1. **mutation 실측이 검증의 정의다.** 각 태스크는 "구현의 무엇을 망가뜨려 어느 테스트가 red가 되는지"를 기록한다. 커버리지 임계값은 보조 지표다. (근거: `POSTMORTEM:204`가 *"tasks.md의 '검증' 칸도 미검증 단언"*을, `:440`이 *"뮤테이션은 커밋 단위가 아니라 그물 단위다"*를 처방.)
2. **테이블 순회의 기대값은 리터럴로 박는다.** SUT나 SUT가 쓰는 상수를 import해 계산하면 항진명제가 된다(`POSTMORTEM:430`). 해당 태스크: 3·4·6·7.
3. **i18n 목은 `bodyOutputGolden.test.ts:11-27`을 복사한다** — `@/i18n`에서 `withLocale`+`t`+`dateBcp47` 3키 + `../formatTimestamp`. `withLocale`이 빠지면 8빌더가 통째로 `TypeError`로 죽는다.

---

## 태스크

### Task 1: 공용 fetch 목 헬퍼

- **변경 대상**: `src/test/fetch-mock.ts`, `src/test/__tests__/fetch-mock.test.ts` (둘 다 신규)
- **작업 내용**: design.md "인터페이스 설계"의 시그니처대로 구현. `statusText`·`url`은 넣고 **`headers`는 넣지 않는다**(어댑터 8파일에 `.headers.get(` 0건). `text()`는 `typeof body === "string" ? body : JSON.stringify(body)` + reject 표현. 라우트 미매칭은 `throw`. `restore()` 시그니처에 **`afterEach` 전용**임을 주석으로 박는다(`vi.unstubAllGlobals()`가 jira의 `chrome` 스텁까지 날린다).
- **기존 8벌 로컬 `mockFetch`는 건드리지 않는다.** 대신 `docs/features/DROPPED.md`에 마이그레이션 조건을 등재한다(안 하면 다음 감사가 "8벌 중복"을 또 발굴한다).
- **검증**:
  - [ ] 헬퍼 자체 테스트: 큐 소비 순서 · 고갈 후 마지막 값 반복 · 라우트 우선순위(먼저 선언한 것이 이김) · 미매칭 throw · `formDataAt` 왕복 · `text()`가 문자열 body를 그대로 반환(JSON 이중 인코딩 금지).
  - [ ] **누출 방지 스캔**: `walkSources(src) − src/test`에서 `@/test/` 참조가 0건임을 확인하는 테스트 1개(design.md 위험 10 — 현재 이 규칙을 강제하는 그물이 없다).
  - [ ] `pnpm coverage:report`의 파일 목록에 `src/test/fetch-mock.ts`가 나타나지 않는다.
  - [ ] **mutation**: 라우트 우선순위를 역순으로 뒤집으면 우선순위 테스트가 red / `text()`를 무조건 `JSON.stringify`로 바꾸면 문자열 body 테스트가 red.

---

### Task 2: 골든 매트릭스가 고정한 두 축

래칫 8건 중 `buildSlackBody`·`buildNotionIssueBody` 2건을 지운다.

- **변경 대상**: `src/sidepanel/lib/__tests__/bodyOutputEdgeAxes.test.ts` (신규), `src/sidepanel/lib/__tests__/buildEditorCapture.test.ts` (확장)
- **사정거리 선언 (파일 첫 주석에 남긴다)**: 이 그물은 **소비자(빌더)까지**다. ctx 리터럴을 손으로 조립하고 `t()`를 목하므로 "에러 0건 세션이 실제로 `errorCount: 0`을 만드는가"는 안 본다 — 그 생산자 축은 `buildEditorCapture.test.ts`의 짝 케이스가 맡는다. (`POSTMORTEM` 2026-08-14가 `bodyOutputGolden.test.ts`를 "생산자를 안 부르는 공허한 그물"로 판정한 항목의 재발 방지.)
- **작업 내용**: 대상은 골든 `OUTPUTS` 10 엔트리 전부(플랫폼 8 + 클립보드 md/html).
  - **축 A — 빈 orderedList**: `stepsToReproduce`가 빈 문자열/공백일 때 `md.noValue`가 **정확히 한 번** 나오고 항목 마커(`1. `)가 없어야 한다. 현재 미커버: markdown 150 · linear 128 · clickup 133 · slack 91 · notion **248**. (`buildAsanaIssueBody`는 이미 100%라 대상 밖이고, `buildClickupIssueBody`는 이 줄 외에 `styleTable.snapshot` 행 88-91도 미커버다.)
  - **축 B — 로그 에러 0건**: `lineNoError`를 타고 `errors=`/`warns=`가 실리지 않아야 한다. **픽스처는 `errorCount`와 `errors` 둘 다 0이어야 한다** — 게이트가 `net.errorCount ?? net.errors.length`(`buildLogSummary.ts:64`)라 `errors: []`만 비우면 with-error를 그대로 탄다. 현재 미커버: adf 272·278 · slack 117·124 · notion **289·296** · `buildIssueMarkdown` 534·536.
  - **축 B-2 — errors=0 & warns>0**: 조건이 `errorCount > 0 || warnCount > 0`이고 5벌 문자 그대로 복제돼 있다(`issueBodyShared.ts:78` · `buildSlackBody.ts:122` · `buildIssueAdf.ts:276` · `buildNotionIssueBody.ts:294` · `buildIssueMarkdown.ts:534`). **에러 0 / 경고 5 → `lineNoError`가 아니라 `line`을 타야 한다.** 이게 없으면 누가 조건을 `errorCount > 0`으로 "단순화"해도 green이고 경고 건수가 조용히 사라진다.
  - **축 C — notion 전용 잔여**: `video` categorize 3분기(image/video/other, 161-166) · `userAttachments` file block(**229-232**).
  - **notion `md.noValue` 비대칭**: `buildNotionIssueBody.ts:259-263`은 paragraph 섹션에 업로드된 인라인 이미지만 있고 텍스트가 없으면 `(없음)`을 **안 낸다**(나머지는 무조건 낸다). 이미지가 곧 내용이니 합리적 비대칭이므로 **의도임을 테스트에 명시**한다.
  - assertion은 목 포맷 의존을 줄인다: `not.toMatch(/logSummary\.network\.line(?!NoError)/)` + `not.toContain("errors=")` 병용.
- **검증**:
  - [ ] 10출력 × 축 A/B가 각각 assert되고, 축 B-2·C가 해당 빌더에 있다.
  - [ ] `buildSlackBody.ts`(3) · `buildIssueAdf.ts`(2) · `buildMarkdownIssueBody.ts`(1) · `buildLinearIssueBody.ts`(1) · `buildIssueMarkdown.ts`(1) 미커버 → 0.
  - [ ] `buildClickupIssueBody.ts` 미커버 5 → 0 · `buildNotionIssueBody.ts` 9 → 0.
  - [ ] `buildEditorCapture.test.ts`에 "에러 0건 세션 → `errorCount: 0`" 짝 케이스가 있다.
  - [ ] `bodyOutputGolden.test.ts.snap`이 **8888줄 / 189,662 bytes / 62장 그대로**다(새 스냅샷을 만들지 않았음).
  - [ ] **mutation**: `issueBodyShared.ts`의 `|| con.warnCount > 0`을 지우면 축 B-2가 red / `md.noValue`를 빈 문자열로 바꾸면 축 A가 red.

---

### Task 3: `blob-db` 로그 패밀리 4벌 (20함수)

- **변경 대상**: `src/store/__tests__/blob-db-logs.test.ts`, `src/store/__tests__/blob-db-datauri.test.tsx` (둘 다 신규), `src/store/__tests__/blob-db.test.ts` (확장)
- **작업 내용**:
  - `blob-db-logs.test.ts`: `import "fake-indexeddb/auto"`를 **`../blob-db` import보다 먼저** 둔다(`dbPromise`가 이전 백엔드를 캐시한다). 4패밀리 × 5함수 = **20함수**를 순회:
    - video: `saveVideoBlob`(77) · `getVideoBlob`(90) · `deleteVideoBlob`(103) · `getVideoBlobKeys`(114) · `clearVideoBlobs`(127)
    - network: `saveNetworkLog`(243) · `getNetworkLog`(256) · `deleteNetworkLog`(269) · `getNetworkLogKeys`(280) · `clearNetworkLogs`(293)
    - console: 306 · 319 · 332 · 343 · 356 / action: 369 · 382 · 395 · 406 · 419
  - **시그니처가 동형이 아니다** — video는 `(issueId, Blob)`, 로그 3종은 `(key, NetworkLog|ConsoleLog|ActionLog)`다. 순회는 **패밀리별 값 팩토리를 파라미터로 받는 형태**로 쓰고 기대값은 리터럴로 박는다.
  - **비대칭 2건을 별도 케이스로** (순수 동형 순회로 쓰면 이게 테스트에서 사라진다):
    - `getVideoBlob`만 `req.result instanceof Blob` 런타임 가드가 있고 로그 3종은 `(req.result as T) ?? null` 무검증 캐스트다.
    - 키 스코프가 다르다 — video는 `issueId` 단일, 로그 3종은 `issueId`(`editor-store.ts:536`)와 `pendingKey(tabId)`(`apply-trim.ts:78,84,90` · `use-30s-replay.ts:178,184,190`) **2네임스페이스**가 섞인다. 두 네임스페이스가 서로를 오염시키지 않는지 assert한다(PRD가 노린 "한 패밀리만 키 스코프가 틀린 회귀"의 실체).
  - 엣지: `get*`의 미존재 키 → null · `get*Keys`의 빈 스토어 · `clearImageBlobs`(230-239, 10줄).
  - `beforeEach`에서 자기 패밀리를 `clear*`로 비운다(파일 간 격리는 vitest `forks`+`isolate`가 이미 보장하지만 파일 **내부** 격리와 향후 `isolate: false` 대비).
  - `blob-db-datauri.test.tsx`: `blobToDataUrl`(723). **파일 첫 줄에 왜 `.tsx`인지 + `// @vitest-environment jsdom` docblock 대안이 있음을 주석**으로 남긴다. `dataUrlToBlob` → `blobToDataUrl` 왕복.
  - `blob-db.test.ts`: 기존 `dataUrlToBlob` 3케이스에 **notion 판본과의 갈림**을 추가 — `data:;base64,QUJD`(blob-db는 `type:""`로 성공 / notion은 throw) · 빈 payload(반대) · `charset` 섞인 mime(blob-db는 `type`에 `charset`이 붙는 오답). 주석으로 상대 판본 위치를 가리킨다.
- **검증**:
  - [ ] 20함수가 never-called에서 빠진다.
  - [ ] 비대semantics 2건(`instanceof Blob` 가드 / 2네임스페이스)이 각각 독립 케이스로 있다.
  - [ ] `blob-db.ts` 미커버 280 → **100줄 이하**. (상한을 80이 아니라 100으로 둔 이유: 파일에 `catch` 블록이 42개이고 전부 `console.warn`+return이라 정상 경로 왕복으로는 한 줄도 안 덮인다. 트랜잭션 강제 실패로 catch를 덮는 건 이번 스코프 밖이다.)
  - [ ] 기존 `blob-db-attachments.test.ts`·`blob-db-inline-origins.test.ts`도 함께 green.
  - [ ] **mutation**: 로그 3종 중 하나의 store 이름을 다른 패밀리 것으로 바꾸면 그 패밀리 왕복만 red(네임스페이스 격리 확인) / `getVideoBlob`의 `instanceof Blob`을 지우면 가드 케이스가 red.

---

### Task 4: `notion-api:expandBlock` 15타입 전수 + 타입 래칫

- **변경 대상**: `src/background/__tests__/notion-expand-block.test.ts` (신규). 기존 `notion-api.test.ts`의 `describe("expandBlock mention_paragraph")`는 그대로 둔다.
- **작업 내용**: `Record<NotionBlock["type"], …>` 테이블로 15타입 전수(`heading_2`·`heading_3`·`paragraph`·`code`·`bulleted_list_item`·`numbered_list_item`·`image`·`video`·`table`·`rich_paragraph`·`rich_bulleted_list_item`·`rich_numbered_list_item`·`rich_quote`·`mention_paragraph`·`divider`). 기대값은 **리터럴 블록 객체**로 박는다.
  - **반환 타입에 `NotionBlockObject`를 쓰지 않는다** — module-local `interface`(`:400`)이고 `type: string`이라 import도 안 되고 전수성도 0이다. 인라인 구조 타입이나 `unknown` + 좁히기.
  - **입력 `type` ≠ 출력 `type`**: `rich_paragraph`→`"paragraph"`, `rich_quote`→`"quote"`, `mention_paragraph`→`"paragraph"`.
  - **`null` 반환 케이스**: `image`/`video`/`table`은 `attachmentMap`에 placeholder가 없으면 `null`이다 — 있을 때/없을 때 양쪽.
  - **`default: return null`(557-558)은 닫힌 union으로 도달 불가** → 테이블 밖에 `expandBlock({ type: "bogus" } as never, map)` 케이스를 따로 둔다.
- **검증**:
  - [ ] `expandBlock` 미커버 95 → **0**(위 `as never` 케이스 포함. 그게 없으면 바닥이 2다).
  - [ ] `expandRichText`(388-398, 11줄)·`richText` 경로도 함께 덮인다.
  - [ ] **타입 래칫 실측**: `src/types/notion.ts`의 union에 더미 타입을 추가해 `pnpm typecheck`가 실제로 red가 되는 걸 확인한 뒤 되돌린다.
  - [ ] **mutation**: `rich_quote`의 출력 `type`을 `"paragraph"`로 바꾸면 해당 케이스가 red.

---

### Task 5: 8 플랫폼 어댑터 fetch 래퍼 — 플랫폼별 8 서브태스크

**선행**: Task 1(`fetch-mock`). **그리고 5-1은 Task 4 선행 필수** — notion 321줄 중 `expandBlock`이 95줄이라 5-1 단독 바닥은 105다.

**공통 검증 축 5개**(design.md 위험 1): 인코딩 / 필수 쿼리 파라미터 / 요청 body ↔ 매퍼 출력 일치 / 응답 봉투 경로 / 에러 전파. **URL 문자열 전체를 구현에서 복사해 붙이는 방식 금지.** 각 서브태스크는 **인코딩 1 + 필수 쿼리 파라미터 1 + 에러 전파 1**을 최소로 갖고, mutation 한 건을 기록한다.

각 서브태스크는 기존 `src/background/__tests__/<platform>-api.test.ts`를 확장하고 `@/test/fetch-mock`을 쓴다.

#### 5-1. notion (미커버 321 → 60 이하, **Task 4 완료 후**)
- never-called: `createPage`(623-666) · `sendFileUpload`(316-348) · `searchDatabases`(151-172) · `dataUrlToBlob`(294-314) · `updatePageStatus`(712-731) · `createFileUpload`(274-292) · `getDatabaseSchema`(257-266) · `uploadFile`(350-359) · `getMyself`(114-122) · `getPageStatus`(704-710). partial: `notionFetch` 21u.
- 3단 업로드(`createFileUpload` → `sendFileUpload` → `uploadFile`)는 `mockFetchRoutes` + `formDataAt`.
- `dataUrlToBlob`은 **blob-db 판본과 계약이 갈린다** — Task 3과 짝을 맞춰 주석으로 상호 참조.
- [ ] **mutation**: `searchDatabases`의 `start_cursor` 전달을 지우면 페이지네이션 테스트가 red.

#### 5-2. linear (161 → 30 이하)
- never-called: `updateIssueState`(287-327) · `getIssueStatus`(207-239) · `requestFileUpload`(345-373) · `uploadFileToLinear`(375-401) · `getWorkflowStates`(261-285) · `getProjects`(117-135) · `getLabels`(137-155) · `getMembers`(157-173) · `createAttachment`(403-418) · `updateIssueDescription`(329-343) · `getMyself`(103-108) · `getTeams`(110-115).
- GraphQL 단일 엔드포인트 → 검증 축이 URL이 아니라 **query 문서 + variables**다(`mockFetchOnce` + `jsonBodyAt`).
- `uploadFileToLinear`는 raw `Blob` body + `putRes.statusText`를 메시지에 싣는다(`:395,398`) → `callAt().init.body` 직접 접근 + `statusText` 지정.
- [ ] **mutation**: `getWorkflowStates`의 variables에서 teamId를 지우면 red.

#### 5-3. clickup (148 → 25 이하)
- never-called: `setTaskCompleted`(244-269) · `getMembers`(142-160) · `getLists`(126-140) · `uploadAttachment`(187-201) · `mapCreateTaskBody`(162-173) · `createTask`(175-185) · `getMyself`(82-91) · `updateTaskMarkdown`(203-212) · `messageForClickupStatus`(43-50) · `normalizeTaskStatus`(226-233) · `getTeams`(93-99) · `getTaskStatus`(235-241) · `isCompletedStatus`(222-224).
- **순수 함수 4개를 먼저** 처리(fetch 목 불필요): `mapCreateTaskBody`·`normalizeTaskStatus`·`isCompletedStatus`(export 필요)·`messageForClickupStatus`.
- 기존 `describe("URL 경로 인코딩")` 형태를 `getLists`·`getMembers`로 확장.
- [ ] **mutation**: `getLists`의 `archived=false`를 지우면 red.

#### 5-4. slack (138 → 20 이하)
- never-called: `uploadFiles`(203-243) · `listChannels`(144-174) · `slackFetch`(49-77) · `listMembers`(127-142) · `postMessage`(176-188) · `getMyself`(97-107) · `getPermalink`(190-200).
- **에러 판정이 `!res.ok`가 아니라 body의 `ok`다**(HTTP 200 + `{ok:false, error}`) → `messageForSlackError` 배선을 그 경로로 검증.
- `listChannels`는 커서 페이지네이션(`do…while`) — **종료 조건 3케이스 필수**: `next_cursor: ""` / 키 부재 / 같은 커서 반복. 없으면 무한 루프로 테스트가 타임아웃으로 죽는다.
- `uploadFiles`는 external upload URL 3단 → `mockFetchRoutes`.
- [ ] **mutation**: `listChannels`의 커서 종료 조건을 뒤집으면 종료 테스트가 red(타임아웃 아님).

#### 5-5. gitlab (135 → 25 이하)
- never-called: `searchProjects`(158-175) · `updateIssueState`(277-294) · `getMyself`(141-156) · `uploadFile`(219-233) · `getProjectLabels`(177-190) · `getProjectMembers`(192-205) · `createIssue`(207-217) · `getIssueStatus`(253-263) · `updateIssueDescription`(265-275). partial: `extractGitlabDetail` 6u.
- http 차단은 기존 `describe("gitlabFetch egress 자격증명 게이트")`가 이미 덮으므로, 여기선 **경로 결합**(baseUrl 말미 슬래시 유무 × project id URL 인코딩).
- [ ] **mutation**: project id 인코딩을 제거하면 인코딩 테스트가 red.

#### 5-6. github (107 → 15 이하)
- never-called: `searchRepos`(184-207) · `getRepoLabels`(209-231) · `createIssue`(308-329) · `updateIssueState`(286-306) · `getRepoAssignees`(233-249) · `getIssueStatus`(273-284).
- `mapCreateIssueBody`는 이미 테스트됨 → `createIssue`는 **그 출력이 그대로 실려 나가는지**만.
- **이 파일은 로컬 목이 `globalThis.fetch` 직접 대입이다**(239-250). 신규는 `@/test/fetch-mock`을 쓰되 **별도 `describe` + 자기 `afterEach`로 분리**한다 — 교차하면 `vi.unstubAllGlobals()`가 "진짜 fetch"가 아니라 github의 목을 복원한다(design.md 위험 6).
- [ ] **mutation**: `searchRepos`의 `per_page`를 지우면 red.

#### 5-7. asana (93 → 15 이하)
- never-called: `uploadAttachment`(181-197) · `searchProjects`(138-151) · `setTaskCompleted`(237-248) · `createTask`(169-179) · `getTaskStatus`(215-224) · `normalizeTaskStatus`(206-213) · `getMyself`(122-128) · `getWorkspaces`(130-136). partial: `asanaFetch` 6u, `extractAsanaDetail` 4u.
- 응답 봉투 `{data: …}` — **`null data` / 빈 배열 / `data` 키 자체가 없는 `{}` / `errors[]`만 온 200** 네 케이스.
- `normalizeTaskStatus`는 순수 → 먼저.
- [ ] **mutation**: `data` 구조분해를 옵셔널 체이닝 없이 바꾸면 `{}` 케이스가 red.

#### 5-8. jira (199 → 40 이하)
- never-called: `searchEpics`(653-688) · `getIssueStatus`(589-606) · `getUsersByAccountIds`(258-272) · `createIssueLink`(573-587) · `uploadAttachment`(543-556) · `updateIssueDescription`(558-571) · `transitionIssue`(638-651) · `searchUsers`(244-256) · `jiraMultipart`(153-164) · `searchProjects`(207-218) · `getIssueTypes`(227-236) · `getTransitions`(627-636) · `getPriorities`(238-242) · `getMyself`(196-198).
- 기존 로컬 `mockFetchByUrl`(265)은 남기고 신규만 `@/test/fetch-mock`. **한 파일에 실패 모드가 둘(미매칭 404 vs throw)** 이라는 주석을 남긴다.
- `restore()`가 `chrome` 스텁까지 날리므로 `ensureFreshAuth`/`refreshOnce` 경로 테스트와 **같은 `it()` 안에서 섞지 않는다**.
- `jiraMultipart`는 `X-Atlassian-Token: no-check`가 빠지면 조용히 403 → 헤더 명시 검증.
- `transitionIssue`는 이미 테스트된 `parseTransitions`와의 배선.
- 엣지 추가: `getMediaFileId`(504-539)의 재시도 소진(4회 전부 undefined) — `sleepFn` 주입이 있어 즉시 검증 가능.
- [ ] **mutation**: `X-Atlassian-Token` 헤더를 지우면 multipart 테스트가 red.

---

### Task 6: `settings-store` 마이그레이션 + 계정 patch

래칫 8건 중 `settings-store.ts` 1건을 지운다. **`export` 추가 없이는 착수 불가**(`migrateV1ToV2`는 zustand `migrate` 콜백 안에서만 불려 간접 경로가 없다).

- **변경 대상**: `src/store/__tests__/settings-store.test.ts` (확장), `src/store/settings-store.ts` (export 2개 추가)
- **작업 내용**:
  - `migrateV1ToV2`(104-121): `baseUrl`·`email`·`apiToken` 중 하나라도 없으면 `{jiraConfig: null}`, 셋 다 있으면 `auth.kind === "apiKey"` 승격 + `projectKey`·`issueTypeId`·`issueTypeName`·`titlePrefix` 보존. **케이스: 부분 결손 3 + `jiraConfig` 자체가 없는 v1 + `titlePrefix`만 있는 것.**
  - `isV3Shape`(183-186): `null` · 비객체 · `accounts` 없는 객체 → false / `accounts` 있으면 true.
  - **함수명은 `patch*Config`가 아니라 `update*Account` ×8이다**(선언 37-60 / 구현 206-253: `updateJiraAccount`·`updateGithubAccount`·`updateLinearAccount`·`updateNotionAccount`·`updateGitlabAccount`·`updateAsanaAccount`·`updateClickupAccount`·`updateSlackAccount`). 독립 export가 아니라 `create(persist(...))` 안의 인라인 화살표라 `useSettingsStore` 경유로만 도달한다. 각각 "계정 없음 → 상태 불변"(`if (!cur) return s`) / "있음 → 얕은 병합" 두 케이스. **기대 병합 결과는 리터럴로 박는다**(스프레드로 계산하면 항진명제).
  - **8개 중 2개는 이미 테스트가 있다** — `describe("updateGitlabAccount")`(288) · `describe("updateAsanaAccount")`(323). 테이블 순회로 **흡수**하고 기존 2개는 지운다(중복 방치 금지).
- **검증**:
  - [ ] `settings-store.ts` 미커버 77 → 15줄 이하.
  - [ ] `update*Account` 8개가 각각 2케이스를 갖고, 기존 gitlab·asana describe가 순회로 흡수됐다.
  - [ ] 래칫 리포트에서 `settings-store.ts`가 사라진다.
  - [ ] **mutation**: 한 플랫폼의 `if (!cur) return s`를 지우면 그 플랫폼의 "계정 없음" 케이스만 red(순회가 항진명제가 아님을 증명).

---

### Task 7: 래칫 잔여 3건 + 2차 본문 갱신 격리 전수 표 (5플랫폼)

- **변경 대상**: `src/sidepanel/components/annotation/__tests__/presets.test.ts` · `src/sidepanel/lib/__tests__/submitToAsana.test.ts` · `submitToClickup.test.ts` · `submitToLinear.test.ts` · `submitToGitlab.test.ts` · `submitToJira.test.ts` (모두 확장)
- **작업 내용**:
  - `presets.ts:isStrokeTool`(74-76): **`Record<AnnotationTool, boolean>`**으로 7종 전수(`select`·`arrow`·`rect`·`ellipse`·`pen`·`text`·`highlight`) — 배열 리터럴로 쓰면 union 확장 시 컴파일이 안 깨진다. **`STROKE_TOOLS`를 import해 대조하지 않는다**(항진명제). 기대값은 손으로 쓴 `true`/`false`.
    - 주석에 남길 사실 2개: ① 이 함수는 오늘 **UI 동작을 봉인하지 않는다** — 유일 소비처(`AnnotationToolbar.tsx:89`의 `thicknessEnabled`)가 `select`·`text`를 이미 걸러낸 뒤라 `isStrokeTool(styleTool)`이 항상 true인 dead guard다. 실질 가치는 타입 강제다. ② `ShapeBase`가 `TextShape`에도 `strokeWidth`를 요구하므로(`shapes.ts:3-7,37-45`) 타입이 이 구분을 인코딩하지 않고 **진실이 `isStrokeTool` 한 곳에만 산다**.
    - `presets.ts:65`의 주석("스타일 행 노출 판정의 단일 출처")은 과장이다 — 스타일 행의 두께 vs 텍스트 크기 분기는 `AnnotationToolbar.tsx:90`의 `showTextSize`가 별도 판정한다. 프로덕션 주석은 건드리지 않고 **tasks/design 문면만** 정확히 둔다.
  - `submitToAsana`: `renameStyleElementFilenames`의 잔여 분기(102·105·117-118)와 `userAttachments` 매핑(135). **`webpToJpeg`(66-85)는 비목표** — 단 `:67` non-webp 조기 반환과 `:82-83` catch 폴백은 canvas 없이 도달 가능하다.
    - **주의**: 기존 `submitToAsana.test.ts:83-124`의 4케이스가 102·105를 이미 태울 가능성이 있다. **착수 시 `coverage-final.json`으로 재측정**하고 목표치를 조정한다(현재 미커버 24, 열거 대상 6줄 → 산술 바닥 18).
  - **2차 본문 갱신 실패 시 graceful degradation — 전수 표.** 2차 본문 갱신 경로를 **가진 플랫폼은 5개뿐**이다(실측): clickup `updateTaskMarkdown`(`submitToClickup.ts:134`, catch `:138-140`) · asana `updateTaskNotes`(catch `:223`) · linear `updateIssueDescription`(`.catch(() => null)` `:144`) · gitlab `updateIssueDescription`(블록 감싸기 catch `:95`) · **jira**(`background/messages.ts:859` — 사이드패널이 아니라 background 안이고 **격리가 없다**). notion·github·slack은 2차 write 자체가 없어 대상이 아니다(notion `submitToNotion.ts:123`의 catch는 *업로드* 격리이고 image/video는 의도적으로 strict — 다른 계약이므로 이 표에 섞지 않는다).
    → 4플랫폼을 한 표로 순회해 **이슈·첨부가 보존되고 제출이 성공으로 끝나는지** 잠그고, jira는 Task 8-2에서 고친 뒤 표에 추가해 **5플랫폼**으로 만든다(순서 의존). 관용구가 4갈림(try/catch · `.catch(()=>null)` · 블록 감싸기 · 격리 없음)이라는 사실을 표 주석에 남긴다.
    - **정직성 주의**: clickup의 bare `catch {}`는 rethrow·플래그·로그가 없고 반환값이 완전 성공과 동일해 사용자는 초록 체크만 본다. 그때 본문에 없는 것: 스크린샷 임베드 · As-is/To-be 스냅샷 행 · 영상 링크 · `logs.html` 하이퍼링크, 그리고 **미해석 `inline:xxxx` 플레이스홀더가 그대로 보인다.** 파일은 첨부로 남으니 손실은 아니지만 v1.7.27이 고친 게 정확히 이 계열이다. → 테스트는 유지하되 **"성공 표기의 정직성은 별개 이슈"를 테스트 주석에 명시**해, 나중에 경고 토스트를 붙이려는 사람이 red에 막히지 않게 한다.
- **검증**:
  - [ ] `presets.ts` 미커버 0, 테이블이 `Record<AnnotationTool, boolean>`이다.
  - [ ] `submitToAsana.ts`가 베이스라인 86.0% **위로** 회복(잔여는 `webpToJpeg` 본체).
  - [ ] `submitToClickup.ts` 미커버 0.
  - [ ] 표의 4플랫폼(+ 8-2 후 jira = 5)이 각각 "2차 갱신 실패 → 제출 성공 + 첨부 보존"을 assert한다.
  - [ ] **mutation**: clickup의 `try{}catch{}`를 제거하면 그 행이 red / `isStrokeTool`의 집합에서 `pen`을 빼면 해당 케이스만 red.

---

### Task 8: 프로덕션 결함 픽스 3건

**각 픽스는 재현 테스트 먼저(red) → 픽스 → 별도 커밋 → `/postmortem` 회고 1항목.** 이 3건을 초과하는 red가 나오면 배치를 세우고 이월한다.

- **8-1. asana 첨부 파일명 충돌** (`src/sidepanel/lib/submitToAsana.ts`)
  - 재현: 사용자가 `before-0.jpg`(또는 `logs.html`)를 첨부한 상태로 제출 → `userAttachmentNames`(`:138`) 가드가 `:194`에서 동명의 캡처를 `imageRefs`에서 제외 → **본문에서 스크린샷이 사라진다**. `logs.html`이면 `logsDropped`(`:198`)가 true가 돼 잘못된 "용량 초과" 경고까지.
  - [ ] 재현 테스트가 red → 픽스 후 green. 캡처와 사용자 첨부를 파일명이 아닌 축으로 구분한다.
  - [ ] `logs.html` 동명 케이스에서 `logsDropped`가 false로 남는다.
- **8-2. jira 2차 본문 갱신 격리** (`src/background/messages.ts:859` 부근)
  - 재현: 이슈 생성 성공 + 본문 갱신 실패 → 지금은 사용자에게 제출 실패로 보인다(이슈는 이미 생성됨).
  - [ ] 재현 테스트가 red → 픽스 후 green. 다른 4플랫폼(clickup·asana·linear·gitlab)과 같은 격리.
  - [ ] Task 7의 표에 jira를 추가해 **5플랫폼**으로 만든다.
- **8-3. `logSummary.console.lineNoError` 문면** (`src/i18n/namespaces/logs.ts:125` ko / `:266` en)
  - `"콘솔: {n}건 (에러 없음)"` → `"(에러·경고 없음)"` / `"(no errors)"` → `"(no errors or warnings)"`. 분기가 `warnCount === 0`도 요구하므로 지금 문면은 사실이지만 독자가 그걸 모른다.
  - [ ] ko·en 양쪽 갱신(PostToolUse 훅이 `locales.test.ts`를 자동 실행 — placeholder 토큰 일치 확인).
  - [ ] Task 2 축 B 테스트는 `t()`를 키로 목하므로 **green을 유지한다**(문면 변경에 부서지지 않는 설계).
  - [ ] `log-viewer` 복제 사전(`src/log-viewer/i18n.ts`)에는 이 키가 **없음을 확인했다** — 갱신 대상 아님.

---

### Task 9: 최종 측정 + 베이스라인 래칫

- **변경 대상**: `coverage/baseline.json`
- **작업 내용**: 전 태스크 완료 후 `pnpm test:coverage && pnpm coverage:report`. **베이스라인 갱신 게이트는 "하락 파일 0" 하나다** — 로직 ≥88%는 기획 성공 기준으로만 쓰고 갱신 조건에 넣지 않는다(회귀가 없는데 안 올리면 기준선이 또 낡는다. 지금 이미 4릴리스 얼어 있었다). 커밋은 `chore(coverage): ratchet baseline` 단독.
- **판정식 참고**: 하락은 `curPct < prevPct − 0.05`(파일 단위, `browserBound` 제외, 베이스라인에 없는 신규 파일은 skip)이고 스크립트는 exit code를 안 바꾼다 — **사람이 보는 게이트**다.
- **검증**:
  - [ ] 래칫 경고 **0건**(prd.md 목표 1의 8행 전부).
  - [ ] 로직 스코프 Lines ≥ 88%, 그 상승분에 분모 재정의 기여 0.
  - [ ] 9개 태스크의 mutation 기록이 전부 남았다.
  - [ ] `coverage/baseline.json`만 담긴 커밋.
  - [ ] 하락이 남아 있으면 **갱신하지 않고** 원인을 보고한다.
  - [ ] (선택) `coverage/coverage-summary.json` 루트 구파일 정리.

## 테스트 계획

- **단위 테스트**: 이 기획의 산출물 자체다. 신규 6파일 + 기존 14파일 확장.
- **e2e 시나리오**: **없음.** Task 8의 3건은 유닛으로 재현 가능하다(canvas·실네트워크 의존이 아니다). 단 8-1·8-2는 제출 경로 변경이므로 착수 시 `/e2e-write` 필요성을 한 번 판단한다.
- **수동 테스트**: **8-3만.** ko/en 두 로케일에서 로그 요약 줄을 눈으로 확인(문면 변경). 나머지는 없음.
- **회귀 그물 확인**: 소스 스캔 5개(`bundleBoundary`·`import-convention`·`builderLocaleWrap`·`escape-html`·`manifest-locales`)는 `src/test/sourceFiles.ts:11`의 `__tests__` prune 때문에 신규 테스트 파일로 red가 안 난다. `src/test/fetch-mock.ts`는 prune 밖이지만 그 판정들이 찾는 대상이 아니다.

## 구현 순서 권장

**정본은 이 다이어그램 하나다.** 아래 순서 외의 안내는 없다.

```
Task 2 (골든 2축) ─────┐
Task 3 (blob-db) ─────┤
Task 6 (settings-store)┤   ← 서로 독립, 병렬 가능
Task 7 (래칫 잔여) ─────┤      (Task 7의 jira 행만 8-2 이후)
                       │
Task 8 (프로덕션 픽스 3건) ┤
                       │
Task 4 (expandBlock) ──┴─> Task 5-1 (notion)
Task 1 (fetch-mock) ─────> Task 5-2 … 5-8 (서로 병렬)
                                    └─> Task 9 (최종 측정 + 래칫)
```

- **간선 4개가 전부다**: `1 → 5-*` · `4 → 5-1` · `8-2 → Task 7의 jira 행` · `모두 → 9`.
- **먼저 붙이면 이득이 큰 순서**(다이어그램을 위반하지 않는 범위): Task 2 → 7 → 3 → 6 → 8 → **1** → 4 → 5 → 9. Task 2·7이 래칫 8건 중 5건을 지우고 비용이 가장 작다. **Task 1을 5보다 먼저** 두는 걸 잊지 말 것.
- Task 5의 8 서브태스크는 독립이라 나눠 진행 가능. **미커버 목표치 확인은 Task 5를 다 끝낸 뒤 1회**로 묶는다(`pnpm test:coverage`는 전체 실행이다).
- Task 9는 반드시 마지막. 중간에 돌리면 래칫 판정이 요동한다.

## 가이드 영향

**없음.** Task 8-3(문면 변경)이 유일한 사용자 노출 변경인데, `guide/`를 "에러 없음"·"no errors"로 grep한 결과 가이드 본문·스크린샷 인용이 **0건**이다(`guide/SHOOTING.md:206`의 한 건은 Playwright 주의사항 산문이라 무관). 나머지 태스크는 사용자 노출 변경이 없다.
