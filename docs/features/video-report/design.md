# 비디오 리포트 — 기술 설계

## 개요

기존 React log-viewer(`src/log-viewer/`)에 영상 플레이어 칸을 가로로 붙이고, 영상 blob을 logs.html에 dataUrl로 임베드한 뒤, 세 로그 컴포넌트(`ConsoleLogContent`/`NetworkLogContent`/`ActionLogContent`)에 **하위호환 optional 동기화 props**를 추가해 영상 재생 위치와 로그 행을 양방향으로 묶는다. 모든 로그가 이미 절대 epoch `timestamp`를 갖고 있으므로, 영상 시작 시각(`videoStartedAt`)을 공통 0점으로 영속화하는 것이 유일한 신규 데이터다.

vanilla from-scratch 리포트(`docs/features/video-report-player/`의 `buildVideoReport.ts`)는 만들지 않는다 — log-viewer가 로그 렌더·필터·검색·상대시간·탭을 이미 제공하므로 그것을 재사용한다.

## 핵심 설계 결정

### 1. 동기화 앵커 = `videoStartedAt` / `videoEndedAt` 영속화 (필수 선행)

로그를 영상에 맞추려면 영상 시작 절대 시각이 필요하다. 현재:

- 수동녹화 시작 시각은 `video-recorder.ts:111`의 `state.startTime`(`Date.now()`) — **메모리 전용**.
- 영속되는 `videoCapturedAt`(editor-store)은 녹화 **완료**(썸네일 생성 후) 시각이라 실제 종료보다 늦다 → 앵커 부적합.
- 30s-replay는 `use-30s-replay.ts:155`에서 `lower = frames[0].timestamp`(윈도우 시작)와 `captureTime`(`:154`)을 이미 계산한다 — 그대로 영상 구간 `[start, end]`.

→ `videoStartedAt`/`videoEndedAt`를 editor store와 `IssueRecord`에 영속화한다.

| 진입 | videoStartedAt | videoEndedAt |
|---|---|---|
| 수동녹화 (`video-recorder.ts` onstop) | `state.startTime` | onstop 콜백 진입 즉시 찍은 `Date.now()` |
| 30s-replay (`use-30s-replay.ts` capture) | `frames[0].timestamp` (=`lower`) | `captureTime` |

둘 다 `onRecordingComplete(blob, thumbnail, viewport, startedAt, endedAt)`로 흘려보낸다.

**realm 주의**: `videoStartedAt`는 side panel `Date.now()`, 로그 timestamp는 대상 탭(MAIN world) 시계. 같은 머신·같은 시스템 시계 → 차감 안전(video-report-player 설계와 동일 가정).

**세션 영속화 주의**: `EditorSnapshot`은 `useEditorSessionSync.ts`의 `snapshotFromState()`(`:49-51`)가 video 필드를 **수동 복사**한다. `videoStartedAt`/`videoEndedAt`도 거기 명시 추가해야 패널 재오픈 후 보존된다(누락 시 타입은 `Pick` 통과하나 런타임 소실).

### 2. 영상은 logs.html에 임베드, `recording.mp4` 폐지

`buildLogsHtml`은 이미 `LogViewerData`를 `__BUGSHOT_DATA__` JSON으로 주입한다(`buildLogsHtml.ts:32` `.replace(/</g, "\\u003c")` escape). 영상 dataUrl(`data:video/mp4;base64,...`)은 `<` 미포함이라 escape 무해, JSON 문자열로 안전하게 실린다. log-viewer `App.tsx`는 `<video src={data.video.dataUrl}>`로 재생.

`buildCaptureFiles`의 `result.video`(=`recording.mp4`) push를 **제거**한다. 영상은 logs.html 안에만 존재. 이로써 `recordingFilename` import가 고아가 되면 함께 제거(내 변경이 만든 고아).

**용량**: 60초/1.5Mbps ≈ 11MB → base64 ≈ 15MB → logs.html 전체 ~15MB+. 플랫폼 첨부 한도(Jira 10MB 등) 초과 가능 → 제출 핸들러에서 실패 격리(위험 요소 참조). 기존 `recording.mp4`도 같은 크기였으므로 **전송 데이터 총량은 거의 불변**(별도 mp4가 사라지고 logs.html에 합쳐질 뿐).

### 3. 가로 리사이즈 레이아웃

`App.tsx`를 shadcn `resizable`(react-resizable-panels) 기반 `ResizablePanelGroup direction="horizontal"`로 감싼다. 좌 패널 = 영상 플레이어, 우 패널 = 기존 `Tabs`. 초기 `defaultSize={50}`/`{50}`, 가운데 `ResizableHandle withHandle`. 루트는 `h-screen`(100vh) 유지, 두 패널 모두 `h-full`.

영상(`data.video`)이 **없으면** ResizablePanelGroup 없이 기존처럼 `Tabs`만 풀폭 렌더(분기 한 줄). element/screenshot/freeform logs.html은 자동으로 이 경로.

`resizable`은 미설치 → `npx shadcn@latest add resizable` → `src/components/ui/resizable.tsx` 위치 확인.

### 4. 동기화 = 세 컴포넌트에 하위호환 optional props

세 로그 컴포넌트는 라이브 사이드패널 디버그 서브탭에서도 쓰이므로(`ConsoleSubTab`/`NetworkSubTab`), **새 props는 전부 optional**이고 미공급 시 현재 동작이 100% 보존된다. log-viewer가 영상과 함께 렌더할 때만 공급한다.

공통 신규 props(세 컴포넌트 동일):

```typescript
syncBaseMs?: number;            // = videoStartedAt. 공급 시 상대시간 0점·점프 기준
onSeek?: (absTs: number) => void; // 행 클릭 → 영상 점프. App이 video.currentTime로 변환
activeTs?: number;              // 현재 영상 재생 절대시각. 이 값 이하 중 가장 늦은 행을 하이라이트
```

- **상대시간 통일**: 공급된 `syncBaseMs`가 있으면 `formatRelativeTime`의 base로 자기 `startedAt` 대신 `syncBaseMs`를 쓴다. `NetworkLogContent`는 현재 상대시간 칩이 없으므로(startedAt 미수신), `syncBaseMs` 공급 시 행 좌측에 `[+MM:SS]` 칩을 **추가**(Console/Action 레이아웃과 정렬).
- **점프**: 각 행의 `[+MM:SS]` 칩을 `<button>`으로 만들어 `onSeek(rowTimestamp)` 호출. 칩만 점프 트리거로 두면 Console accordion 펼침·Network detail 선택 같은 기존 행 클릭 동작과 충돌하지 않는다(코어 최소 침습).
- **하이라이트**: `activeTs`가 공급되면 각 컴포넌트가 자기 엔트리 timestamp 배열에서 `activeTs` 이하 중 최댓값 인덱스를 골라(공유 헬퍼) 그 행에 active 스타일(좌측 accent 보더 + `bg-accent/40`)을 입힌다. 기존 하이라이트(Network `rowBg`의 detail-active)와 별도 슬롯이라 충돌 없음.

각 컴포넌트 행 엘리먼트 지점: Console `EntryAccordion`(`ConsoleLogContent.tsx:170`), Network `RequestRow`(`NetworkLogContent.tsx:345`), Action `ActionRow`(`ActionLogContent.tsx:195`).

### 5. App의 동기화 오케스트레이션

`App.tsx`가 단일 진실의 원천:

- `videoRef`(`<video>`) + `currentMs` state. `<video onTimeUpdate>` → `setCurrentMs(videoStartedAt + video.currentTime * 1000)`.
- `seekTo(absTs)` → `videoRef.current.currentTime = (absTs - videoStartedAt) / 1000` + `video.play()`(선택).
- 세 `*LogContent`에 `syncBaseMs={videoStartedAt}`, `onSeek={seekTo}`, `activeTs={currentMs}` 전달.
- 영상/앵커 부재 시 이 props를 넘기지 않음 → 컴포넌트는 기존 동작.

`activeTs`는 **모든 탭**에 같은 값으로 흐르므로, 비활성 탭으로 전환해도 하이라이트 상태가 일관된다(각 탭 `data-[state=inactive]:hidden`이라 동시 마운트).

## 신규 순수 헬퍼: `src/log-viewer/timeline.ts`

테스트 가능한 순수 로직만 분리(컴포넌트는 부수효과/DOM이라 단위 테스트 부적합 — CLAUDE.md 테스트 우선 원칙).

```typescript
// 정렬돼 있지 않을 수 있는 timestamps 중, currentMs 이하인 가장 늦은 항목의 인덱스. 없으면 -1.
export function findActiveIndex(timestamps: number[], currentMs: number): number;

// (absTs - baseMs)를 초 단위(음수 clamp 0)로. seek 타깃 계산용.
export function toVideoSeconds(absTs: number, baseMs: number): number;
```

`findActiveIndex`는 각 `*LogContent`가 자기 엔트리에서 active 행을 고를 때 공유. 선형 스캔(엔트리 ≤ 수천)으로 충분.

## 데이터 모델 변경

### `src/store/editor-store.ts`

- `EditorState` / `initial` / `EditorSnapshot`에 `videoStartedAt: number | null`, `videoEndedAt: number | null` 추가.
- `onRecordingComplete` 시그니처(`:115`)·구현(`:348`)에 `startedAt`/`endedAt` 인자 추가, set에 반영.
- `confirmDraft` video 분기 — `saveDraft` 객체에 `videoStartedAt`/`videoEndedAt` 포함.

### `src/sidepanel/hooks/useEditorSessionSync.ts`

`snapshotFromState()`(`:49-51` video 필드 옆)에 `videoStartedAt: s.videoStartedAt`, `videoEndedAt: s.videoEndedAt` 복사 추가.

### `src/store/issues-store.ts`

`IssueRecord`에 `videoStartedAt?: number`, `videoEndedAt?: number` 추가(optional). `ISSUES_STORE_VERSION` 주석에 한 줄 추적 — **마이그레이션 코드 없음**(전부 optional, 기존 패턴). 구 draft는 두 필드 `undefined` → 동기화 비활성, 영상만 재생.

### `src/sidepanel/video-recorder.ts`

`onstop` 콜백 진입 즉시 `const localEndedAt = Date.now()`. `state = null`(`:71`) 전에 `localStartTime = s.startTime` 보존(현재 `localTabId` 보존 패턴과 동일). `onRecordingComplete(blob, thumbnail, viewport, localStartTime, localEndedAt)`(`:96-98`).

### `src/sidepanel/30s-replay/use-30s-replay.ts`

`capture()`에서 `onRecordingComplete(blob, thumbnail, viewport, frames[0].timestamp, captureTime)`(`:180`). `lower`(`:155`)·`captureTime`(`:154`)은 이미 존재.

## log-viewer 통합

### `src/types/log-viewer.ts`

```typescript
export interface LogViewerData {
  networkLog: NetworkLog | null;
  consoleLog: ConsoleLog | null;
  actionLog: ActionLog | null;
  har: object | null;
  consoleLogJson: object | null;
  actionLogJson: object | null;
  video: {                       // 신규 (없으면 null — 영상 미임베드/부재)
    dataUrl: string;
    mime: string;
    startedAt: number;           // 동기화 앵커(공통 0점)
    endedAt: number;
    thumbnail?: string;          // <video poster>
    viewport?: { width: number; height: number };
  } | null;
  meta: { version: string; createdAt: string; pageUrl: string; issueUrl?: string };
}
```

### `src/sidepanel/lib/buildLogsHtml.ts`

시그니처에 `video` 인자 추가(actionLog 다음, pageUrl 앞), `data.video`에 주입:

```typescript
export function buildLogsHtml(
  networkLog: NetworkLog | null,
  consoleLog: ConsoleLog | null,
  actionLog: ActionLog | null,
  video: LogViewerData["video"],   // 신규
  pageUrl: string,
  issueUrl?: string,
): string;
```

### `src/sidepanel/lib/buildCaptureFiles.ts`

- `BuildCaptureFilesInput`에 `videoStartedAt?: number`, `videoEndedAt?: number`, `videoThumbnail?: string | null`, `videoViewport?: { width; height } | null` 추가(`videoBlob`은 이미 있음).
- **`result.video` push 제거**(`:42-47`) — `recording.mp4` 폐지. `recordingFilename` import 제거(고아).
- video 모드에서 `videoBlob`이 있고 `videoStartedAt`/`videoEndedAt`이 모두 있으면 `video` 객체 조립(`dataUrl = await blobToDataUrl(videoBlob)`, `mime = videoBlob.type`) → `buildLogsHtml`에 전달. 하나라도 없으면 `null`(graceful).
- `actionLog` 게이팅(video만)은 현행 유지(`:51`).

### `src/log-viewer/App.tsx`

- `data.video` 존재 시 `ResizablePanelGroup`(좌 플레이어 / 우 `Tabs`), 부재 시 기존 `Tabs` 풀폭.
- 좌 패널: `<video ref controls poster={video.thumbnail} src={video.dataUrl} onTimeUpdate>` + `h-full` 컨테이너. (후속 재생바 타임스탬프 UI 자리 확보만, 이번엔 미구현.)
- `currentMs` state + `seekTo` 콜백(핵심 설계 5).
- `video.startedAt`/`endedAt`이 있을 때만 세 `*LogContent`에 `syncBaseMs`/`onSeek`/`activeTs` 전달. 없으면 미전달(영상은 재생, 동기화 비활성).
- 영상 로드 에러(`onError`) 시 플레이어 자리에 안내, 탭은 계속 동작(graceful — 좌 패널만 메시지로 대체).

### `src/sidepanel/components/{Console,Network,Action}LogContent.tsx`

핵심 설계 4의 optional props 추가. Network는 `syncBaseMs` 공급 시 상대시간 칩 신규. 셋 다 `findActiveIndex`로 active 행 산출. **미공급 경로의 기존 동작·레이아웃 불변**(라이브 서브탭 회귀 방지).

### 제출 경로 (buildCaptureFiles 호출부 2곳)

- `src/sidepanel/tabs/IssueCreateModal.tsx` `buildEditorCaptureFiles`(`:219-238`) — editor store에서 `videoStartedAt`/`videoEndedAt`/`videoThumbnail`/`videoViewport`를 읽어 `buildCaptureFiles`에 전달(`videoBlob`은 이미 `:103`).
- `src/sidepanel/tabs/DraftDetailDialog.tsx` `buildCtxForSubmit`(`:232-290`) — `issue.videoStartedAt`/`videoEndedAt`, `issue.snapshot`의 viewport/thumbnail 전달. `videoBlob`은 이미 `getVideoBlob(issue.id)`(`:270`).
- 제출 핸들러(4 플랫폼)는 `captureFiles.video`가 사라져도 무변경 — `.logs`(logs.html)·`.images`·`.jsonLogs`만 iterate하면 됨. `recording.mp4`가 없어지는 것 외 첨부 배관 변경 없음.

### i18n

영상 로드 에러·플레이어 빈 안내 등 신규 문자열을 `src/log-viewer/i18n.ts` ko/en 동시 추가. `log-viewer/__tests__/i18n.test.ts` 대칭 검증. 사이드패널 `src/i18n/`는 신규 키 없으면 무변경.

## 데이터 흐름

```
[녹화] video-recorder.onstop  /  use-30s-replay.capture
   onRecordingComplete(blob, thumb, viewport, startedAt, endedAt)
      → editor-store: videoStartedAt/videoEndedAt set (+ EditorSnapshot 영속)
      → confirmDraft → IssueRecord.videoStartedAt/videoEndedAt
[제출] IssueCreateModal / DraftDetailDialog
   buildCaptureFiles({ videoBlob, videoStartedAt, videoEndedAt, videoThumbnail, videoViewport, ... })
      → (video 모드 & blob & 앵커 존재 시) video = { dataUrl, mime, startedAt, endedAt, ... }
      → buildLogsHtml(..., video, ...) → __BUGSHOT_DATA__ JSON 임베드 → logs.html
      → 플랫폼 첨부 (recording.mp4 없음)
[열람] logs.html → main.tsx JSON.parse → App
   data.video 있음 → [플레이어 | 탭] 분할
   timeupdate → currentMs → 세 탭 findActiveIndex → active 행
   행 칩 클릭 → seekTo → video.currentTime
```

## 기존 패턴 준수

- **세션 영속화 수동 복사**: `EditorSnapshot` 필드 추가 시 `snapshotFromState()` 동시 갱신(핵심 설계 1).
- **store 버전 optional 필드**: 마이그레이션 코드 없이 주석만(action-recorder `actionLogBlobKey`·issues v5→v6 전례 동일).
- **순수 헬퍼 분리 + vitest**: `timeline.ts` 테스트 우선.
- **하위호환 optional props**: 라이브 서브탭 회귀 0 — 미공급 시 기존 동작.
- **shadcn 우선**: `resizable`을 직접 스타일링 대신 컴포넌트 설치.
- **탭 동시 렌더**: 탭 콘텐츠 `data-[state=inactive]:hidden` 유지(기존).
- **i18n 동시 갱신**: log-viewer ko/en 함께.

## 대안 검토

### 대안 A — vanilla from-scratch 리포트(`buildVideoReport.ts`)
`docs/features/video-report-player/`의 원안. → **불채택.** log-viewer가 로그 렌더·필터·검색·탭·상대시간을 이미 제공하는데 vanilla로 재구현하면 수백 줄 중복 + 분류 체계 이중 관리. 영상 플레이어 한 칸 + optional 동기화 props가 훨씬 작다.

### 대안 B — 영상을 별도 파일 유지, logs.html이 상대경로 참조
→ **불채택(사용자 결정).** 단일 파일 더블클릭 자기완결성이 깨짐(상대경로 미디어는 `file://`에서 불안정). 임베드가 콘셉트 일관.

### 대안 C — 영상을 4번째 탭으로
→ **불채택(사용자 결정).** 탭이면 영상과 로그를 동시에 못 봐 동기화 가치 소멸. 가로 분할이 필수.

### 대안 D — 동기화를 위해 세 컴포넌트를 래핑하는 별도 동기화 컴포넌트 신설
→ **불채택.** optional props 추가가 더 외과적이고, 컴포넌트 내부의 가상 스크롤/필터/검색 상태를 래퍼가 다시 다룰 필요가 없다.

## 위험 요소

- **logs.html 용량 ↑ (플랫폼 첨부 한도)**: 영상 임베드로 ~15MB+. Jira(10MB) 등 초과 가능. 제출 시 logs.html 첨부 실패를 격리 — 이슈 본문·`bugshot.md`는 정상 진행. (단, 현재 제출 핸들러의 첨부 실패 격리 동작을 구현 시 재확인: 한 첨부 실패가 전체를 막지 않는지. 막는다면 best-effort 처리 추가.)
- **`recording.mp4` 폐지의 회귀**: 영상 단독 다운로드/플랫폼 인라인 프리뷰가 사라진다. 사용자 명시 결정. 제출 핸들러가 `captureFiles.video`를 참조하는 곳이 없는지 확인(없으면 무변경, 있으면 분기 제거).
- **`buildLogsHtml` 시그니처 변경**: 호출부(`buildCaptureFiles`)·테스트(`__tests__/buildLogsHtml.test.ts`) 동시 갱신. network/console/action-only(video=null) 회귀 케이스 유지.
- **WebM + Safari / `file://` 미디어 제약**: 녹화가 WebM로 떨어지거나 Safari `file://` 제약 시 영상 미재생 — `onError`로 플레이어 자리 안내 + 탭은 유지(graceful). 필수 브라우저는 Chrome/Firefox.
- **realm 시계 차감 가정**: side panel vs MAIN world 시각. 같은 시스템 시계라 안전(핵심 설계 1).
- **대용량 dataUrl JSON.parse**: ~20MB JSON 문자열 파싱 + `<video src>` 설정. Chrome/Firefox 실측 필요(스모크). 문자열 truncation·OOM 없는지 확인.
- **MAIN world 주입 무관**: SW→탭 `executeScript` 직렬화 규칙과 무관(이 기능은 안 씀).
