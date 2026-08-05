# 자동 버그 감지 트리거 — 구현 태스크

## 선행 조건

- 권한·env·외부 API 변경 **없음**. `manifest.config.ts` 무변경.
- 새 의존성 **없음**(`tldts`는 `apiHostRow.ts`가 이미 쓴다).
- 착수 전 `docs/POSTMORTEM.md`를 다음 키워드로 grep: `replay`, `trim`, `AI 초안`, `취소 레인`, `console-recorder`, `pre-arm`, `원자성`.
- `pnpm test`가 green인 상태에서 시작(테스트 pre-훅이 `build:log-viewer`를 먼저 돌린다).
- **두 불변식을 먼저 읽는다** — design.md "두 개의 불변식"(원자성 / 트림 완료 전 drafting 소비 금지). Task 4·7·8이 전부 여기 걸린다.

---

## 태스크

### Task 1: `ConsoleEntry.source` 신호 구분

- **변경 대상**: `src/types/console.ts`, `src/content/console-recorder.ts`
- **작업 내용**:
  - `ConsoleEntry`에 `source?: "uncaught" | "rejection"` 추가.
  - **`console-recorder.ts:29-37`의 로컬 `CapturedEntry`도 함께 갱신한다.** MAIN world self-contained 제약 때문에 존재하는 손복제본이라, 한쪽만 고치면 typecheck는 통과하는데 필드가 안 실린다.
  - `pushEntry` 호출부가 **17곳**(`:84`~`:269`)이므로 4번째 positional 인자를 쓰지 않는다 → `pushUncaught(args, stack)` / `pushRejection(args, stack)` 얇은 래퍼 2개를 만들고 그 안에서만 `source`를 붙인다. 조건부 대입은 기존 `if (stack) entry.stack = stack` 패턴.
  - `window.addEventListener("error")`(`:246`) → `pushUncaught`, `unhandledrejection`(`:264`) → `pushRejection`.
  - **다른 어떤 경로에도 붙이지 않는다** — `console.error`/`warn` wrap, `console.assert`, `console.trace`는 기존 `pushEntry`를 그대로 쓴다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm check:prearm`이 여전히 통과(청크 self-contained 유지)
  - [ ] `pushEntry` 직접 호출부 어디에도 `source` 문자열이 없다(grep으로 확인 — 래퍼 2개 안에만 존재)
- **⚠ 자동 검증 불가 항목 → Task 10(e2e)·수동으로 이관**: `console-recorder.ts`는 `consoleRecorderScript()` 한 덩어리로 페이지에 주입되는 self-contained IIFE라 `pushEntry`를 유닛 테스트에서 부를 수 없다. 테스트되는 건 `console-recorder-helpers.ts`의 순수 함수뿐이고 `console-recorder.test.ts`는 **존재하지 않는다**. 아래 4개는 e2e/수동 판정이다:
  - uncaught error → `source === "uncaught"`
  - unhandled `Promise.reject()` → `source === "rejection"`
  - `console.error("x")` → `source === undefined`
  - `console.assert(false)` → `source === undefined` (level은 여전히 `"error"`)

### Task 2: `anomaly.ts` 감지 판정 순수 함수

- **변경 대상**: `src/sidepanel/lib/anomaly.ts` (신규), `src/sidepanel/lib/__tests__/anomaly.test.ts` (신규), `src/sidepanel/lib/apiHostRow.ts`
- **작업 내용**:
  - `design.md` 인터페이스대로 `detectAnomalies`·`anomalyTrimRangeMs`·`buildAnomalyPrompt`·`ANOMALY_TRIM_PAD_MS`·`ANOMALY_LIST_MAX` 구현.
  - **`apiHostRow.ts:22-31`의 `httpHostname`을 export**하고 `httpHostname → registrableDomain` 순서로 호출한다. `registrableDomain`(`:16`)은 **hostname을 받고** 파싱 실패 시 입력을 그대로 반환하므로, URL을 직접 넣으면 모든 비교가 조용히 실패해 신호 0건이 된다. 복제 금지.
  - network 신호 시각은 **`startTime + durationMs`**(응답 도착). `NetworkRequest`에 `timestamp`는 없다.
  - 사용자 취소 판정은 `statusText === "Aborted"`(XHR 전용) **+ `/abort/i` 패턴**(fetch의 DOMException 문구). 둘 중 하나면 제외.
  - WebSocket(`method === "WS"`)과 `phase === "pending"`(진행 중)은 신호가 아니다.
- **검증**:
  - [ ] `source` 없는 `level:"error"` 엔트리는 감지되지 않는다
  - [ ] `status: 500`·`status: 503`은 감지, `status: 404`·`401`은 미감지
  - [ ] `phase: "error"` + `statusText: "Aborted"` 미감지, `statusText: "The user aborted a request."` **미감지**, `"Timeout"`·`"Network Error"`는 감지
  - [ ] `method: "WS"` + `status: 101` + `phase: "error"`는 미감지
  - [ ] `phase === "pending"`인 진행 중 요청은 미감지
  - [ ] network 신호의 `timestamp`가 `startTime + durationMs`와 일치(30초 타임아웃 케이스로 고정)
  - [ ] `windowStart` 이전 타임스탬프는 제외된다
  - [ ] `pageUrl`이 `undefined`거나 `windowStart`가 `null`이면 빈 배열
  - [ ] `windowStart > now`(시계 역행)면 빈 배열
  - [ ] `pageUrl`이 `about:blank`·`file:///x`면 빈 배열
  - [ ] 다른 registrable domain의 오류는 제외, 같은 도메인의 서브도메인(`api.example.com`)은 포함
  - [ ] 같은 시그니처 500건 → `length === 1`, `count === 500`, `timestamp`=최초·`lastTimestamp`=최후
  - [ ] 같은 시그니처의 앞쪽만 창 밖으로 밀리면 `timestamp`가 **창 안 최초**로 갱신된다
  - [ ] 결과가 `timestamp` 오름차순
  - [ ] 시그니처 종류가 `ANOMALY_LIST_MAX` 초과 시 반환 배열은 전부 유지(잘라내기는 표시 계층 책임)
  - [ ] `anomalyTrimRangeMs`: 단일 시그니처면 span 6000ms, 빈 배열이면 `null`
  - [ ] `buildAnomalyPrompt`: 시그니처 label이 전부 포함, 빈 배열 방어

### Task 3: 프레임 축 변환 (`anomaly-trim.ts`)

- **변경 대상**: `src/sidepanel/30s-replay/anomaly-trim.ts` (신규), `src/sidepanel/30s-replay/__tests__/anomaly-trim.test.ts` (신규)
- **작업 내용**: `frameOffsetsMs`로 절대 ms → 프레임 축 초 변환. `[0, duration]` clamp. `frames`가 비면 `null`.
- **검증**:
  - [ ] 구간이 버퍼 전체를 덮으면 `startSec === 0`, `endSec === duration` → `applyReplayTrim`의 `isFullRange`가 true가 된다
  - [ ] 구간이 버퍼 앞쪽으로 넘치면 `startSec === 0`으로 clamp
  - [ ] 구간이 버퍼 뒤쪽으로 넘치면 `endSec === duration`으로 clamp
  - [ ] 중간 구간이면 프레임 오프셋과 일치(`frameOffsetsMs` 결과 대조)
  - [ ] `frames: []` → `null`

### Task 4: editor-store 상태 4종 + `onRecordingComplete` 시그니처 확장

- **변경 대상**: `src/store/editor-store.ts`, `src/sidepanel/hooks/useEditorSessionSync.ts`, `src/store/__tests__/editor-store*.test.ts`, `src/sidepanel/hooks/__tests__/useEditorSessionSync.test.ts`
- **작업 내용**:
  - `anomalySignals`·`anomalyTrimPending`·`anomalyDraftDone`·`anomalyDraftFailed` + setter 3개(`anomalySignals`는 setter를 만들지 않는다).
  - **`onRecordingComplete`에 7번째 인자 `anomaly?: AnomalySignal[] | null` 추가.** `phase: "drafting"`과 **같은 `set()`** 에 `anomalySignals`·`anomalyTrimPending = !!anomaly`·래치 2개 false를 전부 싣는다. `editor-store.ts:176-179`의 원자성 불변식(POSTMORTEM 2026-07-17) 대상이므로 **별도 setter로 이어 부르지 않는다.**
  - **영속화는 zustand `persist`가 아니다.** `EDITOR_SNAPSHOT_KEYS`(`:305-342`)와 `useEditorSessionSync.snapshotFromState()`(`:56-96`) **양쪽에** 등록한다(키 대칭 테스트가 유일한 그물). `anomalyTrimPending`도 복구 마커로 영속하고, hydrate에서 true면 원본 영상만 유지한 채 anomaly 상태를 폐기해 일반 작성 화면으로 복구한다.
  - `reset`·`cancelRecording`은 `...initial` 스프레드라 자동 청소.
- **검증**:
  - [ ] `onRecordingComplete(..., anomaly)` 호출 시 `subscribe`로 관측한 **모든 렌더에서** `phase === "drafting"`이면 `anomalySignals !== null`이 함께 성립한다(원자성 단언)
  - [ ] 같은 호출에서 `anomalyTrimPending === true`, 래치 2개 false
  - [ ] `anomaly`를 안 넘긴 일반 호출은 `anomalySignals === null`, `anomalyTrimPending === false` — **회귀 가드**
  - [ ] `reset()` 후 `anomalySignals === null`
  - [ ] 완료된 세션은 `hydrate(snapshot)` 왕복 후 `anomalySignals`·래치 2개가 보존된다
  - [ ] `anomalyTrimPending: true` snapshot을 hydrate하면 원본 영상은 유지되고 anomaly 상태·출처는 폐기된다
  - [ ] `EDITOR_SNAPSHOT_KEYS` ↔ `snapshotFromState()` 파리티 테스트 통과

### Task 5: 감지 훅 배선 + `capture` 시그니처 선행 확장

- **변경 대상**: `src/sidepanel/hooks/useAnomalyDetection.ts` (신규), `src/sidepanel/30s-replay/use-30s-replay.ts`, `src/sidepanel/30s-replay/replay-context.ts`
- **작업 내용**:
  - **`capture`를 `() => Promise<void>` → `(opts?: { anomaly: AnomalySignal[] }) => Promise<void>`로 시그니처만 먼저 확장한다.** anomaly 분기 구현은 Task 7. 이렇게 하지 않으면 Task 6이 Task 7의 산출물을 요구하는 순환 의존이 생긴다.
  - `use30sReplay` 반환에 `bufferOldestTs: number | null` 추가(표시용 1초 타이머와 같은 주기로 갱신 — 별도 타이머를 만들지 않는다). 현재 반환은 `{ isReady, isEncoding, bufferedSeconds, capture, resolveTrim }`. `ReplayContextValue`에도 반영(현재 `resolveTrim`은 미노출, `trimming` 노출).
  - `useAnomalyDetection`: `editor-store`의 `consoleLog`/`networkLog` 구독 + `chrome.tabs.get`으로 `pageUrl` 추적(`useTabUnsupported`의 seq 가드 패턴 복제 — 늦게 온 응답이 최신 판정을 덮지 않게). `enabled`가 false면 빈 배열을 반환하고 리스너를 걸지 않는다.
  - **결과 배열을 ref로 안정화한다.** 각 신호의 `signature`·`timestamp`·`lastTimestamp`·`count`가 모두 같을 때만 같은 배열 참조를 반환한다 — 200ms flush마다 새 배열을 그대로 흘리면 zustand v5 + `useSyncExternalStore`가 `getSnapshot should be cached`로 무한 루프를 낸다.
  - **판정 조건을 이 훅에 두지 않는다.** `detectAnomalies` 호출만.
- **검증**:
  - [ ] `enabled: false`면 항상 빈 배열이고 `chrome.tabs.onUpdated` 리스너가 등록되지 않는다
  - [ ] 로그가 갱신되면 반환 배열이 갱신된다
  - [ ] `signature`·`timestamp`·`lastTimestamp`·`count`가 모두 같은 로그 flush만 반환 배열 참조를 유지한다
  - [ ] 같은 시그니처가 다시 발생해 시각·횟수가 바뀌면 새 배열을 반환한다
  - [ ] 탭 URL이 바뀌면 재판정된다
  - [ ] 기존 `capture()` 무인자 호출부가 전부 그대로 컴파일된다 — **회귀 가드**

### Task 6: 배지 + 감지 내역 다이얼로그

- **변경 대상**: `src/sidepanel/tabs/AnomalyDialog.tsx` (신규), `src/sidepanel/tabs/IssueTab.tsx`, `src/sidepanel/tabs/__tests__/AnomalyDialog.test.tsx` (신규), `src/sidepanel/tabs/__tests__/IssueTab.test.tsx`, `src/i18n/namespaces/issue.ts`
- **작업 내용**:
  - **훅은 `IssueTab`에서 돌리고 `EmptyState`에는 `anomalyCount: number`·`onOpenAnomaly: () => void` prop으로 주입한다.** `EmptyState`는 provider 없이 직접 렌더되는 순수 프레젠테이션 컴포넌트라, 훅을 안에 넣으면 기존 `IssueTab.test.tsx` 14개가 전부 mock을 요구한다. 기존 `CAPTURE_BUTTONS` 5개 단언과 "미지원이면 5개 전부 사라진다" 테스트도 함께 갱신한다.
  - 배지: **`<button>` 래퍼 + shadcn `<Badge>`**(플랫폼 status badge 9곳 관용구). `data-testid="anomaly-badge"`. 노출 조건 = `replayEnabled && isReady && !unsupported && anomalyCount > 0`, `isEncoding`이면 비활성. 위치는 제목 아래·캡처 버튼 열 위, `CONTENT_MAX_W` 안. **`min-h`로 슬롯 높이를 예약**해 배지 등장/소멸이 캡처 버튼 5개를 밀지 않게 한다. 버튼은 네이티브 역할과 기존 status badge 포커스 링을 유지하고, 별도 sr-only live region에 `role="status" aria-live="polite"`를 둔다.
  - `AnomalyDialog`: 읽기 전용 목록 + [닫기]/[이슈 작성].
    - 클래스 전체: `w-[90vw] max-w-[800px] gap-5 rounded-3xl p-6 sm:rounded-3xl` + **`max-h-[80vh]`**, 본문 래퍼 `min-h-0 flex-1 overflow-y-auto overscroll-contain`.
    - 푸터 `!flex-row items-center !justify-end gap-2`, DOM 순서 `[닫기 outline] → [이슈 작성 default]`. X 버튼은 `dialog.tsx:44-47` 내장이므로 직접 넣지 않는다. 닫기 라벨은 `common.close`.
    - 각 행은 **2행 스택**: 1행 = 아이콘 `h-4 w-4 shrink-0` + `min-w-0 flex-1 line-clamp-2`, 2행 = `12:31:04 · console`(`text-xs text-muted-foreground`). 2줄을 넘길 때만 포커스 가능한 Radix Tooltip으로 전문을 제공한다.
    - `ANOMALY_LIST_MAX`(20) 초과분은 "외 N종"으로 접는다.
    - **open 시점의 signals를 스냅샷 고정**하고 이후 갱신을 무시한다.
    - `DialogDescription` 필수 — 목록의 의미 + [이슈 작성]이 영상을 자동으로 자르고 AI 초안을 만든다는 것. `logsAttach`가 off면 "로그 첨부가 꺼져 있어 오류 내역이 본문에 남지 않습니다"를 덧붙인다.
    - capture 직전 재필터 결과가 0건이면 캡처하지 않고 "오류 구간이 만료되었습니다" 상태를 표시한다.
    - 320×400 저높이에서 중앙 영역만 세로 스크롤한다.
  - i18n 키 ko/en 동시 추가: `issue.anomaly.badge`(`감지 신호 {n}종`), `issue.anomaly.title`, `issue.anomaly.description`, `issue.anomaly.descriptionNoLogs`, `issue.anomaly.start`(`[이슈 작성]`), `issue.anomaly.expired`, `issue.anomaly.more`(`외 {n}종`), `issue.anomaly.trimmed`(토스트), `issue.anomaly.aiPrompt`.
- **검증**:
  - [ ] `anomalyCount: 0`이면 배지가 렌더되지 않는다(슬롯 높이는 유지)
  - [ ] `replayEnabled: false`면 신호가 있어도 배지가 없다
  - [ ] `isReady: false`면 배지가 없다
  - [ ] `isEncoding: true`면 배지가 비활성이다
  - [ ] 배지는 `button` 역할을 유지하고 별도 live region에 `role="status"`가 있다
  - [ ] 배지 클릭 → 다이얼로그 open
  - [ ] 시그니처 2종이면 목록 행이 2개, 각 행이 2줄(메시지 + `시각 · 종류`)
  - [ ] 시그니처 25건이면 행 20개 + "외 5종"
  - [ ] open 이후 signals prop이 바뀌어도 목록이 변하지 않는다(스냅샷 고정)
  - [ ] `logsAttach: false`면 description에 로그 미첨부 고지가 포함된다
  - [ ] [이슈 작성] 클릭 시 `capture({ anomaly })`가 호출된다
  - [ ] 재필터 결과가 0건이면 capture가 호출되지 않고 만료 상태가 보인다
  - [ ] 기존 `IssueTab.test.tsx` 14개가 전부 green — **회귀 가드**
  - [ ] i18n 훅이 `locales.test.ts`를 통과시킨다(ko/en 대칭·placeholder 일치)

### Task 7: 감지 캡처 경로 (auto trim)

- **변경 대상**: `src/sidepanel/30s-replay/use-30s-replay.ts`, `src/sidepanel/App.tsx`, `src/sidepanel/tabs/IssueTab.tsx`, `src/sidepanel/hooks/useReproPrefill.ts`, `src/sidepanel/30s-replay/__tests__/use-30s-replay-gate.test.tsx`
- **작업 내용**: `capture(opts?)`의 anomaly 분기 구현.
  - 로그 buffer 구간 trim(`logLower = frames[0].timestamp - 1500ms`) 후 **남은 구간으로 signals를 재필터**한다 — 배지를 보고 클릭하기까지 수 초가 지나면 감지 신호의 로그가 이미 잘려나가 AI가 첨부 로그에 없는 오류를 서술하게 된다.
  - `onRecordingComplete(..., trim = null, filteredSignals)` — 트림 다이얼로그를 띄우지 않고, 같은 `set()`에 signals와 `anomalyTrimPending: true`가 실린다.
  - **`trimming` 소비처 3곳에 `anomalyTrimPending`을 OR로 합친다**: `App.tsx:239`(`trimming: replayTrim != null`) → `IssueTab.tsx:224`(DraftingPanel 마운트 보류) → `useReproPrefill.ts:88`. 합치지 않으면 `encodeToMp4` 왕복 동안 AI가 **자르기 전 로그**로 돌고 영상이 눈앞에서 교체된다.
  - 이어서 `anomalyTrimRangeMs` → `anomalyTrimSeconds` → `applyReplayTrim({ frames, tabId, startSec, endSec })`. **자체 try/catch로 감싼다** — `capture()`의 기존 catch는 `toast.error("encodeFailed")` 하나뿐이라 `TrimLogsPersistError`(영상은 잘렸는데 원본 로그가 pending에 남아 재오픈 시 부활)와 일반 실패가 같은 문구로 뭉개진다. `App.tsx:492-500`의 분기를 그대로 쓴다.
  - network 로그는 요청 생명주기(`[startTime, startTime + durationMs]`)가 영상 트림 구간과 겹치면 보존한다. console/action은 기존 경계 판정을 유지한다.
  - `finally`에서 `setAnomalyTrimPending(false)`.
  - **순서 불변**: 기존 버퍼 구간 로그 trim → `onRecordingComplete` → `applyReplayTrim`. 뒤집으면 넓은 경계가 좁은 경계를 덮는다. (트림을 앞에 두는 것도 불가 — phase가 `idle`이라 `syncAndSettleLogs`가 레코더 버퍼를 다시 머지해 되살린다.)
- **검증**:
  - [ ] anomaly 캡처 후 `replayTrim === null`(다이얼로그 미노출)
  - [ ] `anomalySignals`가 store에 실리고 `phase === "drafting"`과 같은 렌더에서 관측된다
  - [ ] `anomalyTrimPending`이 trim 진행 중 true, 완료 후 false
  - [ ] trim 진행 중에는 `trimming` 합성값이 true라 DraftingPanel이 마운트되지 않는다
  - [ ] `applyReplayTrim`이 계산된 `startSec`/`endSec`로 호출된다
  - [ ] 감지 구간이 버퍼 전체면 `applyReplayTrim`이 재인코딩 없이 반환한다(`videoTrimmed === false`, **로그도 잘리지 않는다**)
  - [ ] `TrimLogsPersistError`와 일반 실패가 서로 다른 토스트를 낸다
  - [ ] trim 실패해도 `phase === "drafting"`이 유지되고 원본 영상이 남는다
  - [ ] 감지 시각이 로그 trim 하한보다 오래됐으면 그 signal이 재필터로 빠진다
  - [ ] 시작은 구간 밖이지만 완료가 구간 안인 느린 5xx·타임아웃 요청은 로그에 남는다
  - [ ] 자동 트림 중 패널 종료 후 hydrate하면 원본 영상은 유지되고 anomaly 상태·계측 출처는 폐기된다
  - [ ] 일반 `capture()`(인자 없음)는 기존대로 트림 다이얼로그를 띄운다 — **회귀 가드**

### Task 8: AI 초안 자동 실행 + 폴백 체인

- **변경 대상**: `src/sidepanel/tabs/AiDraftDialog.tsx`, `src/sidepanel/tabs/DraftingPanel.tsx`, `src/sidepanel/hooks/useReproPrefill.ts`, `src/sidepanel/tabs/__tests__/DraftingPanel.test.tsx` (신규), 각 `__tests__`
- **작업 내용**:
  - `handleSubmit(overrideMsg?: string)` — `const msg = (overrideMsg ?? input).trim()`. `overrideMsg`가 있으면 `setInput("")`·`onOpenChange(false)`를 건너뛴다(다이얼로그가 애초에 안 열려 있다).
  - `autoRunPrompt?: string | null`·`onAutoRunError?: () => void` prop. effect가 `autoRunPrompt`를 1회 소비(ref 래치 + store의 `anomalyDraftDone`).
  - **`aiStatus` 게이트는 `DraftingPanel`에 둔다.** `AiDraftDialog`에는 `aiStatus` prop이 없고(`:67-79`) 이 값은 `DraftingPanel.tsx:109`의 `useAI()`에서만 나온다. prop을 새로 뚫지 않는다.
  - `DraftingPanel`: `aiStatus === "available" && anomalySignals && !anomalyDraftFailed && !anomalyDraftDone`일 때만 `buildAnomalyPrompt(signals, t)`를 넘긴다. `onAutoRunError` → `setAnomalyDraftFailed(true)`. 성공·중단 모두 `setAnomalyDraftDone(true)`.
  - 자동 트림 사후 고지: drafting 진입 후 `toast.info(t("issue.anomaly.trimmed"))` 1회(`anomalySignals && videoTrimmed && videoTrimSource === "frames"`일 때만).
  - `useReproPrefill`: args에 `anomalyPending: boolean` 추가하고 `if (anomalyPending) return;` 게이트. **`anomalyPending = !!anomalySignals && !anomalyDraftFailed`** — 실패한 경우에만 재현 단계 자동 채움으로 폴백하고, 전체 초안 성공·사용자 중단 뒤에는 추가 자동화를 실행하지 않는다. **명시 deps 배열(`:154-169`)에도 `anomalyPending`을 반드시 추가**한다.
  - `submitDisabled`는 건드리지 않는다(사용자 UI 경로 불변).
  - **`DraftingPanel.test.tsx`는 존재하지 않으므로 신규 작성한다.** tiptap·sonner 그래프를 끌어오므로 `DebugTab.test.tsx:7-19`식 스텁을 먼저 설계한다.
- **검증**:
  - [ ] `autoRunPrompt`가 주어지면 다이얼로그가 열리지 않은 채 AI가 1회 실행된다
  - [ ] 재마운트해도 두 번 실행되지 않는다(`anomalyDraftDone` 래치)
  - [ ] `aiStatus: "unavailable"`이면 `DraftingPanel`이 `autoRunPrompt`를 넘기지 않는다
  - [ ] 자동 실행 중에는 `useReproPrefill`이 미발화
  - [ ] 자동 실행 실패 → `anomalyDraftFailed: true` → `useReproPrefill`이 발화
  - [ ] 자동 실행 중단 → `anomalyDraftFailed`는 false, `anomalyDraftDone`은 true → 빈 이슈 작성 폼에 머물고 repro prefill은 미발화
  - [ ] 자동 트림 토스트는 `videoTrimmed && videoTrimSource === "frames"`인 감지 경로에서만 1회 뜬다
  - [ ] `autoRunPrompt: null`(일반 캡처)이면 기존 동작 그대로 — **회귀 가드**
  - [ ] 사용자가 다이얼로그를 직접 열어 쓰는 경로가 그대로 동작 — **회귀 가드**

### Task 9: 설정 기본값 + 계측

- **변경 대상**: `src/store/settings-ui-store.ts`, `src/sidepanel/lib/track-submit.ts`, `src/background/analytics.ts`, 각 `__tests__`
- **작업 내용**:
  - `replayEnabled` 초기값 `false` → `true`. **`migrate` 분기를 추가하지 않는다.** 영향 범위는 prd.md "기본값 변경" 절 참조 — "기존 사용자 무영향"이 **아니다**.
  - `submitEventProperties`/`trackSubmit`에 `fromAnomaly` 인자 → `from_anomaly` 속성. 호출부에서 `!!anomalySignals`를 넘긴다.
  - `ALLOWED_EVENTS.issue_submitted`에 `"from_anomaly"` 추가.
- **검증**:
  - [ ] 새 store 인스턴스의 `replayEnabled === true`
  - [ ] persist된 `{ replayEnabled: false }`를 복원하면 여전히 `false`
  - [ ] **`{ version: 5, state: { …replayEnabled 키 없음 } }`를 `migrateSettingsUi`에 통과시키면 `true`가 된다** — 의도된 동작임을 테스트로 고정(v9 미만에서 올라오는 사용자가 조용히 on이 되는 경로)
  - [ ] `submitEventProperties`를 `filterProperties`에 통과시켜 `from_anomaly`가 살아남는다(양쪽 계약 대조 테스트 — v1.7.0에서 `trim_source`가 이 갭으로 드롭된 전례. 기존 왕복 그물이 `analytics.test.ts:97-98`에 있으므로 거기에 얹는다)

### Task 10: e2e (배지 노출까지)

- **변경 대상**: `e2e/anomaly-capture.spec.ts` (신규), `e2e/fixtures/anomaly.html` (신규)
- **스코프**: **배지 노출·목록 표시까지만.** 캡처 이후(트림·drafting 진입·AI 자동 실행)는 수동으로 내린다. 근거는 design.md "e2e 스코프" — replay 의존 spec 5개가 같은 이유로 삭제된 전례(`e2e/GOTCHAS.md:8`), isReady 6초 연속 폴링, `tab.active` 가드, `captureVisibleTab` quota의 확장 전역 성격.
- **작업 내용**:
  - 공용 extension fixture는 Replay를 off로 초기화해 전역 `captureVisibleTab` quota 경합을 막는다. 기본값 검증과 이 spec만 명시적으로 on으로 켠다.
  - `e2e/capture-modes-layout.spec.ts`의 "기본 off" 단언은 기본 on 계약 검증으로 갱신하고, off→설정 이동은 spec 안에서 명시적으로 토글한 상태로 유지한다.
  - 픽스처 버튼 4개 — 5xx 요청 / uncaught throw / **XHR abort** / **fetch abort**(두 경로가 다르게 취급되므로 반드시 분리).
  - `test.describe.serial`로 묶어 `captureVisibleTab` quota 경합을 줄인다.
  - ready 대기 신호는 `replay-button`의 `aria-disabled` 해제를 기다린다(고정 sleep 금지).
  - Task 1의 이관 항목(uncaught/rejection/`console.error`/`console.assert`의 `source` 구분)을 배지 유무로 간접 판정한다 — `e2e/fixtures/pages/console-error.html`이 이미 uncaught를 낸다.
- **검증**: 아래 "e2e 시나리오" 참조

### Task 11: 문서

- **변경 대상**: `docs/DIRECTORY.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `docs/privacy.ko.md`·`docs/privacy.en.md`, `README.md`·`README.ko.md`, `docs/CI.md`
- **작업 내용**:
  - DIRECTORY: 신규 파일 7개 등록.
  - ARCHITECTURE: "자동 버그 감지 트리거" 섹션 — 게이트 단일 출처, 시간축(network는 `startTime + durationMs`), `applyReplayTrim` 재사용, **원자성·`anomalyTrimPending` 두 불변식**, 호출 순서 불변식, 폴백 체인(중단 vs 실패 구분).
  - CLAUDE.md: 게이트웨이/스택 항목에 한 줄. `replayEnabled` 기본값 변경 명시.
  - privacy ko/en: `issue_submitted`의 `from_anomaly` 속성 + **기본값 변경으로 "설정을 바꾼 적 없는 기존 사용자 포함" 리플레이 폴링이 켜진다**는 사실(현재 문서의 "30초 리플레이 활성화 시" 조건부 수집 서술을 정정). 자동 트림이 `replay_trimmed`를 세워 "구간 자르기 사용률" 지표 의미가 바뀌는 것도 반영. **ko 원본 → en 번역, 상단 시행일 함께 갱신.**
  - README ko/en: 기능 한 줄(양쪽 같은 커밋).
  - CI.md: e2e spec/test 카운트 — **델타 가산이 아니라 재측정**(문서의 "69 spec / 262 테스트"가 실측 69/259와 이미 어긋나 있다).
- **검증**:
  - [ ] `pnpm sync:agents:check` 통과(CLAUDE.md 편집 시 훅이 자동 sync)
  - [ ] `/doc-check`로 대조 시 신규 stale 없음

---

## 테스트 계획

### 단위 테스트 (`*.test.ts`)

| 대상 | 케이스 |
|---|---|
| `detectAnomalies` | source 게이트(uncaught/rejection/undefined), status 게이트(500/503/404/401), 사용자 취소(XHR `"Aborted"` + fetch `/abort/i`), WebSocket 제외, `durationMs` null 제외, network 시각=`startTime+durationMs`, windowStart 경계, 시계 역행, pageUrl/windowStart null, `about:blank`·`file:`, registrable domain(동일/서브도메인/타도메인), 시그니처 중복 억제(count·timestamp·lastTimestamp), 창 경계 걸침 시 timestamp 갱신, 정렬 순서 |
| `anomalyTrimRangeMs` | 단일 시그니처 6초, 복수 시그니처 span+6초, 빈 배열 null |
| `buildAnomalyPrompt` | 시그니처 label이 전부 포함, 빈 배열 방어 |
| `anomalyTrimSeconds` | 전체 덮음 → isFullRange 성립, 앞/뒤 clamp, 중간 구간 오프셋 일치, 빈 frames null |
| `editor-store` | **원자성 단언**(drafting 전이 렌더에서 signals 동시 존재), 래치 초기화, `hydrate` 왕복, pending hydrate 시 anomaly 폐기 복구 |
| `useEditorSessionSync` | `EDITOR_SNAPSHOT_KEYS` ↔ `snapshotFromState()` 파리티 |
| `submitEventProperties` × `filterProperties` | `from_anomaly`가 허용목록을 통과 |
| `settings-ui-store` | 신규 기본값 true, 기존 persist false 보존, **키 없는 v9 미만 migrate → true** |

### 컴포넌트 테스트 (`*.test.tsx`)

| 대상 | 케이스 |
|---|---|
| `EmptyState`/`IssueTab` | 배지 노출 게이트 5종(count 0 / replayEnabled off / isReady false / isEncoding / 정상), button/live region 역할 분리, 기존 14개 회귀 |
| `AnomalyDialog` | 행 수·2행 스택, 20종 초과 접기, open 후 스냅샷 고정, 0건 만료, logsAttach off 고지, [이슈 작성] 호출, 닫기 |
| `AiDraftDialog` | autoRunPrompt 1회 실행, 재마운트 이중 실행 없음, autoRunPrompt null 회귀, 사용자 수동 경로 회귀 |
| `DraftingPanel` (신규) | aiStatus unavailable 시 autoRunPrompt 미전달, 실패 시 `anomalyDraftFailed`, 중단 시 `anomalyDraftDone`만, 트림 토스트 1회 |
| `useReproPrefill` | anomalyPending 게이트, anomalyDraftFailed 후 발화, **anomalyDraftDone 후에도 미발화(중단 경로)**, deps 갱신 반영 |
| `use-30s-replay-gate` (`.tsx` — node가 아니라 jsdom) | anomaly 분기 trim 호출, `anomalyTrimPending` 토글, 에러 분기, 일반 capture 회귀 |

### e2e 시나리오 (`/e2e-write` 입력)

- 리플레이가 ready인 상태에서 픽스처의 5xx 버튼을 누르면 캡처 진입 화면에 감지 배지가 나타난다.
- 같은 5xx 버튼을 10번 눌러도 배지 카운트가 1로 유지된다.
- XHR abort 버튼만 누르면 배지가 나타나지 않는다.
- fetch abort 버튼만 누르면 배지가 나타나지 않는다.
- `replayEnabled`를 끄면 5xx를 내도 배지가 나타나지 않는다.
- 배지를 클릭하면 감지 내역 다이얼로그가 열리고 목록 행이 발생시킨 종류 수만큼 있다.
- 5xx와 uncaught error를 함께 발생시키면 목록 행이 2개다.
- `console.error("x")`만 호출하면 배지가 나타나지 않는다(Task 1 이관 판정).

### 수동 테스트 (Chrome, `pnpm build` 후 로드 언팩)

- [ ] [이슈 작성] → 트림 다이얼로그 없이 작성 화면 진입, 영상 첨부됨
- [ ] 잘린 영상의 시작/끝이 오류 발생 시점 앞뒤 3초와 육안으로 맞는지
- [ ] 잘린 로그가 영상 구간과 어긋나지 않는지(로그 뷰어 타임라인 대조)
- [ ] 트림이 끝나기 **전에** AI 초안이 시작되지 않는지(영상이 눈앞에서 교체되지 않는지)
- [ ] AI 초안 자동 실행 오버레이가 뜨고 '중단' 버튼이 실제로 취소하는지
- [ ] 중단 후 재현 단계 자동 채움으로 폴백되지 않되, 이후 수동 AI 초안 경로는 정상인지
- [ ] 실제로 구간이 잘린 경우에만 자동 트림 사후 고지 토스트가 뜨는지
- [ ] `unhandledrejection` / `console.assert(false)` 각각에서 배지 판정이 맞는지
- [ ] **320px·400px 폭에서 배지와 감지 목록이 읽히는지**(e2e 뷰포트는 480px 고정이라 자동으로 못 잡는다)
- [ ] **320×400 저높이에서 중앙 영역만 스크롤되고 배지·CTA가 잘리지 않는지**
- [ ] 광고가 많은 상용 사이트 5개를 각 5분씩 — 리포트 의사가 없는 배지가 뜬 사이트가 2개 이하인지(prd.md 정확도 기준)
- [ ] 신규 프로필로 설치했을 때 리플레이가 기본 on이고 폴링이 idle에서만 도는지
- [ ] 설정을 한 번도 바꾼 적 없는 기존 프로필을 업데이트했을 때 리플레이가 on으로 바뀌는지(privacy 문서 서술과 일치하는지)

---

## 구현 순서 권장

```
Task 1 ─┐
Task 2 ─┼─▶ Task 5 ─▶ Task 6 ─▶ Task 7 ─▶ Task 8 ─▶ Task 10 ─▶ Task 11
Task 3 ─┤   (훅 +      (배지·      (auto trim  (AI 배선)   (e2e)     (문서)
Task 4 ─┘   capture     다이얼로그)  + 게이트)
             시그니처)
```

- **Task 1~4는 병렬 가능** — 서로 의존하지 않는 순수 함수·타입·store 작업이다.
- **Task 5가 `capture(opts?)` 시그니처를 선행 확장**한다. 이렇게 하지 않으면 Task 6의 검증(`capture({ anomaly })` 호출)이 Task 7의 산출물을 요구하는 순환 의존이 된다.
- Task 5는 1·2·4에, Task 6은 5에, Task 7은 3·4·6에, Task 8은 4·7에 의존한다.
- Task 9는 어느 시점에나 끼울 수 있으나 Task 10 전에 끝내는 편이 낫다(계측 회귀를 e2e 전에 잡는다).
- Task 6·7·8은 각각 회귀 가드 검증 항목을 반드시 통과시킨 뒤 다음으로 넘어간다.

## 가이드 영향

- `guide/ko/video/replay.md`·`guide/en/video/replay.md` — 감지 배지·감지 내역 다이얼로그·자동 트림·AI 초안 자동 실행을 30초 리플레이 페이지에 추가한다. 리플레이 버퍼에 종속된 기능이므로 `record.md`가 아니라 여기다. **감지가 Debug>이슈 화면에 머물 때만 돈다는 경계도 함께 쓴다.**
- `guide/ko/settings/issue.md`·`guide/en/settings/issue.md` — 30초 리플레이 토글의 기본값이 on으로 바뀐 점과, 끄면 감지도 함께 꺼진다는 점.
- `guide/AUTHORING.md` — 사실 스냅샷에 감지 트리거 항목 추가(신호 4종, 시간창, 3초 패딩, replayEnabled 종속, 알림 표면 경계), 재촬영 목록에 리플레이 캡처 진입 화면 추가.
- 작성 전 `guide/AUTHORING.md`를 먼저 읽는다. 구현 후 `/guide`로 처리한다.
