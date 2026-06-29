# Slack 제출 이슈 승격 — 구현 태스크

## 선행 조건

- 권한·env·OAuth·외부 API 변경 없음(제출 어댑터·Slack API 무변경). manifest·privacy.md 영향 없음.
- `removeIssue`가 blob(IndexedDB) 6종을 모두 정리함을 사전 확인(Slack 보존 이슈 삭제가 draft 삭제와 동일 경로여야 함 — 확인됨).
- 데이터 모델은 optional 필드 추가뿐이라 `ISSUES_STORE_VERSION` 변경/마이그레이션 불필요(확인).
- 전제: Slack 제출 시점 blob은 preview 단계 draft autosave로 이미 IndexedDB에 영속화돼 있음(보존이 성립하는 근거).

## 태스크

### Task 1: 순수 판정 함수 + 단위 테스트 (테스트 우선)
- **변경 대상**: `src/sidepanel/tabs/issueListUtils.ts`, `src/sidepanel/tabs/__tests__/issueListUtils.test.ts`
- **작업 내용**:
  - `isSlackPreserved(issue)`, `promotableTargets(accounts)`, `canPromoteSlack(issue, accounts)`, `submittablePlatforms(issue, accounts)`, `resolveInitialPlatform(picked, available)` 구현.
  - `matchesStatus`는 **변경하지 않음**을 테스트로 고정.
- **검증**:
  - [ ] `isSlackPreserved`: submitted+slackPreserved=true → true; draft → false; submitted+플래그없음 → false
  - [ ] `promotableTargets`: accounts에 slack만 → `[]`; slack+jira → `["jira"]`
  - [ ] `canPromoteSlack`: slack 보존 이슈 + 트래커 1개 → true; 트래커 0 → false; 일반 submitted → false
  - [ ] `submittablePlatforms`: slack 보존 이슈 → slack 제외 목록; 일반 draft → connectedPlatforms 전체
  - [ ] `resolveInitialPlatform`: `("slack", ["jira"]) → "jira"`; `("jira", ["jira","github"]) → "jira"`; `(null, []) → "jira"`; `("slack", []) → "jira"`
  - [ ] `matchesStatus(slack보존이슈, "submitted")===true`, `matchesStatus(..., "draft")===false`
  - [ ] `pnpm test` 통과

### Task 2: 데이터 모델 + store 액션 (보존/폐기 분기 단위 고정)
- **변경 대상**: `src/store/issues-store.ts`, `src/store/__tests__/issues-store.test.ts`
- **작업 내용**:
  - `IssueRecord`에 `slackPreserved?: boolean` 추가.
  - `markSlackShared(id, { key, url })` 액션 추가 — status/platform/submittedAt/updatedAt/slackPreserved 세팅, draft·snapshot·styleEdits·blob 참조 유지, **`delete*Blob` 호출 없음**.
  - `stripSubmitted`에 `slackPreserved: undefined` 추가.
- **검증**:
  - [ ] `markSlackShared` 후 레코드: status="submitted", platform="slack", slackPreserved=true, key/url 세팅, draft/snapshot/blob키 유지
  - [ ] **blob 보존 단위 검증**: `delete*Blob`(video/image/network/console/action/attachment)을 `vi.mock` → `markSlackShared`에서 전부 `not.toHaveBeenCalled()`, 대비로 `markSubmitted`에서는 `toHaveBeenCalled()` (state 필드만 보면 실수로 delete가 들어가도 통과하므로 호출 자체를 검증)
  - [ ] `stripSubmitted`(승격) 후: slackPreserved=undefined, draft 비워짐, blob키 undefined
  - [ ] 기존 `markSubmitted`(Slack 외) 동작 회귀 없음
  - [ ] `pnpm test` 통과

### Task 3: i18n 라벨 (UI 태스크보다 선행)
- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**: `issueList.viewDetail`("자세히"/"View details"), `issueList.promote`("트래커로 등록"/"Promote to tracker") ko/en 추가.
- **검증**:
  - [ ] PostToolUse 훅(locales 대칭) 통과
  - [ ] `pnpm test` 통과

### Task 4: 신규 작성 Slack 제출을 보존 경로로 전환
- **변경 대상**: `src/sidepanel/tabs/IssueCreateModal.tsx`
- **작업 내용**: `handleSlackSubmit`의 `markSubmitted(currentIssueId, {platform:"slack",key,url})` → `markSlackShared(currentIssueId, {key,url})`. reset/lastSubmitFields/lastSubmittedPlatform 유지.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (수동) Slack 제출 후 [자세히] 클릭 시 이미지/로그가 남아 표시됨

### Task 5: IssueRow — [자세히]·[승격] 버튼 (본문 클릭 불변)
- **변경 대상**: `src/sidepanel/tabs/IssueRow.tsx`, `src/sidepanel/tabs/IssueListTab.tsx`
- **작업 내용**:
  - IssueRow: `accounts` 구독, `promotable = canPromoteSlack(issue, accounts)`. **`handleCardClick`은 변경하지 않음**(promotable이어도 submitted라 permalink 이동 유지). 우측에 promotable이면 [자세히](lucide `Eye`, `data-testid="view-detail-issue"`, `onOpenDraft`) + [승격](lucide `Send`, `data-testid="promote-issue"`, `onOpenSubmit`) 두 IconButton, 둘 다 `stopPropagation`·`size="icon"`·`h-8 w-8`·`aria-label`+`title`. 아니면 기존 분기. props에 `onOpenSubmit` 추가.
  - IssueListTab: `autoSubmit` 상태 추가, `onOpenDraft`/`onOpenSubmit` 핸들러에서 set, `DraftDetailDialog`에 `autoOpenSubmit` 전달 + 닫힐 때 reset.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (e2e) slack 보존 + 트래커 연결 시 카드 우측 [자세히]·[승격] 버튼(testid) 노출
  - [ ] (e2e) 트래커 0이면 두 버튼 미노출, 기존 Slack 배지 유지
  - [ ] (e2e) promotable 카드 **본문** 클릭 시 `draft-detail-dialog`가 열리지 **않음**(permalink 이동 — 부정 판정)

### Task 6: DraftDetailDialog — Slack 제외 + autoOpenSubmit + initialPlatform 보정
- **변경 대상**: `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**:
  - `available = submittablePlatforms(issue, accounts)`.
  - `initialPlatform = resolveInitialPlatform(pickInitialPlatform(accounts, lastSubmittedPlatform), available)`. `useState` 초기값도 이 값.
  - prop `autoOpenSubmit` 추가 — **prefill effect와 분리된 별도 `useEffect`**(deps `[open, autoOpenSubmit]`), `open && autoOpenSubmit`이면 `setSubmitOpen(true)`. 취소 시 detail 유지(추가 처리 없음).
  - `handleSlackSubmit`의 `markSubmitted` → `markSlackShared(issue.id, {key,url})`.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] (e2e) [승격] 클릭 → 제출 다이얼로그 열림 + Slack 탭 없음
  - [ ] (e2e) [자세히] 클릭 → `draft-detail-dialog` 열림(제출 다이얼로그 자동 오픈 안 함)
  - [ ] (수동) lastSubmittedPlatform=slack인 보존 이슈에서 [승격] 시 초기 탭이 Slack 아닌 첫 트래커
  - [ ] (수동) [승격] 다이얼로그 취소 시 DraftDetailDialog가 남음

## 테스트 계획

- **단위 테스트** (Task 1·2):
  - `isSlackPreserved`/`promotableTargets`/`canPromoteSlack`/`submittablePlatforms`/`resolveInitialPlatform` 분기 전수(특히 `resolveInitialPlatform`의 slack·빈배열 케이스 — 가장 깨지기 쉬운 버그 포인트).
  - `matchesStatus`가 slackPreserved를 submitted로 분류함을 고정.
  - `markSlackShared`가 데이터 보존 + `delete*Blob` 미호출, `stripSubmitted`가 slackPreserved 포함 폐기함을 검증.
- **e2e 시나리오** (`/e2e-write` 입력):
  - Slack + Jira 연결 상태에서 이슈를 Slack 제출하면, 목록 카드 우측에 [자세히](`view-detail-issue`)·[승격](`promote-issue`) 버튼이 보인다.
  - promotable Slack 카드 **본문**을 클릭하면 `draft-detail-dialog`가 열리지 않는다(permalink 새 탭 이동).
  - [자세히] 버튼을 클릭하면 `draft-detail-dialog`가 열린다.
  - [승격] 버튼을 클릭하면 제출 다이얼로그가 열리고 Slack 탭이 없다.
  - Slack 제출 이슈는 submitted 필터에 보이고 draft 필터에는 보이지 않는다.
  - (Slack만 연결) Slack 제출 카드 우측에 [자세히]·[승격]이 없고 Slack 배지가 보인다.
- **수동 테스트** (Chrome):
  - Slack 제출 후 [자세히]→DraftDetailDialog에서 캡처 이미지·영상·로그가 실제로 보존돼 표시되는지(blob 의존, 모든 캡처 모드: element/screenshot/video/freeform).
  - promotable=false(트래커 0) Slack 보존 카드에 `SlackSubmittedBadge`가 정상 표시되는지(현행 Slack 제출이 `result.key`를 실제로 채움 확인).
  - Jira로 승격 후 카드가 일반 Jira submitted로 바뀌고(배지·URL 이동), 다시 [자세히]가 사라지고 원본 데이터/Slack 이력이 폐기됐는지.
  - 트래커 미연결 → 추가 연결 시 같은 카드가 동적으로 [자세히]·[승격] 노출로 전환되는지(본문 클릭 동작은 불변).
  - lastSubmittedPlatform=slack에서 [승격] 시 초기 탭 보정, 승격 다이얼로그 취소 시 detail 유지.
  - 승격 다이얼로그를 연 직후 트래커 연결 해제 시 "연결된 플랫폼 없음" Alert + 제출 버튼 비활성.

## 구현 순서 권장

1. **Task 1 → Task 2** (순수 함수·store, 테스트 우선). 서로 독립이나 Task 5/6이 둘 다 의존.
2. **Task 3** (i18n) — UI 태스크 전에 키를 먼저 확정(aria-label 공백 방지).
3. **Task 4** (신규 Slack 제출 보존) — Task 2 완료 후. 보존 데이터를 만드는 진입점.
4. **Task 5 ∥ Task 6** (UI) — Task 1·2·3 완료 후 병렬 가능. Task 6의 `markSlackShared` 사용은 Task 2 의존.

## 가이드 영향

사용자 노출 UX 변경(Slack 제출 이슈 데이터 보존 + 카드 우측 [자세히]·[승격] 버튼, 본문 클릭은 기존 permalink 유지) → `/guide` 대상.
- `guide/ko`·`guide/en`의 Slack 연동 / 이슈 목록 관련 페이지 — Slack 제출 이슈의 데이터 보존 및 "트래커로 승격" 동작, 동적 전환(트래커 연결 시 버튼 등장)을 명시. 정확한 파일은 `guide/AUTHORING.md` IA 확인 후 `/guide`에서 ko·en 동시 갱신.
