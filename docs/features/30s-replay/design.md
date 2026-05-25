# 30s Replay — 기술 설계

## 개요

기존 background 메시지 패턴(`sendBg({ type: "captureVisibleTab" })`)을 통해 `chrome.tabs.captureVisibleTab()`을 500ms 간격으로 호출해 JPEG 스크린샷을 Blob으로 변환하여 순환 버퍼(30초분)에 쌓아둔다. 사용자가 "30s Replay"를 트리거하면 버퍼의 프레임을 WebCodecs `VideoEncoder`(H.264)로 인코딩하고 `mp4-muxer`로 MP4 컨테이너에 담아 Blob을 반환한다. 이후 기존 비디오 모드의 드래프팅 흐름에 `captureMode: "video"` + `captureSource: "30s-replay"`로 진입한다.

`captureVisibleTab`은 기존 `activeTab` 권한으로 동작하므로 별도 권한 요청 UI가 불필요하다.

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
| `src/sidepanel/App.tsx` | 사이드패널 루트 | `use30sReplay` hook 전역 마운트 |
| `src/sidepanel/tabs/IssueTab.tsx` | 캡처 모드별 UI 분기 | EmptyState에 30s Replay 버튼 추가 (기존 그리드 내) |
| `src/background/messages.ts` | background 메시지 핸들러 | 기존 `captureVisibleTab` 핸들러 재사용 (변경 최소) |
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
| `src/lib/build-capture-files.ts` | 위와 동일 |
| `src/lib/build-issue-adf.ts` | 위와 동일 |
| `src/lib/build-github-issue-body.ts` | 위와 동일 |
| `src/lib/build-linear-issue-body.ts` | 위와 동일 |
| `src/lib/build-notion-issue-body.ts` | 위와 동일 |
| `src/sidepanel/components/AiDraftDialog.tsx` | 위와 동일 |
| `src/sidepanel/components/DraftDetailDialog.tsx` | 위와 동일 |
| `src/sidepanel/components/IssueCreateModal.tsx` | 위와 동일 |
| `src/sidepanel/tabs/IssueListTab.tsx` | 위와 동일 |
| `src/background/tab-bindings.ts` | `shouldPreserveSession` video 경로 자동 호환 |

## 데이터 흐름

```
┌─ 사이드패널 (extension page) ──────────────────────────────┐
│                                                             │
│  use30sReplay hook (App.tsx 전역 마운트)                     │
│  ├─ setInterval 500ms                                       │
│  │   └─ sendBg({ type: "captureVisibleTab", windowId })     │
│  │       └─ dataUrl → Blob 변환 → FrameBuffer.push(blob)   │
│  │                                                          │
│  └─ encode() (사용자 "30s Replay" 클릭 시)                   │
│      ├─ FrameBuffer.drain() → Frame[]                       │
│      ├─ for each frame:                                     │
│      │   createImageBitmap(blob, {resize ≤1280w})           │
│      │   → VideoFrame → VideoEncoder.encode()               │
│      │   → mp4-muxer.addVideoChunk()                        │
│      │   (매 N프레임마다 yield로 메인 스레드 양보)              │
│      ├─ muxer.finalize() → ArrayBuffer → Blob(video/mp4)   │
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

function use30sReplay(tabId: number | null): Use30sReplayReturn;
```

동작:
- `tabId`가 유효하면 `setInterval(500)` 시작
- 각 틱: `sendBg({ type: "captureVisibleTab", windowId })` → data URL → Blob 변환 → `frameBuffer.push(blob, timestamp)`. `windowId`는 `chrome.tabs.get(tabId)`로 조회하여 명시적으로 전달.
- 바운드 탭이 비활성(포커스 아님)이면 캡처 스킵 (`chrome.tabs.get(tabId)` → `active` 체크)
- `captureVisibleTab` 에러 시 (탭 닫힘, 네비게이션 중 등) 조용히 스킵
- `isReady`: `frameBuffer.size >= 10` (최소 5초 분량 확보)
- `capture()` 호출 시: 인터벌 일시정지 → `frameBuffer.drain()` → `encodeToMp4()` → `editorStore.on30sReplayComplete()` → 인터벌 재개. 실패 시 toast 에러 알림 + `isEncoding: false` 복귀 + 인터벌 재개
- 수동 비디오 녹화 중(`phase === "recording"`)이면 캡처 일시 중지
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
- 콘솔/네트워크 레코더 동기화: `syncConsoleRecorder(tabId)`, `syncNetworkRecorder(tabId)` 호출

## 기존 패턴 준수

- **sentinel 패턴**: 콘솔/네트워크 레코더 활성화에 기존 `activateConsoleRecorder()` / `activateNetworkRecorder()` 재사용. 30s Replay 전용 sentinel 불필요.
- **background 메시지 패턴**: `captureVisibleTab`은 기존 `sendBg()` 패턴을 따라 background에서 호출. side panel에서 직접 호출하지 않는다.
- **useBackgroundRecorder**: 패널 열림 시 레코더 주입이 이미 이 훅에서 처리됨. `idle → drafting` 전이 시 recorder 재주입 억제 조건(`prev.phase === "recording" && state.phase === "drafting"`)에 해당하지 않아 정상 동작.
- **phase gating**: 30s Replay는 `"recording"` 단계를 건너뛰고 바로 `"drafting"`으로 진입. `captureMode: "video"`이므로 기존 video 관련 phase 분기를 모두 자동으로 탄다.
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

2. **메모리**: JPEG Blob 기준 프레임당 ~100-200KB. 60프레임 = 6-12MB. 레티나(devicePixelRatio=2) 디스플레이에서 프레임 크기가 2배로 커질 수 있음 — quality를 65로 낮추거나 캡처 시점에 리사이즈 고려.

3. **탭 비활성 시 captureVisibleTab**: 바운드 탭이 비활성(다른 탭 포커스)이면 다른 탭을 캡처하거나 에러. 반드시 바운드 탭의 `active` 상태를 확인하고 비활성 시 스킵.

4. **VideoEncoder 코덱 지원**: macOS Chrome에서 H.264 Baseline Level 3.1은 1280px 이하만 지원. 자동 레벨 탐색 로직 필수 (PoC에서 검증 완료). 전체 코덱 탐색 실패 시 에러 throw + toast 안내로 복귀.

5. **mp4-muxer colorSpace null**: macOS Chrome에서 VideoEncoder output의 `decoderConfig.colorSpace`가 null일 수 있음. bt709 기본값 주입 필요 (PoC에서 검증 완료).

6. **탭 네비게이션**: 사용자가 다른 URL로 이동하면 버퍼에 이전 페이지 프레임과 새 페이지 프레임이 섞임. 버그 재현 과정 전체를 담기 위해 버퍼를 유지한다 (의도된 동작).

7. **인코딩 중 메인 스레드 블록**: 60프레임 루프에서 `createImageBitmap` + `VideoFrame` 생성이 메인 스레드를 차지. 매 N프레임마다 yield로 UI 블록 방지.
