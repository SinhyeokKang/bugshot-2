# Asana 연동 — 구현 태스크

## 선행 조건

- Asana 개발자 앱 등록 → OAuth client ID 발급 → `.env.local`에 `VITE_ASANA_CLIENT_ID` 설정. redirect URI는 `chrome.identity.getRedirectURL()` 값(`https://<ext-id>.chromiumapp.org/`) 등록.
- 테스트용 Asana workspace + PAT 1개 (Settings → Apps → Personal access token).
- **외부 API 사실 검증**(코딩 전): ① html_notes 허용 태그 목록, ② `/attachments` multipart 필드명(`parent`, `file`), ③ typeahead 엔드포인트 응답 형태, ④ task `permalink_url` 필드 존재. 실제 호출 1회로 확인.
- `SETTINGS_STORE_VERSION` 현재값 확인 (bump 대상).

## 태스크

### Task 1: 타입 정의
- **변경 대상**: `src/types/asana.ts` (신규), `src/types/platform.ts`
- **작업 내용**: design.md 인터페이스 전체 작성. `platform.ts`에 `"asana"` 유니언 추가, `PLATFORM_TAB_KEYS.asana`, `Accounts.asana?`, `AsanaLastSubmitFields`, `LastSubmitFieldsByPlatform.asana?`.
- **검증**:
  - [ ] `pnpm typecheck` — PlatformId 확장으로 발생하는 exhaustive switch 에러 목록이 곧 후속 태스크 체크리스트.

### Task 2: 마크다운 → html_notes 변환기 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/markdownToAsanaHtml.ts` (신규), `__tests__/markdownToAsanaHtml.test.ts`
- **작업 내용**: `/tdd` interface 모드로 테스트 먼저. 헤딩·리스트·링크·코드·blockquote 변환 + 테이블→`<pre>` 폴백 + 이미지→캡션 케이스.
- **검증**:
  - [ ] 모든 출력이 `<body>`로 래핑되고 허용 태그만 포함.
  - [ ] 테이블 입력이 `<pre>`로 변환.
  - [ ] `pnpm test markdownToAsanaHtml` 통과.

### Task 3: API 어댑터 (테스트 우선)
- **변경 대상**: `src/background/asana-api.ts` (신규), `__tests__/asana-api.test.ts`
- **작업 내용**: 순수 함수(`buildAuthHeader`, `mapCreateTaskBody`, `messageForAsanaStatus`, 정규화 함수)는 테스트 먼저. fetch 래퍼는 `.data` 언랩 + 401 refresh-hook 재시도.
- **검증**:
  - [ ] PAT/OAuth 헤더 포맷, `mapCreateTaskBody`의 `{ data: {...} }` 래핑, status 메시지 매핑 테스트 통과.
  - [ ] `pnpm test asana-api` 통과.

### Task 4: OAuth (PKCE)
- **변경 대상**: `src/background/asana-oauth.ts` (신규), `__tests__/asana-oauth.test.ts`
- **작업 내용**: GitLab `gitlab-oauth.ts` 미러. `parseAsanaCallbackParams`는 테스트로 고정(state mismatch, code missing, access_denied 취소).
- **검증**:
  - [ ] `parseAsanaCallbackParams` 테스트 통과.
  - [ ] `isAsanaOAuthConfigured()`가 env 유무에 정확히 반응.

### Task 5: 스토리지 + 스토어
- **변경 대상**: `src/lib/settings-storage.ts`, `src/store/settings-store.ts`
- **작업 내용**: `readStoredAsanaAuth`/`writeStoredAsanaOAuthTokens`, `updateAsanaAccount`, `SETTINGS_STORE_VERSION` +1.
- **검증**:
  - [ ] 기존 `settings-store.test.ts`에 asana 계정 저장/마이그레이션 케이스 추가, 통과.

### Task 6: 메시지 핸들러
- **변경 대상**: `src/background/messages.ts`, `src/types/messages.ts`
- **작업 내용**: `asana.*` 유니언 + 케이스 11종(oauth.available/startOAuth/testPat/disconnect/getMyself/getWorkspaces/searchProjects/searchAssignees/uploadFiles/submitIssue/getTaskStatus/setCompleted) + `loadAsanaAuth()`. 모듈 로드 시 `setAsanaRefreshHook` 등록.
- **검증**:
  - [ ] `pnpm typecheck` — 메시지 유니언 exhaustive 충족.

### Task 7: 본문 빌더 + 제출 오케스트레이션 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/buildAsanaIssueBody.ts`, `submitToAsana.ts` (신규), `__tests__/buildAsanaIssueBody.test.ts`
- **작업 내용**: `buildAsanaIssueBody`(순수, 테스트 먼저)는 ctx → markdown → `markdownToAsanaHtml`. `submitToAsana`는 **createTask 먼저 → attachment 루프**(생성 후 첨부) → `NormalizedSubmitResult`.
- **검증**:
  - [ ] `buildAsanaIssueBody` 출력에 헤딩·섹션·첨부 누락 표기 포함.
  - [ ] `pnpm test buildAsanaIssueBody` 통과.

### Task 8: 연결 UI
- **변경 대상**: `src/sidepanel/tabs/connect/AsanaConnectForm.tsx` (신규), `IntegrationsTab.tsx`
- **작업 내용**: `SiAsana` 아이콘 import + PLATFORMS 엔트리. PatDialog(토큰 입력) + OAuth 버튼(`isAsanaOAuthConfigured` 가드) + 기본 workspace/project 선택 + Summary.
- **검증**:
  - [ ] Chrome에서 PAT 연결 성공, OAuth 버튼 동작(env 설정 시).

### Task 9: 이슈 필드 UI
- **변경 대상**: `src/sidepanel/tabs/asanaFields/{AsanaIssueFields,WorkspaceCombobox,ProjectCombobox,AssigneeCombobox}.tsx`, `usePlatformFields.ts`, `IssueCreateModal.tsx`
- **작업 내용**: workspace→project→assignee 2.5단 콤보박스(workspace 미선택 시 project 비활성). IssueCreateModal에 asana 제출 분기 + lastSubmitFields 저장.
- **검증**:
  - [ ] workspace 선택 시 project 목록 로드, project 선택 후 등록 가능.

### Task 10: 상태 배지
- **변경 대상**: `src/sidepanel/tabs/statusBadges/{AsanaStatusBadge,AsanaSubmittedBadge}.tsx`, `issueListUtils.ts`, `issues-store.ts`
- **작업 내용**: completed/incomplete 토글 배지. `resolveAsanaCoords`(taskGid 존재 검사) + 이슈 레코드 필드.
- **검증**:
  - [ ] 등록 후 목록에서 상태 표시, 클릭 토글이 Asana에 반영.

### Task 11: i18n + manifest + 문서
- **변경 대상**: `src/i18n/integrations.ts`, `src/i18n/issue.ts`, `manifest.config.ts`, `.env.example`, CLAUDE.md/DIRECTORY.md/ARCHITECTURE.md/README.md/PERMISSION.md/docs/privacy.md
- **작업 내용**: `asana.*` + `platform.tab.asana` + `issueList.asana.*` 키(ko/en). `host_permissions`에 `app.asana.com`. 문서 신선도: 6번째 플랫폼·새 host_permission·새 외부 API → privacy.md(시행일 포함)·PERMISSION.md·README·CLAUDE.md 갱신.
- **검증**:
  - [ ] i18n PostToolUse 훅 통과(ko/en 대칭).
  - [ ] `pnpm typecheck` + `pnpm test` 전체 통과.

## 테스트 계획

- **단위 테스트**: `markdownToAsanaHtml`(변환·폴백), `asana-api`(헤더·페이로드·정규화·status), `asana-oauth`(콜백 파싱), `buildAsanaIssueBody`(본문 구성), `settings-store`(계정 저장·마이그레이션).
- **수동 테스트(Chrome)**:
  - [ ] PAT 연결 → workspace/project 선택 → task 생성 → permalink 확인.
  - [ ] OAuth(PKCE) 연결 → 토큰 만료 후 자동 refresh.
  - [ ] 스크린샷+영상+로그 첨부가 task attachment로 업로드.
  - [ ] 스타일 diff 테이블이 `<pre>`로 렌더되는지 Asana UI에서 확인.
  - [ ] 상태 배지 completed 토글.
  - [ ] 개별 첨부 실패 시 task는 생성되고 누락 표기.

## 구현 순서 권장

Task 1 → 2·3·4(병렬 가능, 순수 함수 우선) → 5·6 → 7 → 8·9·10(UI, 병렬 가능) → 11. 1이 모든 후속의 타입 기반이라 선행 필수. 2(변환기)는 7(본문)의 선행.
