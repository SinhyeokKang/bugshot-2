# Instant Replay — 구현 태스크

## 선행 조건

- `mp4-muxer` 패키지 설치: `pnpm add mp4-muxer`
- Chrome 94+ (WebCodecs VideoEncoder 지원). 기존 `minimum_chrome_version: "116"`으로 충족.
- `optional_host_permissions: ["https://*/*", "http://*/*"]`가 manifest에 이미 존재함을 확인.

## 태스크

### Task 1: FrameBuffer 클래스

- **변경 대상**: `src/sidepanel/instant-replay/frame-buffer.ts` (신규)
- **작업 내용**:
  - `CapturedFrame` 인터페이스: `{ dataUrl: string; timestamp: number }`
  - `FrameBuffer` 클래스: 생성자(maxFrames=60, maxDurationMs=30000), push, drain, clear, size, durationMs
  - push 시 maxFrames 초과하면 shift로 oldest 제거
  - drain은 현재 배열을 반환하고 내부 배열을 새 빈 배열로 교체
- **검증**:
  - [ ] 단위 테스트: push 60장 → size=60, push 61장 → size=60 (oldest 제거)
  - [ ] 단위 테스트: drain 후 size=0, 반환 배열에 모든 프레임 포함
  - [ ] 단위 테스트: durationMs = 마지막 timestamp - 첫 timestamp

### Task 2: Mp4Encoder 모듈

- **변경 대상**: `src/sidepanel/instant-replay/mp4-encoder.ts` (신규)
- **작업 내용**:
  - `encodeToMp4(options)` 함수 구현
  - 코덱 자동 선택: `VideoEncoder.isConfigSupported()`로 순차 탐색 (`avc1.42003D` → `avc1.64003D` → `avc1.420033` → `avc1.640033` → `avc1.42E01F`)
  - 첫 프레임에서 원본 크기 파악 → maxWidth 초과 시 비율 유지 축소 → 짝수 올림
  - JPEG data URL → Blob → `createImageBitmap(blob, { resizeWidth, resizeHeight })` → VideoFrame
  - 프레임간 duration 계산 (timestamp 차이, μs 단위)
  - mp4-muxer: `ArrayBufferTarget`, `fastStart: 'in-memory'`, `video.codec: 'avc'`
  - output callback에서 `decoderConfig.colorSpace` null 시 bt709 기본값 주입
  - 첫 프레임의 ImageBitmap으로 thumbnail 생성 (canvas → toDataURL)
  - 진행률 콜백 호출
- **검증**:
  - [ ] 수동 테스트: 10장의 더미 JPEG → encodeToMp4 → Blob 반환, type="video/mp4"
  - [ ] 수동 테스트: 생성된 MP4를 Chrome에서 재생 가능
  - [ ] 수동 테스트: MP4를 Jira 이슈에 첨부 → inline preview 재생 확인
  - [ ] `pnpm test` 통과 (순수 함수에 대한 테스트: 짝수 올림, duration 계산 등)

### Task 3: useInstantReplay hook

- **변경 대상**: `src/sidepanel/instant-replay/use-instant-replay.ts` (신규)
- **작업 내용**:
  - 내부에서 `FrameBuffer` 인스턴스를 `useRef`로 관리
  - 권한 체크: `chrome.permissions.contains({ origins: ["https://*/*", "http://*/*"] })`
  - `requestPermission()`: `chrome.permissions.request()` 래퍼
  - 캡처 루프: `setInterval(500)` → `chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 75 })` → `frameBuffer.push()`
  - 캡처 전 바운드 탭 활성 여부 확인: `chrome.tabs.get(tabId)` → `tab.active` 체크. 비활성이면 스킵
  - `captureVisibleTab` 에러 시 (탭 닫힘, 네비게이션 중 등) 조용히 스킵
  - `capture()`: 인터벌 pause → drain → `encodeToMp4()` → `editorStore.onInstantReplayComplete()` → 인터벌 resume
  - cleanup: 언마운트 시 clearInterval + buffer.clear()
  - 반환: `{ isCapturing, frameCount, bufferDuration, isEncoding, encodeProgress, hasPermission, requestPermission, capture }`
- **검증**:
  - [ ] 수동 테스트: 사이드패널 열기 → 콘솔에서 frameCount 증가 확인
  - [ ] 수동 테스트: 다른 탭 전환 시 캡처 일시정지 (frameCount 멈춤)
  - [ ] 수동 테스트: 사이드패널 닫기 → 리소스 정리 (인터벌 중지)

### Task 4: EditorStore 확장

- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**:
  - `CaptureMode` 유니온에 `"instant-replay"` 추가
  - `onInstantReplayComplete(blob, thumbnail, viewport)` 액션 추가:
    - `captureMode: "instant-replay"`, `phase: "drafting"`
    - `videoBlob: blob`, `videoThumbnail: thumbnail`, `videoViewport: viewport`
    - `videoCapturedAt: Date.now()`
    - 콘솔/네트워크 레코더 동기화: `syncConsoleRecorder(tabId)`, `syncNetworkRecorder(tabId)` 호출
  - `phase` 전이 로직 확인: instant-replay는 `"idle"` → `"drafting"` 직행 (`"recording"` 스킵)
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 `CaptureMode` 참조하는 모든 switch/if 분기에서 `"instant-replay"` 처리 확인 (또는 `"video"`와 동일 경로)
  - [ ] `pnpm test` 통과

### Task 5: UI — 권한 요청 + Instant Replay 버튼

- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx` (EmptyState 영역)
- **작업 내용**:
  - EmptyState에 Instant Replay 섹션 추가:
    - 권한 미보유 시: "Enable Instant Replay" 카드 + 권한 요청 버튼
    - 권한 보유 + 캡처 중: "Instant Replay" 버튼 + 버퍼 상태 indicator (예: "28s buffered")
    - 인코딩 중: 프로그레스 표시 + 버튼 비활성
  - `useInstantReplay` hook에서 반환되는 상태 사용
  - 기존 Element/Screenshot/Video/Freeform 버튼과 나란히 배치
  - 버튼 스타일: 기존 캡처 버튼과 동일한 패턴. shadcn/ui Button 사용
- **검증**:
  - [ ] 수동 테스트: 권한 미보유 상태에서 Enable 버튼 노출
  - [ ] 수동 테스트: 권한 승인 후 Instant Replay 버튼 노출 + 버퍼 indicator 동작
  - [ ] 수동 테스트: 인코딩 중 프로그레스 표시 + 버튼 비활성
  - [ ] 기존 캡처 모드 버튼들 정상 동작 (회귀 없음)

### Task 6: App.tsx 통합

- **변경 대상**: `src/sidepanel/App.tsx`
- **작업 내용**:
  - `useInstantReplay(boundTabId)` hook 마운트
  - 반환값을 IssueTab 또는 context로 전달
  - 또는: IssueTab 내부에서 직접 hook 호출 (boundTabId는 이미 접근 가능)
- **검증**:
  - [ ] 수동 테스트: 패널 열림 → 콘솔 에러 없음 → 캡처 루프 시작
  - [ ] 수동 테스트: 패널 닫힘 → 리소스 정리

### Task 7: 드래프팅 흐름 호환

- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`, `DraftingPanel.tsx`, `PreviewPanel.tsx`
- **작업 내용**:
  - `captureMode === "instant-replay"`인 경우 기존 `"video"` 경로와 동일하게 처리되는지 확인
  - DraftingPanel: videoBlob 표시, 타이틀/마크다운 에디터 — 변경 없음 예상
  - PreviewPanel: 비디오 미리보기 — 변경 없음 예상
  - confirmDraft: `captureMode === "instant-replay"`도 videoBlob/logs 저장 경로 타야 함
  - 필요 시 조건문에 `"instant-replay"` 추가 (예: `mode === "video" || mode === "instant-replay"`)
- **검증**:
  - [ ] 수동 테스트: Instant Replay → 드래프팅 → 타이틀·에디터 정상
  - [ ] 수동 테스트: 콘솔/네트워크 로그 탭 표시 정상
  - [ ] 수동 테스트: 프리뷰 → 제출 → Jira/GitHub에 MP4 첨부 확인
  - [ ] `pnpm typecheck` 통과

## 테스트 계획

### 단위 테스트

| 대상 | 파일 | 케이스 |
|---|---|---|
| FrameBuffer | `__tests__/frame-buffer.test.ts` | push 순환, drain, clear, durationMs 계산 |
| duration 계산 | `__tests__/mp4-encoder.test.ts` | 타임스탬프 차이 → μs 변환, 마지막 프레임 duration 처리 |
| 짝수 올림 | `__tests__/mp4-encoder.test.ts` | 홀수 → 짝수 올림 (1281→1282, 720→720) |

### 수동 테스트 체크리스트

- [ ] 패널 열기 → 권한 없음 → Enable 클릭 → 권한 승인 → 캡처 시작
- [ ] 30초 대기 → Instant Replay 클릭 → 3초 이내 드래프팅 진입
- [ ] 생성된 MP4를 로컬에서 재생 — 화면 변화가 있는 영상인지 확인
- [ ] 패널 열자마자(3초) Instant Replay → 짧은 MP4 정상 생성
- [ ] 다른 탭 전환 후 돌아와서 Instant Replay → 공백 없이 정상
- [ ] 기존 Video 모드 (수동 녹화) 정상 동작
- [ ] 기존 Screenshot, Element, Freeform 모드 정상 동작
- [ ] Jira에 MP4 첨부 → inline preview 재생
- [ ] 권한 거부 시 Instant Replay 비활성, 다른 모드 정상

## 구현 순서 권장

```
Task 1 (FrameBuffer)  ─┐
                        ├─ Task 3 (useInstantReplay hook)
Task 2 (Mp4Encoder)   ─┘         │
                                  │
Task 4 (EditorStore)  ────────────┤
                                  │
                        Task 5 (UI) + Task 6 (App 통합)
                                  │
                        Task 7 (드래프팅 흐름 호환)
```

- Task 1, 2는 독립적이므로 **병렬 가능**.
- Task 3은 1, 2에 의존.
- Task 4는 독립적이므로 1, 2와 **병렬 가능**.
- Task 5, 6은 3, 4에 의존.
- Task 7은 5, 6 이후 통합 검증.
