# 30초 리플레이 트리밍 — 기술 설계

## 개요

리플레이 캡처는 이미 `FrameBuffer`의 `{blob, timestamp}[]` 프레임 배열을 들고 있고, `capture()`가 [스냅샷 → `encodeToMp4(전체)` → 로그 trim → `onRecordingComplete` → drafting]을 원자적으로 수행한다(`use-30s-replay.ts`). 이 흐름을 **그대로 둔 채**, 캡처 시 사용한 프레임 스냅샷·captureTime을 메모리 홀더에 보존하고 "trim 대기" 상태를 켠다. drafting 진입 직후 App이 보존된 프레임 위로 **트리밍 다이얼로그**를 띄운다. 사용자가 in/out을 고르고 적용하면, 선택 프레임만 `encodeToMp4`로 재인코딩해 store의 `videoBlob`을 교체하고, 이미 trim된 로그를 새 구간 경계로 한 번 더 좁혀 store·IDB(`pending:${tabId}`)에 덮어쓴다. 원본 프레임은 그 즉시 폐기한다(파괴적, 재편집 불가).

다이얼로그 UI는 `<video>` currentTime/duration 기반(초 단위)으로만 동작해 영상 소스에 비종속적이다. 리플레이는 적용 콜백에서 초→프레임 인덱스로 환산해 슬라이스하고, 추후 일반 녹화는 같은 다이얼로그에 다른 적용 콜백(트랜스코드)을 물리면 된다.

## 변경 범위

### 신규 파일

- **`src/sidepanel/30s-replay/trim-math.ts`** (순수 함수, 테스트 우선)
  - `frameOffsetsMs(frames: CapturedFrame[]): number[]` — 각 프레임의 영상 내 표시 시작 오프셋(ms) 누적 배열. `computeFrameDurationsUs`(mp4-encoder.ts에서 export됨, μs)를 재사용해 동일한 표시 타임라인을 산출 → 다이얼로그가 보여주는 `<video>` 시각과 프레임 인덱스가 어긋나지 않는다.
  - `secondsToFrameRange(frames, startSec, endSec): { inIndex: number; outIndex: number }` — 다이얼로그가 돌려준 초 구간을 프레임 인덱스 구간으로 환산(가장 가까운 프레임에 스냅, clamp, 최소 길이 보장).
  - `isFullRange(frames, inIndex, outIndex): boolean` — in=0 && out=last 판정(재인코딩 생략용).

- **`src/sidepanel/30s-replay/apply-trim.ts`** (트리밍 적용 백엔드 — 리플레이 전용)
  - `applyReplayTrim(opts: { frames: CapturedFrame[]; captureTime: number; tabId: number; startSec: number; endSec: number }): Promise<void>`
    - `secondsToFrameRange`로 인덱스 환산 → `frames.slice(inIndex, outIndex + 1)`.
    - `isFullRange`면 no-op 반환(전체 유지와 동일).
    - `encodeToMp4({ frames: sliced })` → `{ blob, thumbnail }`.
    - 새 경계: `newLower = sliced[0].timestamp`, `newUpper = sliced[at -1].timestamp`. `replayLogBounds(newLower, newUpper)`로 `{ lower, upper }` 산출(`replayLogBounds`는 두 번째 인자를 그대로 upper로 쓰므로 그대로 재사용 가능 — `log-merge.ts`).
    - `capture()`와 동일하게 pending write를 폐기 후 재trim: `networkLogPersist.discard()` / `consoleLogPersist.discard()` / `actionLogPersist.discard()` → 현재 store의 (이미 trim된) 로그를 `trimByTime`으로 한 번 더 좁혀 `setNetworkLog/setConsoleLog/setActionLog` + `saveNetworkLog/Console/Action(`pending:${tabId}`, trimmed)`.
    - store 영상 메타 교체: 신규 액션 `replaceVideo(blob, thumbnail, newLower, newUpper)` 호출(아래).

- **`src/sidepanel/tabs/ReplayTrimDialog.tsx`** (소스 비종속 트리밍 다이얼로그 UI)
  - props: `{ open: boolean; videoBlob: Blob; onApply: (startSec: number, endSec: number) => void; onKeepFull: () => void; busy?: boolean }`.
  - `<Dialog>`(shadcn, 기존 `components/ui/dialog.tsx`) 안에 `<video>` + 듀얼 핸들 타임라인 슬라이더(shadcn `Slider`, `value={[startSec, endSec]}` 2-thumb). `onLoadedMetadata`로 duration 취득, 핸들 변경 시 `video.currentTime`을 움직이는 쪽 핸들 위치로 seek해 경계 프레임 확인. 푸터: **적용(크롭)** / **전체 유지**.
  - 일반 녹화 재사용을 위해 프레임·인코딩을 모르고 초 구간만 다룬다.

- **`src/sidepanel/30s-replay/__tests__/trim-math.test.ts`** — `trim-math.ts` 단위 테스트.

### 변경 파일

- **`src/sidepanel/30s-replay/use-30s-replay.ts`**
  - 현재 역할: 폴링·버퍼링·`capture()`(인코딩+로그trim+drafting 전환).
  - 변경: `capture()`가 `onRecordingComplete` 호출 **후**, 사용한 `frames` 스냅샷과 `captureTime`을 메모리 홀더에 보존하고 trim 대기 상태를 켠다(프레임 2개 미만이면 생략). `Use30sReplayReturn`에 `pendingTrim: { videoBlob: Blob; frames: CapturedFrame[]; captureTime: number } | null`과 `resolveTrim(applied: boolean | { startSec; endSec }): void`를 추가. 기존 `bufferRef.current.clear()` 위치는 유지하되, 보존용 스냅샷은 clear 전에 별도 변수로 떠둔다(현 코드의 `const frames = bufferRef.current.snapshot()`를 그대로 활용).
  - 주의: 보존 프레임은 React state가 아닌 ref로 들고, `pendingTrim`만 state로 노출(blob/frames는 직렬화 대상 아님 — 메모리 only).

- **`src/sidepanel/App.tsx`** (≈68, 170-178, 다이얼로그 렌더 영역)
  - 현재 역할: `use30sReplay` 호출 + `ReplayProvider` + 각종 전역 다이얼로그 렌더.
  - 변경: `replay.pendingTrim`이 있으면 `<ReplayTrimDialog open videoBlob={...} onApply={(s,e) => applyReplayTrim(...).finally(() => replay.resolveTrim(...))} onKeepFull={() => replay.resolveTrim(false)} />` 렌더. 다른 전역 다이얼로그와 동일 위치.

- **`src/store/editor-store.ts`** (≈164 타입, ≈501 구현)
  - 현재 역할: editor 상태·`onRecordingComplete`.
  - 변경: 신규 액션 `replaceVideo: (blob: Blob, thumbnail: string, startedAt: number, endedAt: number) => void` 추가. `set({ videoBlob, videoThumbnail, videoCapturedAt: Date.now(), videoStartedAt, videoEndedAt })`만 갱신(phase·attach 토글·target 불변). `onRecordingComplete`의 영상 메타 set 부분과 대칭.

- **`src/i18n/namespaces/issue.ts`** (ko ≈9-14, en ≈109-114)
  - 변경: `issue.replay.trim.title`, `issue.replay.trim.apply`(적용/Apply), `issue.replay.trim.keepFull`(전체 유지/Keep full), `issue.replay.trim.hint`(앞뒤 핸들 안내) ko/en 동시 추가. PostToolUse 훅이 ko/en 대칭을 검사하므로 양쪽 함께 갱신.

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
      pendingTrim = { videoBlob: fullBlob, frames(보존), captureTime }  ★신규
  → App: pendingTrim 있음 → <ReplayTrimDialog> 오버레이
      <video src=fullBlob> + 듀얼핸들(초)  ── 핸들 드래그 → video.currentTime seek
  ── [적용] onApply(startSec, endSec)
      applyReplayTrim:
        secondsToFrameRange → inIndex,outIndex
        sliced = frames.slice(in, out+1)
        encodeToMp4(sliced) → trimmedBlob, thumbnail
        replayLogBounds(sliced[0].ts, sliced[last].ts) → {lower,upper}
        *Persist.discard() → trimByTime(store logs) → set*Log + save(`pending:${tabId}`)
        editor.replaceVideo(trimmedBlob, thumbnail, lower, upper)
      → resolveTrim → pendingTrim=null → 다이얼로그 닫힘, frames 폐기
  ── [전체 유지] onKeepFull → resolveTrim(false) → pendingTrim=null (변경 없음)
```

- `videoBlob`은 세션 직렬화 제외(IDB 별도) — `useEditorSessionSync.ts:32` 주석대로. drafting 중에는 store 메모리에만 존재하므로 `replaceVideo`의 메모리 교체로 충분. `videoStartedAt/EndedAt/Thumbnail/CapturedAt`은 세션 영속 대상이라 자동 저장됨. IDB 영상 저장은 기존대로 `confirmDraft`에서 `issueId` 키로 수행 — trim 시점엔 IDB 영상 write 불필요.
- 로그는 `capture()`가 이미 `pending:${tabId}`에 trim본을 저장했고, `applyReplayTrim`이 더 좁힌 본으로 덮어쓴다. confirmDraft가 `issueId` 키로 옮긴다(기존 경로 불변).

## 인터페이스 설계

```ts
// trim-math.ts
import type { CapturedFrame } from "./frame-buffer";

export function frameOffsetsMs(frames: CapturedFrame[]): number[];
export function secondsToFrameRange(
  frames: CapturedFrame[],
  startSec: number,
  endSec: number,
): { inIndex: number; outIndex: number };
export function isFullRange(
  frames: CapturedFrame[],
  inIndex: number,
  outIndex: number,
): boolean;

// apply-trim.ts
export function applyReplayTrim(opts: {
  frames: CapturedFrame[];
  captureTime: number;
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
  pendingTrim: { videoBlob: Blob; frames: CapturedFrame[]; captureTime: number } | null; // ★
  resolveTrim: (applied: boolean) => void; // ★ pendingTrim=null 처리
}

// editor-store.ts (확장)
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
- **UI 컨벤션**: shadcn `Dialog`/`Slider` 사용(직접 스타일링 금지). 다이얼로그 띄울 때 `blurActiveElement()` 패턴은 App의 다른 전역 다이얼로그와 동일하게 적용 검토.
- **i18n 동시 갱신**: `issue.ts` ko/en 같은 키 동시 추가(PostToolUse 훅 게이트).

## 대안 검토

1. **다이얼로그를 프레임 이미지(canvas/img) 기반으로 만들어 전체 사전 인코딩을 생략** — 단일 인코딩으로 비용 절감 가능. 그러나 drafting은 어차피 `videoBlob`이 필요해 전체 인코딩이 `capture()`에서 이미 일어나고, `<video>` seek가 핸들 드래그 UX에 더 자연스럽다. 또 일반 녹화 재사용 seam(소스 비종속 `<video>` 기반)을 깬다. → 채택 안 함. 추가 비용은 60프레임 1회 재인코딩(서브초)으로 작음.
2. **비파괴적: 원본 프레임·전체 로그를 IDB에 보존하고 trim 구간만 저장, 제출 시 최종 인코딩(재편집 허용)** — 재편집은 가능하나 사용자가 명시적으로 파괴·재편집 불가·즉시 폐기를 선택. 저장 비용·세션 hydrate 복잡도(프레임까지 복원)만 늘어 비목표. → 채택 안 함.
3. **editor-store의 phase에 `trimming` 추가** — 다이얼로그를 phase로 모델링. 그러나 다이얼로그는 drafting 위 오버레이로 충분하고, phase 추가는 세션 hydrate·전이 가드(여러 hook의 phase 분기)에 회귀 표면을 넓힌다. → 메모리 only `pendingTrim` 상태로 충분.

## 위험 요소

- **`capture()` 시퀀스 민감도**: 로그 `discard`/`persist`/`save` 순서와 phase 가드가 정교하다(주석 다수). `pendingTrim` set은 반드시 `onRecordingComplete` **이후** 마지막에 두어 기존 원자 시퀀스를 건드리지 않는다. 프레임 보존은 기존 `bufferRef.snapshot()` 결과를 재사용(추가 스냅샷 금지).
- **이중 인코딩 비용**: 전체(capture) + 트리밍(apply) 2회. 60프레임이라 작지만, apply 중 `busy` 표시로 UI 잠금 필요.
- **로그 재trim 레이스**: drafting 중 늦은 sync write가 끼면 경계 밖 로그가 IDB에서 부활할 수 있음 → `applyReplayTrim`도 `capture()`처럼 `*Persist.discard()` 선행 후 save(동일 가드 재사용).
- **세션 영속 vs 메모리 프레임**: `pendingTrim` 프레임은 메모리 only. 다이얼로그 도중 패널 닫힘/리로드 시 trim 기회 상실(전체 클립 유지) — 파괴 철학상 허용. `videoStartedAt/EndedAt`만 영속되므로 trim 결과는 정상 복원.
- **`isFullRange` 미처리 시 불필요 재인코딩**: 전체 구간 선택을 no-op로 처리하지 않으면 동일 영상을 재인코딩 → 반드시 가드.
- **확장 seam 과설계 경계**: 이번엔 다이얼로그를 소스 비종속(초 기반)으로 두는 선까지만. 일반 녹화용 `applyRecordingTrim`(트랜스코드)·소스 추상 인터페이스는 만들지 않는다(비목표).
