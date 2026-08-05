# 자동 버그 감지 트리거 — 기술 설계

## 개요

감지는 **새 수집 경로를 만들지 않는다.** 이미 `editor-store`에 누적 중인 `consoleLog.entries`·`networkLog.requests`를 리플레이 버퍼 창으로 잘라 순수 함수 하나(`sidepanel/lib/anomaly.ts`)에 넘기고, 그 결과를 캡처 진입 화면의 배지와 다이얼로그가 렌더한다. [이슈 작성 시작]은 기존 `use30sReplay.capture()`를 타되 트림 다이얼로그를 띄우는 대신 감지 구간으로 `applyReplayTrim`을 직접 호출하고, drafting 진입 후 `AiDraftDialog`가 사용자 입력 없이 1회 자동 실행된다.

console 신호를 `console.error()` 호출과 구분하기 위해 `ConsoleEntry`에 선택적 `source` 필드를 추가하는 것이 유일한 content-script 변경이다.

### 두 개의 불변식 (설계의 중심)

이 기능은 "store 전이가 마운트를 여는" 자리에 정확히 얹히므로, 회귀 밀집 구역 두 곳을 먼저 못 박는다.

1. **원자성**: `anomalySignals`는 `phase = "drafting"`과 **같은 `set()`** 에 실려야 한다. `editor-store.ts:176-179`에 POSTMORTEM 2026-07-17을 근거로 한 불변식이 이미 박혀 있다 — zustand 5의 `useSyncExternalStore`(SyncLane)와 `setState`(DefaultLane)가 갈려 `phase === "drafting"` + `anomalySignals === null`인 렌더가 정확히 한 번 샌다. 그 렌더에서 `useReproPrefill`의 `anomalyPending` 게이트가 false로 읽혀 repro prefill이 먼저 래치해버린다. **별도 `setAnomalySignals` setter로 이어 부르는 방식은 쓰지 않는다** — `onRecordingComplete`의 인자로 싣는다.
2. **트림 완료 전 drafting 소비 금지**: anomaly 경로는 트림 다이얼로그를 억제하려고 `trim = null`을 넘기는데, `trimming`(= `replayTrim != null`)이 `App.tsx:239` → `IssueTab.tsx:224`(DraftingPanel 마운트 보류) → `useReproPrefill.ts:88`을 동시에 게이트한다. `trim = null`이면 이 게이트가 전부 열린 채 `applyReplayTrim`의 `encodeToMp4`(프레임마다 `createImageBitmap` + yield)가 수백 ms~수 초 돈다 → AI가 **자르기 전 로그**로 프롬프트를 만들고, 영상이 사용자 눈앞에서 교체되며, 2026-07-01 흰 화면 픽스의 "lazy 두 개 동시 첫 마운트 금지" 가드도 무력화된다. 그래서 같은 `set()`에 **`anomalyTrimPending: true`** 를 함께 싣고 `trimming` 소비처 3곳에 OR로 합친다. `applyReplayTrim`의 `finally`에서 해제한다.

   (트림을 `onRecordingComplete` **앞**에 두는 대안은 불가하다 — phase가 아직 `idle`이라 `syncAndSettleLogs`가 레코더 전체 버퍼를 다시 머지해 잘라낸 로그를 되살린다.)

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/sidepanel/lib/anomaly.ts` | 감지 판정 **단일 출처**. 게이트(신호 종류·origin·시간창·사용자 취소 제외)와 시그니처 중복 억제, 트림 구간 계산이 전부 여기 순수 함수로 있다. |
| `src/sidepanel/lib/__tests__/anomaly.test.ts` | 위 순수 함수 테스트. |
| `src/sidepanel/30s-replay/anomaly-trim.ts` | 절대 wall-clock ms 구간 → 프레임 축 초 구간 변환(`frameOffsetsMs` 사용). `applyReplayTrim`에 넘길 `startSec`/`endSec`를 만든다. |
| `src/sidepanel/30s-replay/__tests__/anomaly-trim.test.ts` | 위 변환 테스트. |
| `src/sidepanel/hooks/useAnomalyDetection.ts` | `anomaly.ts`를 store 구독·탭 URL·버퍼 창과 배선하는 얇은 훅. 판정 로직은 두지 않는다. |
| `src/sidepanel/tabs/AnomalyDialog.tsx` | 감지 내역 목록 다이얼로그(읽기 전용) + [이슈 작성 시작]. |
| `src/sidepanel/tabs/__tests__/AnomalyDialog.test.tsx` | 렌더·버튼 테스트. |
| `src/sidepanel/tabs/__tests__/DraftingPanel.test.tsx` | **현재 부재**. AI 자동 실행 게이트 검증에 필요해 신규 작성한다. tiptap·sonner 그래프를 끌어오므로 `DebugTab.test.tsx:7-19`식 스텁 설계를 먼저 세운다. |
| `e2e/anomaly-capture.spec.ts` | 감지 → 배지 → 다이얼로그까지 (캡처 이후는 수동 — 아래 "e2e 스코프" 참조). |
| `e2e/fixtures/anomaly.html` | 버튼으로 5xx·uncaught error·XHR abort·fetch abort를 골라 발생시키는 픽스처. |

> **판정 로직을 컴포넌트에 두지 않는 이유**: `apiHostRow.ts`가 같은 이유로 `lib/`에 있다 — 게이트를 컴포넌트에 남기면 잘못된 신호(서드파티 오류·사용자 취소)가 테스트 없이 green으로 통과한다(CLAUDE.md "API Hosts 자동 행" 항목).

### 변경 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/types/console.ts` | `ConsoleEntry` 타입 | `source?: "uncaught" \| "rejection"` 추가. 생략 = 일반 `console.*` 호출. |
| `src/content/console-recorder.ts` | console 후크·uncaught·rejection 수집 | ① `:29-37`의 **로컬 `CapturedEntry`는 `ConsoleEntry`의 손복제본**(MAIN world self-contained 제약)이므로 **여기도 함께** `source`를 추가해야 한다 — 한쪽만 고치면 typecheck는 통과하는데 필드가 안 실린다. ② `pushEntry` 호출부가 **17곳**(`:84`~`:269`)이라 4번째 positional 인자는 오배치 위험이 크다 → `pushUncaught`/`pushRejection` 얇은 래퍼 2개를 만들어 그 안에서만 `source`를 붙인다. 조건부 대입은 기존 `if (stack) entry.stack = stack` 패턴을 따른다. |
| `src/sidepanel/lib/apiHostRow.ts` | API Hosts 자동 행 | **`httpHostname`(`:22-31`)을 export.** 현재 module-private다. `registrableDomain`(`:16`)은 **URL이 아니라 hostname**을 받고 파싱 실패 시 입력을 그대로 돌려주므로, URL을 그대로 넣으면 모든 origin 비교가 조용히 실패해 신호 0건이 된다. 복제하면 "단일 출처" 논거가 무너지므로 export가 유일한 답이다. |
| `src/sidepanel/30s-replay/frame-buffer.ts` | 프레임 링버퍼 | 변경 없음. `oldestTimestamp` getter를 그대로 쓴다. |
| `src/sidepanel/30s-replay/use-30s-replay.ts` | 리플레이 폴링·캡처 | ① 반환에 `bufferOldestTs: number \| null` 추가(현재 반환은 `{ isReady, isEncoding, bufferedSeconds, capture, resolveTrim }`). ② `capture()`를 **무인자 → `capture(opts?: { anomaly: AnomalySignal[] })`** 로 확장(현재 `useCallback(async () => {...}, [])`). anomaly면 `onRecordingComplete`에 `trim = null` + `anomaly` 인자를 넘기고, 이어서 `applyReplayTrim`을 **자체 try/catch로 감싸** 호출한다. ③ 로그 trim(`logLower = frames[0].timestamp - 1500ms`) 이후 남은 구간으로 signals를 재필터한 뒤 넘긴다. |
| `src/sidepanel/30s-replay/replay-context.ts` | 리플레이 컨텍스트 | `bufferOldestTs`, `capture(opts?)` 시그니처 반영. (현재 `resolveTrim`은 노출하지 않고 `trimming`을 노출한다.) |
| `src/sidepanel/tabs/IssueTab.tsx` | 캡처 진입 화면(`EmptyState`) | **훅은 `IssueTab`에서 돌리고 `EmptyState`에는 `anomalyCount`·`onOpenAnomaly` prop으로 주입.** `EmptyState`는 콜백 6개 + `unsupported`만 받는 순수 프레젠테이션 컴포넌트이고 `IssueTab.test.tsx`가 provider 없이 직접 렌더하므로, 여기에 `useAnomalyDetection`(chrome.tabs 리스너 + `useReplay()`)을 넣으면 기존 테스트 14개가 전부 mock을 요구한다. `AnomalyDialog` 마운트도 `IssueTab`. |
| `src/sidepanel/App.tsx` | 전역 배선 | `trimming` 합성에 `anomalyTrimPending`을 OR로 합친다(`:239`). `applyReplayTrim` 실패 분기(`:492-500`의 `TrimLogsPersistError` 구분)를 anomaly 경로에서도 재사용한다. |
| `src/store/editor-store.ts` | 편집 세션 상태 | `anomalySignals: AnomalySignal[] \| null`, `anomalyTrimPending: boolean`, `anomalyDraftDone: boolean`, `anomalyDraftFailed: boolean`. `onRecordingComplete`에 **7번째 인자 `anomaly?: AnomalySignal[] \| null`** 를 추가해 `phase: "drafting"`과 같은 `set()`에 싣고, 같은 `set()`에서 `anomalyTrimPending = !!anomaly`·래치 2개를 false로 초기화한다. `reset`·`cancelRecording`은 `...initial` 스프레드라 자동 청소. |
| `src/store/editor-store.ts` (영속화) | `EDITOR_SNAPSHOT_KEYS`(`:305-342`) | **editor-store는 zustand `persist`도 `partialize`도 쓰지 않는다.** 영속 키는 `EDITOR_SNAPSHOT_KEYS`와 `useEditorSessionSync.snapshotFromState()` **손수 나열 2벌**이고 파리티 테스트가 유일한 그물이다. 새 필드 4개를 **양쪽 모두**에 등록한다. |
| `src/sidepanel/hooks/useEditorSessionSync.ts` | 세션 스냅샷 직렬화 | `snapshotFromState()`(`:56-96`)에 새 필드 4개 추가. 누락하면 파리티 테스트가 red가 되거나(한쪽만 넣으면) 필드가 무증상으로 초기화된다. |
| `src/store/settings-ui-store.ts` | 설정 | `replayEnabled` 기본값 `false` → `true`. `migrate` 분기는 추가하지 않는다 — 영향 범위는 prd.md "기본값 변경" 절 참조(**"기존 사용자 무영향"이 아니다**). |
| `src/sidepanel/hooks/useReproPrefill.ts` | 재현 단계 AI 자동 채움 | 게이트 추가 — `anomalyPending`이면 미발화. `anomalyPending = !!anomalySignals && !anomalyDraftFailed && !anomalyDraftDone`(중단 시 `Done`만 서고 `Failed`는 안 서므로, `Done`을 게이트에 넣지 않으면 **게이트가 영구히 닫힌다**). deps 배열은 프리미티브를 명시 나열하는 기존 방식이므로 `anomalyPending`을 **반드시 deps에 추가**한다. |
| `src/sidepanel/tabs/AiDraftDialog.tsx` | AI 초안 다이얼로그 | `handleSubmit(overrideMsg?)`로 확장 + `autoRunPrompt?: string \| null`·`onAutoRunError?: () => void` prop. `autoRunPrompt`가 들어오면 다이얼로그를 열지 않은 채 1회 실행. `submitDisabled`(사용자 경로)는 불변. **`aiStatus` prop은 추가하지 않는다** — 이 컴포넌트에 없는 값이고 게이트는 `DraftingPanel`이 갖는다. |
| `src/sidepanel/tabs/DraftingPanel.tsx` | 작성 패널 | `useAI()`의 `aiStatus === "available"`이고 `anomalySignals && !anomalyDraftFailed && !anomalyDraftDone`일 때만 `buildAnomalyPrompt(signals, t)`를 `autoRunPrompt`로 넘긴다. 실패 시 `setAnomalyDraftFailed(true)`. 자동 트림 사후 고지 토스트도 여기서 1회. |
| `src/sidepanel/lib/track-submit.ts` | 제출 계측 | `submitEventProperties`·`trackSubmit`에 `fromAnomaly = false` 인자 추가 → `from_anomaly` 속성. |
| `src/background/analytics.ts` | 이벤트 허용목록 | `issue_submitted`에 `"from_anomaly"` 추가. |
| `src/i18n/namespaces/issue.ts` | i18n | `issue.anomaly.*` 키 ko/en 동시 추가. |

> log-viewer의 복제 사전(`src/log-viewer/i18n.ts`)은 갱신 대상이 아니다 — 새 키가 log-viewer 재사용 컴포넌트(NetworkLog·ConsoleLog·ActionLog·IssuePreview)에 들어가지 않는다.

## 데이터 흐름

```
[content] console-recorder / network-recorder
   │  ConsoleEntry{ source? }, NetworkRequest{ status, phase, statusText, startTime, durationMs }
   ▼
[sidepanel] usePickerMessages → editor-store.consoleLog / networkLog   (기존 경로, 무변경)
   │
   ▼
useAnomalyDetection(tabId, enabled, windowStart)
   │  ├ pageUrl   ← chrome.tabs.get + tabs.onUpdated (useTabUnsupported의 seq 가드 패턴)
   │  ├ windowStart ← useReplay().bufferOldestTs
   │  └ detectAnomalies({ consoleEntries, requests, pageUrl, windowStart })   ← 순수
   ▼
AnomalySignal[]  (시그니처 dedupe + ref 안정화)
   │
   ├──▶ IssueTab → EmptyState 배지 (prop: anomalyCount = 스칼라)
   │
   └──▶ AnomalyDialog(open 시점 스냅샷 고정) ── [이슈 작성 시작] ──▶ capture({ anomaly })
                                                  │
                          encodeToMp4(frames)     │
                          로그 buffer 구간 trim   │
                          남은 구간으로 signals 재필터
                                                  │
                          onRecordingComplete(..., trim = null, anomaly)
                            └ 한 set(): phase="drafting" + anomalySignals
                                        + anomalyTrimPending=true + 래치 2개 false
                                                  │
                          anomalyTrimRangeMs(signals) → anomalyTrimSeconds(frames, ...)
                          try { applyReplayTrim({ frames, tabId, startSec, endSec }) }
                          catch { TrimLogsPersistError / 일반 실패 분기 토스트 }
                          finally { anomalyTrimPending = false }
                                                  ▼
                          DraftingPanel 마운트 (trimming || anomalyTrimPending 해제 후)
                            ├ toast.info("오류 구간 앞뒤 3초로 잘라 첨부했습니다")
                            └ aiStatus === "available" → autoRunPrompt = buildAnomalyPrompt(signals, t)
                                                  ▼
                                     AiDraftDialog 자동 실행 (open = false)
                                       ├ 성공 → 초안 채움, anomalyDraftDone = true
                                       ├ 실패 → anomalyDraftFailed = true
                                       └ 중단 → anomalyDraftDone = true (Failed는 안 선다)
                                                  ▼
                                          useReproPrefill 게이트 해제
```

### 시간축

감지 창은 `[bufferOldestTs, now]`다. `use30sReplay`는 `FrameBuffer`를 `REPLAY_MAX_DURATION_MS`(30초)로 캡하므로 창은 자동으로 최대 30초에 머문다. 창 밖으로 밀려난 시그니처는 다음 tick에서 사라진다 — 별도 만료 처리가 없다. `windowStart > now`(시계 역행)면 빈 배열.

**신호별 시각 기준**:

- console: `ConsoleEntry.timestamp`.
- network: **`startTime + durationMs`**(응답 도착). `NetworkRequest`에는 `timestamp` 필드가 **없다**(`types/network.ts:40-41`은 `startTime`/`durationMs`). `startTime`을 쓰면 30초 타임아웃 요청에서 실제 오류 순간이 트림 상한(`lastTimestamp + 3000`) 밖으로 나간다. `durationMs`가 아직 없으면(진행 중) 신호로 보지 않는다.

트림 구간은 감지 시그니처의 `timestamp`(최초 발생) 최솟값과 `lastTimestamp` 최댓값을 쓴다:

```
startMs = min(signal.timestamp) - ANOMALY_TRIM_PAD_MS
endMs   = max(signal.lastTimestamp) + ANOMALY_TRIM_PAD_MS      // ANOMALY_TRIM_PAD_MS = 3000
```

이 절대 ms를 `frameOffsetsMs(frames, MAX_FRAME_DURATION_MS)`가 만든 프레임 오프셋 축으로 옮겨 초로 바꾸고 `[0, duration]`에 clamp한다. 그 뒤는 전부 기존 경로다 — `applyReplayTrim`이 `secondsToFrameRange` → `isFullRange` → `replayLogTrimBounds`를 타므로 **영상과 로그의 경계 일치가 자동으로 보장된다**(새 경계 헬퍼를 만들지 않는 이유).

단, `isFullRange`가 참이면 `apply-trim.ts:33`이 **조기 반환**한다 — 재인코딩뿐 아니라 **로그 재trim도 건너뛰고 `videoTrimmed`도 세우지 않는다**. 감지 구간이 버퍼 전체를 덮는 경우가 여기 해당한다.

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
  /** 지금 시각. windowStart > now면 빈 배열(시계 역행 방어). */
  now: number;
}

/** 최초 발생 시각 오름차순. 창·origin·신호 종류 게이트를 전부 통과한 것만. */
export function detectAnomalies(input: DetectAnomaliesInput): AnomalySignal[];

export const ANOMALY_TRIM_PAD_MS = 3000;
/** 다이얼로그 목록 표시 상한. 초과분은 "외 N종"으로 접는다. */
export const ANOMALY_LIST_MAX = 20;

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

// network: 5xx, 또는 실패(phase === "error")이되 사용자 취소·WebSocket은 제외.
//   ⚠ statusText === "Aborted"는 XHR 전용이다(network-recorder.ts:401-405).
//     fetch abort는 statusText에 DOMException 문구가 들어가므로 패턴으로도 걸러야 한다.
const isUserAborted = (r: NetworkRequest) =>
  r.statusText === "Aborted" || /abort/i.test(r.statusText ?? "");

const isNetworkSignal = (r: NetworkRequest) =>
  r.method !== "WS" &&                                  // WebSocket(status 101)은 정상 종료와 구분 불가
  r.durationMs != null &&                               // 진행 중은 신호 아님
  (r.status >= 500 || (r.phase === "error" && !isUserAborted(r)));

// 신호 시각
const signalTimeOf = (r: NetworkRequest) => r.startTime + (r.durationMs ?? 0);

// origin: 페이지와 같은 registrable domain.
//   apiHostRow의 httpHostname(URL→hostname) + registrableDomain(hostname→도메인)을 순서대로 쓴다.
//   registrableDomain에 URL을 그대로 넣으면 입력이 그대로 반환돼 조용히 전부 미스매치가 된다.
//   console → entry.pageUrl, network → request.url
//   about:blank·file: 등 hostname을 못 뽑으면 전부 차단.
```

> **수용된 한계**: top 프레임에 로드된 서드파티 스크립트(광고·분석)의 uncaught error는 `pageUrl`이 top 페이지라 이 필터를 통과한다. 프레임 단위로는 걸러지지만 스크립트 단위로는 못 거른다. 스택 기반 필터는 minify·cross-origin 스택 소실 때문에 신뢰할 수 없어 넣지 않는다.
>
> 반대 방향으로, 로그 레코더가 `all_frames: true`로 수집하는 **cross-origin iframe의 오류는 도메인이 다르면 전부 제외**된다. 자사 서브앱을 다른 도메인 iframe으로 띄우는 구성은 감지되지 않는다 — top 프레임 서드파티는 통과시키면서 1-depth 자사 iframe은 제외하는 비대칭을 이번 스코프에서 수용한다(프레임 단위 화이트리스트는 별도 스코프).

### 결과 배열의 identity 안정화

`rebuild*Log`가 flush(200ms 스로틀)마다 **새 배열**을 만들므로 `detectAnomalies`도 매번 새 `AnomalySignal[]`을 반환한다. 인라인 zustand 셀렉터로 그대로 쓰면 zustand v5 + React 18 `useSyncExternalStore`가 `getSnapshot should be cached`로 무한 루프를 낸다(저장소에 `useShallow` 선례 0건). `windowStart`도 1초마다 갱신돼 churn을 더한다. 그래서:

- **배지는 스칼라 `anomalyCount`만** 셀렉트해 prop으로 내린다(`DebugTab.tsx:23-24`가 `.length`를 쓰는 이유와 같다).
- 배열은 시그니처 문자열 join으로 dedupe key를 만들어 `useRef`로 안정화하고, **다이얼로그 open·capture 시점에만** 물질화한다.

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

`enabled`는 `replayEnabled && isReady && !isEncoding && !unsupported && phase === "idle"`을 호출부(`IssueTab`)가 합성해 넘긴다. `enabled`가 false면 빈 배열을 반환하고 `chrome.tabs.onUpdated` 리스너를 걸지 않는다.

### `src/store/editor-store.ts` 추가분

```ts
// 이 캡처가 자동 감지 경로에서 왔음을 표시. AI 초안 프롬프트·repro prefill 게이트·제출 계측이 읽는다.
anomalySignals: AnomalySignal[] | null;
// 감지 구간 트림이 진행 중. trimming 소비처 3곳에 OR로 합쳐 DraftingPanel 마운트를 보류시킨다.
anomalyTrimPending: boolean;
// AI 초안 자동 실행 1회 래치(성공·중단 모두 여기서 선다).
anomalyDraftDone: boolean;
// 자동 실행이 실패해 재현 단계 자동 채움으로 폴백해야 함(중단은 여기 해당하지 않는다).
anomalyDraftFailed: boolean;

// onRecordingComplete 시그니처 확장 — 별도 setter를 만들지 않는다(원자성 불변식).
onRecordingComplete: (
  blob: Blob,
  thumb: string,
  viewport: Viewport,
  startedAt: number,
  endedAt: number,
  trim: ReplayTrim | null,
  anomaly?: AnomalySignal[] | null,   // 추가
) => void;

setAnomalyTrimPending: (pending: boolean) => void;
setAnomalyDraftDone: (done: boolean) => void;
setAnomalyDraftFailed: (failed: boolean) => void;
```

영속화는 `EDITOR_SNAPSHOT_KEYS`(`editor-store.ts:305-342`)와 `useEditorSessionSync.snapshotFromState()`(`:56-96`) **양쪽에** 키를 등록한다. `anomalyTrimPending`은 진행 중 플래그이므로 **영속 대상에서 제외**(패널 재오픈 시 영구 보류가 되면 안 된다).

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

## UI 규격

### 배지

- **`<button>` 래퍼 + shadcn `<Badge>`.** 플랫폼 status badge 9곳(`statusBadges/GithubStatusBadge.tsx:81-96` 외)이 전부 이 관용구이고, 포커스 링이 어포던스를 담당한다. `Button variant="outline" size="sm"`은 알림·카운트 선례가 0곳이고, EmptyState 버튼 5개가 전부 `h-9`라 `h-8`을 끼우면 같은 컬럼에서 사이즈가 갈린다.
- 위치는 **제목 아래·캡처 버튼 열 위**, `CONTENT_MAX_W` 안.
- **슬롯 높이를 `min-h`로 예약한다.** `EmptyState`의 중앙 컬럼은 `justify-center`이고 상위가 `overflow-hidden`이라, 배지가 뜨는 순간 캡처 버튼 5개가 통째로 재중심 정렬돼 이동한다 — 폴링 주기에 맞춰 버튼이 움직이면 오클릭이 난다. 사라질 때도 같다.
- `role="status" aria-live="polite"`(선례: `IssueTab.tsx:518`, `StyleCssView.tsx:108-109`, `LoadingDialog.tsx:65`).
- `isEncoding`이면 비활성(`ReplayButton` 선례) — phase가 `idle`이라 눌리지만 `capture()`가 `encodingRef` 가드로 no-op이 된다.

### 감지 내역 다이얼로그

- 다이얼로그 클래스 관용구 전체(전수 21/21 동형): `w-[90vw] max-w-[800px] gap-5 rounded-3xl p-6 sm:rounded-3xl`. 목록형이므로 **`max-h-[80vh]`**(`h-[80vh]` 금지) + 본문 래퍼 `min-h-0 flex-1 overflow-y-auto overscroll-contain`.
- 푸터는 `sm:` variant가 사이드패널 폭에서 안 걸리므로 **`!flex-row items-center !justify-end gap-2`** 강제. DOM 순서 `[닫기 outline] → [이슈 작성 시작 default]`. X 닫기 버튼은 `dialog.tsx:44-47`에 내장이므로 직접 넣지 않는다. 읽기 전용이라 라벨은 `common.close`.
- 각 행은 **2행 스택**: 1행 = 아이콘 `h-4 w-4 shrink-0` + `min-w-0 flex-1 truncate` 메시지 + `title={label}` 툴팁, 2행 = `12:31:04 · console` (`text-xs text-muted-foreground`). 3컬럼 한 줄은 320px 패널에서 메시지 폭이 118px까지 줄어 성립하지 않는다(prd.md "레이아웃 제약").
- `DialogDescription` 필수 — 이 목록이 무엇이고 [이슈 작성 시작]이 무엇을 하는지(영상이 자동으로 잘리고 AI가 초안을 만든다는 것) 한 줄(선례: `ConnectMethodDialog.tsx:41-43`). `logsAttach`가 off면 "로그 첨부가 꺼져 있어 오류 내역이 본문에 남지 않습니다"를 덧붙인다.
- open 시점의 signals를 **스냅샷 고정**한다. 버퍼 창은 다이얼로그가 열려 있는 동안에도 계속 밀리므로, 목록이 눈앞에서 사라지거나 stale signals로 트림 구간이 계산되는 것을 막는다.

## 기존 패턴 준수

- **순수 함수 단일 출처**: 게이트를 `lib/anomaly.ts`에 모은다(`apiHostRow.ts` 선례). 컴포넌트에 조건을 흘리면 테스트가 못 잡는다.
- **트림 경로 재사용**: `applyReplayTrim`·`secondsToFrameRange`·`replayLogTrimBounds`를 그대로 탄다. 영상/로그 경계 헬퍼를 새로 만들지 않는다(ARCHITECTURE.md "트리밍" 단일 출처).
- **AI 취소 레인**: 자동 실행도 `AiDraftDialog` 안의 `useAiRun` 레인을 그대로 쓴다. `aiRun.begin()`이 `aiCancel` 단일 슬롯을 채우므로 로딩 오버레이 하단 `[■ 중단]`(`App.tsx:261-272`)이 그대로 동작하고 BYOK fetch까지 끊는다. 별도 취소 경로를 만들지 않는다(ARCHITECTURE.md "AI cancel 단일 레인").
- **헤드리스 실행이 이미 정상 상태**: 로딩 오버레이는 `aiDraftLoading` 전역 플래그에만 묶여 `AiDraftDialog.open`과 무관하고, 수동 경로도 `AiDraftDialog.tsx:111-112`에서 다이얼로그를 먼저 닫고 로딩을 켠다. 즉 "open=false + 로딩 중"은 새 상태가 아니라 기존 상태다.
- **세션 영속화**: `anomalySignals`·래치 2개는 `reproPrefillDone`과 같은 이유로 영속한다 — drafting 중 패널을 닫았다 열면 자동 실행이 재발화한다. `anomalyTrimPending`만 제외.
- **i18n 동시 갱신**: `src/i18n/namespaces/issue.ts`의 ko/en을 한 커밋에서 함께. PostToolUse 훅이 `locales.test.ts`를 자동 실행한다.
- **pre-arm 제약**: `console-recorder.ts`는 `recorders-entry` 청크에 들어간다. `source` 리터럴과 래퍼 함수 2개는 외부 static import를 늘리지 않으므로 동기 IIFE 조건을 깨지 않는다(`check-prearm-chunk.mjs:58-60`은 `import` 문자열을 검사한다).

## e2e 스코프

**e2e는 배지 노출까지로 축소한다.** 캡처 이후(트림·drafting 진입·AI 자동 실행)는 수동 테스트로 내린다. 근거:

- replay 의존 spec 5개가 같은 이유로 **통째로 삭제된 전례**가 있다(`e2e/GOTCHAS.md:8`).
- `isReady`는 10프레임 × 600ms ≈ **6초의 연속 성공 폴링**이 필요하다(`use-30s-replay.ts:14-15,84`).
- 폴링은 `phase === "idle" && tab.active`가 전제인데 `openPanel`은 실제 사이드패널이 아니라 일반 탭이라 `tab.active` 가드에 걸린다(`GOTCHAS.md:9`).
- `captureVisibleTab` quota는 **확장 전역이라 spec 경계를 넘는다**(`GOTCHAS.md:46`) → `test.describe.serial` + 전용 배치 필요.

AI를 태우는 시나리오가 남는다면 스텁 패턴은 확립돼 있다 — `chrome.storage.local`에 `{"bugshot-app-settings": {state:{llm}, version:5}}` seed → `panel.reload()` → `panel.route("**/chat/completions", fulfill)`(`e2e/ai-draft.spec.ts:45-74`). `baseUrl`이 loopback이면 능력 좌표가 compact로 갈리는 함정도 있다(`GOTCHAS.md:54`).

## 대안 검토

### 1. 감지 결과를 이슈 본문에 직접 프리필 (기각)

`description`에 "감지된 오류: ..." 한 줄을 넣는 방식. AI 초안·`autoReproPrefill`과 쓰기 경로가 겹쳐 우선순위 규칙을 새로 정해야 하고, 세 경로가 같은 필드를 놓고 경합한다. `userPrompt`로만 흘리면 기존 배선이 그대로 유지된다.

### 2. AI 초안 다이얼로그를 자동으로 열어 사용자 입력을 받기 (기각)

`submitDisabled` 규칙을 안 건드려도 되고 구현이 가장 작다. 그러나 감지된 오류가 이미 충분한 맥락이므로 입력을 요구하는 것은 단계만 늘린다. 대신 `handleSubmit`에 override 인자를 추가하는 최소 변경으로 자동 실행을 붙인다.

### 3. `handleSubmit`을 `useAiDraftRun` 훅으로 승격 (기각)

설계상 더 깔끔하지만 `sessionRef`·`aiRun`·`fitDraftContext` 배선을 통째로 옮기는 큰 리팩터고, AI 취소 레인은 v1.7.1에서 이미 한 번 사고가 났던 영역이다(POSTMORTEM 2026-07-28). 외과적 변경 원칙에 따라 prop 2개로 끝낸다.

### 4. 트림 구간을 사용자에게 확인받기 (기각)

`ReplayTrimDialog`를 auto trim 위치로 미리 채워 여는 방식. 노이즈 한 건이 구간을 30초로 늘렸을 때 사용자가 줄일 수 있다는 장점이 있지만, 단계가 늘어 "한 번 클릭으로 끝난다"는 이 기능의 성질이 사라진다. 대신 사후 고지 토스트로 갈음한다.

### 5. rage click을 신호에 포함 (기각)

`ActionEntry`에 `selector`·`timestamp`·`role`이 이미 있어 구현은 싸다. 그러나 스테퍼·좋아요·페이지네이션 연타가 구조적 오탐이고 role로는 절반쯤밖에 못 거른다. 알림 표면에서 오탐 비용이 크다.

### 6. `pageUrl` 추적을 별도 `chrome.tabs.get` 리스너로 (수용, 근거 기재)

`usePickerMessages`/`editor-store.target`·`useTabSupport`가 이미 탭 URL을 안다. 그러나 `editor-store.target`은 element 모드에서만 채워지고 `useTabSupport`는 boolean만 노출한다 — URL 원문이 필요한 곳은 여기뿐이라 `useTabUnsupported`의 seq 가드 패턴을 복제해 얇게 추적한다. 공용화는 사용처가 둘이 될 때 한다.

## 위험 요소

| 위험 | 내용 | 완화 |
|---|---|---|
| **배지 상시 점등** | top 프레임 서드파티 스크립트 오류가 origin 필터를 통과한다. 광고가 많은 페이지에서 배지가 계속 켜질 수 있다. | 시그니처 중복 억제로 카운트 폭증은 막힌다. prd.md 성공 기준에 정량 상한(상용 사이트 5개 중 2개 이하)을 두고, 초과하면 게이트를 재설계한다. |
| **`source` 필드 오배치** | `pushEntry` 호출부가 **17곳**이다. uncaught/rejection 경로에만 정확히 붙여야 하고, 실수로 `console.error` 경로에 붙으면 배지가 상시 켜진다. | positional 4번째 인자 대신 `pushUncaught`/`pushRejection` 래퍼 2개를 만들어 그 안에서만 붙인다. 로컬 `CapturedEntry` 복제본도 함께 갱신. |
| **`registrableDomain` 오사용** | URL을 넣으면 입력이 그대로 반환돼 모든 비교가 조용히 실패, 신호 0건. | `httpHostname` export 후 `httpHostname → registrableDomain` 순서로만 호출. 다른 도메인/서브도메인 케이스를 유닛 테스트로 고정. |
| **결과 배열 identity churn** | 200ms flush마다 새 배열 → 인라인 셀렉터면 `getSnapshot should be cached` 무한 루프. | 배지는 스칼라 count, 배열은 ref 안정화 후 open/capture 시점에만 물질화. |
| **trim이 로그를 과하게 자름** | 감지 구간이 좁으면(단일 오류 6초) 그 밖의 액션 로그가 전부 잘린다. | 3초 패딩이 그 완화. AI 초안이 주 경로이므로 액션 로그 의존이 낮다. |
| **감지 시점 ↔ capture 시점 창 불일치** | 배지를 보고 클릭하기까지 수 초가 지나면 `capture()`의 로그 trim(`frames[0].timestamp - 1500ms`)에서 해당 신호의 로그가 잘려, AI 프롬프트가 첨부 로그에 없는 오류를 서술한다. | `capture()` 안에서 로그 trim 후 남은 구간으로 signals를 재필터한 뒤 store에 싣는다. |
| **`applyReplayTrim` 이중 적용** | `capture()`는 이미 버퍼 구간으로 로그를 trim한 뒤 `onRecordingComplete`를 부른다. 그 위에 감지 구간 trim이 한 번 더 걸린다. | `trimByTime`은 멱등이라 안전. 다만 순서가 뒤집히면(`applyReplayTrim` 먼저) 넓은 경계가 좁은 경계를 덮으므로 **호출 순서를 바꾸지 말 것**. |
| **트림 실패의 두 얼굴** | `applyReplayTrim`은 `replaceVideo` **후** `settleLogSaves`에서 `TrimLogsPersistError`를 던진다 — 영상은 잘렸는데 원본 로그가 pending에 남아 재오픈 시 **부활**한다. 인코딩 실패(store 무변경)와 사후 상태가 완전히 다르다. | `capture()`의 기존 catch(`toast.error("encodeFailed")` 단일)에 삼키지 않는다. trim 호출을 자체 try/catch로 감싸고 `App.tsx:492-500`의 분기를 그대로 쓴다. |
| **AI 자동 실행 이중 발화** | `DraftingPanel`은 미리보기 왕복·패널 재오픈에서 언마운트/재마운트된다. 래치가 비영속이면 AI가 두 번 돈다. | `anomalyDraftDone`을 영속하고 실행 직전에 래치(리렌더 전에 ref로도 래치). |
| **폴백 체인 영구 잠김** | 사용자가 중단하면 `anomalyDraftFailed`가 false로 남는데, 게이트가 `!failed`만 보면 `useReproPrefill`이 **영원히 미발화**한다. | `anomalyPending`에 `!anomalyDraftDone`을 포함해 "1회 소비 후 해제"로 만든다. `useReproPrefill`의 명시 deps 배열에도 반드시 추가. |
| **`replayEnabled` 기본값 변경의 실제 영향 범위** | "기존 사용자 무영향"이 아니다 — 설정을 한 번도 바꾼 적 없어 storage 엔트리가 없는 사용자는 조용히 on이 된다(600ms `captureVisibleTab` 폴링). | prd.md "기본값 변경" 절에 사용자군 3분류를 명시. privacy ko/en 본문 + 시행일 갱신을 필수 게이트로. 폴링은 `phase === "idle"` + `tab.active`에서만 돌고 프레임은 30초 캡이라 상한은 명확하다. |
| **계측 의미 오염** | 자동 트림이 `videoTrimmed: true`·`trimSource: "frames"`를 세워, 사용자가 자른 적 없는 이슈가 `replay_trimmed=true`로 집계된다. | `from_anomaly`와 교차해 읽어야 함을 privacy.ko.md "구간 자르기 사용률" 설명에 반영. |
| **privacy 문서 트리거** | 새 권한·새 수집은 없지만 `issue_submitted`에 속성이 늘고, 기본값 변경으로 리플레이 캡처가 사실상 기본 동작이 된다. 30s Replay는 privacy 미갱신으로 심사 탈락한 전례가 있는 바로 그 기능이다. | `docs/privacy.ko.md`·`.en.md` 양쪽 본문 + 상단 시행일 갱신(ko 원본, en 번역). |
