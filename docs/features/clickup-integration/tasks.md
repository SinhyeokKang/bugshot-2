# ClickUp 연동 — 구현 태스크

## 선행 조건

- **PAT 경로**는 외부 의존 없이 즉시 구현/검증 가능 → 먼저 진행.
- **OAuth 경로**는 ① ClickUp OAuth 앱 생성(client_id/secret) ② `oauth-proxy/worker.ts`에 `/clickup/token` 추가 + Cloudflare 재배포 ③ `.env`에 `VITE_CLICKUP_CLIENT_ID`, proxy에 `CLICKUP_CLIENT_SECRET` 주입이 끝나야 동작.
- ClickUp dev workspace 1개(Space/List 보유)와 `pk_` PAT 1개 준비.

## 태스크

### Task 1: 타입 정의
- **변경 대상**: `src/types/clickup.ts`(신규), `src/types/platform.ts`
- **작업 내용**: `design.md` 인터페이스대로 `clickup.ts` 작성. `platform.ts`에 `PlatformId` `"clickup"` 추가, `PLATFORM_TAB_KEYS.clickup`, `Accounts.clickup?`, `ClickupLastSubmitFields` + `LastSubmitFieldsByPlatform.clickup?`.
- **검증**:
  - [ ] `pnpm typecheck` 통과 (union exhaustive 충족)
  - [ ] `PLATFORM_TAB_KEYS`가 `Record<PlatformId, string>` 만족(컴파일)

### Task 2: 메시지 타입 3곳 등록
- **변경 대상**: `src/types/messages.ts`, `src/background/bgRequestTypes.ts`
- **작업 내용**: `clickup.*` 13개 메시지(`setCompleted` 포함)를 `BgRequest` union에 추가, `BG_REQUEST_TYPE_MAP`에 동일 키 추가.
- **검증**:
  - [ ] `BG_REQUEST_TYPE_MAP: Record<BgRequest["type"], true>`가 컴파일 → 키 누락 시 타입 에러로 검출
  - [ ] `pnpm typecheck` 통과

### Task 3: background OAuth (PAT 우선)
- **변경 대상**: `src/background/clickup-oauth.ts`(신규)
- **작업 내용**: `isClickupOAuthConfigured()`, `startClickupOAuth()`, `parseClickupCallbackParams()`, `persistClickupOAuthTokens()`. `asana-oauth.ts` 복제하되 refresh 제거. 토큰 교환은 proxy `/clickup/token`.
- **검증**:
  - [ ] `isClickupOAuthConfigured()` env 유무 분기 단위 테스트
  - [ ] `parseClickupCallbackParams()` code/error/state 파싱 단위 테스트

### Task 4: background API 클라이언트
- **변경 대상**: `src/background/clickup-api.ts`(신규)
- **작업 내용**: `clickupFetch<T>()`(**raw token 헤더 `Authorization: <token>`, Bearer 없음 — Asana와 다름**, 401→`clickup.oauthRevoked` 재연결 에러, refresh 없음), `getMyself`/`getTeams`/`getSpaces`/`getLists`(folderless+folder 평탄화)/`getMembers`, `createTask`(`markdown_content`+`assignees`), `uploadAttachment`(multipart `POST /task/{id}/attachment`), `updateTaskMarkdown`(`PUT /task/{id}`), `getTaskStatus`, `setTaskCompleted`(done status PUT). 평탄화는 순수 헬퍼 `flattenLists(folderless, folders)`로 분리(네트워크와 격리해 단위 테스트 가능 — 나머지 fetch 함수는 수동 검증).
- **검증**:
  - [ ] 🔴 **1순위**: PAT 실호출로 raw token 헤더 동작 확인(401 안 나는지). 깨지면 헤더 형식 즉시 수정 — 이후 모든 API가 여기 의존
  - [ ] `clickupFetch` 헤더 구성(PAT vs OAuth) 단위 테스트
  - [ ] `flattenLists` 순수 헬퍼 단위 테스트(folderless + folder list 병합)
  - [ ] 401 → 재연결 에러(`oauthRevoked`) 분기 단위 테스트(refresh 없이 즉시 throw)
  - [ ] PAT로 실제 task 생성 수동 확인(반환 url 열림)

### Task 5: background 메시지 핸들러 + 저장
- **변경 대상**: `src/background/messages.ts`, `src/lib/settings-storage.ts`
- **작업 내용**: clickup-oauth/clickup-api import, `loadClickupAuth()`, `handleMessage` switch에 `clickup.*` case 13개(`setCompleted` 포함). `settings-storage`에 `readStoredClickupAuth()`/`writeStoredClickupOAuthTokens()` + envelope 슬롯.
- **검증**:
  - [ ] 각 `clickup.*` 메시지가 대응 API 함수로 라우팅(타입체크)
  - [ ] PAT 저장→로드 라운드트립 수동 확인

### Task 6: 본문 빌더 + 어댑터
- **변경 대상**: `src/sidepanel/lib/buildClickupIssueBody.ts`(신규), `src/sidepanel/lib/submitToClickup.ts`(신규), `src/sidepanel/lib/ccMention.ts`
- **⚠️ 선행 스파이크(착수 전)**: inline 이미지는 출시 게이트라, 구현 전 PAT로 ① ClickUp `markdown_content`가 attachment URL을 `![](url)`로 렌더하는지 ② 그 URL이 public 접근 가능한지(presigned/private 아닌지) 검증. 미지원이면 게이트를 재정의(PRD)하고 첨부 폴백 경로로 구현. 결과에 따라 아래 치환 로직 유무가 갈린다.
- **작업 내용**: `buildClickupIssueBody`는 `buildIssueMarkdown` 산출 markdown + CC 줄(`ccMarkdownLine`). `submitToClickup`은 design 제출 순서(task 생성→첨부 업로드→inline 이미지면 본문 2차 갱신 `updateTaskMarkdown`). inline 이미지 렌더 불가 시 첨부 폴백 + `submit.inlineImagesDropped` 토스트(기존 `logsDropped`와 의미가 달라 별도 키).
- **검증**:
  - [ ] `buildClickupIssueBody` CC 줄 주입/미주입 단위 테스트
  - [ ] inline 이미지 markdown 치환 헬퍼 단위 테스트(있을 때/없을 때)
  - [ ] `submitToClickup` 업로드 순서·`logsDropped`·`inlineImagesDropped` 처리 단위 테스트(sendBg mock)

### Task 7: 연동 탭 + connect form
- **변경 대상**: `src/sidepanel/tabs/connect/ClickupConnectForm.tsx`(신규), `src/sidepanel/tabs/IntegrationsTab.tsx`
- **작업 내용**: `AsanaConnectForm.tsx` 복제 → `ClickupConnectedBody`/`ClickupConnectFlow`/PAT 다이얼로그. `PLATFORMS` 배열에 ClickUp(`SiClickup`). OAuth env 부재 시 OAuth 옵션 숨김.
- **검증**:
  - [ ] 연동 탭에 ClickUp 카드 노출
  - [ ] PAT 입력→검증→연결/해제 수동 확인
  - [ ] env 미설정 시 OAuth 버튼 숨김 확인

### Task 8: 제출 필드 컴포넌트 + 훅
- **변경 대상**: `src/sidepanel/tabs/clickupFields/*`(신규 5개), `src/sidepanel/hooks/usePlatformFields.ts`
- **작업 내용**: `ClickupIssueFields` + Workspace/Space/List/Assignee/Cc 콤보박스. 상위 선택 후 하위 활성(종속 로드). List 콤보박스는 `CommandInput` 클라이언트 필터 포함(평탄화 대량 list 흡수). 종속 리셋: Workspace 변경→space/list/assignee/cc 리셋, Space 변경→list만 리셋(assignee/cc는 workspace 종속 유지). 비활성 라벨 i18n(`requireWorkspace`/`requireSpace`). `initialClickupFields()`로 last/defaults prefill(3단계 prefill 우선순위). `usePlatformFields`에 clickup 상태 블록.
- **검증**:
  - [ ] `initialClickupFields` last/defaults 우선순위 + 3단계 prefill 단위 테스트
  - [ ] Workspace→Space→List 종속 활성화 수동 확인
  - [ ] 상위 재선택 시 하위 stale 값 초기화 확인(Workspace 바꾸면 list/assignee 리셋)
  - [ ] List 0개 Space 선택 시 빈 상태 안내 노출
  - [ ] List 많은 Space에서 `CommandInput` 필터 동작

### Task 9: 제출 다이얼로그 + 핸들러 + 재제출
- **변경 대상**: `src/sidepanel/tabs/SubmitFieldsDialog.tsx`, `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`, `src/store/settings-store.ts`
- **작업 내용**: `PLATFORM_TABS`/`platformConfigured`/`canSubmit`(listId 필수)/렌더 분기에 clickup. **`TABS_GRID_COLS`에 `7: "grid-cols-7"` 추가**(현재 2~6만 정의, 7개 탭이 2칸으로 깨짐). 삼항 체인 + notion 폴백이라 clickup 누락이 조용히 Notion으로 새므로 **누락 없이 추가**(가능하면 switch+`never` exhaustive 전환). `handleClickupSubmit()`(Asana 핸들러 복제) + `handleSubmit` 라우팅. DraftDetailDialog 재제출 연결. `PLATFORM_FALLBACK_ORDER`에 clickup. `settings-store` **`SETTINGS_STORE_VERSION` v8→v9 bump**.
- **검증**:
  - [ ] ClickUp 선택→List 선택 전 제출 비활성, 후 활성
  - [ ] 🔴 ClickUp 선택 시 유효성/렌더가 **Notion 필드로 새지 않음**(폴백 누락 가드)
  - [ ] 7개 플랫폼 전부 연결 시 탭 격자 정상(`grid-cols-7`)
  - [ ] 제출 성공→성공 화면 url 열림(수동)
  - [ ] draft 재제출 동작 + 저장된 List 삭제된 경우 빈 상태 안내(수동)

### Task 10: 이슈 목록 상태 + 분석
- **변경 대상**: 이슈 목록 탭(상태 조회/변경), `statusBadges/SubmittedBadge`(ClickUp 분기), `src/sidepanel/lib/track-submit.ts` 확인
- **작업 내용**: 제출 이력에 ClickUp task 표시 + `getTaskStatus`로 완료 상태. **완료 상태 변경**: SubmittedBadge ClickUp 분기에 Asana식 Popover 변경 UI 연결 → `clickup.setCompleted`. 완료 판정 룰(done status 매핑)은 구현 시 실제 응답으로 확정. analytics platform="clickup" 자동 집계 확인.
- **검증**:
  - [ ] 이슈 목록에 ClickUp 항목·상태 노출(수동)
  - [ ] ClickUp task 완료 토글 → ClickUp에 반영(수동)
  - [ ] 제출/해제 시 analytics 이벤트 platform=clickup

### Task 11: manifest·env·proxy·문서
- **변경 대상**: `manifest.config.ts`, `.env.example`, `oauth-proxy/worker.ts`, `CLAUDE.md`, `DIRECTORY.md`, `ARCHITECTURE.md`, `PERMISSION.md`, `docs/privacy.md`
- **작업 내용**: host_permissions(`api.clickup.com`, `app.clickup.com`); env 키; proxy `/clickup/token`; 문서 6종에 새 플랫폼/권한/OAuth 흐름/데이터 동작 반영(privacy 시행일 갱신).
- **검증**:
  - [ ] `pnpm build` manifest에 host 반영
  - [ ] OAuth end-to-end 수동(앱·proxy 준비 후)
  - [ ] 문서 신선도(`/push` 게이트 통과)

## 테스트 계획

- **단위 테스트(Vitest, `__tests__/*.test.ts`)**:
  - `clickup-oauth`: `isClickupOAuthConfigured` env 분기, `parseClickupCallbackParams`.
  - `clickup-api`: `clickupFetch` 헤더(raw token PAT/OAuth), `flattenLists` 평탄화, 401→재연결 분기.
  - `buildClickupIssueBody`: CC 줄 주입/미주입, 섹션 markdown.
  - `submitToClickup`: 업로드 순서·inline 치환·`logsDropped`(sendBg mock).
  - `initialClickupFields`: last/defaults prefill 우선순위.
- **e2e 시나리오**(`/e2e-write` 입력) — 제출 성공 모킹 선례가 없어(MV3 SW fetch 가로채기 패턴 부재) 셀렉터 추가 후 판정 가능한 것만 e2e로, 나머지는 단위로 대체:
  - **e2e (셀렉터 추가 필요)**:
    - ClickUp을 PAT로 연결하면 연동 탭에 연결 상태가 표시된다. (testid 추가: 연결 상태)
    - ClickUp을 선택하고 List 미선택이면 제출 버튼이 비활성, List 선택 후 활성이 된다. (testid 추가: `platform-tab-clickup`, `clickup-list-combobox`, 제출 버튼)
    - OAuth env 미설정 시 ClickUp 연결 다이얼로그에 OAuth 옵션이 없다.
  - **단위로 대체(e2e 부적합)**:
    - ClickUp 제출 성공 시 task URL 반환 → `submitToClickup`(sendBg mock) 단위 테스트로 대체. (e2e로 SW fetch 모킹 불가)
  - ※ `tasks.md`의 e2e src 수정 정책은 "data-testid 추가만" 허용이므로 위 testid 부착 계획을 `/e2e-write`에서 반영.
- **수동 테스트**(자동화 불가):
  - 실제 ClickUp task 생성 + 첨부(이미지/영상/logs.html) 업로드 렌더 확인.
  - **inline 이미지가 task 본문에 임베드되는지**(출시 게이트 — Task 6 선행 스파이크에서 렌더·URL public 검증, 미지원 시 첨부 폴백 확인).
  - CC 멘션이 실제 알림 링크로 동작하는지(best-effort — 안 가도 통과).
  - OAuth end-to-end(앱·proxy 준비 후 토큰 교환·재연결).

## 구현 순서 권장

```
Task 1 → Task 2 → (Task 3 PAT부 + Task 4 + Task 5)  // background, PAT 경로 먼저 동작
      → Task 6 (어댑터)
      → Task 7, Task 8 (UI, 병렬 가능)
      → Task 9 (제출/재제출 통합)
      → Task 10 (목록/분석)
      → Task 11 (manifest/proxy/문서 — OAuth는 proxy 배포 후 최종 검증)
```
- OAuth(Task 3 OAuth부 + Task 11 proxy)는 외부 준비에 의존하므로 PAT 경로로 전 기능 검증 후 마지막에 붙인다.
- Task 7과 Task 8은 의존 없어 병렬 가능.

## 가이드 영향

사용자 노출 기능(새 플랫폼 연결·제출) → `/guide`로 ko·en 갱신 필요:
- `guide/ko`·`guide/en`의 연동(integrations) 페이지 — ClickUp 연결(OAuth/PAT) 추가.
- 이슈 제출/플랫폼 목록을 다루는 페이지 — ClickUp 대상 선택(Workspace→Space→List) 추가.
- 플랫폼 표/지원 목록이 있으면 ClickUp 행 추가(`guide/AUTHORING.md` 플랫폼 스냅샷 포함).
- 정확한 페이지 경로·표는 `guide/AUTHORING.md` 규칙에 따라 `/guide`에서 확정.
