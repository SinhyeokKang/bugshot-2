# Slack 제출 이슈 승격 — 기술 설계

## 개요

Slack 제출 경로만 데이터 보존 함수(`markSlackShared`)로 분기해 draft 콘텐츠·blob을 폐기하지 않고 `status:"submitted"`로 전환하되, `slackPreserved` 플래그를 세운다. 이 플래그가 켜진 이슈는 (a) 카드 클릭 시 `DraftDetailDialog`로, (b) 카드 우측에 Upload 제출 버튼으로, (c) 제출 다이얼로그에서 Slack 탭 제외로 동작한다 — 단, "현재 연결된 Slack 제외 플랫폼이 1개 이상"일 때만. 일반 트래커 승격 시 `stripSubmitted`가 보존 데이터·플래그까지 모두 지워 일반 submitted로 강등(=동격)한다. 식별/판정 로직은 순수 함수로 추출해 단위 테스트한다.

## 변경 범위

### `src/store/issues-store.ts`
- **현재 역할**: `IssueRecord` 타입, `IssueStatus`, `stripSubmitted`, `markSubmitted`, `saveDraft`, `removeIssue` 등 이슈 영속 store.
- **변경**:
  - `IssueRecord`에 `slackPreserved?: boolean` 필드 추가(submitted이면서 데이터 보존된 Slack 이슈 식별용).
  - 새 액션 `markSlackShared(id, patch: { key: string; url: string })` 추가 — `status:"submitted"`, `platform:"slack"`, `submittedAt`, `updatedAt`, `slackPreserved:true`를 세팅하되 `draft`/`snapshot`/`styleEdits`/blob 참조를 **그대로 유지**하고 blob 삭제 호출을 하지 않는다.
  - `stripSubmitted`에 `slackPreserved: undefined` 추가 — 일반 트래커 승격 시 Slack 보존 플래그까지 제거(목표 6).
  - `ISSUES_STORE_VERSION` 유지 가능: 신규 optional 필드라 마이그레이션 불필요(기존 레코드는 `slackPreserved` 부재 = `false` 취급). **버전 변경 없음**.

### `src/sidepanel/tabs/issueListUtils.ts` (또는 신규 `slackPromotion.ts`)
- **현재 역할**: `matchesStatus`, `matchesQuery`, `StatusFilter`, 날짜·키 포맷 등 목록 순수 유틸.
- **변경**: 아래 순수 함수 추가(테스트 우선 작성). `matchesStatus`는 **변경 없음**(slackPreserved도 status="submitted"라 submitted 필터로 자동 처리 — 목표 2/6).
  - `isSlackPreserved(issue)` — `issue.status === "submitted" && !!issue.slackPreserved`.
  - `promotableTargets(accounts)` — `connectedPlatforms(accounts).filter(p => p !== "slack")`.
  - `canPromoteSlack(issue, accounts)` — `isSlackPreserved(issue) && promotableTargets(accounts).length > 0`.
  - `submittablePlatforms(issue, accounts)` — `isSlackPreserved(issue) ? promotableTargets(accounts) : connectedPlatforms(accounts)`. (DraftDetailDialog `available` 계산용; Slack 보존 이슈는 Slack 탭 제외)

### `src/sidepanel/tabs/IssueRow.tsx`
- **현재 역할**: 개별 카드. `isSubmitted = status==="submitted" && !!url` → 본문 클릭 시 permalink 이동, 우측 `SubmittedBadge`. draft면 `onOpenDraft` + Trash.
- **변경**:
  - `accounts`(`useSettingsStore`) 구독, `promotable = canPromoteSlack(issue, accounts)` 계산.
  - `handleCardClick`: `promotable`이면 `onOpenDraft()`(DraftDetailDialog). 아니면 기존 분기(submitted→permalink, draft→onOpenDraft) 유지.
  - 우측 렌더 분기: `promotable`이면 **Upload IconButton**(`onClick`→`onOpenSubmit()`, `e.stopPropagation()`). 아니면 기존(`isSubmitted && key`→`SubmittedBadge` / 그 외→Trash) 유지.
  - props에 `onOpenSubmit: () => void` 추가.

### `src/sidepanel/tabs/IssueListTab.tsx`
- **현재 역할**: 목록·필터·`draftId` 상태로 `DraftDetailDialog` 제어.
- **변경**:
  - `autoSubmit` 상태(boolean) 추가.
  - `IssueRow`에 `onOpenSubmit={() => { setDraftId(issue.id); setAutoSubmit(true); }}` 전달, 기존 `onOpenDraft={() => { setDraftId(issue.id); setAutoSubmit(false); }}`.
  - `DraftDetailDialog`에 `autoOpenSubmit={autoSubmit}` 전달. `onOpenChange`로 닫힐 때 `setAutoSubmit(false)`.

### `src/sidepanel/tabs/DraftDetailDialog.tsx`
- **현재 역할**: draft 상세 표시 + 내부 삭제/제출 버튼 + `SubmitFieldsDialog` 내장. `available = connectedPlatforms(accounts)`, `markSubmitted`로 제출 확정.
- **변경**:
  - prop `autoOpenSubmit?: boolean` 추가 — `open && autoOpenSubmit`이면 진입 시 `setSubmitOpen(true)`(기존 prefill effect와 동일 deps, Slack 보존 이슈 대상).
  - `available`을 `submittablePlatforms(issue, accounts)`로 교체(Slack 보존 이슈면 Slack 제외).
  - `initialPlatform`을 `available` 기반으로 보정 — 현재 `pickInitialPlatform(accounts, lastSubmittedPlatform)`가 Slack을 반환할 수 있으므로, 반환값이 `available`에 없으면 `available[0]`로 fallback.
  - `handleSlackSubmit`의 `markSubmitted(...)` 호출은 **변경하지 않음**(여기서 Slack 제출은 일반 draft를 처음 Slack 공유하는 경로일 때만 의미가 있는데, Slack 보존 이슈에선 Slack 탭이 제외되어 이 경로가 호출되지 않음). 단 신규 Slack 제출(아래 IssueCreateModal)과 일관되게 `markSlackShared`로 바꾼다 — 이 다이얼로그도 일반 draft를 Slack으로 제출할 수 있기 때문(데이터 보존 목표 1 적용).
  - 삭제 버튼(`handleDelete`→`removeIssue`)은 그대로. Slack 보존 이슈 삭제 경로는 이 다이얼로그 내부 삭제 버튼이 유일(결정사항).

### `src/sidepanel/tabs/IssueCreateModal.tsx`
- **현재 역할**: 신규 작성 플로우의 제출. `handleSlackSubmit`(~517줄)에서 `markSubmitted(currentIssueId, { platform:"slack", key, url })` 호출.
- **변경**: `handleSlackSubmit`의 `markSubmitted(...)`를 `markSlackShared(currentIssueId, { key, url })`로 교체. 나머지(editor reset, `setLastSubmitFields`, `setLastSubmittedPlatform`)는 유지. editor `reset()`은 `set({...initial})`만 수행하고 blob을 삭제하지 않으므로(확인됨) 보존 데이터 안전.

### `src/i18n/ko.ts` / `src/i18n/en.ts`
- **변경**: Upload 버튼 aria-label 키 추가(예: `issueList.promote` / "트래커로 등록" · "Promote to tracker"). ko/en 동시 갱신(훅 자동 검사).

## 데이터 흐름

```
[신규 작성 → Slack 제출]
 IssueCreateModal.handleSlackSubmit
   → submitToSlack(...)               // Slack API (변경 없음)
   → markSlackShared(id, {key,url})   // ★ stripSubmitted 안 함, blob 유지, slackPreserved=true
   → editor reset()                   // blob 삭제 없음

[이슈 목록 카드 렌더]
 IssueRow
   promotable = canPromoteSlack(issue, accounts)   // 현재 연결 상태 동적
   ├─ promotable=true:
   │    본문 클릭 → onOpenDraft → DraftDetailDialog
   │    우측 Upload 버튼 → onOpenSubmit → DraftDetailDialog(autoOpenSubmit) → SubmitFieldsDialog
   └─ promotable=false:
        기존 동작 (submitted→permalink+SubmittedBadge / draft→DraftDetailDialog+Trash)

[DraftDetailDialog 제출 (승격)]
 available = submittablePlatforms(issue, accounts)   // Slack 제외
 platform=Jira 등 선택 → handleJiraSubmit 등
   → markSubmitted → stripSubmitted   // draft/blob/slackPreserved 전부 폐기 → 일반 submitted
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

// src/sidepanel/tabs/issueListUtils.ts (또는 slackPromotion.ts)
export function isSlackPreserved(issue: IssueRecord): boolean;
export function promotableTargets(accounts: Accounts): PlatformId[];
export function canPromoteSlack(issue: IssueRecord, accounts: Accounts): boolean;
export function submittablePlatforms(issue: IssueRecord, accounts: Accounts): PlatformId[];

// src/sidepanel/tabs/IssueRow.tsx
function IssueRow(props: {
  issue: IssueRecord;
  refreshKey: number;
  onOpenDraft: () => void;
  onOpenSubmit: () => void;   // ★ 추가
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
- **blob 분리 저장**: 이미지/영상/로그/첨부는 IndexedDB(`blob-db`). `markSlackShared`는 `delete*Blob`을 호출하지 않아 보존. draft 보존과 동일 메커니즘.
- **순수 함수 + 단위 테스트**: 식별·판정 로직(`isSlackPreserved`/`canPromoteSlack`/`submittablePlatforms`)을 컴포넌트에서 분리해 `__tests__/*.test.ts`로 검증(CLAUDE.md 테스트 우선).
- **i18n 동시 갱신**: 새 라벨 키는 ko/en 양쪽 추가(PostToolUse 훅 검사).
- **어댑터 무변경**: `submitToSlack`/`submitToJira` 등 제출 어댑터는 손대지 않음 — 차이는 store 전환 함수에서만.

## 대안 검토

1. **`slackPreserved` 플래그 vs draft 데이터 존재 여부로 암묵 판정**
   - 채택: 명시적 boolean 필드. 의도가 분명하고, "draft 콘텐츠가 비어 있지 않은데 submitted"라는 우연한 상태(예: 빈 draft를 Slack 공유)와 충돌하지 않는다. 데이터 존재 여부 판정은 엣지(빈 캡처)에서 오판 위험.
2. **`markSubmitted`에 `preserve` 옵션 추가 vs 별도 `markSlackShared`**
   - 채택: 별도 함수. `markSubmitted`는 "데이터 폐기"가 본질이라 옵션으로 정반대 동작을 섞으면 가독성·실수 위험. Slack 전용 의미를 함수명에 담는다.
3. **Upload 클릭 시 `SubmitFieldsDialog`를 IssueRow에서 직접 열기 vs DraftDetailDialog 경유(autoOpenSubmit)**
   - 채택: DraftDetailDialog 경유. `SubmitFieldsDialog`는 8개 플랫폼 필드 상태·prefill·핸들러를 요구하는데 이 로직이 DraftDetailDialog에 이미 있다. IssueRow에서 직접 열면 그 전부를 복제해야 해 변경량·중복이 크다. `autoOpenSubmit` 한 prop으로 재사용.

## 위험 요소

- **초기 플랫폼이 Slack로 잡히는 버그**: `lastSubmittedPlatform === "slack"`이면 `pickInitialPlatform`이 Slack 반환 → Slack 제외된 `available`에 없어 탭/필드 미스. 반드시 `available[0]` fallback 보정. (회귀 테스트 대상)
- **blob 보존 누수**: Slack 보존 이슈가 쌓이면 IndexedDB 용량 증가(draft와 동일 특성). 삭제는 DraftDetailDialog 내부 삭제 버튼 → `removeIssue`가 blob까지 정리하는지 확인 필요(기존 draft 삭제 경로와 동일해야 함).
- **승격 시 플래그 잔존**: `stripSubmitted`에 `slackPreserved: undefined`를 빠뜨리면 Jira 승격 후에도 카드가 Slack 보존으로 오인된다. 단위 테스트로 고정.
- **prefill effect deps**: `autoOpenSubmit` 처리를 기존 prefill `useEffect`에 넣을 때 deps에 `issue.platform`을 넣으면 탭 전환 시 다이얼로그가 닫히는 기존 버그(주석 178-180줄) 재현 위험 — deps 구성 주의.
- **동적 판정 일관성**: `canPromoteSlack`이 렌더 시점 `accounts` 기준이라, 제출 다이얼로그 여는 도중 연결 해제되면 상태 불일치 가능. 실사용 빈도 낮아 무시하되, `available.length === 0`일 때 기존 안내 Alert가 가드.
