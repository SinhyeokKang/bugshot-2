# ClickUp 연동 — 구현 태스크

## 선행 조건

- 테스트용 ClickUp workspace + space + list + Personal Token(Settings → Apps → API Token, `pk_…`).
- `SETTINGS_STORE_VERSION` 현재값 확인.
- **외부 API 사실 검증**(코딩 전): ① `markdown_content`로 task 생성 시 본문 렌더, ② attachment URL의 인라인 이미지 렌더 여부, ③ `/list/{id}/member` 응답 형태, ④ `/list/{id}`의 statuses 메타(`type` 필드). 실제 호출 1회로 확인.

## 태스크

### Task 1: 타입 정의
- **변경 대상**: `src/types/clickup.ts` (신규), `src/types/platform.ts`
- **검증**: [ ] `pnpm typecheck` — exhaustive switch 에러 목록 = 후속 체크리스트.

### Task 2: API 어댑터 (테스트 우선)
- **변경 대상**: `src/background/clickup-api.ts` (신규), `__tests__/clickup-api.test.ts`
- **작업 내용**: `buildAuthHeader`(**raw token, Bearer 아님**), `mapCreateTaskBody`(`{ name, markdown_content, assignees }`), `messageForClickupStatus`, status 정규화는 테스트 먼저. `getLists`는 folder+folderless 병합 로직(테스트 대상).
- **검증**:
  - [ ] raw token 헤더 포맷(Bearer 없음) 검증.
  - [ ] `getLists` 병합이 folder list + folderless list를 합치는지(모킹 테스트).
  - [ ] `pnpm test clickup-api` 통과.

### Task 3: 스토리지 + 스토어
- **변경 대상**: `src/lib/settings-storage.ts`, `src/store/settings-store.ts`
- **작업 내용**: `readStoredClickupAuth`, `updateClickupAccount`, `SETTINGS_STORE_VERSION` +1. (토큰 불변 → write 함수 없음)
- **검증**: [ ] `settings-store.test.ts`에 clickup 케이스 추가, 통과.

### Task 4: 메시지 핸들러
- **변경 대상**: `src/background/messages.ts`, `src/types/messages.ts`
- **작업 내용**: `clickup.*` 유니언 + 케이스(testToken/disconnect/getMyself/getTeams/getSpaces/getLists/getListStatuses/searchAssignees/submitIssue/uploadFiles/getTaskStatus/setTaskStatus) + `loadClickupAuth()`. OAuth/refresh-hook 없음.
- **검증**: [ ] `pnpm typecheck`.

### Task 5: 본문 빌더 + 제출 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/buildClickupIssueBody.ts`, `submitToClickup.ts` (신규), `__tests__/buildClickupIssueBody.test.ts`
- **작업 내용**: `buildClickupIssueBody`(마크다운 그대로, 테스트 먼저). `submitToClickup`은 **createTask 먼저 → attachment 루프**. 인라인 이미지 렌더 검증 결과 반영.
- **검증**: [ ] `pnpm test buildClickupIssueBody` 통과.

### Task 6: 연결 UI
- **변경 대상**: `src/sidepanel/tabs/connect/ClickupConnectForm.tsx` (신규), `IntegrationsTab.tsx`
- **작업 내용**: `SiClickup` 아이콘 + PLATFORMS. Personal Token 입력 → `getMyself` 검증 → 기본 team·space·list 선택 + Summary. OAuth 버튼 없음.
- **검증**: [ ] Chrome에서 Personal Token 연결 성공.

### Task 7: 이슈 필드 UI
- **변경 대상**: `src/sidepanel/tabs/clickupFields/{ClickupIssueFields,TeamCombobox,SpaceCombobox,ListCombobox,AssigneeCombobox}.tsx`, `usePlatformFields.ts`, `IssueCreateModal.tsx`
- **작업 내용**: team→space→list(folder는 list 그룹 헤더) →assignee. 상위 미선택 시 하위 비활성. ListCombobox는 folder/folderless 병합 표시. IssueCreateModal clickup 분기.
- **검증**: [ ] 계층 선택 후 등록, task 생성 확인.

### Task 8: 상태 배지
- **변경 대상**: `src/sidepanel/tabs/statusBadges/{ClickupStatusBadge,ClickupSubmittedBadge}.tsx`, `issueListUtils.ts`, `issues-store.ts`
- **작업 내용**: task status 표시 + `statusType` 기반 닫힘 토글. `resolveClickupCoords`(taskId) + 이슈 레코드 필드.
- **검증**: [ ] 목록 배지 status 표시, 변경 동작(닫힘 후보 없으면 비활성).

### Task 9: i18n + manifest + 문서
- **변경 대상**: `src/i18n/integrations.ts`, `issue.ts`, `manifest.config.ts`, CLAUDE.md/DIRECTORY.md/ARCHITECTURE.md/README.md/PERMISSION.md/docs/privacy.md
- **작업 내용**: `clickup.*` + `platform.tab.clickup` + `issueList.clickup.*`(ko/en). `host_permissions`에 `api.clickup.com`. privacy.md(시행일)·PERMISSION.md·README·CLAUDE.md 갱신.
- **검증**:
  - [ ] i18n 훅 통과.
  - [ ] `pnpm typecheck` + `pnpm test` 전체 통과.

## 테스트 계획

- **단위 테스트**: `clickup-api`(raw 헤더·`mapCreateTaskBody`·`getLists` 병합·status), `buildClickupIssueBody`, `settings-store`.
- **수동 테스트(Chrome)**:
  - [ ] Personal Token 연결 → team/space/list 선택 → task 생성 → URL 확인.
  - [ ] `markdown_content` 본문이 ClickUp UI에서 렌더.
  - [ ] folderless list가 ListCombobox에 노출.
  - [ ] 첨부 미디어 업로드 + (인라인 or 첨부 폴백) 동작.
  - [ ] 커스텀 status 배지 표시 + 닫힘 변경.

## 구현 순서 권장

Task 1 → 2·3(병렬) → 4 → 5 → 6·7·8(UI, 병렬) → 9. Task 1이 모든 후속 타입 기반.
