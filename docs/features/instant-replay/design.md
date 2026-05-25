# Instant Replay — 기술 설계

## 개요

`chrome.tabs.captureVisibleTab()`을 500ms 간격으로 호출해 JPEG 스크린샷을 순환 버퍼(30초분)에 쌓아둔다. 사용자가 "Instant Replay"를 트리거하면 버퍼의 프레임을 WebCodecs `VideoEncoder`(H.264)로 인코딩하고 `mp4-muxer`로 MP4 컨테이너에 담아 Blob을 반환한다. 이후 기존 비디오 모드의 드래프팅 흐름에 진입한다.

## 변경 범위

### 새 파일

| 파일 | 역할 |
|---|---|
| `src/sidepanel/instant-replay/frame-buffer.ts` | JPEG 순환 버퍼. push/drain/clear |
| `src/sidepanel/instant-replay/mp4-encoder.ts` | WebCodecs VideoEncoder + mp4-muxer 래퍼 |
| `src/sidepanel/instant-replay/use-instant-replay.ts` | React hook: 캡처 루프 lifecycle + 인코딩 트리거 |

### 수정 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/store/editor-store.ts` | 에디터 상태 관리 | CaptureMode에 `"instant-replay"` 추가, `startInstantReplay()` / `onInstantReplayComplete()` 액션 추가 |
| `src/sidepanel/App.tsx` | 사이드패널 루트 | `useInstantReplay` hook 마운트 |
| `src/sidepanel/tabs/IssueTab.tsx` | 캡처 모드별 UI 분기 | EmptyState에 Instant Replay 버튼 + 권한 요청 UI 추가 |
| `package.json` | 의존성 | `mp4-muxer` 추가 |

### 변경 없음 (재사용)

| 파일 | 이유 |
|---|---|
| `src/sidepanel/video-capture.ts` | 기존 수동 녹화 전용. Instant replay와 독립 |
| `src/sidepanel/video-recorder.ts` | 위와 동일 |
| `src/store/blob-db.ts` | `saveVideoBlob()` 그대로 사용 |
| `src/content/console-recorder.ts` | 기존 sentinel 패턴 그대로 |
| `src/content/network-recorder.ts` | 위와 동일 |
| `src/sidepanel/tabs/DraftingPanel.tsx` | captureMode 구분 없이 video blob 표시 |
| `src/sidepanel/tabs/PreviewPanel.tsx` | 위와 동일 |

## 데이터 흐름

```
┌─ 사이드패널 (extension page) ──────────────────────────────┐
│                                                             │
│  useInstantReplay hook                                      │
│  ├─ setInterval 500ms                                       │
│  │   └─ chrome.tabs.captureVisibleTab(null, {jpeg, q:75})   │
│  │       └─ dataUrl → FrameBuffer.push(dataUrl, timestamp)  │
│  │                                                          │
│  └─ encode() (사용자 "Instant Replay" 클릭 시)               │
│      ├─ FrameBuffer.drain() → Frame[]                       │
│      ├─ for each frame:                                     │
│      │   Blob(jpeg) → createImageBitmap (resize ≤1280w)     │
│      │   → VideoFrame → VideoEncoder.encode()               │
│      │   → mp4-muxer.addVideoChunk()                        │
│      ├─ muxer.finalize() → ArrayBuffer → Blob(video/mp4)   │
│      └─ editorStore.onInstantReplayComplete(blob, thumbnail)│
│          → phase: "drafting", captureMode: "instant-replay" │
│                                                             │
│  기존 콘솔/네트워크 로그:                                      │
│  useBackgroundRecorder가 이미 패널 열림 시 활성화             │
│  → 드래프팅 진입 시 syncConsoleRecorder/syncNetworkRecorder  │
└─────────────────────────────────────────────────────────────┘
```

## 인터페이스 설계

### FrameBuffer

```typescript
// src/sidepanel/instant-replay/frame-buffer.ts

interface CapturedFrame {
  dataUrl: string;    // JPEG data URL from captureVisibleTab
  timestamp: number;  // Date.now() at capture time
}

class FrameBuffer {
  private buffer: CapturedFrame[] = [];
  private maxFrames: number;
  private maxDurationMs: number;

  constructor(maxFrames?: number, maxDurationMs?: number);

  /** 프레임 추가. 버퍼가 꽉 차면 가장 오래된 프레임 제거 */
  push(dataUrl: string, timestamp: number): void;

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
// src/sidepanel/instant-replay/mp4-encoder.ts

interface EncodeOptions {
  maxWidth: number;      // 기본 1280
  bitrate: number;       // 기본 2_000_000
  jpegFrames: CapturedFrame[];
  onProgress?: (current: number, total: number) => void;
}

/**
 * JPEG 프레임 배열을 H.264 MP4로 인코딩.
 * 반환: { blob: Blob, thumbnail: string, width: number, height: number }
 */
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
- 코덱 자동 선택: `VideoEncoder.isConfigSupported()`로 Baseline 6.1 → High 5.1 → Baseline 3.1 순 탐색
- 프레임간 duration: `frames[i+1].timestamp - frames[i].timestamp` (μs)
- keyFrame: 매 30프레임
- `mp4-muxer` 설정: `fastStart: 'in-memory'`, `video.codec: 'avc'`
- `decoderConfig.colorSpace` null 시 bt709 기본값 주입 (macOS Chrome 이슈)
- 첫 프레임을 canvas에 그려 JPEG thumbnail data URL 생성

### useInstantReplay hook

```typescript
// src/sidepanel/instant-replay/use-instant-replay.ts

interface UseInstantReplayReturn {
  /** 캡처 루프 동작 중 여부 */
  isCapturing: boolean;
  /** 버퍼에 담긴 프레임 수 */
  frameCount: number;
  /** 버퍼에 담긴 시간 (초) */
  bufferDuration: number;
  /** 인코딩 진행 중 여부 */
  isEncoding: boolean;
  /** 인코딩 진행률 (0-1) */
  encodeProgress: number;
  /** 권한 보유 여부 */
  hasPermission: boolean;
  /** 권한 요청 (user gesture 핸들러 내에서 호출) */
  requestPermission: () => Promise<boolean>;
  /** 인코딩 트리거: 버퍼 → MP4 → editorStore */
  capture: () => Promise<void>;
}

function useInstantReplay(tabId: number | null): UseInstantReplayReturn;
```

동작:
- 마운트 시 `chrome.permissions.contains()` 확인
- 권한 있고 `tabId`가 유효하면 `setInterval(500)` 시작
- 각 틱: `chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 75 })` → `frameBuffer.push()`
- 바운드 탭이 비활성(포커스 아님)이면 캡처 스킵 (`chrome.tabs.get(tabId)` → `active` 체크)
- `capture()` 호출 시: 인터벌 일시정지 → `frameBuffer.drain()` → `encodeToMp4()` → `editorStore.onInstantReplayComplete()` → 인터벌 재개
- 언마운트 시 인터벌 정리 + 버퍼 clear

### EditorStore 변경

```typescript
// src/store/editor-store.ts 추가분

type CaptureMode = "element" | "screenshot" | "video" | "freeform" | "instant-replay";

interface EditorState {
  // 기존 필드 유지
  // ...

  // instant replay 전용 상태는 불필요
  // videoBlob, videoThumbnail, videoViewport 그대로 사용
}

interface EditorActions {
  // 기존 액션 유지
  // ...

  /** Instant replay 완료 → 드래프팅 진입 */
  onInstantReplayComplete: (
    blob: Blob,
    thumbnail: string,
    viewport: { width: number; height: number }
  ) => void;
}
```

`onInstantReplayComplete` 구현:
- `captureMode` → `"instant-replay"`
- `phase` → `"drafting"` (recording 단계 스킵)
- `videoBlob`, `videoThumbnail`, `videoViewport` 설정
- 콘솔/네트워크 로그 동기화 트리거 (기존 `syncConsoleRecorder` / `syncNetworkRecorder`)

## 기존 패턴 준수

- **sentinel 패턴**: 콘솔/네트워크 레코더 활성화에 기존 `activateConsoleRecorder()` / `activateNetworkRecorder()` 재사용. Instant replay 전용 sentinel 불필요.
- **useBackgroundRecorder**: 패널 열림 시 레코더 주입이 이미 이 훅에서 처리됨. 프레임 캡처 루프도 같은 라이프사이클에 연동.
- **phase gating**: `"instant-replay"` 모드는 `"recording"` 단계를 건너뛰고 바로 `"drafting"`으로 진입. `IssueTab.tsx`의 phase 분기에서 `recording` → `instant-replay`는 해당 없음.
- **blob 영속화**: 기존 `saveVideoBlob(issueId, blob)` 그대로 사용. `confirmDraft` 시점에 IndexedDB 저장.

## 대안 검토

### A. rrweb DOM 녹화 → 리플레이 → 스크린샷 → MP4

PoC에서 검증한 접근. html-to-image(SVG foreignObject)는 cross-origin CSS SecurityError로 실패. CDP 스크린샷은 동작하나 프레임당 ~150ms 소요로 60프레임 인코딩에 ~10초. 3초 제약 미충족. **기각.**

### B. tabCapture MediaStream 가속 재생

rrweb 이벤트를 새 탭에서 가속 재생하고 tabCapture로 MediaStream 캡처. 30초 녹화를 4x 재생 시 ~8초. 실시간 바운드. **기각.**

### C. captureVisibleTab 실시간 캡처 (채택)

녹화 중에 이미 프레임을 확보하므로 "캡처" 시 인코딩만 수행. 60프레임 인코딩 ~1-2초. 3초 제약 충족. CORS/CSS 문제 없음 (브라우저 렌더링 파이프라인 직접 캡처). **채택.**

## 위험 요소

1. **`captureVisibleTab` 성능**: 2fps(500ms)에서 호출당 ~20-50ms. CPU 오버헤드 ~5%. 저사양 기기에서 추가 검증 필요.

2. **메모리**: JPEG quality 75 기준 프레임당 ~100-200KB. 60프레임 = 6-12MB. 레티나(devicePixelRatio=2) 디스플레이에서 프레임 크기가 2배로 커질 수 있음 — quality를 65로 낮추거나 캡처 시점에 리사이즈 고려.

3. **`optional_host_permissions` 의존**: 사용자가 권한을 거부하면 instant replay 전체 비활성. 권한 없이도 다른 모드는 정상 동작하도록 격리.

4. **탭 비활성 시 captureVisibleTab**: 바운드 탭이 비활성(다른 탭 포커스)이면 다른 탭을 캡처하거나 에러. 반드시 바운드 탭의 `active` 상태를 확인하고 비활성 시 스킵.

5. **VideoEncoder 코덱 지원**: macOS Chrome에서 H.264 Baseline Level 3.1은 1280px 이하만 지원. 자동 레벨 탐색 로직 필수 (PoC에서 검증 완료).

6. **mp4-muxer colorSpace null**: macOS Chrome에서 VideoEncoder output의 `decoderConfig.colorSpace`가 null일 수 있음. bt709 기본값 주입 필요 (PoC에서 검증 완료).

7. **탭 네비게이션**: 사용자가 다른 URL로 이동하면 버퍼에 이전 페이지 프레임과 새 페이지 프레임이 섞임. 기능적 문제는 없으나 영상이 자연스럽지 않을 수 있음. 네비게이션 감지해서 버퍼를 클리어할지는 후속 판단.
