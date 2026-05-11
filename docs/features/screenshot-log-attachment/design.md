# Screenshot Log Attachment — 기술 설계

## 개요

사이드패널이 열려 있는 동안 네트워크/콘솔 레코더를 항상 주입하여 백그라운드 캡처를 수행한다. 기존 비디오 모드 전용이던 레코더 주입을 새 훅(`useBackgroundRecorder`)으로 분리하고, 스크린샷 DraftingPanel에 비디오와 동일한 로그 UI를 추가한다. 레코더에 `clear` 이벤트를 추가하여 녹화 모드 진입 시 버퍼를 초기화한다.

## 변경 범위

### 신규 파일

#### `src/sidepanel/hooks/useBackgroundRecorder.ts`

레코더 생명주기를 전담하는 훅. `App.tsx`에서 호출.

- **마운트**: `tabId` 유효 시 네트워크/콘솔 레코더 주입 (`injectNetworkRecorder`, `injectConsoleRecorder`)
- **URL 변경 감지**: `chrome.tabs.onUpdated`로 감지. 로그 초기화 (에디터 스토어 + IndexedDB `pending:{tabId}`) → 레코더 재주입
- **페이지 로드 완료**: `status === "complete"` 시 레코더 재주입 (rebind — 페이지 리로드로 MAIN world 초기화된 경우 대응)
- **스크린샷 모드 진입**: `phase === "capturing" && captureMode === "screenshot"` 감지 → `syncNetworkRecorder` + `syncConsoleRecorder` 호출하여 최신 데이터 전송 유도
- **녹화 모드 진입**: `phase === "recording"` 감지 → 로그 클리어 (스토어 + IndexedDB + 레코더 버퍼 `clearNetworkRecorder`/`clearConsoleRecorder`)
- **녹화 종료 후**: 레코더는 `stopNetworkRecorder`/`stopConsoleRecorder`에 의해 이미 중지됨 (`video-recorder.ts`). 훅은 재주입하지 않음. `recordersStopped` ref를 `true`로 세팅하여 `onUpdated(complete)` 이벤트에서도 재주입 방지. URL 변경 시에만 ref 리셋 + 재주입.
- **언마운트**: 레코더 stop + IndexedDB `pending:{tabId}` 삭제

### 변경 파일

#### `src/content/network-recorder.ts`

- `__bugshot_net_clear__<sentinel>` 이벤트 리스너 추가: `buffer` 배열 비우기, `totalSeen` 리셋, `warnings` 클리어
- `__bugshot_net_ctrl__`에 `clearBuffer()` 메서드 노출 (rebind과 같은 패턴)

#### `src/content/console-recorder.ts`

- `__bugshot_console_clear__<sentinel>` 이벤트 리스너 추가: `buffer` 배열 비우기, `totalSeen` 리셋
- `__bugshot_console_ctrl__`에 `clearBuffer()` 메서드 노출

#### `src/content/picker.ts`

- `networkRecorder.clear` 메시지 핸들러 추가: `__bugshot_net_clear__<sentinel>` 이벤트 디스패치
- `consoleRecorder.clear` 메시지 핸들러 추가: `__bugshot_console_clear__<sentinel>` 이벤트 디스패치

#### `src/sidepanel/picker-control.ts`

- `clearNetworkRecorder(tabId: number): Promise<void>` 추가 — `{ type: "networkRecorder.clear" }` 메시지 전송
- `clearConsoleRecorder(tabId: number): Promise<void>` 추가 — `{ type: "consoleRecorder.clear" }` 메시지 전송

#### `src/types/picker.ts`

- `PickerMessage` union에 `{ type: "networkRecorder.clear" }` 및 `{ type: "consoleRecorder.clear" }` 추가

#### `src/store/editor-store.ts`

**`startCapturing` 변경:**

현재 `set({ ...initial, captureMode: "screenshot", phase: "capturing", target })` — 로그 필드를 리셋.

변경: 콜백 형태로 전환하여 `networkLog`, `consoleLog`를 보존.

```typescript
startCapturing: (target) => set((prev) => ({
  ...initial,
  captureMode: "screenshot",
  phase: "capturing",
  target,
  networkLog: prev.networkLog,
  consoleLog: prev.consoleLog,
})),
```

`networkLogAttach`/`consoleLogAttach`는 `initial` 값(`false`) 유지 — 비디오와 동일하게 사용자가 명시 토글.

**`confirmDraft` 변경:**

screenshot 분기에 네트워크/콘솔 로그 저장 로직 추가. 비디오 분기의 기존 패턴을 그대로 따름:

```typescript
// screenshot 분기 내부, saveDraft 호출 시 추가 필드:
networkLogBlobKey: hasNetworkLog ? id : undefined,
consoleLogBlobKey: hasConsoleLog ? id : undefined,

// saveDraft 이후 blob 저장:
if (hasNetworkLog) {
  if (!await saveNetworkLog(id, state.networkLog!)) { onBlobSaveFailed.fire(); }
  deleteNetworkLog(`pending:${targetTabId}`).catch(() => {});
}
if (hasConsoleLog) {
  if (!await saveConsoleLog(id, state.consoleLog!)) { onBlobSaveFailed.fire(); }
  deleteConsoleLog(`pending:${targetTabId}`).catch(() => {});
}
```

#### `src/sidepanel/tabs/DraftingPanel.tsx`

**`showLogCards` 조건 변경:**

```typescript
// 변경 전
const showLogCards = isVideoMode && (
  (networkLog !== null && networkLog.captured > 0) ||
  (consoleLog !== null && consoleLog.captured > 0)
);

// 변경 후
const showLogCards = (isVideoMode || captureMode === "screenshot") && (
  (networkLog !== null && networkLog.captured > 0) ||
  (consoleLog !== null && consoleLog.captured > 0)
);
```

나머지 로그 UI (LogAttachmentCards, NetworkLogPreviewDialog, ConsoleLogPreviewDialog)는 이미 props 기반이므로 변경 불필요.

#### `src/sidepanel/tabs/IssueTab.tsx`

**`handleStartVideo` 변경:**

기존 레코더 주입을 "재주입 + 버퍼 클리어"로 교체:

```typescript
async function handleStartVideo(tabId: number) {
  const tab = await chrome.tabs.get(tabId);

  // 1. 백그라운드 로그 클리어 (스토어 + IndexedDB)
  useEditorStore.getState().setNetworkLog(null);
  useEditorStore.getState().setConsoleLog(null);
  deleteNetworkLog(`pending:${tabId}`).catch(() => {});
  deleteConsoleLog(`pending:${tabId}`).catch(() => {});

  // 2. 레코더 재주입 (이미 있으면 rebind) + 버퍼 클리어
  try { await injectNetworkRecorder(tabId); } catch {}
  try { await injectConsoleRecorder(tabId); } catch {}
  try { await clearNetworkRecorder(tabId); } catch {}
  try { await clearConsoleRecorder(tabId); } catch {}

  // 3. 녹화 시작
  useEditorStore.getState().startRecording({
    tabId,
    url: tab.url ?? "",
    title: tab.title ?? "",
  });
  try {
    await videoRecorder.startRecording(tabId);
  } catch (err) {
    useEditorStore.getState().cancelRecording();
  }
}
```

#### `src/sidepanel/hooks/useEditorSessionSync.ts`

비디오 녹화 중 페이지 완료 시 레코더 재주입 로직 제거 (해당 책임이 `useBackgroundRecorder`로 이동):

```typescript
// 제거 대상 (기존 onTabUpdated 핸들러 내):
if (s.captureMode === "video" && s.phase === "recording") {
  injectNetworkRecorder(tabId).catch(() => {});
  injectConsoleRecorder(tabId).catch(() => {});
}
```

#### `src/sidepanel/App.tsx`

`useBackgroundRecorder(tabId)` 호출 추가. `useBoundTabId()` 이후, `useEditorSessionSync()` 이후에 배치.

## 데이터 흐름

### 백그라운드 레코딩 (사이드패널 열림 → 스크린샷 캡처)

```
[마운트]
  useBackgroundRecorder(tabId)
    → injectNetworkRecorder(tabId)    // MAIN world에 레코더 주입
    → injectConsoleRecorder(tabId)    // MAIN world에 레코더 주입
    → 레코더: recording=true, 버퍼 축적 시작

[웹 페이지 활동]
  fetch/XHR → networkRecorderScript buffer (50MB cap)
  console.* → consoleRecorderScript buffer (2000 entry cap)

[스크린샷 모드 진입]
  useBackgroundRecorder: phase=capturing 감지
    → syncNetworkRecorder(tabId)      // 최신 데이터 요청
    → syncConsoleRecorder(tabId)

  MAIN world: __bugshot_net_sync__ → dispatch → __bugshot_net_data__
    → picker.ts bridge → chrome.runtime.sendMessage
    → usePickerMessages: setNetworkLog(log) + saveNetworkLog(pending:{tabId})

[사용자 영역 선택]
  picker.areaSelected → captureAndCrop → onAreaCaptured → phase=drafting

[DraftingPanel]
  showLogCards = true (screenshot + logs exist)
  LogAttachmentCards 렌더링 (비디오와 동일 UI)

[이슈 확정]
  confirmDraft()
    → saveNetworkLog(issueId, log) + deleteNetworkLog(pending:{tabId})
    → saveConsoleLog(issueId, log) + deleteConsoleLog(pending:{tabId})
```

### 녹화 모드 전환

```
[백그라운드 레코딩 중]
  네트워크/콘솔 버퍼에 데이터 축적 중

[녹화 시작]
  handleStartVideo(tabId)
    → setNetworkLog(null), setConsoleLog(null)      // 스토어 클리어
    → deleteNetworkLog(pending:{tabId})              // IndexedDB 클리어
    → injectNetworkRecorder + clearNetworkRecorder   // 버퍼 클리어
    → injectConsoleRecorder + clearConsoleRecorder
    → startRecording(target)                         // phase=recording
    → videoRecorder.startRecording(tabId)

  useBackgroundRecorder: phase=recording 감지
    → recordersStopped ref = true

[녹화 중]
  레코더가 녹화 구간 데이터만 캡처

[녹화 종료]
  video-recorder.ts: stopNetworkRecorder + stopConsoleRecorder
    → 최종 데이터 디스패치 → usePickerMessages에서 수신
    → setNetworkLog(recordingLog) + saveNetworkLog(pending:{tabId})
    → 레코더: recording=false

[녹화 후]
  recordersStopped=true → onUpdated(complete)에도 재주입 안 함
  URL 변경 시 → recordersStopped=false, 로그 초기화, 레코더 재주입
```

### 사이드패널 종료

```
[언마운트]
  useBackgroundRecorder cleanup:
    → stopNetworkRecorder(tabId)       // recording=false
    → stopConsoleRecorder(tabId)
    → deleteNetworkLog(pending:{tabId})
    → deleteConsoleLog(pending:{tabId})
```

## 인터페이스 설계

### 신규 메시지 타입 (`src/types/picker.ts`)

```typescript
// PickerMessage union에 추가
| { type: "networkRecorder.clear" }
| { type: "consoleRecorder.clear" }
```

### 신규 함수 (`src/sidepanel/picker-control.ts`)

```typescript
export async function clearNetworkRecorder(tabId: number): Promise<void>;
export async function clearConsoleRecorder(tabId: number): Promise<void>;
```

### 신규 훅 (`src/sidepanel/hooks/useBackgroundRecorder.ts`)

```typescript
export function useBackgroundRecorder(tabId: number | null): void;
```

반환값 없음. 내부적으로 `useEffect` + `chrome.tabs.onUpdated` 리스너 + 에디터 스토어 구독으로 동작.

### 레코더 MAIN world 변경

```typescript
// network-recorder.ts — __bugshot_net_ctrl__ 확장
interface NetCtrl {
  rebind(newSentinel: string): void;
  clearBuffer(): void;  // 신규
}

// console-recorder.ts — __bugshot_console_ctrl__ 확장
interface ConsoleCtrl {
  rebind(newSentinel: string): void;
  clearBuffer(): void;  // 신규
}
```

## 기존 패턴 준수

- **세션 영속화**: `usePickerMessages`에서 로그 수신 시 `saveNetworkLog(pending:{tabId})` / `saveConsoleLog(pending:{tabId})`로 IndexedDB에 즉시 저장하는 기존 패턴 유지. `useEditorSessionSync`의 세션 스냅샷에는 `networkLog`/`consoleLog`를 포함하지 않아야 함 (크기 문제) — 현재 비디오 모드에서 이미 IndexedDB 경유 복구 패턴을 사용 중이므로 동일하게.
- **메시지 비동기 응답**: `picker-control.ts`의 `send()` 래퍼를 사용하여 content script에 메시지 전송.
- **MAIN world 주입**: `chrome.scripting.executeScript({ world: "MAIN" })` + sentinel 패턴 유지.
- **SPA 재주입 가드**: `__bugshot_net_ctrl__` / `__bugshot_console_ctrl__` 존재 시 `rebind()` 호출하는 기존 패턴 유지.
- **i18n**: 로그 UI는 기존 비디오 모드의 키를 그대로 사용 (`section.logs` 등). 신규 키 불필요.
- **LogAttachmentCards**: props 기반 컴포넌트이므로 스크린샷 모드에서도 동일하게 재사용.

## 대안 검토

### 대안 1: 주기적 sync로 에디터 스토어 최신 유지

스크린샷 진입 시 on-demand sync 대신 30초 간격으로 주기적 sync.

**기각 이유**: 불필요한 메시지 트래픽. 로그 데이터는 스크린샷 DraftingPanel 진입 시에만 필요하므로 on-demand sync로 충분. 스크린샷 영역 선택에 최소 1~2초 소요되어 sync 데이터 도착 시간 여유 있음.

### 대안 2: 레코더 clear 대신 rebind에 clearBuffer 옵션 추가

녹화 진입 시 `rebind(sentinel, { clear: true })` 호출.

**기각 이유**: rebind은 sentinel 교체 용도로 설계됨. clear는 별도 관심사이므로 독립 이벤트가 명확. `rebind`의 시그니처를 변경하면 기존 호출처(SPA 재주입)에 영향.

## 위험 요소

### 🔴 블로커: 세션 스냅샷 크기

`networkLog`/`consoleLog`가 에디터 스토어에 있으므로 `useEditorSessionSync`의 debounced save(300ms)에 포함될 수 있음. 백그라운드 레코딩으로 축적된 네트워크 버퍼(최대 50MB)가 `chrome.storage.session`에 매번 직렬화되면:
- `chrome.storage.session` 용량 한도(~10MB) 초과 → 저장 실패 → 세션 복구 불가
- 300ms마다 수십 MB 직렬화 → 메인 스레드 블로킹 → 사이드패널 UI 프리징

**반드시 구현 초반에 확인·해결해야 한다.** 현재 비디오 모드에서 이미 로그 필드를 스냅샷에서 제외하는 패턴이 있는지 확인하고, 없다면 스냅샷 직렬화에서 `networkLog`/`consoleLog`를 제거하는 로직을 `useBackgroundRecorder` 훅보다 먼저 구현한다. 복구(hydration) 시에는 IndexedDB `pending:{tabId}`에서 로드하는 기존 패턴 유지.

### 성능 — 상시 fetch/XHR/console 래핑

현재 레코더는 비디오 녹화 모드(최대 60초)에서만 동작한다. 백그라운드 레코딩이면 사이드패널이 열려 있는 수십 분~수시간 동안 모든 네트워크 요청을 인터셉트하고 response body를 클론한다.

**영향 범위:**
- fetch/XHR 래퍼: 모든 요청에 `response.clone()` + body 읽기 + 헤더 순회 + 민감정보 마스킹 오버헤드
- console 래퍼: 모든 console.* 호출에 `safeStringify` + 스택 캡처(error/warn) 오버헤드
- 대시보드·실시간 앱 등 요청 빈도 높은 페이지에서 체감 가능

**완화 요소:** 레코더 자체에 이미 50MB 메모리 캡 + content-type 필터(이미지/폰트/바이너리 스킵) + body 3MB 캡이 있어 극단적 리소스 소모는 방지됨.

**대응:** 구현 후 네트워크 요청 빈도 높은 페이지(예: 실시간 대시보드)에서 DevTools Performance 탭으로 프로파일링. 문제 발견 시 body 캡처 없이 메타데이터만 수집하는 lightweight 모드를 후속으로 검토.

### recordersStopped ref 상태 복귀 누락 위험

`recordersStopped` ref는 녹화 종료 후 `true`로 세팅되어 레코더 재주입을 억제한다. 이 ref가 `false`로 리셋되는 경로가 두 가지 있어야 한다:

1. **URL 변경** → ref 리셋 + 레코더 재주입 (설계에 이미 포함)
2. **idle 복귀** → ref 리셋 + 레코더 재주입 (설계에 이미 포함)

idle 복귀 경로가 다양하므로 누락 위험이 있다:
- `녹화 → drafting 취소 → idle` (cancelRecording / reset)
- `녹화 → drafting → previewing → 이슈 제출 → done → idle` (새 작업 시작 시 reset)
- `녹화 → drafting → 이슈 제출 실패 → drafting → 취소 → idle`

**대응:** `useBackgroundRecorder`의 스토어 구독에서 `phase === "idle"` && `recordersStopped === true` 조건으로 처리하면 복귀 경로에 무관하게 idle 진입 시 항상 레코더가 재시작된다. 개별 경로마다 처리하지 않고 결과 상태(idle)만 감지하는 방식으로 엣지케이스를 일괄 커버한다.

### 스크린샷 sync 타이밍

`syncNetworkRecorder` 호출 후 데이터가 에디터 스토어에 도착하기까지 비동기 경로(MAIN → content → sidepanel)를 거침. 사용자가 극히 빠르게 영역을 선택하면 DraftingPanel 초기 렌더 시 로그가 null일 수 있음. 이후 데이터 도착 시 재렌더로 해결되므로 기능적 문제는 없으나, 로그 카드가 나중에 나타나는 시각적 깜빡임 가능.

### 레코더 주입 실패

`ensureContentScript(tabId)` 또는 `executeScript`가 실패할 수 있음 (restricted page, tab closed 등). 현재 비디오 모드에서도 `try/catch + console.warn`으로 처리하므로 동일 패턴 유지. 주입 실패 시 로그 없이 스크린샷만 캡처되는 graceful degradation.
