# 자동 버그 감지 트리거 — 기술 설계

## 개요

감지는 **새 수집 경로를 만들지 않는다.** 이미 `editor-store`에 누적 중인 `consoleLog.entries`·`networkLog.requests`를 리플레이 버퍼 창으로 잘라 순수 함수 하나(`sidepanel/lib/anomaly.ts`)에 넘기고, 그 결과를 캡처 진입 화면의 배지와 다이얼로그가 렌더한다. [이슈 작성 시작]은 기존 `use30sReplay.capture()`를 타되 트림 다이얼로그를 띄우는 대신 감지 구간으로 `applyReplayTrim`을 직접 호출하고, drafting 진입 후 `AiDraftDialog`가 사용자 입력 없이 1회 자동 실행된다.

console 신호를 `console.error()` 호출과 구분하기 위해 `ConsoleEntry`에 선택적 `source` 필드를 추가하는 것이 유일한 content-script 변경이다.

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/sidepanel/lib/anomaly.ts` | 감지 판정 **단일 출처**. 게이트(신호 종류·origin·시간창·Aborted 제외)와 시그니처 중복 억제, 트림 구간 계산이 전부 여기 순수 함수로 있다. |
| `src/sidepanel/lib/__tests__/anomaly.test.ts` | 위 순수 함수 테스트. |
| `src/sidepanel/30s-replay/anomaly-trim.ts` | 절대 wall-clock ms 구간 → 프레임 축 초 구간 변환(`frameOffsetsMs` 사용). `applyReplayTrim`에 넘길 `startSec`/`endSec`를 만든다. |
| `src/sidepanel/30s-replay/__tests__/anomaly-trim.test.ts` | 위 변환 테스트. |
| `src/sidepanel/hooks/useAnomalyDetection.ts` | `anomaly.ts`를 store 구독·탭 URL·버퍼 창과 배선하는 얇은 훅. 판정 로직은 두지 않는다. |
| `src/sidepanel/tabs/AnomalyDialog.tsx` | 감지 내역 목록 다이얼로그(읽기 전용) + [이슈 작성 시작]. |
| `src/sidepanel/tabs/__tests__/AnomalyDialog.test.tsx` | 렌더·버튼 테스트. |
| `e2e/anomaly-capture.spec.ts` | 감지 → 배지 → 다이얼로그 → drafting 진입 end-to-end. |
| `e2e/fixtures/anomaly.html` | 버튼으로 5xx·uncaught error·abort를 골라 발생시키는 픽스처. |

> **판정 로직을 컴포넌트에 두지 않는 이유**: `apiHostRow.ts`가 같은 이유로 `lib/`에 있다 — 게이트를 컴포넌트에 남기면 잘못된 신호(서드파티 오류·Aborted)가 테스트 없이 green으로 통과한다(CLAUDE.md "API Hosts 자동 행" 항목).

### 변경 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/types/console.ts` | `ConsoleEntry` 타입 | `source?: "uncaught" \| "rejection"` 추가. 생략 = 일반 `console.*` 호출. |
| `src/content/console-recorder.ts` | console 후크·uncaught·rejection 수집 | `pushEntry`에 4번째 인자 `source` 추가. `window.error` 경로는 `"uncaught"`, `unhandledrejection` 경로는 `"rejection"`. 나머지 경로(`console.error`·`console.assert`·`console.trace`)는 인자를 넘기지 않아 필드가 붙지 않는다. |
| `src/sidepanel/30s-replay/frame-buffer.ts` | 프레임 링버퍼 | 변경 없음. `oldestTimestamp` getter를 그대로 쓴다. |
| `src/sidepanel/30s-replay/use-30s-replay.ts` | 리플레이 폴링·캡처 | ① 반환에 `bufferOldestTs: number \| null` 추가(감지 시간창 하한). ② `capture()`에 `opts?: { anomaly: AnomalySignal[] }` 추가 — anomaly면 `onRecordingComplete`에 `trim = null`을 넘기고(다이얼로그 억제) 직후 `applyReplayTrim`으로 감지 구간을 적용한 뒤 `setAnomalySignals`를 세팅한다. |
| `src/sidepanel/30s-replay/replay-context.ts` | 리플레이 컨텍스트 | `bufferOldestTs`, `capture(opts?)` 시그니처 반영. |
| `src/sidepanel/tabs/IssueTab.tsx` | 캡처 진입 화면(`EmptyState`) | 배지 버튼 + `AnomalyDialog` 마운트. |
| `src/store/editor-store.ts` | 편집 세션 상태 | `anomalySignals: AnomalySignal[] \| null`(persist), `anomalyDraftDone: boolean`(persist), `anomalyDraftFailed: boolean`(persist) + setter 3개. `onRecordingComplete`·`reset`·`cancelRecording`에서 초기화. |
| `src/store/settings-ui-store.ts` | 설정 | `replayEnabled` 기본값 `false` → `true`. **마이그레이션 없음**(기존 사용자의 persist된 값 유지). |
| `src/sidepanel/hooks/useReproPrefill.ts` | 재현 단계 AI 자동 채움 | 게이트 추가 — `anomalyCapture && !anomalyDraftFailed`면 미발화(AI 초안이 대신 돈다). |
| `src/sidepanel/tabs/AiDraftDialog.tsx` | AI 초안 다이얼로그 | `handleSubmit(overrideMsg?)`로 확장 + `autoRunPrompt?: string \| null`·`onAutoRunError?: () => void` prop. `autoRunPrompt`가 들어오면 다이얼로그를 열지 않은 채 1회 실행. `submitDisabled`(사용자 경로)는 불변. |
| `src/sidepanel/tabs/DraftingPanel.tsx` | 작성 패널 | `anomalySignals`로 자동 실행 프롬프트를 만들어 `AiDraftDialog`에 전달, 실패 시 `setAnomalyDraftFailed(true)`. |
| `src/sidepanel/lib/track-submit.ts` | 제출 계측 | `submitEventProperties`·`trackSubmit`에 `fromAnomaly = false` 인자 추가 → `from_anomaly` 속성. |
| `src/background/analytics.ts` | 이벤트 허용목록 | `issue_submitted`에 `"from_anomaly"` 추가. |
| `src/i18n/namespaces/issue.ts` | i18n | `issue.anomaly.*` 키 ko/en 동시 추가. |

> log-viewer의 복제 사전(`src/log-viewer/i18n.ts`)은 갱신 대상이 아니다 — 새 키가 log-viewer 재사용 컴포넌트(NetworkLog·ConsoleLog·ActionLog·IssuePreview)에 들어가지 않는다.

## 데이터 흐름

```
[content] console-recorder / network-recorder
   │  ConsoleEntry{ source? }, NetworkRequest{ status, phase, statusText }
   ▼
[sidepanel] usePickerMessages → editor-store.consoleLog / networkLog   (기존 경로, 무변경)
   │
   ▼
useAnomalyDetection(tabId, enabled)
   │  ├ pageUrl   ← chrome.tabs.get + tabs.onUpdated (useTabUnsupported와 동일 패턴)
   │  ├ windowStart ← useReplay().bufferOldestTs
   │  └ detectAnomalies({ consoleEntries, requests, pageUrl, windowStart })   ← 순수
   ▼
AnomalySignal[]
   │
   ├──▶ EmptyState 배지 (count = signals.length)
   │
   └──▶ AnomalyDialog ── [이슈 작성 시작] ──▶ capture({ anomaly: signals })
                                                  │
                          encodeToMp4(frames) ────┤
                          onRecordingComplete(..., trim = null)   ← 트림 다이얼로그 억제
                          setAnomalySignals(signals)
                                                  │
                          anomalyTrimRangeMs(signals) → anomalyTrimSeconds(frames, ...)
                          applyReplayTrim({ frames, tabId, startSec, endSec })
                                                  │   (영상 재인코딩 + 로그 재trim)
                                                  ▼
                                          phase = "drafting"
                                                  │
                          DraftingPanel: autoRunPrompt = buildAnomalyPrompt(signals, t)
                                                  ▼
                                     AiDraftDialog 자동 실행 (open = false)
                                       ├ 성공 → 초안 채움
                                       └ 실패 → setAnomalyDraftFailed(true)
                                                  ▼
                                          useReproPrefill 게이트 해제 → 재현 단계 자동 채움
```

### 시간축

감지 창은 `[bufferOldestTs, now]`다. `use30sReplay`는 `FrameBuffer`를 `REPLAY_MAX_DURATION_MS`(30초)로 캡하므로 창은 자동으로 최대 30초에 머문다. 창 밖으로 밀려난 시그니처는 다음 tick에서 사라진다 — 별도 만료 처리가 없다.

트림 구간은 감지 시그니처의 `timestamp`(최초 발생) 최솟값과 `lastTimestamp` 최댓값을 쓴다:

```
startMs = min(signal.timestamp) - ANOMALY_TRIM_PAD_MS
endMs   = max(signal.lastTimestamp) + ANOMALY_TRIM_PAD_MS      // ANOMALY_TRIM_PAD_MS = 3000
```

이 절대 ms를 `frameOffsetsMs(frames, MAX_FRAME_DURATION_MS)`가 만든 프레임 오프셋 축으로 옮겨 초로 바꾸고 `[0, duration]`에 clamp한다. 그 뒤는 전부 기존 경로다 — `applyReplayTrim`이 `secondsToFrameRange` → `isFullRange` → `replayLogTrimBounds`를 타므로 **영상과 로그의 경계 일치가 자동으로 보장된다**(새 경계 헬퍼를 만들지 않는 이유).

## 인터페이스 설계

### `src/sidepanel/lib/anomaly.ts`

```ts
import type { ConsoleEntry } from "@/types/console";
import type { NetworkRequest } from "@/types/network";

export type AnomalyKind = "console" | "network";

export interface AnomalySignal {
  kind: AnomalyKind;
  /** 중복 억제 키. console = 메시지 첫 줄, network = `${method} ${origin+pathname} ${status}` */
  signature: string;
  /** 목록 표시용 한 줄. console = 메시지 첫 줄(절단), network = `GET /api/orders → 500` */
  label: string;
  /** 최초 발생 시각(절대 ms). 트림 하한 계산에 쓴다. */
  timestamp: number;
  /** 마지막 발생 시각(절대 ms). 트림 상한 계산에 쓴다. */
  lastTimestamp: number;
  /** 같은 시그니처 발생 횟수. 목록에는 표시하지 않는다(비목표). */
  count: number;
}

export interface DetectAnomaliesInput {
  consoleEntries: readonly ConsoleEntry[];
  requests: readonly NetworkRequest[];
  /** 현재 바인딩된 탭의 URL. 없으면 판정 불가 → 빈 배열. */
  pageUrl: string | undefined;
  /** 감지 창 하한(리플레이 버퍼 최초 프레임 시각). null이면 빈 배열. */
  windowStart: number | null;
}

/** 최초 발생 시각 오름차순. 창·origin·신호 종류 게이트를 전부 통과한 것만. */
export function detectAnomalies(input: DetectAnomaliesInput): AnomalySignal[];

export const ANOMALY_TRIM_PAD_MS = 3000;

/** 감지 시그니처 전체를 덮는 절대 ms 구간(앞뒤 패딩 포함). 빈 배열이면 null. */
export function anomalyTrimRangeMs(
  signals: readonly AnomalySignal[],
): { startMs: number; endMs: number } | null;

/** AI 초안 자동 실행에 넘길 userPrompt. 로케일 문구는 호출부의 t를 주입받는다. */
export function buildAnomalyPrompt(
  signals: readonly AnomalySignal[],
  t: (key: string, params?: Record<string, string | number>) => string,
): string;
```

게이트(전부 이 파일 안):

```ts
// console: source가 uncaught/rejection인 것만. console.error()·console.assert()는 제외.
const isConsoleSignal = (e: ConsoleEntry) =>
  e.source === "uncaught" || e.source === "rejection";

// network: 5xx, 또는 실패(phase === "error")이되 사용자 취소는 제외.
const isNetworkSignal = (r: NetworkRequest) =>
  r.status >= 500 || (r.phase === "error" && r.statusText !== "Aborted");

// origin: 페이지와 같은 registrable domain. apiHostRow의 registrableDomain 재사용.
//   console → entry.pageUrl 의 hostname
//   network → request.url 의 hostname
```

> **수용된 한계**: top 프레임에 로드된 서드파티 스크립트(광고·분석)의 uncaught error는 `pageUrl`이 top 페이지라 이 필터를 통과한다. 프레임 단위로는 걸러지지만 스크립트 단위로는 못 거른다. 스택 기반 필터는 minify·cross-origin 스택 소실 때문에 신뢰할 수 없어 넣지 않는다.

### `src/sidepanel/30s-replay/anomaly-trim.ts`

```ts
import type { CapturedFrame } from "./frame-buffer";

/** 절대 wall-clock ms 구간 → 프레임 축 초 구간. [0, duration]에 clamp. frames 비면 null. */
export function anomalyTrimSeconds(
  frames: readonly CapturedFrame[],
  startMs: number,
  endMs: number,
  maxFrameDurationMs: number,
): { startSec: number; endSec: number } | null;
```

### `src/sidepanel/hooks/useAnomalyDetection.ts`

```ts
export function useAnomalyDetection(
  tabId: number | null,
  enabled: boolean,
  windowStart: number | null,
): AnomalySignal[];
```

`enabled`는 `replayEnabled && isReady && !unsupported && phase === "idle"`을 호출부(`EmptyState`)가 합성해 넘긴다.

### `src/store/editor-store.ts` 추가분

```ts
// 이 캡처가 자동 감지 경로에서 왔음을 표시. AI 초안 프롬프트·repro prefill 게이트·제출 계측이 읽는다. persist.
anomalySignals: AnomalySignal[] | null;
// AI 초안 자동 실행 1회 래치(reproPrefillDone과 같은 이유로 persist).
anomalyDraftDone: boolean;
// 자동 실행이 실패해 재현 단계 자동 채움으로 폴백해야 함. persist.
anomalyDraftFailed: boolean;

setAnomalySignals: (signals: AnomalySignal[] | null) => void;
setAnomalyDraftDone: (done: boolean) => void;
setAnomalyDraftFailed: (failed: boolean) => void;
```

### `src/sidepanel/lib/track-submit.ts` 시그니처

```ts
export function submitEventProperties(
  platform: PlatformId,
  captureMode: CaptureMode | undefined,
  result: "success" | "failure",
  replayTrimmed?: boolean,
  trimSource?: TrimSourceKind | null,
  fromAnomaly?: boolean,     // 추가 — from_anomaly: "true" | "false"
): Record<string, string>;
```

## 기존 패턴 준수

- **순수 함수 단일 출처**: 게이트를 `lib/anomaly.ts`에 모은다(`apiHostRow.ts` 선례). 컴포넌트에 조건을 흘리면 테스트가 못 잡는다.
- **트림 경로 재사용**: `applyReplayTrim`·`secondsToFrameRange`·`replayLogTrimBounds`를 그대로 탄다. 영상/로그 경계 헬퍼를 새로 만들지 않는다(ARCHITECTURE.md "트리밍" 단일 출처).
- **AI 취소 레인**: 자동 실행도 `AiDraftDialog` 안의 `useAiRun` 레인을 그대로 쓴다. 별도 취소 경로를 만들지 않는다(ARCHITECTURE.md "AI cancel 단일 레인").
- **세션 영속화**: `anomalySignals`·래치 2개는 `reproPrefillDone`과 같은 이유로 persist한다 — drafting 중 패널을 닫았다 열면 자동 실행이 재발화한다.
- **i18n 동시 갱신**: `src/i18n/namespaces/issue.ts`의 ko/en을 한 커밋에서 함께. PostToolUse 훅이 `locales.test.ts`를 자동 실행한다.
- **DESIGN.md**: 배지는 shadcn `Badge`가 아니라 클릭 가능한 `Button`(`variant="outline"`, `size="sm"`)으로 만든다 — Badge는 인터랙션 어포던스가 없다. 다이얼로그는 사이드패널 규격 `w-[90vw]`를 따른다(DESIGN.md §다이얼로그).
- **pre-arm 제약**: `console-recorder.ts`는 `recorders-entry` 청크에 들어간다. `source` 필드는 리터럴만 추가하므로 외부 static import가 늘지 않는다 — 동기 IIFE 조건을 깨지 않는다.

## 대안 검토

### 1. 감지 결과를 이슈 본문에 직접 프리필 (기각)

`description`에 "감지된 오류: ..." 한 줄을 넣는 방식. AI 초안·`autoReproPrefill`과 쓰기 경로가 겹쳐 우선순위 규칙을 새로 정해야 하고, 세 경로가 같은 필드를 놓고 경합한다. `userPrompt`로만 흘리면 기존 배선이 그대로 유지된다.

### 2. AI 초안 다이얼로그를 자동으로 열어 사용자 입력을 받기 (기각)

`submitDisabled` 규칙을 안 건드려도 되고 구현이 가장 작다. 그러나 감지된 오류가 이미 충분한 맥락이므로 입력을 요구하는 것은 단계만 늘린다. 대신 `handleSubmit`에 override 인자를 추가하는 최소 변경으로 자동 실행을 붙인다.

### 3. `handleSubmit`을 `useAiDraftRun` 훅으로 승격 (기각)

설계상 더 깔끔하지만 `sessionRef`·`aiRun`·`fitDraftContext` 배선을 통째로 옮기는 큰 리팩터고, AI 취소 레인은 v1.7.1에서 이미 한 번 사고가 났던 영역이다(POSTMORTEM 2026-07-28). 외과적 변경 원칙에 따라 prop 2개로 끝낸다.

### 4. 트림 구간을 사용자에게 확인받기 (기각)

`ReplayTrimDialog`를 auto trim 위치로 미리 채워 여는 방식. 노이즈 한 건이 구간을 30초로 늘렸을 때 사용자가 줄일 수 있다는 장점이 있지만, 단계가 늘어 "한 번 클릭으로 끝난다"는 이 기능의 성질이 사라진다.

### 5. rage click을 신호에 포함 (기각)

`ActionEntry`에 `selector`·`timestamp`·`role`이 이미 있어 구현은 싸다. 그러나 스테퍼·좋아요·페이지네이션 연타가 구조적 오탐이고 role로는 절반쯤밖에 못 거른다. 알림 표면에서 오탐 비용이 크다.

## 위험 요소

| 위험 | 내용 | 완화 |
|---|---|---|
| **배지 상시 점등** | top 프레임 서드파티 스크립트 오류가 origin 필터를 통과한다. 광고가 많은 페이지에서 배지가 계속 켜질 수 있다. | 수용. 시그니처 중복 억제로 카운트 폭증은 막힌다. 실사용 관찰 후 필요하면 별도 스코프에서 재검토. |
| **`source` 필드 누락 경로** | `console-recorder.ts`의 `pushEntry` 호출부가 10곳 가까이 된다. uncaught/rejection 경로에만 정확히 붙여야 하고, 실수로 `console.error` 경로에 붙으면 배지가 상시 켜진다. | `console-recorder-helpers`가 아니라 호출부에서만 리터럴로 붙이고, 유닛 테스트로 3경로(uncaught/rejection/console.error)를 각각 고정. |
| **trim이 로그를 과하게 자름** | 감지 구간이 좁으면(단일 오류 6초) 그 밖의 액션 로그가 전부 잘린다 — 재현 단계 자동 채움 품질이 떨어진다. | 3초 패딩이 그 완화. AI 초안이 주 경로이므로 액션 로그 의존이 낮다. |
| **`applyReplayTrim` 이중 적용** | `capture()`는 이미 버퍼 구간으로 로그를 trim한 뒤 `onRecordingComplete`를 부른다. 그 위에 감지 구간 trim이 한 번 더 걸린다. | `trimByTime`은 멱등이라 안전. 다만 순서가 뒤집히면(`applyReplayTrim` 먼저) 넓은 경계가 좁은 경계를 덮으므로 **호출 순서를 바꾸지 말 것**. |
| **AI 자동 실행 이중 발화** | `DraftingPanel`은 미리보기 왕복·패널 재오픈에서 언마운트/재마운트된다. 래치가 비영속이면 AI가 두 번 돈다. | `anomalyDraftDone`을 persist하고 실행 직전에 래치(`reproPrefillDone`과 동일 패턴 — 리렌더 전에 ref로도 래치). |
| **폴백 체인 무한 루프** | AI 초안 실패 → `anomalyDraftFailed` → repro prefill 발화 → 그것도 실패. | `reproPrefillDone`이 "결과 무관 1회"라 두 번째 실패는 조용히 끝난다. `anomalyDraftFailed`는 단방향(false→true)이다. |
| **`replayEnabled` 기본값 변경의 리소스 영향** | 신규 설치는 600ms 간격 `captureVisibleTab` 폴링이 기본 on이 된다. | 폴링은 `phase === "idle"` + `tab.active`에서만 돌고 프레임은 30초 캡이라 상한이 명확하다. 설정에서 끌 수 있다. |
| **privacy 문서 트리거** | 새 권한·새 수집은 없지만 `issue_submitted`에 속성이 하나 늘고, 기본값 변경으로 리플레이 캡처가 신규 설치에서 기본 동작이 된다. | `docs/privacy.ko.md`·`.en.md` 양쪽 본문 + 상단 시행일 갱신(ko 원본, en 번역). |
