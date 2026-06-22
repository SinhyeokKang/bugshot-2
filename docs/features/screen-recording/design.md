# 화면 전체 녹화 — 기술 설계

## 개요

기존 비디오 녹화 파이프라인(MediaRecorder → blob → `onRecordingComplete` → drafting)을 **스트림 소스에서만 분기**해 재사용한다. 뷰포트 녹화는 `chrome.tabCapture` 스트림, 화면 전체 녹화는 `navigator.mediaDevices.getDisplayMedia` 스트림을 얻고, 이후 MediaRecorder 생성·청크 수집·onstop·썸네일·viewport·store 전환 로직은 공통 헬퍼로 공유한다. `captureMode`는 `"video"`를 그대로 쓴다(결과 처리·UI 동일). 단 녹화 중 화면 구분을 위해 recorder source(`tab`/`screen`) 한 필드만 들고 라벨·아이콘을 분기한다. idle 화면은 버튼 그룹을 1×2×2×1로 재배치한다.

> **선행 전제(Task 0 차단 게이트)**: 이 설계 전체는 `getDisplayMedia`가 MV3 **side panel(확장 페이지)에서 직접** 동작함을 전제로 한다. MV3 미디어 캡처는 offscreen document(`offscreen` 권한 + `reasons:["DISPLAY_MEDIA"]`)가 표준 권장 경로이며, side panel 직접 호출은 환경/버전에 따라 picker 후 스트림 획득이 실패할 수 있다(불확실). **설계 확정 전 개발 빌드에서 1회 PoC 검증**해야 한다. 직접 호출이 되면 아래 설계 그대로, 안 되면 offscreen 경유로 스트림 획득부가 재설계된다(권한·구조 변경 — 나머지 파이프라인은 동일).

## 변경 범위

### `src/sidepanel/video-recorder.ts` (변경)
- **현재 역할**: `startRecording(tabId)`가 tabCapture로 스트림을 얻고 MediaRecorder로 녹화, onstop에서 blob·썸네일·viewport를 만들어 `onRecordingComplete` 호출.
- **변경 내용**:
  - MediaRecorder 생성 ~ onstop ~ maxTimer ~ state 설정 로직을 내부 헬퍼 `beginRecording(stream, tabId, viewportHint?)`로 추출한다(현재 `startRecording`의 51–122행 본문).
  - `startRecording(tabId)`는 tabCapture 스트림을 얻어 `beginRecording(stream, tabId)` 호출(기존 동작 보존).
  - 신규 `startScreenRecording(stream, tabId)` export — 호출자가 이미 획득한 getDisplayMedia 스트림을 받아 `beginRecording(stream, tabId, { source: "screen", viewportHint: trackViewport(stream) })` 호출. **스트림 획득(getDisplayMedia)은 video-capture에서 한다**(아래 user-activation 위험 참조).
  - `RecorderState`에 `source: "tab" | "screen"` 필드 추가. `startRecording`은 `"tab"`, `startScreenRecording`은 `"screen"`. 이 값은 store로 전달돼 RecordingState 라벨/아이콘 분기에 쓰인다(아래 store 변경).
  - **track `ended` 리스너 정리**: getDisplayMedia track의 `ended`("공유 중지")에 `stopRecording`을 바인딩하되, **named handler를 `RecorderState`에 보관**해 `onstop`과 `cancelRecording` **양쪽**에서 `track.removeEventListener("ended", handler)`로 떼낸다. 현재 `cancelRecording`(135–146행)은 `ondataavailable`/`onstop`만 정리하고 ended 리스너는 안 건드리므로 — **`cancelRecording` 본문을 수정**해 ended 정리를 추가해야 한다(stale 리스너가 다음 스트림에 누수되는 회귀 방지). `track.stop()`은 ended를 발화하지 않으므로 재진입은 없지만, 참조 정리를 명시한다.
  - viewport: tabCapture 경로는 기존대로 `chrome.tabs.get`의 tab 크기, 화면 경로는 video track의 `getSettings().width/height`를 우선(`trackViewport`). onstop의 viewport 획득 로직을 `viewportHint`가 있으면 그것으로 대체. **화면 경로에서 `trackViewport`가 undefined면 `chrome.tabs.get` 폴백을 타지 않고 `{0,0}` 유지**(현재 탭 크기는 다른 모니터 녹화 시 영상 해상도와 무관해 잘못된 메타가 되므로).

### `src/sidepanel/video-capture.ts` (변경)
- **현재 역할**: `startVideoCapture(tabId)`가 로그 레코더 활성화·초기화 후 `store.startRecording` + `videoRecorder.startRecording(tabId)`.
- **변경 내용**: 신규 `startScreenCapture(tabId)` export. 순서가 `startVideoCapture`와 **다르다** — getDisplayMedia를 가장 먼저(transient activation 보존):
  1. `getDisplayMedia({ video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: 12 }, audio: false })` — **버튼 onClick 직후 첫 await**. 1080p 상한으로 4K 전체화면 대용량/과압축 방지. reject 처리는 **취소와 실제 실패를 구분**: `err.name === "NotAllowedError"`(사용자 취소)면 **silent return**(콘솔 경고·토스트 없음), 그 외 에러는 `console.warn` 후 return. 둘 다 idle 유지.
  2. 로그 레코더 activate/clear(현재 탭) — `startVideoCapture`와 동일.
  3. `chrome.tabs.get(tabId)`로 url/title 확보(getDisplayMedia **이후** — activation 보존) → `store.startRecording({ tabId, url, title })`.
  4. `try { videoRecorder.startScreenRecording(stream, tabId) } catch`(동기 함수지만 방어적) → 실패 시 `store.cancelRecording()` + `stream.getTracks().forEach(t => t.stop())`.
- `startVideoCapture`는 무변경.

### `src/sidepanel/tabs/IssueTab.tsx` (변경)
- **`EmptyState`**: 버튼 그룹을 1×2×2×1로 재배치.
  - Row3 `ButtonGroup`: 기존 `mode-video`(탭 녹화, `Video` 아이콘 유지) + 신규 `mode-screen-record`(화면 녹화, `MonitorPlay` 아이콘) 2열. 둘 다 `variant="outline"` + `flex-1` + default 사이즈(h-9)로 짝을 맞춘다(`xl` 금지). `mode-screen-record`는 단축키가 없으므로 `ShortcutTooltip`으로 감싸지 않는다(무단축키 `mode-element-shot` 선례와 일치). `ReplayButton`을 Row3에서 빼낸다.
  - 좁은 폭 라벨 clip 방지: 두 버튼 라벨 span에 `min-w-0 truncate`(Button base가 `whitespace-nowrap`이라 wrap이 아닌 clip — ko는 여유 있으나 en/축소폭 대비).
  - Row4: `ReplayButton` 단독 full-width. **`ReplayButton`은 `flex-1 rounded-l-none border-l-0`를 양 분기(`replayEnabled` on/off 둘 다, 251·262행)에서 하드코딩**하므로, 단독 분리 시 그 좌측 seam 보정을 양쪽 모두 제거하고 `w-full`로 바꾼다. enabled 분기의 `aria-disabled:cursor-not-allowed aria-disabled:opacity-50` 등 상태 클래스는 보존.
  - `EmptyState` props에 `onStartScreenRecord: () => void` 추가.
- **`RecordingState`**(IssueTab.tsx:323~): props에 `source: "tab" | "screen"` 추가. 라벨을 `"화면 녹화 중 {time}"`/`"탭 녹화 중 {time}"`으로, 아이콘을 `MonitorPlay`/`Video`로 분기. **Cancel 버튼이 `videoRecorder.cancelRecording()`을 호출하는지 배선 확인** — 화면 녹화 Cancel 시 getDisplayMedia 스트림이 안 멈추면 브라우저 공유 막대가 유령 상태로 남는다(`cancelRecording`의 `stream.getTracks().forEach(t=>t.stop())`이 호출만 되면 해소). source는 store에서 읽어 전달.
- **`EmptyState` 호출부**(IssueTab 상위, idle 렌더 지점): `onStartScreenRecord={() => startScreenCapture(tabId)}` 배선. 기존 `onStartVideo` 패턴 복제.

### `src/store/editor-store.ts` (변경 — 소폭)
- `startRecording` 액션 인자에 `source: "tab" | "screen"`를 받아 상태에 보관(RecordingState가 읽을 수 있게). 기존 호출처(`startVideoCapture`)는 `"tab"` 전달. `onRecordingComplete`/`cancelRecording`/`captureMode: "video"`/IndexedDB 경로는 무변경.

### `src/i18n/namespaces/issue.ts` (변경, ko·en 동시)
- 라벨 전략(A안): "화면 녹화" 라벨을 *실제* 화면 녹화로 이전한다 — 기존 `video`는 tabCapture(탭 뷰포트)인데 "화면 녹화/Record screen"로 오표기돼 있었다.
  - `issue.mode.video`: "화면 녹화" → **"탭 녹화"** / "Record screen" → **"Record tab"**.
  - 신규 `issue.mode.screenRecord`: **"화면 녹화"** / **"Record screen"**.
- RecordingState source 구분용 신규 키(ko·en): `issue.recording.tab`("탭 녹화 중") / `issue.recording.screen`("화면 녹화 중"). 기존 녹화중 라벨 키가 단일이면 두 키로 분기. **ko/en 키 대칭 필수**(PostToolUse 훅이 검사).

### `docs/privacy.md` (변경)
- 화면 전체 녹화는 **탭 밖(다른 창·앱·전체 화면) 데이터를 캡처**할 수 있어 tabCapture보다 광범위하다. 새 캡처 동작으로 분류해 수집 항목·목적에 추가하고 **시행일 갱신**. (privacy 심사 게이트 — manifest diff 0이어도 새 캡처 동작은 갱신 대상.)

### 변경 없음(재사용)
- `editor-store.ts`의 `onRecordingComplete` / `cancelRecording` 액션, `captureMode: "video"`, IndexedDB `video:{tabId}` 저장, `DraftingPanel`의 `VideoPreview`, 제출 시 `buildCaptureFiles`. (`startRecording` 액션은 source 인자 추가로 소폭 변경 — 위 참조.)
- `manifest.config.ts` — **단, getDisplayMedia 직접 호출이 PoC에서 실패해 offscreen 경유로 가면 `offscreen` 권한 추가 필요**. 직접 호출이 되면 권한 선언 불필요(웹 표준 API). `tabCapture` 권한은 탭 녹화용으로 유지.
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
type RecordSource = "tab" | "screen";

// 기존 startRecording의 본문(스트림 획득 이후)을 공유.
function beginRecording(
  stream: MediaStream,
  tabId: number,
  opts: { source: RecordSource; viewportHint?: { width: number; height: number } },
): void;
// RecorderState에 source·endedHandler 보관(onstop/cancel에서 removeEventListener 용).

export async function startRecording(tabId: number): Promise<void>;      // 기존(tabCapture) — 시그니처 불변, source="tab"
export function startScreenRecording(stream: MediaStream, tabId: number): void;  // 신규, source="screen"

// getDisplayMedia track settings에서 해상도 추출 (순수 — 단위 테스트 대상)
function trackViewport(stream: MediaStream): { width: number; height: number } | undefined;

// video-capture.ts
export async function startScreenCapture(tabId: number): Promise<void>;  // 신규

// editor-store.ts — startRecording 액션에 source 추가
startRecording(payload: { tabId: number; url: string; title: string; source: "tab" | "screen" }): void;

// IssueTab.tsx
function EmptyState(props: {
  onStartElement: () => void;
  onStartElementShot: () => void;
  onStartScreenshot: () => void;
  onStartVideo: () => void;
  onStartScreenRecord: () => void;  // 신규
  onStartFreeform: () => void;
}): JSX.Element;

function RecordingState(props: {
  source: "tab" | "screen";  // 신규 — 라벨/아이콘 분기
  /* 기존 onStop / onCancel 등 */
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

1. **`chrome.desktopCapture.chooseDesktopMedia` 사용** — 별도 `desktopCapture` manifest 권한이 필요하고 streamId→getUserMedia 2단계라 복잡하다. getDisplayMedia는 웹 표준이라 권한 선언이 없고 picker가 내장이며 user activation만 만족하면 된다. → **getDisplayMedia 채택**. 단 이는 **Task 0 PoC(side panel 직접 호출 성공)를 전제**로 한다 — PoC 실패 시 fallback은 desktopCapture가 아니라 **offscreen document에서 getDisplayMedia**(MV3 표준 권장)이며, 그 경우 `offscreen` 권한 + 메시지 패싱으로 스트림 획득부가 바뀐다(나머지 파이프라인 동일). PoC 결과에 따라 이 절을 갱신한다.
2. **새 `captureMode: "screen"` 추가** — drafting·저장·제출·VideoPreview가 전부 동일한데 분기만 늘어난다. union·세션 마이그레이션·테스트 부담만 증가. → **"video" 재사용**.
3. **로그 첨부를 화면 녹화에서 기본 OFF** — 영상↔로그 탭 불일치를 막지만, 같은 탭을 녹화하는 흔한 경우에 로그를 잃는다. drafting에서 끌 수 있으므로 기본 ON 유지가 낫다. → **현재 탭 로그 기본 첨부**(사용자 답변).

## 위험 요소

- **🔴 (차단) side panel getDisplayMedia 동작 미검증**: 이 설계의 전제. MV3 미디어 캡처는 offscreen이 표준 권장이라 side panel 직접 호출 성공이 보장되지 않는다. **Task 0 PoC가 green이어야 나머지 설계가 유효** — 실패 시 offscreen 경유로 스트림 획득부 재설계(권한 추가). 설계 확정 전 반드시 검증.
- **user activation 만료**: `startScreenCapture`에서 getDisplayMedia 이전에 `await`(`chrome.tabs.get` 등)가 끼면 picker 실패. 첫 await로 강제하는 게 핵심 — 구현·리뷰 시 순서 회귀 주의.
- **자동화 한계**: 실제 picker 표시·녹화는 헤드리스/자동화에서 재현 불가 → **수동 테스트 필수**(e2e는 fake media flag 없이는 불안정, 기존 수동 video 모드와 동일 분류). e2e는 버튼 노출·레이아웃까지만.
- **track ended 리스너 누수/경합**: "공유 중지"(track ended)·패널 중지·maxTimer 3경로가 경합할 수 있다. `stopRecording`은 `if (!state) return` + `recorder.state === "recording"` 가드로 멱등이라 **이중 종료는 안전**. 단 `ended` named handler를 `onstop`·`cancelRecording` 양쪽에서 `removeEventListener`로 떼야 stale 리스너가 다음 스트림에 누수되지 않는다(현재 `cancelRecording`엔 정리 코드 없음 — 본문 수정 필요).
- **녹화 중 패널 닫힘 → 손실**: side panel이 닫히면 모듈 전역 `state`·MediaRecorder·스트림이 소멸해 진행 중 녹화가 사라진다(탭 녹화와 동일 한계). 화면 녹화는 다른 창으로 포커스를 옮길 일이 많아 구조적으로 더 취약. 자동 저장은 스코프 밖 — 손실 수용(PRD 엣지 명시).
- **동시 녹화/picker 대기 중 트리거**: getDisplayMedia picker가 떠 있는 동안(수 초~수십 초) store는 아직 idle이라, 캡처 단축키(idle에서만 발화)가 그 사이 다른 캡처를 트리거할 수 있다. `startRecording` 진입부 `if (state) cancelRecording()` 가드가 있으나, picker 대기와 겹치는 경로는 수동 테스트로 확인.
- **해상도/용량**: getDisplayMedia constraint에 1080p 상한(`width.max 1920 / height.max 1080`)을 둬 4K 전체화면 60초의 과압축·대용량(IndexedDB)을 방지. frameRate 12 유지.
- **viewport 0 처리**: getDisplayMedia track settings가 width/height를 안 줄 수 있다. 화면 경로는 `trackViewport` undefined 시 `{0,0}` 유지(현재 탭 크기 폴백 금지 — 다른 모니터 녹화면 잘못된 메타). 썸네일은 영상 디코드 기반이라 영향 없음.
- **picker 취소 vs 에러 구분**: getDisplayMedia 취소는 `NotAllowedError`로 reject — 콘솔 경고 없이 조용히 idle 유지(토스트 금지). 그 외 에러(미지원 등)만 `console.warn`. tasks/prd와 이 분기를 일치시킨다.
