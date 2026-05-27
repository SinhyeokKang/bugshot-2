# 액션 레코더 (Repro Steps) — 구현 태스크

## 선행 조건

- 새 Chrome 권한 불필요 — 기존 `content_scripts` MAIN world(`recorders-entry.ts`) 범위 내. `manifest.config.ts` 무변경 확인.
- 새 npm 의존성 없음.
- **핵심 원칙**: action 버퍼의 라이프사이클을 `console`/`network` 로그와 **완전히 동일**하게 만든다. console이 손대는 모든 파일·함수·phase 훅을 1:1로 미러링하고, 같은 헬퍼(`mergeLogItems`/`trimByTime`/`isLogFrozen`/`persistAttachedLogs`)를 재사용한다. 로그와 다른 점은 **마스킹**과 **log-viewer 주입을 captureMode "video"로 게이팅** 두 가지뿐.
- 기준 패턴 파일 정독: `src/content/console-recorder.ts`, `src/content/console-recorder-helpers.ts`, `src/sidepanel/hooks/useBackgroundRecorder.ts`, `src/sidepanel/hooks/usePickerMessages.ts`(라인 115-167), `src/sidepanel/lib/log-merge.ts`, `src/store/editor-store.ts`(`preserveLogs`/`selectAttachedLogs`/`persistAttachedLogs`), `src/sidepanel/30s-replay/use-30s-replay.ts`(라인 152-169), `src/sidepanel/lib/buildLogsHtml.ts`, `src/sidepanel/lib/buildCaptureFiles.ts`, `src/log-viewer/App.tsx`.

## 태스크

### Task 1: `ActionEntry`/`ActionLog` 타입 정의
- **변경 대상**: `src/types/action.ts` (신규)
- **작업 내용**: design.md "인터페이스 설계"의 `ActionEntryKind`/`ActionEntry`/`ActionLog`/`ActionLogSummary`. `ActionEntry`는 `{ id: string }` + `timestamp:number`를 가져 `mergeLogItems`/`trimByTime` getter를 만족해야 함.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] `network.ts`/`console.ts`와 네이밍 컨벤션 일치

### Task 2: 순수 헬퍼 — 테스트 우선
- **변경 대상**: `src/content/__tests__/action-recorder-helpers.test.ts` (신규) → `src/content/action-recorder-helpers.ts` (신규)
- **작업 내용**: 테스트 먼저(red) → `shouldMaskField`/`maskValue`/`describeActionTarget`/`buildLightSelector`/`inputDedupKey` 구현. 마스킹 정규식은 `network-recorder.ts` auth/token 패턴 참고.
- **검증**:
  - [x] 테스트 작성 직후 `pnpm test` 실패(red)
  - [x] 구현 후 "테스트 계획" 케이스 전부 통과
  - [x] `pnpm typecheck` 통과

### Task 3: MAIN world 액션 레코더
- **변경 대상**: `src/content/action-recorder.ts` (신규), `src/content/recorders-entry.ts` (1줄)
- **작업 내용**: `console-recorder.ts` 구조 복제 IIFE. `CTRL_KEY="__bugshot_action_ctrl__"`. click(capture)/input+change/`pushState`·`replaceState` patch/popstate/hashchange. document_start 무조건 버퍼링, sentinel은 dispatch만 gate. FIFO `MAX_ENTRIES=1000`, 같은 `inputDedupKey` 연속 입력 in-place 갱신. shadow host(`HOST_ID`) 내부 클릭 제외. `recorders-entry.ts`에 `import "./action-recorder"`.
- **검증**:
  - [ ] `pnpm build` 후 임의 페이지 콘솔 에러 없이 로드
  - [ ] sentinel 설정 후 클릭 시 `__bugshot_action_data__` CustomEvent 발화

### Task 4: 메시지 배관 + log-merge 헬퍼
- **변경 대상**: `src/types/picker.ts`, `src/content/picker.ts`, `src/sidepanel/picker-control.ts`, `src/sidepanel/lib/log-merge.ts`
- **작업 내용**: `actionRecorder.setSentinel/stop/sync/clear/data` 타입(console 동형). `picker.ts` 액션 브릿지(라인 99-141 동형). `picker-control.ts`에 `activate/stop/sync/clearActionRecorder`(라인 297-315 동형). `log-merge.ts`에 `ACTION_MAX_ENTRIES` + `rebuildActionLog`(`rebuildConsoleLog` 동형) 추가.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] `activateActionRecorder(tabId)` 호출 시 sentinel 반환 (console 동형 구현)

### Task 5: 영속화 + 스토어 라이프사이클 미러
- **변경 대상**: `src/store/blob-db.ts`, `src/store/editor-store.ts`, `src/store/issues-store.ts`
- **작업 내용**:
  - `blob-db.ts`: `DB_VERSION` 5→6, `actionLogs` store(`contains` 가드), `save/get/delete/getKeys/clearActionLog`(`networkLogs` 동형).
  - `editor-store.ts`: `actionLog`/`actionLogAttach` 상태·`initial`·setter(`setActionLog`/`setActionLogAttach`)·`clearActionLog`(`clearConsoleLog` 동형). **console이 손대는 모든 지점에 미러**: `preserveLogs`, `selectAttachedLogs`, `persistAttachedLogs`, `onRecordingComplete`(`actionLogAttach:true`), `startFreeform`(`actionLogAttach:true`), `onAreaCaptured`(`actionLogAttach:true`), `onSubmitted`(`actionLog:null`), `EditorSnapshot` 필드.
  - `useEditorSessionSync.ts`: `snapshotFromState()`에 `actionLogAttach` 수동 복사 추가.
  - `issues-store.ts`: `IssueRecord`에 `actionLogBlobKey?`. `ISSUES_STORE_VERSION` 주석 한 줄.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] store 테스트 있으면 갱신 후 `pnpm test` 통과 (전용 store 테스트 없음 — 회귀 없음 확인)
  - [ ] DevTools Application에서 `bugshot-video` DB v6 + `actionLogs` store 확인 (수동)

### Task 6: 누적·trim 배관 (로그 경로 미러)
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/hooks/useBackgroundRecorder.ts`, `src/sidepanel/video-capture.ts`, `src/sidepanel/video-recorder.ts`, `src/sidepanel/30s-replay/use-30s-replay.ts`
- **작업 내용**:
  - `usePickerMessages.ts`: `consoleRecorder.data`(라인 146-167) **그대로 복제**한 `actionRecorder.data` 케이스 — `isLogFrozen` 게이트, `lastLogClearAt` 필터, `mergeLogItems(existing.entries, incoming, e=>e.timestamp, ACTION_MAX_ENTRIES)`, `rebuildActionLog`, `saveActionLog(`pending:${tabId}`)`. `logClear` 핸들러(라인 115-122)에 `store.clearActionLog(myTabId)` 추가.
  - `useBackgroundRecorder.ts`: `inject()`에 `activateActionRecorder`, 비보존 분기(`!shouldPreserveBackgroundLogs`)에 `clearActionRecorder` + `actionLog:null`, idle 복귀·cleanup에 액션 처리 — network/console과 동일 지점.
  - `video-capture.ts`: `startVideoCapture`에 `deleteActionLog(pending)` + `activateActionRecorder` + `clearActionRecorder`(network/console 동형).
  - `video-recorder.ts`: `stopRecording()`에 `void stopActionRecorder(state.tabId)`.
  - `use-30s-replay.ts`: `capture()`(라인 159-169)에 network/console **병렬로** `syncActionRecorder(id)` 후 `trimByTime(actionLog.entries, e=>e.timestamp, lower, captureTime)` → `setActionLog(trimmed)` + `saveActionLog(`pending:${id}`)`.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] hook 테스트 있으면 갱신 후 `pnpm test` 통과 (전용 hook 테스트 없음)
  - [ ] 수동 누적·trim 시나리오(아래) 통과 (수동)

### Task 7: log-viewer 통합 (Actions 탭)
- **변경 대상**: `src/types/log-viewer.ts`, `src/sidepanel/lib/buildLogsHtml.ts`, `src/sidepanel/lib/buildCaptureFiles.ts`, `src/log-viewer/App.tsx`, `src/sidepanel/components/ActionLogContent.tsx`(신규), `src/log-viewer/i18n.ts`, `buildCaptureFiles` 호출부 2곳
- **작업 내용**:
  - `log-viewer.ts`: `LogViewerData`에 `actionLog`/`actionLogJson`.
  - `buildLogsHtml.ts`: `actionLog` 인자(network/console 다음, pageUrl 앞) + `data` 주입. 기존 테스트·호출부 함께 갱신.
  - `buildCaptureFiles.ts`: `BuildCaptureFilesInput.actionLog?`. **`captureMode === "video"`일 때만** actionLog 전달, freeform/screenshot은 null. video일 때 `action-log.json`을 `jsonLogs`에 푸시. 두 호출부에서 actionLog 공급(store 또는 `getActionLog(issue.actionLogBlobKey)`).
  - `ActionLogContent.tsx`: **`ConsoleLogContent`의 row style 그대로 재사용** — 레이아웃/`formatRelativeTime`/`LevelIcon`·`levelColor`·`levelBgColor` 메커니즘을 `level→kind`로 매핑(`KindIcon` 🖱/⌨/➜, `kindColor`/`kindBgColor`). 헤더 필터탭(`all/click/navigation/input`)+검색·빈 상태·tail 스크롤 동일. **`EntryAccordion` 확장만 제거 — 단일 행**. `flush` prop. 본문 구성은 레퍼런스 참고: click=target, input=`fieldLabel·"value"`(masked `***` 배지, 긴 값 truncate+`title`), navigation=`{toUrl}로 이동`+navType 사유+URL 링크. 색은 **navigation만 강조**(콘솔 info-틴트 슬롯 재사용), click/input 중립. 새 색 토큰 도입 없음.
  - `App.tsx`: `LogTab`에 `"action"`, `grid-cols-2`→`grid-cols-3`, Actions trigger(disabled 가드)/content/다운로드 버튼, `data-[state=inactive]:hidden`.
  - `log-viewer/i18n.ts`: `actionLog.*` ko/en 동시.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [~] `log-viewer/__tests__/i18n.test.ts`(ko/en 대칭) — 키 대칭 충족하나 해당 테스트 파일은 HEAD에서 이미 navigator 미정의로 collect 실패(선행 이슈)
  - [ ] `pnpm build:log-viewer` 후 video 이슈 `logs.html`을 브라우저로 열어 Actions 탭 + Console/Network 동시 동작 (수동)

### Task 8: AI 프롬프트 메타 통합
- **변경 대상**: `src/sidepanel/lib/buildLogSummary.ts`, `src/sidepanel/lib/buildAiDraftPrompt.ts`, `src/sidepanel/tabs/DraftingPanel.tsx`, `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**: `buildActionLogSummary(log)`. `AiDraftContext`/`AiDraftSessionContext`에 `actionLogSummary?`, video/freeform 블록에 `User actions (reference)` + "context only — do not copy verbatim" 명시. 호출부에서 summary 전달.
- **검증**:
  - [x] `buildActionLogSummary` 단위 테스트 통과
  - [x] AI 초안 생성 시 프롬프트에 actions 포함, `stepsToReproduce` 자동 미채움 (프롬프트 블록에 "do not copy verbatim" 명시)

### Task 9: i18n (사이드패널 측, 필요 시)
- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**: `ActionLogContent`가 `consoleLog.*`처럼 사이드패널 사전 키를 참조한다면 `actionLog.*`를 ko/en 동시 미러. **`debug.tab.actions` 등 서브탭 키는 추가하지 않는다(서브탭 없음).** log-viewer 측 키는 Task 7에서 처리.
- **검증**:
  - [x] `locales.test.ts`(ko/en 대칭) 통과
  - [x] 필터/빈 상태/마스킹 라벨 양 언어 정상 (ko/en actionLog.* 미러)

### Task 10: 종단 검증
- **검증**:
  - [x] `pnpm typecheck` 전체 통과
  - [~] `pnpm test` 전체 통과 (1121 tests green; 유일 실패는 선행 `log-viewer/i18n.test.ts` navigator 이슈)
  - [ ] 아래 수동 체크리스트 전부 (수동)

## 테스트 계획

### 단위 테스트 (`action-recorder-helpers.test.ts`)
- `shouldMaskField`: `type:"password"`→true / `type:"text",name:"username"`→false / `name:"cardNumber"`·`id:"cvv"`·`name:"user_ssn"`→true / `autocomplete:"current-password"`·`"cc-number"`→true / `{}`→false
- `maskValue`: 임의 값→`"***"`
- `describeActionTarget`: accessibleName 있음→자연어 / 없음→selector / 긴 텍스트 truncate
- `buildLightSelector`: id→`#id` / class만→`tag.class` / 무속성→nth-child
- `inputDedupKey`: 동일 selector→동일 키

### 단위 테스트 (`log-merge` / `buildLogSummary`)
- `mergeLogItems`/`trimByTime`는 제네릭이라 신규 함수 없음. `trimByTime`에 `ActionEntry` 적용 케이스 1건(`trimByTime(actions, e=>e.timestamp, 10, 20)` / 전부 trim out→`[]`).
- `buildActionLogSummary`: click/navigation/input 혼합→자연어 줄, 최근 N개 제한 / masked input→값 `***`

### 단위 테스트 (`buildLogsHtml.test.ts`)
- `actionLog 있음 → data.actionLog not null`
- `actionLog null → data.actionLog null` (network/console null 케이스 대칭)
- action `value`에 `</script>` 포함 → HTML 파싱 안 깨짐(이스케이프, 기존 패턴 복제)
- 회귀: 기존 network/console-only 케이스 불변

### 단위 테스트 (`buildCaptureFiles.test.ts`) — video-only 스코핑 (핵심 계약)
- `video + actionLog → logs.html에 actionLog 주입`
- `freeform + actionLog → logs.html의 actionLog는 null`
- `screenshot + actionLog → logs.html의 actionLog는 null`
- `video + actionLog=null → null` (회귀: 기존 video 동작 불변)

### 단위 테스트 (`log-viewer/__tests__/i18n.test.ts`)
- `actionLog.*` 키 ko/en 대칭

### 수동 테스트 (Chrome)
- [ ] **video-record 누적**: 녹화 시작 → A페이지 클릭/입력 → 링크로 B페이지 이동 → B 클릭 → SPA 라우트 이동 → 종료 → 제출 → 이슈 `logs.html` Actions 탭에 A·B 액션 + navigation entry가 중복 없이 시간순 (로그와 동일하게 누적)
- [ ] **녹화 시작 초기화**: 녹화 전 클릭으로 버퍼가 쌓인 상태에서 녹화 시작 → 녹화 이후 액션만 누적 (로그와 동일)
- [ ] **30s-replay trim**: idle에서 클릭/입력 누적 → capture → 이슈 `logs.html` Actions 탭에 capture 윈도우 내 액션만(윈도우 밖 trim) 시간순
- [ ] **log-viewer 모드 게이팅**: video/30s-replay `logs.html`에는 Actions 탭 표시 / freeform·screenshot `logs.html`에는 Actions 탭 없음(actionLog null)
- [ ] **마스킹**: password→`***` / 일반 텍스트→값 / `name="creditCard"`→마스킹 (Actions 탭에서 확인)
- [ ] **필터**: Actions 탭 click/navigation/input 필터 토글
- [ ] **AI**: DraftingPanel AI 초안 시 프롬프트에 actions 메타 포함, `stepsToReproduce` 자동 미채움
- [ ] **빈 상태**: 클릭 없이 녹화만 → Actions 탭 disabled 또는 "캡처된 액션 없음"
- [ ] **권한**: 확장 재로드 시 새 권한 승인 프롬프트 0건

## 구현 순서 권장

Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 순차. Task 7(log-viewer)과 Task 8(AI)은 Task 6 완료 후 병렬 가능. 각 Task는 `pnpm typecheck` 게이트, Task 2·7·8은 `pnpm test` 게이트.
