# Issue Dialog Decompose

## 배경

`src/sidepanel/tabs/` 아래 이슈 작성·상세 다이얼로그 3개가 비대해졌다.

- `IssueCreateModal.tsx` (1349줄)
- `IssueListTab.tsx` (1305줄)
- `DraftDetailDialog.tsx` (987줄)

`/audit` 결과 다음 네 가지가 🔴 시급으로 분류됐다:

1. **IssueListTab inline 컴포넌트 묶음** — 4종 플랫폼 status badge(Github/Jira/Linear/Notion), 색 매핑 상수, SubmittedBadge wrapper, IssueRow, 날짜 헬퍼, GitHub 좌표 파서가 한 파일에 누적. 새 플랫폼 배지 추가나 색 룰 수정 시 파일 전체 스크롤 필요.
2. **IssueCreateModal Jira 필드 inline 비대칭** — GitHub/Linear/Notion은 이미 `githubFields/`·`linearFields/`·`notionFields/` 디렉터리 패턴이고, Jira만 `JiraFieldsBlock` + `IssueTypeField`·`AssigneeField`·`PriorityField`·`EpicField`·`FieldCombobox`가 IssueCreateModal 안에 inline. ARCHITECTURE.md "플랫폼 어댑터 4종 대칭" 원칙이 한 곳에서 깨져 있다.
3. **SubmitFieldsDialog 위치 혼동** — `SubmitFieldsDialog`가 `IssueCreateModal.tsx`에 정의되고, `DraftDetailDialog.tsx`는 거기서 import한다 (`import { SubmitFieldsDialog } from "./IssueCreateModal"`). 공유 컴포넌트가 한쪽 호스트의 내부 파일에 묻혀 있어 의존 방향이 부자연스럽다. `FieldRow`도 동일 — IssueCreateModal에서 export돼 GithubIssueFields가 import.
4. **플랫폼 필드 상태 초기화 useEffect 5개 중복** — IssueCreateModal과 DraftDetailDialog가 `setGhFieldsState(initialGhFields(lastGhSubmit, ghAccount?.defaults))` 같은 패턴을 각각 보유. 한쪽 초기화 룰을 바꾸면 다른 쪽도 손대야 하는 회귀 위험.

## 목표

- IssueListTab의 inline 컴포넌트·상수·유틸을 같은 디렉터리 하위 서브파일로 분리해 본체를 600줄 이내로 축소.
- IssueCreateModal에서 Jira 필드 코드 일체를 `tabs/jiraFields/` 디렉터리로 추출, GitHub/Linear/Notion과 동일한 4종 대칭 회복.
- `SubmitFieldsDialog`와 `FieldRow`를 IssueCreateModal에서 분리해 양쪽 호스트가 동등한 위치에서 import하도록 정리.
- 플랫폼 필드 상태 초기화 로직을 단일 hook (`usePlatformFields`)으로 합치고, IssueCreateModal·DraftDetailDialog가 그 hook을 사용하도록 교체.
- 분리 전후로 **사용자 시야의 동작 변화 0**. import 경로 변경, 컴포넌트 모듈 위치 변경만.

## 비목표 (Non-goals)

- **새 기능·UX 변경 없음**. 다이얼로그 레이아웃, 필드 종류, 제출 흐름, 검증 룰 모두 그대로.
- **추상화 도입 없음**. 4 플랫폼을 generic dict로 통합하거나, fields 컴포넌트에 공통 베이스 클래스 도입 같은 것은 하지 않는다 (`unnecessary abstraction 금지`).
- **submit 핸들러(`handleJiraSubmit`/`handleGithubSubmit`/`handleLinearSubmit`/`handleNotionSubmit`) 분해 없음**. IssueCreateModal에 inline 유지 — editor-store와 강결합이라 분리 시 props tunnel만 증가하고, /audit에서 "안 권함"으로 명시됨.
- **타입 변경 없음**. `GithubIssueFieldsValue`·`LinearIssueFieldsValue`·`NotionIssueFieldsValue`·`EditorIssueFields`(Jira) 시그니처 그대로 유지.
- **i18n 키 추가·변경 없음**. 분리 작업 중 새 키가 필요해 보이면 별건으로 처리.
- **테스트 추가는 신규 순수 함수 한정**. 기존 컴포넌트의 렌더 테스트를 새로 만들지 않는다 (CLAUDE.md "테스트 우선" 원칙은 신규 인터페이스에만 적용 — 이번 작업은 이동만).

## 사용자 시나리오

작업 후에도 외부 동작은 동일하다:

1. **이슈 목록 진입** — IssueListTab을 열어 카드 리스트를 본다. 제출 완료 이슈는 플랫폼 칩 + 상태 배지가 보이고, 드래프트는 휴지통 버튼이 보인다. 변경 없음.
2. **상태 변경 popover** — 제출 이슈의 status badge를 클릭해 popover에서 다른 상태로 전환. 4 플랫폼 모두 기존 흐름 유지.
3. **새 이슈 작성** — IssueCreateModal 열면 4 플랫폼 중 연결된 것만 Tab으로 표시, 각 Tab에서 필드 입력 후 제출. Jira Tab의 IssueType·Assignee·Priority·Epic·Linked Issue 콤보박스는 분리 전과 동일하게 동작.
4. **드래프트 상세 → 제출** — IssueListTab에서 드래프트 카드 클릭 → DraftDetailDialog 진입 → "제출" 버튼 누르면 SubmitFieldsDialog 열림. 분리 전과 동일.
5. **플랫폼 Tab 전환** — DraftDetailDialog에서 SubmitFieldsDialog의 Tab을 바꿔도 다이얼로그가 강제로 닫히지 않는다 (현재 코드의 `// 의도적으로 deps에서 제외` 주석이 보호하는 동작 — 분리 후에도 유지).

## 성공 기준

- `pnpm test` 통과 (기존 테스트 그대로 + 새 순수 함수 테스트 추가 시 함께 통과).
- `pnpm typecheck` 통과.
- IssueListTab.tsx 600줄 이내, IssueCreateModal.tsx 500줄 이내, DraftDetailDialog.tsx 900줄 이내로 축소.
- `tabs/jiraFields/` 디렉터리 신설, 다른 3종(`githubFields/`·`linearFields/`·`notionFields/`)과 동일 구조 (XxxIssueFields.tsx + 콤보박스 sub-컴포넌트 + 초기값 헬퍼).
- `SubmitFieldsDialog`·`FieldRow`가 IssueCreateModal 외부 위치에서 export되고, IssueCreateModal·DraftDetailDialog·GithubIssueFields가 모두 동등하게 import.
- IssueCreateModal·DraftDetailDialog의 플랫폼 필드 state·setter가 `usePlatformFields` 단일 hook 호출로 일원화.
- 수동 회귀: 4 플랫폼 각각 (a) 이슈 생성, (b) 드래프트 → SubmitFieldsDialog 통한 제출, (c) IssueListTab status badge popover로 상태 변경, (d) Tab 전환 시 다이얼로그 닫히지 않음 확인.
