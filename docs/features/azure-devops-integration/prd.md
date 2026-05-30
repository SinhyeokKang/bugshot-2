# Azure DevOps Boards 연동 (이슈 플랫폼)

## 배경

bugshot-2는 현재 Jira·GitHub·Linear·Notion·GitLab을 지원한다. Azure DevOps Boards는 MS 생태계 엔터프라이즈 개발팀에서 표준으로 쓰이며, 이들은 GitHub/GitLab을 쓰지 않는 경우가 많아 **기존 5개가 닿지 못하는 신규 dev 사용자층**이다. 도달성 순증 효과가 가장 크다. work item description이 마크다운을 지원해 기존 `buildIssueMarkdown` 패턴을 거의 그대로 재사용한다.

## 목표

- 사용자가 Azure DevOps를 **PAT(Personal Access Token)**로 연결한다 (organization URL + PAT).
- 버그 스냅샷을 Azure **work item**(Bug/Issue/Task 등)으로 생성한다.
- work item 생성 시 organization·project·work item type·assignee를 선택한다.
- 생성된 work item의 `System.State`를 이슈 목록에서 조회·변경(close/reopen)한다.
- GitLab 통합과 동일한 파일 구조를 따른다.

## 비목표 (Non-goals)

- **OAuth(Entra ID) 인증** — confidential client라 프록시·AAD 앱 필요. MVP는 PAT only. 후속.
- **Azure DevOps Server(온프렘/self-hosted)** — 클라우드 `dev.azure.com`만. (GitLab self-managed 패턴 후속 적용 가능)
- area path / iteration path 지정 — project 기본값에 생성. 후속.
- custom field·process 별 필수 필드 자동 매핑.
- work item 간 link(parent/child).

## 사용자 시나리오

1. **연결**: Integrations 탭 → Azure DevOps → organization URL(`https://dev.azure.com/{org}`) + PAT 입력 → `_apis/connectionData`로 검증 후 기본 project·work item type 선택.
2. **이슈 등록**: 캡처 → 플랫폼 Azure 선택 → project·work item type·assignee 선택 → 제목·본문 → 등록. 미디어는 attachment 업로드 후 description에 마크다운 링크/인라인.
3. **상태 확인**: 이슈 목록 배지가 `System.State`(New/Active/Resolved/Closed)를 표시. 클릭으로 close/reopen.

### 엣지 케이스

- **마크다운 field format**: work item 대용량 텍스트 필드는 기본 HTML, 마크다운 렌더는 org 설정/필드 format에 의존. 구현 전 검증 필요(아래 위험 요소).
- **work item type 다양성**: process(Agile/Scrum/CMMI)별 type·필수 필드가 다름 → type 목록을 `_apis/wit/workitemtypes`로 동적 조회.
- **State 전이 제약**: 허용 상태가 process별로 다름 → 현재 상태 조회 후 best-effort 전이, 실패 시 토스트.
- **PAT 스코프 부족**: Work Items(Read & Write) 스코프 없으면 403 → 안내 메시지.
- **업로드 실패**: per-file 격리 (GitLab 패턴).

## 성공 기준

- org URL + PAT 연결 후 실제 work item 생성 + URL이 이슈 레코드에 저장.
- 첨부 미디어가 work item attachment로 업로드되고 description에서 참조.
- 상태 배지가 `System.State`를 정확히 반영, close/reopen 동작.
- `pnpm test` / `pnpm typecheck` 통과.
- 실제 Azure DevOps 조직에서 수동 E2E 1회 성공.
