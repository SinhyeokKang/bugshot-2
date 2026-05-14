# Multi-platform Issue Status Change — 구현 태스크

## 선행 조건

- GitHub 상태 변경 기능(`GithubStatusBadge`)이 정상 동작하는 상태.
- Jira, Linear, Notion 계정이 각각 연결된 테스트 환경.
- 각 플랫폼에 제출된 이슈가 이슈 목록에 존재.

## 태스크

### Task 1: Jira — 타입 + API + 메시지 핸들러

- **변경 대상**: `src/types/jira.ts`, `src/types/messages.ts`, `src/background/jira-api.ts`, `src/background/messages.ts`
- **작업 내용**:
  1. `src/types/jira.ts`에 `JiraTransition` 인터페이스 추가.
  2. `src/types/messages.ts`의 `BgRequest` 유니온에 `jira.getTransitions`, `jira.transitionIssue` 추가. `JiraTransition` import 추가.
  3. `src/background/jira-api.ts`에 `getTransitions(auth, issueKey)` 함수 추가.
     - `jiraFetch<{ transitions: Array<{...}> }>(auth, /rest/api/3/issue/{issueKey}/transitions)`.
     - 응답에서 `{ id, name, to: { name: to.name, categoryKey: to.statusCategory.key } }` 배열로 매핑.
  4. `src/background/jira-api.ts`에 `transitionIssue(auth, issueKey, transitionId)` 함수 추가.
     - `jiraFetch(auth, /rest/api/3/issue/{issueKey}/transitions, { method: "POST", body: { transition: { id: transitionId } } })`.
     - 반환: `void`.
  5. `getTransitions` 응답 매핑 로직(`transitions[] → JiraTransition[]`)을 순수 함수(`parseTransitions`)로 분리.
  6. `src/background/messages.ts`에 `jira.getTransitions`, `jira.transitionIssue` case 추가.
     - `jira.transitionIssue`는 트랜지션 실행 후 `getIssueStatus()`를 호출해 최신 `JiraIssueStatus` 반환.
     - 400 응답(필수 필드)은 별도 에러 메시지로 전달.
  7. `parseTransitions` 순수 함수의 단위 테스트 작성 (`src/background/__tests__/jira-api.test.ts`).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과 (parseTransitions 테스트 포함)

### Task 2: Linear — 타입 + API + 메시지 핸들러

- **변경 대상**: `src/types/linear.ts`, `src/types/messages.ts`, `src/background/linear-api.ts`, `src/background/messages.ts`
- **작업 내용**:
  1. `src/types/linear.ts`에 `LinearWorkflowState` 인터페이스 추가.
  2. `src/types/linear.ts`의 `LinearIssueStatus`에 `id: string` 필드 추가 (첫 번째 필드로).
  3. `src/types/messages.ts`의 `BgRequest` 유니온에 `linear.getWorkflowStates`, `linear.updateIssueState` 추가. `LinearWorkflowState` import 추가.
  4. `src/background/linear-api.ts`의 `getIssueStatus()` GraphQL 쿼리에 `id` 필드 추가, 반환 객체에 `id` 포함.
  5. `src/background/linear-api.ts`에 `getWorkflowStates(auth, issueIdentifier)` 함수 추가.
     - GraphQL: `query($id: String!) { issues(filter: { identifier: { eq: $id } }) { nodes { team { states { nodes { id name type color } } } } } }`.
     - `nodes`를 type 순서(`triage` → `backlog` → `unstarted` → `started` → `completed` → `cancelled`)로 정렬. 알 수 없는 type은 목록 끝에 배치.
  6. 정렬 로직을 순수 함수(`sortWorkflowStates`)로 분리.
  7. `src/background/linear-api.ts`에 `updateIssueState(auth, issueId, stateId)` 함수 추가.
     - GraphQL mutation: `issueUpdate(id: $id, input: { stateId: $stateId })`.
     - 응답에서 `{ id, identifier, title, state: { name, type }, url, labels }` 추출해 `LinearIssueStatus` 반환.
  8. `src/background/messages.ts`에 `linear.getWorkflowStates`, `linear.updateIssueState` case 추가.
  9. `sortWorkflowStates` 순수 함수의 단위 테스트 작성 (`src/background/__tests__/linear-api.test.ts`). 알 수 없는 type fallback 포함.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과 (sortWorkflowStates 테스트 포함)

### Task 3: Notion — API + 메시지 핸들러

- **변경 대상**: `src/types/messages.ts`, `src/background/notion-api.ts`, `src/background/messages.ts`
- **작업 내용**:
  1. `src/types/messages.ts`의 `BgRequest` 유니온에 `notion.updatePageStatus` 추가.
  2. `src/background/notion-api.ts`에 `updatePageStatus(auth, pageId, propertyName, optionName)` 함수 추가.
     - `notionFetch<NotionPageRaw>(auth, /pages/{pageId}, { method: "PATCH", body: { properties: { [propertyName]: { status: { name: optionName } } } } })`.
     - `parsePageStatus(data)` 재사용하여 `NotionPageStatus` 반환.
  3. `src/background/messages.ts`에 `notion.updatePageStatus` case 추가.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과

### Task 4: i18n 키 추가

- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**:
  1. ko.ts에 추가:
     - `"issueList.jira.statusUpdateFailed"`: `"상태 변경에 실패했습니다"`
     - `"issueList.jira.requiredFieldsError"`: `"필수 필드가 있어 변경할 수 없습니다. Jira에서 직접 변경해 주세요."`
     - `"issueList.jira.noTransitions"`: `"사용 가능한 전환이 없습니다"`
     - `"issueList.linear.statusUpdateFailed"`: `"상태 변경에 실패했습니다"`
     - `"issueList.notion.statusUpdateFailed"`: `"상태 변경에 실패했습니다"`
     - `"issueList.notion.noStatusOptions"`: `"상태 옵션이 없습니다"`
     - `"issueList.statusLoading"`: `"불러오는 중…"`
  2. en.ts에 동일 키의 영문 값 추가.
- **검증**:
  - [ ] `pnpm typecheck` 통과 (i18n 키 타입 정합성)

### Task 5: JiraStatusBadge UI 컴포넌트

- **변경 대상**: `src/sidepanel/tabs/IssueListTab.tsx`
- **작업 내용**:
  1. `JiraStatusBadge` 컴포넌트 추가.
     - Props: `issueKey: string`, `issueId: string`, `currentStatus: JiraIssueStatus`, `onStatusChanged: (s: JiraIssueStatus) => void`.
     - 팝오버 open 시 `sendBg("jira.getTransitions")` 호출 → transitions 상태에 저장.
     - 로딩 중: 팝오버 내 `Loader2` 스피너 표시.
     - 트랜지션 없으면: `t("issueList.jira.noTransitions")` 텍스트.
     - 각 트랜지션 항목: `to.name` 표시 + `STATUS_CATEGORY_COLORS[to.categoryKey]` 색상.
     - 현재 상태 `currentStatus.name`과 트랜지션 `to.name`이 일치하는 항목에 체크마크.
     - 선택 시: `sendBg("jira.transitionIssue")` → 성공 시 `onStatusChanged()` + `patchIssue()`.
     - 에러 시: `toast.error(t("issueList.jira.statusUpdateFailed"))`.
  2. `SubmittedBadge`의 Jira 렌더링 블록 수정.
     - `jiraStatus`가 로드됐고 에러가 아니면 `JiraStatusBadge` 렌더.
     - `onStatusChanged`에서 `setJiraStatus(newStatus)` 호출.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] Chrome에서 Jira 이슈의 상태 배지 클릭 → 팝오버에 트랜지션 목록 표시
  - [ ] 트랜지션 선택 → 배지가 새 상태로 업데이트
  - [ ] 실패 시 토스트 표시
  - [ ] Jira 웹에서 상태 변경 확인

### Task 6: LinearStatusBadge UI 컴포넌트

- **변경 대상**: `src/sidepanel/tabs/IssueListTab.tsx`
- **작업 내용**:
  1. `LinearStatusBadge` 컴포넌트 추가.
     - Props: `issueId: string` (UUID), `issueIdentifier: string`, `currentState: { name: string; type: string }`, `onStatusChanged: (s: LinearIssueStatus) => void`.
     - 팝오버 open 시 `sendBg("linear.getWorkflowStates", { issueId: issueIdentifier })` 호출.
     - 로딩 중: 팝오버 내 `Loader2` 스피너.
     - 각 상태 항목: 상태명 표시 + `LINEAR_STATE_TYPE_COLORS[type]` 색상.
     - 현재 상태 `currentState.name`과 일치하는 항목에 체크마크.
     - 선택 시: `sendBg("linear.updateIssueState", { issueId: UUID, stateId })`.
     - 성공 시: `onStatusChanged(LinearIssueStatus)` + `patchIssue()`.
     - 에러 시: `toast.error(t("issueList.linear.statusUpdateFailed"))`.
  2. `SubmittedBadge`의 Linear 렌더링 블록 수정.
     - `linearStatus`가 로드됐고 에러가 아니면 `LinearStatusBadge` 렌더.
     - `linearStatus.id` (UUID)를 `issueId`로, `linearStatus.identifier`를 `issueIdentifier`로 전달.
     - `onStatusChanged`에서 `setLinearStatus(newStatus)` 호출.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] Chrome에서 Linear 이슈의 상태 배지 클릭 → 워크플로 상태 목록 표시
  - [ ] 상태 선택 → 배지가 새 상태로 업데이트
  - [ ] Linear 웹에서 상태 변경 확인

### Task 7: NotionStatusBadge UI 컴포넌트

- **변경 대상**: `src/sidepanel/tabs/IssueListTab.tsx`
- **작업 내용**:
  1. `NotionStatusBadge` 컴포넌트 추가.
     - Props: `pageId: string`, `databaseId: string`, `currentOption: { name: string; color: string }`, `onStatusChanged: (s: NotionPageStatus) => void`.
     - 팝오버 open 시 `sendBg("notion.getDatabaseSchema", { databaseId })` 호출.
     - 응답의 `statusProperty?.options`를 팝오버 옵션으로 표시. `statusProperty?.name`을 propertyName으로 저장.
     - 로딩 중: 팝오버 내 `Loader2` 스피너.
     - 옵션 없으면: `t("issueList.notion.noStatusOptions")` 텍스트.
     - 각 옵션 항목: 옵션명 표시 + `notionStatusCategory(color)` → `STATUS_CATEGORY_COLORS` 색상.
     - 현재 옵션 `currentOption.name`과 일치하는 항목에 체크마크.
     - 선택 시: `sendBg("notion.updatePageStatus", { pageId, propertyName, optionName })`.
     - 성공 시: `onStatusChanged(NotionPageStatus)` + `patchIssue()`.
     - 에러 시: `toast.error(t("issueList.notion.statusUpdateFailed"))`.
  2. `SubmittedBadge` 변경:
     - props에 `notionDatabaseId?: string` 추가.
     - Notion 렌더링 블록에서 `notionStatus.statusOption` 있고 `notionDatabaseId` 있으면 `NotionStatusBadge` 렌더.
     - `onStatusChanged`에서 `setNotionStatus(newStatus)` 호출.
  3. `IssueRow` 변경:
     - `SubmittedBadge`에 `notionDatabaseId={issue.notionDatabaseId}` prop 전달.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] Chrome에서 Notion 이슈의 상태 배지 클릭 → 상태 옵션 목록 표시
  - [ ] 옵션 선택 → 배지가 새 상태로 업데이트
  - [ ] Notion 웹에서 상태 변경 확인

### Task 8: 회귀 테스트

- **변경 대상**: 없음 (테스트만)
- **작업 내용**:
  1. Chrome에서 기존 GitHub 이슈 상태 변경이 정상 동작하는지 확인.
  2. 각 플랫폼 인증 만료 시 팝오버 동작 확인 (에러 처리 경로).
  3. 이슈 목록 새로고침 후 변경된 상태가 유지되는지 확인.
  4. Jira 필수 필드 트랜지션 실패 시 분화된 토스트 메시지 확인.
  5. 네트워크 오프라인/timeout 시 에러 토스트 확인.
  6. 상태 변경 중(updating) 중복 클릭 시 추가 요청 발생하지 않는지 확인.
  7. Jira 트랜지션 후 다시 팝오버 열면 새 상태 기준 트랜지션 목록이 갱신되는지 확인.
- **검증**:
  - [ ] GitHub 상태 변경 정상 동작
  - [ ] 인증 만료 시 적절한 에러 처리
  - [ ] 새로고침 후 상태 유지
  - [ ] Jira 필수 필드 에러 분화 토스트
  - [ ] 네트워크 에러 시 토스트
  - [ ] 중복 클릭 방지 동작
  - [ ] Jira 트랜지션 후 팝오버 목록 갱신

## 테스트 계획

- **단위 테스트**: `parseTransitions` (Jira 응답 매핑), `sortWorkflowStates` (Linear 정렬) 순수 함수 테스트. 기존 `pnpm test` 통과 확인.
- **수동 테스트**: 각 Task의 검증 항목 참조. 특히:
  - Jira: 트랜지션 목록이 워크플로에 따라 달라지는지 (예: To Do → In Progress 전환 후 다시 열면 다른 트랜지션 목록)
  - Linear: 커스텀 워크플로 상태가 팝오버에 표시되는지
  - Notion: 상태 속성 없는 DB의 이슈에서 팝오버가 노출되지 않는지
  - GitHub: 기존 동작 회귀 없음

## 구현 순서 권장

```
Task 1 (Jira API) ─┐
Task 2 (Linear API) ├─ 병렬 가능
Task 3 (Notion API) ┘
        │
Task 4 (i18n) ← Task 1~3 완료 후 (키 확정)
        │
Task 5 (JiraStatusBadge) ─┐
Task 6 (LinearStatusBadge) ├─ 병렬 가능
Task 7 (NotionStatusBadge) ┘
        │
Task 8 (회귀 테스트) ← 전체 완료 후
```

Task 1~3은 서로 독립적이므로 병렬 작업 가능. Task 5~7도 서로 독립적이므로 병렬 가능. 단, Task 4 (i18n)는 UI 컴포넌트에서 사용하는 키를 정의하므로 Task 5~7보다 먼저 또는 동시에 진행.
