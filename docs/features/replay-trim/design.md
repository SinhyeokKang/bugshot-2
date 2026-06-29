# 30초 리플레이 트리밍 — 기술 설계

## 개요

리플레이 캡처는 이미 `FrameBuffer`의 `{blob, timestamp}[]` 프레임 배열을 들고 있고, `capture()`가 [스냅샷 → `encodeToMp4(전체)` → 로그 trim → `onRecordingComplete` → drafting]을 원자적으로 수행한다(`use-30s-replay.ts`). 이 흐름을 **그대로 둔 채**, 캡처 시 사용한 프레임 스냅샷·captureTime을 메모리 홀더에 보존하고 "trim 대기" 상태를 켠다. drafting 진입 직후 App이 보존된 프레임 위로 **트리밍 다이얼로그**를 띄운다. 사용자가 in/out을 고르고 적용하면, 선택 프레임만 `encodeToMp4`로 재인코딩해 store의 `videoBlob`을 교체하고, 이미 trim된 로그를 새 구간 경계로 한 번 더 좁혀 store·IDB(`pending:${tabId}`)에 덮어쓴다. 원본 프레임은 그 즉시 폐기한다(파괴적, 재편집 불가).

다이얼로그 UI는 `<video>` currentTime/duration 기반(초 단위)으로만 동작해 영상 소스에 비종속적이다. 리플레이는 적용 콜백에서 초→프레임 인덱스로 환산해 슬라이스하고, 추후 일반 녹화는 같은 다이얼로그에 다른 적용 콜백(트랜스코드)을 물리면 된다.

## 변경 범위

### 신규 파일

- **`src/sidepanel/30s-replay/trim-math.ts`** (순수 함수, 테스트 우선)
  - `frameOffsetsMs(frames: CapturedFrame[], maxFrameDurationMs): number[]` — 각 프레임의 영상 내 표시 시작 오프셋(ms) 누적 배열. `computeFrameDurationsUs`(mp4-encoder.ts에서 export됨, μs)를 재사용해 동일한 표시 타임라인을 산출 → 다이얼로그가 보여주는 `<video>` 시각과 프레임 인덱스가 어긋나지 않는다. **`maxFrameDurationMs`는 `encodeToMp4`가 쓰는 것과 동일한 상수여야** 매핑이 드리프트하지 않는다 → `mp4-encoder.ts`에서 그 상수를 export해 공유 출처로 쓴다(하드코딩 중복 금지).
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
    - `capture()`와 동일하게 pending write를 폐기 후 재trim: `networkLogPersist.discard()` / `consoleLogPersist.discard()` / `actionLogPersist.discard()` → 현재 store의 (이미 trim된) 로그를 위 `{ lower, upper }`로 `trimByTime`해 한 번 더 좁혀 `setNetworkLog/setConsoleLog/setActionLog` + `saveNetworkLog/Console/Action(`pending:${tabId}`, trimmed)`.
    - store 영상 메타 교체: 신규 액션 `replaceVideo(blob, thumbnail, videoStartedAt, videoEndedAt)` 호출(위 raw 경계 — guard 적용된 로그 `lower`가 아님에 주의).

- **`src/sidepanel/tabs/ReplayTrimDialog.tsx`** (소스 비종속 트리밍 다이얼로그 UI)
  - props: `{ open: boolean; videoBlob: Blob; onApply: (startSec: number, endSec: number) => void; onKeepFull: () => void; busy?: boolean }`.
  - **닫기 시맨틱 = 전체 유지**: `<Dialog open={open} onOpenChange={(v) => { if (!v) onKeepFull(); }}>`로 controlled. Esc·X·overlay 클릭은 모두 `onKeepFull`(비파괴)로 매핑 — 닫혔는데 `pendingTrim`이 안 풀려 다시 뜨는 버그 방지.
  - `<Dialog>`(shadcn, 기존 `components/ui/dialog.tsx`) 안에 `<video>` + 듀얼 핸들 타임라인 슬라이더(shadcn `Slider`, `value={[startSec, endSec]}` 2-thumb, `minStepsBetweenThumbs`로 핸들 겹침 방지). duration이 `onLoadedMetadata` 전엔 미확정이라 그 전까지 슬라이더 `disabled`.
  - **seek-preview**: Radix `Slider`의 `onValueChange`는 `[start,end]` 배열만 주므로, **이전 값과 diff해 움직인 thumb**을 판별하고 그쪽으로 `video.currentTime` seek. 핸들 시각 tooltip·hit-target 확장은 `src/log-viewer/components/ProgressBar.tsx`가 푼 패턴(포털 tooltip + viewport clamp, 보이는 핸들 + invisible padding)을 **복제**한다(ProgressBar는 `src/log-viewer/`의 별도 inline 빌드라 직접 import 불가 — 패턴만 차용).
  - 트랙 하단에 **선택 길이 readout**("3.4s / 30s") 단일 행 표시.
  - **undo/redo**: 다이얼로그 내부에서 핸들 값(`[startSec,endSec]`) 변경 히스토리를 로컬 state로 관리해 undo/redo 버튼 제공(확정 전 한정 — 다이얼로그 닫히면 소멸). 적용/전체 유지 후 원본은 폐기되므로 확정 후 undo는 없음.
  - 푸터: **적용(크롭)** / **전체 유지**. `busy` 시 두 버튼 잠금 + `Loader2` 스피너(이중 인코딩·이중 `replaceVideo` 방지). `busy` state는 **App이 소유**(`onApply` 진입 시 true, `.finally`에서 false).
  - 일반 녹화 재사용을 위해 프레임·인코딩을 모르고 초 구간만 다룬다.

- **`src/sidepanel/30s-replay/__tests__/trim-math.test.ts`** — `trim-math.ts` 단위 테스트.

### 변경 파일

- **`src/sidepanel/30s-replay/use-30s-replay.ts`**
  - 현재 역할: 폴링·버퍼링·`capture()`(인코딩+로그trim+drafting 전환).
  - 변경: `capture()`가 `onRecordingComplete` 호출 **후**, 사용한 `frames` 스냅샷을 메모리 홀더에 보존하고 trim 대기 상태를 켠다(프레임 2개 미만이면 생략). `Use30sReplayReturn`에 `pendingTrim: { videoBlob: Blob; frames: CapturedFrame[] } | null`과 `resolveTrim(): void`를 추가(인자 없는 정리 함수 — 적용은 App이 `applyReplayTrim`을 직접 호출하고 `resolveTrim`은 `pendingTrim=null` 정리만 한다. `captureTime`은 `applyReplayTrim`이 프레임 timestamp에서 경계를 재산출하므로 보존 불필요). 기존 `bufferRef.current.clear()` 위치는 유지하되, 보존용 스냅샷은 clear 전에 별도 변수로 떠둔다(현 코드의 `const frames = bufferRef.current.snapshot()`를 그대로 활용).
  - 주의: 보존 프레임은 React state가 아닌 ref로 들고, `pendingTrim`만 state로 노출(blob/frames는 직렬화 대상 아님 — 메모리 only).

- **`src/sidepanel/App.tsx`** (≈68, 170-178, 다이얼로그 렌더 영역)
  - 현재 역할: `use30sReplay` 호출 + `ReplayProvider` + 각종 전역 다이얼로그 렌더.
  - 변경: `replay.pendingTrim`이 있으면 `<ReplayTrimDialog>` 렌더. App이 `busy` state를 소유: `onApply={(s,e) => { setBusy(true); applyReplayTrim({ frames, tabId, startSec: s, endSec: e }).catch(() => toast.error(t("issue.replay.encodeFailed"))).finally(() => { setBusy(false); replay.resolveTrim(); }); }}`, `onKeepFull={() => replay.resolveTrim()}`. `tabId`는 현재 탭 id(기존 경로)에서 취해 넘긴다. 다이얼로그 자동 오픈 시 `blurActiveElement()` 적용(다른 전역 다이얼로그와 동일). 다른 전역 다이얼로그와 동일 위치.

- **`src/store/editor-store.ts`** (≈164 타입, ≈501 구현)
  - 현재 역할: editor 상태·`onRecordingComplete`.
  - 변경: 신규 액션 `replaceVideo: (blob: Blob, thumbnail: string, startedAt: number, endedAt: number) => void` 추가. `set({ videoBlob, videoThumbnail, videoCapturedAt: Date.now(), videoStartedAt, videoEndedAt })`만 갱신(phase·attach 토글·target 불변). `onRecordingComplete`의 영상 메타 set 부분과 대칭.

- **`src/i18n/namespaces/issue.ts`** (ko ≈9-14, en ≈109-114)
  - 변경: `issue.replay.trim.title`, `issue.replay.trim.apply`(적용/Apply), `issue.replay.trim.keepFull`(전체 유지/Keep full), `issue.replay.trim.hint`(앞뒤 핸들 안내), `issue.replay.trim.undo`(되돌리기/Undo), `issue.replay.trim.redo`(다시 실행/Redo), `issue.replay.trim.selection`(선택 길이 readout — "{{sel}}s / {{total}}s" placeholder) ko/en 동시 추가. 재인코딩 실패 토스트 `issue.replay.encodeFailed`도 없으면 추가. PostToolUse 훅이 ko/en 대칭·placeholder 토큰 일치를 검사하므로 양쪽 함께 갱신.

### 의존성

- **shadcn `Slider`** 미설치(`components/ui/`에 `slider.tsx` 없음) → `npx shadcn@latest add slider` 필요. Radix Slider는 `value`를 배열로 주면 2-thumb 레인지를 지원. (구현 단계에서 설치, 설계에선 명시만.)

## 데이터 흐름

```
[EmptyState 30s replay 클릭]
  → use30sReplay.capture()
      snapshot frames ──┐
      encodeToMp4(전체) → fullBlob, thumbnail
      로그 trim [frames[0]-guard, captureTime]  (기존)
      onRecordingComplete(fullBlob, ...)  → phase=drafting  (기존)
      pendingTrim = { videoBlob: fullBlob, frames(보존) }  ★신규
  → App: pendingTrim 있음 → blurActiveElement() → <ReplayTrimDialog> 오버레이
      <video src=fullBlob> + 듀얼핸들(초) + readout + undo/redo
        ── 핸들 드래그(diff로 움직인 thumb 판별) → video.currentTime seek
        ── Esc/X/overlay → onKeepFull (비파괴)
  ── [적용] App: setBusy(true); onApply(startSec, endSec)
      applyReplayTrim({ frames, tabId, startSec, endSec }):
        secondsToFrameRange(maxFrameDurationMs) → inIndex,outIndex
        sliced = frames.slice(in, out+1)
        isFullRange면 no-op 반환
        encodeToMp4(sliced) → trimmedBlob, thumbnail
        videoStartedAt = sliced[0].ts; videoEndedAt = sliced[last].ts + lastFrameDurationMs   ← raw
        replayLogBounds(sliced[0].ts, videoEndedAt) → {lower,upper}   ← guard 적용(로그 전용)
        *Persist.discard() → trimByTime(store logs, lower, upper) → set*Log + save(`pending:${tabId}`)
        editor.replaceVideo(trimmedBlob, thumbnail, videoStartedAt, videoEndedAt)   ← raw 경계
      → .finally: setBusy(false); resolveTrim() → pendingTrim=null → 다이얼로그 닫힘, frames 폐기
      → .catch: toast.error(encodeFailed) (전체 클립 유지)
  ── [전체 유지] onKeepFull → resolveTrim() → pendingTrim=null (변경 없음)
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

// ReplayTrimDialog.tsx
interface ReplayTrimDialogProps {
  open: boolean;
  videoBlob: Blob;
  onApply: (startSec: number, endSec: number) => void;
  onKeepFull: () => void;
  busy?: boolean;
}
```

## 기존 패턴 준수

- **테스트 우선**: `trim-math.ts`의 순수 함수(`frameOffsetsMs`/`secondsToFrameRange`/`isFullRange`)를 `/tdd interface`로 먼저 작성한다(CLAUDE.md 테스트 우선 원칙).
- **로그 trim 일관성**: 기존 `trimByTime`/`replayLogBounds`(`log-merge.ts`)와 `*Persist.discard()` 폐기 패턴을 그대로 따른다 — 새 trim 로직을 만들지 않고 경계만 바꿔 재사용.
- **세션 영속화**: Blob은 store에 두되 세션 직렬화에서 제외하는 기존 규약(`useEditorSessionSync.ts:32`) 유지. trim은 IDB 영상 write를 추가하지 않는다.
- **UI 컨벤션**: shadcn `Dialog`/`Slider` 사용(직접 스타일링 금지). 캡처 직후 프로그램적 자동 오픈이므로 `blurActiveElement()`를 **반드시 적용**한다(DESIGN §9 규약 — Radix `aria-hidden` 경고 회피). seek tooltip·핸들 hit-target은 `log-viewer/ProgressBar.tsx` 패턴 복제.
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
