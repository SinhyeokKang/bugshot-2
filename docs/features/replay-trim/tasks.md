# 30초 리플레이 트리밍 — 구현 태스크

## 선행 조건

- shadcn `Slider` 설치: `npx shadcn@latest add slider` (`components/ui/slider.tsx` 생성). Radix Slider 2-thumb 레인지 사용.
- 새 권한·env·OAuth·외부 API 없음. manifest 변경 없음.
- `computeFrameDurationsUs`(`mp4-encoder.ts`)·`trimByTime`/`replayLogBounds`(`log-merge.ts`)·`*Persist.discard`(`usePickerMessages.ts`)가 이미 export됨 — 신규 trim 로직 없이 재사용.
- `mp4-encoder.ts:11`의 **현재 private** `const MAX_FRAME_DURATION_MS = 1000`을 `export const`로 승격(아직 export 안 됨 — 소문자 `maxFrameDurationMs`는 `computeFrameDurationsUs` 파라미터명일 뿐)해 `trim-math`와 공유(하드코딩 중복 금지 — 초↔프레임 매핑 드리프트 방지). Task 1 선행.
- **UI 재사용(annotation/log-viewer 패턴)**: 오버레이 컨테이너·3단 액션바·`history.ts`(undo/redo)·`ButtonGroup`·`lazy`/`Suspense`는 `AnnotationOverlay`/`AnnotationToolbar`에서, 로그 프리뷰 모달은 `Console/Network/ActionLogPreviewDialog`에서 재사용. `@/log-viewer/markers`의 `buildMarkers`는 **소스 import 재사용**(별도 빌드 제약은 `dist-log-viewer` 아티팩트 한정). `TrimTimeline`은 ProgressBar를 통째 복제하지 않고 Slider(trim)+비대화형 마커/playhead 레이어로 구성.

## 태스크

### Task 1: trim-math 순수 함수 + 단위 테스트 (테스트 우선)
- **변경 대상**: `src/sidepanel/30s-replay/trim-math.ts`(신규), `src/sidepanel/30s-replay/__tests__/trim-math.test.ts`(신규)
- **작업 내용**: (선행) `mp4-encoder.ts:11` `MAX_FRAME_DURATION_MS`를 `export const`로 승격. 그 후 `frameOffsetsMs(frames, maxFrameDurationMs)`(누적 표시 오프셋 ms, `computeFrameDurationsUs` 재사용), `secondsToFrameRange(frames, startSec, endSec, maxFrameDurationMs)`(초→프레임 인덱스 스냅·clamp·**최소 2프레임**), `isFullRange`(in=0&&out=last) 구현. `maxFrameDurationMs`는 위 export 상수 공유. `/tdd interface`로 테스트 먼저.
- **검증**:
  - [ ] `frameOffsetsMs`: 빈 배열 `[]`, 단일 프레임 `[0]`, 등간격(600ms) 프레임의 누적 오프셋이 단조 증가.
  - [ ] `frameOffsetsMs` 마지막 오프셋 + 마지막 프레임 표시 duration == `computeFrameDurationsUs` 총합(영상 duration)과 일치(`<video>` 초↔프레임 매핑 드리프트 없음).
  - [ ] `secondsToFrameRange`: startSec=0 → inIndex=0; endSec≥총길이 → outIndex=last; 중간값은 가장 가까운 프레임에 스냅; in==out으로 좁혀지면 **최소 2프레임**(outIndex-inIndex≥1) 보장.
  - [ ] `isFullRange`: (0,last)=true, 그 외 false.
  - [ ] `pnpm test` 통과.

### Task 2: editor-store `replaceVideo` 액션
- **변경 대상**: `src/store/editor-store.ts` (타입 ≈164, 구현 ≈501)
- **작업 내용**: `replaceVideo(blob, thumbnail, startedAt, endedAt)` 추가 — `set({ videoBlob, videoThumbnail, videoStartedAt, videoEndedAt })`. phase·attach·target·**`videoCapturedAt` 불변(원본 캡처 시각 보존 — trim 확정 시각 `Date.now()`로 덮지 않음)**.
- **검증**:
  - [ ] `editor-store.test.ts`에 케이스 추가: drafting 상태에서 `replaceVideo` 호출 시 영상 메타(blob/thumbnail/startedAt/endedAt)만 바뀌고 phase/attach 토글 불변.
  - [ ] `replaceVideo` 후 `videoCapturedAt`이 호출 전 값 그대로(불변)임을 단언.
  - [ ] `pnpm typecheck` 통과.

### Task 3: `applyReplayTrim` 백엔드
- **변경 대상**: `src/sidepanel/30s-replay/apply-trim.ts`(신규)
- **작업 내용**: design의 `applyReplayTrim({ frames, tabId, startSec, endSec })`(captureTime 인자 없음) 구현 — `secondsToFrameRange` → slice → `isFullRange`면 no-op → `encodeToMp4` → **타임베이스 분리**: `videoStartedAt=sliced[0].ts`, `videoEndedAt=sliced[last].ts + lastFrameDurationMs`(raw), `replayLogBounds(sliced[0].ts, videoEndedAt)`→{lower,upper}(guard, 로그 전용) → `*Persist.discard()` → `trimByTime`로 store 로그 재trim → `set*Log` + `save*Log(`pending:${tabId}`)` → `editor.replaceVideo(blob, thumbnail, videoStartedAt, videoEndedAt)`(raw 경계). **`save*Log`를 await한 뒤 반환**(`discard()`가 in-flight IDB write를 못 막으므로 — `log-persist-guard.ts:58` — 호출부가 락 해제/`resolveTrim` 전에 save 완료를 보장해 늦은 write의 경계 밖 로그 부활 방지). 실패 시 throw(호출부에서 토스트).
- **검증**:
  - [ ] **단위**: `encodeToMp4`를 mock해 전체 구간 입력 시 호출 0회(no-op), 부분 구간 입력 시 1회 assert (WebCodecs는 jsdom 미지원이라 mock 필수).
  - [ ] **단위**: `replaceVideo`에 넘어가는 startedAt이 raw `sliced[0].ts`(guard 미적용)임을 spy로 확인 — 영상 측 타임베이스.
  - [ ] **단위**: 로그 `trimByTime`/`save*Log`에 넘어가는 lower가 **guard 적용된 `replayLogBounds` 결과**(raw − `REPLAY_LOG_GUARD_MS`)임을 spy로 확인 — 로그 측 타임베이스(분리 양측 봉인, design 최대 위험요소 둘 다 검증).
  - [ ] **단위**: `applyReplayTrim` 후 attach 토글(`networkLogAttach`/`consoleLogAttach`/`actionLogAttach`) 불변 — `set*Log`가 토글 미변경(PRD "첨부 토글 유지").
  - [ ] (수동) 실제 캡처에서 앞뒤 자른 뒤 첨부 로그가 새 경계 밖 항목을 포함하지 않음.

### Task 4: `use30sReplay` pendingTrim/resolveTrim 노출
- **변경 대상**: `src/sidepanel/30s-replay/use-30s-replay.ts`
- **작업 내용**: `Use30sReplayReturn`에 `pendingTrim: { videoBlob; frames } | null`·`resolveTrim(): void`(인자 없음) 추가. `capture()`가 `onRecordingComplete` **이후** 보존한 `frames`·`fullBlob`으로 `pendingTrim` state set(프레임 2개 미만이면 생략, `captureTime`은 보존 불필요). `resolveTrim()`이 `pendingTrim=null`로 정리(프레임 참조 해제). 기존 로그/인코딩/phase 시퀀스 불변.
- **검증**:
  - [ ] (수동/통합) 프레임 2개 이상 캡처 시 `capture()` 후 `pendingTrim != null`. (use-30s-replay는 WebCodecs/`captureVisibleTab`/`chrome` 의존이라 node-env 단위 테스트 불가 — 수동/통합 확인.)
  - [ ] (수동/통합) `resolveTrim` 호출 시 `pendingTrim == null`(프레임 참조 해제).
  - [ ] (수동) 프레임 2개 미만(0/1) 캡처 시 `pendingTrim` 미설정 → 오버레이 미표시·전체 클립 직행(PRD 엣지).
  - [ ] 기존 `editor-store.test.ts:196`(capture 동등 흐름) 회귀 없음 (`pnpm test` 자동).

### Task 5: `trim-markers` 에러 마커 어댑터 + 단위 테스트
- **변경 대상**: `src/sidepanel/30s-replay/trim-markers.ts`(신규), `src/sidepanel/30s-replay/__tests__/trim-markers.test.ts`(신규)
- **작업 내용**: `TrimMarker` 타입(여기 정의, `type: "console"|"network"`) + `buildErrorMarkers(logs:{consoleLog,networkLog}, videoStartedAt, durationSec): TrimMarker[]`. `@/log-viewer/markers`의 `buildMarkers`를 **import 재사용**(복제 금지 — 소스 import 정상 resolve)하고 **에러성만** 필터해 매핑. **에러 기준(넓게)**: console=`level==="error"||"warn"`, network=`status>=400||phase==="error"||"pending"`. **action 제외**. 순수 함수, 테스트 우선.
- **검증**:
  - [ ] console: error·warn 포함, info·log 제외.
  - [ ] network: 4xx/5xx·phase error·pending 포함, 2xx 정상 제외.
  - [ ] action 로그를 줘도 마커 0개(대상 아님).
  - [ ] `positionPct` 0~100 clamp, `videoStartedAt` 기준 환산 정확, `durationSec<=0`이면 안전(NaN 없음).
  - [ ] 빈 로그 → `[]`. `pnpm test` 통과.

### Task 6: `TrimTimeline` UI (1트랙 레이어 분리: Slider=trim 전용 / 마커·playhead=표시)
- **변경 대상**: `src/sidepanel/tabs/TrimTimeline.tsx`(신규), `src/components/ui/slider.tsx`(shadcn 설치)
- **작업 내용**: 대화형은 trim 듀얼핸들만 — `Slider value={[startSec,endSec]}`(`minStepsBetweenThumbs`로 최소 2프레임, 트랙클릭=가까운 thumb 이동). 재생 위치(`currentPct`)·에러 마커는 **`pointer-events-none` 비대화형 오버레이**로 absolute 겹침(Slider 포인터 가로채지 않음). ProgressBar 트랙클릭=seek는 **채용 안 함**(포인터 경합 회피). 시각 차등(thumb=손잡이 / playhead=가는 라인 / 마커=얇은 세로선, z: thumb>playhead>마커). `durationSec<=0`(loadedmetadata 전)·`busy`면 `disabled`, positionPct NaN 가드. 2-thumb에 "시작/끝" `aria-label`, 마커 `aria-hidden`.
- **검증**:
  - [ ] (수동) 핸들 드래그 → `onTrimChange` 발화·선택구간 갱신.
  - [ ] (수동) 에러 마커·playhead가 위치에 표시되고 드래그를 막지 않음.
  - [ ] (수동) duration 미확정 구간 disabled, 글리치 없음.

### Task 7: `ReplayTrimDialog` 오버레이 조립
- **변경 대상**: `src/sidepanel/tabs/ReplayTrimDialog.tsx`(신규)
- **작업 내용**: annotation 오버레이 패턴(`absolute inset-0 z-50 bg-background` + `flex h-full flex-col`)으로 4영역 조립 — **1단**(좌 선택길이 readout `aria-live` / 우 `ButtonGroup` console·network·action → 클릭 시 기존 PreviewDialog 열기; props 타입별 분기: console/action=`entries`+`startedAt`, **network=`requests`**; 로그 없으면 disabled; 중첩 모달 z-[60] 명시), **canvas**(`<video src={objectURL(videoBlob)}>` controls 없음, revoke cleanup), **2단**(▶/⏸ 토글 + `TrimTimeline`), **3단**(좌 `ButtonGroup` undo/redo[`history.ts` `History<[number,number]>` 함수형 재사용] / 우 `ButtonGroup` ✗ 취소[annotation과 동일 **중립 `outline`**]·✓ 확정). ✗ 클릭 시 **별도 `AlertDialog`(open state 직접 제어, `z-[60]`)**로 파괴 확인 — 기존 `CancelConfirmDialog`는 트리거 내장형이라 미재사용(문구만 동일). `timeupdate`/`play`/`pause`로 재생 state 추적, trim 핸들 변경 시 그 위치 seek. `busy` 시 모든 컨트롤 잠금·`Loader2`. `lazy`+`Suspense`로 로드.
- **검증**:
  - [ ] (수동) 핸들 드래그 → 영상 경계 seek, 1단 readout 갱신.
  - [ ] (수동) 재생/일시정지, 1단 로그 버튼 → 해당 PreviewDialog가 오버레이 위에 정상 표시·닫힘.
  - [ ] (수동) undo/redo로 핸들 값 되돌리기/다시.
  - [ ] (수동) busy 중 더블클릭해도 1회만 확정.

### Task 8: App 와이어링 + i18n
- **변경 대상**: `src/sidepanel/App.tsx`, `src/i18n/namespaces/issue.ts`
- **작업 내용**: `replay.pendingTrim` 있으면 `<Suspense><ReplayTrimDialog/></Suspense>` 렌더(오버레이라 `blurActiveElement` 불필요). App이 `busy` state 소유: `onConfirm`에서 `setBusy(true)` → `applyReplayTrim({ frames, tabId, startSec, endSec })`(현재 tabId 주입), `.catch`로 `issue.replay.encodeFailed` 토스트, `.finally`로 `setBusy(false)`+`resolveTrim()`. `onCancel`은 **별도 `AlertDialog`(신규, 문구만 동일)** 확인 후 `resolveTrim()`+`reset()`+`clearPicker(tabId)` + **IDB pending 정리**(`deleteNetworkLog`/`deleteConsoleLog`/`deleteActionLog`/`deleteAttachmentBlobs(`pending:${tabId}`)` — 기존 작성취소가 안 지우는 누수 보강). 제출 분석 이벤트에 **trim 적용 여부 플래그**를 추가(`applyReplayTrim`이 no-op 아닌 실제 재인코딩을 했는지 — PostHog 채택 지표, PRD 성공기준). `issue.replay.trim.{confirm,cancel,undo,redo,selection,play,pause,hint}` + `issue.replay.encodeFailed`(없으면) ko/en 동시 추가(`selection`은 placeholder 토큰, `hint`는 1단 안내 문구. 로그 버튼·취소 확인 라벨은 기존 i18n 재사용).
- **검증**:
  - [ ] (수동) 30s 리플레이 캡처 → drafting 위에 오버레이 자동 등장.
  - [ ] (수동) ✗ → 확인 후 캡처 폐기·진입 화면 복귀 + IDB pending 로그·attachment 잔존 없음.
  - [ ] i18n PostToolUse 훅(ko/en 대칭·placeholder 토큰 일치) 통과.
  - [ ] `pnpm typecheck` 통과.

## 테스트 계획

- **단위 테스트**: `trim-math.test.ts`(Task 1), `trim-markers.test.ts`(Task 5), `editor-store.test.ts`에 `replaceVideo` 케이스, `apply-trim` no-op/타임베이스(encodeToMp4 mock, Task 3).
- **기존 e2e 회귀(필수)**: `e2e/replay-action-log.spec.ts`는 `replay-button` 클릭(`:67`) 직후 곧장 drafting(액션로그 카드·`recording.mp4`)을 단언한다. 새 트림 오버레이가 클릭과 drafting 사이에 끼어들어 단언이 전부 어긋나므로, **이 기존 spec에 오버레이 dismiss 단계(✓ 전체 구간 no-op)를 삽입해 갱신한다**(신규 spec 아님 — Task 8 범위에 포함, `/push` e2e 게이트가 red로 잡기 전 선반영).
- **e2e 시나리오**(`/e2e-write` 입력 — 자동 판정 가능 문장):
  - 30s 리플레이를 캡처하면 drafting 진입과 동시에 트리밍 오버레이가 보인다(오버레이 `data-testid` 노출).
  - 오버레이에서 ✓(확정)을 누르면(핸들 전체 구간 그대로) 오버레이가 닫히고 drafting 미리보기 영상이 보인다. (결정적 — no-op 전체 유지)
  - 오버레이에서 ✗(작성 취소) → 확인 다이얼로그 컨펌 시 진입 화면(`EmptyState`)으로 돌아간다. (결정적)
  - 1단 로그 버튼을 누르면 해당 로그 프리뷰 다이얼로그가 열린다. **결정적으로 보장되는 로그 타입으로 한정**(예: action — 기존 `replay-action-log` 페이지 기준. console/network는 테스트 페이지가 결정적으로 만들지 못하면 버튼 disabled).
  - in/out 핸들을 좁힌 뒤 ✓를 누르면 닫히고 **선택 구간 값 반영 판정 신호 testid**(`data-trim-selection`)로 trim 발생을 확인. 드래그는 flaky하므로 **Slider thumb 포커스 후 키보드 화살표**(Radix 제공)를 결정적 입력 경로로 쓴다.
  - (참고) dual-thumb 마우스 드래그·captureVisibleTab 실제 영상 길이는 결정적이지 않아 수동 보강.
  - **src 수정은 `data-testid`/판정용 data-attr 추가만**(오버레이 컨테이너·✓/✗·로그 버튼·선택 구간 신호).
- **수동 테스트**(Chrome, captureVisibleTab/WebCodecs 의존):
  - [ ] 실제 페이지에서 30s 리플레이 → 앞뒤 자르고 ✓ → drafting 영상 길이가 선택 구간으로 줄어듦.
  - [ ] ✓ 후 첨부 로그(console/network/action)가 새 영상 구간 경계 밖 항목 미포함.
  - [ ] 전체 구간 그대로 ✓(no-op) 결과가 트리밍 없는 기존 동작과 동일.
  - [ ] 에러 마커가 타임라인에 표시되고 위치가 로그 시각과 맞음.
  - [ ] 재인코딩 실패(코덱 미지원 등) 시 토스트 + 전체 클립 유지.
  - [ ] ✗(작성 취소) → 캡처 폐기·진입 화면 + IDB pending 로그·attachment blob 잔존 없음(trim 취소는 즉시 삭제 — 기존 drafting 작성취소보다 강한 정리).
  - [ ] 다이얼로그 도중 패널 닫힘/리로드 → 재오픈 시 오버레이 없이 drafting 전체 클립 잔존(`pendingTrim` 메모리-only 소실, 고스트 오버레이 없음 — PRD 엣지).
  - [ ] 일반 녹화(탭/화면) 흐름은 오버레이가 뜨지 않고 기존대로 동작(회귀 없음).

## 구현 순서 권장

1. **Task 1**(trim-math + 테스트) — 토대, 독립.
2. **Task 2**(replaceVideo) — 독립, Task 1과 병렬 가능.
3. **Task 3**(applyReplayTrim) — Task 1·2 의존.
4. **Task 4**(use30sReplay pendingTrim) — Task 3과 독립이나 통합은 Task 3 이후.
5. **Task 5**(trim-markers + 테스트) — 독립, 병렬 가능.
6. **Task 6**(TrimTimeline) — Task 5 의존(마커 타입), slider 설치 선행.
7. **Task 7**(ReplayTrimDialog 조립) — Task 6 + 로그 PreviewDialog 재사용. UI 토대.
8. **Task 8**(App 와이어링 + i18n) — Task 3·4·7 통합, 마지막.

## 가이드 영향

사용자 노출 UX(리플레이 캡처 직후 트리밍 다이얼로그) 추가 → `/guide`로 갱신. 30초 리플레이/영상 캡처를 다루는 `guide/ko`·`guide/en` 페이지(예: 영상·리플레이 설명 페이지)에 "캡처 후 앞뒤를 잘라 버그 구간만 남길 수 있다" 흐름 추가. 정확한 페이지·라벨은 구현 후 `guide/AUTHORING.md` 규칙대로 ko·en 동시 갱신.
