# 30s Replay — 구현 태스크

## 선행 조건

- ⚠️ **WebCodecs PoC 선행 필수**: 구현 착수 전 실제 Chrome(버전·OS 명시)에서 H.264 `VideoEncoder` 인코딩 + 코덱 자동탐색 + colorSpace null 워크어라운드를 PoC로 검증하고 결과를 design.md에 기록. 미지원/실패 시 기능 전체가 동작 불가하므로 이 게이트를 통과해야 Task 2 진행.
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
  - `encodeToMp4(options)` 함수 구현 (options에 `onProgress` 없음 — 진행률 UI 미사용)
  - **테스트 가능하도록 순수 함수 분리 export 필수**: `pickEvenDimensions(w, h, maxWidth)`, `computeFrameDurationsUs(frames, { maxFrameDurationMs })`, `pickCodec(candidates, isSupported)`, `injectColorSpace(decoderConfig)`. WebCodecs/createImageBitmap/canvas는 jsdom 미지원이라 이들만 단위 테스트.
  - 코덱 자동 선택: `VideoEncoder.isConfigSupported()`로 순차 탐색 (`avc1.42003D` → `avc1.64003D` → `avc1.420033` → `avc1.640033` → `avc1.42E01F`). 전체 실패 시 에러 throw
  - 빈 배열 가드: `frames.length === 0`이면 에러 throw
  - 첫 프레임에서 원본 크기 파악 → maxWidth 초과 시 비율 유지 축소 → 짝수 올림
  - JPEG Blob → `createImageBitmap(blob, { resizeWidth, resizeHeight })` → VideoFrame
  - 프레임간 duration 계산 (timestamp 차이, μs). **per-frame duration cap**(`MAX_FRAME_DURATION_MS`, 예 1000ms) clamp — 캡처 공백 구간의 비정상 긴 frame 흡수. 마지막 프레임은 직전 간격 또는 기본값(예 500ms).
  - mp4-muxer: `ArrayBufferTarget`, `fastStart: 'in-memory'`, `video.codec: 'avc'`
  - output callback에서 `decoderConfig.colorSpace` null 시 bt709 기본값 주입
  - 첫 프레임의 Blob으로 `createImageBitmap` → canvas → toDataURL thumbnail 생성
  - 매 N프레임마다 `await new Promise(r => setTimeout(r, 0))`으로 메인 스레드 양보
- **검증**:
  - [ ] 수동 테스트: 10장의 더미 JPEG → encodeToMp4 → Blob 반환, type="video/mp4"
  - [ ] 수동 테스트: 생성된 MP4를 Chrome에서 재생 가능
  - [ ] `pnpm test` 통과 (분리된 순수 함수에 대한 테스트)
  - [ ] 단위 테스트: 짝수 올림 (홀수 → 짝수 올림: 1281→1282, 720→720)
  - [ ] 단위 테스트: duration 계산 (타임스탬프 차이 → μs 변환)
  - [ ] 단위 테스트: **duration cap** — 간격이 MAX 초과 시 cap 값으로 clamp
  - [ ] 단위 테스트: **단일 프레임** — 마지막 프레임 duration 기본값 처리
  - [ ] 단위 테스트: **빈 배열** → throw
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
  - `capture()`: 인터벌 pause → `frameBuffer.snapshot()` (복사) → `encodeToMp4()` → 성공 시 `frameBuffer.clear()` + `syncConsoleRecorder(tabId)` + `syncNetworkRecorder(tabId)` + `editorStore.onRecordingComplete(blob, thumbnail, viewport)` (기존 수동 녹화 완료 액션 재사용). 실패 시 toast 에러 알림 + `isEncoding: false` 복귀 + 인터벌 재개 (버퍼 보존)
  - **경합 가드**: 인코딩 완료 후 `enabled === false`(인코딩 중 사용자 OFF)이거나 `phase !== "idle"`이면 `onRecordingComplete` 호출 스킵 (OFF 의도 ↔ drafting 진입 모순 방지)
  - `enabled`가 false로 전환되면 인터벌 정지 + 버퍼 clear
  - cleanup: 언마운트 시 clearInterval + buffer.clear()
  - i18n: toast 문자열(권한 없음/외부 철회, 인코딩 실패)을 `src/i18n/*` ko/en 양방향 추가 (parity 테스트 통과)
  - 반환: `{ isCapturing, isReady, isEncoding, capture }` (진행률 UI 미사용으로 `encodeProgress` 제외)
- **검증**:
  - [ ] 수동 테스트: 설정에서 ON → 사이드패널에서 5초 후 isReady=true 확인
  - [ ] 수동 테스트: 다른 탭 전환 시 캡처 일시정지
  - [ ] 수동 테스트: 설정에서 OFF → 캡처 루프 즉시 중지 + 버퍼 클리어
  - [ ] 수동 테스트: 사이드패널 닫기 → 리소스 정리 (인터벌 중지)
  - [ ] 수동 테스트: 수동 비디오 녹화 중 캡처 일시 중지 확인
  - [ ] 수동 테스트: 드래프팅/프리뷰 중 캡처 일시 중지 확인 (phase gating)
  - [ ] 수동 테스트: 인코딩 실패 시 버퍼 보존 + 즉시 재시도 가능 확인
  - [ ] 수동 테스트: 인코딩 진행 중 설정 OFF 토글 → drafting 진입 안 함 (경합 가드)
  - [ ] 수동 테스트: 권한 외부 철회 후 패널 재열기 → 자동 OFF + toast

### Task 4: EditorStore — 기존 액션 재사용 확인 (신규 필드 없음)

- **변경 대상**: `src/store/editor-store.ts` (변경 없음 가능성 높음)
- **작업 내용**:
  - 기존 `onRecordingComplete(blob, thumbnail, viewport)` 액션이 30s Replay의 `idle → drafting` 직접 호출에서도 필요한 필드를 모두 설정하는지 확인:
    - `captureMode: "video"`, `phase: "drafting"`, `videoBlob`, `videoThumbnail`, `videoViewport`, `videoCapturedAt`
  - 차이가 있으면(예: recording phase 전제) 기존 액션에 **최소 보완**만 한다. 가능하면 그대로 재사용.
  - **`captureSource` 등 신규 필드/타입/EditorSnapshot 확장/마이그레이션은 추가하지 않는다** — 30s Replay와 수동 녹화는 결과·흐름이 동일하고 구분 값 소비처가 없음 (죽은 필드 회피).
  - 콘솔/네트워크 레코더 동기화는 hook의 `capture()`에서 처리 (스토어 액션은 side-effect free 유지)
- **검증**:
  - [ ] 단위 테스트: `onRecordingComplete` 호출 시 `captureMode: "video"`, `phase: "drafting"`, video* 필드 설정 확인 (기존 테스트로 커버되면 신규 불필요)
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과

### Task 5: SettingsUiStore + SettingsTab — 30s Replay 토글

- **변경 대상**: `src/store/settings-ui-store.ts`, `src/sidepanel/tabs/SettingsTab.tsx`
- **작업 내용 (Store)**:
  - `SettingsUiState`에 `replayEnabled: boolean` 필드 추가 (초기 state 기본 `false`)
  - `setReplayEnabled(enabled: boolean)` 액션 추가
  - **버전 bump 불필요** — optional bool이라 기존 persist 데이터에 키 없으면 zustand가 initializer 기본값(false) 사용. 마이그레이션 분기 추가 안 함.
- **작업 내용 (UI)**:
  - `IssueSettingsContent`에 "캡처" Section 추가 (기존 "제목 설정" 아래, "본문 구성" 위)
  - Section 내 Card > Row: Timer 아이콘 + "30s Replay" 라벨 + 도움말 텍스트(권한 범위·이유 안내) + Switch
  - Switch `onCheckedChange` 핸들러:
    - ON: `chrome.permissions.contains()` → 미승인이면 `chrome.permissions.request()` → 승인 시 `setReplayEnabled(true)`, 거부 시 OFF 복귀 + toast
    - OFF: `setReplayEnabled(false)` (권한은 유지)
  - 기존 `IssueSectionRow`와 동일한 레이아웃 패턴 사용
- **작업 내용 (i18n)**:
  - 신규 문자열(라벨 "30s Replay", help 텍스트, 권한 거부 toast)을 `src/i18n/*` ko/en 양방향 추가. parity 테스트(`locales.test.ts`) 통과 필수.
- **검증**:
  - [ ] 수동 테스트: Switch ON → 권한 프롬프트 표시 → 승인 → ON 유지
  - [ ] 수동 테스트: Switch ON → 권한 프롬프트 표시 → 거부 → OFF 복귀 + toast
  - [ ] 수동 테스트: 이미 승인된 상태에서 ON → 프롬프트 없이 즉시 ON
  - [ ] 수동 테스트: Switch OFF → ON → 재요청 없이 즉시 ON (권한 영구 유지)
  - [ ] 단위 테스트: i18n parity — 신규 키 ko/en 동등성 (`locales.test.ts`)
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과

### Task 6: background/messages.ts — captureVisibleTab JPEG 포맷 분기

- **변경 대상**: `src/background/messages.ts`, `src/types/messages.ts`
- **작업 내용**:
  - 현재 핸들러는 `{ format: "png" }` 하드코딩(`messages.ts`), `BgRequest`에 format/quality 없음 → **신규 추가**
  - `BgRequest`의 `captureVisibleTab` 타입에 optional `format?: "jpeg" | "png"`, `quality?: number` 파라미터 추가
  - background handler에서 `format`/`quality`가 있으면 해당 옵션으로 호출, 없으면 기존 PNG 동작 유지 (하위 호환). **`quality`는 JPEG일 때만 전달** (PNG에 quality는 무효 옵션)
  - 30s Replay에서는 `{ type: "captureVisibleTab", tabId, format: "jpeg", quality: 65 }`로 호출
- **검증**:
  - [ ] 수동 테스트: 기존 element capture / screenshot capture가 PNG로 정상 동작 (회귀 없음 — 호출처 `capture.ts`, `usePickerMessages.ts` 3곳)
  - [ ] 수동 테스트: 30s Replay 캡처 루프에서 JPEG format으로 호출 확인
  - [ ] `pnpm typecheck` 통과

### Task 7: UI — EmptyState 리팩터 + 30s Replay 버튼

- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx` (EmptyState 영역)
- **의존**: Task 8 (App.tsx 통합)에서 전달되는 `use30sReplay` 반환값을 소비
- **작업 내용**:
  - EmptyState에 **PageFooter 신규 도입**(로그 탭 ConsoleSubTab/NetworkSubTab의 footer 패턴 가져옴) → Freeform 진입을 footer의 "이슈 작성" 버튼으로 이동. 라벨·아이콘은 기존 `issue.startDraft` + `SquarePen` 재사용. 클릭 시 Freeform 모드 drafting 진입. (중앙 정렬 레이아웃 → 하단 고정 바 구조로 변경됨에 유의)
  - 기존 Freeform 위치(col-span-2)에 30s Replay 버튼 추가 → 그리드 유지: 1×2×1 배열
  - 30s Replay 버튼 상태 분기:
    - `replayEnabled=false`: disabled + Tooltip("이슈 설정에서 30s Replay를 활성화할 수 있습니다")
    - `replayEnabled=true`, `isReady=false`: disabled + Tooltip("화면을 기록하고 있습니다…")
    - `replayEnabled=true`, `isReady=true`: 활성
    - `isEncoding=true`: disabled + `Loader2` 스피너 (`animate-spin`) + 라벨 "인코딩 중…"
    - `phase!="idle"` (수동 녹화/드래프팅/프리뷰 등): disabled
  - **disabled 버튼 tooltip은 wrapper `<span>`에 trigger를 건다** (disabled `<button>`은 hover 이벤트 미발생 → Radix Tooltip 미동작)
  - i18n: 버튼 라벨/tooltip 2종/"인코딩 중…"을 ko/en 양방향 추가 (parity 테스트 통과)
  - `use30sReplay` hook에서 반환되는 상태 + `replayEnabled` 사용
- **검증**:
  - [ ] 수동 테스트: replayEnabled=false → 버튼 disabled + 안내 tooltip 호버 확인 (span wrapper로 표시되는지)
  - [ ] 수동 테스트: replayEnabled=true, 5초 미만 → 버튼 disabled + "기록 중" tooltip
  - [ ] 수동 테스트: replayEnabled=true, 5초 경과 → 버튼 활성
  - [ ] 수동 테스트: 인코딩 중 스피너 + "인코딩 중…" 라벨 + 버튼 disabled
  - [ ] 수동 테스트: 수동 비디오 녹화 중 버튼 disabled
  - [ ] 수동 테스트: PageFooter "이슈 작성" 클릭 → Freeform drafting 진입
  - [ ] 단위 테스트: i18n parity — 신규 키 ko/en 동등성
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
  - 30s Replay와 수동 녹화를 UI에서 구분 표시하지 않는다 (`captureSource` 미도입 결정에 따름)
- **검증**:
  - [ ] 수동 테스트: 30s Replay → 드래프팅 → 타이틀·에디터 정상
  - [ ] 수동 테스트: 콘솔/네트워크 로그 탭 표시 정상
  - [ ] 수동 테스트: 프리뷰 → 제출 → Jira/GitHub에 MP4 첨부 확인
  - [ ] 수동 테스트: 30s Replay로 생성된 이슈가 IndexedDB에 정상 영속화됨
  - [ ] 수동 테스트: drafting 진입 후 패널 닫기 → 재열기 → video 상태 (기존 수동 video와 동일 한계: confirmDraft 전이면 videoBlob 미영속 → 영상 유실 가능, 동작 확인)
  - [ ] 수동 테스트: 기존 수동 비디오 모드 정상 동작
  - [ ] `pnpm typecheck` 통과

## 테스트 계획

### 단위 테스트

| 대상 | 파일 | 케이스 |
|---|---|---|
| FrameBuffer | `src/sidepanel/30s-replay/__tests__/frame-buffer.test.ts` | push 순환, drain, clear, durationMs 계산, maxDurationMs 시간 기반 제거 |
| duration 계산 | `src/sidepanel/30s-replay/__tests__/mp4-encoder.test.ts` | 타임스탬프 차이 → μs 변환, **duration cap clamp**, 단일/마지막 프레임 기본값, 빈 배열 throw |
| 짝수 올림 | `src/sidepanel/30s-replay/__tests__/mp4-encoder.test.ts` | 홀수 → 짝수 올림 (1281→1282, 720→720) |
| 코덱 선택 | `src/sidepanel/30s-replay/__tests__/mp4-encoder.test.ts` | isConfigSupported mock → 후보 순차 탐색, colorSpace null → bt709 주입 |
| i18n parity | `src/i18n/__tests__/locales.test.ts` | 신규 키 ko↔en 동등성 (기존 테스트가 자동 커버) |

### 수동 테스트 체크리스트

- [ ] 설정 > 이슈 설정 > 30s Replay Switch ON → 권한 프롬프트 → 승인
- [ ] 설정 > 이슈 설정 > 30s Replay Switch ON → 권한 프롬프트 → 거부 → OFF 복귀
- [ ] 패널 열기 (설정 ON) → 5초 후 30s Replay 버튼 활성화
- [ ] 30초 대기 → 30s Replay 클릭 → 3초 이내 드래프팅 진입
- [ ] 생성된 MP4를 로컬에서 재생 — 화면 변화가 있는 영상인지 확인
- [ ] 다른 탭 전환 후 돌아와서 30s Replay → 공백 없이 정상
- [ ] 설정 OFF 상태 → 30s Replay 버튼 disabled + 호버 tooltip 확인
- [ ] PageFooter "이슈 작성" 클릭 → Freeform 모드 drafting 진입
- [ ] 30s Replay drafting 중 패널 닫기 → 재열기 → video 상태 동작 확인 (videoBlob 비영속 한계)
- [ ] 인코딩 진행 중 설정 OFF → drafting 진입 안 함 (경합 가드)
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
