# Screenshot Log Attachment — 구현 태스크

## 선행 조건

- 기존 비디오 녹화 + element 모드 기능이 정상 동작하는 상태에서 시작
- `pnpm typecheck` 통과 상태

## 태스크

### Task 1: 레코더 clear 이벤트 추가

MAIN world 레코더에 버퍼 클리어 기능을 추가한다.

- **변경 대상**: `src/content/network-recorder.ts`, `src/content/console-recorder.ts`, `src/content/picker.ts`, `src/sidepanel/picker-control.ts`, `src/types/picker.ts`
- **작업 내용**:
  1. `src/types/picker.ts` — `PickerMessage` union에 `{ type: "networkRecorder.clear" }`, `{ type: "consoleRecorder.clear" }` 추가
  2. `src/content/network-recorder.ts` — `__bugshot_net_clear__<sentinel>` 이벤트 리스너 추가. 핸들러: `buffer.length = 0`, `totalSeen = 0`, `warnings.clear()`. `__bugshot_net_ctrl__`에 `clearBuffer()` 메서드 노출
  3. `src/content/console-recorder.ts` — 동일 패턴으로 `__bugshot_console_clear__<sentinel>` 이벤트 + `clearBuffer()` 메서드
  4. `src/content/picker.ts` — `networkRecorder.clear` 메시지 핸들러 추가: `document.dispatchEvent(new CustomEvent("__bugshot_net_clear__" + networkSentinel))`. `consoleRecorder.clear`도 동일
  5. `src/sidepanel/picker-control.ts` — `clearNetworkRecorder(tabId)` 및 `clearConsoleRecorder(tabId)` 함수 추가. 기존 `stopNetworkRecorder`/`stopConsoleRecorder`와 동일 패턴
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과
  - [ ] 단위 테스트: `network-recorder.ts`의 clear 동작 테스트 (버퍼 비움, totalSeen 리셋) — 순수 함수 영역이 제한적이므로 레코더 스크립트의 clear 이벤트 핸들러 로직을 분리 가능한지 확인 후 판단

### Task 2: useBackgroundRecorder 훅 구현

사이드패널 열림 시 레코더를 주입하고 생명주기를 관리하는 훅을 작성한다.

- **변경 대상**: `src/sidepanel/hooks/useBackgroundRecorder.ts` (신규), `src/sidepanel/App.tsx`
- **작업 내용**:
  1. `useBackgroundRecorder(tabId: number | null): void` 훅 생성
  2. **마운트 effect**: `tabId` 유효 시 `injectNetworkRecorder(tabId)` + `injectConsoleRecorder(tabId)` 호출 (각각 try/catch, 실패 시 console.warn). `injectedRef = true` 설정
  3. **chrome.tabs.onUpdated 리스너**:
     - `info.url` 변경 감지: 에디터 스토어 로그 클리어 (`setNetworkLog(null)`, `setConsoleLog(null)`), IndexedDB `pending:{tabId}` 삭제, `recordersStopped` ref 리셋, 레코더 재주입
     - `info.status === "complete"`: `recordersStopped`가 false일 때만 레코더 재주입 (rebind)
  4. **에디터 스토어 구독** (`useEditorStore.subscribe`):
     - `phase`가 `"capturing"`이고 `captureMode`가 `"screenshot"`이면: `syncNetworkRecorder(tabId)` + `syncConsoleRecorder(tabId)` (try/catch)
     - `phase`가 `"recording"`이면: `recordersStopped = true` 설정 (실제 클리어는 `handleStartVideo`에서 수행)
     - `phase`가 `"idle"`이고 `recordersStopped`가 true이면: `recordersStopped = false` + 레코더 재주입 (drafting 취소 후 idle 복귀 대응)
  5. **언마운트 cleanup**: `stopNetworkRecorder(tabId)` + `stopConsoleRecorder(tabId)` (try/catch), `deleteNetworkLog(pending:{tabId})` + `deleteConsoleLog(pending:{tabId})`
  6. `src/sidepanel/App.tsx`에서 `useBackgroundRecorder(tabId)` 호출 추가 (`useEditorSessionSync` 이후)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동 테스트: 사이드패널 열기 → DevTools에서 네트워크 활동 발생 → 콘솔에 `[bugshot]` 레코더 주입 로그 확인
  - [ ] 수동 테스트: URL 이동 → 레코더 재주입 확인 (DevTools console)

### Task 3: useEditorSessionSync 레코더 재주입 제거

비디오 녹화 중 페이지 완료 시 레코더 재주입 책임을 `useBackgroundRecorder`로 이전한다.

- **변경 대상**: `src/sidepanel/hooks/useEditorSessionSync.ts`
- **작업 내용**:
  `onTabUpdated` 핸들러 내 다음 블록 제거:
  ```typescript
  if (s.captureMode === "video" && s.phase === "recording") {
    injectNetworkRecorder(tabId).catch(() => {});
    injectConsoleRecorder(tabId).catch(() => {});
  }
  ```
  `injectNetworkRecorder`, `injectConsoleRecorder` import도 사용처가 없으면 제거.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과
  - [ ] 수동 테스트: 비디오 녹화 중 페이지 리로드 → 네트워크/콘솔 로그 정상 캡처 확인 (useBackgroundRecorder가 재주입 담당)

### Task 4: editor-store 스크린샷 로그 보존 + confirmDraft 로그 저장

스크린샷 모드 진입 시 백그라운드 로그를 보존하고, 이슈 확정 시 로그를 저장한다.

- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**:
  1. `startCapturing` 변경: `set({ ...initial, ... })` → `set((prev) => ({ ...initial, captureMode: "screenshot", phase: "capturing", target, networkLog: prev.networkLog, consoleLog: prev.consoleLog }))`
  2. `confirmDraft` 변경: screenshot 분기 내에 네트워크/콘솔 로그 저장 로직 추가. 비디오 분기의 기존 패턴 (`hasNetworkLog` / `hasConsoleLog` 체크 → `saveDraft`에 blobKey 추가 → IndexedDB 저장 → pending 삭제)을 동일하게 적용. 로그 저장 부분을 비디오/스크린샷에서 공유하는 헬퍼로 추출 가능 (중복 최소화).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 단위 테스트: `startCapturing` 호출 시 `networkLog`/`consoleLog`가 보존되는지 확인
  - [ ] 단위 테스트: `confirmDraft` screenshot 분기에서 `networkLogBlobKey`/`consoleLogBlobKey`가 정상 설정되는지 확인
  - [ ] `pnpm test` 통과

### Task 5: DraftingPanel 스크린샷 로그 UI 활성화

스크린샷 DraftingPanel에 로그 카드를 표시한다.

- **변경 대상**: `src/sidepanel/tabs/DraftingPanel.tsx`
- **작업 내용**:
  `showLogCards` 조건 변경:
  ```typescript
  const showLogCards = (isVideoMode || captureMode === "screenshot") && (
    (networkLog !== null && networkLog.captured > 0) ||
    (consoleLog !== null && consoleLog.captured > 0)
  );
  ```
  LogAttachmentCards, NetworkLogPreviewDialog, ConsoleLogPreviewDialog는 이미 props 기반이므로 변경 불필요.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동 테스트: 스크린샷 → DraftingPanel에 로그 카드 표시 확인
  - [ ] 수동 테스트: 로그 카드 클릭 → 프리뷰 다이얼로그 정상 표시
  - [ ] 수동 테스트: 첨부 토글 on/off 작동 확인

### Task 6: handleStartVideo 백그라운드 로그 클리어

녹화 시작 시 백그라운드 로그를 완전 클리어한다.

- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**:
  `handleStartVideo` 수정:
  1. 녹화 시작 전 스토어 로그 클리어 (`setNetworkLog(null)`, `setConsoleLog(null)`)
  2. IndexedDB `pending:{tabId}` 삭제
  3. 레코더 재주입 (`injectNetworkRecorder` + `injectConsoleRecorder`) — 이미 있으면 rebind
  4. 레코더 버퍼 클리어 (`clearNetworkRecorder` + `clearConsoleRecorder`)
  5. 이후 기존 `startRecording` + `videoRecorder.startRecording` 호출
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동 테스트: 백그라운드 로그 축적 후 녹화 시작 → 녹화 종료 후 로그에 녹화 구간 데이터만 있는지 확인
  - [ ] 수동 테스트: 녹화 시작 전 IndexedDB에 pending 로그 있던 것이 삭제되었는지 확인 (DevTools Application 탭)

### Task 7: 세션 스냅샷 로그 필드 제외 확인

백그라운드 레코딩으로 인해 대용량 로그가 세션 스냅샷에 포함되지 않도록 한다.

- **변경 대상**: `src/sidepanel/hooks/useEditorSessionSync.ts`
- **작업 내용**:
  세션 스냅샷 생성 시 `networkLog`, `consoleLog` 필드가 제외되는지 확인. 제외되지 않는다면 스냅샷 직렬화에서 해당 필드를 제거하는 로직 추가. 복구(hydration) 시에는 IndexedDB `pending:{tabId}`에서 로드하는 기존 패턴 유지.
- **검증**:
  - [ ] 스냅샷에 로그 필드가 포함되지 않음을 확인 (console.log 또는 breakpoint)
  - [ ] 사이드패널 닫기 → 재열기 → 로그가 IndexedDB에서 복구되는지 확인 (해당 경우에만)
  - [ ] `pnpm typecheck` 통과

## 테스트 계획

### 단위 테스트

- `src/store/__tests__/editor-store.test.ts`:
  - `startCapturing`이 기존 `networkLog`/`consoleLog`를 보존하는지
  - `confirmDraft` screenshot 분기에서 `networkLogAttach=true`일 때 blobKey가 설정되는지
  - `confirmDraft` screenshot 분기에서 `networkLogAttach=false`일 때 blobKey가 undefined인지

- `src/sidepanel/picker-control.ts` 관련: `clearNetworkRecorder`/`clearConsoleRecorder`는 `send()` 래퍼 호출만이므로 별도 테스트 불필요 (통합 테스트 범위)

- 레코더 clear 로직: MAIN world 실행이라 유닛 테스트가 어려움. 수동 테스트로 커버.

### 수동 테스트 체크리스트

- [ ] **백그라운드 캡처 시작**: 사이드패널 열기 → 페이지에서 fetch 발생 + console.log 발생 → 스크린샷 모드 진입 → DraftingPanel에 로그 카드 표시
- [ ] **스크린샷 로그 첨부**: 로그 카드 프리뷰 확인 → attach 토글 on → 이슈 등록 → 이슈 목록에서 로그 blobKey 존재 확인
- [ ] **녹화 전환**: 백그라운드 로그 축적 → 녹화 시작 → 녹화 중 새 네트워크 활동 → 녹화 종료 → DraftingPanel에 녹화 구간 로그만 표시
- [ ] **URL 변경**: 백그라운드 캡처 중 → 다른 URL 이동 → 이전 로그 사라짐 → 새 페이지에서 캡처 재시작
- [ ] **페이지 리로드**: 백그라운드 캡처 중 → 페이지 리로드 → 레코더 재주입 → 캡처 재시작
- [ ] **사이드패널 종료**: 로그 축적 중 → 사이드패널 닫기 → DevTools Application > IndexedDB > bugshot-video > networkLogs에서 pending:{tabId} 삭제 확인
- [ ] **Element 모드 무영향**: element 모드 → DraftingPanel에 로그 카드 미표시
- [ ] **비디오 모드 회귀**: 녹화 → 종료 → 로그 카드 정상 표시 (기존과 동일)
- [ ] **녹화 후 idle 복귀**: 녹화 → 완료/취소 → idle 복귀 → 레코더 재주입 → 백그라운드 캡처 재시작

## 구현 순서 권장

```
Task 1 (레코더 clear)  ← 독립, 선행 필수
    ↓
Task 2 (useBackgroundRecorder) + Task 3 (useEditorSessionSync 정리)  ← 동시 가능
    ↓
Task 4 (editor-store 변경)  ← Task 2 이후
    ↓
Task 5 (DraftingPanel UI) + Task 6 (handleStartVideo 변경)  ← Task 4 이후, 병렬 가능
    ↓
Task 7 (세션 스냅샷 확인)  ← 마지막 (전체 통합 후 확인)
```

Task 1은 레코더·콘텐츠 스크립트·picker-control에 걸친 기초 인프라. 이후 Task 2+3은 훅 교체, Task 4는 스토어 로직, Task 5+6은 UI·이벤트 핸들러, Task 7은 안전 확인.
