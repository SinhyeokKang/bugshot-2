# 30초 리플레이 트리밍 — 기술 설계

## 개요

리플레이 캡처는 이미 `FrameBuffer`의 `{blob, timestamp}[]` 프레임 배열을 들고 있고, `capture()`가 [스냅샷 → `encodeToMp4(전체)` → 로그 trim → `onRecordingComplete` → drafting]을 원자적으로 수행한다(`use-30s-replay.ts`). 이 흐름을 **그대로 둔 채**, 캡처 시 사용한 프레임 스냅샷을 메모리 홀더에 보존하고 "trim 대기" 상태를 켠다. drafting 진입 직후 App이 보존된 프레임 위로 **트리밍 오버레이**(`ReplayTrimDialog`)를 띄운다. 사용자가 in/out을 고르고 확정(✓)하면, 선택 프레임만 `encodeToMp4`로 재인코딩해 store의 `videoBlob`을 교체하고, 이미 trim된 로그를 새 구간 경계로 한 번 더 좁혀 store·IDB(`pending:${tabId}`)에 덮어쓴다. 원본 프레임은 그 즉시 폐기한다(파괴적, 확정 후 재편집 불가).

**UI는 직전 기능 annotation 오버레이 패턴을 차용·확장**한다 — shadcn 모달 `Dialog`가 아니라 `absolute inset-0 z-50 bg-background` full-screen 오버레이(컨테이너 `src/sidepanel/components/AnnotationOverlay.tsx`), `lazy`+`Suspense`, 좌측 undo/redo·우측 확정/취소 `ButtonGroup`, `annotation/history.ts` 히스토리 헬퍼를 재사용한다. **단 그대로 복제가 아니라 확장**이다 — annotation은 info bar가 없는 3영역(툴/스타일/canvas/액션)이고, trim은 여기에 **정보 bar + 영상 컨트롤러 bar를 더한 4영역**이라 재사용 난이도가 더 높다. 좁은 모달 폭에서 듀얼 핸들을 잡기 어려운 문제를 패널 전폭으로 해소한다.

오버레이 UI는 `<video>` currentTime/duration 기반(초 단위)으로만 동작해 영상 소스에 비종속적이다(프레임·인코딩 무지). 리플레이는 확정 콜백(`onConfirm`)에서 초→프레임 인덱스로 환산해 슬라이스하고, 추후 일반 녹화는 같은 오버레이에 다른 확정 콜백(트랜스코드)을 물리면 된다. **버튼 모델**: ✓ 확정은 현재 핸들 구간으로 적용하되 전체 구간이면 `isFullRange` no-op이라 "전체 유지"가 자동 흡수된다(별도 keep-full 버튼 없음). ✗ 취소는 캡처 결과 전체를 폐기하고 진입 화면으로 — App이 drafting 작성취소와 동일한 정리 로직(`reset()` + `clearPicker(tabId)` + IDB pending 삭제)을 실행한다. 파괴 확인은 **별도 `AlertDialog`를 직접 제어**(open state)한다 — 기존 `CancelConfirmDialog`는 트리거 버튼을 내부 렌더하고 `onConfirm` 단일 prop만 받아(`CancelConfirmDialog.tsx:15`, `DraftingPanel.tsx:410`) ButtonGroup `[✗][✓]` 안에 끼울 수 없으므로, 같은 문구·패턴의 AlertDialog를 신규로 둔다(컴포넌트 자체 재사용 아님).

## 변경 범위

### 신규 파일

- **`src/sidepanel/30s-replay/trim-math.ts`** (순수 함수, 테스트 우선)
  - `frameOffsetsMs(frames: CapturedFrame[], maxFrameDurationMs): number[]` — 각 프레임의 영상 내 표시 시작 오프셋(ms) 누적 배열. `computeFrameDurationsUs`(mp4-encoder.ts에서 export됨, μs)를 재사용해 동일한 표시 타임라인을 산출 → 다이얼로그가 보여주는 `<video>` 시각과 프레임 인덱스가 어긋나지 않는다. **`maxFrameDurationMs`는 `encodeToMp4`가 쓰는 것과 동일한 상수여야** 매핑이 드리프트하지 않는다 → `mp4-encoder.ts`의 현재 **private `const MAX_FRAME_DURATION_MS = 1000`**(`mp4-encoder.ts:11`, 아직 export 안 됨 — 소문자 `maxFrameDurationMs`는 `computeFrameDurationsUs`의 파라미터명일 뿐)을 `export const`로 승격해 공유 출처로 쓴다(하드코딩 중복 금지).
  - `secondsToFrameRange(frames, startSec, endSec, maxFrameDurationMs): { inIndex: number; outIndex: number }` — 다이얼로그가 돌려준 초 구간을 프레임 인덱스 구간으로 환산(가장 가까운 프레임에 스냅, clamp, **최소 2프레임** 보장). `frameOffsetsMs`와 동일한 `maxFrameDurationMs`를 받아 일관.
  - `isFullRange(frames, inIndex, outIndex): boolean` — in=0 && out=last 판정(재인코딩 생략용 — `captureTime`이 아닌 frames 배열 인덱스 기준).

- **`src/sidepanel/30s-replay/apply-trim.ts`** (트리밍 적용 백엔드 — 리플레이 전용)
  - `applyReplayTrim(opts: { frames: CapturedFrame[]; tabId: number; startSec: number; endSec: number }): Promise<void>`
    - `tabId`는 App이 호출 시 현재 탭 id를 넘긴다(기존 `useTabId`/store 경로). `captureTime`은 로그 경계를 프레임 timestamp에서 재산출하므로 인자에서 제거(실사용처 없음).
    - `secondsToFrameRange`로 인덱스 환산 → `frames.slice(inIndex, outIndex + 1)`.
    - `isFullRange`면 no-op 반환(전체 유지와 동일).
    - `encodeToMp4({ frames: sliced })` → `{ blob, thumbnail }`.
    - **타임베이스 2갈래로 명확히 분리** (sync 회귀 방지 — 위험 요소 참고):
      - **영상 메타(`videoStartedAt/EndedAt`)**: raw 프레임 timestamp를 쓴다. `videoStartedAt = sliced[0].timestamp`(첫 프레임 시작), `videoEndedAt = sliced[last].timestamp + lastFrameDurationMs`(마지막 프레임이 화면에 표시되는 tail까지 포함 — `frameOffsetsMs`/`computeFrameDurationsUs`로 마지막 프레임 표시 길이 산출). sync 0점을 영상 시작에 맞춰 log-viewer 행↔영상 seek 어긋남 방지.
      - **로그 trim 경계**: `replayLogBounds(sliced[0].timestamp, videoEndedAt)`로 `{ lower, upper }` 산출(`replayLogBounds`가 시작측에 `REPLAY_LOG_GUARD_MS`를 빼고 두 번째 인자를 그대로 upper로 씀 — `log-merge.ts`). guard band는 기존 `capture()`와 동일 동작이라 그대로 재사용한다.
    - `capture()`와 유사하게 pending write를 폐기 후 재trim: `networkLogPersist.discard()` / `consoleLogPersist.discard()` / `actionLogPersist.discard()` → 현재 store의 (이미 trim된) 로그를 위 `{ lower, upper }`로 `trimByTime`해 한 번 더 좁혀 `setNetworkLog/setConsoleLog/setActionLog` + `saveNetworkLog/Console/Action(`pending:${tabId}`, trimmed)`.
    - **IDB write 순서 (capture와 다른 점)**: `discard()`는 throttle 타이머·대기 payload만 폐기하고 **이미 in-flight인 IDB write는 못 막는다**(`log-persist-guard.ts:58`). `capture()`는 save가 fire-and-forget(`.catch(()=>{})`)이지만 trim은 그걸 답습하면 drafting 진입 전 시작된 늦은 write가 trim save **뒤에** 착지해 경계 밖 로그가 IDB에서 부활할 수 있다 → discard→set→save 사이에 await를 끼우지 않고(동기), `save*Log`를 **await한 뒤** 호출부(App)가 락 해제/`resolveTrim`을 실행한다. (trim은 frozen phase에서 돌아 재무장 경로가 차단돼 확률은 낮지만 명세로 못박는다.)
    - store 영상 메타 교체: 신규 액션 `replaceVideo(blob, thumbnail, videoStartedAt, videoEndedAt)` 호출(위 raw 경계 — guard 적용된 로그 `lower`가 아님에 주의).

- **`src/sidepanel/tabs/ReplayTrimDialog.tsx`** (소스 비종속 트리밍 오버레이 UI — annotation 패턴 차용)
  - props: `{ videoBlob: Blob; onConfirm: (startSec: number, endSec: number) => void; onCancel: () => void; busy?: boolean }`. (로그·마커는 store에서 직접 읽음 — 소스 비종속 코어는 video+초 구간만 다루고, 로그 표시는 리플레이 전용 부가.)
  - **컨테이너**: shadcn 모달이 아니라 `src/sidepanel/components/AnnotationOverlay.tsx:334` 패턴 — 최상위 `<div className="absolute inset-0 z-50 bg-background">` + `flex h-full flex-col`. 위→아래 **1단(정보 bar) / canvas(영상) / 2단(영상 컨트롤러) / 3단(액션바)** 4영역:
    - **1단 정보 bar**(`flex items-center justify-between px-4 py-3`): 좌측 선택 길이 readout("17s / 30s", `issue.replay.trim.selection` placeholder, `aria-live="polite"`로 드래그 중 변화 읽힘). 우측 `ButtonGroup` [console][network][action] — 클릭 시 해당 로그 프리뷰 다이얼로그를 **기존 컴포넌트 재사용**으로 연다(`ConsoleLogPreviewDialog`/`NetworkLogPreviewDialog`/`ActionLogPreviewDialog`, `DraftingPanel.tsx:450`). **props는 타입별로 다름**: console/action은 `entries`+`startedAt`, **network는 `requests`(entries 아님)이며 `startedAt` 미수령** — 어댑터에서 분기 전달. attach 토글도 그대로 전달. **표시 범위 = store 로그본 전체**(`capture()`가 이미 1차 trim한 30초분, 마커와 동일 출처) — **현재 trim 핸들 구간으로 필터하지 않는다**(confirm 전 참고·판단용. 자를 구간 밖 에러를 봐야 핸들을 늘려 포함할 수 있고, 마커도 전체라 일관. 최종 좁혀진 로그는 confirm 후 drafting 로그 카드에서 확인). 로그가 없는 타입의 버튼은 `disabled`. (오버레이 위 중첩 모달 — Radix Portal이 DOM 후순 렌더라 정상 위에 뜸. annotation 텍스트 편집기 전례처럼 필요 시 `z-[60]`로 명시.)
    - **canvas**(`flex min-h-0 flex-1 items-center justify-center`): `<video src={objectURL(videoBlob)} className="aspect-video w-full object-contain">` (`VideoPreview` 패턴, objectURL revoke cleanup). controls 미사용 — 재생은 2단 컨트롤러가 담당.
    - **2단 영상 컨트롤러**(`<video>`에 붙지 않고 canvas 하단 별도 bar, `flex items-center gap-2 px-4 py-2`): 좌측 재생/일시정지 토글 버튼(`Play`/`Pause`). 그 우측에 **`TrimTimeline`**(아래 신규 파일).
    - **3단 액션바**(`flex items-center justify-between border-t px-4 py-4`): 좌측 `ButtonGroup` [↶ undo(`Undo2`)][↷ redo(`Redo2`)] / 우측 `ButtonGroup` [✗ 취소(`X`)][✓ 확정(`Check`)]. annotation 푸터(`AnnotationToolbar.tsx:268`) 구조 동일. ✗는 캡처 전체 폐기지만 **annotation ✗과 동일하게 중립 `outline`으로 통일**한다 — 별도 AlertDialog 확인이 이중 가드라 색 경고의 한계효용이 낮고, 나란히 뜨는 두 오버레이 간 시각 일관성을 우선한다(annotation 취소도 주석 전부 폐기라 파괴성 비대칭 근거가 약함).
  - **재생 상태**: `video.currentTime`/`paused`를 로컬 state로 추적(`timeupdate`/`play`/`pause` 리스너). 재생 위치는 `TrimTimeline`에 `currentPct`로 전달. 핸들로 trim 경계 변경 시 그 위치로 seek해 경계 프레임 확인.
  - **undo/redo**: `src/sidepanel/components/annotation/history.ts`(제네릭 `History<T>` + 함수형 순수 함수 `initHistory`/`pushHistory`/`undo`/`redo`/`canUndo`/`canRedo` — h를 인자로 받아 새 History 반환, 클래스 아님)를 `History<[number,number]>`로 재사용해 핸들 값 히스토리를 로컬 state로 관리. `canUndo`/`canRedo`로 버튼 `disabled`. 확정/취소 후 오버레이가 사라지면 히스토리도 소멸(확정 후 undo 없음).
  - **✓ 확정**: `onConfirm(startSec, endSec)` 호출. App이 `applyReplayTrim`을 부르고, 전체 구간이면 `isFullRange`로 no-op(전체 유지 흡수). `busy` 시 모든 버튼·핸들 잠금 + `Loader2` 스피너(이중 인코딩·이중 `replaceVideo` 방지). `busy` state는 **App이 소유**(`onConfirm` 진입 시 true, `.finally`에서 false).
  - **✗ 취소**: `onCancel()` 호출 → App이 캡처 폐기 경로 실행(아래 App 변경). 캡처 결과를 버리는 파괴적 동작이라 **별도 `AlertDialog`(open state 직접 제어, `z-[60]`)**로 확인 후 진행(오버레이 위 중첩). 기존 `CancelConfirmDialog`는 트리거 내장형이라 그대로 못 끼우므로 같은 문구의 AlertDialog를 신규로 둔다.
  - **lazy 로딩**: `DraftingPanel.tsx`의 annotation처럼 `lazy(() => import("./ReplayTrimDialog"))` + `Suspense` fallback(`Loader2`).

- **`src/sidepanel/tabs/TrimTimeline.tsx`** (영상 타임라인 — **1트랙 레이어 분리**: Slider=trim 전용, 마커/playhead=표시 전용)
  - props: `{ durationSec: number; currentPct: number; startSec: number; endSec: number; markers: TrimMarker[]; disabled?: boolean; onTrimChange: (startSec: number, endSec: number) => void; }`.
  - **입력 책임 분리(경합 회피)**: trim 듀얼 핸들만 대화형 — shadcn `Slider` 2-thumb(`value=[startSec,endSec]`, `minStepsBetweenThumbs`로 최소 2프레임, 트랙 클릭=가까운 thumb 이동). 재생 위치(`currentPct`)와 에러 마커는 **비대화형 오버레이 레이어(`pointer-events-none`)**로 트랙 위에 absolute 겹침 → Slider 포인터 이벤트를 가로채지 않는다. (별도 임의 seek 트랙 클릭은 두지 않음 — seek는 핸들 이동에 수반되거나 재생/일시정지로. ProgressBar의 트랙클릭=seek는 채용 안 함.)
  - **시각 차등**: trim thumb=쥘 수 있는 손잡이, playhead=가는 세로 라인, 마커=얇은 세로선(에러 색). z 순서 thumb > playhead > 마커. 좁은 폭(≈288px) 밀도 고려해 마커는 16px 다이아몬드 대신 얇은 라인.
  - **마커**: `buildErrorMarkers`(아래) 결과를 `positionPct`에 표시만. 클릭/hover 비대화형이라 키보드/SR로는 마커 인지 불가 → 버그 시점 상세는 1단 로그 프리뷰 버튼으로 접근(마커는 `aria-hidden`).
  - **밀도 한계(수용)**: `buildMarkers`는 dedup·clustering이 없어 에러 많은 페이지면 좁은 폭(≈250–288px)에 얇은 세로선이 겹쳐 띠가 될 수 있다. 클러스터링은 이번 스코프에서 **도입하지 않고 수용**한다(버그 시점 가늠은 1단 로그 프리뷰가 주 경로). **a11y 한계(수용)**: 마커가 비대화형·`aria-hidden`이고 클러스터링도 없어 키보드/SR 사용자는 타임라인에서 버그 시점을 직접 타겟팅할 수 없다 — **길이 트리밍은 가능하되 버그구간 정밀 타겟팅은 1단 로그 프리뷰로만**(보강 비목표, PRD 성공기준에 한계 명시).
  - duration 미확정(`loadedmetadata` 전 `durationSec<=0`)이면 timeline `disabled`, `positionPct` NaN 가드(원본 `markers.ts:37` 가드 준용).
  - 2-thumb 각각 "시작/끝" `aria-label` 부여(Radix가 키보드 화살표는 제공).

- **`src/sidepanel/30s-replay/trim-markers.ts`** (에러 마커 어댑터 — `buildMarkers` **재사용**, 순수 함수)
  - `log-viewer/markers.ts`는 별도 아티팩트가 아니라 `src/` 소스이므로 `@/log-viewer/markers`로 **import 가능** → `buildMarkers`를 재사용한다(복제 금지).
  - `TrimMarker` 타입을 **여기 정의**(Task 의존순서상 timeline보다 먼저): `{ id; type: "console" | "network"; absTs: number; positionPct: number }`.
  - `buildErrorMarkers(logs, videoStartedAt, durationSec): TrimMarker[]` — console·network에 대해 `buildMarkers`를 호출하고 **에러성 variant만** 남겨 `TrimMarker`로 매핑·합친다. **구현 전 확인**: `buildMarkers` 반환 `TimelineMarker`(`markers.ts:36`)가 `level`/`status`(또는 variant) 판별 필드를 갖는지 본다 — 가지면 그 필드로 필터, 없으면 원본 `consoleLog`/`networkLog`에서 직접 에러를 거르고 `buildMarkers`는 positionPct 산출용으로만 쓴다. **에러 기준(넓게)**: console=`level==="error" || level==="warn"`, network=`status>=400 || phase==="error" || phase==="pending"`(원본 분류 그대로). **action은 마커 대상 제외**(`ActionEntry`에 에러 구분 없음 — 1단 로그 버튼으로만 유지). positionPct는 `buildMarkers`가 산출한 값 사용.

- **`src/sidepanel/30s-replay/__tests__/trim-math.test.ts`** — `trim-math.ts` 단위 테스트.
- **`src/sidepanel/30s-replay/__tests__/trim-markers.test.ts`** — `trim-markers.ts` 단위 테스트(에러만 필터, positionPct clamp).

### 변경 파일

- **`src/sidepanel/30s-replay/use-30s-replay.ts`**
  - 현재 역할: 폴링·버퍼링·`capture()`(인코딩+로그trim+drafting 전환).
  - 변경: `capture()`가 `onRecordingComplete` 호출 **후**, 사용한 `frames` 스냅샷을 메모리 홀더에 보존하고 trim 대기 상태를 켠다(프레임 2개 미만이면 생략). `Use30sReplayReturn`에 `pendingTrim: { videoBlob: Blob; frames: CapturedFrame[] } | null`과 `resolveTrim(): void`를 추가(인자 없는 정리 함수 — 적용은 App이 `applyReplayTrim`을 직접 호출하고 `resolveTrim`은 `pendingTrim=null` 정리만 한다. `captureTime`은 `applyReplayTrim`이 프레임 timestamp에서 경계를 재산출하므로 보존 불필요). 기존 `bufferRef.current.clear()` 위치는 유지하되, 보존용 스냅샷은 clear 전에 별도 변수로 떠둔다(현 코드의 `const frames = bufferRef.current.snapshot()`를 그대로 활용).
  - 주의: 보존 프레임은 React state가 아닌 ref로 들고, `pendingTrim`만 state로 노출(blob/frames는 직렬화 대상 아님 — 메모리 only).

- **`src/sidepanel/App.tsx`** (≈68, 170-178, 다이얼로그 렌더 영역)
  - 현재 역할: `use30sReplay` 호출 + `ReplayProvider` + 각종 전역 다이얼로그 렌더.
  - 변경: `replay.pendingTrim`이 있으면 `<Suspense><ReplayTrimDialog/></Suspense>` 렌더(오버레이라 다른 전역 모달과 달리 `blurActiveElement` 불필요 — annotation 오버레이도 미사용). App이 `busy` state를 소유:
    - `onConfirm={(s,e) => { setBusy(true); applyReplayTrim({ frames, tabId, startSec: s, endSec: e }).catch(() => toast.error(t("issue.replay.encodeFailed"))).finally(() => { setBusy(false); replay.resolveTrim(); }); }}` — `applyReplayTrim`이 `isFullRange`면 no-op이라 전체 구간 확정 시 전체 유지와 동일.
    - `onCancel={() => { replay.resolveTrim(); reset(); if (tabId) { void clearPicker(tabId); deleteNetworkLog(`pending:${tabId}`); deleteConsoleLog(`pending:${tabId}`); deleteActionLog(`pending:${tabId}`); deleteAttachmentBlobs(`pending:${tabId}`); } }}` — 캡처 폐기 → 진입 화면. 기존 drafting 작성 취소(`DraftingPanel.tsx:410`)는 `reset()`+`clearPicker`만 하고 **IDB pending을 안 지우는 결함**(로그·특히 uuid 키 attachment blob 누수)이 있어, trim 취소에선 **IDB pending 로그·attachment까지 즉시 삭제**해 누수를 막는다(이번 스코프에서 보강). 파괴 확인은 `ReplayTrimDialog` 내부의 **별도 `AlertDialog`**가 담당(기존 `CancelConfirmDialog` 컴포넌트는 미재사용 — 문구만 동일).
    - `tabId`는 현재 탭 id(기존 경로)에서 취해 `applyReplayTrim`·`clearPicker`에 넘긴다.

- **`src/store/editor-store.ts`** (≈164 타입, ≈501 구현)
  - 현재 역할: editor 상태·`onRecordingComplete`.
  - 변경: 신규 액션 `replaceVideo: (blob: Blob, thumbnail: string, startedAt: number, endedAt: number) => void` 추가. `set({ videoBlob, videoThumbnail, videoStartedAt, videoEndedAt })`만 갱신(phase·attach 토글·target·**`videoCapturedAt` 불변 — 원본 캡처 시각 보존, trim 확정 시각 `Date.now()`로 덮지 않음**). `onRecordingComplete`의 영상 메타 set 부분과 대칭(단 capturedAt은 제외).

- **`src/i18n/namespaces/issue.ts`** (ko ≈9-14, en ≈109-114)
  - 변경: `issue.replay.trim.confirm`(확정/Apply — ✓ 버튼 aria-label·title), `issue.replay.trim.cancel`(작성 취소/Discard — ✗ 버튼), `issue.replay.trim.undo`(되돌리기/Undo), `issue.replay.trim.redo`(다시 실행/Redo), `issue.replay.trim.selection`(선택 길이 readout — "{{sel}}s / {{total}}s" placeholder), `issue.replay.trim.play`/`issue.replay.trim.pause`(재생/일시정지 aria-label) ko/en 동시 추가. 재인코딩 실패 토스트 `issue.replay.encodeFailed`도 없으면 추가. (1단 로그 버튼 라벨·작성 취소 확인 문구는 기존 `LogAttachmentCards`/`CancelConfirmDialog` i18n 재사용. keep-full·title 키는 불필요 — ✓ no-op 흡수, 풀스크린이라 헤더 타이틀 생략 가능.) PostToolUse 훅이 ko/en 대칭·placeholder 토큰 일치를 검사하므로 양쪽 함께 갱신.

### 의존성

- **shadcn `Slider`** 미설치(`components/ui/`에 `slider.tsx` 없음) → `npx shadcn@latest add slider` 필요. Radix Slider는 `value`를 배열로 주면 2-thumb 레인지를 지원. (구현 단계에서 설치, 설계에선 명시만.)
- **재사용(신규 의존성 아님)**:
  - `annotation/history.ts`(undo/redo), `components/ui/button-group.tsx`(`ButtonGroup`), `AnnotationOverlay`의 오버레이/lazy/objectURL 패턴. (작성 취소 확인은 `CancelConfirmDialog` *컴포넌트* 재사용이 아니라 같은 문구의 별도 `AlertDialog` — 트리거 내장형이라 ButtonGroup에 못 끼움.)
  - `ConsoleLogPreviewDialog`/`NetworkLogPreviewDialog`/`ActionLogPreviewDialog`(1단 로그 버튼이 여는 기존 모달 — props는 타입별 분기: console/action=`entries`+`startedAt`, network=`requests`) + `VideoPreview` objectURL 패턴.
  - `log-viewer/markers.ts`의 `buildMarkers`는 `src/` 소스라 `@/log-viewer/markers`로 **import 재사용**(별도 빌드 제약은 `dist-log-viewer` 아티팩트 한정이지 소스 import는 정상 resolve). `trim-markers.ts`는 이를 호출하는 얇은 에러-필터 어댑터. (마커 라벨 i18n은 `log-viewer/i18n` 사전을 타며 번들에 딸려옴 — 경미.)
  - `TrimTimeline.tsx`는 Slider(trim) + 비대화형 마커/playhead 레이어만 — ProgressBar 통째 복제 안 함(트랙클릭=seek 미채용으로 포인터 경합 회피).

## 데이터 흐름

```
[EmptyState 30s replay 클릭]
  → use30sReplay.capture()
      snapshot frames ──┐
      encodeToMp4(전체) → fullBlob, thumbnail
      로그 trim [frames[0]-guard, captureTime]  (기존)
      onRecordingComplete(fullBlob, ...)  → phase=drafting  (기존)
      pendingTrim = { videoBlob: fullBlob, frames(보존) }  ★신규
  → App: pendingTrim 있음 → <Suspense><ReplayTrimDialog/></Suspense> (absolute inset-0 z-50 오버레이)
      1단 [readout 17s/30s | console·network·action 버튼→기존 로그 PreviewDialog]
      canvas [<video src=fullBlob>]
      2단 [▶/⏸ | TrimTimeline: Slider(trim) + playhead·에러마커(비대화형, buildErrorMarkers console/network)]
      3단 [↶↷ | ✗(중립 outline) ✓]
        ── trim 핸들 드래그 → video.currentTime seek (경계 프레임 확인)
        ── ↶/↷ → history undo/redo (핸들 값 [startSec,endSec])
  ── [✓ 확정] App: setBusy(true); onConfirm(startSec, endSec)
      applyReplayTrim({ frames, tabId, startSec, endSec }):
        secondsToFrameRange(maxFrameDurationMs) → inIndex,outIndex
        sliced = frames.slice(in, out+1)
        isFullRange면 no-op 반환
        encodeToMp4(sliced) → trimmedBlob, thumbnail
        videoStartedAt = sliced[0].ts; videoEndedAt = sliced[last].ts + lastFrameDurationMs   ← raw
        replayLogBounds(sliced[0].ts, videoEndedAt) → {lower,upper}   ← guard 적용(로그 전용)
        *Persist.discard() → trimByTime(store logs, lower, upper) → set*Log + save(`pending:${tabId}`)
        editor.replaceVideo(trimmedBlob, thumbnail, videoStartedAt, videoEndedAt)   ← raw 경계
      → .finally: setBusy(false); resolveTrim() → pendingTrim=null → 오버레이 닫힘, frames 폐기
      → .catch: toast.error(encodeFailed) (전체 클립 유지)
  ── (전체 구간 확정 = ✓ 누름) → isFullRange no-op → 전체 클립 그대로 drafting (별도 버튼 없음)
  ── [✗ 작성 취소] AlertDialog(신규, 문구만 동일) 확인 → onCancel
        → resolveTrim() + reset() + clearPicker(tabId) + deleteNetwork/Console/ActionLog(pending) + deleteAttachmentBlobs(pending)
        → 캡처 결과(영상·로그·attachment) 폐기, phase=idle 진입 화면
```

- `videoBlob`은 세션 직렬화 제외(IDB 별도) — `useEditorSessionSync.ts:32` 주석대로. drafting 중에는 store 메모리에만 존재하므로 `replaceVideo`의 메모리 교체로 충분. `videoStartedAt/EndedAt/Thumbnail/CapturedAt`은 세션 영속 대상이라 자동 저장됨. IDB 영상 저장은 기존대로 `confirmDraft`에서 `issueId` 키로 수행 — trim 시점엔 IDB 영상 write 불필요.
- 로그는 `capture()`가 이미 `pending:${tabId}`에 trim본을 저장했고, `applyReplayTrim`이 더 좁힌 본으로 덮어쓴다. confirmDraft가 `issueId` 키로 옮긴다(기존 경로 불변).

## 인터페이스 설계

```ts
// trim-math.ts
import type { CapturedFrame } from "./frame-buffer";

export function frameOffsetsMs(
  frames: CapturedFrame[],
  maxFrameDurationMs: number, // encodeToMp4와 동일한 공유 상수
): number[];
export function secondsToFrameRange(
  frames: CapturedFrame[],
  startSec: number,
  endSec: number,
  maxFrameDurationMs: number,
): { inIndex: number; outIndex: number }; // 최소 2프레임 보장
export function isFullRange(
  frames: CapturedFrame[],
  inIndex: number,
  outIndex: number,
): boolean;

// apply-trim.ts
export function applyReplayTrim(opts: {
  frames: CapturedFrame[];
  tabId: number;
  startSec: number;
  endSec: number;
}): Promise<void>;

// use-30s-replay.ts (확장)
export interface Use30sReplayReturn {
  isReady: boolean;
  isEncoding: boolean;
  bufferedSeconds: number;
  capture: () => Promise<void>;
  pendingTrim: { videoBlob: Blob; frames: CapturedFrame[] } | null; // ★
  resolveTrim: () => void; // ★ pendingTrim=null 정리 (적용은 App이 applyReplayTrim 직접 호출)
}

// editor-store.ts (확장)
// startedAt = raw sliced[0].timestamp, endedAt = raw sliced[last].timestamp + lastFrameDurationMs
replaceVideo: (blob: Blob, thumbnail: string, startedAt: number, endedAt: number) => void;

// ReplayTrimDialog.tsx (full-screen 오버레이 — App이 pendingTrim 있을 때만 렌더, open prop 없음)
interface ReplayTrimDialogProps {
  videoBlob: Blob;
  onConfirm: (startSec: number, endSec: number) => void; // ✓ — App이 applyReplayTrim 호출
  onCancel: () => void;                                   // ✗ — App이 reset()+clearPicker (작성 취소)
  busy?: boolean;
}

// trim-markers.ts (TrimMarker 타입 정의처 — timeline보다 먼저 의존)
export interface TrimMarker {
  id: string;
  type: "console" | "network"; // action 제외(에러 구분 없음)
  absTs: number;
  positionPct: number;         // 0-100
}
export function buildErrorMarkers(
  logs: { consoleLog: ConsoleLog | null; networkLog: NetworkLog | null },
  videoStartedAt: number,
  durationSec: number,
): TrimMarker[]; // buildMarkers 재사용 + 에러 필터(console error|warn, network 4xx|error|pending)

// TrimTimeline.tsx (1트랙 레이어 분리: Slider=trim 전용, 마커/playhead=비대화형 표시)
interface TrimTimelineProps {
  durationSec: number;
  currentPct: number;             // 재생 위치(표시만, pointer-events-none)
  startSec: number;
  endSec: number;
  markers: TrimMarker[];          // 에러만(표시만)
  disabled?: boolean;             // loadedmetadata 전/busy
  onTrimChange: (startSec: number, endSec: number) => void;
}
```

## 기존 패턴 준수

- **테스트 우선**: `trim-math.ts`의 순수 함수(`frameOffsetsMs`/`secondsToFrameRange`/`isFullRange`)를 `/tdd interface`로 먼저 작성한다(CLAUDE.md 테스트 우선 원칙).
- **로그 trim 일관성**: 기존 `trimByTime`/`replayLogBounds`(`log-merge.ts`)와 `*Persist.discard()` 폐기 패턴을 그대로 따른다 — 새 trim 로직을 만들지 않고 경계만 바꿔 재사용.
- **세션 영속화**: Blob은 store에 두되 세션 직렬화에서 제외하는 기존 규약(`useEditorSessionSync.ts:32`) 유지. trim은 IDB 영상 write를 추가하지 않는다.
- **UI 컨벤션 / annotation 패턴 재사용**: full-screen 오버레이(`absolute inset-0 z-50`) + 3단 레이아웃 + `ButtonGroup` + `lazy`/`Suspense` + `history.ts`를 **직전 기능 annotation(`AnnotationOverlay`/`AnnotationToolbar`)에서 그대로 차용**한다. shadcn `Slider`만 신규 설치(직접 스타일링 금지). 오버레이라 `blurActiveElement()`는 불필요(annotation 오버레이도 미사용). (과거 "seek tooltip·핸들 hit-target은 `log-viewer/ProgressBar.tsx` 복제"로 적었으나 정정 — ProgressBar는 log-viewer 전용 hand-rolled drag-seek(`role="slider"`)이고 trim은 shadcn Slider + 트랙클릭-seek 미채용이라 실제 가져올 게 거의 없다. 사이드패널 기존 영상도 native `controls`뿐이라 커스텀 스크러버는 사실상 신규.)
- **i18n 동시 갱신**: `issue.ts` ko/en 같은 키 동시 추가(PostToolUse 훅 게이트).

## 대안 검토

1. **다이얼로그를 프레임 이미지(canvas/img) 기반으로 만들어 전체 사전 인코딩을 생략** — 단일 인코딩으로 비용 절감 가능. 그러나 drafting은 어차피 `videoBlob`이 필요해 전체 인코딩이 `capture()`에서 이미 일어나고, `<video>` seek가 핸들 드래그 UX에 더 자연스럽다. 또 일반 녹화 재사용 seam(소스 비종속 `<video>` 기반)을 깬다. → 채택 안 함. 추가 비용은 60프레임 1회 재인코딩(서브초)으로 작음.
2. **비파괴적: 원본 프레임·전체 로그를 IDB에 보존하고 trim 구간만 저장, 제출 시 최종 인코딩(재편집 허용)** — 재편집은 가능하나 사용자가 명시적으로 파괴·재편집 불가·즉시 폐기를 선택. 저장 비용·세션 hydrate 복잡도(프레임까지 복원)만 늘어 비목표. → 채택 안 함.
3. **editor-store의 phase에 `trimming` 추가** — 다이얼로그를 phase로 모델링. 그러나 다이얼로그는 drafting 위 오버레이로 충분하고, phase 추가는 세션 hydrate·전이 가드(여러 hook의 phase 분기)에 회귀 표면을 넓힌다. → 메모리 only `pendingTrim` 상태로 충분.

## 위험 요소

- **`capture()` 시퀀스 민감도**: 로그 `discard`/`persist`/`save` 순서와 phase 가드가 정교하다(주석 다수). `pendingTrim` set은 반드시 `onRecordingComplete` **이후** 마지막에 두어 기존 원자 시퀀스를 건드리지 않는다. 프레임 보존은 기존 `bufferRef.snapshot()` 결과를 재사용(추가 스냅샷 금지).
- **이중 인코딩 비용**: 전체(capture) + 트리밍(apply) 2회. 60프레임이라 작지만, apply 중 `busy` 표시로 UI 잠금 필요.
- **로그 재trim 레이스**: drafting 중 늦은 sync write가 끼면 경계 밖 로그가 IDB에서 부활할 수 있음 → `applyReplayTrim`도 `capture()`처럼 `*Persist.discard()` 선행 후 save(동일 가드 재사용).
- **타임베이스 혼용 → 영상-로그 sync 회귀**: `videoStartedAt/EndedAt`에 guard 적용된 로그 `lower`를 넣으면 sync 0점이 `REPLAY_LOG_GUARD_MS`만큼 어긋난다. `replaceVideo`엔 **raw 프레임 timestamp**(끝은 마지막 프레임 표시 tail 포함), 로그 trim 경계엔 **`replayLogBounds` 결과(guard)**를 넣어 두 타임베이스를 분리한다(위 apply-trim 명세).
- **초↔프레임 매핑 드리프트**: `trim-math`가 `encodeToMp4`와 다른 `maxFrameDurationMs`를 쓰면 `<video>` currentTime과 프레임 인덱스가 어긋난다 → 동일 상수를 `mp4-encoder.ts`에서 export해 공유.
- **세션 영속 vs 메모리 프레임**: `pendingTrim` 프레임은 메모리 only. 다이얼로그 도중 패널 닫힘/리로드 시 trim 기회 상실(전체 클립 유지) — 파괴 철학상 허용. `videoStartedAt/EndedAt`만 영속되므로 trim 결과는 정상 복원.
- **`isFullRange` 미처리 시 불필요 재인코딩**: 전체 구간 선택을 no-op로 처리하지 않으면 동일 영상을 재인코딩 → 반드시 가드.
- **확장 seam 과설계 경계**: 이번엔 다이얼로그를 소스 비종속(초 기반)으로 두는 선까지만. 일반 녹화용 `applyRecordingTrim`(트랜스코드)·소스 추상 인터페이스는 만들지 않는다(비목표).
- **타임라인 포인터 경합**: Slider(자체 포인터 캡처)와 ProgressBar식 트랙클릭=seek를 한 트랙에 두면 입력이 충돌한다 → trim은 Slider 단독, 마커/playhead는 `pointer-events-none` 표시 레이어로 분리(트랙클릭=seek 미채용)해 경합 제거.
- **작성 취소 IDB 누수**: 기존 drafting 작성취소(`reset`+`clearPicker`)는 IDB `pending:` 로그·attachment(uuid 키)를 안 지워 누수가 있다. trim ✗는 `deleteNetwork/Console/ActionLog` + `deleteAttachmentBlobs(`pending:${tabId}`)`로 즉시 정리(이번 스코프 보강). (기존 drafting 경로 자체 수정은 비목표 — 별도 이슈.)
