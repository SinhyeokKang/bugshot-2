# 30s Replay — 기술 설계

## 개요

기존 background 메시지 패턴(`sendBg({ type: "captureVisibleTab" })`)을 통해 `chrome.tabs.captureVisibleTab()`을 500ms 간격으로 호출해 JPEG 스크린샷을 Blob으로 변환하여 순환 버퍼(30초분)에 쌓아둔다. 사용자가 "30s Replay"를 트리거하면 버퍼의 프레임을 WebCodecs `VideoEncoder`(H.264)로 인코딩하고 `mp4-muxer`로 MP4 컨테이너에 담아 Blob을 반환한다. 이후 기존 비디오 모드의 드래프팅 흐름에 `captureMode: "video"` + `captureSource: "30s-replay"`로 진입한다.

Side Panel은 Chrome 정책상 `activeTab` grant를 받지 못한다 (Chromium Issue #40916430 — 의도된 설계). `captureVisibleTab`은 `activeTab` 또는 `<all_urls>` host permission이 필요하므로, **`optional_host_permissions`에 이미 선언된 `https://*/*` + `http://*/*`를 런타임에 요청**하여 획득한다. 사용자가 설정 > 이슈 설정에서 "30s Replay" Switch를 ON하면 `chrome.permissions.request()`로 1회 동의를 받고, Chrome이 영구 저장하므로 이후 재요청 없이 동작한다.

## 변경 범위

### 새 파일

| 파일 | 역할 |
|---|---|
| `src/sidepanel/30s-replay/frame-buffer.ts` | JPEG Blob 순환 버퍼. push/drain/clear |
| `src/sidepanel/30s-replay/mp4-encoder.ts` | WebCodecs VideoEncoder + mp4-muxer 래퍼 |
| `src/sidepanel/30s-replay/use-30s-replay.ts` | React hook: 캡처 루프 lifecycle + 인코딩 트리거 |

### 수정 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/store/editor-store.ts` | 에디터 상태 관리 | `CaptureSource` 타입 추가 (`"manual" \| "30s-replay"`), `captureSource` 필드 추가, `on30sReplayComplete()` 액션 추가 |
| `src/store/settings-ui-store.ts` | 설정 상태 관리 | `replayEnabled: boolean` 필드 추가 (기본 `false`), `setReplayEnabled()` 액션 추가, 스토어 버전 bump (v5→v6) |
| `src/sidepanel/tabs/SettingsTab.tsx` | 설정 UI | 이슈 설정 탭에 "30s Replay" Switch 행 추가. ON 전환 시 `chrome.permissions.request()` 호출, 거부 시 OFF 복귀 |
| `src/sidepanel/App.tsx` | 사이드패널 루트 | `use30sReplay` hook 전역 마운트 (`replayEnabled` 조건부) |
| `src/sidepanel/tabs/IssueTab.tsx` | 캡처 모드별 UI 분기 | Freeform 버튼 제거 → PageFooter "이슈 작성" 버튼으로 이동. 기존 위치에 30s Replay 버튼 추가 (1×2×1 그리드 유지). `replayEnabled=false`이면 disabled + 안내 tooltip |
| `src/background/messages.ts` | background 메시지 핸들러 | `captureVisibleTab` 핸들러에 JPEG format/quality 옵션 추가. 30s Replay 전용 `format` 파라미터를 메시지에 추가하여 기존 screenshot/element 캡처(PNG)에 영향을 주지 않도록 분기 |
| `package.json` | 의존성 | `mp4-muxer` 추가 |

### 변경 없음 (재사용)

`captureMode: "video"`를 그대로 사용하므로 기존 video 경로의 모든 분기(`DraftingPanel`, `PreviewPanel`, `confirmDraft`, `buildCaptureFiles`, `buildIssueAdf`, `buildGithubIssueBody` 등)가 자동으로 호환된다.

| 파일 | 이유 |
|---|---|
| `src/sidepanel/video-capture.ts` | 기존 수동 녹화 전용. 30s Replay와 독립 |
| `src/sidepanel/video-recorder.ts` | 위와 동일 |
| `src/store/blob-db.ts` | `saveVideoBlob()` 그대로 사용 |
| `src/content/console-recorder.ts` | 기존 sentinel 패턴 그대로 |
| `src/content/network-recorder.ts` | 위와 동일 |
| `src/sidepanel/tabs/DraftingPanel.tsx` | `captureMode === "video"` 경로 자동 호환 |
| `src/sidepanel/tabs/PreviewPanel.tsx` | 위와 동일 |
| `src/sidepanel/lib/buildCaptureFiles.ts` | 위와 동일 |
| `src/sidepanel/lib/buildIssueAdf.ts` | 위와 동일 |
| `src/sidepanel/lib/buildGithubIssueBody.ts` | 위와 동일 |
| `src/sidepanel/lib/buildLinearIssueBody.ts` | 위와 동일 |
| `src/sidepanel/lib/buildNotionIssueBody.ts` | 위와 동일 |
| `src/sidepanel/components/AiDraftDialog.tsx` | 위와 동일 |
| `src/sidepanel/components/DraftDetailDialog.tsx` | 위와 동일 |
| `src/sidepanel/components/IssueCreateModal.tsx` | 위와 동일 |
| `src/sidepanel/tabs/IssueListTab.tsx` | 위와 동일 |
| `src/background/tab-bindings.ts` | `shouldPreserveSession` video 경로 자동 호환 |

## 권한 획득 모델

### 문제

`chrome.tabs.captureVisibleTab()`은 `activeTab` 또는 `<all_urls>` host permission이 필요하다. Chrome Side Panel은 `activeTab` grant를 받지 못하는 것이 **의도된 설계** (Chromium Issue #40916430). 따라서 `activeTab`만으로는 Side Panel에서 발신한 `captureVisibleTab` 호출이 실패한다.

기존 picker 캡처(element/screenshot)는 사용자 제스처 직후 1회성 호출이라 `activeTab`이 유효하지만, 30s Replay는 30초+ 연속 호출이므로 동일 방식이 불가하다.

### 해결: optional_host_permissions 런타임 요청

manifest에 이미 선언된 `optional_host_permissions: ["https://*/*", "http://*/*"]`를 활용한다.

```
사용자: 설정 > 이슈 설정 > "30s Replay" Switch ON
  │
  ├─ chrome.permissions.contains({ origins: ["https://*/*", "http://*/*"] })
  │   ├─ 이미 승인됨 → replayEnabled = true, 캡처 루프 시작
  │   └─ 미승인 →
  │       └─ chrome.permissions.request({ origins: ["https://*/*", "http://*/*"] })
  │           ├─ 승인 → replayEnabled = true, 캡처 루프 시작
  │           └─ 거부 → Switch OFF 복귀, toast 안내
  │
사용자: Switch OFF
  └─ replayEnabled = false, 캡처 루프 중지 (권한은 유지 — 재활성화 시 재요청 불필요)
```

**권한 영속성**: `chrome.permissions.request()`로 획득한 권한은 Chrome이 영구 저장한다. 브라우저 재시작, 익스텐션 업데이트에도 유지. 해제는 코드에서 `chrome.permissions.remove()` 호출 또는 사용자가 `chrome://extensions`에서 직접 철회 시에만 발생.

**외부 철회 대응**: 캡처 루프 시작 시점에 `chrome.permissions.contains()` 재확인. 권한 없으면 `replayEnabled` 자동 OFF + toast 안내.

### Rate Limit

Chrome은 `captureVisibleTab` 호출을 **초당 최대 2회**로 제한 (Chrome 92~, `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2`). 500ms interval은 정확히 한계선이므로, 이전 호출이 미완료 상태면 다음 틱을 스킵하는 방어 로직을 둔다.

## 데이터 흐름

```
┌─ 사이드패널 (extension page) ──────────────────────────────┐
│                                                             │
│  use30sReplay hook (App.tsx 전역 마운트, replayEnabled 조건부) │
│  ├─ 시작 시 permissions.contains() 확인 (실패 시 자동 OFF)   │
│  ├─ setInterval 500ms (이전 호출 미완료 시 스킵)              │
│  │   └─ sendBg({ type: "captureVisibleTab", tabId })        │
│  │       └─ dataUrl → Blob 변환 → FrameBuffer.push(blob)   │
│  │                                                          │
│  └─ encode() (사용자 "30s Replay" 클릭 시)                   │
│      ├─ FrameBuffer.snapshot() → Frame[] (복사)              │
│      ├─ for each frame:                                     │
│      │   createImageBitmap(blob, {resize ≤1280w})           │
│      │   → VideoFrame → VideoEncoder.encode()               │
│      │   → mp4-muxer.addVideoChunk()                        │
│      │   (매 N프레임마다 yield로 메인 스레드 양보)              │
│      ├─ muxer.finalize() → ArrayBuffer → Blob(video/mp4)   │
│      ├─ 성공 시 FrameBuffer.clear()                          │
│      ├─ syncConsoleRecorder + syncNetworkRecorder (hook에서)  │
│      └─ editorStore.on30sReplayComplete(blob, thumbnail)    │
│          → phase: "drafting", captureMode: "video"          │
│            captureSource: "30s-replay"                       │
│                                                             │
│  기존 콘솔/네트워크 로그:                                      │
│  useBackgroundRecorder가 이미 패널 열림 시 활성화             │
│  → idle → drafting 전이 시 recorder 재주입 억제 조건에       │
│    해당하지 않아 정상 동작 (recording → drafting만 억제)       │
│  → 드래프팅 진입 시 syncConsoleRecorder/syncNetworkRecorder  │
└─────────────────────────────────────────────────────────────┘
```

## 인터페이스 설계

### FrameBuffer

```typescript
// src/sidepanel/30s-replay/frame-buffer.ts

interface CapturedFrame {
  blob: Blob;         // JPEG Blob (data URL → Blob 변환하여 저장, base64 오버헤드 제거)
  timestamp: number;  // Date.now() at capture time
}

class FrameBuffer {
  private buffer: CapturedFrame[] = [];
  private maxFrames: number;
  private maxDurationMs: number;

  constructor(maxFrames?: number, maxDurationMs?: number);

  /** 프레임 추가. maxFrames 초과 시 oldest 제거. maxDurationMs 초과 프레임도 시간 기반으로 제거. */
  push(blob: Blob, timestamp: number): void;

  /** 현재 버퍼의 모든 프레임을 복사하여 반환 (버퍼는 유지) */
  snapshot(): CapturedFrame[];

  /** 현재 버퍼의 모든 프레임을 꺼내고 버퍼를 비운다 */
  drain(): CapturedFrame[];

  /** 버퍼 비우기 */
  clear(): void;

  /** 현재 버퍼 크기 */
  get size(): number;

  /** 버퍼에 담긴 시간 범위 (ms) */
  get durationMs(): number;
}
```

### Mp4Encoder

```typescript
// src/sidepanel/30s-replay/mp4-encoder.ts

interface EncodeOptions {
  maxWidth: number;      // 기본 1280
  bitrate: number;       // 기본 2_000_000
  frames: CapturedFrame[];
  onProgress?: (current: number, total: number) => void;
}

async function encodeToMp4(options: EncodeOptions): Promise<{
  blob: Blob;
  thumbnail: string;
  width: number;
  height: number;
}>;
```

내부 구현:
- 첫 프레임에서 원본 크기 파악, `maxWidth` 초과 시 비율 유지 축소
- width/height를 짝수로 올림 (H.264 요구사항)
- 코덱 자동 선택: `VideoEncoder.isConfigSupported()`로 Baseline 6.1 → High 5.1 → Baseline 3.1 순 탐색. 전체 실패 시 에러 throw + toast 안내
- 프레임간 duration: `frames[i+1].timestamp - frames[i].timestamp` (μs)
- keyFrame: 매 30프레임
- `mp4-muxer` 설정: `fastStart: 'in-memory'`, `video.codec: 'avc'`
- `decoderConfig.colorSpace` null 시 bt709 기본값 주입 (macOS Chrome 이슈)
- 첫 프레임의 Blob으로 `createImageBitmap` → canvas에 그려 JPEG thumbnail data URL 생성
- 프레임 루프에서 매 N프레임마다 `await new Promise(r => setTimeout(r, 0))`으로 메인 스레드 양보 (UI 블록 방지)

### use30sReplay hook

```typescript
// src/sidepanel/30s-replay/use-30s-replay.ts

interface Use30sReplayReturn {
  /** 캡처 루프 동작 중 여부 */
  isCapturing: boolean;
  /** 최소 프레임(10장) 확보 여부 — 버튼 활성/비활성 제어용 */
  isReady: boolean;
  /** 인코딩 진행 중 여부 */
  isEncoding: boolean;
  /** 인코딩 진행률 (0-1) */
  encodeProgress: number;
  /** 인코딩 트리거: 버퍼 → MP4 → editorStore */
  capture: () => Promise<void>;
}

function use30sReplay(tabId: number | null, enabled: boolean): Use30sReplayReturn;
```

동작:
- `enabled && tabId`가 유효하면 캡처 루프 시작
- 시작 시 `chrome.permissions.contains({ origins: ["https://*/*", "http://*/*"] })` 확인. 권한 없으면 `replayEnabled` → OFF + toast 안내 후 루프 미시작
- `setInterval(500)` — 이전 호출이 미완료 상태면 해당 틱 스킵 (rate limit 방어)
- 각 틱: `sendBg({ type: "captureVisibleTab", tabId })` → data URL → Blob 변환 → `frameBuffer.push(blob, timestamp)`. background handler가 `tabId`로 `windowId`를 내부 resolve (기존 패턴 유지).
- 바운드 탭이 비활성(포커스 아님)이면 캡처 스킵 (`chrome.tabs.get(tabId)` → `active` 체크)
- `captureVisibleTab` 에러 시 (탭 닫힘, 네비게이션 중 등) 조용히 스킵
- **phase gating**: `phase !== "idle"`이면 캡처 루프 일시 중지 (수동 비디오 녹화 중, 드래프팅/프리뷰 중, element picker/screenshot 캡처 중 등). idle 복귀 시 재개. 이를 통해 `captureVisibleTab` rate limit 경합을 방지한다.
- `enabled`가 false로 전환되면 인터벌 정지 + 버퍼 clear
- `isReady`: `frameBuffer.size >= 10` (최소 5초 분량 확보)
- `capture()` 호출 시: 인터벌 일시정지 → `frameBuffer.snapshot()` (복사) → `encodeToMp4()` → 성공 시 `frameBuffer.clear()` + `syncConsoleRecorder(tabId)` + `syncNetworkRecorder(tabId)` + `editorStore.on30sReplayComplete()`. 실패 시 toast 에러 알림 + `isEncoding: false` 복귀 + 인터벌 재개 (버퍼 보존)
- 언마운트 시 인터벌 정리 + 버퍼 clear

### EditorStore 변경

```typescript
// src/store/editor-store.ts 추가분

type CaptureSource = "manual" | "30s-replay";

interface EditorState {
  // 기존 필드 유지 (CaptureMode 변경 없음)
  // ...
  captureSource: CaptureSource | null;  // 신규
}

interface EditorActions {
  // 기존 액션 유지
  // ...

  /** 30s Replay 완료 → 드래프팅 진입 */
  on30sReplayComplete: (
    blob: Blob,
    thumbnail: string,
    viewport: { width: number; height: number }
  ) => void;
}
```

`on30sReplayComplete` 구현:
- `captureMode` → `"video"` (기존 video 경로 호환)
- `captureSource` → `"30s-replay"` (구분용)
- `phase` → `"drafting"` (recording 단계 스킵)
- `videoBlob`, `videoThumbnail`, `videoViewport` 설정
- `videoCapturedAt: Date.now()`
- 콘솔/네트워크 레코더 동기화는 **hook의 `capture()`에서 처리** (스토어 액션은 side-effect free 유지)

`EditorSnapshot` 타입에 `captureSource` 필드 추가 — 세션 영속화/복원 시 30s-replay 여부 보존.

### SettingsUiStore 변경

```typescript
// src/store/settings-ui-store.ts 추가분

interface SettingsUiState {
  // 기존 필드 유지
  // ...
  replayEnabled: boolean;  // 신규 (기본 false)
  setReplayEnabled: (enabled: boolean) => void;  // 신규
}
```

`setReplayEnabled(true)` 호출 시 스토어는 값만 저장. 권한 요청 로직은 SettingsTab UI 레이어에서 처리 (스토어는 side-effect free 유지).

스토어 버전 bump v5→v6 마이그레이션: `version < 6` 분기에서 `replayEnabled: false` 기본값 설정. 기존 패턴(`version < 3` → `llm` 초기화 등)과 동일.

### SettingsTab — 30s Replay Switch

이슈 설정 탭의 "제목 설정" 아래, "본문 구성" 위에 "캡처" 섹션을 추가한다.

```
Section: "캡처"
└─ Card
   └─ Row: [Timer 아이콘] "30s Replay" + 도움말 텍스트 + Switch
```

Switch `onCheckedChange` 핸들러:
1. ON 전환 → `chrome.permissions.contains()` 확인
2. 미승인 → `chrome.permissions.request()` 호출
3. 승인 → `setReplayEnabled(true)`, 거부 → Switch OFF 복귀 + toast
4. OFF 전환 → `setReplayEnabled(false)` (권한은 유지)

기존 `IssueSectionRow`와 동일한 레이아웃 패턴 사용.

### IssueTab — EmptyState 리팩터 + 30s Replay 버튼

기존 Freeform 버튼을 제거하고, PageFooter에 "이슈 작성" 버튼으로 이동 (로그 탭과 동일 패턴). 기존 Freeform 위치(col-span-2)에 30s Replay 버튼을 추가하여 **1×2×1 그리드** 유지.

```
┌──────────────────────────────────┐
│        [Element Capture]         │  col-span-2 (primary)
├────────────────┬─────────────────┤
│  [Screenshot]  │    [Video]      │  col-span-1 + col-span-1
├────────────────┴─────────────────┤
│         [30s Replay]             │  col-span-2 (outline)
└──────────────────────────────────┘
┌──────────────────────────────────┐
│  PageFooter: [이슈 작성]          │  Freeform → drafting 진입
└──────────────────────────────────┘
```

| 조건 | 버튼 상태 | Tooltip |
|---|---|---|
| `replayEnabled=false` | disabled (반투명) | "이슈 설정에서 30s Replay를 활성화할 수 있습니다" |
| `replayEnabled=true`, `isReady=false` | disabled | "화면을 기록하고 있습니다…" |
| `replayEnabled=true`, `isReady=true` | 활성 | 없음 |
| `isEncoding=true` | disabled + `Loader2` 스피너 (기존 `animate-spin` 패턴) | 없음 |
| `phase!="idle"` (수동 녹화/드래프팅/프리뷰 등) | disabled | 없음 |

`replayEnabled=false` 및 `isReady=false` 상태에서 tooltip을 표시하여, 비활성 이유를 알려준다.

## 기존 패턴 준수

- **sentinel 패턴**: 콘솔/네트워크 레코더 활성화에 기존 `activateConsoleRecorder()` / `activateNetworkRecorder()` 재사용. 30s Replay 전용 sentinel 불필요.
- **background 메시지 패턴**: `captureVisibleTab`은 기존 `sendBg()` 패턴을 따라 background에서 호출. side panel에서 직접 호출하지 않는다.
- **useBackgroundRecorder**: 패널 열림 시 레코더 주입이 이미 이 훅에서 처리됨. `idle → drafting` 전이 시 recorder 재주입 억제 조건(`prev.phase === "recording" && state.phase === "drafting"`)에 해당하지 않아 정상 동작.
- **phase gating**: 30s Replay는 `"recording"` 단계를 건너뛰고 바로 `"drafting"`으로 진입. `captureMode: "video"`이므로 기존 video 관련 phase 분기를 모두 자동으로 탄다. 캡처 루프는 `phase === "idle"`일 때만 동작하여 `captureVisibleTab` rate limit 경합을 방지한다.
- **useBackgroundRecorder 상호작용**: 30s Replay의 `idle → drafting` 전이는 `useBackgroundRecorder`의 recorder 억제 조건(`prev.phase === "recording" && state.phase === "drafting"`)에 해당하지 않는다. 그러나 `shouldPreserveBackgroundLogs("idle") === false`이므로 clear 블록도 안 탄다. recorder sync는 hook의 `capture()`에서 직접 호출하여 처리한다. `drafting → idle` 복귀 시 `shouldPreserveBackgroundLogs("drafting") === true`로 기존 clear + inject 흐름이 정상 발동하며, 이때 캡처 루프도 idle 감지로 재개되므로 타이밍 충돌 없다.
- **blob 영속화**: 기존 `saveVideoBlob(issueId, blob)` 그대로 사용. `confirmDraft` 시점에 `captureMode === "video"` 분기를 타며 IndexedDB 저장.

## 대안 검토

### A. rrweb DOM 녹화 → 리플레이 → 스크린샷 → MP4

PoC에서 검증한 접근. html-to-image(SVG foreignObject)는 cross-origin CSS SecurityError로 실패. CDP 스크린샷은 동작하나 프레임당 ~150ms 소요로 60프레임 인코딩에 ~10초. 3초 제약 미충족. **기각.**

### B. tabCapture MediaStream 가속 재생

rrweb 이벤트를 새 탭에서 가속 재생하고 tabCapture로 MediaStream 캡처. 30초 녹화를 4x 재생 시 ~8초. 실시간 바운드. **기각.**

### C. captureVisibleTab 실시간 캡처 (채택)

녹화 중에 이미 프레임을 확보하므로 "캡처" 시 인코딩만 수행. 60프레임 인코딩 ~1-2초. 3초 제약 충족. CORS/CSS 문제 없음 (브라우저 렌더링 파이프라인 직접 캡처). **채택.**

## 위험 요소

1. **`captureVisibleTab` 성능**: 500ms 간격에서 호출당 ~20-50ms. CPU 오버헤드 ~5%. 저사양 기기에서 추가 검증 필요.

2. **Rate Limit**: Chrome은 `captureVisibleTab`을 **초당 최대 2회**로 제한 (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`, Chrome 92~). 500ms interval이 정확히 한계선. 이전 호출 미완료 시 다음 틱을 스킵하는 가드 필수 — 실패 시 `"This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota"` 에러.

3. **메모리**: JPEG Blob 기준 프레임당 ~100-200KB. 60프레임 = 6-12MB. 레티나(devicePixelRatio=2) 디스플레이에서 프레임 크기가 2배로 커질 수 있음 — quality를 65로 낮추거나 캡처 시점에 리사이즈 고려. background handler는 `format: "jpeg", quality: 65`로 호출해야 한다 (기존 PNG 대비 3-5x 절감).

4. **권한 외부 철회**: 사용자가 `chrome://extensions`에서 host permission을 직접 철회할 수 있다. 캡처 루프 시작 시점에 `permissions.contains()` 재확인, 권한 없으면 `replayEnabled` 자동 OFF + toast 안내.

5. **탭 비활성 시 captureVisibleTab**: 바운드 탭이 비활성(다른 탭 포커스)이면 다른 탭을 캡처하거나 에러. 반드시 바운드 탭의 `active` 상태를 확인하고 비활성 시 스킵.

5-1. **captureVisibleTab 경합**: element snapshot(`capture.ts`), area capture(`usePickerMessages.ts`)에서도 `captureVisibleTab`을 호출한다. 30s Replay 루프가 500ms마다 호출하는 중에 다른 캡처가 동시 요청되면 Chrome rate limit(초당 2회)을 초과할 수 있다. **해결**: 캡처 루프가 `phase === "idle"`일 때만 동작하므로, picker/screenshot 진행 중(phase가 idle이 아닌 상태)에는 루프가 자동 일시정지되어 경합을 방지한다.

6. **VideoEncoder 코덱 지원**: macOS Chrome에서 H.264 Baseline Level 3.1은 1280px 이하만 지원. 자동 레벨 탐색 로직 필수 (PoC에서 검증 완료). 전체 코덱 탐색 실패 시 에러 throw + toast 안내로 복귀.

7. **mp4-muxer colorSpace null**: macOS Chrome에서 VideoEncoder output의 `decoderConfig.colorSpace`가 null일 수 있음. bt709 기본값 주입 필요 (PoC에서 검증 완료).

8. **탭 네비게이션**: 사용자가 다른 URL로 이동하면 버퍼에 이전 페이지 프레임과 새 페이지 프레임이 섞임. 버그 재현 과정 전체를 담기 위해 버퍼를 유지한다 (의도된 동작).

9. **인코딩 중 메인 스레드 블록**: 60프레임 루프에서 `createImageBitmap` + `VideoFrame` 생성이 메인 스레드를 차지. 매 N프레임마다 yield로 UI 블록 방지.
