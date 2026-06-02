# Azure DevOps Boards 연동 — 구현 태스크

## 선행 조건

- 테스트용 Azure DevOps organization + project + PAT(Work Items Read & Write 스코프).
- `SETTINGS_STORE_VERSION` 현재값 확인.

### Task 0: 마크다운 렌더링 검증 (코딩 전 필수 게이트)
- **작업 내용**: 실제 org에서 `_apis/wit/workitems/$Bug`에 `System.Description`을 마크다운 텍스트로 POST → Azure Boards UI에서 렌더 확인. ReproSteps vs Description 본문 필드도 type별로 확인.
- **분기 결정**:
  - 마크다운 렌더 OK → `buildAzureIssueBody` 마크다운 그대로 (변환기 0).
  - 미렌더 → ① field format=Markdown patch op 추가 경로 확정, 또는 ② HTML 변환기 추가(`markdownToAzureHtml.ts`) — design.md 위험 요소 참조.
- **검증**:
  - [ ] 마크다운/HTML 중 채택 경로가 design.md에 확정 기재됨.
  - [ ] Bug/Issue/Task 각 type의 본문 필드(referenceName) 확인됨.

## 태스크

### Task 1: 타입 정의
- **변경 대상**: `src/types/azure.ts` (신규), `src/types/platform.ts`
- **검증**: [ ] `pnpm typecheck` — exhaustive switch 에러 목록 = 후속 체크리스트.

### Task 2: org URL 정규화 (테스트 우선)
- **변경 대상**: `src/sidepanel/tabs/connect/azureOrgUrl.ts` (신규), `__tests__/azureOrgUrl.test.ts`
- **작업 내용**: GitLab `gitlabInstanceUrl` 미러 + org 추출. 다양한 입력(full URL/org 단독/trailing slash/잘못된 호스트) 테스트.
- **검증**: [ ] `pnpm test azureOrgUrl` 통과.

### Task 3: API 어댑터 (테스트 우선)
- **변경 대상**: `src/background/azure-api.ts` (신규), `__tests__/azure-api.test.ts`
- **작업 내용**: `buildAuthHeader`(Basic), `buildPatchDocument`(JSON Patch 조립), `messageForAzureStatus`는 테스트 먼저. fetch 래퍼는 api-version 자동 부착 + json-patch+json content-type.
- **검증**:
  - [ ] `buildPatchDocument`가 title/description/assignee/attachment relations를 정확한 op/path로 조립.
  - [ ] Basic 헤더 base64 포맷 검증.
  - [ ] `pnpm test azure-api` 통과.

### Task 4: 스토리지 + 스토어
- **변경 대상**: `src/lib/settings-storage.ts`, `src/store/settings-store.ts`
- **작업 내용**: `readStoredAzureAuth`, `updateAzureAccount`, `SETTINGS_STORE_VERSION` +1. (PAT 불변 → OAuth write 함수 없음)
- **검증**: [ ] `settings-store.test.ts`에 azure 계정 케이스 추가, 통과.

### Task 5: 메시지 핸들러
- **변경 대상**: `src/background/messages.ts`, `src/types/messages.ts`
- **작업 내용**: `azure.*` 유니언 + 케이스(testPat/disconnect/getConnectionData/getProjects/getWorkItemTypes/searchIdentities/uploadAttachments/submitIssue/getWorkItemStatus/updateWorkItemState) + `loadAzureAuth()`. **OAuth 케이스·refresh-hook 없음**.
- **검증**: [ ] `pnpm typecheck`.

### Task 6: 본문 빌더 + 제출 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/buildAzureIssueBody.ts`, `submitToAzure.ts` (신규), `__tests__/buildAzureIssueBody.test.ts`
- **작업 내용**: Task 0 결정에 따라 마크다운 or HTML. `submitToAzure`는 attachment 선업로드 → 본문 인라인 → createWorkItem(JSON Patch + AttachedFile relations).
- **검증**: [ ] `pnpm test buildAzureIssueBody` 통과.

### Task 7: 연결 UI
- **변경 대상**: `src/sidepanel/tabs/connect/AzureConnectForm.tsx` (신규), `IntegrationsTab.tsx`
- **작업 내용**: `SiAzuredevops` 아이콘 + PLATFORMS. org URL + PAT 입력 → `getConnectionData` 검증 → 기본 project·work item type 선택 + Summary. **OAuth 버튼 없음**.
- **검증**: [ ] Chrome에서 org URL+PAT 연결 성공.

### Task 8: 이슈 필드 UI
- **변경 대상**: `src/sidepanel/tabs/azureFields/{AzureIssueFields,ProjectCombobox,WorkItemTypeCombobox,AssigneeCombobox}.tsx`, `usePlatformFields.ts`, `IssueCreateModal.tsx`
- **작업 내용**: project→work item type→assignee. project 선택 시 type 목록 로드. assignee optional. IssueCreateModal azure 분기.
- **검증**: [ ] project·type 선택 후 등록, work item 생성 확인.

### Task 9: 상태 배지
- **변경 대상**: `src/sidepanel/tabs/statusBadges/{AzureStatusBadge,AzureSubmittedBadge}.tsx`, `issueListUtils.ts`, `issues-store.ts`
- **작업 내용**: `System.State` 표시 + close/reopen best-effort. `resolveAzureCoords`(org+project+id) + 이슈 레코드 필드.
- **검증**: [ ] 목록 배지 State 표시, close/reopen 동작(또는 거부 시 토스트).

### Task 10: i18n + manifest + 문서
- **변경 대상**: `src/i18n/integrations.ts`, `issue.ts`, `manifest.config.ts`, CLAUDE.md/DIRECTORY.md/ARCHITECTURE.md/README.md/PERMISSION.md/docs/privacy.md
- **작업 내용**: `azure.*` + `platform.tab.azure` + `issueList.azure.*`(ko/en). `host_permissions`에 `dev.azure.com`. privacy.md(시행일)·PERMISSION.md·README·CLAUDE.md 갱신.
- **검증**:
  - [ ] i18n 훅 통과.
  - [ ] `pnpm typecheck` + `pnpm test` 전체 통과.

## 테스트 계획

- **단위 테스트**: `azureOrgUrl`, `azure-api`(헤더·`buildPatchDocument`·status), `buildAzureIssueBody`, `settings-store`.
- **수동 테스트(Chrome)**:
  - [ ] org URL+PAT 연결 → project/type 선택 → work item 생성 → URL 확인.
  - [ ] 마크다운/HTML 본문이 Boards UI에서 정상 렌더(Task 0 경로).
  - [ ] 첨부 미디어가 attachment로 업로드 + description 참조.
  - [ ] State close/reopen.
  - [ ] PAT 스코프 부족 시 403 안내.

## 구현 순서 권장

**Task 0(게이트) 필수 선행** → Task 1 → 2·3·4(병렬) → 5 → 6 → 7·8·9(병렬) → 10. Task 0이 본문 전략을 확정하지 못하면 Task 6 진행 불가.
