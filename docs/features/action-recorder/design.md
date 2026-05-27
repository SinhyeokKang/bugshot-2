# 액션 레코더 (Repro Steps) — 기술 설계

## 개요

기존 `network-recorder`/`console-recorder`와 동일한 레코더 패턴을 따르는 **세 번째 레코더 `action-recorder`**를 추가한다. MAIN world IIFE가 클릭·페이지 이동·텍스트 입력을 캡처하고, sentinel 기반 CustomEvent로 Isolated world(`picker.ts`)를 거쳐 사이드패널 store에 누적한다.

### 설계 원칙: 로그와 **완전히 동일한 라이프사이클**

action 버퍼의 생애주기를 `console-recorder`(및 `network-recorder`)와 **모든 단계에서 1:1로 동일하게** 만든다 — 주입·버퍼링·merge·clear·freeze·trim·persist·attach 토글·cleanup. 같은 헬퍼(`mergeLogItems`/`trimByTime`/`isLogFrozen`/`lastLogClearAt`/`rebuildXxxLog`)와 같은 phase 훅(`preserveLogs`/`selectAttachedLogs`/`persistAttachedLogs`/`shouldPreserveBackgroundLogs`)을 그대로 공유한다. 이는 UX 일관성(액션이 로그와 똑같이 동작)과 운영 단순성(특수 코드 경로·DB 정리 분기 제거)을 위한 의도된 결정이다.

이 원칙의 결과로 cross-navigation 누적·30s-replay 트림이 **로그에서 이미 검증된 메커니즘을 그대로** 얻는다. `mergeLogItems`(`log-merge.ts:11`)는 `id` 기준 dedup-merge라, 녹화 중(`shouldPreserveBackgroundLogs`가 true → store 미-clear) 페이지를 이동하면 새 페이지 incoming이 기존 store entry와 merge되어 **재현 경로 전체가 누적**된다. 30s-replay는 `capture()`에서 network/console과 동일하게 `trimByTime`으로 윈도우를 자른다.

**로그와 다른 점은 단 두 가지, 그 외 전부 동일하다:**

1. **입력 마스킹** — `value`에 password/민감 필드 마스킹 적용 (`shouldMaskField`).
2. **log-viewer 주입 게이팅** — `logs.html`에 액션을 넣는 건 `captureMode === "video"`(수동 녹화 + 30s-replay) 한정. (단 버퍼·store·영속화·AI 메타 라이프사이클은 freeform/screenshot에서도 로그와 똑같이 동작 — 게이팅은 **렌더 소비자 한 곳**에만 둔다.)

**라이브 사이드패널 'Actions' 서브탭은 만들지 않는다.** 액션은 버퍼에만 쌓이고 사용자에게는 ① 제출 후 log-viewer HTML, ② AI 초안 프롬프트 메타로만 노출된다. 디버그 탭(`DebugTab.tsx`)은 issue/console/network 3개 서브탭을 그대로 유지한다.

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/types/action.ts` | `ActionEntry`/`ActionLog` 타입 + `ActionEntryKind` + `ActionLogSummary`(AI 메타용) |
| `src/content/action-recorder-helpers.ts` | 순수 헬퍼 — 마스킹 판정, 요소 자연어 설명, 경량 셀렉터, 입력 dedup 키 |
| `src/content/__tests__/action-recorder-helpers.test.ts` | 위 헬퍼의 vitest 단위 테스트 |
| `src/content/action-recorder.ts` | MAIN world IIFE — DOM 이벤트 캡처, FIFO 버퍼, sentinel 제어 |
| `src/sidepanel/components/ActionLogContent.tsx` | 액션 로그 표시 컴포넌트 (`ConsoleLogContent` 패턴, `flush` prop). **소비자는 log-viewer `App.tsx`뿐** — `ConsoleLogContent`가 sidepanel/components에 있고 log-viewer가 재사용하는 관례를 그대로 따라 위치만 sidepanel/components에 둔다. |

> 라이브 서브탭을 만들지 않으므로 `ActionSubTab.tsx`는 신규 파일에서 제외했다.

### 변경 파일

action의 라이프사이클은 console 로그가 손대는 **모든 파일·함수를 동일하게** 손댄다. 아래 표의 "console 대응"을 그대로 미러링한다.

| 파일 | 변경 (console 대응 미러) |
|---|---|
| `src/content/recorders-entry.ts` | `import "./action-recorder"` 한 줄 추가 |
| `src/types/picker.ts` | `actionRecorder.setSentinel/stop/sync/clear/data` 추가 (`consoleRecorder.*` 동형) |
| `src/content/picker.ts` | 콘솔 브릿지(라인 99-141 부근) 동형으로 액션 브릿지 추가 |
| `src/sidepanel/picker-control.ts` | `activate/stop/sync/clearActionRecorder` 추가 (console 동형, 라인 297-315) |
| `src/sidepanel/lib/log-merge.ts` | `ACTION_MAX_ENTRIES` 상수 + `rebuildActionLog`(`rebuildConsoleLog` 동형) 추가 |
| `src/sidepanel/hooks/usePickerMessages.ts` | `logClear` 핸들러에 `clearActionLog` 추가 + `actionRecorder.data` 케이스(`consoleRecorder.data` 라인 146-167 **그대로** 복제, getter `e=>e.timestamp`) |
| `src/sidepanel/hooks/useBackgroundRecorder.ts` | `inject()`에 `activateActionRecorder`, 페이지 이동 비보존 분기·idle 복귀·cleanup에 액션 레코더 처리 (network/console과 동일 지점) |
| `src/sidepanel/video-capture.ts` | `startVideoCapture`에서 `deleteActionLog(pending)` + `activateActionRecorder` + `clearActionRecorder` (network/console 동형) |
| `src/sidepanel/video-recorder.ts` | `stopRecording()`에서 `stopActionRecorder` 호출 (stopNetwork/Console 옆) |
| `src/sidepanel/30s-replay/use-30s-replay.ts` | `capture()`에서 network/console trim 블록과 **병렬로** 액션 `trimByTime`+save (라인 159-169 동형) |
| `src/store/blob-db.ts` | `DB_VERSION` 5→6, `actionLogs` object store + `save/get/delete/getKeys/clearActionLog` (`networkLogs` 동형) |
| `src/store/editor-store.ts` | `actionLog`/`actionLogAttach` 상태·setter·`clearActionLog`·`EditorSnapshot` 필드. `preserveLogs`/`selectAttachedLogs`/`persistAttachedLogs`/`onRecordingComplete`/`startFreeform`/`onAreaCaptured`/`onSubmitted`에 console과 동일 지점으로 추가 |
| `src/store/issues-store.ts` | `IssueRecord`에 `actionLogBlobKey?: string` (optional, `consoleLogBlobKey` 옆) |
| `src/sidepanel/lib/buildLogSummary.ts` | `buildActionLogSummary(log): ActionLogSummary` 추가 |
| `src/sidepanel/lib/buildAiDraftPrompt.ts` | `AiDraftContext`/`AiDraftSessionContext`에 `actionLogSummary?`, video/freeform 블록에 참고 메타 출력 |
| `src/sidepanel/tabs/DraftingPanel.tsx` / `AiDraftDialog.tsx` | `actionLogSummary` 인자 전달 |
| `src/types/log-viewer.ts` | `LogViewerData`에 `actionLog: ActionLog \| null` + `actionLogJson: object \| null`(다운로드용) 추가 |
| `src/sidepanel/lib/buildLogsHtml.ts` | 시그니처에 `actionLog` 인자 추가, `data.actionLog`/`actionLogJson` 주입 |
| `src/sidepanel/lib/buildCaptureFiles.ts` | `BuildCaptureFilesInput`에 `actionLog?` 추가. `buildLogsHtml` 호출 시 **`captureMode === "video"`일 때만** actionLog 전달, freeform/screenshot은 null. video일 때 `action-log.json`을 `jsonLogs`에 푸시 |
| `src/log-viewer/App.tsx` | `LogTab`에 `"action"`, `grid-cols-2`→`grid-cols-3`, Actions TabsTrigger/TabsContent + `ActionLogContent` 렌더 + 다운로드 버튼, empty/disabled 가드 |
| `src/log-viewer/i18n.ts` | `actionLog.*`(필터·검색·마스킹·kind·empty) 키 ko/en 동시 추가 (`consoleLog.*` 미러) |
| `src/i18n/ko.ts` / `src/i18n/en.ts` | `ActionLogContent`가 `consoleLog.*`처럼 양 사전에서 키를 찾는다면 `actionLog.*` 미러 추가 (ko/en 동시). **`debug.tab.actions` 등 서브탭 키는 추가 안 함.** |

> 이슈 제출 시 `buildCaptureFiles` 호출부 두 곳: 에디터 직접 제출(store `actionLog`)과 저장된 draft 제출(`getActionLog(issue.actionLogBlobKey)`). network/console과 동일 가드.

## 데이터 흐름

```
[MAIN world] action-recorder.ts (페이지마다 새 인스턴스)
  document_start부터 무조건 버퍼링 (console-recorder 동형)
  click(capture) / input+change / history patch+popstate+hashchange
  → buffer (FIFO 1000, 같은 필드 연속 입력은 in-place 갱신)
  ── CustomEvent __bugshot_action_data__{sentinel} ──▶
[Isolated] picker.ts handleActionData
  ── chrome.runtime.sendMessage actionRecorder.data ──▶
[Side panel] usePickerMessages — consoleRecorder.data 핸들러 1:1 복제
  isLogFrozen 게이트 → lastLogClearAt 필터
  → mergeLogItems(existing.entries, incoming, e=>e.timestamp, ACTION_MAX_ENTRIES)
  → rebuildActionLog → setActionLog + saveActionLog(`pending:${tabId}`)
        │
        ├─[video-record]  녹화 중 store 미-clear → mergeLogItems가 cross-navigation 누적
        ├─[30s-replay]    capture()에서 trimByTime(윈도우) (network/console과 동일)
        │
        └─ confirmDraft  selectAttachedLogs → persistAttachedLogs(pending → issueId)
[소비자]
  AI:        buildActionLogSummary(actionLog) → buildAiDraftPrompt 참고 메타 (video/freeform)
  log-viewer: 제출 시 captureMode "video"면
              buildCaptureFiles → buildLogsHtml(actionLog) → LogViewerData.actionLog
              → log-viewer App.tsx 'Actions' 탭 (ActionLogContent)
```

`actionRecorder.data` 핸들러는 `usePickerMessages`의 `consoleRecorder.data` 케이스(라인 146-167)를 **그대로 복제**한다 — `isLogFrozen` 게이트, `lastLogClearAt` 필터, `mergeLogItems`(id-dedup), `rebuildActionLog`, `saveActionLog(`pending:${tabId}`)`. `logClear` 핸들러(라인 115-122)에도 `store.clearActionLog(myTabId)`를 network/console 옆에 추가한다.

### 라이프사이클 미러 매핑 (console → action)

| 단계 | console | action (동일하게) |
|---|---|---|
| 백그라운드 주입 | `activateConsoleRecorder` (`useBackgroundRecorder.inject`) | `activateActionRecorder` |
| 비-녹화 페이지 이동 clear | `clearConsoleRecorder` + `consoleLog: null` | `clearActionRecorder` + `actionLog: null` |
| data 수신 누적 | `mergeLogItems` + `saveConsoleLog(pending)` | `mergeLogItems` + `saveActionLog(pending)` |
| logClear | `store.clearConsoleLog` | `store.clearActionLog` |
| drafting 이후 동결 | `isLogFrozen` | `isLogFrozen` (동일 함수) |
| 녹화 시작 초기화 | `deleteConsoleLog(pending)` + `clearConsoleRecorder` + `startRecording`이 `...initial`로 store 리셋 | `deleteActionLog(pending)` + `clearActionRecorder` + 동일 리셋 |
| 30s-replay capture trim | `trimByTime` + `saveConsoleLog(pending)` | `trimByTime` + `saveActionLog(pending)` |
| 모드 진입 보존 | `preserveLogs` (`consoleLog`/`consoleLogAttach`) | `preserveLogs`에 `actionLog`/`actionLogAttach` |
| 첨부 선택 | `selectAttachedLogs` (`attach && captured>0`) | 동일 조건 |
| 영속화 | `persistAttachedLogs`(pending→issueId) | 동일 함수에 action 추가 |
| 제출 후 정리 | `onSubmitted`에서 `consoleLog: null` | `actionLog: null` |
| 세션 snapshot | `EditorSnapshot`에 `consoleLogAttach` + `snapshotFromState` 수동 복사 | `actionLogAttach` 동일 |

**알려진 한계**(로그와 공유): 클릭 직후 즉시 페이지 unload 시 그 페이지 MAIN world 버퍼의 미-sync entry가 소실될 수 있다. 새 페이지의 `navType:"load"` entry로 네비게이션 자체는 보존. 클릭→즉시이동 1건 손실은 수용.

## 인터페이스 설계

### `src/types/action.ts`

```typescript
export type ActionEntryKind = "click" | "navigation" | "input";

export interface ActionEntry {
  id: string;            // crypto.randomUUID — dedup 키 (mergeLogItems가 요구)
  kind: ActionEntryKind;
  timestamp: number;     // 절대 epoch ms (mergeLogItems/trimByTime getter)
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
  totalSeen: number;     // NetworkLog/ConsoleLog와 동일 컨벤션 (rebuildActionLog가 채움)
  captured: number;
  entries: ActionEntry[];
}

export type ActionLogSummary = string[];   // 자연어 줄 배열 (AI 프롬프트 메타)
```

`ActionEntry`는 `{ id: string }` + 시간 getter를 만족하므로 `mergeLogItems<T extends { id: string }>`/`trimByTime`을 **신규 함수 없이** 그대로 탄다.

### `src/content/action-recorder-helpers.ts` (순수 함수 — 테스트 대상)

```typescript
export interface MaskFieldInput {
  type?: string; name?: string; id?: string; autocomplete?: string;
}
export function shouldMaskField(input: MaskFieldInput): boolean;
export function maskValue(value: string): string;            // → "***"

export interface DescribeTargetInput {
  tag: string; role?: string | null; accessibleName?: string | null; selector: string;
}
export function describeActionTarget(input: DescribeTargetInput): string;

export function buildLightSelector(el: Element): string;     // tag#id.class:nth-child path
export function inputDedupKey(selector: string): string;     // 같은 필드 연속 입력 in-place 갱신용
```

- `shouldMaskField`: `type==="password"`면 즉시 true. `autocomplete`에 `password`/`cc-` 포함 시 true. `name`/`id`를 lowercase로 `password|secret|card|cvv|ssn|token|pwd|auth|pin` 정규식 검사.
- `describeActionTarget`: `accessibleName`이 있으면 `"{name} {role 한국어}"` 형태, 없으면 `selector` 폴백. 긴 텍스트 truncate.
- `buildLightSelector`: `id` 있으면 `#id`, class만 있으면 `tag.class`, 무속성이면 `:nth-child` path. 경량성 우선.

### picker 메시지 타입 / picker-control / blob-db

`actionRecorder.*` 메시지 union, `activate/stop/sync/clearActionRecorder` 함수, `saveActionLog/getActionLog/deleteActionLog/getActionLogKeys/clearActionLogs` 모두 **console 대응을 그대로 복제**한다. `DB_VERSION` 5→6, `actionLogs` store는 `objectStoreNames.contains` 가드 후 `createObjectStore` — 기존 store 보존, 마이그레이션 코드 불필요. `syncActionRecorder`는 라이브 서브탭이 없으므로 30s-replay capture·video stop 시점 tail flush에만 쓴다(폴링 없음).

### log-viewer 통합

```typescript
// src/types/log-viewer.ts
export interface LogViewerData {
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  actionLog: ActionLog | null;          // 신규
  har: object | null;
  consoleLogJson: object | null;
  actionLogJson: object | null;         // 신규 (다운로드용)
  meta: { version: string; createdAt: string; pageUrl: string; issueUrl?: string };
}

// src/sidepanel/lib/buildLogsHtml.ts
export function buildLogsHtml(
  networkLog: NetworkLog | null,
  consoleLog: ConsoleLog | null,
  actionLog: ActionLog | null,          // 신규 (로그 그룹에 묶어 추가, pageUrl 앞)
  pageUrl: string,
  issueUrl?: string,
): string;
```

`buildCaptureFiles`는 현재 `video|freeform|screenshot`에 `logs.html`을 만든다. **actionLog는 `captureMode === "video"`일 때만** `buildLogsHtml`에 넘기고(나머지는 null), video일 때 `action-log.json`을 `jsonLogs`에 푸시한다.

`src/log-viewer/App.tsx`: `LogTab`에 `"action"`, `TabsList` `grid-cols-2`→`grid-cols-3`, `MousePointerClick` 아이콘 TabsTrigger + count Badge, `data-[state=inactive]:hidden` TabsContent에 `ActionLogContent`(`flush` + `startedAt={data.actionLog.startedAt}`). `hasAction = !!data?.actionLog` — 없으면 trigger disabled, `entries.length === 0`이면 enable하되 "캡처된 액션 없음" 빈 상태. footer에 `action-log.json` 다운로드.

`ActionLogContent`는 **`ConsoleLogContent`의 row style을 그대로 재사용**한다 — `[상대시간 w-10 mono] [아이콘] [텍스트]` 레이아웃, `formatRelativeTime` `MM:SS`, 그리고 `LevelIcon`/`levelColor`/`levelBgColor` 메커니즘을 `level` 대신 `kind`로 갈아끼운 `KindIcon`/`kindColor`/`kindBgColor`. 헤더 필터탭+검색·빈 상태·ScrollArea·tail 자동스크롤도 동일. **확장(`EntryAccordion`)만 제거 — 단일 행**(action 본문은 접어둘 큰 페이로드가 없음). 새 색 토큰은 도입하지 않고 콘솔 슬롯을 그대로 쓴다.

본문 구성만 레퍼런스(Jam repro-steps)를 참고:

- `KindIcon` 3종: `MousePointerClick`(click) / `Keyboard`(input) / `Navigation`(navigation) — 타임스탬프 우측, 콘솔 `LevelIcon`과 같은 위치.
- 텍스트(아이콘이 동사 역할 → 주어만):
  - click → `target`(자연어; 없으면 `selector` 폴백)
  - input → `fieldLabel · "value"`, masked면 값 자리에 `<Badge variant="secondary">***</Badge>`. 긴 값 truncate + `title`.
  - navigation → `{toUrl}로 이동` + navType 사유(`링크`/`history API`(push·replace)/`뒤로·앞으로`(popstate)/`해시 변경`/`페이지 로드`(load)). `toUrl`은 콘솔 `pageUrl` 링크 스타일 그대로 `<a target=_blank>`.
- `kindColor`/`kindBgColor`: 레퍼런스처럼 **navigation 행만 강조**(콘솔의 info-틴트 슬롯 재사용 — `kindBgColor(navigation)`=`levelBgColor("info")` 동일 값), click/input은 중립(콘솔 `log`/`debug`과 동일 = 무배경 foreground). severity와 의미 충돌은 Actions 탭 안에 error/warn 행이 없으므로 없음.
- 필터: `all/click/navigation/input`(`ConsoleLogContent.availableFilters` 패턴 — 존재하는 kind만 노출).
- 검색: `target`/`fieldLabel`/`value`/`toUrl` 텍스트 대상.

### AI 프롬프트

`AiDraftContext`/`AiDraftSessionContext`에 `actionLogSummary?: ActionLogSummary`. video/freeform 프롬프트 블록에 `- User actions (reference):` 섹션 출력 + Rules에 "context only — do not copy verbatim into stepsToReproduce" 명시. `stepsToReproduce` 지시는 불변. `buildActionLogSummary(log)`는 최근 N개 액션을 자연어 줄로 변환(masked input은 값 `***`).

## 데이터 흐름 — action-recorder.ts 캡처 상세

`CTRL_KEY = "__bugshot_action_ctrl__"`, 이벤트 prefix `__bugshot_action_`. `console-recorder`의 sentinel 구조 복제.

- **클릭/탭**: `document.addEventListener("click", h, true)` (capture phase). `closest()`로 인터랙티브 조상(`button`, `a`, `[role=button]`, `input[type=submit]`) 탐색, 없으면 target. overlay shadow host(`HOST_ID`) 내부 클릭 제외.
- **페이지 이동**: 일반 네비게이션은 document_start 로드 시 `navType:"load"` push. SPA는 `history.pushState`/`replaceState` monkey-patch(original 보관 후 호출, `CTRL_KEY` 가드) + `popstate`/`hashchange`. `fromUrl`/`toUrl` 기록.
- **텍스트 입력**: `input`(capture)+`change`. `<input>`/`<textarea>`/`[contenteditable]`. 같은 `inputDedupKey(selector)` 연속 입력은 버퍼 내 마지막 entry in-place 갱신. `shouldMaskField` 판정 후 `value` 또는 `"***"` + `masked: true`.
- 버퍼: `MAX_ENTRIES = 1000` FIFO. `dispatch()`는 `buffer.slice()` 전송.

## 기존 패턴 준수

- **레코더 패턴**: MAIN world IIFE 자가호출, sentinel 제어, CustomEvent 통신, FIFO cap — console/network 동일.
- **로그 라이프사이클 1:1**: 위 "라이프사이클 미러 매핑" — 같은 헬퍼·같은 phase 훅 공유. 특수 경로 없음.
- **순수 헬퍼 분리 + 테스트**: 마스킹·셀렉터·설명 로직 분리 + vitest.
- **trim/merge 재사용**: 신규 함수 없이 `mergeLogItems`/`trimByTime` 제네릭 그대로.
- **세션 영속화**: `EditorSnapshot`에 `actionLogAttach` 추가 시 `useEditorSessionSync.snapshotFromState()` 수동 복사 추가 필수(누락 시 런타임 소실).
- **i18n 동시 갱신**: `src/log-viewer/i18n.ts`(+ 필요 시 `src/i18n/`)에 `actionLog.*` ko/en 동시. `log-viewer/__tests__/i18n.test.ts` 대칭 검증.
- **외과적 변경**: `usePickerMessages`에 새 케이스만 추가, 인접 코드 불변.

## 대안 검토

### 대안 A — action 전용 라이프사이클(별도 누적/clear/persist 경로)
액션에만 특수 cross-navigation 누적·세션 경계를 둠. → **불채택(사용자 결정).** 로그와 다른 라이프사이클은 UX 비일관(액션과 로그가 다르게 동작)·운영 복잡(DB 정리·pending 키·attach 분기 이원화)을 부른다. `mergeLogItems`가 이미 id-dedup 누적이라 로그 라이프사이클을 그대로 쓰면 cross-page 누적·트림이 공짜로 따라온다.

### 대안 B — MAIN world 버퍼를 `sessionStorage`로 페이지 가로질러 유지
→ **불채택.** origin 격리로 cross-origin에서 끊김 + MAIN world 가중. store merge가 origin 무관하게 단순.

### 대안 C — `stepsToReproduce` 섹션에 액션 목록 자동 주입
→ **불채택(사용자 명시 제외).** raw 액션은 노이즈가 많고 사용자/AI 작성 섹션 덮어쓰면 마찰. AI 메타로만 제공.

### 대안 D — 라이브 사이드패널 'Actions' 서브탭 추가
→ **불채택(사용자 결정).** 제출 후 log-viewer로 충분, ~400px에서 4-tab 라벨 깨짐. 필요 시 후속에서 `ActionLogContent`를 `ActionSubTab`으로 감싸면 됨.

### 대안 E — `chrome.debugger` / DevTools Protocol
→ **불채택.** `debugger` 권한 배너·승인 마찰. content script DOM 이벤트로 충분, 새 권한 0건.

## 위험 요소

- **`DB_VERSION` 6 bump**: `contains` 가드로 기존 store 보존, `actionLogs`만 추가 — 무손실. 타 탭 v5 연결 시 `onblocked` 기존 처리.
- **`buildLogsHtml` 시그니처 변경**: 호출부(`buildCaptureFiles`)·테스트(`__tests__/buildLogsHtml.test.ts`) 함께 갱신. network/console-only 케이스 테스트 유지(회귀).
- **log-viewer XSS**: 마스킹 안 된 입력값(`value`)이 인라인된다. `buildLogsHtml`이 `JSON.stringify(...).replace(/</g, "\\u003c")`로 이스케이프 — action `value`도 동일 경로 보호. 테스트로 고정.
- **클릭 노이즈**: shadow host 내부 제외 + 인터랙티브 조상 없으면 selector만.
- **입력 마스킹 누락**: `name`/`id` 없는 커스텀 컴포넌트는 힌트 부족. contenteditable은 부모 password 힌트 보수적 판정. 완전 방어 불가 — PRD 엣지로 명시.
- **30s-replay trim out**: 윈도우가 좁아 전부 잘리면 `entries: []` → 빈 상태. 단위 테스트 `trimByTime(actions, ..., 10, 20) → []`.
- **`issues-store` 타입 변경**: `actionLogBlobKey` optional — 마이그레이션 불요. `ISSUES_STORE_VERSION` 주석에 한 줄 추적성.

## video-report 통합 (후속)

영상-로그 시간 동기화 타임라인 player(`docs/features/video-report-player/`)는 미구현 스펙이다. 이번 범위의 소비자는 그 타임라인이 아니라 **이미 출시된 tabbed log-viewer**다.

player가 추후 구현될 경우 `LogViewerData.actionLog`(또는 `getActionLog(issue.actionLogBlobKey)`)를 읽어 `ActionEntry`를 상대 시간 마커/타임라인 행으로 병합하면 된다. 이번 작업으로 `ActionLog` 타입·`actionLogBlobKey` 영속화·`LogViewerData.actionLog` 데이터 계약이 준비되므로 데이터 소스를 그대로 재사용한다.
