# 녹화 구간 자르기 — 기술 설계

## 개요

트림 파이프라인을 **소스 2종으로 일반화**한다. 지금 `replayTrim`은 `{videoBlob, frames}`로 프레임 배열을 전제하는데, 이를 판별 유니언 `TrimSource`(`frames` | `recording`)로 바꾼다. 자르기 화면(`ReplayTrimDialog`)·로그 트림(`trimByTime`)·마커(`buildErrorMarkers`)·게이트(`trimming`)·취소 경로는 이미 소스 중립이거나 벽시계(`videoStartedAt`) 기준이라 **그대로 재사용**된다.

새로 만드는 것은 두 갈래뿐이다. ① 초 구간 → 로그 trim 경계 환산의 recording 변형(프레임 인덱스 대신 `videoStartedAt` 기준 선형 매핑), ② `MediaRecorder` 블롭에서 선택 구간만 잘라 새 mp4를 만드는 인코더. ②는 `<video>`를 선택 구간만 배속 재생하며 `requestVideoFrameCallback`으로 프레임을 받아 `VideoFrame` → `VideoEncoder` → `mp4-muxer`로 직행시킨다. 새 npm 의존성 없이 기존 WebCodecs 스택(`mp4-muxer`)을 재사용하고, 중간 JPEG 왕복이 없어 메모리가 프레임 하나로 묶인다.

핵심 불변식 두 개는 그대로 유지한다: 트림 페이로드는 `phase: "drafting"` 전이와 **같은 `set()`**에 실려야 하고(POSTMORTEM 2026-07-17), 오버레이 마운트와 `DraftingPanel` 마운트는 **같은 값**(`replayTrim != null`)에서 파생돼야 한다(POSTMORTEM 2026-07-01). 녹화 경로가 이 회로에 새로 들어오므로 두 함정 모두 이번 변경의 직접 사정권이다.

## 변경 범위

### `src/sidepanel/30s-replay/trim-source.ts` — **신규**

런타임 import 0인 타입 전용 모듈. `editor-store`가 `mp4-muxer` 그래프를 끌어들이지 않게 하려고 `trim-math.ts`가 아닌 별도 파일에 둔다(store는 background 번들에 들어간다 — CLAUDE.md 참조).

- `TrimSource` 판별 유니언 정의.

### `src/store/editor-store.ts`

- 현재: `ReplayTrim = { videoBlob: Blob; frames: CapturedFrame[] }`.
- 변경: `ReplayTrim = { videoBlob: Blob; source: TrimSource }`. `CapturedFrame` 직접 import는 `trim-source.ts` import로 대체.
- **필드명 `replayTrim`·타입명 `ReplayTrim`은 유지**한다. 이름은 이제 리플레이 전용이 아니지만, `docs/POSTMORTEM.md`의 2026-07-01·2026-07-17 항목이 이 식별자를 재발방지 grep 대상으로 명시하고 있어 개명하면 소환 회로가 끊긴다. 선언부 주석에 "리플레이·일반 녹화 공용(이름은 역사적)"을 한 줄 남긴다.
- `onRecordingComplete`·`resolveReplayTrim`·`replaceVideo` 시그니처는 **불변**.

### `src/sidepanel/video-recorder.ts`

- `beginRecording`의 `recorder.onstop`: `finalizing.end(finalizeId) === "commit"`인 커밋 경로에서 트림 페이로드를 만들어 `onRecordingComplete`의 6번째 인자로 넘긴다. **길이 무관 항상** 생성한다(짧은 녹화도 자르기 화면을 띄운다).
  ```ts
  const trim = { videoBlob: blob, source: { kind: "recording", startedAt: localStartTime, endedAt: localEndedAt } };
  useEditorStore.getState().onRecordingComplete(blob, thumbnail, viewport, localStartTime, localEndedAt, trim);
  ```
  `phase: "drafting"`과 트림 게이트가 한 `set()`에 실리는 원자성이 여기서 확보된다.
- `generateThumbnail`을 `export` — 트림 결과 블롭의 썸네일 생성에 재사용한다(현재 module-private, 로직 중복 방지).

### `src/sidepanel/30s-replay/trim-math.ts`

- `isFullRangeSec(startSec, endSec, durationSec, eps?)` **추가** — 초 단위 전체 구간 판정. `isFullRange`(프레임 인덱스 기반)의 초 카운터파트.
- `recordingLogTrimBounds(startedAt, startSec, endSec, durationSec)` **추가** — 녹화용 로그 trim 경계. 전체 구간이면 `null`.
- `previewBoundsFor(source, startSec, endSec, durationSec)` **추가** — `TrimSource` 판별 후 `previewTrimBounds`(frames) 또는 `recordingLogTrimBounds`(recording)로 위임. 자르기 화면의 흐림 미리보기와 apply 경로가 **같은 함수**를 타게 해 parity를 보장한다.
- 기존 `frameOffsetsMs`/`secondsToFrameRange`/`isFullRange`/`replayLogTrimBounds`/`previewTrimBounds`/`isTrimmedOut`은 불변.

### `src/sidepanel/30s-replay/encode-range.ts` — **신규**

`MediaRecorder` 블롭의 구간 재인코딩. `<video>` 재생 + `requestVideoFrameCallback` + WebCodecs를 쓰는 **브라우저 전용** 코드라 별도 파일로 분리하고 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 등록한다(순수 헬퍼는 `trim-math.ts`에 있어 로직 분모에 남는다).

- `TRIM_REENCODE_BITRATE = 4_000_000` — 녹화 원본은 2Mbps이므로 2세대 인코딩에 2배 헤드룸을 준다. 입력이 디코딩 프레임(새 디테일 없음)이라 이 비트레이트면 양자화 손실이 시각적으로 묻힌다. `mp4-encoder.ts`의 기본값 2Mbps를 그대로 쓰면 눈에 띄게 뭉갠다.
- `encodeVideoRange(opts)` — 구간 재인코딩 본체.
- `mp4-encoder.ts`의 `pickCodec`/`CODEC_CANDIDATES`/`prepareChunkMeta`/`pickEvenDimensions`를 재사용한다(`CODEC_CANDIDATES`는 export 추가 필요).

### `src/sidepanel/30s-replay/apply-trim.ts`

- `trimStoredLogs(tabId, bounds)` **추출** — 현재 `applyReplayTrim` 안에 인라인된 network/console/action 3블록(persist discard → `trimByTime` → store set → IDB save)을 공용 헬퍼로 뺀다. 두 번째 호출자가 생기므로 발생하는 중복 제거이고, 그 외 로직은 건드리지 않는다.
- `applyRecordingTrim(opts)` **추가** — 녹화 트림 적용.
- `applyReplayTrim`은 `trimStoredLogs` 호출로 바뀌는 것 외 동작 불변.

### `src/sidepanel/tabs/ReplayTrimDialog.tsx`

- props `frames: CapturedFrame[]` → `source: TrimSource`.
- `bounds` 계산: `previewTrimBounds(frames, ...)` → `previewBoundsFor(source, startSec, endSec, duration)`.
- `handleLoadedMetadata`: `<video>.duration`이 유한하지 않거나 0이면 **소스 힌트로 폴백**한다. recording 소스는 `(endedAt − startedAt) / 1000`, frames 소스는 폴백 없음(현행 유지 — 프레임 인코딩 mp4는 항상 duration이 유효).
- `onConfirm(startSec, endSec)` → `onConfirm(startSec, endSec, durationSec)`. 화면이 실제로 쓴 duration을 넘겨야 전체 구간 판정이 화면과 apply에서 갈리지 않는다.
- 그 외(4탭·타임라인·마커·undo/redo·취소 다이얼로그·i18n 키)는 **전부 불변**. `issue.replay.trim.*` 키는 이미 소스 중립 문구("영상"·"확정"·"시작 지점"…)라 추가·수정이 없다.

### `src/sidepanel/App.tsx`

- `<ReplayTrimDialog frames={...}>` → `source={replayTrim.source}`.
- `onConfirm`에서 `source.kind`로 분기해 `applyReplayTrim` / `applyRecordingTrim`을 호출. 실패 시 토스트 + `resolveTrim()`은 현행과 동일(원본 유지한 채 작성 화면으로 진행).
- `onCancel`은 **불변** — 리플레이와 동일하게 `reset()` + pending IDB 정리.

### `src/sidepanel/30s-replay/use-30s-replay.ts`

- `capture()`의 트림 페이로드 생성만 새 형태로: `{ videoBlob: blob, source: { kind: "frames", frames } }`. `frames.length >= 2` 조건은 리플레이에만 그대로 유지한다(프레임 1개는 자를 게 없다).

### 변경하지 않는 것

`video-capture.ts`(스트림 획득·레코더 준비), `replay-context.ts`(`trimming` 신호), `IssueTab.tsx`/`DraftingPanel.tsx`(마운트 가드), `useReproPrefill.ts`, `editor-store.replaceVideo`/`resolveReplayTrim`, `log-merge.ts`, `trim-markers.ts`, i18n 사전.

## 데이터 흐름

```
[탭/화면 녹화 정지]
  video-recorder.ts recorder.onstop
    → blob(MediaRecorder mp4|webm) + thumbnail + viewport
    → onRecordingComplete(blob, thumb, viewport, startedAt, endedAt,
                          { videoBlob: blob, source: {kind:"recording", startedAt, endedAt} })
         └─ 한 set(): phase="drafting" + replayTrim=payload + reproPrefillDone=false

[App]  replayTrim != null
  ├─ ReplayTrimDialog 마운트 (오버레이)
  └─ ReplayContext.trimming=true → IssueTab이 DraftingPanel 마운트 보류

[ReplayTrimDialog]
  duration = <video>.duration (유한) ?? (endedAt-startedAt)/1000
  핸들 드래그 → previewBoundsFor(source, startSec, endSec, duration)
              → isTrimmedOut()으로 로그 탭 흐림 미리보기
  확정 → onConfirm(startSec, endSec, duration)

[App onConfirm]  source.kind === "recording"
  → applyRecordingTrim({ videoBlob, tabId, startedAt, startSec, endSec, durationSec })
       ├─ bounds = recordingLogTrimBounds(...)
       │    └─ null(전체 구간) → 즉시 return  ★재인코딩 skip★
       ├─ blob' = encodeVideoRange({ blob, startSec, endSec, bitrate: 4Mbps })
       ├─ thumb' = generateThumbnail(blob')
       ├─ trimStoredLogs(tabId, bounds)   // persist discard → trimByTime → store set → IDB save
       └─ replaceVideo(blob', thumb', startedAt+startSec*1000, startedAt+endSec*1000)
                └─ videoTrimmed=true
  → finally: setTrimBusy(false); resolveTrim()  → replayTrim=null
                                                → 오버레이 언마운트 + DraftingPanel 마운트
```

`encodeVideoRange` 내부:

```
URL.createObjectURL(blob) → <video muted playsInline>
  loadedmetadata → width/height = ceilEven(videoWidth/videoHeight)   // 원본 해상도 유지
  currentTime = startSec ; await seeked
  VideoEncoder.configure({ codec: pickCodec(...), width, height, bitrate })
  playbackRate = 4 ; play()
  requestVideoFrameCallback loop:
     mediaTime > endSec → 종료
     이전 프레임을 (mediaTime - prevMediaTime) duration으로 encode   // 1프레임 lookahead
     watchdog: 3000ms 동안 콜백 없으면 abort
  마지막 프레임 encode(직전 duration 재사용) → flush → muxer.finalize()
  finally: pause / src="" / revokeObjectURL / encoder.close()
```

## 인터페이스 설계

```ts
// src/sidepanel/30s-replay/trim-source.ts  (신규 · 런타임 import 0)
import type { CapturedFrame } from "./frame-buffer";

// 트림 대상 영상의 시간축 출처. frames=30s Replay(프레임 배열), recording=탭/화면 녹화(벽시계 선형).
export type TrimSource =
  | { kind: "frames"; frames: CapturedFrame[] }
  | { kind: "recording"; startedAt: number; endedAt: number };
```

```ts
// src/store/editor-store.ts  (변경)
import type { TrimSource } from "@/sidepanel/30s-replay/trim-source";

export interface ReplayTrim {
  videoBlob: Blob;
  source: TrimSource;
}
```

```ts
// src/sidepanel/30s-replay/trim-math.ts  (추가)

// 초 단위 전체 구간 판정 — isFullRange(프레임 인덱스)의 카운터파트. eps는 핸들 스냅 오차 흡수.
export function isFullRangeSec(
  startSec: number,
  endSec: number,
  durationSec: number,
  eps?: number,           // 기본 0.05
): boolean;

// 녹화용 로그 trim 경계. 전체 구간이면 null(=잘림 없음).
// 안 자른 쪽은 경계를 두지 않는다 — 녹화 시작 시 로그를 clear하므로 하한이 불필요하고,
// 상한 없음은 replayLogTrimBounds의 outIndex===last 규칙과 같다.
export function recordingLogTrimBounds(
  startedAt: number,
  startSec: number,
  endSec: number,
  durationSec: number,
): ReplayLogBounds | null;

// 소스 판별 후 위임 — 흐림 미리보기와 apply가 같은 경계를 보게 하는 단일 출처.
export function previewBoundsFor(
  source: TrimSource,
  startSec: number,
  endSec: number,
  durationSec: number,
): ReplayLogBounds | null;
```

```ts
// src/sidepanel/30s-replay/encode-range.ts  (신규 · 브라우저 전용)

// 2세대 인코딩 헤드룸 — 녹화 원본(2Mbps)의 2배. 낮추면 자르기만 했는데 화질이 떨어진다.
export const TRIM_REENCODE_BITRATE = 4_000_000;

// MediaRecorder 블롭의 [startSec, endSec] 구간을 재생 기반으로 재인코딩해 mp4로 반환.
// 해상도·프레임레이트는 원본 유지(다운스케일 없음). 실패 시 throw — 호출자가 원본을 유지한다.
export async function encodeVideoRange(opts: {
  blob: Blob;
  startSec: number;
  endSec: number;
  playbackRate?: number;   // 기본 4
  bitrate?: number;        // 기본 TRIM_REENCODE_BITRATE
  stallTimeoutMs?: number; // 기본 3000 — rVFC 정체 감시
}): Promise<Blob>;
```

```ts
// src/sidepanel/30s-replay/apply-trim.ts  (추가)

// 녹화 트리밍 적용: 선택 구간 재인코딩 → 영상 메타 교체 + 로그 재trim.
// 전체 구간이면 아무것도 하지 않는다(재인코딩 skip · videoTrimmed는 false 유지).
export async function applyRecordingTrim(opts: {
  videoBlob: Blob;
  tabId: number;
  startedAt: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}): Promise<void>;
```

```ts
// src/sidepanel/tabs/ReplayTrimDialog.tsx  (변경)
interface ReplayTrimDialogProps {
  videoBlob: Blob;
  source: TrimSource;                                             // was: frames
  onConfirm: (startSec: number, endSec: number, durationSec: number) => void;  // was: (start, end)
  onCancel: () => void;
  busy?: boolean;
}
```

```ts
// src/sidepanel/video-recorder.ts  (변경)
export async function generateThumbnail(blob: Blob): Promise<string>;  // was: module-private
```

## 기존 패턴 준수

- **트림 게이트 원자성** (ARCHITECTURE.md "트리밍", POSTMORTEM 2026-07-17): 트림 페이로드는 `phase: "drafting"` 전이와 **같은 `set()`**에 실려야 한다. 녹화 경로도 `onRecordingComplete`의 `trim` 인자로만 전달하고, 별도 setter를 새로 만들지 않는다.
- **오버레이/패널 단일 게이트** (POSTMORTEM 2026-07-01): 오버레이 마운트(App)와 `DraftingPanel` 마운트 보류(IssueTab)는 둘 다 `replayTrim != null`에서 파생된다 — 이 파생 관계를 건드리지 않는다.
- **"흐림 = 실제 잘림" parity**: 미리보기와 apply가 같은 경계 함수(`previewBoundsFor` → `recordingLogTrimBounds`)를 공유한다. 리플레이가 `previewTrimBounds`/`replayLogTrimBounds`로 지키던 규칙을 그대로 옮긴다.
- **store 번들 격리** (CLAUDE.md): `TrimSource`를 `trim-math.ts`가 아닌 런타임 import 0짜리 `trim-source.ts`에 두어 `editor-store`가 `mp4-muxer` 그래프를 끌어들이지 않게 한다.
- **커버리지 스코프** (CLAUDE.md): 유닛 불가능한 새 런타임 파일(`encode-range.ts`)을 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 등록한다. 순수 헬퍼는 `trim-math.ts`에 남겨 로직 분모에 유지한다.
- **테스트 우선** (CLAUDE.md): 새 순수 함수 3개(`isFullRangeSec`·`recordingLogTrimBounds`·`previewBoundsFor`)는 `/tdd interface`로 테스트를 먼저 박고 구현한다.
- **외과적 변경**: `replayTrim` 개명, 자르기 화면 UI 개선, `apply-trim` 전면 리팩터를 하지 않는다. `trimStoredLogs` 추출은 두 번째 호출자가 생겨 발생한 중복만 제거하는 것으로 한정한다.

## 대안 검토

**A. 무손실 remux (mp4box.js로 디먹싱 후 구간 샘플만 재muxing)** — 화질 손실 0, 재생 대기도 없다. 기각 이유: ① 새 npm 의존성 ② 컷 시작점이 키프레임에 스냅돼 자르기 정밀도가 떨어진다(MediaRecorder 키프레임 간격은 제어 불가) ③ webm 폴백 컨테이너를 별도 경로로 처리해야 한다. 2세대 손실은 비트레이트 상향(2Mbps→4Mbps)으로 시각적으로 묻히는 반면, 위 세 비용은 영구적이다. 하이브리드(mp4는 remux, webm은 재인코딩)는 경로가 두 배로 늘어 회귀면이 가장 크다.

**B. `MediaRecorder` 재녹화(`video.captureStream()`)** — 코드가 가장 짧고 컨테이너·코덱이 유지된다. 기각 이유: 배속을 못 써서 **1배속 실시간 고정** — 60초 구간이면 60초를 기다린다. 인코딩 파라미터 제어도 약해 2세대 손실이 오히려 더 크다.

**C. 프레임을 JPEG로 뽑아 `CapturedFrame[]`을 만든 뒤 기존 `encodeToMp4` 재사용** — 리플레이 경로와 코드가 완전히 합쳐진다. 기각 이유: 60초×12fps = 720장의 JPEG 블롭을 메모리에 들고 있어야 하고(70~140MB), JPEG 왕복이 3세대 손실을 추가한다. `VideoFrame` 직행이 메모리·화질 양쪽에서 낫다.

**D. 영상은 그대로 두고 로그만 좁히기 + 재생 구간 메타 저장** — 재인코딩 0, 즉시. 기각 이유: 첨부되는 영상이 원본 전체라 "잘랐다"는 기대와 어긋나고, 가이드의 "선택한 구간만 남도록 영상이 다시 만들어집니다" 문구와도 충돌한다.

**E. 자르기를 작성 화면의 수동 버튼으로 제공** — 기존 녹화 플로우 무변경, 여러 번 재진입 가능. 기각 이유: 리플레이와 진입 방식이 갈려 학습해야 할 규칙이 하나 늘고, 원본 블롭을 작성 내내 들고 있어야 한다. 자동 진입이 "정지 직후 사용자가 아직 맥락을 쥐고 있는 순간"에 맞다.

**F. `replayTrim` → `videoTrim` 개명** — 이름이 실제 범위와 맞는다. 기각 이유: `docs/POSTMORTEM.md`의 2026-07-01·2026-07-17 항목이 이 식별자를 재발방지 grep 대상으로 못박고 있어, 개명하면 회고 소환 회로가 조용히 끊긴다. 회고는 append-only 이력이라 소급 수정도 부적절하다. 주석 한 줄로 대신한다.

## 위험 요소

**1. 배속 재생 중 프레임 드롭 (중)** — `requestVideoFrameCallback`은 **표시된** 프레임에만 발화한다. `playbackRate = 4`면 12fps 소스가 48fps로 표시되므로 60Hz 화면에서는 대체로 전부 전달되지만, 사이드패널이 가려지거나 시스템이 바쁘면 컴포지터가 프레임을 떨어뜨린다. 결과 영상은 timestamp를 `mediaTime`에서 가져오므로 **길이·동기는 유지되고 프레임만 성겨진다**(끊겨 보임). 정체(3초간 콜백 없음)는 watchdog으로 잡아 실패 처리한다. 배속 값은 상수 하나(`playbackRate` 기본 4)로 두어 수동 검증 후 조정 가능하게 한다.

**2. 벽시계 ↔ 미디어 타임 드리프트 (저·수용)** — recording 소스의 로그 경계는 `videoStartedAt + sec*1000`이라는 선형 매핑을 쓴다. `MediaRecorder`의 미디어 타임라인은 첫 프레임에서 시작하고 드롭 프레임만큼 벽시계와 어긋날 수 있다(수백 ms 수준). 다만 **로그 뷰어의 영상-로그 동기화(`syncBaseMs={videoStartedAt}`)가 이미 같은 가정 위에 서 있어** 새 불일치를 만들지는 않는다. 경계 근처 로그 1~2건이 반대편으로 넘어갈 수 있음을 수용한다.

**3. webm 폴백의 `duration === Infinity` (중)** — `MediaRecorder`가 만든 webm은 헤더에 duration이 없어 `<video>.duration`이 `Infinity`가 된다. 현재 `handleLoadedMetadata`는 `Number.isFinite` 가드로 duration을 0에 방치하고, 그러면 확정 버튼이 영구 `disabled`가 돼 **막다른 길**이 된다. Chrome은 mp4를 지원해 실사용은 mp4 경로지만, 폴백 브라우저를 위해 벽시계 힌트 폴백을 반드시 넣는다. 같은 이유로 webm에서는 `currentTime` 시킹도 불안정할 수 있어, 재인코딩 실패 시 원본 유지 경로가 실질적 안전망이 된다.

**4. 재현 단계 자동 채움 회귀 (중)** — 녹화 경로가 처음으로 `trimming` 왕복(`DraftingPanel` 언마운트→재마운트)을 타게 된다. `useReproPrefill`의 `runRef` 인수인계는 **같은 컴포넌트 인스턴스** 전제라, 트림 게이트가 `phase="drafting"`보다 **늦게** 닫히는 렌더가 한 번이라도 새면 영구 미발화가 된다(POSTMORTEM 2026-07-17). 트림 페이로드를 `onRecordingComplete` 인자로만 넘기는 설계가 이걸 막지만, 구현 시 `video-recorder.ts`에서 별도 setter를 추가하지 않았는지 반드시 확인한다.

**5. 흰 화면 회귀 (중)** — 녹화 경로도 이제 `ReplayTrimDialog`(lazy)와 `DraftingPanel`의 `LazyTiptapEditor`(lazy) 동시 마운트 후보가 된다(POSTMORTEM 2026-07-01). 두 마운트가 같은 `replayTrim != null`에서 파생되는 현행 구조를 유지하는 한 안전하다 — 게이트를 새로 만들지 않는 것이 방어선이다.

**6. 재인코딩 실패 시 녹화 유실 (중)** — 최대 60초짜리 녹화를 잃으면 피해가 크다. `applyRecordingTrim` 실패는 반드시 **원본을 유지한 채** 작성 화면으로 진행해야 한다(`replaceVideo`를 부르기 전에 던지므로 store는 원본 그대로). App의 `.catch(toast) .finally(resolveTrim)` 현행 구조가 이미 그 형태다 — 바꾸지 않는다.

**7. 대기 시간 체감 (저)** — 60초 구간이면 4배속에서 ~15초. 기존 busy 스피너만 쓰기로 했으므로 그동안 진행 표시가 없다. 자르는 구간이 짧을수록 짧아지므로(자를 이유가 있으면 대개 구간이 짧다) 실사용 체감은 이보다 작다.

**8. `pickCodec` 실패 (저)** — 원본 해상도를 유지하면 화면 녹화 1920×1080에서 `VideoEncoder.isConfigSupported`가 기존 후보 목록으로 통과하는지 확인이 필요하다. `CODEC_CANDIDATES`의 레벨(`avc1.42003D` = level 6.1 등)은 1080p를 커버하지만 실기 확인 대상이다. 전부 실패하면 `pickCodec`이 throw → 위 6번 경로(원본 유지)로 떨어진다.

**9. 극단적으로 좁은 선택 구간 (저)** — `TrimTimeline`은 `step={0.1}` + `minStepsBetweenThumbs={1}`이라 **0.1초 구간까지 선택 가능**하다(리플레이와 공유하는 기존 동작). 12fps 소스에서 0.1초면 프레임이 1개 이하일 수 있다. `encodeVideoRange`는 프레임 0개면 throw하고 위 6번 경로(원본 유지 + 실패 토스트)로 떨어진다. 슬라이더에 최소 구간을 새로 강제하지 않는다 — 리플레이와 UI 동작을 갈라놓지 않기 위해서다.
