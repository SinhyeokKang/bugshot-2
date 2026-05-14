# Multi-platform Issue Status Change — 기술 설계

## 개요

이슈 목록의 상태 배지를 인터랙티브 팝오버로 확장한다. GitHub은 3개 고정 옵션이었지만, Jira/Linear/Notion은 각각의 상태 체계에서 **동적 옵션을 lazy fetch** 한 뒤 표시한다. 배지 컴포넌트 패턴(`GithubStatusBadge`)을 그대로 재사용하되, 팝오버를 열 때 옵션을 로딩하는 공통 UX를 추가한다.

## 변경 범위

### 1. `src/types/jira.ts`

현재: 이슈 생성/조회 관련 타입만.
변경: `JiraTransition` 타입 추가.

```typescript
export interface JiraTransition {
  id: string;
  name: string;
  to: {
    name: string;
    categoryKey: string; // "new" | "indeterminate" | "done"
  };
}
```

### 2. `src/types/linear.ts`

현재: `LinearIssueStatus`에 `id` (UUID) 없음.
변경:
- `LinearIssueStatus`에 `id: string` 필드 추가 (issueUpdate mutation에 UUID 필요).
- `LinearWorkflowState` 타입 추가.

```typescript
export interface LinearIssueStatus {
  id: string;          // 추가: 이슈 UUID
  identifier: string;
  title: string;
  state: { name: string; type: string };
  url: string;
  labels: { name: string; color: string }[];
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;  // "backlog" | "unstarted" | "started" | "completed" | "cancelled"
  color: string;
}
```

### 3. `src/types/messages.ts`

현재: `BgRequest` 유니온에 `github.updateIssueState`만 존재.
변경: 5개 메시지 타입 추가.

```typescript
// Jira
| { type: "jira.getTransitions"; issueKey: string }
| { type: "jira.transitionIssue"; issueKey: string; transitionId: string }

// Linear
| { type: "linear.getWorkflowStates"; issueId: string }
| { type: "linear.updateIssueState"; issueId: string; stateId: string }

// Notion
| { type: "notion.updatePageStatus"; pageId: string; propertyName: string; optionName: string }
```

import 추가: `JiraTransition`, `LinearWorkflowState`.

### 4. `src/background/jira-api.ts`

현재: `getIssueStatus()`, `updateIssueDescription()` 등.
변경: 2개 함수 추가.

```typescript
export async function getTransitions(
  auth: JiraAuth,
  issueKey: string,
): Promise<JiraTransition[]> {
  // GET /rest/api/3/issue/{issueKey}/transitions
  // 응답에서 transitions[].{id, name, to.name, to.statusCategory.key}를 추출
}

export async function transitionIssue(
  auth: JiraAuth,
  issueKey: string,
  transitionId: string,
): Promise<void> {
  // POST /rest/api/3/issue/{issueKey}/transitions
  // body: { transition: { id: transitionId } }
  // 204 No Content 반환, void
}
```

기존 `jiraFetch<T>()` 헬퍼 사용.

### 5. `src/background/linear-api.ts`

현재: `getIssueStatus()`, `createIssue()` 등.
변경:
- `getIssueStatus()` 쿼리에 `id` 필드 추가 (기존 identifier, title, state, url, labels에 더해).
- 2개 함수 추가.

```typescript
// getIssueStatus 수정: 반환에 id (UUID) 포함
// 쿼리: issue(id: $issueId) { id identifier title ... }

export async function getWorkflowStates(
  auth: LinearAuth,
  issueId: string,
): Promise<LinearWorkflowState[]> {
  // query: issue(id: $issueId) { team { states { nodes { id name type color } } } }
  // issueId로부터 team의 workflow states를 한번에 조회
  // type 순서: triage → backlog → unstarted → started → completed → cancelled 순 정렬
}

export async function updateIssueState(
  auth: LinearAuth,
  issueId: string,  // UUID
  stateId: string,
): Promise<LinearIssueStatus> {
  // mutation: issueUpdate(id: $id, input: { stateId: $stateId }) {
  //   success issue { id identifier title state { name type } url labels { nodes { name color } } }
  // }
  // 업데이트된 이슈 상태 반환
}
```

기존 `linearGraphQL<T>()` 헬퍼 사용.

### 6. `src/background/notion-api.ts`

현재: `getPageStatus()`, `createPage()` 등.
변경: 1개 함수 추가.

```typescript
export async function updatePageStatus(
  auth: NotionAuth,
  pageId: string,
  propertyName: string,
  optionName: string,
): Promise<NotionPageStatus> {
  // PATCH /pages/{pageId}
  // body: { properties: { [propertyName]: { status: { name: optionName } } } }
  // 응답을 parsePageStatus()로 변환하여 반환
}
```

기존 `notionFetch<T>()` 헬퍼 + `parsePageStatus()` 재사용.

### 7. `src/background/messages.ts`

현재: 각 플랫폼별 case 블록.
변경: 5개 case 추가.

```typescript
// jira.getIssueStatus case 뒤에:
case "jira.getTransitions":
  return getJiraTransitions(await loadAuth(), message.issueKey);

case "jira.transitionIssue":
  await jiraTransitionIssue(await loadAuth(), message.issueKey, message.transitionId);
  return getJiraIssueStatus(await loadAuth(), message.issueKey);
  // 트랜지션 후 최신 상태를 다시 조회하여 반환 → UI가 새 상태명/카테고리를 받음

// linear.getIssueStatus case 뒤에:
case "linear.getWorkflowStates":
  return getLinearWorkflowStates(await loadLinearAuth(), message.issueId);

case "linear.updateIssueState":
  return updateLinearIssueState(await loadLinearAuth(), message.issueId, message.stateId);

// notion.getPageStatus case 뒤에:
case "notion.updatePageStatus":
  return updateNotionPageStatus(await loadNotionAuth(), message.pageId, message.propertyName, message.optionName);
```

import 추가: `getTransitions`, `transitionIssue`, `getWorkflowStates`, `updateIssueState`, `updatePageStatus`.

### 8. `src/sidepanel/tabs/IssueListTab.tsx`

현재: `GithubStatusBadge` 인터랙티브 + Jira/Linear/Notion은 정적 배지.
변경: 3개 인터랙티브 배지 컴포넌트 추가 + `SubmittedBadge`에서 사용.

#### 8-a. `JiraStatusBadge` 컴포넌트

```
Props: { issueKey, issueId, currentStatus: JiraIssueStatus, onStatusChanged: (s: JiraIssueStatus) => void }

상태: open, transitions (JiraTransition[] | null), loading, updating
동작:
  - 팝오버 open → sendBg("jira.getTransitions", { issueKey }) → transitions 세팅
  - 트랜지션 선택 → setUpdating(true) → sendBg("jira.transitionIssue", { issueKey, transitionId })
  - 성공 → 응답(JiraIssueStatus)을 onStatusChanged에 전달 + patchIssue
  - 실패 → toast.error(t("issueList.jira.statusUpdateFailed"))
```

팝오버 내 레이아웃: GitHub과 동일한 체크마크 + 배지 목록. 현재 상태의 `name`과 일치하는 트랜지션의 `to.name`에 체크. 각 항목은 `to.categoryKey` 기반 색상.

#### 8-b. `LinearStatusBadge` 컴포넌트

```
Props: { issueId (UUID), linearIdentifier, currentState: { name, type }, onStatusChanged: (s: LinearIssueStatus) => void }

상태: open, states (LinearWorkflowState[] | null), loading, updating
동작:
  - 팝오버 open → sendBg("linear.getWorkflowStates", { issueId: linearIdentifier ?? issueKey })
  - 상태 선택 → setUpdating(true) → sendBg("linear.updateIssueState", { issueId (UUID), stateId })
  - 성공 → onStatusChanged(LinearIssueStatus) + patchIssue
  - 실패 → toast.error(t("issueList.linear.statusUpdateFailed"))
```

팝오버 내 레이아웃: 각 항목은 상태명 + `LINEAR_STATE_TYPE_COLORS[type]` 색상. 현재 상태 `name`과 일치하는 항목에 체크.

#### 8-c. `NotionStatusBadge` 컴포넌트

```
Props: { pageId, databaseId, currentOption: { name, color }, onStatusChanged: (s: NotionPageStatus) => void }

상태: open, options (NotionSelectOption[] | null), statusPropertyName (string | null), loading, updating
동작:
  - 팝오버 open → sendBg("notion.getDatabaseSchema", { databaseId })
    → statusProperty.options를 세팅 + statusProperty.name을 statusPropertyName에 저장
  - 옵션 선택 → setUpdating(true) → sendBg("notion.updatePageStatus", { pageId, propertyName: statusPropertyName, optionName })
  - 성공 → onStatusChanged(NotionPageStatus) + patchIssue
  - 실패 → toast.error(t("issueList.notion.statusUpdateFailed"))
```

팝오버 내 레이아웃: 각 항목은 옵션명 + `notionStatusCategory(color)` 색상. 현재 옵션 `name`과 일치하는 항목에 체크.

#### 8-d. `SubmittedBadge` 변경

- props에 `notionDatabaseId?: string` 추가.
- Jira 렌더링 블록: `JiraStatusBadge` 사용 (`jiraStatus`가 로드됐고 인증 있으면).
- Linear 렌더링 블록: `LinearStatusBadge` 사용 (`linearStatus`가 로드됐고 인증 있으면).
- Notion 렌더링 블록: `NotionStatusBadge` 사용 (`notionStatus`가 로드됐고 `databaseId` 있으면).

#### 8-e. `IssueRow` 변경

- `SubmittedBadge`에 `notionDatabaseId={issue.notionDatabaseId}` prop 전달 추가.

### 9. `src/i18n/ko.ts`, `src/i18n/en.ts`

추가 키:

```typescript
// ko.ts
"issueList.jira.statusUpdateFailed": "상태 변경에 실패했습니다. Jira에서 직접 변경해 주세요.",
"issueList.jira.noTransitions": "사용 가능한 전환이 없습니다",
"issueList.linear.statusUpdateFailed": "상태 변경에 실패했습니다",
"issueList.notion.statusUpdateFailed": "상태 변경에 실패했습니다",
"issueList.notion.noStatusOptions": "상태 옵션이 없습니다",
"issueList.statusLoading": "불러오는 중…",

// en.ts
"issueList.jira.statusUpdateFailed": "Failed to update status. Please change it directly in Jira.",
"issueList.jira.noTransitions": "No transitions available",
"issueList.linear.statusUpdateFailed": "Failed to update status",
"issueList.notion.statusUpdateFailed": "Failed to update status",
"issueList.notion.noStatusOptions": "No status options",
"issueList.statusLoading": "Loading…",
```

## 데이터 흐름

### Jira

```
[JiraStatusBadge]
  ├─ 팝오버 open
  │   └─ sendBg("jira.getTransitions", { issueKey })
  │       └─ jira-api.ts:getTransitions() → GET /issue/{key}/transitions
  │           └─ JiraTransition[] → 팝오버 렌더
  └─ 트랜지션 선택
      └─ sendBg("jira.transitionIssue", { issueKey, transitionId })
          └─ messages.ts:
              ├─ jira-api.ts:transitionIssue() → POST /issue/{key}/transitions
              └─ jira-api.ts:getIssueStatus() → GET /issue/{key}?fields=status,...
                  └─ JiraIssueStatus → onStatusChanged → badge 업데이트 + patchIssue
```

### Linear

```
[LinearStatusBadge]
  ├─ 팝오버 open
  │   └─ sendBg("linear.getWorkflowStates", { issueId: identifier })
  │       └─ linear-api.ts:getWorkflowStates()
  │           → query issue(id) { team { states { nodes { id name type color } } } }
  │           └─ LinearWorkflowState[] → 팝오버 렌더
  └─ 상태 선택
      └─ sendBg("linear.updateIssueState", { issueId: UUID, stateId })
          └─ linear-api.ts:updateIssueState()
              → mutation issueUpdate(id, input: { stateId })
              └─ LinearIssueStatus → onStatusChanged → badge 업데이트 + patchIssue
```

### Notion

```
[NotionStatusBadge]
  ├─ 팝오버 open
  │   └─ sendBg("notion.getDatabaseSchema", { databaseId })
  │       → 기존 API 재사용
  │       └─ NotionDatabaseSchema.statusProperty.options → 팝오버 렌더
  └─ 옵션 선택
      └─ sendBg("notion.updatePageStatus", { pageId, propertyName, optionName })
          └─ notion-api.ts:updatePageStatus()
              → PATCH /pages/{pageId}
              └─ NotionPageStatus → onStatusChanged → badge 업데이트 + patchIssue
```

## 인터페이스 설계

위 "변경 범위" 섹션의 TypeScript 시그니처 참조. 핵심 요약:

| 레이어 | Jira | Linear | Notion |
|---|---|---|---|
| API 함수 (새) | `getTransitions()`, `transitionIssue()` | `getWorkflowStates()`, `updateIssueState()` | `updatePageStatus()` |
| API 함수 (수정) | - | `getIssueStatus()` 응답에 `id` 추가 | - |
| 메시지 (새) | `jira.getTransitions`, `jira.transitionIssue` | `linear.getWorkflowStates`, `linear.updateIssueState` | `notion.updatePageStatus` |
| 타입 (새) | `JiraTransition` | `LinearWorkflowState` | - |
| 타입 (수정) | - | `LinearIssueStatus`에 `id` 추가 | - |
| UI 컴포넌트 (새) | `JiraStatusBadge` | `LinearStatusBadge` | `NotionStatusBadge` |

## 기존 패턴 준수

- **메시지 비동기 응답 패턴**: 기존 `handleMessage()` switch-case에 case 추가. `loadAuth()` / `loadLinearAuth()` / `loadNotionAuth()`로 인증 로딩.
- **에러 처리**: `BgError`가 자동 전파, UI에서 `.catch(() => toast.error())`.
- **OAuth 만료**: 401 시 `ensureFreshAuth`가 refresh 시도 → 실패 시 `oauthRefreshFailed` body flag → `sendBg`에서 `onOAuthExpired.fire()` → 기존 재연결 안내 플로우.
- **i18n 동시 갱신**: ko.ts, en.ts 양쪽 동시 추가.
- **Popover 패턴**: Radix `Popover` + `PopoverTrigger asChild` + `PopoverContent`. `onClick={(e) => e.stopPropagation()}` (카드 클릭 전파 방지). `GithubStatusBadge`의 팝오버 마크업을 그대로 따름.
- **배지 색상**: `STATUS_CATEGORY_COLORS` 맵 + `LINEAR_STATE_TYPE_COLORS` / `notionStatusCategory()` 재사용.

## 대안 검토

### 옵션 Eager Loading (기각)

상태 배지 마운트 시 옵션도 함께 로딩하는 방안. 기각 이유:
- 대부분의 사용자는 상태를 조회만 하고 변경하지 않음 → 불필요한 API 호출 증가.
- Jira 트랜지션은 현재 상태 기준이라 상태가 바뀌면 다시 조회 필요 → eager cache가 stale해짐.
- GitHub은 3개 고정이라 문제없었지만, 동적 옵션은 lazy가 적합.

### Jira 트랜지션 사전 필터링 (기각)

`expand=transitions.fields` 파라미터로 필수 필드 정보를 조회해, 필수 필드 있는 트랜지션을 팝오버에서 미리 제외하는 방안. 기각 이유:
- API 응답 크기 증가 + 파싱 복잡도.
- 대부분의 트랜지션은 필수 필드 없이 실행 가능.
- 실패 시 토스트 안내가 더 단순하고 충분한 UX.

## 위험 요소

- **Jira 트랜지션 필수 필드**: 워크플로에 따라 해결 유형 등 필수 필드가 있는 트랜지션은 400 에러 발생. 토스트로 "Jira에서 직접 변경" 안내.
- **Linear UUID**: `issueUpdate` mutation은 UUID 필요. `getIssueStatus` 응답에 `id` 추가로 해결. `SubmittedBadge`의 `linearStatus` 상태에서 `id`를 추출해 `LinearStatusBadge`에 전달.
- **Notion databaseId 누락**: 초기 버전에서 제출한 이슈는 `notionDatabaseId`가 없을 수 있음. 이 경우 팝오버 미지원 (정적 배지 유지).
- **API rate limit**: 팝오버 반복 열기 시 API 호출 빈도. 현재 스코프에서는 캐시 없이 매번 조회하되, 성능 문제 발생 시 단순 메모리 캐시 추가 가능.
