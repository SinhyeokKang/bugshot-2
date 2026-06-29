# Slack 제출 이슈 승격 — 기술 설계

## 개요

Slack 제출 경로(신규 작성·draft 재제출 **양쪽**)를 데이터 보존 함수(`markSlackShared`)로 분기해 draft 콘텐츠·blob을 폐기하지 않고 `status:"submitted"`로 전환하되, `slackPreserved` 플래그를 세운다. 이 플래그가 켜졌고 **현재 Slack 제외 연결 플랫폼이 1개 이상**인 이슈(`canPromoteSlack`)는 카드 우측에 [자세히]·[승격] 두 IconButton을 노출한다 — [자세히]는 `DraftDetailDialog`(원본 확인), [승격]은 `DraftDetailDialog`를 `autoOpenSubmit`로 열어 Slack 제외 제출 다이얼로그까지 스택. **카드 본문 클릭 동작(permalink 이동)은 일절 변경하지 않는다.** 일반 트래커 승격 시 `stripSubmitted`가 보존 데이터·플래그까지 모두 지워 일반 submitted로 강등(=동격)한다. 식별/판정 로직은 순수 함수로 추출해 단위 테스트한다.

## 변경 범위

### `src/store/issues-store.ts`
- **현재 역할**: `IssueRecord` 타입, `IssueStatus`, `stripSubmitted`, `markSubmitted`, `saveDraft`, `removeIssue` 등 이슈 영속 store.
- **변경**:
  - `IssueRecord`에 `slackPreserved?: boolean` 필드 추가(submitted이면서 데이터 보존된 Slack 이슈 식별용).
  - 새 액션 `markSlackShared(id, patch: { key: string; url: string })` 추가 — `status:"submitted"`, `platform:"slack"`, `submittedAt`, `updatedAt`, `slackPreserved:true`를 세팅하되 `draft`/`snapshot`/`styleEdits`/blob 참조를 **그대로 유지**하고 **`delete*Blob` 호출을 일절 하지 않는다**(보존이 핵심 — `markSubmitted`와 정반대).
  - `stripSubmitted`에 `slackPreserved: undefined` 추가 — 일반 트래커 승격 시 Slack 보존 플래그까지 제거(목표 6).
  - `ISSUES_STORE_VERSION` **변경 없음**: 신규 optional 필드라 비파괴(검증됨 — `migrate`가 미지 필드를 strip 안 하고 `partialize` 부재, 기존 optional 필드 `bufferedElements` 등 선례). 기존 레코드는 `slackPreserved` 부재 = `false` 취급.

### `src/sidepanel/tabs/issueListUtils.ts`
- **현재 역할**: `matchesStatus`, `matchesQuery`, `StatusFilter`, 날짜·키 포맷 등 목록 순수 유틸.
- **변경**: 아래 순수 함수 추가(테스트 우선 작성). 위치는 **`issueListUtils.ts`로 확정**(함수가 얇아 파일 증식 회피). `matchesStatus`는 **변경 없음**(slackPreserved도 status="submitted"라 submitted 필터로 자동 처리 — 목표 2/6).
  - `isSlackPreserved(issue)` — `issue.status === "submitted" && !!issue.slackPreserved`.
  - `promotableTargets(accounts)` — `connectedPlatforms(accounts).filter(p => p !== "slack")`.
  - `canPromoteSlack(issue, accounts)` — `isSlackPreserved(issue) && promotableTargets(accounts).length > 0`. ([자세히]·[승격] 동시 노출 조건)
  - `submittablePlatforms(issue, accounts)` — `isSlackPreserved(issue) ? promotableTargets(accounts) : connectedPlatforms(accounts)`. (DraftDetailDialog `available` 계산용; Slack 보존 이슈는 Slack 탭 제외)
  - `resolveInitialPlatform(picked, available)` — `picked && available.includes(picked) ? picked : (available[0] ?? "jira")`. 빈 `available`까지 방어(일반 draft가 연결 0개로 열릴 수 있음). `pickInitialPlatform` 결과를 `available`로 보정하는 순수 함수.

### `src/sidepanel/tabs/IssueRow.tsx`
- **현재 역할**: 개별 카드. `isSubmitted = status==="submitted" && !!url` → 본문 클릭 시 permalink 이동, 우측 `SubmittedBadge`. draft면 `onOpenDraft` + Trash.
- **변경**:
  - `accounts`(`useSettingsStore`) 구독, `promotable = canPromoteSlack(issue, accounts)` 계산.
  - **`handleCardClick`은 변경하지 않는다** — promotable이어도 submitted라 기존대로 permalink 이동(목표 4). 카드 본문 동작 불변.
  - 우측 렌더 분기 추가(최우선): `promotable`이면 `<span onClick=stopPropagation>` 안에 **[자세히](`Eye`, `onClick`→`onOpenDraft`) + [승격](`Send`, `onClick`→`onOpenSubmit`)** 두 IconButton. 아니면 기존(`isSubmitted && key`→`SubmittedBadge` / 그 외→Trash) 유지.
  - 두 버튼 모두 기존 행 액션 컨벤션: `variant="outline" size="icon"` `h-8 w-8 shrink-0`, `aria-label` + `title`(툴팁). aria-label: `t("issueList.viewDetail")` / `t("issueList.promote")`.
  - props에 `onOpenSubmit: () => void` 추가.

### `src/sidepanel/tabs/IssueListTab.tsx`
- **현재 역할**: 목록·필터·`draftId` 상태로 `DraftDetailDialog` 제어.
- **변경**:
  - `autoSubmit` 상태(boolean) 추가.
  - `IssueRow`에 `onOpenDraft={() => { setDraftId(issue.id); setAutoSubmit(false); }}`, `onOpenSubmit={() => { setDraftId(issue.id); setAutoSubmit(true); }}` 전달.
  - `DraftDetailDialog`에 `autoOpenSubmit={autoSubmit}` 전달. `onOpenChange`로 닫힐 때 `setDraftId(null)` + `setAutoSubmit(false)`.

### `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **현재 역할**: draft 상세 표시 + 내부 삭제/제출 버튼 + `SubmitFieldsDialog` 내장. `available = connectedPlatforms(accounts)`, `markSubmitted`로 제출 확정.
- **변경**:
  - prop `autoOpenSubmit?: boolean` 추가. **기존 prefill effect(177-180행 주석 트랩)와 분리된 별도 `useEffect`**로 구현 — deps `[open, autoOpenSubmit]`, `open && autoOpenSubmit`이면 `setSubmitOpen(true)`. (prefill effect deps를 건드리면 "Tab 전환 시 다이얼로그 닫힘" 회귀 트랩에 근접하므로 재사용 금지.)
  - **취소 동작**: `SubmitFieldsDialog`의 `onOpenChange(false)`(취소)는 `setSubmitOpen(false)`만 — 뒤의 `DraftDetailDialog`는 **유지**(결정사항). 별도 처리 불필요(현재 동작이 이미 그러함).
  - `available`을 `submittablePlatforms(issue, accounts)`로 교체(Slack 보존 이슈면 Slack 제외).
  - `initialPlatform`을 `resolveInitialPlatform(pickInitialPlatform(accounts, lastSubmittedPlatform), available)`로 교체 — Slack 또는 미연결 플랫폼이 초기값으로 잡혀 깨지는 것 방어. `useState<PlatformId>(initialPlatform)` 초기화도 이 값 사용.
  - `handleSlackSubmit`의 `markSubmitted(...)` 호출을 `markSlackShared(issue.id, { key: result.key, url: result.url })`로 교체(일반 draft를 Slack으로 제출하는 경로도 보존 — 목표 1 전역 적용).
  - 삭제 버튼(`handleDelete`→`removeIssue`)은 그대로. Slack 보존 이슈 삭제 경로는 이 다이얼로그 내부 삭제 버튼이 유일(결정사항). `removeIssue`가 6종 blob 모두 정리함을 확인(issues-store).

### `src/sidepanel/tabs/IssueCreateModal.tsx`
- **현재 역할**: 신규 작성 플로우의 제출. `handleSlackSubmit`(~517줄)에서 `markSubmitted(currentIssueId, { platform:"slack", key, url })` 호출.
- **변경**: `handleSlackSubmit`의 `markSubmitted(...)`를 `markSlackShared(currentIssueId, { key, url })`로 교체. 나머지(editor reset, `setLastSubmitFields`, `setLastSubmittedPlatform`)는 유지. editor `reset()`은 `set({...initial})`만 수행하고 blob을 삭제하지 않으므로(검증됨, editor-store:951) 보존 데이터 안전.

### `src/i18n/ko.ts` / `src/i18n/en.ts`
- **변경**: [자세히]·[승격] 버튼 라벨 키 추가 — `issueList.viewDetail`("자세히"/"View details"), `issueList.promote`("트래커로 등록"/"Promote to tracker"). ko/en 동시 갱신(PostToolUse 훅 검사). **IssueRow(Task 4)보다 먼저 또는 함께** 추가해 키 부재로 aria-label이 비지 않게 한다.

## 데이터 흐름

```
[신규 작성 → Slack 제출]               [저장된 draft → Slack 제출]
 IssueCreateModal.handleSlackSubmit     DraftDetailDialog.handleSlackSubmit
   ※ 전제: 이 시점 blob은 preview          ※ 동일
     단계 draft autosave로 이미
     IndexedDB에 영속화돼 있음
   → submitToSlack(...)                  (Slack API, 변경 없음)
   → markSlackShared(id, {key,url})      ★ stripSubmitted/blob삭제 안 함, slackPreserved=true
   → editor reset()                      (set({...initial}), blob 삭제 없음)

[이슈 목록 카드 렌더]
 IssueRow
   handleCardClick: 변경 없음 → submitted면 permalink 새 탭 이동 (promotable이어도 동일)
   promotable = canPromoteSlack(issue, accounts)   // 현재 연결 상태 동적
   ├─ promotable=true: 우측에 [자세히 Eye → onOpenDraft] [승격 Send → onOpenSubmit]
   │    onOpenDraft  → DraftDetailDialog (autoOpenSubmit=false)
   │    onOpenSubmit → DraftDetailDialog (autoOpenSubmit=true) → SubmitFieldsDialog 스택
   └─ promotable=false: 기존 (submitted+key→SubmittedBadge / draft→Trash)

[DraftDetailDialog 제출 (승격)]
 available = submittablePlatforms(issue, accounts)            // Slack 제외
 initialPlatform = resolveInitialPlatform(picked, available)  // Slack/미연결 보정
 platform=Jira 등 선택 → handleJiraSubmit 등
   → markSubmitted → stripSubmitted   // draft/blob/slackPreserved 전부 폐기 → 일반 submitted
 (제출 다이얼로그 취소 → setSubmitOpen(false), DraftDetailDialog 유지)
```

## 인터페이스 설계

```typescript
// src/store/issues-store.ts
export interface IssueRecord {
  // ... 기존 필드
  slackPreserved?: boolean; // submitted + Slack 공유로 원본 데이터를 보존 중인 이슈
}

interface IssuesStore {
  // ... 기존 액션
  markSlackShared: (id: string, patch: { key: string; url: string }) => void;
}

// src/sidepanel/tabs/issueListUtils.ts
export function isSlackPreserved(issue: IssueRecord): boolean;
export function promotableTargets(accounts: Accounts): PlatformId[];
export function canPromoteSlack(issue: IssueRecord, accounts: Accounts): boolean;
export function submittablePlatforms(issue: IssueRecord, accounts: Accounts): PlatformId[];
export function resolveInitialPlatform(
  picked: PlatformId | null,
  available: PlatformId[],
): PlatformId;

// src/sidepanel/tabs/IssueRow.tsx
function IssueRow(props: {
  issue: IssueRecord;
  refreshKey: number;
  onOpenDraft: () => void;     // [자세히]
  onOpenSubmit: () => void;    // ★ 추가 [승격]
  onBadgeLoaded: () => void;
}): JSX.Element;

// src/sidepanel/tabs/DraftDetailDialog.tsx
function DraftDetailDialog(props: {
  issue: IssueRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitSuccess?: (result: NormalizedSubmitResult) => void;
  autoOpenSubmit?: boolean;   // ★ 추가
}): JSX.Element;
```

## 기존 패턴 준수

- **세션 영속화**: `IssueRecord`는 zustand `persist`(`chromeLocalStorage`)로 저장. optional 필드 추가는 비파괴적 — 기존 레코드는 `undefined`로 읽혀 안전. `ISSUES_STORE_VERSION` 변경 불필요.
- **blob 분리 저장**: 이미지/영상/로그/첨부는 IndexedDB(`blob-db`). 제출 시점 blob은 preview 단계 draft autosave로 이미 영속화됨(`markSubmitted`가 제출 후 blob을 지운다는 사실이 방증). `markSlackShared`는 `delete*Blob`을 호출하지 않아 보존. `removeIssue`/rehydrate `pruneOrphanBlobs`로 정리되므로 누수 없음.
- **순수 함수 + 단위 테스트**: 식별·판정·초기 플랫폼 보정 로직을 컴포넌트에서 분리해 `__tests__/*.test.ts`로 검증(CLAUDE.md 테스트 우선).
- **i18n 동시 갱신**: 새 라벨 키는 ko/en 양쪽 추가(PostToolUse 훅 검사).
- **어댑터 무변경**: `submitToSlack`/`submitToJira` 등 제출 어댑터는 손대지 않음 — 차이는 store 전환 함수에서만.

## 대안 검토

1. **`slackPreserved` 플래그 vs draft 데이터 존재 여부로 암묵 판정**
   - 채택: 명시적 boolean 필드. 의도가 분명하고, 빈 draft를 Slack 공유한 우연한 상태와 충돌하지 않는다.
2. **`markSubmitted`에 `preserve` 옵션 추가 vs 별도 `markSlackShared`**
   - 채택: 별도 함수. `markSubmitted`는 "데이터 폐기"가 본질이라 옵션으로 정반대 동작을 섞으면 실수 위험.
3. **[승격]을 IssueRow에서 `SubmitFieldsDialog` 직접 열기 vs DraftDetailDialog 경유(autoOpenSubmit)**
   - 채택: DraftDetailDialog 경유. `SubmitFieldsDialog`는 8개 플랫폼 필드 상태·prefill·핸들러를 요구하는데(ARCHITECTURE "SubmitFieldsDialog 공유" 항목) 이 로직이 DraftDetailDialog에 이미 있다. IssueRow에서 직접 열면 전부 복제해야 해 변경량·중복이 크다. `autoOpenSubmit` 한 prop으로 재사용. 취소 시 detail이 남는 건 결정사항(원본 계속 확인 가능)이며 [자세히] 진입과도 일관된다.
4. **카드 본문 클릭으로 DraftDetailDialog 열기 vs permalink 이동 유지 + [자세히] 버튼**
   - 채택: permalink 이동 유지 + [자세히] 버튼. 본문 클릭 동작을 promotable 여부로 분기하면(이전 안) Slack-only→트래커 연결 시 동작이 조용히 바뀌어 발견성·예측성이 나빠진다. 본문 동작을 불변으로 두고 신규 기능을 버튼으로 명시 노출하는 편이 회귀·혼란이 적다.

## 위험 요소

- **`initialPlatform`이 Slack/미연결로 잡히는 버그**: `lastSubmittedPlatform === "slack"`이면 `pickInitialPlatform`이 Slack 반환, 또는 일반 draft를 연결 0개로 열면 빈 `available`. `resolveInitialPlatform`이 둘 다 방어(`available.includes` 체크 + `?? "jira"`). 단위 테스트로 고정.
- **autoOpenSubmit effect 분리**: prefill effect(177-180행 주석 트랩 — `issue.platform`을 deps에 넣으면 Tab 전환 시 닫힘)와 **반드시 분리**된 effect로 구현. deps `[open, autoOpenSubmit]`.
- **승격 시 플래그 잔존**: `stripSubmitted`에 `slackPreserved: undefined`를 빠뜨리면 Jira 승격 후에도 카드가 Slack 보존으로 오인된다. 단위 테스트로 고정.
- **blob 보존 누수/누적**: `markSlackShared`에 실수로 `delete*Blob`이 들어가면 보존이 깨진다 — 단위 테스트에서 `delete*Blob` 모킹 후 `not.toHaveBeenCalled()`로 고정. 누적 측면은 PRD 위험 참조(steady-state 증가, 정리는 비목표).
- **`IssueRow`의 `accounts` 구독 → 리렌더**: 동적 판정(`canPromoteSlack`)을 위해 `useSettingsStore`의 `accounts`를 구독하므로 설정 변경 시 전 행 리렌더. 현재 목록 규모에선 수용 가능(미세 비용).
- **동적 판정 일관성**: `canPromoteSlack`이 렌더 시점 `accounts` 기준이라, 승격 다이얼로그를 연 도중 연결 해제되면 `submittablePlatforms`가 `[]` → `available.length===0` 안내 Alert + 제출 버튼 비활성으로 가드.
