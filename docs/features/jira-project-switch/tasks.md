# Jira 프로젝트 제출 시 전환 — 구현 태스크

## 선행 조건

- 권한·env·외부 API 변경 **없음**. `jira.listProjects`(query 지원)·`jira.listIssueTypes`·`jira.searchEpics`·`jira.submitIssue`가 이미 필요한 인자를 받는다.
- manifest·`docs/privacy.*` 변경 **없음**(새 캡처·수집·전송 동작 없음, 기존 Jira REST 호출의 인자만 바뀐다).
- background 변경은 **분석 프로퍼티 화이트리스트 1줄뿐**(`analytics.ts` — Task 7). Jira 메시지 핸들러는 무변경.
- i18n 신규 키 **없음** — `jira.project`·`project.select`·`project.search`·`project.empty` 재사용.
- 스토어 마이그레이션 **없음** — 추가 필드가 전부 optional.
- 착수 전 `docs/POSTMORTEM.md`에서 **`2026-06-30 — Slack 채널·멘션 직전값 미기억 (prefill 우선순위 역전)`** 항목을 읽는다. 이 변경의 규칙(제출 목적지는 last 우선, defaults는 fallback)이 거기서 정해졌다.
  - ⚠️ 이전 초안이 지목했던 *"2026-06-27 담당자 가로채기"* 항목은 **실재하지 않는다.** 그 날짜의 유일한 항목은 cross-origin stylesheet 건이고, `initialJiraFields`·`lastSubmitFields`·`issueTypeId`로 grep하면 0건이다. `editor-store.ts:858` 주석이 그 없는 회고를 가리키고 있으므로 Task 2에서 함께 정리한다.

## 태스크

### Task 1: 타입 확장

- **변경 대상**: `src/types/platform.ts`, `src/store/editor-store.ts`
- **작업 내용**
  - `JiraLastSubmitFields`에 `issueTypeId?: string`, `siteId?: string` 추가.
  - `EditorIssueFields`에 `projectKey?: string` 추가.
  - `SETTINGS_STORE_VERSION`·`EDITOR_SNAPSHOT_KEYS` 변경 없음(optional 추가 / `issueFields`는 이미 스냅샷 대상 — `editor-store.ts:339`).
- **검증**
  - [x] `src/sidepanel/hooks/useEditorSessionSync.ts:92`의 `snapshotFromState`가 `issueFields`를 **통째로** 복사하는지 확인 — 이게 키를 손나열하는 형태면 `projectKey`가 세션에 안 실려 sticky 세션 층(PRD 목표 2)이 조용히 죽는다.
  - [x] `pnpm test src/store/__tests__/editor-store.test.ts` — **`:1743`의 `it("issueFields에 projectKey가 새지 않는다 …")`가 red로 뜨는지 확인.** green이면 타입 추가가 실제로 반영되지 않은 것이다. (이 케이스는 Task 2에서 뒤집는다.)

### Task 2: `initialJiraFields` 재정의 + `confirmDraft` 배선 (TDD)

- **변경 대상**: `src/sidepanel/lib/initialJiraFields.ts`, `src/sidepanel/lib/__tests__/initialJiraFields.test.ts`, **`src/store/editor-store.ts`(`confirmDraft`)**, `src/store/__tests__/editor-store.test.ts`
- **작업 내용**
  - 테스트 먼저: 아래 케이스를 red로 만든 뒤 구현.
  - `currentSiteId?: string` 3번째 인자 추가. `sameProject` 게이트 제거, `sameSite` 게이트 도입.
  - 반환 타입을 `Omit<JiraLastSubmitFields, "siteId">`로 바꾸고 `projectKey`를 반환. 기존 "projectKey는 반환하지 않는다" 주석을 새 근거로 교체(정식 필드가 됐다).
  - `issueTypeId`·담당자 폴백은 `isDefaultProject`일 때만 계정 기본값을 쓴다. 담당자 id·표시명은 소스 단위로 통째 선택하는 기존 규율 유지.
  - **`confirmDraft`(853행) 호출에 `jiraSiteId(auth)`를 3번째 인자로 전달한다.** ⚠️ 이게 이 기능의 **주경로**다(`IssueCreateModal`은 `initialJiraFields`를 호출하지 않는다). 3번째 인자가 optional이라 빠뜨려도 typecheck·test 둘 다 green이고 `sameSite` 게이트만 무음 no-op이 되므로, 아래 검증 항목으로 명시 고정한다.
  - **`restorable` 게이트에 `projectKey` 예외**(855행): 게이트가 false여도 `init.projectKey`는 복원한다.
  - **`confirmDraft:858-861` 담당자 백필에 `merged.projectKey === init.projectKey` 조건 추가.**
  - `editor-store.ts:858`의 stale POSTMORTEM 참조 주석(2026-06-27)을 실재 항목(2026-06-30)으로 교체.
- **검증**
  - [x] 직전 제출이 `API`면 `projectKey: "API"` + 하위 필드가 함께 복원된다.
  - [x] 직전 제출이 없으면 `account.projectKey` + 계정 기본 이슈타입·담당자.
  - [x] `last.siteId`가 현재 사이트와 다르면 `last`를 통째로 버리고 계정 기본으로 연다.
  - [x] `last.siteId`가 없거나 `currentSiteId`가 없으면 사이트 검증을 건너뛴다. **이건 예외 케이스가 아니라 업데이트 직후 기존 사용자 전원이 타는 경로다**(design R1-b).
  - [x] 복원 프로젝트가 계정 기본과 다르면 계정 기본 이슈타입·담당자가 **주입되지 않는다**.
  - [x] 담당자가 `last`에 있으면 이름도 `last` 것이 붙는다(다른 사람 이름이 섞이지 않는다).
  - [x] **`confirmDraft`가 현재 사이트 id를 넘긴다** — 다른 사이트의 `lastSubmitFields`를 심어두고 `confirmDraft`를 돌렸을 때 계정 기본 프로젝트로 열리는지 스토어 테스트로 고정.
  - [x] **`restorable=false`(세션에 assigneeId 존재)여도 `projectKey`는 복원된다.**
  - [x] **세션 프로젝트와 `init` 프로젝트가 다르면 담당자 백필이 일어나지 않는다.**
  - [x] `editor-store.test.ts:1743`의 "projectKey가 새지 않는다" 케이스를 새 의도로 뒤집어 재작성(세션 영속이 이제 의도된 동작).
  - [x] `pnpm test src/sidepanel/lib/__tests__/initialJiraFields.test.ts src/store/__tests__/editor-store.test.ts` green.

### Task 3: 프로젝트 전환 리셋 규칙 (TDD)

- **변경 대상**: `src/sidepanel/tabs/jiraFields/project-change.ts`(신규), `src/sidepanel/tabs/jiraFields/__tests__/project-change.test.ts`(신규)
- **작업 내용**: `resolveProjectChange(current, nextProjectKey)` 순수 함수. 프로젝트가 실제로 바뀔 때만 `issueTypeId`·`assigneeId`·`assigneeName`·`parentKey`·`parentLabel`·`relates` **6개**를 `undefined`로 하는 patch를 반환. `priorityId`·`priorityName`·`cc`는 patch에 포함하지 않는다(사이트 전역 — design §4).
- **검증**
  - [x] 다른 프로젝트로 바꾸면 위 6개 키가 patch에 `undefined`로 들어간다.
  - [x] `priorityId`·`priorityName`·`cc`가 patch에 없다(기존 값 보존).
  - [x] 같은 프로젝트를 다시 고르면 `projectKey`만 있는 patch — 입력이 날아가지 않는다.

### Task 4: `ProjectField` 컴포넌트

- **변경 대상**: `src/sidepanel/tabs/jiraFields/ProjectField.tsx`(신규), `src/sidepanel/tabs/jiraFields/__tests__/ProjectField.test.tsx`(신규)
- **작업 내용**: `FieldCombobox` + `useDebouncedSearch`로 `jira.listProjects`(query) 조회. 선택 시 `onChange(project.key)`. 필수 필드라 `clearable` 없음.
  - **표시**: 트리거는 `` `${name} (${KEY})` `` **1행**(`FieldCombobox` 트리거는 단일 span truncate 고정이라 2행 불가). 리스트 항목은 `children`에 `flex-col`로 이름 + 키 **2행**(`AssigneeField.tsx:129-136` 선례). `fallbackLabel`로 목록 로드 전 선택된 키 표시.
  - **`aria-label={t("jira.project")}` + `data-testid="jira-project-combobox"` 를 트리거에 붙인다.** 전자는 접근성(행이 7개가 되면 접근 이름 없는 combobox가 7개 나열), 후자는 e2e 판정 수단 — `jiraFields/`에 testid가 0개이고 `FieldRow`의 `<label>`에 `htmlFor`가 없어 `getByLabel`이 실패한다.
- **검증**
  - [x] 콤보를 열면 목록을 조회하고, 검색어 입력 시 서버 검색(`query`)이 나간다 — `EpicField`와 동일한 디바운스 경로. **S4(51번째 프로젝트)의 존재 이유가 이 경로이므로 수동이 아니라 단위로 고정한다.**
  - [x] 조회 실패 시 **콤보를 연 상태에서** 에러 문구가 뜨고, 트리거에는 선택된 키가 유지된다.
  - [x] 빈 목록(접근 가능한 프로젝트 0개)이면 `project.empty` 문구가 뜬다.
  - [x] 목록 로드 전에도 이미 선택된 프로젝트 키가 트리거에 보인다.

### Task 5: `JiraIssueFields` 배선 + 제출 게이트

- **변경 대상**: `src/sidepanel/tabs/jiraFields/JiraIssueFields.tsx`, **`src/sidepanel/tabs/SubmitFieldsDialog.tsx`**
- ⚠️ **Task 6과 한 커밋으로 간다 — 5 단독 머지 금지.** `IssueTypeField.tsx:56-58`의 자동 주입이 `resolveProjectChange`로 비운 `issueTypeId`를 **즉시** 계정 기본값으로 되박으므로, Task 6 없이는 이 태스크의 핵심 동작이 성립하지 않는다.
- **작업 내용**
  - 최상단에 `FieldRow label={t("jira.project")} required` + `ProjectField`.
  - 변경 핸들러가 `resolveProjectChange` patch를 `onChange`로 넘긴다.
  - **같은 핸들러에서 `setIsEpicType(false)`.** `isEpicType`은 `handleIssueTypeChange`(`:23-35`) 안에서만 갱신되므로 patch만으로는 절대 리셋되지 않는다.
  - **같은 핸들러에서 `IssueTypeField` 콤보를 자동으로 연다** — 제출 버튼이 즉시 잠기는 것에 대한 유일한 단서(design §12).
  - `fields.projectKey`(없으면 계정 기본값)를 `IssueTypeField`·`EpicField`·`RelatesField`에 prop으로 전달.
  - `SubmitFieldsDialog.tsx:199`의 jira `fieldsReady`를 `!!jiraFields.projectKey && !!jiraFields.issueTypeId`로 (다른 7개와 정합).
- **검증**
  - [x] 제출 다이얼로그 Jira 탭 최상단에 프로젝트 행이 보인다.
  - [x] 프로젝트를 바꾸면 이슈타입·담당자·에픽·연결 이슈 표시가 비고, **우선순위와 참조(cc)는 남는다**.
  - [x] 프로젝트를 바꾼 직후 제출 버튼이 잠기고 이슈타입 콤보가 열린다.
  - [x] 이슈타입을 고르면 제출 버튼이 다시 활성화된다.
  - [x] `isEpicType` 로컬 상태도 함께 초기화된다(에픽 프로젝트에서 일반 프로젝트로 옮길 때 상위 에픽 행이 숨은 채 남지 않는다).

### Task 6: 하위 필드 스코프 전환

- **변경 대상**: `src/sidepanel/tabs/jiraFields/IssueTypeField.tsx`, `EpicField.tsx`, `RelatesField.tsx`, `src/sidepanel/tabs/jiraFields/__tests__/IssueTypeField.test.tsx`(신규). 목록 잔존 처리 방식에 따라 `useDebouncedSearch.ts`.
- **작업 내용**
  - 세 컴포넌트가 `projectKey` prop을 받아 조회 스코프로 쓴다(`EpicField`·`RelatesField`는 `useJiraConfig().projectKey` 대신, `useJiraConfig`는 연동 게이트로 유지).
  - **`IssueTypeField`의 `defaultId` 자동 적용을 계정 기본 프로젝트일 때로 제한 — 경로가 둘이다**(design R2):
    1. `useEffect`(`:56-58`)의 `onChange(defaultId)`
    2. **파생값 `effectiveValue = value ?? defaultId`(`:53`)** — 라벨(`:69`)·체크마크(`:83`)를 직접 먹인다. 여기를 놓치면 화면엔 선택된 것처럼 보이는데 실제 값은 비어 400이 아니라 `create.requiredMissing`으로 죽는다.
  - `IssueTypeField.tsx:26-29`의 캐시 비우기 `useEffect` 의존성을 prop 기준으로 교체.
  - **`EpicField`·`RelatesField`의 목록 잔존 처리.** 이 둘의 목록은 `useDebouncedSearch` 내부 `items`에 있고 훅이 `{items, loading, error, search}`만 노출해 reset 수단이 없다 — 그대로 두면 전환 후 다음 fetch resolve까지 이전 프로젝트의 에픽·연결 이슈가 목록에 남는다. `key={projectKey}` remount(변경 면적 작음) 또는 훅에 reset 노출.
- **검증**
  - [x] 프로젝트 A→B 전환 후 이슈타입 콤보를 열면 **B의** 이슈타입이 나온다(A 목록이 캐시로 남지 않는다).
  - [x] 계정 기본 프로젝트가 아닌 곳에서 이슈타입을 비우면 계정 기본 이슈타입이 **자동으로 다시 채워지지 않는다** — 값도, **트리거 라벨·체크마크 표시도**.
  - [x] 계정 기본 프로젝트에서는 기존대로 기본 이슈타입이 자동 선택된다(기존 동작 보존).
  - [ ] 에픽·연결 이슈 검색이 전환한 프로젝트 기준으로 나가고, **이전 프로젝트의 에픽이 목록에 남지 않는다**(요청만이 아니라 표시까지).
  - [x] 프로젝트를 A→B→A로 빠르게 바꿔도 늦게 도착한 응답이 목록을 오염시키지 않는다(`IssueTypeField`의 `cancelled` 가드 + `if (items.length > 0) return`(`:33`) 조합 확인).

### Task 7: 제출 경로 2곳 + 채택 측정

- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`, `src/background/analytics.ts`
- **작업 내용**
  - `DraftDetailDialog`의 로컬 `SubmitFields`에 `projectKey?: string` 추가. (타입을 `EditorIssueFields`로 통합하지 않는다 — 비목표.)
  - **`DraftDetailDialog.tsx:217`의 `initialJiraFields(...)` 호출에 `jiraSiteId(jiraAccount.auth)` 전달.** (다른 호출부인 `confirmDraft`는 Task 2 소관 — `IssueCreateModal`은 이 함수를 호출하지 않는다.)
  - 제출 시 유효 프로젝트 = `fields.projectKey ?? jiraAccount.projectKey`. 연결 가드(`IssueCreateModal.tsx:163`)도 이 값 기준.
  - `setLastSubmitFields("jira", …)`에 `projectKey`(유효값)·`issueTypeId`·`siteId` 추가. **호출부 2곳(`IssueCreateModal.tsx:194`·`DraftDetailDialog.tsx:451`)을 반드시 함께** — 한 곳만 고치면 siteId 없는 레코드가 덮어써져 게이트가 무음으로 사라진다.
  - `accounts.jira.projectKey`를 제출 payload·`lastSubmitFields` 어디에서도 직접 쓰지 않는다. (`jiraAccount.auth`는 연결 가드·`jiraSiteId`에, `jiraAccount.issueTypeName`은 `markSubmitted`에 계속 쓰인다 — 그건 R3 소관.)
  - `issue_submitted`에 `project_overridden`(boolean, 유효 프로젝트 ≠ `jiraAccount.projectKey`) 추가 + `analytics.ts:26`의 허용 프로퍼티 화이트리스트에 등록.
- **검증**
  - [x] 프로젝트를 바꿔 제출하면 그 프로젝트로 등록된다(스파이로 `jira.submitIssue` payload의 `projectKey` 확인).
  - [x] 제출 후 `accounts.jira.projectKey`가 불변이다.
  - [x] 제출 후 `lastSubmitFields.jira`에 `projectKey`·`issueTypeId`·`siteId`가 기록된다 — **두 진입점 각각에서**.
  - [x] `project_overridden`이 화이트리스트를 통과한다(등록 누락 시 값이 조용히 버려진다).

### Task 8: e2e

- **변경 대상**: `e2e/jira-project-switch.spec.ts`(신규), `e2e/COVERAGE.md`
- **작업 내용**: settings envelope seed + `chrome.runtime.sendMessage` 스파이로 `jira.listProjects`/`jira.listIssueTypes`/`jira.submitIssue` 가로채기. `slack-issue-promotion.spec.ts`의 `spySendMessage` 패턴 재사용.
  - **seed 필수 2개**: `projectKey: "WEB"`(design R6 — 없으면 `SetupDialog`가 자동으로 열려 다른 판정을 가린다), **`auth.cloudId`**(없으면 `jiraSiteId`가 `undefined`를 반환해 `sameSite` 게이트가 공허하게 통과한다). envelope은 `version: 11` + 최신 shape.
  - 콤보 특정은 `getByTestId("jira-project-combobox")`. `role=combobox` nth 인덱싱 금지 — `EpicField` 조건부 언마운트 + cmdk `CommandInput`이 팝오버 오픈 시 combobox를 하나 더 추가해 인덱스가 불안정하다.
  - `e2e/COVERAGE.md`에 시나리오 추가(`e2e/README.md` 규정).
- **검증**: 아래 "e2e 시나리오" 3건이 green.

### Task 9: 문서 (구현 후)

- **변경 대상**: `docs/DIRECTORY.md`, `guide/{ko,en}/integrations/platforms.md`
- **작업 내용**
  - **`docs/DIRECTORY.md:95`가 거짓이 된다** — `initialJiraFields`를 *"projectKey는 미반환[EditorIssueFields에 없는 키가 issueFields로 새는 것 차단]"*·*"project가 갈리면 직전 제출값 전량 무효"* 로 축어 기술 중이고 **두 문장 다 뒤집힌다.** `:85`의 `jiraFields/` 파일 목록에도 `ProjectField.tsx`·`project-change.ts` 추가. **`/guide`는 이 파일을 안 건드리므로 여기서 처리한다.**
  - 가이드는 `/guide` 스킬로: "연결 후 기본값" 섹션에서 Jira 프로젝트가 이제 제출 시점에도 바꿀 수 있음을 반영. 58행의 "직전에 제출할 때 고른 값이 우선" 규칙이 프로젝트에도 적용된다는 점 추가.

## 테스트 계획

### 단위 테스트

- `src/sidepanel/lib/__tests__/initialJiraFields.test.ts` — **기존 파일 갱신**. `sameProject` 전제로 쓰인 케이스가 red로 잡히므로, 새 의도(설정은 기본값 / 직전 제출이 우선 / 사이트가 다르면 무효)를 케이스명에 남기며 재작성.
- `src/store/__tests__/editor-store.test.ts` — **기존 파일 갱신(누락 주의).** `:1743`의 `it("issueFields에 projectKey가 새지 않는다 (EditorIssueFields에 없는 키 — 세션 영속 오염)")`가 `expect(...).not.toHaveProperty("projectKey")`로 **정확히 반대를 고정**하고 있어 Task 2에서 red가 된다. 케이스명을 새 의도로 뒤집고, `confirmDraft`의 사이트 전달·`restorable` 예외·담당자 백필 조건 케이스를 추가.
- `src/sidepanel/tabs/jiraFields/__tests__/project-change.test.ts` — 신규. Task 3 검증 항목 3개.
- `src/sidepanel/tabs/jiraFields/__tests__/IssueTypeField.test.tsx` — 신규(jsdom). `defaultId` 자동 주입 가드(R2) **두 경로 모두**. 계정 기본 프로젝트일 때 자동 선택 O / 다른 프로젝트일 때 값·라벨 둘 다 X.
  - **셋업 선례는 `AssigneeField.test.tsx`가 아니다.** 그쪽 핵심은 `vi.mock("../useJiraConfig")`인데 `IssueTypeField`는 `useSettingsStore((s) => s.accounts.jira)`를 직접 구독한다(`:19`). 맞는 선례는 `src/sidepanel/tabs/__tests__/IssueTab.test.tsx:8-14` / `statusBadges/__tests__/SubmittedBadge.test.tsx:28-32`의 `importOriginal` + 셀렉터 대입 패턴(`isJiraAccountComplete`·`jiraSiteId` 등 다른 export가 사라지지 않게 spread 필수).
  - **계정 객체를 매 렌더 새로 만들지 말 것** — `projectKey`가 effect dep(`:29`,`:49`)이고 `onChange`도 안정 identity가 필요하다(`AssigneeField.test.tsx`의 `JIRA_CONFIG` 상수 주석이 같은 함정을 기록).
- `src/sidepanel/tabs/jiraFields/__tests__/ProjectField.test.tsx` — 신규(jsdom). Task 4 검증 4개. 디바운스 콤보 jsdom 하네스는 `AssigneeField.test.tsx`가 이미 증명했다.

### e2e 시나리오

- 제출 다이얼로그 Jira 탭에서 프로젝트를 `WEB`→`API`로 바꾸면, 이슈타입 콤보가 비고 다시 열었을 때 `API`의 이슈타입 목록이 조회된다.
- 프로젝트를 바꿔 제출하면 `jira.submitIssue` payload의 `projectKey`가 `API`이고, **`chrome.storage.local`의 `bugshot-settings`에서 읽은 `accounts.jira.projectKey`는 여전히 `WEB`이다**(연동 탭 UI를 열어 판정하지 않는다 — `SetupDialog` 자동 오픈 등 부작용이 낀다).
- 제출 후 새 이슈 작성 흐름으로 다시 들어가면 제출 다이얼로그가 `API`로 열린다(sticky).

### 수동 테스트 (Chrome)

- 실제 Jira 사이트에서 프로젝트 A→B 전환 후 제출 — 이슈타입 스킴이 다른 프로젝트 쌍으로 시험해 400이 나지 않는지(R2 실물 확인).
- 프로젝트가 50개를 넘는 사이트에서 검색으로 51번째 이후 프로젝트를 찾아 선택·제출.
- **전환한 프로젝트에 배정 불가한 담당자를 골라 제출** — `jira.searchUsers`가 site-wide라 목록이 좁혀지지 않는다. R2와 독립된 400 경로이고, `resolveProjectChange`는 초기 상태만 보호한다.
- 우선순위를 고른 뒤 프로젝트를 바꿔 제출 — 유지된 우선순위가 대상 프로젝트에서 거부되지 않는지(프로젝트별 우선순위 스킴을 쓰는 사이트가 있으면 그쪽에서).
- 에픽 계층이 있는 프로젝트 → 없는 프로젝트로 전환 시 상위 에픽 행 표시가 깨지지 않는지.

> apiKey 계정 별도 확인은 불필요하다 — `jiraSiteId`(`settings-store.ts:297-304`)가 apiKey에서 `new URL(baseUrl).hostname`(파싱 실패 시 raw baseUrl)을 **항상** 반환하므로 게이트가 OAuth와 같게 동작한다.

## 구현 순서 권장

```
Task 1 (타입)
   ├─→ Task 2 (initialJiraFields + confirmDraft) ─┐
   ├─→ Task 3 (project-change)                   ─┤
   ├─→ Task 4 (ProjectField)                     ─┤
   └─→ Task 6 (하위 필드 스코프) ─────────────────┴─→ Task 5 (배선 + 제출 게이트)
                                                          │
                                                          └─→ Task 7 (제출 경로) ─→ Task 8 (e2e) ─→ Task 9 (문서)
```

- Task 2·3·4·6은 Task 1 이후 **병렬 가능**(서로 다른 파일, 의존 없음).
- **Task 5는 3·4·6 전부가 합류하는 지점이고, 특히 Task 6과는 한 커밋으로 간다** — 6 없이 5만 머지하면 `IssueTypeField`의 자동 주입이 리셋을 즉시 되박아 기능이 성립하지 않는다.
- Task 7은 Task 2(초기화 시그니처)와 Task 5(필드 값 소스) 양쪽에 의존한다.
- Task 8·9는 기능이 동작한 뒤.

## 회귀 리스크 (변경 영향 범위)

착수 전 이 목록을 grep으로 재확인한다 — 문서 작성 시점 기준이라 드리프트할 수 있다.

- **`initialJiraFields` 호출부**: `editor-store.ts:853`(주경로), `DraftDetailDialog.tsx:217`. 반환 타입이 바뀌므로 둘 다 컴파일 대상.
- **`lastSubmitFields.jira` 읽기/쓰기**: 위 두 곳 + `IssueCreateModal.tsx:194`·`DraftDetailDialog.tsx:451`(쓰기) + `removeAccount`(`settings-store.ts:196-204`, 삭제).
- **`accounts.jira.projectKey` 읽기**: `IssueCreateModal.tsx:174`·`DraftDetailDialog.tsx:426`(제출 — 이번에 유효 프로젝트로 교체), `isJiraAccountComplete`(연동 완료 판정 — **유지**), 연동 탭 `ProjectCombobox`(설정 — 무변경), `JiraIssueFields` 하위 필드 조회 스코프(이번에 prop으로 교체).
- **`EditorIssueFields` 소비처**: `JiraIssueFields`와 그 하위 필드 전부, `SubmitFieldsDialog`의 `fieldsReady`, 세션 스냅샷(`EDITOR_SNAPSHOT_KEYS` → `useEditorSessionSync.snapshotFromState`).
- **다른 7개 플랫폼**: 무영향 — Jira 분기만 건드린다. `SubmitFieldsDialog.fieldsReady`의 다른 분기를 건드리지 않는지 diff에서 확인.
- **마이그레이션**: 없음. 대신 기존 사용자 전원이 `siteId: undefined` 경로를 한 번 탄다(design R1-b).

## 가이드 영향

- `guide/ko/integrations/platforms.md` · `guide/en/integrations/platforms.md` — "연결 후 기본값" 섹션(52–60행). Jira 프로젝트가 연동 탭 전용에서 제출 시점 선택 가능으로 바뀐다.
- `guide/{ko,en}/element/issue.md`(59행) · `screenshot/issue.md`(94행) · `video/issue.md`(98행) — *"연결한 플랫폼의 필드(프로젝트·담당자·라벨 등)를 채우고"* 문장은 이 변경으로 **더 정확해진다**(지금은 Jira에서 프로젝트를 못 골랐다). 문구 수정은 불필요할 가능성이 높으나 `/guide` 시 확인 대상.
- 스크린샷: 제출 다이얼로그 Jira 탭에 행이 하나 늘어나므로 해당 컷이 있으면 `/guide-shots` 대상.
