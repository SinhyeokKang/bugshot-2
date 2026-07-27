# 녹화 구간 자르기 — 구현 태스크

## 선행 조건

- **권한·env·의존성 변경 없음.** 새 npm 패키지 없고 `manifest.config.ts`·OAuth env·`docs/privacy.*` 트리거에 해당하지 않는다(새 캡처·수집·전송 동작이 아니라 이미 만든 영상의 로컬 재인코딩).
- 착수 전 `docs/POSTMORTEM.md`에서 **2026-07-01**(두 lazy 청크 동시 마운트 → 흰 화면)과 **2026-07-17**(트림 게이트 레인 분리 → 재현 단계 영구 미발화) 두 항목을 읽는다. 이번 변경이 녹화 경로를 그 회로에 새로 편입시킨다.
- `docs/ARCHITECTURE.md` "30s Replay > 트리밍" 절이 현행 설계의 단일 출처다.
- 수동 검증은 `pnpm build` 후 Chrome에 `dist`를 로드해야 한다(dist stale 주의).

---

## 태스크

### Task 1: `TrimSource` 타입 + store 페이로드 일반화

- **변경 대상**: `src/sidepanel/30s-replay/trim-source.ts`(신규), `src/store/editor-store.ts`
- **작업 내용**:
  - `trim-source.ts`에 `TrimSource` 판별 유니언을 정의한다. **런타임 import 0** — `CapturedFrame`만 `import type`으로 받는다.
  - `editor-store.ts`의 `ReplayTrim`을 `{ videoBlob: Blob; source: TrimSource }`로 바꾼다. `CapturedFrame` import는 `TrimSource` import로 교체.
  - `replayTrim` 선언부 주석에 "리플레이·일반 녹화 공용(이름은 POSTMORTEM grep 연속성 때문에 유지)" 한 줄 추가.
  - `onRecordingComplete`·`resolveReplayTrim`·`replaceVideo` 시그니처는 건드리지 않는다.
- **검증**:
  - [ ] `pnpm typecheck` 통과 (기존 호출부 2곳이 컴파일 에러로 드러나야 정상 — Task 2·6에서 해소)
  - [ ] `editor-store.ts`가 `mp4-encoder`/`mp4-muxer`를 (타입 포함) 새로 import하지 않는다 — `rg -n "mp4|muxer" src/store/editor-store.ts` 결과 0
  - [ ] 기존 `src/store/__tests__/editor-store.test.ts`의 "전이 원자성"·"reset이 replayTrim까지 청소한다" 테스트가 새 페이로드 형태로 갱신되고 통과

### Task 2: 리플레이 경로를 새 페이로드로 이행 (동작 무변경)

- **변경 대상**: `src/sidepanel/30s-replay/use-30s-replay.ts`
- **작업 내용**: `capture()`의 트림 페이로드를 `{ videoBlob: blob, source: { kind: "frames", frames } }`로 바꾼다. `frames.length >= 2` 조건은 그대로 유지(리플레이 한정).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` — `src/sidepanel/30s-replay/__tests__/` 전체 green
  - [ ] 수동: 30s 리플레이 캡처 → 자르기 화면 진입·확정·취소가 **변경 전과 동일**하게 동작

### Task 3: 초 단위 트림 경계 순수 함수 (**TDD 선행**)

- **변경 대상**: `src/sidepanel/30s-replay/trim-math.ts`, `src/sidepanel/30s-replay/__tests__/trim-math.test.ts`
- **작업 내용**: `/tdd interface`로 **테스트를 먼저** 작성한 뒤 구현한다.
  - `isFullRangeSec(startSec, endSec, durationSec, eps = 0.05)`
  - `recordingLogTrimBounds(startedAt, startSec, endSec, durationSec)` — 전체 구간이면 `null`. 앞을 안 자르면 하한 없음(`Number.NEGATIVE_INFINITY`), 뒤를 안 자르면 `upper: undefined`.
  - `previewBoundsFor(source, startSec, endSec, durationSec)` — `source.kind`로 `previewTrimBounds` / `recordingLogTrimBounds` 위임.
- **검증**:
  - [ ] `isFullRangeSec`: 전체 구간 true / 앞만 자름 false / 뒤만 자름 false / eps 안쪽 미세 오차(0.03초) true / eps 밖(0.2초) false
  - [ ] `recordingLogTrimBounds`: 전체 구간 → `null` / 앞만 자름 → `lower = startedAt + startSec*1000`, `upper === undefined` / 뒤만 자름 → `lower === -Infinity`, `upper = startedAt + endSec*1000` / 양쪽 → 둘 다 유한값
  - [ ] `recordingLogTrimBounds` 결과를 `isTrimmedOut`에 먹였을 때 경계값(정확히 `lower`·`upper`)이 **잘리지 않는다**(inclusive — `trimByTime`과 동일)
  - [ ] `previewBoundsFor`: `kind:"frames"`는 `previewTrimBounds`와 동일 결과 / `kind:"recording"`은 `recordingLogTrimBounds`와 동일 결과
  - [ ] `pnpm test` green

### Task 4: 구간 재인코딩 (`encodeVideoRange`)

- **변경 대상**: `src/sidepanel/30s-replay/encode-range.ts`(신규), `src/sidepanel/30s-replay/mp4-encoder.ts`(`CODEC_CANDIDATES` export 추가), `scripts/coverage-report.mjs`
- **작업 내용**:
  - `encodeVideoRange({ blob, startSec, endSec, playbackRate = 4, bitrate = TRIM_REENCODE_BITRATE, stallTimeoutMs = 3000 })` 구현. 설계 문서의 "데이터 흐름 > `encodeVideoRange` 내부" 순서를 그대로 따른다.
  - 해상도는 `ceilEven(video.videoWidth/videoHeight)` — **`maxWidth` clamp 없음**(원본 유지).
  - 코덱·청크 메타 처리는 `mp4-encoder.ts`의 `pickCodec`/`CODEC_CANDIDATES`/`prepareChunkMeta`/`pickEvenDimensions`를 재사용한다(중복 구현 금지).
  - 1프레임 lookahead로 각 프레임 duration을 산출(마지막 프레임은 직전 duration 재사용) — `computeFrameDurationsUs`의 의미론과 일치시킨다.
  - `finally`에서 `video.pause()` / `src=""` / `URL.revokeObjectURL` / `encoder.close()`를 반드시 정리한다.
  - `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 `src/sidepanel/30s-replay/encode-range.ts`를 등록한다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm coverage:report` — 로직 스코프 분모에 `encode-range.ts`가 **포함되지 않는다**
  - [ ] 수동(Task 8에서 통합 확인): 자른 영상의 재생 길이가 선택 구간과 일치(±1프레임), 해상도가 원본과 동일, 재생 중 깨짐 없음

### Task 5: 로그 트림 헬퍼 추출 + `applyRecordingTrim`

- **변경 대상**: `src/sidepanel/30s-replay/apply-trim.ts`, `src/sidepanel/video-recorder.ts`
- **작업 내용**:
  - `applyReplayTrim` 안의 network/console/action 3블록을 `trimStoredLogs(tabId, bounds)`로 추출한다(persist discard → `trimByTime` → store set → IDB save → `Promise.allSettled`). **동작 변경 금지** — 순수 추출.
  - `video-recorder.ts`의 `generateThumbnail`을 `export`한다.
  - `applyRecordingTrim(opts)` 구현:
    1. `bounds = recordingLogTrimBounds(...)` — `null`이면 **즉시 return**(재인코딩·로그 재trim·`replaceVideo` 전부 없음)
    2. `blob' = await encodeVideoRange(...)`
    3. `thumb' = await generateThumbnail(blob')`
    4. `await trimStoredLogs(tabId, bounds)`
    5. `replaceVideo(blob', thumb', startedAt + startSec*1000, startedAt + endSec*1000)`
  - 2~3단계에서 throw되면 `replaceVideo` 전이므로 store는 원본 그대로 남는다 — 이 순서를 바꾸지 않는다.
- **검증**:
  - [ ] `pnpm test` — 기존 `apply-trim.test.ts` 전부 green(추출이 동작을 바꾸지 않았다는 증거)
  - [ ] `applyRecordingTrim`에 전체 구간을 넣으면 `encodeVideoRange`·`replaceVideo`가 **호출되지 않는다**(모킹 단위 테스트 추가)
  - [ ] `applyRecordingTrim`에서 `encodeVideoRange`가 reject하면 `replaceVideo`가 호출되지 않고 reject이 전파된다(모킹 단위 테스트 추가)

### Task 6: 자르기 화면 소스 일반화

- **변경 대상**: `src/sidepanel/tabs/ReplayTrimDialog.tsx`
- **작업 내용**:
  - props `frames` → `source: TrimSource`, `onConfirm(startSec, endSec)` → `onConfirm(startSec, endSec, durationSec)`.
  - `bounds` 계산을 `previewBoundsFor(source, startSec, endSec, duration)`로 교체.
  - `handleLoadedMetadata`: `<video>.duration`이 유한·양수가 아니면 recording 소스에 한해 `(endedAt − startedAt)/1000`로 폴백. 폴백 값도 `setDuration`/`setHistory`/`setValue`에 동일하게 적용한다.
  - 4탭·타임라인·마커·undo/redo·취소 다이얼로그·i18n 키·`data-testid`는 **전부 그대로**.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 30s 리플레이 자르기 화면의 표시·동작이 변경 전과 동일(수동)
  - [ ] `<video>.duration`이 `Infinity`인 상황에서도 확정 버튼이 활성화되고 타임라인이 그려진다(수동 — webm 폴백 재현이 어려우면 DevTools에서 duration을 강제해 확인)

### Task 7: 녹화 경로 배선 (App + video-recorder)

- **변경 대상**: `src/sidepanel/video-recorder.ts`, `src/sidepanel/App.tsx`
- **작업 내용**:
  - `recorder.onstop`의 커밋 경로(`finalizing.end(finalizeId) === "commit"` 이후)에서 트림 페이로드를 만들어 `onRecordingComplete`의 6번째 인자로 넘긴다. **길이 조건 없음** — 항상 생성.
  - **별도 setter를 추가하지 않는다** — 게이트가 `phase` 전이와 다른 `set()`으로 갈리면 POSTMORTEM 2026-07-17이 그대로 재발한다.
  - `App.tsx`: `<ReplayTrimDialog source={replayTrim.source}>`, `onConfirm`에서 `source.kind`로 `applyReplayTrim`/`applyRecordingTrim` 분기. `.catch(토스트)` `.finally(setTrimBusy(false) + resolveTrim())` 구조는 유지.
  - `onCancel`은 손대지 않는다.
- **검증**:
  - [ ] `pnpm typecheck`·`pnpm test` 통과
  - [ ] 코드 확인: `video-recorder.ts`에서 `replayTrim`을 세우는 경로가 `onRecordingComplete` 인자 **하나뿐**이다 — `rg -n "replayTrim|resolveReplayTrim" src/sidepanel/video-recorder.ts` 결과 0
  - [ ] 수동: 탭 녹화 정지 → 자르기 화면 자동 진입 (Task 8 체크리스트로 이어짐)

### Task 8: 문서 갱신

- **변경 대상**: `docs/ARCHITECTURE.md`, `docs/DIRECTORY.md`
- **작업 내용**:
  - `ARCHITECTURE.md` "30s Replay > 트리밍" 절: 트림이 리플레이 전용이 아니라 **탭/화면 녹화도 포함**함을 명시하고, `TrimSource` 2갈래·recording 경로의 선형 로그 매핑·전체 구간 skip·재인코딩 실패 시 원본 유지를 추가한다. `replayTrim` 이름이 역사적이라는 점도 한 줄.
  - `DIRECTORY.md` 69행(`30s-replay/`): `trim-source`·`encode-range` 신규 파일과 `trim-math`의 새 함수 3개를 반영. 72행(`ReplayTrimDialog`): "30s Replay 트리밍 오버레이" → 리플레이·녹화 공용으로 수정.
  - `CLAUDE.md`는 변경 불필요(스택·게이트웨이·명령어 변화 없음) — 실제로 그런지 확인만 한다.
- **검증**:
  - [ ] `ARCHITECTURE.md`·`DIRECTORY.md`의 기술 서술이 구현과 일치(문장 단위 대조)
  - [ ] `pnpm sync:agents:check` 통과(CLAUDE.md를 건드렸다면 sync 필요)

---

## 테스트 계획

### 단위 테스트

| 대상 | 파일 | 케이스 |
|---|---|---|
| `isFullRangeSec` | `30s-replay/__tests__/trim-math.test.ts` | 전체 구간 / 앞만 자름 / 뒤만 자름 / eps 안쪽 미세 오차 / eps 밖 |
| `recordingLogTrimBounds` | 〃 | 전체 구간→`null` / 앞만 / 뒤만(`lower === -Infinity`) / 양쪽 / `isTrimmedOut` inclusive 경계 |
| `previewBoundsFor` | 〃 | frames 위임 결과 일치 / recording 위임 결과 일치 |
| `applyRecordingTrim` | `30s-replay/__tests__/apply-trim.test.ts` | 전체 구간이면 `encodeVideoRange`·`replaceVideo` 미호출 / 인코딩 reject 시 `replaceVideo` 미호출 / 정상 경로에서 로그 3종이 경계로 좁혀지고 `replaceVideo`가 올바른 `startedAt`·`endedAt`으로 호출 |
| `applyReplayTrim` 회귀 | 〃 | 기존 케이스 전부 green(`trimStoredLogs` 추출이 동작 무변경임을 보증) |
| store 페이로드 | `store/__tests__/editor-store.test.ts` | `onRecordingComplete`가 `phase`·`replayTrim`·`reproPrefillDone`을 **한 set()**에 싣는다 / `reset()`이 `replayTrim`을 청소한다 (기존 테스트를 새 페이로드 형태로 갱신) |

`encodeVideoRange`는 `HTMLVideoElement` + `requestVideoFrameCallback` + WebCodecs에 걸려 있어 유닛 대상이 아니다(`BROWSER_BOUND_EXACT` 등록). 검증은 수동이 유일한 안전망이다.

### e2e 시나리오

**없음.** 실제 탭/화면 녹화는 `tabCapture`/`getDisplayMedia`가 걸려 Playwright로 자동화 불가하고(`e2e/COVERAGE.md`에 "실제 getDisplayMedia/tabCapture 녹화는 자동화 불가(수동 잔여)"로 명시), 30s Replay 트림 e2e(`replay-trim`·`replay-trim-logs`)는 `captureVisibleTab` 환경 flaky로 **이미 제거된 상태**다. 같은 이유로 이번에도 spec을 추가하지 않는다 — 로직은 위 단위 테스트로, 오버레이 동작은 아래 수동 체크리스트로 커버한다.

### 수동 테스트 (Chrome, `pnpm build` 후 `dist` 로드)

진입·기본 동작
- [ ] 설정에서 **30초 리플레이 토글을 끈 상태**로 탭 녹화 → 정지 → 자르기 화면이 자동으로 뜬다
- [ ] 화면 녹화 → 정지 → 자르기 화면이 뜬다
- [ ] OS "공유 중지"로 화면 녹화를 끝내도 자르기 화면이 뜬다
- [ ] 60초 상한 자동 정지에서도 자르기 화면이 뜬다
- [ ] 2~3초짜리 짧은 녹화에도 자르기 화면이 뜬다
- [ ] 진입 토스트가 1회 표시된다

자르기 동작
- [ ] 핸들을 움직이면 선택 길이 readout이 갱신되고, 로그 탭에서 잘려나갈 항목이 흐려진다
- [ ] 타임라인에 콘솔·네트워크 오류 마커와 페이지 이동 마커가 표시되고, 클릭하면 해당 로그 탭으로 전환된다
- [ ] undo/redo가 "한 번의 드래그" 단위로 동작한다
- [ ] 확정 → 스피너 표시 → 작성 화면 진입. **결과 영상 길이가 선택 구간과 일치**한다
- [ ] 확정 후 첨부 로그에서 흐렸던 항목이 **실제로 빠져 있다**(로그 카드 건수·logs.html 대조)
- [ ] 결과 영상의 해상도가 원본과 같다(탭 1280×720 / 화면 최대 1920×1080). 육안 화질 저하 없음
- [ ] 화면 녹화 1080p에서도 인코딩이 성공한다(`pickCodec` 실패 없음)

skip·실패·취소 경로
- [ ] **핸들을 건드리지 않고 확정** → 대기 없이 즉시 작성 화면. 다운로드한 영상이 원본과 동일하고 재인코딩 흔적이 없다
- [ ] 취소(✕) → 확인 → 녹화가 폐기되고 캡처 진입 화면으로 복귀. 재진입 시 이전 로그·영상이 남아 있지 않다
- [ ] (가능하면) 인코딩 실패를 강제해 실패 토스트 후 **원본 영상을 든 채** 작성 화면으로 진행되는지 확인

회귀 (POSTMORTEM 소환)
- [ ] 자르기 화면 진입 시 **흰 화면이 없다**(2026-07-01)
- [ ] 확정 후 작성 화면에서 **재현 단계 자동 채움이 발화**한다 — AI(나노/BYOK) 연결 상태에서 액션 로그가 있는 녹화로 확인(2026-07-17)
- [ ] 취소 후 다시 녹화 → 자르기 → 확정 경로에서도 재현 단계가 채워진다
- [ ] 30s 리플레이 자르기가 변경 전과 동일하게 동작한다(리플레이 회귀 없음)

## 구현 순서 권장

```
Task 1 (타입·store)
   └→ Task 2 (리플레이 이행)  ─┐
   └→ Task 3 (순수 함수 TDD)  ─┤  ← 2·3·4는 서로 독립, 병렬 가능
   └→ Task 4 (encodeVideoRange)┘
        └→ Task 5 (apply-trim)      ← 3·4 완료 필요
             └→ Task 6 (다이얼로그)  ← 3 완료 필요
                  └→ Task 7 (배선)   ← 5·6 완료 필요
                       └→ Task 8 (문서)
```

- **Task 1이 모든 것의 선행**이다(타입이 바뀌면 컴파일 에러로 나머지 작업 지점이 드러난다).
- **Task 3은 `/tdd interface`로 테스트 선행**한다. Task 4·5는 그 뒤여야 경계 규칙이 흔들리지 않는다.
- Task 7까지 끝나야 수동 검증이 가능하다 — 그 전에는 `pnpm typecheck` + `pnpm test`가 게이트다.
- 전체 완료 후 `/code-review` → `/refactor` → `/postmortem`(회귀를 잡았다면) 순으로 잇는다.

## 가이드 영향

사용자 노출 UX 변경이므로 `/guide`로 처리한다. 작성 기준은 `guide/AUTHORING.md`.

- `guide/ko/video/record.md` · `guide/en/video/record.md` — 녹화 정지 후 **자르기 화면**이 뜬다는 단계를 추가. 구간 고르기·로그 흐림 미리보기·확정/취소 동작과 "그대로 확정하면 전체가 유지된다"를 포함.
- `guide/ko/video/replay.md` · `guide/en/video/replay.md` — "구간 자르기" 절이 리플레이 전용처럼 서술돼 있다. 같은 화면이 일반 녹화에도 쓰인다는 점을 반영하거나, 상세 설명을 `record.md`로 옮기고 상호 참조로 정리한다(중복 서술 회피는 AUTHORING 규칙에 따른다).
- 스크린샷 자산(`guide/*/assets/`)은 자르기 화면 자체가 동일하므로 재촬영 불필요. 녹화 페이지에 기존 `video-replay-3.jpg` 계열을 재사용할지 새로 찍을지는 `/guide`에서 판단.
