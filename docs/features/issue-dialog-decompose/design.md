# Issue Dialog Decompose — 기술 설계

## 개요

4건의 분리 작업은 모두 **순수 모듈 이동 + 단일 hook 추출**로 구성된다. 새 추상화나 시그니처 변경 없이, 책임이 섞여 있던 파일을 같은 디렉터리·동등 위치로 떼어낸다. 분리 후 import 경로만 바뀌고 동작은 동일.

## 변경 범위

### 신설 파일

#### `src/sidepanel/tabs/statusBadges/` (시급 #1)

| 파일 | 역할 | 기존 위치 |
|---|---|---|
| `constants.ts` | `STATUS_CATEGORY_COLORS`, `LINEAR_STATE_TYPE_COLORS`, `LINEAR_STATE_I18N` | IssueListTab.tsx:440-478 |
| `PlatformChip.tsx` | 4 플랫폼 아이콘 + 라벨 chip | IssueListTab.tsx:481-513 |
| `GithubStatusBadge.tsx` | GitHub status popover + 타입 `GithubBadgeStatus`, `GithubTargetState`, `toGithubTargetState` | IssueListTab.tsx:515-625 |
| `JiraStatusBadge.tsx` | Jira transition popover | IssueListTab.tsx:627-741 |
| `LinearStatusBadge.tsx` | Linear workflow state popover | IssueListTab.tsx:743-850 |
| `NotionStatusBadge.tsx` | Notion status option popover | IssueListTab.tsx:852-969 |
| `SubmittedBadge.tsx` | 4 플랫폼 분기 wrapper (제출 후 표시) | IssueListTab.tsx:971-1264 |

> `notionStatusCategory`는 기존 `tabs/notionStatusColors.ts`에서 계속 import한다 (이동하지 않음).

#### `src/sidepanel/tabs/jiraFields/` (시급 #2)

| 파일 | 역할 | 기존 위치 |
|---|---|---|
| `JiraIssueFields.tsx` | `JiraFieldsBlock` 대체 + `initialJiraFields` (현재 `useEditorStore`의 `issueFields` 그대로 노출하므로 initial은 EditorIssueFields 그대로 통과) | IssueCreateModal.tsx:829-876 |
| `IssueTypeField.tsx` | Jira issue type 콤보 | IssueCreateModal.tsx:941-1024 |
| `PriorityField.tsx` | Jira priority 콤보 | IssueCreateModal.tsx:1026-1099 |
| `AssigneeField.tsx` | Jira assignee 콤보 + debounce 검색 | IssueCreateModal.tsx:1101-1176 |
| `EpicField.tsx` | Jira parent/relates 양쪽에 쓰이는 epic 검색 콤보 | IssueCreateModal.tsx:1178-1251 |
| `FieldCombobox.tsx` | Jira 콤보 UI primitive | IssueCreateModal.tsx:1253-1349 |
| `useDebouncedSearch.ts` | debounce 검색 hook | IssueCreateModal.tsx:906-939 |
| `useJiraConfig.ts` | Jira projectKey 추출 hook | IssueCreateModal.tsx:898-904 |

> `EditorIssueFields` 타입은 `editor-store`에서 그대로 import 유지 (이동하지 않음).

#### `src/sidepanel/tabs/SubmitFieldsDialog.tsx` (시급 #3)

- IssueCreateModal.tsx:641-827 (인터페이스 `SubmitFieldsDialogProps` + 컴포넌트 `SubmitFieldsDialog`)을 통째로 이동.
- `import { JiraIssueFields } from "./jiraFields/JiraIssueFields"`로 jira 분기 갱신.
- 양쪽 호스트가 `./SubmitFieldsDialog`에서 import.

#### `src/sidepanel/components/FieldRow.tsx` (시급 #3)

- IssueCreateModal.tsx:878-896에서 이동.
- 4 fields 디렉터리·SubmitFieldsDialog·JiraIssueFields 모두 `@/sidepanel/components/FieldRow`로 import 통일.

#### `src/sidepanel/tabs/IssueRow.tsx` (시급 #1)

- IssueListTab.tsx:323-438에서 이동. props 시그니처 유지.
- 내부에서 `SubmittedBadge`는 `./statusBadges/SubmittedBadge` import.

#### `src/sidepanel/tabs/issueListUtils.ts` (시급 #1)

순수 헬퍼 묶음. IssueListTab.tsx 안에 흩어진 것:

```ts
// 기존: IssueListTab.tsx 43-109, 1266-1305
export type StatusFilter = "all" | "submitted" | "draft";
export function isRefreshable(issue: IssueRecord): boolean
export function resolveNotionPageId(issue: Pick<IssueRecord, "notionPageId" | "url">): string | null
export function parseGithubIssueNumber(key: string | undefined): number | null
export function parseGithubIssueUrl(url: string | undefined): { owner: string; repo: string; number: number } | null
export function resolveGithubCoords(issue: Pick<IssueRecord, "githubOwner" | "githubRepo" | "key" | "url">): { owner: string; repo: string; number: number } | null
export function matchesQuery(issue: IssueRecord, q: string): boolean
export function matchesStatus(issue: IssueRecord, filter: StatusFilter): boolean
export function formatIssueKey(issue: Pick<IssueRecord, "platform" | "key">): string
export function issueTimestamp(issue: IssueRecord): number
export function dateLabel(ts: number): string
export function formatDate(ts: number, t: TranslationFn): string
export function groupByDate(issues: IssueRecord[]): [string, IssueRecord[]][]
```

> `dateLabel`·`formatDate`·`groupByDate`는 `dateBcp47`·`TranslationFn`을 `@/i18n`에서 import.

#### `src/sidepanel/hooks/usePlatformFields.ts` (시급 #4)

3개 플랫폼(GitHub/Linear/Notion) fields state·setter·초기화를 합친 hook. Jira(`EditorIssueFields`)는 `useEditorStore` 자체 state라 hook 대상에서 제외 — Jira만 분리되어 있는 게 의도된 구조. **`initialJiraFields` 헬퍼는 만들지 않는다** (jira는 store 직접 사용).

타입 가독성 위해 3개 fields 파일 각각에 `Initial*Input`/`*Defaults` 명시적 타입 export를 추가 — `Parameters<typeof initialGhFields>[0]` 같은 inline 추론보다 시그니처 변경 추적이 쉬움.

```ts
// 3 fields 파일 각각에 추가하는 타입 export 예시 (githubFields/GithubIssueFields.tsx):
export type GithubFieldsInitInput = Parameters<typeof initialGhFields>[0];
export type GithubFieldsDefaults = Parameters<typeof initialGhFields>[1];

// hooks/usePlatformFields.ts:
import type {
  GithubIssueFieldsValue, GithubFieldsInitInput, GithubFieldsDefaults,
} from "@/sidepanel/tabs/githubFields/GithubIssueFields";
import type {
  LinearIssueFieldsValue, LinearFieldsInitInput, LinearFieldsDefaults,
} from "@/sidepanel/tabs/linearFields/LinearIssueFields";
import type {
  NotionIssueFieldsValue, NotionFieldsInitInput, NotionFieldsDefaults,
} from "@/sidepanel/tabs/notionFields/NotionIssueFields";

export interface UsePlatformFieldsInput {
  open: boolean;
  lastGhSubmit: GithubFieldsInitInput;
  ghDefaults: GithubFieldsDefaults;
  lastLinearSubmit: LinearFieldsInitInput;
  linearDefaults: LinearFieldsDefaults;
  lastNotionSubmit: NotionFieldsInitInput;
  notionDefaults: NotionFieldsDefaults;
  // 추가 reset 트리거 (DraftDetailDialog의 issue?.id 같은 것; IssueCreateModal은 미사용)
  resetKey?: unknown;
}

export interface PlatformFieldsState {
  ghFields: GithubIssueFieldsValue;
  setGhFields: (patch: Partial<GithubIssueFieldsValue>) => void;
  linearFields: LinearIssueFieldsValue;
  setLinearFields: (patch: Partial<LinearIssueFieldsValue>) => void;
  notionFields: NotionIssueFieldsValue;
  setNotionFields: (patch: Partial<NotionIssueFieldsValue>) => void;
}

export function usePlatformFields(input: UsePlatformFieldsInput): PlatformFieldsState;
```

### 내부 구현 상세

각 플랫폼 3쌍(GitHub/Linear/Notion)에 대해 동일 패턴:

```ts
// hook 내부 (GitHub 예시 — 다른 2개도 동일 패턴)
const [ghFields, setGhFieldsState] = useState<GithubIssueFieldsValue>(() =>
  initialGhFields(input.lastGhSubmit, input.ghDefaults),
);
const setGhFields = useCallback(
  (patch: Partial<GithubIssueFieldsValue>) =>
    setGhFieldsState((s) => ({ ...s, ...patch })),
  [],
);
useEffect(() => {
  if (input.open) {
    setGhFieldsState(initialGhFields(input.lastGhSubmit, input.ghDefaults));
  }
}, [input.open, input.lastGhSubmit, input.ghDefaults, input.resetKey]);
```

- `useState` initializer는 hook **첫 마운트 시만** 호출. 이후 reset은 effect가 담당.
- effect deps에 `input.open`만 의미적 트리거 (false→true 전환), 나머지는 변경 감지용. `if (input.open)` 가드로 false 상태에서의 reset 회피.
- `resetKey`는 4번째 deps. DraftDetailDialog의 `issue?.id` 변경 시 같은 issue를 다시 열어도 idempotent하게 리셋.
- 각 setter는 `useCallback(..., [])`로 안정 참조 유지 — `SubmitFieldsDialog`/`GithubIssueFields` 같은 자식이 메모이즈된 콜백을 받음.

### 수정 파일

#### `src/sidepanel/tabs/IssueCreateModal.tsx`

- import 갱신: `SubmitFieldsDialog`/`SubmitFieldsDialogProps`·`FieldRow`·Jira 필드 6종을 새 위치에서 import.
- 본체에서 다음 코드 제거:
  - 132-170: ghFields·linearFields·notionFields state·effect·setter (→ `usePlatformFields` 호출로 대체)
  - 641-1349: SubmitFieldsDialog, JiraFieldsBlock, FieldRow, useJiraConfig, useDebouncedSearch, IssueTypeField, PriorityField, AssigneeField, EpicField, FieldCombobox (→ 모두 이동)
- 본체에 남는 것: imports, IssueCreateModal 컴포넌트(트리거 버튼 + SubmitFieldsDialog 호출), buildCtx, 4 submit 핸들러(handleJiraSubmit/handleGithubSubmit/handleLinearSubmit/handleNotionSubmit), handleSubmit. ~500줄 수준.
- 새 hook 호출:

```ts
const { ghFields, setGhFields, linearFields, setLinearFields, notionFields, setNotionFields } =
  usePlatformFields({
    open,
    lastGhSubmit, ghDefaults: ghAccount?.defaults,
    lastLinearSubmit, linearDefaults: linearAccount?.defaults,
    lastNotionSubmit, notionDefaults: notionAccount?.defaults,
  });
```

#### `src/sidepanel/tabs/DraftDetailDialog.tsx`

- import 갱신: `SubmitFieldsDialog`를 `./SubmitFieldsDialog`에서. (`./IssueCreateModal` import 제거)
- 132-157: ghFields·linearFields·notionFields state·setter 제거 → `usePlatformFields` 호출 (resetKey: `issue?.id`).
- 164-185의 useEffect에서 `setGhFieldsState`·`setLinearFieldsState`·`setNotionFieldsState` 호출 제거. (hook이 그 자리 차지)
- 나머지 effect 로직(`setFields(base)` jira·`setPlatform(initial)`·`setSubmitOpen(false)`)은 남긴다 — 그리고 **eslint-disable의 의도적 deps 제외 주석 보존**. 이유는 Tab 전환 시 다이얼로그 강제 닫힘 버그 회피.

#### `src/sidepanel/tabs/IssueListTab.tsx`

- imports 갱신: statusBadges/, IssueRow, issueListUtils에서.
- 본체에 남는 것: imports, `IssueListTab` 컴포넌트(필터 UI + 리스트 렌더 + 빈/없음 state + Footer + DraftDetailDialog 호출). ~320줄 수준.
- 제거되는 inline 정의: `isRefreshable`/`resolveNotionPageId`/`parseGithubIssueNumber`/`parseGithubIssueUrl`/`resolveGithubCoords`/`matchesQuery`/`matchesStatus`/`IssueRow`/`STATUS_CATEGORY_COLORS`/`LINEAR_STATE_TYPE_COLORS`/`LINEAR_STATE_I18N`/`PlatformChip`/4 StatusBadge/`SubmittedBadge`/`formatIssueKey`/`issueTimestamp`/`dateLabel`/`formatDate`/`groupByDate`/`toGithubTargetState` 등.

#### `src/sidepanel/tabs/githubFields/GithubIssueFields.tsx`

- 5번째 import 갱신: `import { FieldRow } from "@/sidepanel/tabs/IssueCreateModal"` → `import { FieldRow } from "@/sidepanel/components/FieldRow"`.

#### `src/sidepanel/tabs/linearFields/LinearIssueFields.tsx` / `notionFields/NotionIssueFields.tsx` / `notionFields/PropertiesFieldset.tsx`

- 같은 FieldRow import 경로가 있다면 동일하게 갱신. (Bash grep으로 확인 후 일괄 치환)

## 데이터 흐름

작업 후 import 그래프 (간략):

```
IssueListTab.tsx
├─ issueListUtils.ts (순수 헬퍼)
├─ IssueRow.tsx
│  └─ statusBadges/SubmittedBadge.tsx
│     ├─ statusBadges/{Jira,Github,Linear,Notion}StatusBadge.tsx
│     │  └─ statusBadges/constants.ts
│     └─ statusBadges/PlatformChip.tsx
└─ DraftDetailDialog.tsx

IssueCreateModal.tsx
├─ jiraFields/JiraIssueFields.tsx
│  ├─ jiraFields/{IssueType,Priority,Assignee,Epic}Field.tsx
│  │  └─ jiraFields/FieldCombobox.tsx
│  └─ jiraFields/{useJiraConfig,useDebouncedSearch}.ts
├─ githubFields/GithubIssueFields.tsx
├─ linearFields/LinearIssueFields.tsx
├─ notionFields/NotionIssueFields.tsx
├─ SubmitFieldsDialog.tsx
│  └─ jiraFields/JiraIssueFields.tsx
└─ hooks/usePlatformFields.ts

DraftDetailDialog.tsx
├─ SubmitFieldsDialog.tsx
└─ hooks/usePlatformFields.ts
```

순환 의존성 없음. `IssueCreateModal` → `DraftDetailDialog` 방향은 IssueListTab.tsx 한 곳에서 끊긴다.

## 인터페이스 설계

### `usePlatformFields` hook

위 [신설 파일] 섹션 참조. **새로 도입되는 유일한 인터페이스**. 그 외는 모두 기존 props/타입 그대로 이동.

### `SubmitFieldsDialog`

기존 IssueCreateModal.tsx:641-660의 `SubmitFieldsDialogProps` interface와 661-827의 컴포넌트를 **그대로** SubmitFieldsDialog.tsx로 옮긴다. 시그니처·동작 변경 없음.

> **공유 vs 호스트별 로컬 다이얼로그** — 두 호스트(IssueCreateModal·DraftDetailDialog)가 각자 자기 SubmitFieldsDialog 로컬 정의를 가져도 무방하지만, 내부 submit 상태 관리(submitting 플래그, 에러 처리, onSuccess 콜백)·Tab 토글·플랫폼별 분기 렌더가 양쪽에서 동일하기 때문에 공유 컴포넌트로 둔다. 분리 시 코드 중복이 ~100줄 추가되고, 한쪽 수정 시 다른 쪽 누락 회귀 위험.

> **SubmitFieldsDialog는 FieldRow를 직접 import하지 않는다.** Jira/GitHub/Linear/Notion 4종 fields 컴포넌트가 각자 FieldRow를 사용하고, SubmitFieldsDialog는 그 4종을 platform 분기로 호출만 함.

### `FieldRow`

기존 IssueCreateModal.tsx:878-896의 props (label/required/children) 그대로.

## 기존 패턴 준수

- **CLAUDE.md "@/ 경로 우선"**: 새 hook은 `@/sidepanel/...` 절대 경로 일관. 같은 디렉터리 내부는 `./` 상대 유지 (기존 패턴).
- **CLAUDE.md "shadcn/ui 우선"**: 새 파일 모두 기존 import(`@/components/ui/button`, `popover`, `dialog`, `command`, `tabs` 등) 그대로. 새 컴포넌트 도입 안 함.
- **CLAUDE.md "IconButton 사이즈 h-8 w-8 / h-9 w-9"**: 분리 작업이라 영향 없음.
- **CLAUDE.md "테스트 우선 / 신규 인터페이스"**: `usePlatformFields`는 hook이라 단순 단위 테스트가 까다롭지만 reducer 패턴이 아니라 effect 기반이라 기존 테스트 패턴(`@testing-library/react-hooks`)이 프로젝트에 없음 → 동작 검증은 수동 회귀로. `issueListUtils.ts`의 순수 함수들(`isRefreshable`, `resolveGithubCoords`, `matchesQuery`, `matchesStatus`, `formatDate` 등)에 단위 테스트 추가.
- **ARCHITECTURE.md "플랫폼 어댑터 4종 대칭"**: jiraFields/ 신설로 회복.
- **DraftDetailDialog의 `// eslint-disable-next-line react-hooks/exhaustive-deps` 주석 + Tab 전환 시 다이얼로그 닫힘 버그 회피 의도**: hook 추출 후에도 호스트의 그 effect는 남으므로 주석 유지. `usePlatformFields` 자체는 의도된 deps를 갖는 다른 effect이므로 disable 불필요.

## 대안 검토

### 대안 1: jiraFields/ 디렉터리 대신 IssueCreateModal 안에 유지

- 장점: 변경 파일 수 적음.
- 단점: ARCHITECTURE.md "4종 대칭" 원칙 깨진 상태 유지. 새 Jira 필드 추가 시 거대 파일 안에 또 inline. /audit가 또 동일 항목 적발.
- **불채택**.

### 대안 2: 4 플랫폼 fields를 generic dict로 통합

```ts
const fields = useFieldsByPlatform<{ github: GithubIssueFieldsValue; ... }>({ ... });
```

- 장점: 코드 중복 더 줄이는 듯 보임.
- 단점: 4 플랫폼 타입이 서로 무관(`Partial<GhV>`/`Partial<LinearV>`/`Partial<NotionV>` 시그니처 통합 어려움). discriminated 패턴이라 type narrowing 손실. CLAUDE.md "불필요한 추상화 금지" 위반.
- **불채택**.

### 대안 3: SubmitFieldsDialog를 `src/sidepanel/components/`로 옮김

- 장점: "공유 컴포넌트"의 의미 부각.
- 단점: components/는 다른 sidepanel 컴포넌트(Section, TiptapEditor 등)의 위치. SubmitFieldsDialog는 4 플랫폼 fields 디렉터리에 강결합 (`jiraFields/`·`githubFields/` 등 import)이라 components보다는 tabs/ 평탄 위치가 자연. import 깊이도 더 적음.
- **불채택** — `tabs/SubmitFieldsDialog.tsx` 채택.

### 대안 4: FieldRow를 jiraFields/에 두고 다른 fields 디렉터리에서 import

- 장점: jiraFields/가 가장 큰 사용처라 그쪽에 두는 게 자연.
- 단점: github/linear/notion → jira 방향 의존이 생김. "4종 대칭"인데 jira가 hub가 됨. components 공용 위치가 의존 방향상 더 깔끔.
- **불채택**.

### 대안 5: IssueListTab을 `IssueListTab/` 디렉터리로 만들고 안에 IssueRow·utils·statusBadges 모두 배치

- 장점: 한 화면 단위로 묶임.
- 단점: 다른 큰 컴포넌트(IssueCreateModal, DraftDetailDialog 등)는 모두 `.tsx` 평탄 + 보조 디렉터리(`connect/`, `*Fields/`, `styleEditor/`) 패턴. IssueListTab만 디렉터리화하면 컨벤션 깨짐. 또한 statusBadges는 SubmittedBadge wrapper와 4 배지 양쪽 모두에서 import되어 IssueListTab과 무관해 보임.
- **불채택**.

## 위험 요소

- **순환 의존성**: SubmitFieldsDialog가 jiraFields/를 import하고, jiraFields/가 FieldRow를 import하는 그래프는 트리. 다만 IssueCreateModal과 SubmitFieldsDialog가 서로 import하지 않도록 주의 — SubmitFieldsDialog는 props만 받고 IssueCreateModal에서 SubmitFieldsDialog를 호출. 양방향 import는 금지.
- **Strict Mode double-effect와 hook 초기화**: React 18 strict mode가 개발 중 mount/unmount/remount 사이클을 강제하면 `usePlatformFields` 내부 effect가 2회 발화. 첫 `useState` initializer는 첫 마운트에서만 호출되지만, 이어지는 strict unmount→remount에서 effect의 `setGhFieldsState(initialGhFields(...))`가 다시 호출되어 결국 상태가 깨끗하게 reset. 동작상 idempotent — `initialGhFields`는 같은 입력에 같은 결과 반환 (순수 함수)이므로 회귀 없음. 단 dev 환경에서만 발생하고 production에서는 단일 effect.
- **`ghAccount.defaults` 변경 시 다이얼로그 열린 채로 user input override 위험**: hook effect deps에 `input.ghDefaults`가 포함되므로, 사용자가 IssueCreateModal/DraftDetailDialog 열어둔 채로 다른 탭에서 GitHub 계정 default를 변경하면 effect 재발화 → 사용자가 입력 중이던 값이 `initialGhFields`로 덮어쓰임. **현실적으로 발생 빈도 매우 낮음** (한 sidepanel 탭에서 통합 작업이라 다이얼로그 열어두고 별도 계정 설정 동시 수정하는 시나리오는 거의 없음). 회귀 발견 시 effect 가드(`if (input.open && !userHasEdited)`)를 추가하는 식으로 후속 처리. 이번 스코프에서는 명시적 회피 안 함 — 분리 전 IssueCreateModal 코드도 동일 동작이었음.
- **`SubmitFieldsDialog` 이동 시 export 의존성**: 현재 IssueCreateModal에서 `export interface SubmitFieldsDialogProps`·`export function SubmitFieldsDialog`로 노출 중. DraftDetailDialog가 그걸 import. 이동 후 IssueCreateModal에서 re-export 잔존시키지 말고 깨끗하게 분리.
- **DraftDetailDialog의 의도적 deps 제외 동작 보존**: `// eslint-disable-next-line react-hooks/exhaustive-deps` + `[open, issue?.id]` deps로 묶인 reset effect는 fields hook 추출 후에도 setFields(base)·setPlatform(initial)·setSubmitOpen(false)를 그대로 들고 있어야 한다 (Tab 전환 시 다이얼로그 강제 닫힘 버그 방지). 주석도 유지.
- **`usePlatformFields`의 effect deps에 `lastXxxSubmit`/`xxxDefaults` 포함**: 기존 DraftDetailDialog는 deps에서 의도적으로 제외했지만, 동작상 그 변경이 다이얼로그 닫힘에 영향을 주는 게 아니라 단순 fields 값 갱신이라 hook으로 가도 무해. (실제 last 변경 트리거는 submit 후이고, 그땐 open=false). 회귀 가능성 낮지만 수동 테스트에서 확인.
- **GithubIssueFields/LinearIssueFields/NotionIssueFields/PropertiesFieldset의 FieldRow import 경로**: 4 파일에서 일괄 갱신 누락 시 빌드 에러 (참고: `grep -rn 'from "@/sidepanel/tabs/IssueCreateModal"' src/`로 사전 확인 가능 — 결과 0일 때까지 추적).
- **`tsc --noEmit` 검증 필수**: 파일 이동·import 변경이 광범위해 typecheck 통과가 가장 중요한 회귀 신호. 작업 중간·끝에 두 번 실행.
- **테스트 파일 위치**: `tabs/githubFields/__tests__/` 같은 기존 디렉터리는 그대로. 새 `jiraFields/__tests__/`는 신규 추가 없으면 만들 필요 없음. `issueListUtils.test.ts`만 새로 추가 (`src/sidepanel/tabs/__tests__/issueListUtils.test.ts`).
