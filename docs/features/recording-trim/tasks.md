# 녹화 구간 자르기 — 구현 태스크

## 선행 조건

- **권한·env·의존성 변경 없음.** 새 npm 패키지 없고 `manifest.config.ts`·OAuth env·`docs/privacy.*` 트리거에 해당하지 않는다(새 캡처·수집·전송 동작이 아니라 이미 만든 영상의 로컬 재인코딩).
- 착수 전 `docs/POSTMORTEM.md`에서 **2026-07-01**(두 lazy 청크 동시 마운트 → 흰 화면)과 **2026-07-17**(트림 게이트 레인 분리 → 재현 단계 영구 미발화) 두 항목을 읽는다. 이번 변경이 녹화 경로를 그 회로에 새로 편입시킨다.
- `docs/ARCHITECTURE.md` "30s Replay > 트리밍" 절이 현행 설계의 단일 출처다(단 `onRecordingComplete`를 5-arg로 서술한 stale이 있다 — Task 9에서 정정).
- **i18n 키를 건드리므로 ko/en을 항상 같은 커밋에서 갱신**한다. `src/i18n/` 저장 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행한다.
- 수동 검증은 `pnpm build` 후 Chrome에 `dist`를 로드해야 한다(dist stale 주의).

### typecheck 게이트 주의

`ReplayTrim` 타입 변경으로 컴파일 에러가 나는 지점은 **3파일 6사이트**다:

| 파일 | 사이트 | 해소 태스크 |
|---|---|---|
| `src/store/__tests__/editor-store.test.ts` | `:182-190`(헬퍼) `:250` `:263` `:274` | Task 1 |
| `src/sidepanel/30s-replay/use-30s-replay.ts` | `:197` | Task 2 |
| `src/sidepanel/App.tsx` | `:456`(`frames={replayTrim.frames}`) `:459` | **Task 8** |

`tsconfig.app.json`이 `include: ["src"]`라 테스트도 typecheck 대상이다. `ReplayTrimDialog.tsx`는 props가 `frames: CapturedFrame[]`이라 `ReplayTrim`을 참조하지 않으므로 Task 1로는 에러가 나지 않고, Task 7을 먼저 하면 App 쪽 에러가 오히려 **늘어난다**.

따라서 **`pnpm typecheck` 전체 통과는 Task 8 완료 후에만 가능**하다. Task 1~7의 게이트는 "해당 태스크가 만든 새 에러가 없다"(에러 목록이 위 표에서 줄어들기만 한다)와 `pnpm test`다.

---

## 태스크

### Task 1: `TrimSource` 타입 + store 페이로드 일반화

- **변경 대상**: `src/sidepanel/30s-replay/trim-source.ts`(신규), `src/store/editor-store.ts`, `src/store/__tests__/editor-store.test.ts`
- **작업 내용**:
  - `trim-source.ts`에 `TrimSource` 판별 유니언을 정의한다. **런타임 import 0** — `CapturedFrame`만 `import type`으로 받는다.
  - `editor-store.ts`의 `ReplayTrim`을 `{ videoBlob: Blob; source: TrimSource; ownerTabId: number }`로 바꾼다. `CapturedFrame` import는 `TrimSource` `import type`으로 교체.
  - `editor-store.ts:154-158`의 **기존 4줄 주석을 보강**한다(신규 한 줄 추가가 아니다) — `frames` → `source`, "리플레이·일반 녹화 공용(이름은 역사적)", 비영속의 결과(패널 문서 소멸 시 트림 단계 스킵). 회고를 참조하는 문장을 쓰면 POSTMORTEM 2026-07-17 재발방지 (6)에 따라 push 전 그 항목의 존재를 grep으로 확인한다.
  - `onRecordingComplete`·`resolveReplayTrim`·`replaceVideo` 시그니처는 건드리지 않는다.
  - `editor-store.test.ts`의 `replayTrim()` 헬퍼(`:182-190`)를 새 페이로드 형태로 갱신한다.
- **검증**:
  - [x] `rg -n "mp4|muxer" src/store/editor-store.ts` 결과 0 (타입 포함 새 import 없음)
  - [x] `src/store/__tests__/editor-store.test.ts`의 `"전이 원자성"`(`:242`)·`"reset이 replayTrim까지 청소한다"`(`:260`)·`"resolveReplayTrim이 게이트를 내린다"`(`:271`) 3개가 새 페이로드로 갱신되고 통과
  - [x] `:232` `it("trim 인자 생략(탭/화면 녹화)이면 replayTrim은 null이다")` — Task 8 이후 이 서술이 **거짓**이 되므로 케이스 이름을 "trim 인자를 생략하면 replayTrim은 null이다"로 바꾸고, 녹화 경로가 항상 인자를 넘긴다는 사실을 주석으로 남긴다
  - [x] `pnpm test` — `src/store/__tests__/` green
  - [x] `pnpm typecheck` 에러가 위 표의 Task 2·8 사이트 3곳으로만 남는다

### Task 2: 리플레이 경로를 새 페이로드로 이행 (동작 무변경)

- **변경 대상**: `src/sidepanel/30s-replay/use-30s-replay.ts`
- **작업 내용**: `capture()`의 트림 페이로드를 `{ videoBlob: blob, source: { kind: "frames", frames }, ownerTabId: id }`로 바꾼다. `frames.length >= 2` 조건은 그대로 유지(리플레이 한정).
- **검증**:
  - [x] `pnpm test` — `src/sidepanel/30s-replay/__tests__/` 전체 green
  - [x] `pnpm typecheck` 에러가 `App.tsx` 2곳만 남는다
  - [ ] 수동(Task 9 이후): 30s 리플레이 캡처 → 자르기 화면 진입·확정·취소가 **변경 전과 동일**

### Task 3: 초 단위 트림 경계 + 적응 비트레이트 순수 함수 (**TDD 선행**)

- **변경 대상**: `src/sidepanel/30s-replay/trim-math.ts`, `src/sidepanel/30s-replay/__tests__/trim-math.test.ts`
- **작업 내용**: `/tdd interface`로 **테스트를 먼저** 작성한 뒤 구현한다.
  - `isFullRangeSec(startSec, endSec, durationSec, eps = 0.05)`
  - `recordingLogTrimBounds(startedAt, startSec, endSec, durationSec)` — 전체 구간이면 `null`.
    - **`ReplayLogBounds.lower`는 필수 `number`**(`trim-math.ts:63`)이므로 "하한 없음"은 `Number.NEGATIVE_INFINITY`로 표현한다. `upper`도 `number | undefined`인 **required union**이라 키를 생략하면 컴파일 실패 — `upper: undefined`를 명시한다.
    - **가드밴드를 적용하지 않는다.** `replayLogTrimBounds`의 `REPLAY_LOG_GUARD_MS`(1500)는 프레임 타임스탬프 양자화 흡수용이고, recording은 벽시계 연속축이라 불필요하다. 이 비대칭을 함수 주석에 남긴다.
  - `previewBoundsFor(source, {startSec, endSec}, {durationSec, maxFrameDurationMs})` — `source.kind`로 `previewTrimBounds` / `recordingLogTrimBounds` 위임. **위치 인자 4개를 전부 `number`로 두지 않는다**(frames의 `maxFrameDurationMs`와 recording의 `durationSec`이 뒤바뀌어도 컴파일이 통과한다).
  - `pickTrimBitrate(byteSize, durationSec)` — `clamp(byteSize * 8 / durationSec * 1.5, 800_000, 4_000_000)`
- **검증**:
  - [x] `isFullRangeSec`: 전체 구간 true / 앞만 자름 false / 뒤만 자름 false / eps 안쪽 미세 오차(0.03초) true / eps 밖(0.2초) false
  - [x] `recordingLogTrimBounds`: 전체 구간 → `null` / 앞만 자름 → `lower = startedAt + startSec*1000`, `upper === undefined` / 뒤만 자름 → `lower === Number.NEGATIVE_INFINITY`, `upper = startedAt + endSec*1000` / 양쪽 → 둘 다 유한값
  - [x] `recordingLogTrimBounds` 결과를 `isTrimmedOut`에 먹였을 때 경계값(정확히 `lower`·`upper`)이 **잘리지 않는다**(inclusive — `trimByTime`과 동일). `lower === -Infinity`인 결과도 어떤 timestamp도 자르지 않는다
  - [x] `previewBoundsFor`: `kind:"frames"`는 `previewTrimBounds(frames, s, e, maxFrameDurationMs)`와 동일 결과 / `kind:"recording"`은 `recordingLogTrimBounds`와 동일 결과
  - [x] `pickTrimBitrate`: 저모션(3MB/60s → 하한 800k 근처) / 고모션(15MB/60s → 실측×1.5) / 상한 초과 입력 → 4Mbps로 clamp / `durationSec === 0` 방어
  - [x] `pnpm test` green

### Task 4: `mp4-encoder` 공유 지점 추출

- **변경 대상**: `src/sidepanel/30s-replay/mp4-encoder.ts`
- **작업 내용**:
  - `CODEC_CANDIDATES`(`:4-10`)·`ceilEven`(`:34`) **export 추가** — 둘 다 현재 module-private다. (`pickEvenDimensions`(`:39`)는 `maxWidth`가 **required 3번째 인자**라 "원본 해상도 유지"와 충돌하므로 `encode-range`에서는 쓰지 않는다.)
  - `createMp4Sink({ width, height, codec, bitrate })` **추출** — `Muxer` 생성 + `encoderError` 래치 + `VideoEncoder.configure` + `flush`/`finalize`/Blob 생성(`:147-166`, `:198-207`)을 팩토리로 뽑는다. `encodeToMp4`가 이걸 쓰도록 바꾸되 **동작 불변**.
- **검증**:
  - [x] `pnpm test` — 기존 `mp4-encoder` 관련 테스트 전부 green(추출이 동작을 바꾸지 않았다는 증거)
  - [x] `createMp4Sink`가 `firstTimestampBehavior`를 설정하지 않는 현행을 유지한다(0-base 정규화는 호출자 책임)

### Task 5: 구간 재인코딩 (`encodeVideoRange`)

- **변경 대상**: `src/sidepanel/30s-replay/encode-range.ts`(신규), `scripts/coverage-report.mjs`
- **작업 내용**: 설계 문서의 "데이터 흐름 > `encodeVideoRange` 내부" 순서를 그대로 따른다.
  - **🔴 timestamp 0-base 정규화 필수**: `mp4-muxer`의 `firstTimestampBehavior` 기본값이 `'strict'`라 첫 청크 timestamp가 0이 아니면 throw한다. `timestampUs = max(0, (mediaTime - startSec) * 1e6)`. 이걸 빼먹으면 **앞을 자른 모든 케이스가 실패**한다.
  - 해상도는 `ceilEven(video.videoWidth/videoHeight)` — **clamp 없음**(원본 유지).
  - 1프레임 lookahead로 각 프레임 duration을 산출(마지막 프레임은 직전 duration 재사용) — `computeFrameDurationsUs`의 의미론과 일치시킨다.
  - `KEYFRAME_INTERVAL`(30)마다 `{ keyFrame: true }` — 결과 영상이 log-viewer `LogSeekChip`의 양방향 seek 대상이라 GOP를 브라우저 기본에 맡기지 않는다.
  - **backpressure**: `encoder.encodeQueueSize`가 임계를 넘으면 `dequeue` 이벤트를 기다린다. rVFC 콜백에서 동기적으로 밀어 넣는 구조라 1080p@48fps 인풋에서 큐·`VideoFrame` 메모리가 선형 증가한다.
  - **mid-stream 리사이즈 방어**: `frame.codedWidth/codedHeight`가 configure 크기와 다르면 config 크기로 스케일해 인코딩한다(`video-mime.ts:3-7`이 avc3 우선으로 이미 방어 중인 실존 시나리오).
  - **watchdog**: `stallTimeoutMs`(기본 3000) 동안 rVFC 콜백이 없으면 abort. 단 **`document.hidden` 동안은 타이머를 멈추고 `visibilitychange`로 리셋**한다 — hidden이면 rVFC가 성겨지는 게 아니라 완전히 멈추므로 그대로 두면 탭 전환 = 확정 실패다.
  - `loadedmetadata`·`seeked`에도 타임아웃(`metadataTimeoutMs`, 기본 10000)을 건다. 손상 블롭이면 Promise가 영구 pending이 되어 objectURL·busy 스피너가 남는다.
  - `onProgress((mediaTime - startSec) / (endSec - startSec))`를 매 콜백에서 호출.
  - `finally`에서 **보류 중인 `VideoFrame.close()`** / `video.pause()` / `src=""` / `URL.revokeObjectURL` / `encoder.close()`를 반드시 정리한다(lookahead라 항상 보류 프레임 1개가 있다).
  - `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 `src/sidepanel/30s-replay/encode-range.ts`를 등록한다. 이건 `30s-replay/`의 **첫 등록 사례**다(같은 WebCodecs 의존인 `mp4-encoder.ts`는 순수 헬퍼가 실제로 테스트되고 있어 미등록) — 등록 사유를 한 줄 주석으로 남긴다.
  - **구현 중 정정된 것**(자체 검증에서 드러난 사항 — 위 지시보다 이쪽이 최종이다):
    - 0-base 기준은 `startSec`이 아니라 **실제로 인코딩한 첫 프레임의 `mediaTime`**이다. seek이 표시한 프레임을 놓치면 첫 `mediaTime`이 `startSec`보다 커져 `max(0, ...)` clamp가 무력하고 muxer strict가 throw한다.
    - mid-stream 리사이즈에 `visibleRect` 오버라이드를 쓰지 않는다 — `codedWidth/Height`는 매크로블록 패딩 때문에 정상 상황에서도 config와 다르고, `displayWidth/Height`는 리샘플링하지 않는다. `VideoEncoder`가 config 크기로 스케일하므로 timestamp/duration만 갈아끼운 클론을 넘긴다.
    - watchdog은 "프레임 도착"이 아니라 **`video.currentTime` 진행**을 감시한다. MediaRecorder는 damage 기반이라 정지 화면의 긴 프레임 간격이 정상이고, `drain()` 대기 중에도 재생은 흐른다.
    - hidden 동안 watchdog만 재우면 `<video>`가 계속 재생돼 구간을 건너뛴다 — `visibilitychange`로 **재생 자체를 pause/resume**한다.
    - 프레임 duration에 **상한을 두지 않는다**(정지 화면 구간이 압축돼 결과가 선택 구간보다 짧아진다). hidden 폭주는 위 pause가 원인 단계에서 막는다.
    - `startSec === 0`이면 `currentTime` 재대입이 `seeked`를 안 낼 수 있어 seek을 건너뛴다.
- **검증**:
  - [x] `pnpm coverage:report` — 로직 스코프 분모에 `encode-range.ts`가 **포함되지 않는다**
  - [x] 코드 확인: 첫 청크 timestamp가 0이다(`rg -n "timestampUs" src/sidepanel/30s-replay/encode-range.ts`로 0-base 계산 존재 확인)
  - [ ] 수동(Task 8 이후 통합 확인): 자른 영상의 재생 길이가 선택 구간과 일치(±1프레임), 해상도가 원본과 동일, 재생 중 깨짐 없음

### Task 6: 썸네일 헬퍼 분리 + 로그 트림 추출 + `applyRecordingTrim`

- **변경 대상**: `src/sidepanel/lib/video-thumbnail.ts`(신규), `src/sidepanel/video-recorder.ts`, `src/sidepanel/30s-replay/apply-trim.ts`, `scripts/coverage-report.mjs`
- **작업 내용**:
  - `generateThumbnail`을 `video-recorder.ts`에서 `src/sidepanel/lib/video-thumbnail.ts`로 **이동**하고 `video-recorder.ts`가 거기서 import한다. `BROWSER_BOUND_EXACT`에 등록.
    - 이유: `apply-trim.ts`(로직 스코프·유닛 테스트 대상)가 `video-recorder.ts`를 정적 import하면 `picker-control`·`annotation-control`·`lib/video-mime`까지 테스트 그래프에 딸려 온다. `apply-trim.test.ts`의 현재 mock은 3개뿐(`@/store/blob-db`·`usePickerMessages`·`@/store/editor-store`)이다.
  - `applyReplayTrim` 안의 preamble(`discard()` ×3)과 network/console/action 3블록을 `trimStoredLogs(tabId, bounds)`로 추출한다.
    - **동기 함수, `Promise<unknown>[]`(saves) 반환.** `await Promise.allSettled(saves)`는 호출자에 남긴다.
    - 현재 순서 `set*Log ×3 → replaceVideo → await allSettled`를 **그대로 보존**한다. 주석이 "로그 set과 함께 인메모리 상태를 원자적으로 맞춘다"고 못박고 있어, 헬퍼가 `allSettled`를 삼키면 `replaceVideo`가 IDB 왕복 뒤로 밀려 "로그는 잘렸는데 영상은 원본"인 상태가 렌더에 노출된다.
    - 3블록은 **동형이 아니다**(network는 `requests` + `r.startTime`, console/action은 `entries` + `e.timestamp`). 제네릭 하나로 접지 말고 그대로 옮긴다.
  - `applyRecordingTrim(opts)` 구현:
    1. `bounds = recordingLogTrimBounds(startedAt, startSec, endSec, durationSec)` — `null`이면 **즉시 return**(재인코딩·로그 재trim·`replaceVideo` 전부 없음)
    2. `blob' = await encodeVideoRange({ blob, startSec: startSec*mediaScale, endSec: endSec*mediaScale, bitrate: pickTrimBitrate(blob.size, durationSec), onProgress })`
    3. `thumb' = await generateThumbnail(blob')`
    4. `saves = trimStoredLogs(tabId, bounds)` (동기)
    5. `replaceVideo(blob', thumb', startedAt + startSec*1000, startedAt + endSec*1000)`
    6. `await Promise.allSettled(saves)` — rejected가 하나라도 있으면 호출자가 경고할 수 있게 알린다(throw하지 않는다 — 영상 교체는 이미 끝났다)
  - 2~3단계에서 throw되면 `replaceVideo` 전이므로 store는 원본 그대로 남는다 — **이 순서를 바꾸지 않는다**.
- **검증**:
  - [x] `pnpm test` — 기존 `apply-trim.test.ts` 전부 green
  - [x] **순서 회귀 테스트 추가**: `applyReplayTrim`에서 `replaceVideo`가 `saveNetworkLog`/`saveConsoleLog`/`saveActionLog`의 resolve **전에** 호출된다(기존 테스트는 호출 횟수·인자만 단언해 순서를 못 잡는다). 예: save mock을 수동 resolve deferred로 만들고 `replaceVideo` 호출 시점을 확인
  - [x] `applyRecordingTrim`에 전체 구간을 넣으면 `encodeVideoRange`·`replaceVideo`가 **호출되지 않는다**(`vi.mock("../encode-range")`)
  - [x] `applyRecordingTrim`에서 `encodeVideoRange`가 reject하면 `replaceVideo`가 호출되지 않고 reject이 전파된다
  - [x] 정상 경로에서 로그 3종이 경계로 좁혀지고 `replaceVideo`가 `startedAt + startSec*1000` / `startedAt + endSec*1000`으로 호출된다
  - [x] `rg -n "video-recorder" src/sidepanel/30s-replay/apply-trim.ts` 결과 0

### Task 7: 자르기 화면 소스 일반화 + 진행률 + ARIA

- **변경 대상**: `src/sidepanel/tabs/ReplayTrimDialog.tsx`, `src/i18n/namespaces/issue.ts`(ko/en)
- **작업 내용**:
  - props `frames` → `source: TrimSource`, `progress?: number` 추가, `onConfirm(startSec, endSec)` → `onConfirm(startSec, endSec, durationSec)`.
  - **`duration` 초기값을 소스 힌트로 세운다** — `useState(source.kind === "recording" ? (source.endedAt - source.startedAt) / 1000 : 0)`. `handleLoadedMetadata` 안이 아니라 마운트 시점이라, `loadedmetadata`가 아예 발화하지 않아도(손상 blob·디코더 실패) 타임라인·확정 버튼이 살아 있다. `setHistory`/`setValue` 초기화도 같은 값으로.
  - `handleLoadedMetadata`는 recording 소스에서 **`mediaScale` 계산만** 한다: `Number.isFinite(v.duration) && v.duration > 0 ? v.duration / duration : 1`. **축은 벽시계 고정** — `<video>.duration`으로 `duration`을 덮어쓰지 않는다(가변 fps 드리프트로 로그가 통째로 잘못 잘린다). frames 소스는 현행 유지.
  - `bounds` 계산을 `previewBoundsFor(source, {startSec, endSec}, {durationSec: duration, maxFrameDurationMs: MAX_FRAME_DURATION_MS})`로 교체. **`useMemo` deps에 `duration` 추가**(현재 `[frames, startSec, endSec]`).
  - 확정 핸들러에서 **`videoRef.current?.pause()`를 선행**한다.
  - busy일 때 `progress` 기반 `Progress` 바 + "영상 자르는 중 · 탭을 유지해 주세요" 문구 노출. 인코딩 중 취소는 제공하지 않는다.
  - 오버레이 루트 div에 `role="dialog"` + `aria-modal="true"` + `aria-label` 추가. 버튼은 아이콘 전용 유지.
  - **i18n(ko/en 동시)**:
    - `issue.replay.trim.cancelConfirm.{title,body}` **신규** — 현재 공유 중인 `editor.cancelConfirm.*`("작성을 취소할까요? / 작성 중인 내용이 모두 초기화됩니다")는 이 시점에 작성한 내용이 없고 실제 잃는 건 방금 찍은 녹화라 사실과 어긋난다.
    - `issue.replay.encodeFailed` **문구 수정**(또는 트림 전용 키 신설) — "다시 시도하세요"는 재시도 경로가 비목표로 제외돼 있어 오안내다. "원본 영상이 그대로 첨부됩니다"로.
    - 진행률 문구 **신규**.
    - 구간 readout·4탭·타임라인·마커·undo/redo·`data-testid`는 **그대로**.
- **검증**:
  - [x] `pnpm test` — i18n 대칭(ko/en 키·placeholder) green. `src/i18n/` 저장 시 PostToolUse 훅이 자동 실행
  - [ ] 30s 리플레이 자르기 화면의 표시·동작이 변경 전과 동일(수동)
  - [ ] `<video>`가 로드되지 않는 상황(DevTools로 blob URL 차단 등)에서도 타임라인이 그려지고 확정 버튼이 활성 상태다(수동)
  - [x] `rg -n "cancelConfirm" src/sidepanel/tabs/ReplayTrimDialog.tsx` — `editor.cancelConfirm`이 아니라 새 키를 참조한다

### Task 8: 녹화 경로 배선 (video-recorder + App)

- **변경 대상**: `src/sidepanel/video-recorder.ts`, `src/sidepanel/App.tsx`
- **작업 내용**:
  - `recorder.onstop`: **기존 `if (finalizing.end(finalizeId) === "discard") return;`(`:130`) 조기 리턴 뒤**에 트림 페이로드를 만들어 `onRecordingComplete`의 6번째 인자로 넘긴다. **길이 조건 없음** — 항상 생성.
    - 🔴 `finalizing.end(finalizeId) === "commit"` 같은 조건문을 **추가하지 않는다**. `createFinalizeGuard().end(id)`(`:45-50`)는 호출 즉시 `win = null`로 창을 소비하므로 두 번째 `end()`는 항상 `"discard"`를 반환 → **모든 녹화가 조용히 폐기된다**.
    - 호출부는 `:132-134` **1곳뿐**이고 탭/화면 녹화가 `beginRecording` 공통 본문을 타므로 배선은 이 한 지점이다.
  - **로그 settle 추가**: `onRecordingComplete` 전에 `await syncAndSettleLogs(tabId)`(`@/sidepanel/picker-control`)를 넣는다. 현재 `stopRecording()`은 `void stopNetworkRecorder(...)` fire-and-forget이라 정지 직전 로그 꼬리가 `drafting` 동결에 걸려 드롭된다 — 자르기 화면이 로그를 표·마커로 보여주게 되므로 눈에 보이는 결함이 된다.
  - **별도 setter를 추가하지 않는다** — 게이트가 `phase` 전이와 다른 `set()`으로 갈리면 POSTMORTEM 2026-07-17이 그대로 재발한다.
  - `App.tsx`:
    - `<ReplayTrimDialog source={replayTrim.source} progress={trimProgress}>`
    - `onConfirm` 진입에서 **`replayTrim.ownerTabId !== tabId`면 확정을 막고** 안내 토스트 후 `resolveTrim()`(원본 유지 진행). 탭 전환 시 `hydrate`가 merge라 오버레이는 남고 `tabId`만 바뀌어, 그대로 확정하면 **다른 탭의 로그를 자른다**.
    - `source.kind`로 `applyReplayTrim`/`applyRecordingTrim` 분기. `applyRecordingTrim`에 `mediaScale`·`onProgress`를 넘겨 `trimProgress` state 갱신.
    - `.catch(토스트)` `.finally(setTrimBusy(false) + resolveTrim())` 구조는 유지.
    - `onCancel`은 손대지 않는다.
- **검증**:
  - [x] `pnpm typecheck` **전체 통과**(여기서 처음으로 0 에러)
  - [x] `pnpm test` 통과
  - [x] 코드 확인: `rg -n "replayTrim|resolveReplayTrim" src/sidepanel/video-recorder.ts` 결과 0 (게이트를 세우는 경로가 `onRecordingComplete` 인자 하나뿐)
  - [x] 코드 확인: `rg -n 'end\(finalizeId\)' src/sidepanel/video-recorder.ts` 결과가 **1건**(`=== "discard"`)이다
  - [ ] 수동: 탭 녹화 정지 → 자르기 화면 자동 진입 (Task 10 체크리스트로 이어짐)

### Task 9: 문서 갱신

- **변경 대상**: `docs/ARCHITECTURE.md`, `docs/DIRECTORY.md`, `e2e/COVERAGE.md`
- **작업 내용**:
  - `ARCHITECTURE.md` "30s Replay > 트리밍" 절: 트림이 리플레이 전용이 아니라 **탭/화면 녹화도 포함**함을 명시하고, `TrimSource` 2갈래·recording 경로의 **벽시계 단일 축(+`mediaScale`)**·전체 구간 skip·재인코딩 실패 시 원본 유지·`ownerTabId` 가드를 추가한다. `replayTrim` 이름이 역사적이라는 점도 한 줄.
  - `ARCHITECTURE.md:287` 등 **기존 stale 정정**: `onRecordingComplete(blob, thumbnail, viewport, startedAt, endedAt)` **5-arg** 서술 → 실제는 6-arg(`editor-store.ts:204`). 289·296행도 함께 확인.
  - `DIRECTORY.md` 69행(`30s-replay/`): `trim-source`·`encode-range` 신규 파일과 `trim-math`의 새 함수 4개를 반영. 72행(`ReplayTrimDialog`): "30s Replay 트리밍 오버레이" → 리플레이·녹화 공용으로 수정. `src/sidepanel/lib/video-thumbnail.ts` 신규 추가.
  - `e2e/COVERAGE.md:97` "30s Replay 트리밍 전체" 항목: 녹화 트림이 같은 미커버 범위에 들어옴을 반영하고 수동 잔여 목록을 갱신한다.
  - `CLAUDE.md`는 변경 불필요(스택·게이트웨이·명령어 변화 없음) — 실제로 그런지 확인만 한다.
- **검증**:
  - [ ] `ARCHITECTURE.md`·`DIRECTORY.md`·`e2e/COVERAGE.md`의 기술 서술이 구현과 일치(문장 단위 대조)
  - [ ] `pnpm sync:agents:check` 통과(CLAUDE.md를 건드렸다면 sync 필요)

### Task 10: 분석 지표

- **변경 대상**: `src/sidepanel/lib/track-submit.ts`, 호출부(`SubmitFieldsDialog.tsx`)
- **작업 내용**: `replay_trimmed`와 함께 `trim_source: "frames" | "recording"`를 보낸다. 녹화 경로가 `videoTrimmed`를 켜기 시작하면 기존 시계열의 의미가 "리플레이 전용" → "영상 전체"로 소급 없이 바뀌기 때문이다. 익명 집계 범위 내라 privacy 영향 없음.
- **검증**:
  - [x] `pnpm test` — `track-submit` 관련 테스트 green(없으면 프로퍼티 구성 단위 테스트 추가)
  - [x] `docs/privacy.{ko,en}.md` 트리거 해당 없음을 확인(새 수집 항목이 아니라 기존 이벤트의 차원 추가 — 판단 근거를 커밋 메시지에 남긴다)

---

## 테스트 계획

### 단위 테스트

| 대상 | 파일 | 케이스 |
|---|---|---|
| `isFullRangeSec` | `30s-replay/__tests__/trim-math.test.ts` | 전체 구간 / 앞만 자름 / 뒤만 자름 / eps 안쪽 미세 오차 / eps 밖 |
| `recordingLogTrimBounds` | 〃 | 전체 구간→`null` / 앞만(`upper === undefined`) / 뒤만(`lower === -Infinity`) / 양쪽 / `isTrimmedOut` inclusive 경계 / 가드밴드 미적용 |
| `previewBoundsFor` | 〃 | frames 위임 결과 일치 / recording 위임 결과 일치 |
| `pickTrimBitrate` | 〃 | 저모션 하한 / 고모션 실측×1.5 / 상한 clamp / `durationSec === 0` 방어 |
| `applyRecordingTrim` | `30s-replay/__tests__/apply-trim.test.ts` | 전체 구간이면 `encodeVideoRange`·`replaceVideo` 미호출 / 인코딩 reject 시 `replaceVideo` 미호출 / 정상 경로에서 로그 3종이 경계로 좁혀지고 `replaceVideo`가 올바른 `startedAt`·`endedAt`으로 호출 / `mediaScale`이 `encodeVideoRange` 인자에 반영 |
| `applyReplayTrim` 회귀 | 〃 | 기존 케이스 전부 green + **`replaceVideo`가 IDB save resolve 전에 호출된다**(순서 단정) |
| `createMp4Sink` 회귀 | `30s-replay/__tests__/mp4-encoder.test.ts` | 기존 `encodeToMp4` 케이스 전부 green(추출 무변경 증거) |
| store 페이로드 | `store/__tests__/editor-store.test.ts` | `onRecordingComplete`가 `phase`·`replayTrim`·`reproPrefillDone`을 **한 set()**에 싣는다 / `reset()`이 `replayTrim`을 청소한다 / `resolveReplayTrim`이 게이트를 내린다 (기존 3개를 새 페이로드로 갱신) |
| i18n | `i18n/__tests__/locales.test.ts` | ko/en 대칭 — 새 키 3종 |

`encodeVideoRange`는 `HTMLVideoElement` + `requestVideoFrameCallback` + WebCodecs에 걸려 있어 유닛 대상이 아니다(`BROWSER_BOUND_EXACT` 등록). 검증은 수동이 유일한 안전망이다.

### e2e 시나리오

**없음.** 실제 탭/화면 녹화는 `tabCapture`/`getDisplayMedia`가 걸려 Playwright로 자동화 불가하고(`e2e/COVERAGE.md:33`에 "실제 getDisplayMedia/tabCapture 녹화는 자동화 불가(수동 잔여)"로 명시), 30s Replay 트림 e2e(`replay-trim`·`replay-trim-logs`)는 `captureVisibleTab` 환경 flaky로 **제거된 상태다**(`COVERAGE.md:97`. 파일 히스토리로는 추적 불가 — squash merge #122 안에서 추가·삭제가 상쇄됐다). 현재 `e2e/` 65개 spec 중 트림 관련 0개. 같은 이유로 이번에도 spec을 추가하지 않는다.

### 수동 테스트 (Chrome, `pnpm build` 후 `dist` 로드)

진입·기본 동작
- [ ] 설정에서 **30초 리플레이 토글을 끈 상태**로 탭 녹화 → 정지 → 자르기 화면이 자동으로 뜬다
- [ ] 화면 녹화 → 정지 → 자르기 화면이 뜬다
- [ ] OS "공유 중지"로 화면 녹화를 끝내도 자르기 화면이 뜬다
- [ ] 60초 상한 자동 정지에서도 자르기 화면이 뜬다
- [ ] 2~3초짜리 짧은 녹화에도 자르기 화면이 뜬다
- [ ] 진입 토스트가 자르기 화면이 뜰 때마다 1회 표시된다
- [ ] **정지 직전 1~2초에 발생한 로그가 자르기 화면 로그 탭에 들어 있다**(settle 확인)

자르기 동작
- [ ] 핸들을 움직이면 선택 길이 readout이 갱신되고, 로그 탭에서 잘려나갈 항목이 흐려진다
- [ ] 타임라인에 콘솔·네트워크 오류 마커와 페이지 이동 마커가 표시되고, 클릭하면 해당 로그 탭으로 전환된다
- [ ] undo/redo가 "한 번의 드래그" 단위로 동작한다
- [ ] 확정 → **진행률 바가 갱신되고** → 작성 화면 진입. 결과 영상 길이가 선택 구간과 일치한다
- [ ] 확정 후 첨부 로그에서 흐렸던 항목이 **실제로 빠져 있다**(로그 카드 건수·logs.html 대조)
- [ ] **logs.html의 로그 칩 시각·타임라인·마커 위치가 트림 후 기준점(`startedAt + startSec*1000`)과 맞는다** — `videoEmbed.startedAt`이 밀리므로 육안 확인 필요
- [ ] 결과 영상의 해상도가 원본과 같다(탭 1280×720 / 화면 최대 1920×1080). 육안 화질 저하 없음
- [ ] **결과 파일 크기가 원본 대비 비상식적으로 커지지 않는다**(저모션 녹화로 적응 비트레이트 확인)
- [ ] 화면 녹화 1080p에서도 인코딩이 성공한다(`pickCodec` 실패 없음)
- [ ] **로그 많은 SPA의 60초 녹화**에서 핸들 드래그가 버벅이지 않는다

seek 가드 (이번 변경이 만든 **유일한 신규 hard-fail 경로** — 실기 확인 필수)
- [ ] 탭 녹화의 **앞부분**을 잘라 확정(startSec>0) → 성공한다
- [ ] 화면 녹화의 앞부분을 잘라 확정 → 성공한다
- [ ] 30s 리플레이의 앞부분을 잘라 확정 → 성공한다
  - 배경: `encodeVideoRange`가 `seeked` 뒤 착지 지점을 `min(1s, span/2)`로 검증해 벗어나면 throw한다(원본 유지). MediaRecorder webm은 duration·Cues가 없어 seekable이 좁을 수 있고, 그러면 `currentTime` 대입이 clamp돼 이 가드에 걸린다. 이전엔 조용히 안 잘린 영상이 나갔으므로 "실패로 바뀐 것" 자체는 의도지만, **정상 케이스가 걸리면 tolerance를 재조정**해야 한다.

시간축 정합
- [ ] **정지 화면 30초를 포함한 60초 녹화**에서 자르기 화면의 총 길이 readout이 실제 경과(60초)와 일치한다(`<video>.duration`이 짧아도 벽시계 축 유지)
- [ ] 그 상태에서 끝 핸들을 조금만 당겨 확정했을 때 뒤쪽 로그가 통째로 사라지지 않는다
- [ ] **자른 영상의 첫 장면이 선택 시작점과 일치한다** — `mediaScale`이 1에서 벗어난 소스에서 인코딩 창(비례 축소)과 로그 경계(벽시계)의 전제가 갈리는 유일한 관측 지점이다. 어긋나면 `mediaScale`을 1로 고정하고 꼬리만 따로 처리하도록 바꾼다
- [ ] 정지 화면이 긴 구간을 포함해 자른 영상의 **재생 길이가 선택 구간과 일치**한다(프레임 duration 상한을 두지 않았는지 확인)
- [ ] `<video>`가 로드되지 않는 상황에서도 타임라인·확정이 살아 있다(미리보기 재생만 불가)

인코딩 중 이탈
- [ ] **인코딩 중 다른 브라우저 탭으로 갔다가 돌아와도** 실패하지 않고 진행률이 이어진다(watchdog 정지 확인)
- [ ] 인코딩 중 "탭을 유지해 주세요" 안내가 보인다
- [ ] 자르기 화면이 떠 있는 상태로 다른 탭에 갔다가 그 탭에서 확정을 시도하면 **막히고 안내가 뜬다**(다른 탭 로그가 잘리지 않는다)

skip·실패·취소 경로
- [ ] **핸들을 건드리지 않고 확정** → 대기 없이 즉시 작성 화면. 다운로드한 영상이 원본과 동일하고 재인코딩 흔적이 없다
- [ ] 취소(✕) → 확인 다이얼로그 문구가 **"녹화를 폐기"**를 말한다(작성 취소가 아니라) → 확정하면 캡처 진입 화면으로 복귀. 재진입 시 이전 로그·영상이 남아 있지 않다
- [ ] 취소 후 다시 녹화하면 **로그가 새로 쌓인다**(재주입 경로 확인)
- [ ] (가능하면) 인코딩 실패를 강제해 실패 토스트가 **"원본 영상이 그대로 첨부됩니다"**를 말하고 원본을 든 채 작성 화면으로 진행되는지 확인

회귀 (POSTMORTEM 소환)
- [ ] 자르기 화면 진입 시 **흰 화면이 없다**(2026-07-01)
- [ ] 확정 후 작성 화면에서 **재현 단계 자동 채움이 발화**한다 — AI(나노/BYOK) 연결 상태 + **트림 후에도 액션 로그가 남는 구간**으로 확인(2026-07-17). 액션 0건 구간에서는 미발화가 정상이라 오탐 주의
- [ ] 취소 후 다시 녹화 → 자르기 → 확정 경로에서도 재현 단계가 채워진다
- [ ] 30s 리플레이 자르기가 변경 전과 동일하게 동작한다(리플레이 회귀 없음)

## 구현 순서 권장

```
Task 1 (타입·store·기존 테스트)
   ├→ Task 2 (리플레이 이행)
   ├→ Task 3 (순수 함수 TDD)
   └→ Task 4 (mp4-encoder 추출)
        └→ Task 5 (encodeVideoRange)   ← 4 완료 필요
             └→ Task 6 (apply-trim)     ← 3·5 완료 필요
                  └→ Task 7 (다이얼로그) ← 3 완료 필요 (6과 병렬 가능)
                       └→ Task 8 (배선)  ← 6·7 완료 필요 · 여기서 typecheck 0
                            ├→ Task 9 (문서)
                            └→ Task 10 (지표)
```

- **Task 1이 모든 것의 선행**이다(타입이 바뀌면 컴파일 에러로 나머지 작업 지점이 드러난다).
- **Task 3은 `/tdd interface`로 테스트 선행**한다. Task 5·6은 그 뒤여야 경계 규칙이 흔들리지 않는다.
- **`pnpm typecheck` 전체 통과는 Task 8 이후**다(위 "typecheck 게이트 주의" 참조). 그 전 단계의 게이트는 `pnpm test`와 "새 에러를 만들지 않았다"이다.
- Task 8까지 끝나야 수동 검증이 가능하다.
- 전체 완료 후 `/code-review` → `/refactor` → `/postmortem`(회귀를 잡았다면) 순으로 잇는다.

## 가이드 영향

사용자 노출 UX 변경이므로 `/guide`로 처리한다. 작성 기준은 `guide/AUTHORING.md`.

- `guide/ko/video/record.md` · `guide/en/video/record.md` — 녹화 정지 후 **자르기 화면**이 뜬다는 단계를 추가. 구간 고르기·로그 흐림 미리보기·확정/취소 동작, "그대로 확정하면 전체가 유지된다", 인코딩 대기 중 **탭을 유지해야 한다**는 점을 포함.
- `guide/ko/video/replay.md` · `guide/en/video/replay.md` — "구간 자르기" 절이 리플레이 전용처럼 서술돼 있다. 같은 화면이 일반 녹화에도 쓰인다는 점을 반영하거나, 상세 설명을 `record.md`로 옮기고 상호 참조로 정리한다(중복 서술 회피는 AUTHORING 규칙에 따른다).
- 스크린샷 자산(`guide/*/assets/`)은 자르기 화면 자체가 거의 동일하므로 재촬영 불필요. 진행률 바가 추가되지만 과도기 상태라 캡처 대상이 아니다. 녹화 페이지에 기존 `video-replay-3.jpg` 계열을 재사용할지는 `/guide`에서 판단.
