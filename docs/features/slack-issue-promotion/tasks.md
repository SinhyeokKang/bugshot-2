# Slack 제출 이슈 승격 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변경 없음(제출 어댑터·Slack API 무변경). manifest·privacy.md 영향 없음.
- `removeIssue`가 blob(IndexedDB)까지 정리하는지 사전 확인(Slack 보존 이슈 삭제가 draft 삭제와 동일 경로여야 함).
- 데이터 모델은 optional 필드 추가뿐이라 `ISSUES_STORE_VERSION` 변경/마이그레이션 불필요(확인).

## 태스크

### Task 1: 순수 판정 함수 + 단위 테스트 (테스트 우선)
- **변경 대상**: `src/sidepanel/tabs/issueListUtils.ts` (또는 신규 `src/sidepanel/tabs/slackPromotion.ts`), `src/sidepanel/tabs/__tests__/*.test.ts`
- **작업 내용**:
  - `isSlackPreserved(issue)`, `promotableTargets(accounts)`, `canPromoteSlack(issue, accounts)`, `submittablePlatforms(issue, accounts)` 구현.
  - `matchesStatus`는 **변경하지 않음**을 테스트로 고정(slackPreserved 이슈가 submitted 필터 매칭, draft 필터 비매칭).
- **검증**:
  - [ ] `isSlackPreserved`: submitted+slackPreserved=true → true; draft → false; submitted+플래그없음 → false
  - [ ] `promotableTargets`: accounts에 slack만 → `[]`; slack+jira → `["jira"]`
  - [ ] `canPromoteSlack`: slack 보존 이슈 + 트래커 1개 → true; 트래커 0 → false; 일반 submitted → false
  - [ ] `submittablePlatforms`: slack 보존 이슈 → slack 제외 목록; 일반 draft → connectedPlatforms 전체
  - [ ] `matchesStatus(slack보존이슈, "submitted")===true`, `matchesStatus(..., "draft")===false`
  - [ ] `pnpm test` 통과

### Task 2: 데이터 모델 + store 액션
- **변경 대상**: `src/store/issues-store.ts`, `src/store/__tests__/*.test.ts`
- **작업 내용**:
  - `IssueRecord`에 `slackPreserved?: boolean` 추가.
  - `markSlackShared(id, { key, url })` 액션 추가 — status/platform/submittedAt/updatedAt/slackPreserved 세팅, draft·snapshot·styleEdits·blob 참조 유지, blob 삭제 호출 없음.
  - `stripSubmitted`에 `slackPreserved: undefined` 추가.
- **검증**:
  - [ ] `markSlackShared` 후 레코드: status="submitted", platform="slack", slackPreserved=true, draft/snapshot/blob키 유지
  - [ ] `stripSubmitted`(승격) 후: slackPreserved=undefined, draft 비워짐, blob키 undefined
  - [ ] 기존 `markSubmitted`(Slack 외) 동작 회귀 없음
  - [ ] `pnpm test` 통과

### Task 3: 신규 작성 Slack 제출을 보존 경로로 전환
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`
- **작업 내용**: `handleSlackSubmit`의 `markSubmitted(currentIssueId, {platform:"slack",key,url})` → `markSlackShared(currentIssueId, {key,url})`. reset/lastSubmitFields/lastSubmittedPlatform 유지.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (수동) Slack 제출 후 이슈 목록 카드 클릭 시 데이터가 남아 있음(이미지/로그 표시)

### Task 4: IssueRow — Upload 버튼 + 클릭 분기
- **변경 대상**: `src/sidepanel/tabs/IssueRow.tsx`, `src/sidepanel/tabs/IssueListTab.tsx`
- **작업 내용**:
  - IssueRow: `accounts` 구독, `promotable = canPromoteSlack(issue, accounts)`. `handleCardClick`에서 promotable이면 `onOpenDraft()`. 우측에 promotable이면 lucide `Upload` IconButton(`onOpenSubmit`, `stopPropagation`), 아니면 기존 분기. props에 `onOpenSubmit` 추가. aria-label은 `t("issueList.promote")`.
  - IssueListTab: `autoSubmit` 상태 추가, `onOpenSubmit`/`onOpenDraft` 핸들러에서 set, `DraftDetailDialog`에 `autoOpenSubmit` 전달 + 닫힐 때 reset.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (e2e) slack 보존 + 트래커 연결 시 카드 우측 Upload 버튼 노출(`data-testid` 부여)
  - [ ] (e2e) 트래커 0이면 Upload 버튼 미노출, 기존 배지 유지

### Task 5: DraftDetailDialog — Slack 제외 + autoOpenSubmit
- **변경 대상**: `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**:
  - `available = submittablePlatforms(issue, accounts)`.
  - `initialPlatform`이 `available`에 없으면 `available[0]`로 fallback.
  - prop `autoOpenSubmit` 추가 — open 시 `setSubmitOpen(true)`(prefill effect와 deps 정합 주의, `issue.platform` deps 회피).
  - `handleSlackSubmit`의 `markSubmitted` → `markSlackShared`(일반 draft를 Slack 제출하는 경로 보존).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (e2e) slack 보존 카드 Upload 클릭 → 제출 다이얼로그 열림 + Slack 탭 없음
  - [ ] (e2e) slack 보존 카드 본문 클릭 → `draft-detail-dialog` 열림(permalink 이동 X)

### Task 6: i18n 라벨
- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**: `issueList.promote` 등 Upload 버튼 라벨 ko/en 추가.
- **검증**:
  - [ ] PostToolUse 훅(locales 대칭) 통과
  - [ ] `pnpm test` 통과

## 테스트 계획

- **단위 테스트** (Task 1·2):
  - `isSlackPreserved`/`promotableTargets`/`canPromoteSlack`/`submittablePlatforms` 분기 전수.
  - `matchesStatus`가 slackPreserved를 submitted로 분류함을 고정.
  - `markSlackShared`가 데이터 보존, `stripSubmitted`가 slackPreserved 포함 폐기함을 검증.
- **e2e 시나리오** (`/e2e-write` 입력):
  - Slack + Jira 연결 상태에서 이슈를 Slack 제출하면, 목록 카드 우측에 Upload 제출 버튼이 보인다.
  - Slack 제출 카드 본문을 클릭하면 `draft-detail-dialog`가 열린다(새 탭 이동 없음).
  - Slack 제출 카드의 Upload 버튼을 클릭하면 제출 다이얼로그가 열리고 Slack 탭이 없다.
  - Slack 제출 이슈는 submitted 필터에 보이고 draft 필터에는 보이지 않는다.
  - (Slack만 연결) Slack 제출 카드 우측에 Upload 버튼이 없고 Slack 배지가 보인다.
- **수동 테스트** (Chrome):
  - Slack 제출 후 DraftDetailDialog에서 캡처 이미지·영상·로그가 실제로 보존돼 표시되는지(blob 의존).
  - Jira로 승격 후 카드가 일반 Jira submitted로 바뀌고(배지·URL 이동), 다시 열어도 Slack 이력/원본 데이터가 사라졌는지.
  - 승격 후 DraftDetailДialog 재진입 불가(일반 submitted는 permalink/URL 이동) 확인.
  - 트래커 미연결 → 추가 연결 시 같은 카드가 동적으로 Upload 모드로 전환되는지.

## 구현 순서 권장

1. **Task 1 → Task 2** (순수 함수·store, 테스트 우선). 서로 독립이나 Task 4/5가 둘 다 의존.
2. **Task 3** (신규 Slack 제출 보존) — Task 2 완료 후. 보존 데이터를 만드는 진입점.
3. **Task 4 ∥ Task 5** (UI) — Task 1·2 완료 후 병렬 가능. Task 5의 `markSlackShared` 사용은 Task 2 의존.
4. **Task 6** (i18n) — Task 4에서 키 사용처 확정 후 또는 병렬.

## 가이드 영향

사용자 노출 UX 변경(Slack 제출 카드 동작·Upload 승격 버튼) → `/guide` 대상.
- `guide/ko`·`guide/en`의 Slack 연동 / 이슈 목록 관련 페이지(예: 이슈 목록·Slack 공유 설명 페이지) — Slack 제출 이슈의 데이터 보존 및 "트래커로 승격" 동작 추가. 정확한 파일은 `guide/AUTHORING.md` IA 확인 후 `/guide`에서 ko·en 동시 갱신.
