# 녹화 구간 자르기 — 기술 설계

## 개요

트림 파이프라인을 **소스 2종으로 일반화**한다. 지금 `replayTrim`은 `{videoBlob, frames}`로 프레임 배열을 전제하는데, 이를 판별 유니언 `TrimSource`(`frames` | `recording`)로 바꾼다. 자르기 화면(`ReplayTrimDialog`)·로그 트림(`trimByTime`)·마커(`buildErrorMarkers`)·게이트(`trimming`)·취소 경로는 이미 소스 중립이거나 벽시계(`videoStartedAt`) 기준이라 **대부분 그대로 재사용**된다.

새로 만드는 것은 두 갈래다. ① 초 구간 → 로그 trim 경계 환산의 recording 변형(프레임 인덱스 대신 `videoStartedAt` 기준 선형 매핑), ② `MediaRecorder` 블롭에서 선택 구간만 잘라 새 mp4를 만드는 인코더. ②는 `<video>`를 선택 구간만 배속 재생하며 `requestVideoFrameCallback`으로 프레임을 받아 `VideoFrame` → `VideoEncoder` → `mp4-muxer`로 직행시킨다. 새 npm 의존성 없이 기존 WebCodecs 스택을 재사용하고, 중간 JPEG 왕복이 없어 메모리가 프레임 하나로 묶인다.

### 시간축 규칙 — 벽시계 단일 기준

recording 소스의 **타임라인 축과 로그 경계는 전부 벽시계**(`wallDurationSec = (endedAt − startedAt) / 1000`)를 쓴다. `<video>.duration`은 타임라인의 근거가 아니다.

이유는 두 가지다. ① `MediaRecorder`는 damage 기반 가변 프레임레이트라(`maxFrameRate: 12`는 상한) 정지 화면이 길면 **미디어 길이가 벽시계 경과보다 크게 짧아진다**. 미디어 길이를 축으로 삼으면 끝 핸들을 조금만 당겨도 뒤쪽 로그가 통째로 삭제된다. ② webm 폴백은 `duration === Infinity`이고, 손상 블롭이면 `loadedmetadata`가 아예 발화하지 않는다. 벽시계는 두 경우 모두 항상 알고 있다.

미디어 길이가 유한할 때만 스칼라 하나로 환산한다:

```
mediaScale = Number.isFinite(video.duration) && video.duration > 0
           ? video.duration / wallDurationSec
           : 1
```

- 로그 경계·`replaceVideo` 메타: `startedAt + wallSec * 1000` (환산 없음)
- 미리보기 seek·재생 헤드: `mediaSec = wallSec * mediaScale`
- `encodeVideoRange` 입력: 미디어 타임(`wallSec * mediaScale`) — `<video>.currentTime`을 다루므로

frames 소스는 현행 그대로다(프레임 인코딩 mp4는 duration이 항상 유효).

### 핵심 불변식

두 개를 그대로 유지한다: 트림 페이로드는 `phase: "drafting"` 전이와 **같은 `set()`**에 실려야 하고(POSTMORTEM 2026-07-17), 오버레이 마운트와 `DraftingPanel` 마운트는 **같은 값**(`replayTrim != null`)에서 파생돼야 한다(POSTMORTEM 2026-07-01). 녹화 경로가 이 회로에 새로 들어오므로 두 함정 모두 이번 변경의 직접 사정권이다.

## 변경 범위

### `src/sidepanel/30s-replay/trim-source.ts` — **신규**

런타임 import 0인 타입 전용 모듈.

- `TrimSource` 판별 유니언 정의.
- **분리 근거**: `editor-store`가 `mp4-muxer`/`mp4-encoder` 그래프를 끌어들이지 않게 하는 **구조적 표식**이다. (정정: `editor-store`는 background 번들에 들어가지 **않는다** — `src/background/` 전체에서 import 0건이고 빌드 산출물도 사이드패널 청크에만 있다. CLAUDE.md의 "이 스토어가 background 번들에 들어가므로"는 `settings-ui-store` 얘기다. 다만 `trim-math.ts`는 `mp4-encoder`를 **value import**하므로, 타입을 거기 두면 누군가 `import type`을 빠뜨렸을 때 무거운 그래프가 store로 유입된다. 파일 분리는 그 실수를 구조로 막는 것이지 현존하는 번들 위험을 고치는 게 아니다.)

### `src/store/editor-store.ts`

- 현재: `ReplayTrim = { videoBlob: Blob; frames: CapturedFrame[] }`.
- 변경: `ReplayTrim = { videoBlob: Blob; source: TrimSource; ownerTabId: number }`. `CapturedFrame` 직접 import는 `trim-source.ts` `import type`으로 대체.
  - `ownerTabId` — 자르기 화면이 떠 있는 동안 브라우저 탭을 전환하면 `hydrate`가 merge라 오버레이는 남고 `tabId`만 바뀐다. 그대로 확정하면 **다른 탭의 로그를 자른다**. 확정 전 `ownerTabId !== tabId`면 막는다.
- **필드명 `replayTrim`·타입명 `ReplayTrim`은 유지**한다. 이름은 이제 리플레이 전용이 아니다. (개명 기각 사유는 아래 대안 F 참조.)
- `editor-store.ts:154-158`의 기존 4줄 주석(두 회고 소환 + "frames는 30초치 이미지라 비영속")을 새 페이로드 기준으로 **보강**한다 — `frames` 대신 `source`, "리플레이·일반 녹화 공용(이름은 역사적)", 비영속의 결과(패널 문서 소멸 시 트림 단계 스킵)를 한 줄씩.
- `onRecordingComplete`·`resolveReplayTrim`·`replaceVideo` 시그니처는 **불변**.

### `src/sidepanel/video-recorder.ts`

- `recorder.onstop`: **기존 `if (finalizing.end(finalizeId) === "discard") return;` 조기 리턴 뒤**에서 트림 페이로드를 만든다. (`createFinalizeGuard().end(id)`는 호출 즉시 창을 소비하므로 `=== "commit"` 체크를 *추가*하면 두 번째 `end()`가 항상 `"discard"`를 반환해 **모든 녹화가 폐기된다**. 조건문을 새로 넣지 않는다.)
  ```ts
  // discard 조기 리턴 뒤
  await syncAndSettleLogs(tabId);            // 아래 참조
  const trim = {
    videoBlob: blob,
    source: { kind: "recording", startedAt: localStartTime, endedAt: localEndedAt },
    ownerTabId: tabId,
  };
  useEditorStore.getState().onRecordingComplete(blob, thumbnail, viewport, localStartTime, localEndedAt, trim);
  ```
  **길이 무관 항상** 생성한다. `phase: "drafting"`과 트림 게이트가 한 `set()`에 실리는 원자성이 여기서 확보된다. `onRecordingComplete` 호출부는 파일 내 1곳뿐이고 탭/화면 녹화가 `beginRecording` 공통 본문을 타므로 배선은 이 한 지점이다.
- **로그 settle 추가**: `stopRecording()`은 현재 `void stopNetworkRecorder(...)` fire-and-forget이라 정지 직전 로그 꼬리가 `drafting` 동결에 걸려 드롭될 수 있다. 리플레이(`use-30s-replay.ts:167`)와 동일하게 `syncAndSettleLogs(tabId)`(`@/sidepanel/picker-control`)를 `onRecordingComplete` **전에** await한다. 자르기 화면이 로그를 표·마커로 보여주게 되므로 지금까지 조용했던 누락이 눈에 보이는 결함이 된다.
- `generateThumbnail`을 **`src/sidepanel/lib/video-thumbnail.ts`(신규)로 이동**하고 `video-recorder.ts`는 거기서 import한다. 트림 결과 블롭의 썸네일 생성에 재사용하는데, `apply-trim.ts`(로직 스코프·유닛 테스트 대상)가 `video-recorder.ts`(브라우저 바인딩, `picker-control`·`annotation-control`을 끌고 온다)를 정적 import하면 테스트 그래프가 오염된다.

### `src/sidepanel/30s-replay/trim-math.ts`

- `isFullRangeSec(startSec, endSec, durationSec, eps?)` **추가** — 초 단위 전체 구간 판정. `isFullRange`(프레임 인덱스 기반)의 초 카운터파트.
- `recordingLogTrimBounds(startedAt, startSec, endSec, durationSec)` **추가** — 녹화용 로그 trim 경계. 전체 구간이면 `null`.
- `previewBoundsFor(source, range, opts)` **추가** — `TrimSource` 판별 후 `previewTrimBounds`(frames) 또는 `recordingLogTrimBounds`(recording)로 위임. 자르기 화면의 흐림 미리보기와 apply 경로가 **같은 함수**를 타게 해 parity를 보장한다.
- `pickTrimBitrate(byteSize, durationSec)` **추가** — 원본 실측 기반 적응 비트레이트(순수 함수라 여기 둔다).
- 기존 `frameOffsetsMs`/`secondsToFrameRange`/`isFullRange`/`replayLogTrimBounds`/`previewTrimBounds`/`isTrimmedOut`은 불변.

### `src/sidepanel/30s-replay/encode-range.ts` — **신규**

`MediaRecorder` 블롭의 구간 재인코딩. `<video>` 재생 + `requestVideoFrameCallback` + WebCodecs를 쓰는 **브라우저 전용** 코드라 별도 파일로 분리하고 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 등록한다. (순수 헬퍼는 `trim-math.ts`에 있어 로직 분모에 남는다. 참고: 같은 WebCodecs 의존인 `mp4-encoder.ts`는 미등록인데, 그건 순수 헬퍼 5개가 실제로 유닛 테스트되고 있어서다. `encode-range.ts`는 테스트 가능한 순수 부분을 `trim-math.ts`로 빼고 나면 남는 게 전부 미디어 I/O라 등록이 맞다 — `30s-replay/`의 첫 등록 사례다.)

- `encodeVideoRange(opts)` — 구간 재인코딩 본체.
- `mp4-encoder.ts`에서 `pickCodec`/`CODEC_CANDIDATES`/`prepareChunkMeta`/`ceilEven`/`createMp4Sink`를 재사용한다. **`CODEC_CANDIDATES`와 `ceilEven`은 현재 module-private라 export 추가가 필요**하다. `pickEvenDimensions`는 `maxWidth`가 **required 3번째 인자**라 "원본 해상도 유지(clamp 없음)"와 충돌하므로 쓰지 않고 `ceilEven`을 직접 쓴다.

### `src/sidepanel/30s-replay/mp4-encoder.ts`

- `CODEC_CANDIDATES`·`ceilEven` **export 추가**.
- `createMp4Sink({ width, height, codec, bitrate })` **추출** — `Muxer` 생성 + `encoderError` 래치 + `VideoEncoder.configure` + `flush`/`finalize`/Blob 생성(현재 `mp4-encoder.ts:147-166, 198-207`)은 `encodeToMp4`가 프레임 배열 전용 단일 함수라 그대로는 재사용할 수 없다. 이 배선 ~30줄을 복제하지 않고 작은 팩토리로 뽑아 양쪽이 공유한다. `encodeToMp4`는 이 팩토리를 쓰도록 바꾸되 **동작은 불변**.
- muxer 옵션에 `firstTimestampBehavior`를 명시하지 않는 현행을 유지하되, `encodeVideoRange`는 timestamp를 0-base로 정규화해 넣는다(아래 🔴 참조).

### `src/sidepanel/30s-replay/apply-trim.ts`

- `trimStoredLogs(tabId, bounds): Promise<unknown>[]` **추출** — 현재 `applyReplayTrim` 안에 인라인된 preamble(`discard()` ×3)과 network/console/action 3블록(`trimByTime` → store set → save push)을 공용 헬퍼로 뺀다.
  - **동기 함수이고 `saves` 배열을 반환한다.** `await Promise.allSettled(saves)`는 호출자에 남긴다 — 현재 코드는 store set 3개 **직후**에 `replaceVideo`를 부르고 그 **뒤**에 IDB 정착을 await하며, 주석이 "로그 set과 함께 인메모리 상태를 원자적으로 맞춘다"고 못박고 있다. 헬퍼가 `allSettled`까지 삼키면 리플레이 경로에서 `replaceVideo`가 IDB 왕복 뒤로 밀려 "로그는 잘렸는데 영상은 원본"인 상태가 렌더에 노출된다.
  - 3블록은 동형이 아니다(network는 `requests` + `r.startTime`, console/action은 `entries` + `e.timestamp`). 제네릭 하나로 접지 말고 헬퍼 안에 3블록을 그대로 옮긴다.
- `applyRecordingTrim(opts)` **추가** — 녹화 트림 적용.
- `applyReplayTrim`은 `trimStoredLogs` 호출 + `await Promise.allSettled(saves)` 위치 유지 외 **동작 불변**.
- **IDB save 실패 시 원본 로그 부활** — `allSettled`는 best-effort다. 리플레이는 `use-30s-replay.ts:170-172`가 `discard()` 후 trim본만 저장해 IDB에 원본이 없지만, 녹화는 `drafting` 전이 `flushNow()`로 **원본 전체가 `pending:${tabId}`에 이미 박혀 있다**. save가 실패하고 패널을 다시 열면 hydrate가 원본을 복원해 "잘린 영상 + 안 잘린 로그"가 된다. 3개 중 하나라도 rejected면 실패 토스트를 띄운다(영상 교체는 되돌리지 않는다 — 로그가 넓은 쪽이 데이터 손실보다 낫다).

### `src/sidepanel/tabs/ReplayTrimDialog.tsx`

- props `frames: CapturedFrame[]` → `source: TrimSource`. `progress?: number` 추가.
- `duration` **초기값**을 `useState`로 소스 힌트에서 받는다 — recording은 `(endedAt − startedAt) / 1000`, frames는 현행대로 0. `handleLoadedMetadata`가 아니라 마운트 시점에 확정되므로 `loadedmetadata`가 발화하지 않아도 타임라인·확정 버튼이 살아 있다.
- `handleLoadedMetadata`는 이제 recording 소스에서 **`mediaScale` 계산만** 한다(축은 벽시계 고정). frames 소스는 현행대로 `<video>.duration`으로 `duration`을 세운다.
- `bounds` 계산: `previewTrimBounds(frames, ...)` → `previewBoundsFor(source, {startSec, endSec}, {durationSec: duration, maxFrameDurationMs: MAX_FRAME_DURATION_MS})`. **`useMemo` deps에 `duration`을 추가**한다(현재 deps는 `[frames, startSec, endSec]`이고 4번째 인자가 상수라 없었다).
- `onConfirm(startSec, endSec)` → `onConfirm(startSec, endSec, durationSec)`. 화면이 실제로 쓴 duration을 넘겨야 전체 구간 판정이 화면과 apply에서 갈리지 않는다.
- 확정 핸들러에서 **`videoRef.current?.pause()`를 선행**한다. 현재 일시정지는 로그 탭 전환 시에만 일어나, 영상 탭에서 재생 중 확정하면 미리보기 1080p 디코드와 `encodeVideoRange`의 4배속 디코드가 같은 블롭을 두고 경쟁해 정체 watchdog을 유발한다.
- **busy 영역에 진행률 표시 추가** — 확정 버튼 스피너만으로는 최대 15초 동안 400px 패널 전체가 얼어붙은 채 16px 스피너 하나만 도는 상태가 된다. `progress`(0~1)를 받아 `Progress` 바 + "영상 자르는 중 · 탭을 유지해 주세요" 문구를 노출한다. 인코딩 중 취소는 제공하지 않는다(비목표).
- **오버레이 ARIA** — `<div className="fixed inset-0 z-50 bg-background">`에 `role="dialog"` + `aria-modal="true"` + `aria-label`을 추가한다. 버튼은 아이콘 전용을 유지한다(비목표: UI 구조 변경 없음).
- 그 외(4탭·타임라인·마커·undo/redo·구간 readout·`data-testid`)는 **불변**.

### i18n (`src/i18n/namespaces/issue.ts`, ko/en 동시)

design 초안의 "i18n 추가·수정이 없다"는 **틀렸다**. `issue.replay.trim.*` 14개 키는 소스 중립이 맞지만 그 밖에서 3건이 걸린다.

- **취소 확인 문구 신규** — 현재 `editor.cancelConfirm.*`("작성을 취소할까요? / 작성 중인 내용이 모두 초기화됩니다")를 공유하는데, 이 시점에 작성한 내용은 없고 실제로 잃는 건 방금 찍은 녹화다. `issue.replay.trim.cancelConfirm.{title,body}`를 새로 만든다.
- **실패 토스트 문구 수정** — `issue.replay.encodeFailed` = "영상 생성에 실패했습니다. **다시 시도하세요.**"인데 재시도 경로가 비목표로 제외돼 있어 오안내다. "구간 자르기에 실패했습니다. 원본 영상이 그대로 첨부됩니다." 로 바꾼다(또는 트림 전용 키 신설).
- **진행률 문구 신규** — 위 다이얼로그 변경분("영상 자르는 중 · 탭을 유지해 주세요").

log-viewer 복제 사전(`src/log-viewer/i18n.ts`)은 `issue.replay.*`를 쓰지 않으므로 영향 없다.

### `src/sidepanel/App.tsx`

- `<ReplayTrimDialog frames={...}>` → `source={replayTrim.source}` + `progress={trimProgress}`.
- `onConfirm`에서 **`replayTrim.ownerTabId !== tabId`면 확정을 막고** 안내 토스트 후 `resolveTrim()`(원본 유지 진행).
- `source.kind`로 분기해 `applyReplayTrim` / `applyRecordingTrim`을 호출. `applyRecordingTrim`에 `onProgress`를 넘겨 `trimProgress` state를 갱신.
- 실패 시 토스트 + `.finally(setTrimBusy(false) + resolveTrim())`은 **현행 구조 유지**(원본 유지한 채 작성 화면으로 진행).
- `onCancel`은 **불변** — 리플레이와 동일하게 `reset()` + pending IDB 정리.

### `src/sidepanel/30s-replay/use-30s-replay.ts`

- `capture()`의 트림 페이로드를 `{ videoBlob: blob, source: { kind: "frames", frames }, ownerTabId: id }`로. `frames.length >= 2` 조건은 리플레이에만 그대로 유지한다(프레임 1개는 자를 게 없다).

### 변경하지 않는 것

`video-capture.ts`(스트림 획득·레코더 준비), `replay-context.ts`(`trimming` 신호), `IssueTab.tsx`/`DraftingPanel.tsx`(마운트 가드), `useReproPrefill.ts`, `editor-store.replaceVideo`/`resolveReplayTrim`, `log-merge.ts`, `trim-markers.ts`, `TrimTimeline`의 `step`/`minStepsBetweenThumbs`.

## 데이터 흐름

```
[탭/화면 녹화 정지]
  video-recorder.ts recorder.onstop
    → if (finalizing.end(finalizeId) === "discard") return;   // 기존 가드 — 조건 추가 금지
    → await syncAndSettleLogs(tabId)                          // 로그 꼬리 정착
    → blob(MediaRecorder mp4|webm) + thumbnail + viewport
    → onRecordingComplete(blob, thumb, viewport, startedAt, endedAt,
        { videoBlob: blob, source: {kind:"recording", startedAt, endedAt}, ownerTabId: tabId })
         └─ 한 set(): phase="drafting" + replayTrim=payload + reproPrefillDone=false

[App]  replayTrim != null
  ├─ ReplayTrimDialog 마운트 (오버레이)
  └─ ReplayContext.trimming=true → IssueTab이 DraftingPanel 마운트 보류

[ReplayTrimDialog]
  duration = useState(recording ? (endedAt-startedAt)/1000 : 0)   // ★ 마운트 시 확정
  loadedmetadata → mediaScale = finite(video.duration) ? video.duration/duration : 1
  핸들 드래그 → previewBoundsFor(source, {startSec,endSec}, {durationSec, maxFrameDurationMs})
              → isTrimmedOut()으로 로그 탭 흐림 미리보기
  확정 → video.pause() → onConfirm(startSec, endSec, duration)

[App onConfirm]
  ownerTabId !== tabId → 안내 토스트 + resolveTrim()   ★엉뚱한 탭 로그 보호★
  source.kind === "recording"
  → applyRecordingTrim({ videoBlob, tabId, startedAt, startSec, endSec,
                         durationSec, mediaScale, onProgress })
       ├─ bounds = recordingLogTrimBounds(startedAt, startSec, endSec, durationSec)
       │    └─ null(전체 구간) → 즉시 return  ★재인코딩 skip★
       ├─ blob' = encodeVideoRange({ blob,
       │            startSec: startSec*mediaScale, endSec: endSec*mediaScale,
       │            bitrate: pickTrimBitrate(blob.size, durationSec), onProgress })
       ├─ thumb' = generateThumbnail(blob')
       ├─ saves  = trimStoredLogs(tabId, bounds)   // discard → trimByTime → store set (동기)
       ├─ replaceVideo(blob', thumb', startedAt+startSec*1000, startedAt+endSec*1000)
       │       └─ videoTrimmed=true          ★로그 set과 원자적 — 사이에 await 금지★
       └─ await Promise.allSettled(saves) → rejected 있으면 경고 토스트
  → finally: setTrimBusy(false); resolveTrim()  → replayTrim=null
                                                → 오버레이 언마운트 + DraftingPanel 마운트
```

`encodeVideoRange` 내부:

```
URL.createObjectURL(blob) → <video muted playsInline>
  loadedmetadata (타임아웃 10s) → width/height = ceilEven(videoWidth/videoHeight)   // 원본 해상도 유지
  currentTime = startSec ; await seeked (타임아웃 10s)
  sink = createMp4Sink({ width, height, codec: pickCodec(w,h), bitrate })
  playbackRate = 4 ; play()
  requestVideoFrameCallback loop:
     mediaTime > endSec → 종료
     onProgress((mediaTime - startSec) / (endSec - startSec))
     이전 프레임을 (mediaTime - prevMediaTime) duration으로 encode   // 1프레임 lookahead
       · timestamp = (prevMediaTime - startSec)  ★0-base 정규화 + 음수 clamp★
       · frame.codedWidth/Height ≠ config → config 크기로 스케일해 인코딩  ★mid-stream 리사이즈★
       · KEYFRAME_INTERVAL(30)마다 { keyFrame: true }
       · encoder.encodeQueueSize > N 이면 dequeue 대기            ★backpressure★
     watchdog: stallTimeoutMs 동안 콜백 없으면 abort
       · document.hidden 동안은 watchdog 정지 — visibilitychange로 타이머 리셋
  마지막 프레임 encode(직전 duration 재사용) → flush → muxer.finalize()
  finally: pending VideoFrame.close() / video.pause() / src="" / revokeObjectURL / encoder.close()
```

### 🔴 timestamp 0-base 정규화 (필수)

`mp4-muxer`의 `firstTimestampBehavior` 기본값은 `'strict'`이고, 첫 청크의 timestamp가 0이 아니면 `must have a timestamp of 0 (received DTS=...)`로 throw한다. `mediaTime`을 그대로 쓰면 **`startSec > 0`인 모든 케이스가 실패해 기능이 항상 원본 유지 경로로 떨어진다.** `mediaTime - startSec`로 정규화하고, seek 후 첫 프레임의 PTS가 `startSec`보다 살짝 작을 수 있으므로 **음수를 0으로 clamp**한다. (기존 `encodeToMp4`가 `let timestampUs = 0`으로 시작해 이 함정을 우회하고 있다.)

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
  ownerTabId: number;   // 탭 전환 후 확정으로 엉뚱한 탭 로그를 자르는 것을 막는다
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

// 녹화용 로그 trim 경계(벽시계 ms). 전체 구간이면 null(=잘림 없음).
// ReplayLogBounds.lower는 필수 number라 "하한 없음"은 Number.NEGATIVE_INFINITY로 표현한다
// (isTrimmedOut의 `absTs < lower`, trimByTime 모두와 수학적으로 호환).
// 상한 없음은 undefined — replayLogTrimBounds의 outIndex===last 규칙과 동일.
//
// 가드밴드 비대칭(의도): replayLogTrimBounds는 앞을 안 자를 때 REPLAY_LOG_GUARD_MS(1500)를
// 빼는데, 이는 프레임 타임스탬프의 양자화(프레임 간격)를 흡수하려는 것이다. recording은
// 벽시계 연속축이라 양자화가 없어 가드밴드를 두지 않는다.
export function recordingLogTrimBounds(
  startedAt: number,
  startSec: number,
  endSec: number,
  durationSec: number,
): ReplayLogBounds | null;

// 소스 판별 후 위임 — 흐림 미리보기와 apply가 같은 경계를 보게 하는 단일 출처.
// range/opts를 객체로 받는다: 위치 인자 4개가 전부 number면 frames의 maxFrameDurationMs와
// recording의 durationSec이 뒤바뀌어도 컴파일이 통과한다.
export function previewBoundsFor(
  source: TrimSource,
  range: { startSec: number; endSec: number },
  opts: { durationSec: number; maxFrameDurationMs: number },
): ReplayLogBounds | null;

// 재인코딩 비트레이트 — 원본 실측 기반 적응.
// 녹화 상한은 2Mbps지만 video-recorder.ts:67-69 주석대로 저모션은 quality-bound라 실측은
// 훨씬 낮다. 4Mbps 고정이면 3MB/60s 녹화를 40s로 자를 때 20MB(7배)가 된다.
//   observed = byteSize * 8 / durationSec
//   return clamp(observed * 1.5, 800_000, 4_000_000)
export function pickTrimBitrate(byteSize: number, durationSec: number): number;
```

```ts
// src/sidepanel/30s-replay/encode-range.ts  (신규 · 브라우저 전용)

// MediaRecorder 블롭의 [startSec, endSec] **미디어 타임** 구간을 재생 기반으로 재인코딩해 mp4로 반환.
// 해상도·프레임레이트는 원본 유지(다운스케일 없음). 실패 시 throw — 호출자가 원본을 유지한다.
export async function encodeVideoRange(opts: {
  blob: Blob;
  startSec: number;         // 미디어 타임 (호출자가 mediaScale 환산 후 전달)
  endSec: number;           // 미디어 타임
  bitrate: number;          // pickTrimBitrate 결과
  playbackRate?: number;    // 기본 4
  stallTimeoutMs?: number;  // 기본 3000 — rVFC 정체 감시. document.hidden 동안 정지
  metadataTimeoutMs?: number; // 기본 10000 — loadedmetadata/seeked가 영영 안 올 때
  onProgress?: (ratio: number) => void;
}): Promise<Blob>;
```

```ts
// src/sidepanel/30s-replay/mp4-encoder.ts  (export 추가 + 팩토리 추출)
export const CODEC_CANDIDATES: string[];              // was: module-private
export function ceilEven(n: number): number;          // was: module-private

// Muxer 생성 + encoderError 래치 + configure + flush/finalize/Blob 배선(~30줄) 공유.
export function createMp4Sink(opts: {
  width: number; height: number; codec: string; bitrate: number;
}): {
  encoder: VideoEncoder;
  encode(frame: VideoFrame, opts: { durationUs: number; timestampUs: number; keyFrame: boolean }): void;
  finish(): Promise<Blob>;
};
```

```ts
// src/sidepanel/30s-replay/apply-trim.ts  (추가)

// 로그 3종 trim의 공용 부분. **동기**이고 IDB save Promise 배열을 반환한다 —
// await는 호출자가 replaceVideo **뒤에** 한다(로그 set ↔ replaceVideo 원자성 보존).
export function trimStoredLogs(tabId: number, bounds: ReplayLogBounds): Promise<unknown>[];

// 녹화 트리밍 적용: 선택 구간 재인코딩 → 영상 메타 교체 + 로그 재trim.
// 전체 구간이면 아무것도 하지 않는다(재인코딩 skip · videoTrimmed는 false 유지).
// 인코딩/썸네일 단계에서 throw되면 replaceVideo 전이라 store는 원본 그대로 남는다.
export async function applyRecordingTrim(opts: {
  videoBlob: Blob;
  tabId: number;
  startedAt: number;
  startSec: number;        // 벽시계 초
  endSec: number;          // 벽시계 초
  durationSec: number;     // 벽시계 길이
  mediaScale: number;      // 벽시계 초 → 미디어 초 환산 계수 (기본 1)
  onProgress?: (ratio: number) => void;
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
  progress?: number;                                              // 0~1, 인코딩 진행률
}
```

```ts
// src/sidepanel/lib/video-thumbnail.ts  (신규 · video-recorder.ts에서 이동)
export async function generateThumbnail(blob: Blob): Promise<string>;
```

## 기존 패턴 준수

- **트림 게이트 원자성** (ARCHITECTURE.md "트리밍", POSTMORTEM 2026-07-17): 트림 페이로드는 `phase: "drafting"` 전이와 **같은 `set()`**에 실려야 한다. 녹화 경로도 `onRecordingComplete`의 `trim` 인자로만 전달하고, 별도 setter를 새로 만들지 않는다. (2026-07-17 재발방지 (6)에 따라, 회고를 참조하는 주석을 쓰면 push 전 그 항목의 존재를 grep으로 확인한다.)
- **오버레이/패널 단일 게이트** (POSTMORTEM 2026-07-01): 오버레이 마운트(App)와 `DraftingPanel` 마운트 보류(IssueTab)는 둘 다 `replayTrim != null`에서 파생된다 — 이 파생 관계를 건드리지 않는다.
- **"흐림 = 실제 잘림" parity**: 미리보기와 apply가 같은 경계 함수(`previewBoundsFor` → `recordingLogTrimBounds`)를 공유한다.
- **store 그래프 격리**: `TrimSource`를 런타임 import 0짜리 `trim-source.ts`에 두고 `import type`으로 받는다(근거는 위 "변경 범위" 참조 — 현존 위험이 아니라 실수 방지용 구조).
- **커버리지 스코프** (CLAUDE.md): `encode-range.ts`·`lib/video-thumbnail.ts`를 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 등록한다. 순수 헬퍼(`isFullRangeSec`·`recordingLogTrimBounds`·`previewBoundsFor`·`pickTrimBitrate`)는 `trim-math.ts`에 남겨 로직 분모에 유지한다.
- **테스트 우선** (CLAUDE.md): 새 순수 함수 4개는 `/tdd interface`로 테스트를 먼저 박고 구현한다.
- **i18n ko/en 동시 갱신**: 새 키·수정 키는 양쪽을 같은 커밋에서. PostToolUse 훅이 `locales.test.ts`로 대칭을 검사한다.
- **외과적 변경**: `replayTrim` 개명, 자르기 화면 UI 구조 개편, `apply-trim` 전면 리팩터를 하지 않는다. `trimStoredLogs`·`createMp4Sink` 추출은 두 번째 호출자가 생겨 발생한 중복만 제거하는 것으로 한정한다.

## 분석 지표

`videoTrimmed`의 유일한 소비처는 `SubmitFieldsDialog` → `track-submit.ts`의 `replay_trimmed` 프로퍼티다. 녹화 경로가 이 플래그를 켜기 시작하면 기존 시계열의 의미가 "리플레이 전용" → "영상 전체"로 소급 없이 바뀐다. `trim_source: "frames" | "recording"` 프로퍼티를 함께 보내 구분 가능하게 한다(익명 집계 범위 내라 privacy 영향 없음).

## 대안 검토

**A. 무손실 remux (mp4box.js로 디먹싱 후 구간 샘플만 재muxing)** — 화질 손실 0, 재생 대기도 없고 **파일이 커지지 않는다**. 기각 이유: ① 새 npm 의존성 ② 컷 시작점이 키프레임에 스냅돼 자르기 정밀도가 떨어진다(MediaRecorder 키프레임 간격은 제어 불가) ③ webm 폴백 컨테이너를 별도 경로로 처리해야 한다. 하이브리드(mp4는 remux, webm은 재인코딩)는 경로가 두 배로 늘어 회귀면이 가장 크다.

**B. `MediaRecorder` 재녹화(`video.captureStream()`)** — 코드가 가장 짧고 컨테이너·코덱이 유지된다. 기각 이유: 배속을 못 써서 **1배속 실시간 고정** — 60초 구간이면 60초를 기다린다. 인코딩 파라미터 제어도 약해 2세대 손실이 오히려 더 크다.

**C. 프레임을 JPEG로 뽑아 `CapturedFrame[]`을 만든 뒤 기존 `encodeToMp4` 재사용** — 리플레이 경로와 코드가 완전히 합쳐진다. 기각 이유: 60초×12fps = 720장의 JPEG 블롭을 메모리에 들고 있어야 하고(70~140MB), JPEG 왕복이 3세대 손실을 추가한다. `VideoFrame` 직행이 메모리·화질 양쪽에서 낫다.

**D. 영상은 그대로 두고 로그만 좁히기 + 재생 구간 메타 저장** — 재인코딩 0, 즉시, 화질 손실 0, **파일 크기 증가도 없다**. 기각 이유: 첨부되는 영상이 원본 전체라 "잘랐다"는 기대와 어긋나고, 가이드의 "선택한 구간만 남도록 영상이 다시 만들어집니다" 문구와도 충돌한다. 리포트를 받는 사람이 여전히 60초를 봐야 한다는 게 결정적이다.

**E. 자르기를 작성 화면의 수동 버튼으로 제공** — 기존 녹화 플로우 무변경, 여러 번 재진입 가능. 기각 이유: 리플레이와 진입 방식이 갈려 학습해야 할 규칙이 하나 늘고, 원본 블롭을 작성 내내 들고 있어야 한다. 자동 진입이 "정지 직후 사용자가 아직 맥락을 쥐고 있는 순간"에 맞다.

**F. `replayTrim` → `videoTrim` 개명** — 이름이 실제 범위와 맞는다. 기각 이유: `docs/POSTMORTEM.md`의 2026-07-01·2026-07-17 항목이 이 식별자를 **코드 앵커로 인용**하고 있어(`302:310`, `518:526`) 개명하면 회고에서 코드로 가는 연결이 조용히 끊긴다. (정정: `replayTrim`은 두 항목의 재발방지 grep *패턴*은 아니다 — 그건 `lazy(`·`.storage.`·`useEditorStore.getState()` 등이다. 앵커 연결 유지라는 근거만으로도 개명을 미룰 이유는 충분하지만, 근거를 과장하지 않는다.) 회고는 append-only 이력이라 소급 수정도 부적절하다. 주석 보강으로 대신한다.

**G. `VideoDecoder`로 디먹싱 후 디코딩(재생 비의존)** — 이 설계 최대의 취약점인 "`<video>` 재생 의존"(탭 hidden 시 정지, 컴포지터 프레임 드롭, 미리보기와의 디코더 경쟁)을 구조적으로 없애는 유일한 경로다. 기각 이유: `EncodedVideoChunk`를 만들려면 컨테이너 디먹싱이 필요하고 그건 새 의존성(mp4box.js)이다 — 제약 "새 npm 의존성 없음"과 정면 충돌. **재생 의존을 감수한다**는 것을 명시적 결정으로 남긴다. 진행률·이탈 방지 안내·hidden 중 watchdog 정지가 그 결정에 딸린 완화책이다.

## 위험 요소

**1. 인코딩 중 탭 전환 → rVFC 완전 정지 (고)** — 사이드패널은 탭 스코프라 탭을 이동하면 패널이 hidden이 되거나 문서가 destroy된다(`tab-bindings.ts` 주석이 destroy 보장 불가를 명시). hidden이면 `requestVideoFrameCallback`이 **아예 발화하지 않는다** — 프레임이 성겨지는 게 아니라 완전 정지다. 60초 구간이면 4배속에서 ~15초 대기라 사용자가 머물 유인이 없다.
- 완화 ①: 진행률 바 + "탭을 유지해 주세요" 문구로 이탈 억제.
- 완화 ②: `visibilitychange`로 hidden 동안 정체 watchdog을 멈추고 복귀 시 리셋 — 다녀와도 인코딩이 이어진다.
- 문서 destroy 경로는 `replayTrim` 비영속 때문에 **트림 단계가 흔적 없이 스킵**되고 원본이 붙은 작성 화면에 착지한다. 수용된 한계로 두고 PRD에 명시했다.

**2. 배속 재생 중 프레임 드롭 (중)** — hidden이 아니어도 컴포지터가 프레임을 떨어뜨릴 수 있다. 결과 영상은 timestamp를 `mediaTime`에서 가져오므로 **길이·동기는 유지되고 프레임만 성겨진다**. `playbackRate` 기본 4를 상수로 두어 수동 검증 후 조정 가능하게 한다. 확정 시 미리보기 `<video>`를 pause해 디코더 경쟁을 없애는 것도 여기에 딸린 완화다.

**3. 벽시계 ↔ 미디어 타임 드리프트 (중)** — `MediaRecorder`는 damage 기반 가변 프레임레이트라 정지 화면이 길면 미디어 길이가 벽시계 경과보다 **크게** 짧아진다(수백 ms가 아니라 수십 %). 이번 설계는 축을 벽시계로 통일해 **로그 경계는 이 드리프트에 영향받지 않게** 했고, 미디어 타임은 `mediaScale` 환산으로 seek·인코딩 입력에만 쓴다. 잔여: `mediaScale`이 구간별로 균일하지 않으면 재생 헤드와 실제 화면이 국소적으로 어긋날 수 있다(수용).

**4. webm 폴백 / 메타데이터 로드 실패 (해소)** — 초안의 "`duration === Infinity`면 확정 버튼이 영구 disabled가 되는 막다른 길"은 `duration` 초기값을 벽시계 힌트로 두는 것으로 **구조적으로 사라진다**. `loadedmetadata`가 아예 오지 않아도 타임라인·확정이 살아 있고, 미리보기 재생만 안 된다. 잔여: 시킹이 불안정한 webm에서 인코딩이 실패할 수 있으나 원본 유지 경로가 받는다.

**5. 재현 단계 자동 채움 (중)** — 녹화 경로가 처음으로 `trimming` 왕복(`DraftingPanel` 언마운트→재마운트)을 타게 된다. 트림 페이로드를 `onRecordingComplete` 인자로만 넘기는 설계가 POSTMORTEM 2026-07-17의 레인 분리를 막는다 — 구현 시 별도 setter를 추가하지 않았는지 반드시 확인한다. 별개로 `useReproPrefill`은 `actionLog.captured > 0` 가드라 **트림 결과 액션 로그가 0건이면 미발화가 정상 동작**이다(PRD 성공 기준에 반영). 검증 시 액션이 남는 구간으로 확정해야 오탐하지 않는다.

**6. 흰 화면 (중)** — 녹화 경로도 이제 `ReplayTrimDialog`(lazy)와 `DraftingPanel`의 `LazyTiptapEditor`(lazy) 동시 마운트 후보가 된다(POSTMORTEM 2026-07-01). 두 마운트가 같은 `replayTrim != null`에서 파생되는 현행 구조를 유지하는 한 안전하다 — 게이트를 새로 만들지 않는 것이 방어선이다. (별개 잔여: 저장소에 `ErrorBoundary`가 없어 lazy 청크 로드 자체가 reject하면 트리가 언마운트된다. 기존 문제지만 노출이 리플레이 사용자 → 전 녹화로 확대된다.)

**7. 재인코딩 실패 시 녹화 유실 (중)** — 최대 60초짜리 녹화를 잃으면 피해가 크다. `applyRecordingTrim` 실패는 반드시 **원본을 유지한 채** 작성 화면으로 진행해야 한다(`replaceVideo`를 부르기 전에 던지므로 store는 원본 그대로). App의 `.catch(toast) .finally(resolveTrim)` 현행 구조가 이미 그 형태다 — 바꾸지 않는다. 토스트 문구도 "원본이 그대로 첨부된다"를 알리도록 고친다.

**8. IDB save 실패로 원본 로그 부활 (중)** — 녹화는 `drafting` 전이 `flushNow()`로 원본 로그가 이미 `pending:${tabId}`에 있어, trim본 save가 실패하면 재오픈 시 hydrate가 원본을 복원한다("잘린 영상 + 안 잘린 로그"). `allSettled` 결과에 rejected가 있으면 경고 토스트로 노출한다.

**9. mid-stream 해상도 변경 (중)** — `video-mime.ts:3-7`이 avc3를 우선하도록 이미 방어 중인 실존 시나리오(창 리사이즈·모니터 전환)다. 그런데 `CODEC_CANDIDATES`는 전부 avc1이고 `VideoEncoder.configure`는 1회다. rVFC 루프에서 `frame.codedWidth/Height`가 config와 다르면 config 크기로 스케일해 인코딩한다(레터박스 없이 stretch — 드문 경로라 단순함 우선).

**10. 대기 시간 체감 (중→저)** — 60초 구간이면 4배속에서 ~15초. 진행률 바 도입으로 완화한다. 자르는 구간이 짧을수록 짧아지므로(자를 이유가 있으면 대개 구간이 짧다) 실사용 체감은 이보다 작다. 인코딩 중 취소는 제공하지 않는다(비목표) — watchdog이 최악의 정체를 잡고 실패해도 원본을 잃지 않는다.

**11. `pickCodec` 실패 (저)** — 원본 해상도를 유지하면 화면 녹화 1920×1080에서 `VideoEncoder.isConfigSupported`가 기존 후보 목록으로 통과하는지 확인이 필요하다. `CODEC_CANDIDATES`의 레벨(`avc1.42003D` = level 6.1 등)은 1080p를 커버하지만 실기 확인 대상이다. 전부 실패하면 `pickCodec`이 throw → 7번 경로(원본 유지)로 떨어진다.

**12. 인코더 backpressure (중)** — 기존 `encodeToMp4`는 `await createImageBitmap`이 자연 스로틀이었지만, rVFC 콜백에서 동기적으로 밀어 넣는 새 경로는 1080p@48fps 인풋이다. 하드웨어 인코더가 없는 환경에서 `encodeQueueSize`와 `VideoFrame` 메모리가 선형 증가한다. 큐 길이 임계에서 대기한다.

**13. `VideoFrame` 누수 (중)** — 1프레임 lookahead 구조라 항상 보류 프레임 1개가 있다. watchdog abort·조기 종료·throw 어느 경로로 나가도 `finally`에서 close해야 한다(기존 `mp4-encoder.ts`가 중첩 `finally`로 지키는 규율).

**14. seek 품질 (저)** — 결과 영상은 log-viewer `LogSeekChip`으로 행↔영상 양방향 seek에 쓰이므로 GOP를 브라우저 기본에 맡기면 안 된다. 기존 `KEYFRAME_INTERVAL = 30`을 그대로 적용한다.

**15. 극단적으로 좁은 선택 구간 (저)** — `TrimTimeline`은 `step={0.1}` + `minStepsBetweenThumbs={1}`이라 0.1초 구간까지 선택 가능하다(리플레이와 공유하는 기존 동작). 12fps 소스에서 0.1초면 프레임이 1개 이하일 수 있다. `encodeVideoRange`는 프레임 0개면 throw하고 7번 경로로 떨어진다. 슬라이더에 최소 구간을 새로 강제하지 않는다.

**16. 60초 스케일의 타임라인 정밀도·마커 밀도 (중·수용)** — 트랙 실폭 ~284px에서 60초는 1px≈2스텝이라 드래그로 도달 불가한 값이 생기고, 마커 핀(16px)이 3.4초를 덮는데 `TimelineMarkers`에 충돌 회피가 없어 겹친 핀은 클릭할 수 없다. 구간 readout(`"{sel}s / {total}s"`)도 남긴 길이만 알려주고 **그게 60초 중 어디인지는 안 알려준다**. 리플레이 UI와 갈라놓지 않기 위해 전부 수용한다 — 60초 사용 실측 후 별도 작업으로 다룬다.

**17. 자르기 화면 중 로그 드래그 성능 (저)** — `bounds` useMemo가 드래그 프레임마다 재계산되고 모든 로그 행이 리렌더된다. cap이 network 5000 / console 2000이라 로그 많은 SPA의 60초 녹화는 30초 리플레이에서 안 드러나던 규모가 된다. 수동 검증 항목으로 둔다.
