# Issue Dialog Decompose — 구현 태스크

## 선행 조건

- 작업 시작 전 `git status` 깨끗 확인 (다른 변경 없는 상태에서 시작).
- 환경: `pnpm typecheck` 통과 상태에서 출발.
- 권한·env·OAuth·외부 API 변경 없음 (순수 모듈 이동).
- 작업 단위가 큰 편이라 1 태스크 끝낼 때마다 `pnpm typecheck`로 회귀 즉시 감지.

## 태스크

### Task 1: `FieldRow` 공용 위치로 이동

- **변경 대상**:
  - 신설: `src/sidepanel/components/FieldRow.tsx`
  - 수정: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/githubFields/GithubIssueFields.tsx`, 그 외 FieldRow를 import하는 모든 파일
- **작업 내용**:
  - IssueCreateModal.tsx:878-896의 `FieldRow` export를 신설 파일로 그대로 이동 (시그니처 변경 없음).
  - IssueCreateModal.tsx에서 정의 제거.
  - `grep -rn 'from "@/sidepanel/tabs/IssueCreateModal"' src/`로 FieldRow import 사용처 전수 조사.
  - 발견된 모든 import를 `from "@/sidepanel/components/FieldRow"`로 갱신.
- **검증**:
  - [ ] `grep -rn 'FieldRow' src/sidepanel/tabs/IssueCreateModal.tsx`에 export·정의 없음.
  - [ ] `grep -rn 'from "@/sidepanel/tabs/IssueCreateModal"' src/sidepanel/tabs/githubFields/ src/sidepanel/tabs/linearFields/ src/sidepanel/tabs/notionFields/`에서 FieldRow 관련 매칭 0개. (사전 검증: 작업 직전 동일 명령 결과는 `GithubIssueFields.tsx`·`LinearIssueFields.tsx`·`NotionIssueFields.tsx` 3개 파일에서 FieldRow import 1개씩 — Task 4에서 `SubmitFieldsDialog` import가 따로 옮겨지므로 이 grep은 FieldRow 한 가지 import만 노리는 것.)
  - [ ] `pnpm typecheck` 통과.

### Task 2: IssueListTab을 statusBadges/ + IssueRow + issueListUtils로 분해

> Task 1과 독립. 병렬 진행 가능.

- **변경 대상**:
  - 신설: `src/sidepanel/tabs/statusBadges/{constants,PlatformChip,GithubStatusBadge,JiraStatusBadge,LinearStatusBadge,NotionStatusBadge,SubmittedBadge}.tsx` 7개
  - 신설: `src/sidepanel/tabs/IssueRow.tsx`
  - 신설: `src/sidepanel/tabs/issueListUtils.ts`
  - 수정: `src/sidepanel/tabs/IssueListTab.tsx`
- **작업 내용**:
  - `statusBadges/constants.ts`에 `STATUS_CATEGORY_COLORS`·`LINEAR_STATE_TYPE_COLORS`·`LINEAR_STATE_I18N` 이동 (IssueListTab.tsx:440-478).
  - 4 status badge 컴포넌트를 각자 파일로 이동. `GithubBadgeStatus`·`GithubTargetState` 타입과 `toGithubTargetState` 헬퍼는 `GithubStatusBadge.tsx`에 동봉.
  - `PlatformChip.tsx`로 PlatformChip 이동 (IssueListTab.tsx:481-513).
  - `SubmittedBadge.tsx`로 SubmittedBadge 이동 (IssueListTab.tsx:971-1264). 내부에서 4 StatusBadge import.
  - `IssueRow.tsx`로 IssueRow 이동 (IssueListTab.tsx:323-438). 내부에서 `./statusBadges/SubmittedBadge`·`./statusBadges/PlatformChip`·`./issueListUtils` import.
  - `issueListUtils.ts`에 순수 헬퍼 이동 (design.md "신설 파일" 표 참조).
  - IssueListTab.tsx 본체에 남는 것: imports, `IssueListTab` 컴포넌트 함수 본문만.
  - **IssueRow.tsx에 `Trash2` import 명시**: draft 카드는 SubmittedBadge 대신 Trash2 IconButton + 삭제 확인 AlertDialog를 렌더하므로(`IssueListTab.tsx` 405-432), IssueRow가 `lucide-react`에서 Trash2를 직접 import해야 한다. statusBadges/에 묶지 말 것 — 휴지통은 status가 아니라 row 액션.
- **검증**:
  - [ ] `wc -l src/sidepanel/tabs/IssueListTab.tsx` < 400줄.
  - [ ] `wc -l src/sidepanel/tabs/statusBadges/SubmittedBadge.tsx` < 350줄 (가장 큰 단일 파일).
  - [ ] `pnpm typecheck` 통과.
  - [ ] 수동: IssueListTab 열어 4 플랫폼 submitted 카드 각각의 status badge 렌더 + popover 옵션 클릭 → 상태 갱신.
  - [ ] 수동: draft 카드의 Trash2 버튼 → 확인 AlertDialog → 삭제 동작.
  - [ ] 수동: 빈 검색 결과 → "필터 리셋" 버튼 동작.
  - [ ] 수동: 1 플랫폼만 connected / 0 플랫폼 connected 상태에서 status badge 분기가 깨지지 않음.

### Task 3: jiraFields/ 디렉터리 신설 + Jira 필드 이동

> Task 1 완료 후 진행 (FieldRow import 경로 의존).

- **변경 대상**:
  - 신설: `src/sidepanel/tabs/jiraFields/{JiraIssueFields,IssueTypeField,PriorityField,AssigneeField,EpicField,FieldCombobox}.tsx`, `src/sidepanel/tabs/jiraFields/{useDebouncedSearch,useJiraConfig}.ts`
  - 수정: `src/sidepanel/tabs/IssueCreateModal.tsx`
- **작업 내용**:
  - design.md "신설 파일" 표대로 8개 파일 신설. 시그니처·동작 변경 없음.
  - `JiraIssueFields.tsx`는 기존 `JiraFieldsBlock` 함수를 동일한 props (`{ fields: EditorIssueFields; onChange: (patch: Partial<EditorIssueFields>) => void }`)로 export. 이름 `JiraIssueFields`로 통일 (다른 3종과 일관). **`initialJiraFields` 헬퍼는 만들지 않는다** — jira fields는 `useEditorStore`의 `issueFields` state를 직접 호스트가 들고 hook 없이 props로 SubmitFieldsDialog에 전달 (기존 동작 동일).
  - 각 콤보 컴포넌트에서 FieldRow import는 `@/sidepanel/components/FieldRow`로 (Task 1 결과).
  - IssueCreateModal.tsx에서 829-1349 (JiraFieldsBlock + 5개 콤보 + FieldCombobox + 2 hook) 제거.
  - IssueCreateModal.tsx에 `import { JiraIssueFields } from "./jiraFields/JiraIssueFields"` 추가 (이 시점에는 IssueCreateModal에서 jira 분기에 JiraIssueFields를 직접 호출하지 않음 — 호출처는 Task 4의 SubmitFieldsDialog. 다만 import는 일단 남아 있어도 무해. Task 4에서 사용처 갱신).
- **검증**:
  - [ ] `ls src/sidepanel/tabs/jiraFields/`에 8개 파일.
  - [ ] `src/sidepanel/tabs/jiraFields/` 구성이 `githubFields/`·`linearFields/`·`notionFields/`와 동등 (XxxIssueFields.tsx 입구 + sub 컴포넌트).
  - [ ] `pnpm typecheck` 통과.
  - [ ] 수동: IssueCreateModal 열어 Jira Tab에서 IssueType/Assignee/Priority/Epic/Linked Issue 콤보 동작 동일.

### Task 4: SubmitFieldsDialog.tsx 분리

> Task 3 완료 후 진행 (jiraFields/JiraIssueFields import 필요).

- **변경 대상**:
  - 신설: `src/sidepanel/tabs/SubmitFieldsDialog.tsx`
  - 수정: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**:
  - IssueCreateModal.tsx:641-827의 `SubmitFieldsDialogProps` interface와 `SubmitFieldsDialog` 컴포넌트를 그대로 신설 파일로 이동.
  - `import { JiraIssueFields } from "./jiraFields/JiraIssueFields"`로 jira 분기 교체. (기존: 인라인 `JiraFieldsBlock` 호출)
  - IssueCreateModal.tsx의 import에 `./SubmitFieldsDialog`에서 SubmitFieldsDialog 가져오기.
  - DraftDetailDialog.tsx의 `import { SubmitFieldsDialog } from "./IssueCreateModal"` → `from "./SubmitFieldsDialog"`로 변경.
- **검증**:
  - [ ] `grep -n 'SubmitFieldsDialog' src/sidepanel/tabs/IssueCreateModal.tsx`에 정의·export 없음 (호출/import만).
  - [ ] `grep -rn 'from "./IssueCreateModal"' src/sidepanel/tabs/`에 결과 없음 (DraftDetailDialog의 import 완전 해소).
  - [ ] `pnpm typecheck` 통과.
  - [ ] 수동: IssueCreateModal 진입 + DraftDetailDialog → 제출 양쪽에서 SubmitFieldsDialog 동작 동일.

### Task 5: usePlatformFields hook 신설 + 두 호스트 갱신

> Task 1·3·4 완료 후 진행.

- **변경 대상**:
  - 신설: `src/sidepanel/hooks/usePlatformFields.ts`
  - 수정: `src/sidepanel/tabs/IssueCreateModal.tsx`, `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **작업 내용**:
  - design.md "인터페이스 설계 — usePlatformFields hook" 시그니처대로 구현.
  - 내부에서 `initialGhFields`·`initialLinearFields`·`initialNotionFields` import (각 fields 디렉터리에서).
  - 3쌍의 `useState` + `useEffect` + `setXxxFields` 패치 헬퍼를 hook 안에 통합.
  - effect deps: `[input.open, input.lastGhSubmit, input.ghDefaults, input.lastLinearSubmit, input.linearDefaults, input.lastNotionSubmit, input.notionDefaults, input.resetKey]`.
  - IssueCreateModal.tsx:132-170의 3쌍 코드 제거 → `usePlatformFields({ open, lastGhSubmit, ghDefaults: ghAccount?.defaults, lastLinearSubmit, linearDefaults: linearAccount?.defaults, lastNotionSubmit, notionDefaults: notionAccount?.defaults })` 한 줄로 대체.
  - DraftDetailDialog.tsx:132-157의 3쌍 코드 제거 → `usePlatformFields({ open, ...same, resetKey: issue?.id })` 한 줄로 대체.
  - DraftDetailDialog.tsx의 164-185 useEffect 안에서 `setGhFieldsState`·`setLinearFieldsState`·`setNotionFieldsState` 3줄 제거. 나머지(`setFields(base)` jira, `setPlatform(initial)`, `setSubmitOpen(false)`)는 보존. `// eslint-disable-next-line react-hooks/exhaustive-deps` 주석·이유 코멘트도 보존.
- **검증**:
  - [ ] `grep -n 'initialGhFields\|initialLinearFields\|initialNotionFields' src/sidepanel/tabs/IssueCreateModal.tsx src/sidepanel/tabs/DraftDetailDialog.tsx` 결과 없음 (hook 안으로 이동).
  - [ ] `grep -n 'setGhFieldsState\|setLinearFieldsState\|setNotionFieldsState' src/sidepanel/tabs/IssueCreateModal.tsx src/sidepanel/tabs/DraftDetailDialog.tsx` 결과 없음.
  - [ ] `pnpm typecheck` 통과.
  - [ ] 수동: IssueCreateModal과 DraftDetailDialog 각각에서 4 플랫폼 fields 초기화·patch 동작 동일.

### Task 6: issueListUtils 단위 테스트 추가

> Task 2 완료 후 진행.

- **변경 대상**:
  - 신설: `src/sidepanel/tabs/__tests__/issueListUtils.test.ts`
- **작업 내용**: 다음 순수 함수에 대해 케이스별 테스트.
  - `parseGithubIssueUrl` (4 케이스): 정상 URL, hostname 비정상, pathname 형식 비정상, undefined.
  - `parseGithubIssueNumber` (4 케이스): `"#42"` / `"42"` / `"BUG-1"` / undefined.
  - `resolveGithubCoords` (5 케이스): (a) githubOwner/githubRepo 모두 있고 key/url도 정상, (b) record는 owner/repo 없지만 URL fallback 성공, (c) record key는 비어있지만 URL에 number 있어 fallback, (d) owner는 있지만 number 부족, (e) 셋 다 부족 → null.
  - `resolveNotionPageId` (3 케이스): notionPageId 직접 있을 때 / URL fallback / 둘 다 없을 때 null.
  - `matchesQuery` (5 케이스): title 매칭, pageUrl 매칭, key 매칭, 대소문자 무관, 빈 쿼리.
  - `matchesStatus` (3 케이스): "all" / "submitted" / "draft" 분기.
  - `isRefreshable` (12+ 케이스): 4 플랫폼 × (정상 / status≠submitted / url-or-key 누락 / platform별 메타 누락) = 16 케이스 권장. 특히 github의 coords URL fallback 성공 케이스, notion의 URL fallback 성공 케이스 포함.
- **검증**:
  - [ ] `pnpm test src/sidepanel/tabs/__tests__/issueListUtils.test.ts` 통과.
  - [ ] 총 케이스 수 ≥ 50개.
  - [ ] 각 함수의 분기 커버리지 100% (분기 없는 함수 제외).

### Task 7: 최종 회귀 검증

- **변경 대상**: 없음 (검증 전용).
- **작업 내용**:
  - `pnpm typecheck` 최종 실행 — 0 에러.
  - `pnpm test` 전체 실행 — 기존 테스트 + Task 6 통과.
  - `grep -rn 'from "@/sidepanel/tabs/IssueCreateModal"' src/`로 잔존 import 0 확인 (Task 1·3·4 결과 합산).
  - Chrome 확장 로드 후 수동 시나리오 (각 플랫폼 1회씩):
    - Jira: 새 이슈 작성 → 제출 → IssueListTab에서 status badge popover로 transition.
    - GitHub: 드래프트 만들기 → DraftDetailDialog 통한 제출 → IssueListTab에서 open/closed 전환.
    - Linear: 새 이슈 작성 → 제출 → workflow state 전환.
    - Notion: 새 이슈 작성 → 제출 → status option 전환.
  - DraftDetailDialog 진입 → SubmitFieldsDialog 열기 → 4 플랫폼 Tab 전환 시 다이얼로그 강제 닫힘 없음 확인.
  - IssueListTab refresh 버튼 race 시나리오:
    - 한 issue의 fetch가 의도적으로 실패하게(network throttle 또는 잘못된 URL) 만들고 refresh — 다른 issue들 fetch가 모두 완료되어도 spinner가 적절히 해제되는지.
    - refresh 진행 중 새 이슈를 제출했을 때(`refreshableCount` 변경) spinner가 stuck하지 않는지.
  - `usePlatformFields` hook 회귀 시나리오:
    - DraftDetailDialog에서 draft A 열기 → ghFields 일부 입력 → draft B로 전환 (issue?.id 변경) → ghFields가 B의 initial로 리셋되는지.
    - IssueCreateModal에서 다이얼로그 열기 → ghFields 입력 → 닫고 다시 열기 → 다이얼로그 reopen 시 initial로 리셋되는지.
    - DraftDetailDialog에서 SubmitFieldsDialog Tab을 GitHub → Linear → Notion → Jira 순으로 4번 전환 — 다이얼로그 강제 닫힘 없고, 각 platform fields가 보존되는지.
- **검증**:
  - [ ] `pnpm typecheck` 0 에러.
  - [ ] `pnpm test` 0 실패.
  - [ ] 4 플랫폼 수동 회귀 모두 통과.
  - [ ] DraftDetailDialog Tab 전환 강제 닫힘 없음 확인.
  - [ ] refresh race 시나리오 통과.
  - [ ] `usePlatformFields` hook 회귀 시나리오 통과.

## 테스트 계획

### 단위 테스트 (Task 6)

- `issueListUtils.test.ts` — 순수 헬퍼 7종.
- `usePlatformFields`는 hook이라 단위 테스트 도입 비용 큼. 수동 회귀로 갈음.
- 기존 테스트(`tabs/{github,linear,notion}Fields/__tests__/*`)는 그대로 유지·통과.

### 수동 테스트 시나리오 체크리스트 (Task 7)

- [ ] IssueListTab: 필터 all/submitted/draft 전환 동작.
- [ ] IssueListTab: 검색 input에 title/url/key 키워드 입력 → 매칭 row.
- [ ] IssueListTab: 4 플랫폼 status badge 클릭 → popover 표시 → 옵션 클릭 → 상태 변경 → badge 갱신.
- [ ] IssueListTab: 드래프트 카드 휴지통 → 확인 다이얼로그 → 삭제.
- [ ] IssueListTab: 전체 삭제 버튼.
- [ ] IssueListTab: refresh 버튼 → 4 플랫폼 모두 fetch 후 갱신.
- [ ] IssueCreateModal: 트리거 → 4 Tab 노출 (연결된 것만) → 각 Tab의 필드 입력 → 제출.
- [ ] IssueCreateModal Jira Tab: IssueType/Assignee/Priority/Epic/LinkedIssue 콤보 검색·선택·해제.
- [ ] DraftDetailDialog: 드래프트 카드 클릭 → 다이얼로그 열림 → 본문·미디어 렌더.
- [ ] DraftDetailDialog: 제출 버튼 → SubmitFieldsDialog 열림 → Tab 전환 (다이얼로그 닫힘 없음 확인) → 제출.
- [ ] 4 플랫폼 인증 미연결 상태에서 다이얼로그 정상 처리 (Tab 숨김 또는 disable).

## 구현 순서 권장

```
Task 1 (FieldRow 이동)
   │
   ├─→ Task 2 (statusBadges/IssueRow/issueListUtils)  ── 병렬 가능
   │      │
   │      └─→ Task 6 (issueListUtils 테스트)
   │
   └─→ Task 3 (jiraFields/)
          │
          └─→ Task 4 (SubmitFieldsDialog.tsx)
                 │
                 └─→ Task 5 (usePlatformFields hook)
                        │
                        └─→ Task 7 (최종 회귀)
```

- Task 2와 Task 3은 독립. 한 사람이 한다면 1→2→3→4→5→6→7 직렬, 두 사람이면 [1→3→4→5] / [2→6] 두 트랙 후 7에서 합류.
- Task 1과 Task 2는 IssueCreateModal·IssueListTab을 동시에 건드리지 않으므로 순서 무관.
- Task 5(`usePlatformFields`)는 Task 4까지의 import 정리가 끝난 뒤가 가장 안전 — 두 호스트 모두 안정된 상태에서 hook 교체.
