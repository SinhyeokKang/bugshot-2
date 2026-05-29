# GitLab 연동 — 구현 태스크

## 선행 조건

- **OAuth (gitlab.com)**: gitlab.com에 OAuth Application 등록 → `VITE_GITLAB_CLIENT_ID`(dev) / `VITE_GITLAB_CLIENT_ID_PROD`(store) 발급. scope = `api`, redirect URI = `chrome.identity.getRedirectURL()` 값(`https://<ext-id>.chromiumapp.org/`). 누락 시 OAuth 비활성(PAT만 노출)이므로 PAT 경로는 env 없이도 개발 가능.
- **런타임 권한 헬퍼 확인**: BYOK LLM이 `chrome.permissions.request()`로 origin을 획득하는 기존 헬퍼 위치를 먼저 파악(`src/lib/` 또는 백그라운드). self-managed PAT 연결에서 재사용한다.
- **테스트 픽스처**: GitLab REST 응답 샘플(`/user`, `/projects`, `/projects/:id/issues`, `/uploads`)을 테스트에 인라인.

## 태스크

> 권장: 인터페이스(타입·순수 함수)를 먼저 `/tdd interface`로 테스트 박고 구현. 영역별로 GitHub 슬라이스를 레퍼런스로 미러.

### Task 0: 런타임 권한 헬퍼 파악 (조사)
- **변경 대상**: 없음(읽기). `grep -r "permissions.request" src/`
- **작업 내용**: BYOK가 임의 origin 권한을 얻는 헬퍼·패턴 확인. self-managed PAT 연결에서 호출할 시그니처 메모.
- **검증**:
  - [ ] 재사용할 함수/패턴 1개 특정. 없으면 신규 헬퍼 위치 결정.

### Task 1: 타입 정의
- **변경 대상**: `src/types/gitlab.ts`(신규), `src/types/platform.ts`
- **작업 내용**: design의 타입 전체. `PlatformId`에 `"gitlab"`, `PLATFORM_TAB_KEYS`·`Accounts`·`LastSubmitFieldsByPlatform`에 gitlab. `GitlabLastSubmitFields { projectId?, projectPath?, label?, assignee? }`.
- **검증**:
  - [ ] `pnpm typecheck` — `Accounts`/`LastSubmitFieldsByPlatform`가 `Record<PlatformId,...>` 제약을 만족
  - [ ] `src/types/__tests__/platform.test.ts`에 gitlab 케이스 추가 시 통과

### Task 2: API 어댑터 + 단위 테스트
- **변경 대상**: `src/background/gitlab-api.ts`(신규), `src/background/__tests__/gitlab-api.test.ts`(신규)
- **작업 내용**: design의 엔드포인트 매핑 전부. 순수 함수 분리: `buildAuthHeader`, `normalizeProject`, `mapCreateIssueBody`(labels→comma string, assignee_ids), `normalizeIssueStatus`(`opened`/`closed`), `messageForGitlabStatus`(401/403/404/422/429/5xx). `gitlabFetch`는 `auth.baseUrl` prefix. refresh hook(`setGitlabRefreshHook`/`ensureFresh`/401 재시도) GitHub 미러.
- **검증**:
  - [ ] 단위 테스트: `mapCreateIssueBody`(라벨 join·assignee_ids·빈 값 생략), `normalizeIssueStatus`(state 매핑), `messageForGitlabStatus`(상태코드별), `buildAuthHeader`(pat/oauth)
  - [ ] `pnpm test` 통과

### Task 3: OAuth (gitlab.com PKCE) + 테스트
- **변경 대상**: `src/background/gitlab-oauth.ts`(신규), `src/background/__tests__/gitlab-oauth.test.ts`(신규)
- **작업 내용**: `linear-oauth.ts` 미러. PKCE(S256), authorize/token = gitlab.com 고정, refresh token 회전 저장, `baseUrl: "https://gitlab.com"` 박기, `isGitlabOAuthConfigured`, `parseGitlabCallbackParams`(state mismatch·error·code 누락), 취소 코드(`access_denied`).
- **검증**:
  - [ ] 단위 테스트: `parseGitlabCallbackParams`(정상/state불일치/error/code누락), `isGitlabOAuthConfigured`(client id 유무)
  - [ ] `pnpm test` 통과

### Task 4: 저장소 + 메시지 타입/핸들러
- **변경 대상**: `src/lib/settings-storage.ts`, `src/types/messages.ts`, `src/background/messages.ts`
- **작업 내용**: `readStoredGitlabAuth`/`writeStoredGitlabOAuthTokens`. `BgRequest`에 gitlab.* 12종 + `getOAuthErrorPlatform`에 `"gitlab"`. `loadGitlabAuth()` + handler case 12종(`gitlab.testPat`는 `{pat, baseUrl}`로 `getMyself` 호출, `gitlab.uploadFiles`는 각 파일 `uploadFile` 후 `{filename, markdown, url}` 반환).
- **검증**:
  - [ ] `pnpm typecheck` — handler switch의 exhaustive `never` 체크 통과(gitlab case 누락 시 컴파일 에러)
  - [ ] `src/store/__tests__/settings-store.test.ts` 통과

### Task 5: 스토어 + 이슈 레코드
- **변경 대상**: `src/store/settings-store.ts`, `src/store/issues-store.ts`
- **작업 내용**: `updateGitlabAccount` setter, `SETTINGS_STORE_VERSION` 6→7(주석: gitlab 추가, optional이라 데이터 마이그레이션 불요), `PLATFORM_FALLBACK_ORDER`에 `"gitlab"`. `IssueRecord`에 `gitlabProjectId?`, `gitlabIssueIid?`, `gitlabLabels?`, `gitlabWebUrl?`.
- **검증**:
  - [ ] `pnpm typecheck`
  - [ ] settings-store 테스트에 버전 7 마이그레이션(데이터 보존) 케이스 통과

### Task 6: connect 폼 (OAuth/PAT + Instance URL 다이얼로그)
- **변경 대상**: `src/sidepanel/tabs/connect/GitlabConnectForm.tsx`(신규)
- **작업 내용**: `GithubConnectForm.tsx` 미러. 온보딩(OAuth 버튼 gitlab.com 전용 + PAT 버튼). **PAT 다이얼로그에 입력 2개**: Instance URL(기본 `https://gitlab.com`, trailing slash 정규화, 빈 값→gitlab.com) + Token. self-managed면 Task 0 헬퍼로 origin 권한 요청 후 `gitlab.testPat` 검증. "토큰 받기" 링크는 `${instanceUrl}/-/user_settings/personal_access_tokens`. 연결 요약 카드 + 기본값(프로젝트/라벨) 설정.
- **검증** (수동):
  - [ ] gitlab.com OAuth 연결 성공, 카드에 username 표시
  - [ ] gitlab.com PAT 연결(Instance URL 기본값)
  - [ ] self-managed PAT: Instance URL 변경 → 권한 프롬프트 → 검증 성공. 권한 거부 시 실패 토스트
  - [ ] OAuth env 미설정 시 OAuth 버튼 숨김 + 안내 문구

### Task 7: 필드 컴포넌트
- **변경 대상**: `src/sidepanel/tabs/gitlabFields/{ProjectCombobox,LabelCombobox,AssigneeCombobox,GitlabIssueFields}.tsx`(신규)
- **작업 내용**: `githubFields/*` 미러. 250ms 디바운스 + `reqIdRef` 가드. ProjectCombobox value = `{projectId, projectPath}`. Label/Assignee는 project 선택 후 활성(`requireProject`).
- **검증** (수동):
  - [ ] 프로젝트 검색·선택, 라벨·담당자 로드
  - [ ] 프로젝트 미선택 시 라벨/담당자 비활성

### Task 8: 제출 오케스트레이션 + 본문 빌더
- **변경 대상**: `src/sidepanel/lib/submitToGitlab.ts`(신규), `src/sidepanel/lib/buildGitlabIssueBody.ts`(신규)
- **작업 내용**: `submitToGithub.ts`/`buildGithubIssueBody.ts` 미러. 업로드 결과의 `markdown`/`url`로 인라인 placeholder 치환 → 본문 빌드 → `gitlab.submitIssue`. 결과 `{ key: `#${iid}`, url }`.
- **검증**:
  - [ ] 본문 빌더 순수 함수 단위 테스트(인라인 ref 치환, 섹션 구성) — 가능하면
  - [ ] `pnpm test`

### Task 9: 제출/드래프트 UI 와이어링
- **변경 대상**: `IntegrationsTab.tsx`, `SubmitFieldsDialog.tsx`, `DraftDetailDialog.tsx`, `IssueCreateModal.tsx`
- **작업 내용**: IntegrationsTab — `PlatformSubTab`·`PLATFORM_ORDER`·`PLATFORM_LABEL_KEYS`+gitlab, `grid-cols-4`→`grid-cols-5`, TabsTrigger(`SiGitlab`)+TabsContent. SubmitFieldsDialog — configured/canSubmit/TabsList/필드 렌더 분기. Draft·IssueCreate — gitlabAccount·lastGitlabSubmit·`usePlatformFields`·`handleSubmit` dispatch(`submitToGitlab`).
- **검증** (수동):
  - [ ] 연동 탭에 GitLab 5번째 탭 표시(grid 5칸 정렬 정상)
  - [ ] 이슈 작성 화면에서 GitLab 선택 → 필드 노출 → 첨부 포함 제출 성공, 본문 이미지 인라인 렌더
  - [ ] 프로젝트 미선택 시 제출 차단

### Task 10: 상태 배지 + 칩
- **변경 대상**: `statusBadges/GitlabSubmittedBadge.tsx`(신규), `statusBadges/SubmittedBadge.tsx`, `statusBadges/PlatformChip.tsx`, `issueListUtils.ts`
- **작업 내용**: `GithubSubmittedBadge` 미러(상태 폴링 + IssueRecord patch). SubmittedBadge 디스패치·PlatformChip(`SiGitlab`, fallback 앞 분기)·issueListUtils에 gitlab.
- **검증** (수동):
  - [ ] 등록 이슈 배지가 opened/closed 표시
  - [ ] close/reopen 동작
  - [ ] 이슈 목록 칩이 GitLab 아이콘으로 표시(GitHub fallback 아님)

### Task 11: manifest + i18n + privacy
- **변경 대상**: `manifest.config.ts`, `src/i18n/namespaces/integrations.ts`, `docs/privacy.md`
- **작업 내용**: host_permissions에 `"https://gitlab.com/*"`. `gitlab.*` i18n 키(github 키셋 미러 + `gitlab.instanceUrl.label`/`gitlab.instanceUrl.placeholder`/`gitlab.field.project*`/`gitlab.selfManaged.permissionDenied`) ko/en 동시. privacy.md에 gitlab.com 호스트 + self-managed 임의 origin 사용·캡처 전송 동작 반영 + 시행일.
- **검증**:
  - [ ] i18n PostToolUse 훅(ko/en 대칭) 통과
  - [ ] `pnpm typecheck`(TranslationKey 사용처)
  - [ ] privacy.md에 GitLab 항목·시행일 갱신 확인

## 테스트 계획

### 단위 테스트 (Vitest)
- `gitlab-api.test.ts`: `mapCreateIssueBody`, `normalizeProject`, `normalizeIssueStatus`, `messageForGitlabStatus`, `buildAuthHeader`
- `gitlab-oauth.test.ts`: `parseGitlabCallbackParams`, `isGitlabOAuthConfigured`
- `platform.test.ts`/`settings-store.test.ts`: gitlab account/migration 케이스
- (가능 시) `buildGitlabIssueBody` 인라인 치환

### 수동 테스트 (Chrome, `pnpm dev` 로드 언팩)
1. gitlab.com OAuth 연결 → 본인 표시
2. gitlab.com PAT 연결
3. self-managed PAT 연결(권한 프롬프트→검증) / 권한 거부 케이스
4. 프로젝트·라벨·담당자 선택 → 첨부(스크린샷+영상+인라인+로그) 포함 이슈 생성 → 본문 인라인 렌더 확인
5. 상태 배지 opened/closed, close/reopen
6. OAuth env 미설정 시 OAuth 버튼 숨김
7. 기존 4개 플랫폼 회귀 없음(각 1건 제출)

## 구현 순서 권장

```
Task 0 (조사)
  └─ Task 1 (타입)  ← 모든 후속의 기반
       ├─ Task 2 (api+test)  ─┐
       ├─ Task 3 (oauth+test) ─┤  병렬 가능 (백그라운드 3종)
       └─ Task 4 (msg/storage)─┘  ← 2·3 완료 후 import 연결
            └─ Task 5 (store)
                 ├─ Task 6 (connect 폼)   ← Task 4 메시지 필요
                 ├─ Task 7 (필드)         ← Task 4 메시지 필요  (6·7 병렬)
                 └─ Task 8 (제출 로직)     ← Task 4 메시지 필요
                      └─ Task 9 (제출 UI 와이어링) ← 6·7·8 필요
                           └─ Task 10 (배지·칩)
                                └─ Task 11 (manifest·i18n·privacy)  ← i18n은 6·7·9·10과 함께 점진 추가도 OK
```

- 백그라운드(2·3·4)와 UI(6·7)는 메시지 계약(Task 4)만 고정되면 병렬 진행 가능.
- i18n 키는 각 UI 태스크에서 쓰는 키를 그때그때 추가하되, Task 11에서 누락·대칭 최종 점검.
