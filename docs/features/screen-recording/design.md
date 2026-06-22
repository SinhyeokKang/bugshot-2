# 화면 전체 녹화 — 기술 설계

## 개요

기존 비디오 녹화 파이프라인(MediaRecorder → blob → `onRecordingComplete` → drafting)을 **스트림 소스에서만 분기**해 재사용한다. 뷰포트 녹화는 `chrome.tabCapture` 스트림, 화면 전체 녹화는 `navigator.mediaDevices.getDisplayMedia` 스트림을 얻고, 이후 MediaRecorder 생성·청크 수집·onstop·썸네일·viewport·store 전환 로직은 공통 헬퍼로 공유한다. `captureMode`는 `"video"`를 그대로 쓴다(결과 처리·UI 동일). idle 화면은 버튼 그룹만 1×2×2×1로 재배치한다.

## 변경 범위

### `src/sidepanel/video-recorder.ts` (변경)
- **현재 역할**: `startRecording(tabId)`가 tabCapture로 스트림을 얻고 MediaRecorder로 녹화, onstop에서 blob·썸네일·viewport를 만들어 `onRecordingComplete` 호출.
- **변경 내용**:
  - MediaRecorder 생성 ~ onstop ~ maxTimer ~ state 설정 로직을 내부 헬퍼 `beginRecording(stream, tabId, viewportHint?)`로 추출한다(현재 `startRecording`의 51–122행 본문).
  - `startRecording(tabId)`는 tabCapture 스트림을 얻어 `beginRecording(stream, tabId)` 호출(기존 동작 보존).
  - 신규 `startScreenRecording(stream, tabId)` export — 호출자가 이미 획득한 getDisplayMedia 스트림을 받아 `beginRecording(stream, tabId, trackViewport(stream))` 호출. **스트림 획득(getDisplayMedia)은 video-capture에서 한다**(아래 user-activation 위험 참조).
  - getDisplayMedia 스트림의 video track `ended` 이벤트(사용자가 브라우저 "공유 중지")에 `stopRecording()` 바인딩. `beginRecording`에서 `stream.getVideoTracks()[0].addEventListener("ended", stopRecording)` 등록.
  - viewport: tabCapture 경로는 기존대로 `chrome.tabs.get`의 tab 크기, 화면 경로는 video track의 `getSettings().width/height`를 우선(`trackViewport`). onstop의 viewport 획득 로직을 `viewportHint`가 있으면 그것으로 대체.

### `src/sidepanel/video-capture.ts` (변경)
- **현재 역할**: `startVideoCapture(tabId)`가 로그 레코더 활성화·초기화 후 `store.startRecording` + `videoRecorder.startRecording(tabId)`.
- **변경 내용**: 신규 `startScreenCapture(tabId)` export. 순서가 `startVideoCapture`와 **다르다** — getDisplayMedia를 가장 먼저(transient activation 보존):
  1. `const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 12 }, audio: false })` — **버튼 onClick 직후 첫 await**. reject(취소/거부)면 catch 후 return(no-op).
  2. 로그 레코더 activate/clear(현재 탭) — `startVideoCapture`와 동일.
  3. `store.startRecording({ tabId, url, title })`.
  4. `videoRecorder.startScreenRecording(stream, tabId)`. 실패 시 `store.cancelRecording()` + stream track stop.
- `startVideoCapture`는 무변경.

### `src/sidepanel/tabs/IssueTab.tsx` (변경)
- **`EmptyState`**: 버튼 그룹을 1×2×2×1로 재배치.
  - Row3 `ButtonGroup`: 기존 `mode-video`(뷰포트 녹화) + 신규 `mode-screen-record`(화면 전체 녹화) 2열. `ReplayButton`을 Row3에서 빼낸다.
  - Row4: `ReplayButton` 단독 full-width(`flex-1` → `w-full`, 좌측 border/rounded 보정 제거).
  - `EmptyState` props에 `onStartScreenRecord: () => void` 추가.
- **`EmptyState` 호출부**(IssueTab 상위, idle 렌더 지점): `onStartScreenRecord={() => startScreenCapture(tabId)}` 배선. 기존 `onStartVideo` 패턴 복제.
- `mode-video` 아이콘은 `Video` 유지, `mode-screen-record`는 `MonitorPlay`(또는 `ScreenShare`). 라벨은 아래 i18n.

### `src/i18n/namespaces/issue.ts` (변경, ko·en 동시)
- 라벨 전략(A안): "화면 녹화" 라벨을 *실제* 화면 녹화로 이전한다 — 기존 `video`는 tabCapture(탭 뷰포트)인데 "화면 녹화/Record screen"로 오표기돼 있었다.
  - `issue.mode.video`: "화면 녹화" → **"탭 녹화"** / "Record screen" → **"Record tab"**.
  - 신규 `issue.mode.screenRecord`: **"화면 녹화"** / **"Record screen"**.
- 필요 시 `issue.mode.screenRecord` 보조 설명/tooltip 키. **ko/en 키 대칭 필수**(PostToolUse 훅이 검사).

### `docs/privacy.md` (변경)
- 화면 전체 녹화는 **탭 밖(다른 창·앱·전체 화면) 데이터를 캡처**할 수 있어 tabCapture보다 광범위하다. 새 캡처 동작으로 분류해 수집 항목·목적에 추가하고 **시행일 갱신**. (privacy 심사 게이트 — manifest diff 0이어도 새 캡처 동작은 갱신 대상.)

### 변경 없음(재사용)
- `editor-store.ts`의 `startRecording` / `onRecordingComplete` / `cancelRecording` 액션, `captureMode: "video"`, IndexedDB `video:{tabId}` 저장, `DraftingPanel`의 `VideoPreview`, RecordingState(녹화 중 화면), 제출 시 `buildCaptureFiles`.
- `manifest.config.ts` — getDisplayMedia는 웹 표준 API라 권한 선언 불필요. `tabCapture` 권한은 뷰포트 녹화용으로 유지.
- 단축키(`capture-commands.ts` / `useCaptureShortcuts.ts`) — 화면 전체 녹화 단축키 미추가.

## 데이터 흐름

```
[화면 전체 녹화] onClick
  └─ startScreenCapture(tabId)               (video-capture.ts)
       1. getDisplayMedia()  ← user activation (첫 await, picker)
            └─ reject → return (idle 유지)
       2. activate/clear 로그 레코더 (현재 탭)
       3. store.startRecording() → phase: "recording"
       4. videoRecorder.startScreenRecording(stream, tabId)
            └─ beginRecording(stream, tabId, trackViewport(stream))   (video-recorder.ts)
                 - MediaRecorder(stream) 생성, chunks 수집
                 - track 'ended'(공유 중지) → stopRecording()
                 - maxTimer 60s → stopRecording()
                 - recorder.onstop → blob/thumbnail/viewport
                      └─ store.onRecordingComplete(blob, ...) → phase: "drafting"
                           - videoBlob 저장 (IndexedDB video:{tabId})
                           - networkLogAttach/consoleLogAttach/actionLogAttach = true
```

뷰포트 녹화는 1번이 `chrome.tabCapture.getMediaStreamId` + `getUserMedia`이고, 2~4 및 이후는 동일.

## 인터페이스 설계

```typescript
// video-recorder.ts
// 기존 startRecording의 본문(스트림 획득 이후)을 공유. viewportHint가 있으면 그 값을 viewport로 사용.
function beginRecording(
  stream: MediaStream,
  tabId: number,
  viewportHint?: { width: number; height: number },
): void;

export async function startRecording(tabId: number): Promise<void>;      // 기존(tabCapture) — 시그니처 불변
export function startScreenRecording(stream: MediaStream, tabId: number): void;  // 신규

// getDisplayMedia track settings에서 해상도 추출
function trackViewport(stream: MediaStream): { width: number; height: number } | undefined;

// video-capture.ts
export async function startScreenCapture(tabId: number): Promise<void>;  // 신규

// IssueTab.tsx EmptyState props
function EmptyState(props: {
  onStartElement: () => void;
  onStartElementShot: () => void;
  onStartScreenshot: () => void;
  onStartVideo: () => void;
  onStartScreenRecord: () => void;  // 신규
  onStartFreeform: () => void;
}): JSX.Element;
```

```typescript
// i18n/namespaces/issue.ts (ko·en 동시) — A안: "화면 녹화" 라벨을 실제 화면 녹화로 이전
"issue.mode.video": "탭 녹화",          // 기존 "화면 녹화"에서 변경 (en: "Record tab")
"issue.mode.screenRecord": "화면 녹화", // 신규 (en: "Record screen")
```

## 기존 패턴 준수

- **user gesture 체인**(CLAUDE.md 아키텍처): getDisplayMedia는 transient user activation을 요구한다. `startScreenCapture`에서 **첫 작업이 getDisplayMedia**여야 하며, 그 전에 `await`(chrome.tabs.get 등)를 넣으면 activation이 만료돼 picker가 안 뜨거나 거부된다. tabCapture(activeTab 기반)와 순서가 다른 이유.
- **세션/phase 패턴**: `captureMode: "video"` 공유 — phase 전환·세션 영속·로그 첨부 로직을 그대로 탄다.
- **i18n 동시 갱신**: `issue.ts` ko/en 키 대칭(빈 값·placeholder 일치). PostToolUse 훅이 자동 검사.
- **IconButton/버튼 사이즈**: 기존 EmptyState `Button variant="outline"` 패턴 그대로. ButtonGroup으로 묶음.
- **privacy 게이트**(메모리 `privacy_policy_review_gate`): 새 캡처 동작 → `docs/privacy.md` 시행일 포함 갱신.

## 대안 검토

1. **`chrome.desktopCapture.chooseDesktopMedia` 사용** — 별도 `desktopCapture` manifest 권한이 필요하고 streamId→getUserMedia 2단계라 복잡하다. getDisplayMedia는 웹 표준이라 권한 선언이 없고 picker가 내장이며 user activation만 만족하면 된다. → **getDisplayMedia 채택**.
2. **새 `captureMode: "screen"` 추가** — drafting·저장·제출·VideoPreview가 전부 동일한데 분기만 늘어난다. union·세션 마이그레이션·테스트 부담만 증가. → **"video" 재사용**.
3. **로그 첨부를 화면 녹화에서 기본 OFF** — 영상↔로그 탭 불일치를 막지만, 같은 탭을 녹화하는 흔한 경우에 로그를 잃는다. drafting에서 끌 수 있으므로 기본 ON 유지가 낫다. → **현재 탭 로그 기본 첨부**(사용자 답변).

## 위험 요소

- **user activation 만료**: `startScreenCapture`에서 getDisplayMedia 이전에 `await`가 끼면 picker 실패. 첫 await로 강제하는 게 핵심 — 구현·리뷰 시 순서 회귀 주의.
- **사이드패널에서 getDisplayMedia 동작**: MV3 확장 페이지(side panel)는 secure context라 호출 가능하나, 실제 picker 표시·녹화는 헤드리스/자동화에서 재현 불가 → **수동 테스트 필수**(e2e는 fake media flag 없이는 불안정, 기존 수동 video 모드와 동일 분류).
- **track ended 중복 종료**: "공유 중지"(track ended)와 패널 중지·maxTimer가 경합할 수 있다. `stopRecording`은 `state` 가드(`if (!state) return`)와 `recorder.state === "recording"` 체크가 있어 멱등 — 그대로 안전하나, ended 리스너가 onstop 이후에도 남지 않도록 cancel/onstop에서 정리 확인.
- **viewport 0 처리**: getDisplayMedia track settings가 width/height를 안 줄 수 있다(일부 OS). `trackViewport`가 undefined면 기존 `chrome.tabs.get` 폴백으로. 썸네일은 영상 디코드 기반이라 영향 없음.
- **picker 취소 vs 에러 구분**: getDisplayMedia 취소는 `NotAllowedError`로 reject — 콘솔 경고 없이 조용히 idle 유지(에러 토스트 금지). 실제 실패(미지원 등)만 경고.
