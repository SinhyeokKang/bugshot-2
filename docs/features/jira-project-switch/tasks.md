# Jira 프로젝트 제출 시 전환 — 구현 태스크

## 선행 조건

- 권한·env·외부 API 변경 **없음**. `jira.listProjects`(query 지원)·`jira.listIssueTypes`·`jira.searchEpics`·`jira.submitIssue`가 이미 필요한 인자를 받는다.
- background·manifest·`docs/privacy.*` 변경 **없음**(새 캡처·수집·전송 동작 없음, 기존 Jira REST 호출의 인자만 바뀐다).
- i18n 신규 키 **없음** — `jira.project`·`project.select`·`project.search`·`project.empty` 재사용.
- 스토어 마이그레이션 **없음** — 추가 필드가 전부 optional.
- 착수 전 `docs/POSTMORTEM.md`를 `initialJiraFields`·`담당자`·`prefill`로 grep(2026-06-27 담당자 가로채기 항목이 이 파일과 직접 얽힌다).

## 태스크

### Task 1: 타입 확장

- **변경 대상**: `src/types/platform.ts`, `src/store/editor-store.ts`
- **작업 내용**
  - `JiraLastSubmitFields`에 `issueTypeId?: string`, `siteId?: string` 추가.
  - `EditorIssueFields`에 `projectKey?: string` 추가.
  - `SETTINGS_STORE_VERSION`·`EDITOR_SNAPSHOT_KEYS` 변경 없음(optional 추가 / `issueFields`는 이미 스냅샷 대상).
- **검증**
  - [ ] `pnpm typecheck` 통과 — 이 시점에 컴파일 에러가 나는 곳이 없어야 한다(순수 추가).
  - [ ] `EDITOR_SNAPSHOT_KEYS`에 `issueFields`가 그대로 있는지 확인(스냅샷 누락 시 프로젝트가 세션에 안 남는다).

### Task 2: `initialJiraFields` 재정의 (TDD)

- **변경 대상**: `src/sidepanel/lib/initialJiraFields.ts`, `src/sidepanel/lib/__tests__/initialJiraFields.test.ts`
- **작업 내용**
  - 테스트 먼저: 아래 케이스를 red로 만든 뒤 구현.
  - `currentSiteId?: string` 3번째 인자 추가. `sameProject` 게이트 제거, `sameSite` 게이트 도입.
  - 반환 타입을 `Omit<JiraLastSubmitFields, "siteId">`로 바꾸고 `projectKey`를 반환. 기존 "projectKey는 반환하지 않는다" 주석을 새 근거로 교체(정식 필드가 됐다).
  - `issueTypeId`·담당자 폴백은 `isDefaultProject`일 때만 계정 기본값을 쓴다. 담당자 id·표시명은 소스 단위로 통째 선택하는 기존 규율 유지.
- **검증**
  - [ ] 직전 제출이 `API`면 `projectKey: "API"` + 하위 필드가 함께 복원된다.
  - [ ] 직전 제출이 없으면 `account.projectKey` + 계정 기본 이슈타입·담당자.
  - [ ] `last.siteId`가 현재 사이트와 다르면 `last`를 통째로 버리고 계정 기본으로 연다.
  - [ ] `last.siteId`가 없거나 `currentSiteId`가 없으면 사이트 검증을 건너뛴다(기존 데이터 하위호환).
  - [ ] 복원 프로젝트가 계정 기본과 다르면 계정 기본 이슈타입·담당자가 **주입되지 않는다**.
  - [ ] 담당자가 `last`에 있으면 이름도 `last` 것이 붙는다(다른 사람 이름이 섞이지 않는다).
  - [ ] `pnpm test src/sidepanel/lib/__tests__/initialJiraFields.test.ts` green.

### Task 3: 프로젝트 전환 리셋 규칙 (TDD)

- **변경 대상**: `src/sidepanel/tabs/jiraFields/project-change.ts`(신규), `src/sidepanel/tabs/jiraFields/__tests__/project-change.test.ts`(신규)
- **작업 내용**: `applyProjectChange(current, nextProjectKey)` 순수 함수. 프로젝트가 실제로 바뀔 때만 `issueTypeId`·`assigneeId`·`assigneeName`·`priorityId`·`priorityName`·`parentKey`·`parentLabel`·`relates`를 `undefined`로 하는 patch를 반환. `cc`는 patch에 포함하지 않는다.
- **검증**
  - [ ] 다른 프로젝트로 바꾸면 위 8개 키가 patch에 `undefined`로 들어간다.
  - [ ] `cc`가 patch에 없다(기존 값 보존).
  - [ ] 같은 프로젝트를 다시 고르면 `projectKey`만 있는 patch — 입력이 날아가지 않는다.

### Task 4: `ProjectField` 컴포넌트

- **변경 대상**: `src/sidepanel/tabs/jiraFields/ProjectField.tsx`(신규)
- **작업 내용**: `FieldCombobox` + `useDebouncedSearch`로 `jira.listProjects`(query) 조회. 선택 시 `onChange(project.key)`. 라벨은 `이름` + 보조행 `키`(연동 탭 `ProjectCombobox`의 2행 표시와 동일), `fallbackLabel`로 목록 로드 전 선택된 키 표시. 필수 필드라 `clearable` 없음.
- **검증**
  - [ ] 콤보를 열면 목록을 조회하고, 검색어 입력 시 서버 검색(`query`)이 나간다 — `EpicField`와 동일한 디바운스 경로.
  - [ ] 조회 실패 시 에러 문구가 뜨고 선택된 값의 라벨은 유지된다.
  - [ ] 목록 로드 전에도 이미 선택된 프로젝트 키가 트리거에 보인다.

### Task 5: `JiraIssueFields` 배선

- **변경 대상**: `src/sidepanel/tabs/jiraFields/JiraIssueFields.tsx`
- **작업 내용**: 최상단에 `FieldRow label={t("jira.project")} required` + `ProjectField`. 변경 핸들러가 `applyProjectChange` patch를 `onChange`로 넘긴다. `fields.projectKey`(없으면 계정 기본값)를 `IssueTypeField`·`EpicField`·`RelatesField`에 prop으로 전달. 프로젝트가 비면 하위 필드는 기존 disabled 표현을 따른다.
- **검증**
  - [ ] 제출 다이얼로그 Jira 탭 최상단에 프로젝트 행이 보인다.
  - [ ] 프로젝트를 바꾸면 이슈타입·담당자·우선순위·에픽·연결 이슈 표시가 비고, 참조(cc)는 남는다.
  - [ ] `isEpicType` 로컬 상태도 함께 초기화된다(에픽 프로젝트에서 일반 프로젝트로 옮길 때 상위 에픽 행이 숨은 채 남지 않는다).

### Task 6: 하위 필드 스코프 전환

- **변경 대상**: `src/sidepanel/tabs/jiraFields/IssueTypeField.tsx`, `EpicField.tsx`, `RelatesField.tsx`
- **작업 내용**
  - 세 컴포넌트가 `projectKey` prop을 받아 조회 스코프로 쓴다(`EpicField`·`RelatesField`는 `useJiraConfig().projectKey` 대신, `useJiraConfig`는 연동 게이트로 유지).
  - **`IssueTypeField`의 `defaultId`/`defaultName` 자동 적용을 현재 프로젝트가 계정 기본 프로젝트일 때로 제한**(design R2).
  - `projectKey`가 바뀌면 캐시된 목록을 비우는 기존 `useEffect` 의존성을 prop 기준으로 교체.
- **검증**
  - [ ] 프로젝트 A→B 전환 후 이슈타입 콤보를 열면 **B의** 이슈타입이 나온다(A 목록이 캐시로 남지 않는다).
  - [ ] 계정 기본 프로젝트가 아닌 곳에서 이슈타입을 비우면 계정 기본 이슈타입이 **자동으로 다시 채워지지 않는다**.
  - [ ] 계정 기본 프로젝트에서는 기존대로 기본 이슈타입이 자동 선택된다(기존 동작 보존).
  - [ ] 에픽·연결 이슈 검색이 전환한 프로젝트 기준으로 나간다.

### Task 7: 제출 경로 2곳

- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**
  - `DraftDetailDialog`의 로컬 `SubmitFields`에 `projectKey?: string` 추가.
  - 두 곳의 `initialJiraFields(...)` 호출에 `jiraSiteId(jiraAccount.auth)` 전달.
  - 제출 시 유효 프로젝트 = `fields.projectKey ?? jiraAccount.projectKey`. 연결 가드도 이 값 기준.
  - `setLastSubmitFields("jira", …)`에 `projectKey`(유효값)·`issueTypeId`·`siteId` 추가.
  - `accounts.jira`는 어느 경로에서도 쓰지 않는다.
- **검증**
  - [ ] 프로젝트를 바꿔 제출하면 그 프로젝트로 등록된다(스파이로 `jira.submitIssue` payload의 `projectKey` 확인).
  - [ ] 제출 후 `accounts.jira.projectKey`가 불변이다.
  - [ ] 제출 후 `lastSubmitFields.jira`에 `projectKey`·`issueTypeId`·`siteId`가 기록된다.
  - [ ] 두 진입점 모두 동일하게 동작한다.

### Task 8: e2e

- **변경 대상**: `e2e/jira-project-switch.spec.ts`(신규)
- **작업 내용**: settings envelope seed(`projectKey: "WEB"` 필수 — design R6) + `chrome.runtime.sendMessage` 스파이로 `jira.listProjects`/`jira.listIssueTypes`/`jira.submitIssue` 가로채기. `slack-issue-promotion.spec.ts`의 `spySendMessage` 패턴 재사용.
- **검증**: 아래 "e2e 시나리오" 3건이 green.

### Task 9: 가이드 (구현 후 `/guide`)

- **변경 대상**: `guide/{ko,en}/integrations/platforms.md`
- **작업 내용**: "연결 후 기본값" 섹션에서 Jira 프로젝트가 이제 제출 시점에도 바꿀 수 있음을 반영. 58행의 "직전에 제출할 때 고른 값이 우선" 규칙이 프로젝트에도 적용된다는 점 추가.

## 테스트 계획

### 단위 테스트

- `src/sidepanel/lib/__tests__/initialJiraFields.test.ts` — **기존 파일 갱신**. `sameProject` 전제로 쓰인 케이스가 red로 잡히므로, 새 의도(설정은 기본값 / 직전 제출이 우선 / 사이트가 다르면 무효)를 케이스명에 남기며 재작성. Task 2 검증 항목 6개가 그대로 케이스.
- `src/sidepanel/tabs/jiraFields/__tests__/project-change.test.ts` — 신규. Task 3 검증 항목 3개.
- `src/sidepanel/tabs/jiraFields/__tests__/IssueTypeField.test.tsx` — 신규(jsdom). `defaultId` 자동 주입 가드(R2). 계정 기본 프로젝트일 때 자동 선택 O / 다른 프로젝트일 때 X. `AssigneeField.test.tsx`의 셋업을 참고.

### e2e 시나리오

- 제출 다이얼로그 Jira 탭에서 프로젝트를 `WEB`→`API`로 바꾸면, 이슈타입 콤보가 비고 다시 열었을 때 `API`의 이슈타입 목록이 조회된다.
- 프로젝트를 바꿔 제출하면 `jira.submitIssue` payload의 `projectKey`가 `API`이고, 제출 후 연동 탭의 기본 프로젝트는 여전히 `WEB`이다.
- 제출 후 새 이슈 작성 흐름으로 다시 들어가면 제출 다이얼로그가 `API`로 열린다(sticky).

### 수동 테스트 (Chrome)

- 실제 Jira 사이트에서 프로젝트 A→B 전환 후 제출 — 이슈타입 스킴이 다른 프로젝트 쌍으로 시험해 400이 나지 않는지(R2 실물 확인).
- 프로젝트가 50개를 넘는 사이트에서 검색으로 51번째 이후 프로젝트를 찾아 선택·제출.
- API 토큰(`kind: "apiKey"`) 계정에서도 프로젝트 전환·제출이 동작하는지.
- 에픽 계층이 있는 프로젝트 → 없는 프로젝트로 전환 시 상위 에픽 행 표시가 깨지지 않는지.

## 구현 순서 권장

```
Task 1 (타입)
   ├─→ Task 2 (initialJiraFields)  ─┐
   └─→ Task 3 (project-change)     ─┤
                                    ├─→ Task 5 (JiraIssueFields 배선) ─→ Task 7 (제출 경로) ─→ Task 8 (e2e) ─→ Task 9 (가이드)
       Task 4 (ProjectField)       ─┤
       Task 6 (하위 필드 스코프)    ─┘
```

- Task 2·3·4·6은 Task 1 이후 **병렬 가능**(서로 다른 파일, 의존 없음).
- Task 5가 합류 지점 — 4·6이 끝나야 배선이 완결된다.
- Task 7은 Task 2(초기화 시그니처)와 Task 5(필드 값 소스) 양쪽에 의존한다.
- Task 8·9는 기능이 동작한 뒤.

## 가이드 영향

- `guide/ko/integrations/platforms.md` · `guide/en/integrations/platforms.md` — "연결 후 기본값" 섹션(52–60행). Jira 프로젝트가 연동 탭 전용에서 제출 시점 선택 가능으로 바뀐다.
- `guide/{ko,en}/element/issue.md`(59행) · `screenshot/issue.md`(94행) · `video/issue.md`(98행) — *"연결한 플랫폼의 필드(프로젝트·담당자·라벨 등)를 채우고"* 문장은 이 변경으로 **더 정확해진다**(지금은 Jira에서 프로젝트를 못 골랐다). 문구 수정은 불필요할 가능성이 높으나 `/guide` 시 확인 대상.
- 스크린샷: 제출 다이얼로그 Jira 탭에 행이 하나 늘어나므로 해당 컷이 있으면 `/guide-shots` 대상.
