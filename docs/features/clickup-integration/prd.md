# ClickUp 연동

## 배경

bugshot-2는 현재 6개 플랫폼(Jira·GitHub·Linear·Notion·GitLab·Asana)에 버그 이슈를 등록한다. ClickUp은 task 트래커로서 Asana와 구조가 거의 동일하고, REST API가 `markdown_content`를 1급으로 지원해 기존 어댑터 패턴에 깔끔하게 들어맞는다. ClickUp을 7번째 플랫폼으로 추가해 ClickUp을 쓰는 팀이 bugshot으로 바로 task를 만들 수 있게 한다.

## 목표

- ClickUp을 기존 6개 플랫폼과 동등한 "이슈 제출 대상"으로 추가한다 (Asana 동급 풀기능).
- 인증은 **OAuth + Personal API Token(PAT) 이중 지원** (GitLab/Asana 패턴).
- 이슈 작성 시 **Workspace → Space → List** 단계로 대상 List를 고른다 (task는 `list_id` 필수).
- **Assignee 지정 + CC 멘션**, **본문 inline 이미지 임베드**, **캡처/로그 첨부**를 지원한다.
- 제출 후 **이슈 목록(IssueListTab)·재제출(DraftDetailDialog)** 흐름에 ClickUp을 연결하고, task 완료 상태를 조회한다.

## 비목표 (Non-goals)

- **Slack 연동은 이번 스코프에서 제외.** Slack은 이슈 트래커가 아니라 채널 메시지/파일 포스트 플랫폼이라 기존 어댑터 패턴(이슈 생성·이슈 목록·재제출)과 본질이 어긋난다. mrkdwn/Block Kit 포맷 변환기, 2단계 외부 파일 업로드(`getUploadURLExternal`→PUT→`completeUploadExternal`), 채널 선택, permalink 별도 조회 등 신규 작업이 많아 별도 설계가 필요하다. → `design.md`의 "Slack 보류 노트" 참조.
- ClickUp custom field(우선순위·태그·due date 등) 매핑은 제외. 이번엔 name·markdown_content·assignees·list만.
- ClickUp Space/Folder **생성**은 제외. 기존 항목 선택만.
- Folder 레벨 직접 노출 제외. Space 하위 List는 folderless list까지 평탄화해 한 번에 보여준다.

## 사용자 시나리오

### S1. ClickUp 연결 (OAuth)
1. 사용자가 사이드패널 **연동(Integrations) 탭** → ClickUp 카드 → 연결.
2. 연결 방식 선택 다이얼로그에서 "OAuth로 연결".
3. `chrome.identity.launchWebAuthFlow`로 ClickUp authorize → 권한 승인 → proxy 경유 토큰 교환.
4. 연결 완료. viewer 이름 표시 + 기본 Workspace 선택 가능.

### S2. ClickUp 연결 (PAT)
1. 연동 탭 → ClickUp 카드 → 연결 → "API 토큰으로 연결".
2. ClickUp 설정에서 발급한 `pk_...` 토큰을 입력 → 검증(`getMyself`) → 연결 완료.

### S3. 이슈 제출
1. 캡처(요소/스크린샷/영상)로 draft 작성 후 제출 화면 진입.
2. 플랫폼 탭에서 ClickUp 선택.
3. 제출 필드 다이얼로그에서 **Workspace → Space → List** 콤보박스로 대상 선택. 선택적으로 **Assignee**, **CC** 멘션.
4. 제출 → ClickUp task 생성 → 캡처/로그/inline 이미지 업로드 → task가 열리는 URL 반환 + 성공 화면.

### S4. 이슈 목록·재제출
1. 이슈 목록 탭에서 과거 제출한 ClickUp task의 링크·완료 상태 확인.
2. draft 상세 다이얼로그에서 동일 draft를 다른 List로 재제출 가능.

### 엣지 케이스
- OAuth env 미설정(`VITE_CLICKUP_CLIENT_ID`/proxy 부재) → 연결 다이얼로그에서 OAuth 옵션 자동 숨김, PAT만 노출.
- List 미선택 상태로 제출 시도 → 제출 버튼 비활성 + 안내.
- inline 이미지가 ClickUp markdown에서 렌더 불가한 경우 → 첨부로 폴백(본문엔 누락, task는 생성됨).
- 토큰 무효(401) → 재연결 안내(ClickUp 토큰은 만료가 없어 자동 refresh 없음).

## 성공 기준

- 연동 탭에서 ClickUp을 OAuth/PAT 양쪽으로 연결·해제할 수 있다.
- ClickUp을 선택해 Workspace→Space→List를 고르고 task를 생성, 반환된 URL로 실제 task가 열린다.
- 캡처 이미지/영상/`logs.html`/사용자 첨부가 task attachment로 올라간다.
- 본문 섹션의 inline 이미지가 task 본문에 임베드된다(또는 폴백으로 첨부).
- Assignee·CC가 task/본문에 반영된다.
- 이슈 목록에서 ClickUp task 상태가 보이고, draft 재제출이 동작한다.
- 기존 6개 플랫폼 제출 플로우에 회귀가 없다 (e2e green).
