# 액션 레코더 (Repro Steps) — 구현 태스크

## 선행 조건

- 새 Chrome 권한 불필요 — 기존 `content_scripts` MAIN world(`recorders-entry.ts`) 범위 내. `manifest.config.ts` 무변경 확인.
- 새 npm 의존성 없음.
- 기준 패턴 파일을 먼저 정독: `src/content/console-recorder.ts`, `src/content/console-recorder-helpers.ts`, `src/sidepanel/tabs/ConsoleSubTab.tsx`, `src/sidepanel/components/ConsoleLogContent.tsx`, `src/sidepanel/hooks/useBackgroundRecorder.ts`, `src/sidepanel/hooks/usePickerMessages.ts`.

## 태스크

### Task 1: `ActionEntry`/`ActionLog` 타입 정의
- **변경 대상**: `src/types/action.ts` (신규)
- **작업 내용**: design.md "인터페이스 설계"의 `ActionEntryKind`/`ActionEntry`/`ActionLog` 타입 작성.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `network.ts`/`console.ts` 타입 파일과 네이밍 컨벤션 일치

### Task 2: 순수 헬퍼 — 테스트 우선
- **변경 대상**: `src/content/__tests__/action-recorder-helpers.test.ts` (신규) → `src/content/action-recorder-helpers.ts` (신규)
- **작업 내용**: 먼저 테스트를 작성(실패 상태)하고 `shouldMaskField`/`maskValue`/`describeActionTarget`/`buildLightSelector`/`inputDedupKey`를 구현. 마스킹 정규식은 `network-recorder.ts`의 auth/token 마스킹 패턴 참고.
- **검증**:
  - [ ] 테스트 작성 직후 `pnpm test` 실패(red) 확인
  - [ ] 구현 후 `pnpm test` 통과 — 아래 "테스트 계획" 케이스 전부
  - [ ] `pnpm typecheck` 통과

### Task 3: MAIN world 액션 레코더
- **변경 대상**: `src/content/action-recorder.ts` (신규), `src/content/recorders-entry.ts` (1줄 추가)
- **작업 내용**: `console-recorder.ts` 구조를 복제한 IIFE. `CTRL_KEY = "__bugshot_action_ctrl__"`. click(capture phase)/input+change/`history.pushState`·`replaceState` patch/popstate/hashchange 캡처. document_start부터 무조건 버퍼링, sentinel은 dispatch만 gate. FIFO `MAX_ENTRIES = 1000`, 같은 `inputDedupKey`의 연속 입력은 in-place 갱신. overlay shadow host(`HOST_ID`) 내부 클릭 제외. `recorders-entry.ts`에 `import "./action-recorder"` 추가.
- **검증**:
  - [ ] `pnpm build` 후 임의 페이지에서 콘솔 에러 없이 로드
  - [ ] DevTools에서 `__bugshot_action_data__` CustomEvent가 클릭 시 발화하는지 확인 (sentinel 설정 후)

### Task 4: 메시지 배관 — 타입 / picker 브릿지 / picker-control
- **변경 대상**: `src/types/picker.ts`, `src/content/picker.ts`, `src/sidepanel/picker-control.ts`
- **작업 내용**: `actionRecorder.setSentinel/stop/sync/clear/data` 메시지 타입 추가. `picker.ts`에 콘솔 브릿지(라인 99-141 부근) 동형으로 액션 브릿지 핸들러 + 메시지 switch case 추가. `picker-control.ts`에 `activate/stop/sync/clearActionRecorder` 추가(라인 297-315 console 동형).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 사이드패널에서 `activateActionRecorder(tabId)` 호출 시 sentinel 반환

### Task 5: 영속화 — blob-db / editor-store / issues-store
- **변경 대상**: `src/store/blob-db.ts`, `src/store/editor-store.ts`, `src/store/issues-store.ts`
- **작업 내용**:
  - `blob-db.ts`: `DB_VERSION` 5→6, `onupgradeneeded`에 `actionLogs` object store(`contains` 가드), `save/get/delete/getKeys/clearActionLog` API(`networkLogs` 동형).
  - `editor-store.ts`: `actionLog`/`actionLogAttach` 상태·`initial`·액션(`setActionLog`/`setActionLogAttach`)·`EditorSnapshot` 필드. **`startRecording`에서 `setActionLog(null)` + `clearActionRecorder(tabId)` + `deleteActionLog(`pending:${tabId}`)`로 녹화 이전 액션 초기화.** `startCapturing` 폴백 보존에 `actionLog`, `confirmDraft`에 `saveActionLog(issueId)` 영속화, `onSubmitted`에 `actionLog: null`.
  - `useEditorSessionSync.ts`: `snapshotFromState()`에 `actionLogAttach` 수동 복사 추가(누락 시 런타임 소실).
  - `issues-store.ts`: `IssueRecord`에 `actionLogBlobKey?: string`. `ISSUES_STORE_VERSION` 주석 블록에 한 줄 추가(마이그레이션 코드 무변경 — optional 필드).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] store 단위 테스트가 있으면 갱신 후 `pnpm test` 통과
  - [ ] DevTools Application 탭에서 `bugshot-video` DB v6 + `actionLogs` store 생성 확인

### Task 6: 누적 배관 — usePickerMessages / useBackgroundRecorder / video-recorder
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/hooks/useBackgroundRecorder.ts`, `src/sidepanel/video-recorder.ts`
- **작업 내용**:
  - `usePickerMessages.ts`: `actionRecorder.data` 케이스 — `prev.actionLog.entries`와 `incoming`을 `id` 키 `Map`으로 merge, `timestamp` 정렬, `setActionLog` + `saveActionLog(`pending:${tabId}`)`. (network/console과 달리 **교체 아닌 merge**.)
  - `useBackgroundRecorder.ts`: `inject()`에 `activateActionRecorder`, 페이지 이동 비보존 분기(`!shouldPreserveBackgroundLogs`)에 `clearActionRecorder` + `actionLog: null` + `deleteActionLog`, idle 복귀 분기·cleanup에 액션 레코더 처리 추가.
  - `video-recorder.ts`: `stopRecording()`에 `void stopActionRecorder(state.tabId)` 추가.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `useBackgroundRecorder` 테스트가 있으면 갱신 후 `pnpm test` 통과
  - [ ] 수동 누적 시나리오(아래) 통과

### Task 7: UI — ActionLogContent / ActionSubTab / DebugTab
- **변경 대상**: `src/sidepanel/components/ActionLogContent.tsx` (신규), `src/sidepanel/tabs/ActionSubTab.tsx` (신규), `src/sidepanel/tabs/DebugTab.tsx`
- **작업 내용**: `ConsoleLogContent`/`ConsoleSubTab` 복제. `ActionLogContent` 필터 `all/click/navigation/input`, kind별 lucide 아이콘(`MousePointerClick`/`Navigation`/`Keyboard` 등), 상대 시간, masked input은 `***` 배지. `ActionSubTab`은 1.5s 폴링 `syncActionRecorder`. `DebugTab`에 'actions' 서브탭 추가, `TabsList`를 `grid-cols-3`→`grid-cols-4`, 비활성 탭에 `data-[state=inactive]:hidden`.
- **검증**:
  - [ ] `pnpm dev`에서 디버그 탭에 'Actions' 서브탭 노출, 4개 탭 레이아웃 정상
  - [ ] 클릭/입력/이동 시 서브탭에 entry 실시간 표시, 필터 동작

### Task 8: AI 프롬프트 메타 통합
- **변경 대상**: `src/sidepanel/lib/buildLogSummary.ts`, `src/sidepanel/lib/buildAiDraftPrompt.ts`, `src/sidepanel/tabs/DraftingPanel.tsx`, `src/sidepanel/tabs/AiDraftDialog.tsx`
- **작업 내용**: `buildActionLogSummary(log): ActionLogSummary` 추가. `AiDraftContext`/`AiDraftSessionContext`에 `actionLogSummary?` 추가, video/freeform 프롬프트 블록에 `User actions (reference)` 섹션 출력 + "context only — do not copy verbatim into stepsToReproduce" 명시. 호출부 `DraftingPanel`/`AiDraftDialog`에서 `actionLogSummary` 전달.
- **검증**:
  - [ ] `buildActionLogSummary` 단위 테스트 통과
  - [ ] AI 초안 생성 시 프롬프트에 actions 포함, `stepsToReproduce`가 자동으로 채워지지 않음 확인

### Task 9: i18n
- **변경 대상**: `src/i18n/ko.ts`, `src/i18n/en.ts`
- **작업 내용**: `debug.tab.actions`, `debug.actions.empty`, `actionLog.filter.{all,click,navigation,input}`, `actionLog.search`, `actionLog.masked`, `actionLog.kind.*` 키를 ko/en 동시 추가.
- **검증**:
  - [ ] `locales.test.ts`(ko/en 키 일치) 통과
  - [ ] 탭/빈 상태/필터 라벨이 양 언어로 정상 표시

### Task 10: 종단 검증
- **검증**:
  - [ ] `pnpm typecheck` 전체 통과
  - [ ] `pnpm test` 전체 통과
  - [ ] 아래 수동 테스트 체크리스트 전부

## 테스트 계획

### 단위 테스트 (`action-recorder-helpers.test.ts`)
- `shouldMaskField`: `type:"password"`→true / `type:"text",name:"username"`→false / `name:"cardNumber"`·`id:"cvv"`·`name:"user_ssn"`→true / `autocomplete:"current-password"`·`"cc-number"`→true / `{}`→false
- `maskValue`: 임의 값→`"***"`
- `describeActionTarget`: accessibleName 있음→자연어 / 없음→selector 폴백 / 긴 텍스트 truncate
- `buildLightSelector`: id 있음→`#id` / class만→`tag.class` / 무속성→nth-child path
- `inputDedupKey`: 동일 selector→동일 키

### 단위 테스트 (`buildLogSummary.test.ts`에 추가)
- `buildActionLogSummary`: click/navigation/input 혼합→자연어 줄 배열, 최근 N개 제한 / masked input→값 `***`

### 수동 테스트 (Chrome)
- [ ] **누적**: 비디오 녹화 시작 → A페이지 클릭/입력 → 링크로 B페이지 이동 → B 클릭 → SPA 라우트 이동 → 녹화 종료 → Actions 서브탭에 A·B 액션 + navigation entry가 모두 시간순·중복 없이 남음
- [ ] **녹화 시작 초기화**: 녹화 전 페이지를 클릭해 Actions 서브탭에 액션이 쌓인 상태에서 녹화 시작 → 서브탭이 비워지고 녹화 이후 액션만 누적됨
- [ ] **마스킹**: password 필드 입력→`***` / 일반 텍스트 필드→값 노출 / `name="creditCard"` 커스텀 필드→마스킹
- [ ] **필터**: Actions 서브탭에서 click/navigation/input 필터 토글 동작
- [ ] **AI**: DraftingPanel AI 초안 생성 시 프롬프트에 actions 메타 포함, `stepsToReproduce` 자동 미채움
- [ ] **권한**: 확장 재로드 시 새 권한 승인 프롬프트 0건

## 구현 순서 권장

Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 순차. Task 7(UI)과 Task 8(AI)은 Task 6 완료 후 병렬 가능. Task 9(i18n)는 Task 7과 함께 진행하면 라벨 누락을 줄일 수 있다. 각 Task는 `pnpm typecheck`로 게이트하고, Task 2·8은 `pnpm test`로 게이트한다.
