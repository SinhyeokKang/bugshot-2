# Asana 연동 (6번째 이슈 플랫폼)

## 배경

bugshot-2는 현재 Jira·GitHub·Linear·Notion·GitLab 5개 플랫폼에 버그/이슈를 등록한다. Asana는 PM·크로스펑셔널 팀에서 광범위하게 쓰이는 태스크 트래커로, task=issue 매핑이 자연스러워 기존 이슈 필드 UI·상태 배지 패러다임에 그대로 들어맞는다. dev 위주인 기존 라인업(GitHub/GitLab/Linear)을 PM 영역으로 확장한다.

## 목표

- 사용자가 Asana 계정을 PAT 또는 OAuth(PKCE)로 연결할 수 있다.
- 버그 스냅샷(스크린샷·영상·로그·DOM·스타일 diff)을 Asana **task**로 생성한다.
- task 생성 시 workspace·project·assignee를 선택할 수 있다.
- 생성된 task의 완료 상태(completed)를 사이드패널 이슈 목록에서 조회·토글한다.
- 기존 GitLab 통합과 동일한 파일 구조·메시지 패턴을 따른다 (학습 비용 0).

## 비목표 (Non-goals)

- Asana custom fields 매핑 (MVP는 name·notes·project·assignee만).
- Asana section 지정 (project 루트에 생성. 필요 시 후속).
- 서브태스크·종속성·마일스톤.
- Asana Portfolio/Goal 연동.
- 멀티 project 동시 등록 (단일 project).

## 사용자 시나리오

1. **연결**: Integrations 탭 → Asana → "OAuth로 연결"(PKCE, 버튼 한 번) 또는 "PAT로 연결"(토큰 붙여넣기) → 인증 검증 후 기본 workspace·project 선택.
2. **이슈 등록**: 디버그 화면에서 캡처 → 플랫폼 Asana 선택 → workspace·project·assignee 선택 → 제목·본문 작성 → 등록. 스크린샷/영상/로그는 **첨부파일**로 task에 붙는다.
3. **상태 확인**: 이슈 목록에서 해당 항목의 상태 배지가 incomplete/complete를 표시. 배지 클릭으로 토글.

### 엣지 케이스

- **본문 변환**: Asana `notes`는 plain text, `html_notes`는 제한된 HTML 서브셋(`<img>`·테이블 미지원). 스타일 diff 테이블은 `<pre>` 코드블록으로 폴백, 미디어는 인라인 임베드 대신 첨부로만 처리.
- **OAuth 미설정**: `VITE_ASANA_CLIENT_ID` 없으면 OAuth 버튼 비활성화, PAT만 노출 (GitLab `isGitlabOAuthConfigured` 패턴).
- **토큰 만료**: OAuth access token 만료 시 refresh token으로 갱신 (GitLab refresh-hook 패턴).
- **업로드 실패**: 개별 첨부 실패는 격리 — task는 생성하고 실패 첨부만 본문에 누락 표기 (GitLab `gitlab.uploadFiles` per-file 격리 패턴).

## 성공 기준

- PAT/OAuth 연결 후 실제 Asana task가 생성되고 permalink가 이슈 레코드에 저장된다.
- 첨부 미디어가 task attachment로 올라간다.
- 상태 배지가 completed 상태를 정확히 반영하고 토글이 동작한다.
- `pnpm test` 통과 (신규 순수 함수 단위 테스트 포함).
- `pnpm typecheck` 통과.
- 실제 Asana 워크스페이스에서 수동 E2E 1회 성공.
