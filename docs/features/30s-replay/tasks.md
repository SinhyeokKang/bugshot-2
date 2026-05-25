# 30s Replay — 구현 태스크

## 선행 조건

- `mp4-muxer` 패키지 설치: `pnpm add mp4-muxer`
- Chrome 94+ (WebCodecs VideoEncoder 지원). 기존 `minimum_chrome_version: "116"`으로 충족.

## 태스크

### Task 1: FrameBuffer 클래스

- **변경 대상**: `src/sidepanel/30s-replay/frame-buffer.ts` (신규)
- **작업 내용**:
  - `CapturedFrame` 인터페이스: `{ blob: Blob; timestamp: number }`
  - `FrameBuffer` 클래스: 생성자(maxFrames=60, maxDurationMs=30000), push, drain, clear, size, durationMs
  - push 시 maxFrames 초과하면 shift로 oldest 제거
  - push 시 maxDurationMs 초과 프레임도 시간 기반으로 제거 (현재 timestamp - maxDurationMs보다 오래된 프레임 제거)
  - drain은 현재 배열을 반환하고 내부 배열을 새 빈 배열로 교체
  - snapshot은 현재 배열을 복사하여 반환 (버퍼 유지, copy-then-clear 전략용)
- **검증**:
  - [ ] 단위 테스트: push 60장 → size=60, push 61장 → size=60 (oldest 제거)
  - [ ] 단위 테스트: drain 후 size=0, 반환 배열에 모든 프레임 포함
  - [ ] 단위 테스트: snapshot 후 size 유지, 반환 배열에 모든 프레임 포함
  - [ ] 단위 테스트: clear 후 size=0
  - [ ] 단위 테스트: durationMs = 마지막 timestamp - 첫 timestamp
  - [ ] 단위 테스트: maxDurationMs 초과 프레임이 시간 기반으로 제거됨
  - [ ] 테스트 파일: `src/sidepanel/30s-replay/__tests__/frame-buffer.test.ts`

### Task 2: Mp4Encoder 모듈

- **변경 대상**: `src/sidepanel/30s-replay/mp4-encoder.ts` (신규)
- **작업 내용**:
  - `encodeToMp4(options)` 함수 구현
  - 코덱 자동 선택: `VideoEncoder.isConfigSupported()`로 순차 탐색 (`avc1.42003D` → `avc1.64003D` → `avc1.420033` → `avc1.640033` → `avc1.42E01F`). 전체 실패 시 에러 throw
  - 첫 프레임에서 원본 크기 파악 → maxWidth 초과 시 비율 유지 축소 → 짝수 올림
  - JPEG Blob → `createImageBitmap(blob, { resizeWidth, resizeHeight })` → VideoFrame
  - 프레임간 duration 계산 (timestamp 차이, μs 단위)
  - mp4-muxer: `ArrayBufferTarget`, `fastStart: 'in-memory'`, `video.codec: 'avc'`
  - output callback에서 `decoderConfig.colorSpace` null 시 bt709 기본값 주입
  - 첫 프레임의 Blob으로 `createImageBitmap` → canvas → toDataURL thumbnail 생성
  - 진행률 콜백 호출
  - 매 N프레임마다 `await new Promise(r => setTimeout(r, 0))`으로 메인 스레드 양보
- **검증**:
  - [ ] 수동 테스트: 10장의 더미 JPEG → encodeToMp4 → Blob 반환, type="video/mp4"
  - [ ] 수동 테스트: 생성된 MP4를 Chrome에서 재생 가능
  - [ ] `pnpm test` 통과 (순수 함수에 대한 테스트)
  - [ ] 단위 테스트: 짝수 올림 (홀수 → 짝수 올림: 1281→1282, 720→720)
  - [ ] 단위 테스트: duration 계산 (타임스탬프 차이 → μs 변환)
  - [ ] 단위 테스트: 코덱 후보 배열 + 선택 로직 (isConfigSupported mock)
  - [ ] 단위 테스트: colorSpace null 시 bt709 기본값 주입 로직
  - [ ] 테스트 파일: `src/sidepanel/30s-replay/__tests__/mp4-encoder.test.ts`

### Task 3: use30sReplay hook

- **변경 대상**: `src/sidepanel/30s-replay/use-30s-replay.ts` (신규)
- **작업 내용**:
  - 내부에서 `FrameBuffer` 인스턴스를 `useRef`로 관리
  - `enabled` 인자가 `true`일 때만 캡처 루프 시작
  - 루프 시작 시 `chrome.permissions.contains({ origins: ["https://*/*", "http://*/*"] })` 확인. 권한 없으면 `setReplayEnabled(false)` + toast 안내 후 미시작
  - 캡처 루프: `setInterval(500)` — **이전 호출 미완료 시 해당 틱 스킵** (rate limit 방어) → `sendBg({ type: "captureVisibleTab", tabId })` → data URL → Blob 변환 → `frameBuffer.push(blob, timestamp)`. background handler가 `tabId`로 `windowId` 내부 resolve (기존 패턴 유지).
  - 캡처 전 바운드 탭 활성 여부 확인: `chrome.tabs.get(tabId)` → `tab.active` 체크. 비활성이면 스킵
  - `captureVisibleTab` 에러 시 (탭 닫힘, 네비게이션 중 등) 조용히 스킵
  - **phase gating**: `phase !== "idle"`이면 캡처 루프 일시 중지 (수동 녹화, 드래프팅, 프리뷰, picker/screenshot 등). idle 복귀 시 재개. `captureVisibleTab` rate limit 경합 방지.
  - `isReady`: `frameBuffer.size >= 10` (최소 5초 분량 확보)
  - `capture()`: 인터벌 pause → `frameBuffer.snapshot()` (복사) → `encodeToMp4()` → 성공 시 `frameBuffer.clear()` + `syncConsoleRecorder(tabId)` + `syncNetworkRecorder(tabId)` + `editorStore.on30sReplayComplete()`. 실패 시 toast 에러 알림 + `isEncoding: false` 복귀 + 인터벌 재개 (버퍼 보존)
  - `enabled`가 false로 전환되면 인터벌 정지 + 버퍼 clear
  - cleanup: 언마운트 시 clearInterval + buffer.clear()
  - 반환: `{ isCapturing, isReady, isEncoding, encodeProgress, capture }`
- **검증**:
  - [ ] 수동 테스트: 설정에서 ON → 사이드패널에서 5초 후 isReady=true 확인
  - [ ] 수동 테스트: 다른 탭 전환 시 캡처 일시정지
  - [ ] 수동 테스트: 설정에서 OFF → 캡처 루프 즉시 중지 + 버퍼 클리어
  - [ ] 수동 테스트: 사이드패널 닫기 → 리소스 정리 (인터벌 중지)
  - [ ] 수동 테스트: 수동 비디오 녹화 중 캡처 일시 중지 확인
  - [ ] 수동 테스트: 드래프팅/프리뷰 중 캡처 일시 중지 확인 (phase gating)
  - [ ] 수동 테스트: 인코딩 실패 시 버퍼 보존 + 즉시 재시도 가능 확인
  - [ ] 수동 테스트: 권한 외부 철회 후 패널 재열기 → 자동 OFF + toast

### Task 4: EditorStore 확장

- **변경 대상**: `src/store/editor-store.ts`
- **작업 내용**:
  - `CaptureSource` 타입 추가: `"manual" | "30s-replay"`
  - `EditorState`에 `captureSource: CaptureSource | null` 필드 추가 (초기값 null)
  - `EditorSnapshot` 타입에 `captureSource` 필드 추가 (세션 영속화/복원 시 보존)
  - `on30sReplayComplete(blob, thumbnail, viewport)` 액션 추가:
    - `captureMode: "video"` (기존 video 경로 호환)
    - `captureSource: "30s-replay"` (구분용)
    - `phase: "drafting"` (recording 단계 스킵)
    - `videoBlob: blob`, `videoThumbnail: thumbnail`, `videoViewport: viewport`
    - `videoCapturedAt: Date.now()`
    - 콘솔/네트워크 레코더 동기화는 hook의 `capture()`에서 처리 (스토어 액션은 side-effect free 유지)
  - 기존 수동 비디오 시작 시 `captureSource: "manual"` 설정
  - `reset()` 시 `captureSource: null` 초기화
- **검증**:
  - [ ] 단위 테스트: `on30sReplayComplete` 호출 시 `captureMode: "video"`, `captureSource: "30s-replay"`, `phase: "drafting"` 상태 전이 확인
  - [ ] 단위 테스트: `reset()` 시 `captureSource: null` 초기화 확인
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과

### Task 5: SettingsUiStore + SettingsTab — 30s Replay 토글

- **변경 대상**: `src/store/settings-ui-store.ts`, `src/sidepanel/tabs/SettingsTab.tsx`
- **작업 내용 (Store)**:
  - `SettingsUiState`에 `replayEnabled: boolean` 필드 추가 (기본 `false`)
  - `setReplayEnabled(enabled: boolean)` 액션 추가
  - 스토어 버전 bump v5→v6, migrate 함수에 `version < 6` 분기 추가: `replayEnabled: false` 기본값 설정 (기존 `version < 3` → `llm` 초기화 패턴과 동일)
- **작업 내용 (UI)**:
  - `IssueSettingsContent`에 "캡처" Section 추가 (기존 "제목 설정" 아래, "본문 구성" 위)
  - Section 내 Card > Row: Timer 아이콘 + "30s Replay" 라벨 + 도움말 텍스트 + Switch
  - Switch `onCheckedChange` 핸들러:
    - ON: `chrome.permissions.contains()` → 미승인이면 `chrome.permissions.request()` → 승인 시 `setReplayEnabled(true)`, 거부 시 OFF 복귀 + toast
    - OFF: `setReplayEnabled(false)` (권한은 유지)
  - 기존 `IssueSectionRow`와 동일한 레이아웃 패턴 사용
- **검증**:
  - [ ] 수동 테스트: Switch ON → 권한 프롬프트 표시 → 승인 → ON 유지
  - [ ] 수동 테스트: Switch ON → 권한 프롬프트 표시 → 거부 → OFF 복귀 + toast
  - [ ] 수동 테스트: 이미 승인된 상태에서 ON → 프롬프트 없이 즉시 ON
  - [ ] 수동 테스트: Switch OFF → ON → 재요청 없이 즉시 ON (권한 영구 유지)
  - [ ] 단위 테스트: v5→v6 마이그레이션 시 `replayEnabled`가 `false`로 초기화됨
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과

### Task 6: background/messages.ts — captureVisibleTab JPEG 포맷 분기

- **변경 대상**: `src/background/messages.ts`, `src/types/messages.ts`
- **작업 내용**:
  - `BgRequest`의 `captureVisibleTab` 타입에 optional `format?: "jpeg" | "png"`, `quality?: number` 파라미터 추가
  - background handler에서 `format`/`quality` 파라미터가 있으면 해당 옵션으로 `captureVisibleTab` 호출, 없으면 기존 PNG 동작 유지 (하위 호환)
  - 30s Replay에서는 `{ type: "captureVisibleTab", tabId, format: "jpeg", quality: 65 }`로 호출
- **검증**:
  - [ ] 수동 테스트: 기존 element capture / screenshot capture가 PNG로 정상 동작 (회귀 없음)
  - [ ] 수동 테스트: 30s Replay 캡처 루프에서 JPEG format으로 호출 확인
  - [ ] `pnpm typecheck` 통과

### Task 7: UI — EmptyState 리팩터 + 30s Replay 버튼

- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx` (EmptyState 영역)
- **의존**: Task 8 (App.tsx 통합)에서 전달되는 `use30sReplay` 반환값을 소비
- **작업 내용**:
  - 기존 Freeform 버튼 제거 → PageFooter에 "이슈 작성" 버튼으로 이동 (로그 탭과 동일 패턴). 클릭 시 Freeform 모드 drafting 진입
  - 기존 Freeform 위치(col-span-2)에 30s Replay 버튼 추가 → 그리드 유지: 1×2×1 배열
  - 30s Replay 버튼 상태 분기:
    - `replayEnabled=false`: disabled + Tooltip("이슈 설정에서 30s Replay를 활성화할 수 있습니다")
    - `replayEnabled=true`, `isReady=false`: disabled + Tooltip("화면을 기록하고 있습니다…")
    - `replayEnabled=true`, `isReady=true`: 활성
    - `isEncoding=true`: disabled + `Loader2` 스피너 (`animate-spin` 패턴)
    - `phase!="idle"` (수동 녹화/드래프팅/프리뷰 등): disabled
  - `use30sReplay` hook에서 반환되는 상태 + `replayEnabled` 사용
- **검증**:
  - [ ] 수동 테스트: replayEnabled=false → 버튼 disabled + 안내 tooltip 호버 확인
  - [ ] 수동 테스트: replayEnabled=true, 5초 미만 → 버튼 disabled (tooltip 없음)
  - [ ] 수동 테스트: replayEnabled=true, 5초 경과 → 버튼 활성
  - [ ] 수동 테스트: 인코딩 중 progress 표시 + 버튼 disabled
  - [ ] 수동 테스트: 수동 비디오 녹화 중 버튼 disabled
  - [ ] 수동 테스트: PageFooter "이슈 작성" 클릭 → Freeform drafting 진입
  - [ ] 기존 Element/Screenshot/Video 버튼 정상 동작 (회귀 없음)

### Task 8: App.tsx 통합

- **변경 대상**: `src/sidepanel/App.tsx`
- **작업 내용**:
  - `replayEnabled`를 `useSettingsUiStore`에서 구독
  - `use30sReplay(boundTabId, replayEnabled)` hook 전역 마운트 (어떤 탭에서든 캡처 지속)
  - 반환값을 IssueTab에 전달 (props 또는 context) — Task 7이 이 값을 소비
- **검증**:
  - [ ] 수동 테스트: 설정 ON + 패널 열림 → 콘솔 에러 없음 → 캡처 루프 시작
  - [ ] 수동 테스트: 설정 OFF → 캡처 루프 미시작
  - [ ] 수동 테스트: Settings/Integrations 탭에서도 캡처 지속 확인
  - [ ] 수동 테스트: 패널 닫힘 → 리소스 정리
  - [ ] 수동 테스트: 30s Replay drafting 진입 후 `useBackgroundRecorder`와 충돌 없이 콘솔/네트워크 로그 정상 표시

### Task 9: 드래프팅 흐름 호환 확인

- **변경 대상**: 변경 없음 예상 (`captureMode: "video"` 사용으로 자동 호환)
- **작업 내용**:
  - `captureMode === "video"`이므로 기존 video 경로를 자동으로 타는지 확인
  - DraftingPanel: videoBlob 표시, 타이틀/마크다운 에디터 — 변경 없음 예상
  - PreviewPanel: 비디오 미리보기 — 변경 없음 예상
  - confirmDraft: `captureMode === "video"` 분기로 videoBlob/logs 저장 — 변경 없음 예상
  - 필요 시 `captureSource` 구분이 필요한 곳만 추가 (예: 이슈 목록에서 구분 표시)
- **검증**:
  - [ ] 수동 테스트: 30s Replay → 드래프팅 → 타이틀·에디터 정상
  - [ ] 수동 테스트: 콘솔/네트워크 로그 탭 표시 정상
  - [ ] 수동 테스트: 프리뷰 → 제출 → Jira/GitHub에 MP4 첨부 확인
  - [ ] 수동 테스트: 30s Replay로 생성된 이슈가 IndexedDB에 정상 영속화됨
  - [ ] 수동 테스트: 기존 수동 비디오 모드 정상 동작
  - [ ] `pnpm typecheck` 통과

## 테스트 계획

### 단위 테스트

| 대상 | 파일 | 케이스 |
|---|---|---|
| FrameBuffer | `src/sidepanel/30s-replay/__tests__/frame-buffer.test.ts` | push 순환, drain, clear, durationMs 계산, maxDurationMs 시간 기반 제거 |
| duration 계산 | `src/sidepanel/30s-replay/__tests__/mp4-encoder.test.ts` | 타임스탬프 차이 → μs 변환, 마지막 프레임 duration 처리 |
| 짝수 올림 | `src/sidepanel/30s-replay/__tests__/mp4-encoder.test.ts` | 홀수 → 짝수 올림 (1281→1282, 720→720) |

### 수동 테스트 체크리스트

- [ ] 설정 > 이슈 설정 > 30s Replay Switch ON → 권한 프롬프트 → 승인
- [ ] 설정 > 이슈 설정 > 30s Replay Switch ON → 권한 프롬프트 → 거부 → OFF 복귀
- [ ] 패널 열기 (설정 ON) → 5초 후 30s Replay 버튼 활성화
- [ ] 30초 대기 → 30s Replay 클릭 → 3초 이내 드래프팅 진입
- [ ] 생성된 MP4를 로컬에서 재생 — 화면 변화가 있는 영상인지 확인
- [ ] 다른 탭 전환 후 돌아와서 30s Replay → 공백 없이 정상
- [ ] 설정 OFF 상태 → 30s Replay 버튼 disabled + 호버 tooltip 확인
- [ ] PageFooter "이슈 작성" 클릭 → Freeform 모드 drafting 진입
- [ ] 기존 Video 모드 (수동 녹화) 정상 동작
- [ ] 기존 Screenshot, Element 모드 정상 동작
- [ ] Jira에 MP4 첨부 → inline preview 재생
- [ ] 수동 비디오 녹화 중 30s Replay 버튼 비활성
- [ ] 인코딩 실패 시 toast 알림 + 캡처 루프 재개
- [ ] chrome://extensions에서 권한 철회 → 패널 재열기 → 자동 OFF + toast

## 구현 순서 권장

```
Task 1 (FrameBuffer)  ─┐
                        ├─ Task 3 (use30sReplay hook)
Task 2 (Mp4Encoder)   ─┘         │
                                  │
Task 4 (EditorStore)  ────────────┤
                                  │
Task 5 (Settings 토글) ───────────┤
                                  │
Task 6 (messages.ts JPEG) ────────┤
                                  │
                        Task 8 (App 통합) → Task 7 (EmptyState UI)
                                              │
                                    Task 9 (드래프팅 흐름 호환 확인)
```

- Task 1, 2, 4, 5, 6은 독립적이므로 **병렬 가능**.
- Task 3은 1, 2에 의존.
- Task 8은 3, 4, 5, 6에 의존.
- Task 7은 8에 의존 (hook 반환값을 소비).
- Task 9는 7, 8 이후 통합 검증.
