# 액션 레코더 (Repro Steps) — 기술 설계

## 개요

기존 `network-recorder`/`console-recorder`와 동일한 레코더 패턴을 따르는 **세 번째 레코더 `action-recorder`**를 추가한다. MAIN world IIFE가 클릭·페이지 이동·텍스트 입력을 캡처하고, sentinel 기반 CustomEvent로 Isolated world(`picker.ts`)를 거쳐 사이드패널로 전달한다.

기존 두 레코더와의 **유일한 본질적 차이는 누적**이다. network/console은 페이지를 이동하면 새 MAIN world의 빈 버퍼로 교체되어 이전 페이지 로그가 사라진다. 액션 레코더는 repro steps 특성상 페이지 이동을 가로질러 재현 경로 전체가 남아야 하므로, 사이드패널 store에서 `id` 기준 dedup-merge로 누적한다.

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/types/action.ts` | `ActionEntry`/`ActionLog` 타입 + `ActionEntryKind` |
| `src/content/action-recorder-helpers.ts` | 순수 헬퍼 — 마스킹 판정, 요소 자연어 설명, 경량 셀렉터, 입력 dedup 키 |
| `src/content/__tests__/action-recorder-helpers.test.ts` | 위 헬퍼의 vitest 단위 테스트 |
| `src/content/action-recorder.ts` | MAIN world IIFE — DOM 이벤트 캡처, FIFO 버퍼, sentinel 제어 |
| `src/sidepanel/components/ActionLogContent.tsx` | 액션 로그 표시 컴포넌트 (`ConsoleLogContent` 패턴) |
| `src/sidepanel/tabs/ActionSubTab.tsx` | 디버그 탭의 'Actions' 서브탭 (`ConsoleSubTab` 패턴) |

### 변경 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/content/recorders-entry.ts` | MAIN world content_scripts 로더 | `import "./action-recorder"` 한 줄 추가 |
| `src/types/picker.ts` | picker 메시지 타입 union | `actionRecorder.setSentinel/stop/sync/clear/data` 추가 |
| `src/content/picker.ts` | 메시지 라우터 + MAIN↔Isolated 브릿지 | 콘솔 브릿지(라인 99-141 부근)와 동형으로 액션 브릿지 추가 |
| `src/sidepanel/picker-control.ts` | 레코더 활성화/제어 함수 | `activate/stop/sync/clearActionRecorder` 추가 (console 동형, 라인 297-315 참고) |
| `src/sidepanel/video-recorder.ts` | 비디오 녹화 엔진 | `stopRecording()`에서 `stopActionRecorder` 호출 |
| `src/sidepanel/hooks/useBackgroundRecorder.ts` | 백그라운드 레코더 주입/제어 | `inject()`에 `activateActionRecorder`, 페이지 이동 비보존 분기·idle 복귀·cleanup에 액션 레코더 처리 추가 |
| `src/sidepanel/hooks/usePickerMessages.ts` | 레코더 data 메시지 → store | `actionRecorder.data` 케이스 — **id-dedup merge** |
| `src/store/blob-db.ts` | IndexedDB blob 저장소 | `DB_VERSION` 5→6, `actionLogs` object store + `save/get/delete/getKeys/clearActionLog` |
| `src/store/editor-store.ts` | 에디터 세션 store | `actionLog`/`actionLogAttach` 상태·액션·snapshot, **`startRecording`에서 액션 로그 초기화**, `confirmDraft` 영속화, `onSubmitted` 정리 |
| `src/store/issues-store.ts` | 이슈 레코드 store | `IssueRecord`에 `actionLogBlobKey?: string` (optional) |
| `src/sidepanel/tabs/DebugTab.tsx` | 디버그 탭 (issue/console/network 3 서브탭) | 'actions' 4번째 서브탭, `grid-cols-3`→`grid-cols-4` |
| `src/sidepanel/lib/buildLogSummary.ts` | 로그 요약 빌더 | `buildActionLogSummary(log): ActionLogSummary` 추가 |
| `src/sidepanel/lib/buildAiDraftPrompt.ts` | AI 초안 프롬프트 빌더 | `AiDraftContext`에 `actionLogSummary?`, video/freeform 블록에 참고 메타 출력 |
| `src/sidepanel/tabs/DraftingPanel.tsx` / `AiDraftDialog.tsx` | AI 프롬프트 호출부 | `actionLogSummary` 인자 전달 |
| `src/i18n/ko.ts` / `src/i18n/en.ts` | 다국어 로케일 | `debug.tab.actions`, `debug.actions.empty`, `actionLog.*` 키 (ko/en 동시) |

## 데이터 흐름

```
[MAIN world] action-recorder.ts (페이지마다 새 인스턴스)
  document_start부터 무조건 버퍼링
  click(capture) / input+change / history patch+popstate+hashchange
  → buffer (FIFO 1000, 같은 필드 연속 입력은 in-place 갱신)
  ── CustomEvent __bugshot_action_data__{sentinel} ──▶
[Isolated] picker.ts handleActionData
  ── chrome.runtime.sendMessage actionRecorder.data ──▶
[Side panel] usePickerMessages
  prev.actionLog.entries ∪ incoming  (id-dedup Map merge, timestamp 정렬)  ◀── 누적 발생 지점
  → editor-store.setActionLog  +  saveActionLog(`pending:${tabId}`)
[UI] ActionSubTab(1.5s 폴링 sync) / DebugTab / DraftingPanel(AI 프롬프트 메타)
```

**세션 경계**: `startRecording` 시 **녹화 전 라이브 액션을 한 번 비우고** 새 세션으로 누적을 시작한다 — `setActionLog(null)` + `clearActionRecorder(tabId)`(MAIN world 버퍼) + `deleteActionLog(`pending:${tabId}`)`. 세 가지를 모두 비워야 Actions 서브탭에 쌓여 있던 녹화 이전 액션이 녹화 세션 로그로 새지 않는다. 이후 녹화 동안 페이지 이동해도 merge로 누적 → `stopRecording`(`stopActionRecorder` 호출) → `onRecordingComplete`(phase=drafting) → `confirmDraft`에서 `saveActionLog(issueId)`로 영속화.

### 누적 메커니즘 (핵심 설계 결정)

`useBackgroundRecorder.ts` 정독 결과:

- 페이지 이동 시 `info.status === "complete"`에서 `inject()` 재호출 → 새 document의 MAIN world에 레코더가 새로 로드, `setSentinel` 재전송. **새 페이지의 MAIN world 버퍼는 빈 상태.**
- `shouldPreserveBackgroundLogs(phase)`가 `recording`/`drafting`/`previewing`/`done`이면 페이지 이동에도 store 로그를 비우지 않고 `clearXxxRecorder`도 호출하지 않는다.
- **그럼에도 network/console은 페이지 이동 시 실질적으로 누적되지 않는다.** 새 document = 빈 버퍼이고, `usePickerMessages`의 data 핸들러가 들어온 로그로 store를 **통째 교체**(merge 아님)하기 때문이다. 페이지 이동 후 sync가 오면 이전 페이지 로그가 사라진다. network/console은 이 한계를 수용한 설계다.

→ 액션 레코더는 이 한계를 넘어야 한다:

1. **MAIN world 버퍼는 페이지별** — 그 페이지에서 일어난 액션만 담는다. 누적의 source of truth가 아니다.
2. **누적은 사이드패널 store에서** — `usePickerMessages`의 `actionRecorder.data` 핸들러가 `prev.actionLog.entries`와 `incoming`을 `id` 키 `Map`으로 merge한다. 같은 `id`가 들어오면 최신 값으로 덮어쓴다(in-place 갱신된 input 반영). 결과를 `timestamp` 오름차순 정렬해 `setActionLog`.
3. **document_start부터 무조건 버퍼링** — `console-recorder`와 동일하게 sentinel 도착 전부터 버퍼에 쌓는다. sentinel은 `dispatch`만 gate한다. 새 페이지에서 `setSentinel`이 늦게 도착해도 그 사이 액션·`navType:"load"` entry가 손실되지 않는다.
4. **녹화 중 clear 억제** — `shouldPreserveBackgroundLogs`가 true면 페이지 이동 시 `clearActionRecorder`를 호출하지 않는다(새 페이지 버퍼는 어차피 비어 있고, 누적은 store에서 하므로 안전). 비-녹화 상태에서는 Console/Network와 동일하게 페이지 이동 시 clear + `actionLog: null`.

**알려진 한계**: 클릭 직후 즉시 페이지 unload 시 그 페이지 MAIN world 버퍼의 미-sync entry가 소실될 수 있다. 완화 — ActionSubTab의 1.5s 폴링 + 새 페이지의 `navType:"load"` entry로 네비게이션 자체는 보존. 클릭→즉시이동 1건 손실은 수용(network/console과 동일 한계).

## 인터페이스 설계

### `src/types/action.ts`

```typescript
export type ActionEntryKind = "click" | "navigation" | "input";

export interface ActionEntry {
  id: string;            // crypto.randomUUID — dedup 키
  kind: ActionEntryKind;
  timestamp: number;     // 절대 epoch ms
  pageUrl: string;
  // click
  target?: string;       // 자연어 설명 ("Submit 버튼")
  selector?: string;     // 경량 셀렉터 폴백
  // navigation
  navType?: "load" | "pushState" | "replaceState" | "popstate" | "hashchange";
  fromUrl?: string;
  toUrl?: string;
  // input
  fieldLabel?: string;   // 입력 필드 자연어 설명
  value?: string;        // 마스킹 적용 후 값
  masked?: boolean;
}

export interface ActionLog {
  id: string;
  startedAt: number;
  endedAt: number;
  totalSeen: number;     // FIFO drop 포함 누적 관측 건수
  captured: number;      // 현재 보유 entry 수
  entries: ActionEntry[];
}
```

### `src/content/action-recorder-helpers.ts` (순수 함수 — 테스트 대상)

```typescript
export interface MaskFieldInput {
  type?: string;          // input.type
  name?: string;
  id?: string;
  autocomplete?: string;  // "current-password", "cc-number" 등
}
export function shouldMaskField(input: MaskFieldInput): boolean;
export function maskValue(value: string): string;            // → "***"

export interface DescribeTargetInput {
  tag: string;
  role?: string | null;
  accessibleName?: string | null;  // aria-label / textContent / value / placeholder / title
  selector: string;
}
export function describeActionTarget(input: DescribeTargetInput): string;

export function buildLightSelector(el: Element): string;     // tag#id.class:nth-child path
export function inputDedupKey(selector: string): string;     // 같은 필드 연속 입력 in-place 갱신용
```

- `shouldMaskField`: `type==="password"`면 즉시 true. `autocomplete`에 `password`/`cc-` 포함 시 true. `name`/`id`를 lowercase로 `password|secret|card|cvv|ssn|token|pwd|auth|pin` 정규식 검사.
- `describeActionTarget`: `accessibleName`이 있으면 `"{name} {role 한국어}"` 형태(예: `"저장 버튼"`), 없으면 `selector` 폴백. 긴 텍스트는 truncate.
- `buildLightSelector`: `dom-describe.ts`의 `finder`는 Isolated world 전용이라 MAIN world IIFE에서 못 쓴다. `id` 있으면 `#id`, class만 있으면 `tag.class`, 무속성이면 `:nth-child` path. 정밀도보다 경량성 우선 — 자연어 설명이 주, selector는 폴백.

### picker 메시지 타입 (`src/types/picker.ts`)

```typescript
| { type: "actionRecorder.setSentinel"; sentinel: string }
| { type: "actionRecorder.stop" }
| { type: "actionRecorder.sync" }
| { type: "actionRecorder.clear" }
| { type: "actionRecorder.data"; payload: { entries: ActionEntry[]; totalSeen: number } }
```

### picker-control 함수 (`src/sidepanel/picker-control.ts`)

```typescript
export async function activateActionRecorder(tabId: number): Promise<string>;
export async function stopActionRecorder(tabId: number): Promise<void>;
export async function syncActionRecorder(tabId: number): Promise<void>;
export async function clearActionRecorder(tabId: number): Promise<void>;
```

`activateConsoleRecorder` 등(라인 297-315)을 그대로 복제한다.

### blob-db API (`src/store/blob-db.ts`)

```typescript
export async function saveActionLog(key: string, log: ActionLog): Promise<boolean>;
export async function getActionLog(key: string): Promise<ActionLog | null>;
export async function deleteActionLog(key: string): Promise<void>;
export async function getActionLogKeys(): Promise<string[]>;
export async function clearActionLogs(): Promise<void>;
```

`networkLogs` API(라인 211-272)와 동형. `DB_VERSION`을 5→6으로 올리고 `onupgradeneeded`에 `actionLogs` object store를 `objectStoreNames.contains` 가드 후 `createObjectStore`. 기존 store는 동일 가드로 보존되므로 마이그레이션 코드 불필요.

### AI 프롬프트 (`src/sidepanel/lib/buildAiDraftPrompt.ts`)

`AiDraftContext`/`AiDraftSessionContext`에 `actionLogSummary?: ActionLogSummary` 추가. video/freeform 프롬프트 블록에 `- User actions (reference):` 섹션으로 출력하되, **프롬프트 Rules에 "actions are context only — do not copy verbatim into stepsToReproduce"를 명시**하거나 단순히 메타로만 제공한다. `stepsToReproduce` 섹션 지시는 건드리지 않는다.

`buildLogSummary.ts`에 `buildActionLogSummary(log: ActionLog): ActionLogSummary` 추가 — 최근 N개 액션을 자연어 줄로 변환(`"클릭: Submit 버튼"`, `"이동: /cart → /checkout"`, `"입력: 이메일 (***)"`). masked input은 값을 `***`로.

## 데이터 흐름 — action-recorder.ts 캡처 상세

`CTRL_KEY = "__bugshot_action_ctrl__"`, 이벤트 prefix `__bugshot_action_`. `network-recorder`/`console-recorder`의 sentinel 구조 복제.

- **클릭/탭**: `document.addEventListener("click", h, true)` (capture phase — `stopPropagation` 회피, console-recorder 동일 방식). `event.target`에서 `closest()`로 의미 있는 인터랙티브 조상(`button`, `a`, `[role=button]`, `input[type=submit]`)을 찾고 없으면 target 자체. overlay shadow host(`HOST_ID`) 내부 클릭은 제외.
- **페이지 이동**:
  - 일반 네비게이션: 레코더가 document_start에 새로 로드되므로 로드 시점에 `navType:"load"` entry를 push.
  - SPA: `history.pushState`/`replaceState`를 monkey-patch(network-recorder의 fetch wrap과 동일 — original 보관 후 호출, `CTRL_KEY` 가드로 이중 패치 방지). `window.addEventListener("popstate")`, `"hashchange")`. 각각 `fromUrl`/`toUrl` 기록.
  - **텍스트 입력**: `document.addEventListener("input", h, true)` + `"change"`. `<input>`/`<textarea>`/`[contenteditable]` 대상. 같은 `inputDedupKey(selector)`의 연속 입력은 버퍼 내 마지막 entry를 in-place 갱신(network-recorder의 pending→complete in-place 갱신 응용). `shouldMaskField` 판정 후 `value` 또는 `"***"` + `masked: true`.
- 버퍼: `MAX_ENTRIES = 1000` FIFO. `dispatch()`는 `buffer.slice()` 전송.

## 기존 패턴 준수

- **레코더 패턴**: MAIN world IIFE 자가호출, sentinel 기반 제어(setSentinel/stop/sync/clear), CustomEvent로 MAIN↔Isolated 통신, FIFO 버퍼 cap — `network-recorder`/`console-recorder`와 동일.
- **순수 헬퍼 분리 + 테스트**: 마스킹·셀렉터·설명 로직을 `action-recorder-helpers.ts`로 분리하고 `__tests__/`에 vitest 단위 테스트. CLAUDE.md의 "테스트 우선" 원칙.
- **세션 영속화**: `editor-store`의 `EditorSnapshot`에 `actionLogAttach` 추가 시 `useEditorSessionSync.ts`의 `snapshotFromState()`가 필드를 수동 복사하므로 거기에도 명시적으로 추가해야 한다(누락 시 타입은 통과하지만 런타임에서 값 소실).
- **i18n 동시 갱신**: `locales.test.ts`가 ko/en 키 일치를 검증 — 양쪽 동시 추가.
- **shadcn 우선**: `ActionLogContent`/`ActionSubTab`은 기존 `ConsoleLogContent`/`ConsoleSubTab`이 쓰는 shadcn 컴포넌트(`Tabs`/`Input`/`ScrollArea`) 재사용.
- **외과적 변경**: `usePickerMessages`의 network/console 케이스는 store 교체, action만 merge — 인접 코드를 건드리지 않고 새 케이스만 추가.

## 대안 검토

### 대안 A — MAIN world 버퍼를 `sessionStorage`로 페이지 가로질러 유지

새 페이지의 레코더 IIFE가 `sessionStorage`에서 이전 페이지 액션을 복원해 누적. → **불채택.** `sessionStorage`는 origin 격리라 cross-origin 네비게이션에서 끊긴다. 직렬화/cap 관리가 MAIN world에 추가로 들어가 레코더가 무거워진다. 사이드패널 store merge가 origin 무관하게 동작하고 단순하다.

### 대안 B — `stepsToReproduce` 섹션에 액션 목록 자동 주입

캡처한 액션을 재현 과정 섹션에 그대로 채움. → **불채택(사용자 명시 제외).** raw 액션 목록은 노이즈가 많고("빈 영역 클릭" 등), 사용자가 직접 작성/AI가 다듬을 섹션을 덮어쓰면 마찰이 크다. 액션 로그는 AI 프롬프트 메타로만 제공해 AI가 취사선택하게 한다.

### 대안 C — `chrome.debugger` / DevTools Protocol로 입력 이벤트 추적

더 정밀한 이벤트(좌표·타이밍)를 얻을 수 있음. → **불채택.** `debugger` 권한은 사용자에게 "디버깅 중" 배너를 띄우고 권한 승인 마찰이 크다. content script DOM 이벤트로 클릭/입력/네비게이션은 충분히 캡처되며 새 권한이 0건이다.

## 위험 요소

- **`DB_VERSION` 6 bump**: v5 사용자가 `onupgradeneeded`를 거친다. 기존 store는 `contains` 가드로 보존되고 `actionLogs`만 추가하므로 데이터 손실 없음. 타 탭에서 v5 연결이 열려 있으면 `onblocked` — 기존 코드에서 reject 처리됨.
- **클릭 노이즈**: 사이드패널 외 모든 클릭을 캡처하면 의미 없는 빈 영역 클릭이 섞인다. overlay shadow host 내부 클릭 제외 + 인터랙티브 조상이 없으면 selector만 기록 + Actions 서브탭 필터로 노출 조절.
- **입력 마스킹 누락**: `name`/`id`가 없는 커스텀 컴포넌트는 마스킹 힌트를 못 찾는다. `contenteditable`은 부모의 password 힌트로 보수적 판정. 완전 방어는 불가 — PRD 엣지 케이스로 명시.
- **SPA `history` patch 충돌**: 페이지 라우터가 이미 `pushState`를 wrap한 경우 — original 보관 후 호출이라 안전, `CTRL_KEY` 가드로 이중 패치 방지.
- **이동 직전 마지막 클릭 손실**: 위 "누적 메커니즘 — 알려진 한계" 참조. 수용.
- **`issues-store` 타입 변경**: `actionLogBlobKey`는 optional이라 마이그레이션 코드 불필요. 단 `ISSUES_STORE_VERSION` 주석 블록에 한 줄 덧붙여 추적성 유지(video-report `design.md`의 v6 처리 방식 참고).

## video-report 통합 (후속)

video-report HTML 기능(`docs/features/video-report/`)은 스펙만 존재하고 미구현이다. 이번 범위는 **데이터 계약 준비까지** — `ActionLog` 타입 + `actionLogBlobKey` 영속화.

video-report 구현 시: `buildVideoReportDataFromIssue`가 `getActionLog(issueLog 키)`로 액션 로그를 읽고, `buildReportTimeline`이 network/console과 함께 `ActionEntry`를 상대 시간으로 병합해 타임라인 행/마커로 렌더한다. video-report `design.md`의 `ReportLogEntry` discriminated union에 `kind: "action"` 케이스를 추가하면 된다.

→ video-report 구현 착수 시 `docs/features/video-report/design.md`도 액션 entry 병합을 포함하도록 갱신할 것.
