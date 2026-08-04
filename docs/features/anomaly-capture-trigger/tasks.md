# 자동 버그 감지 트리거 — 구현 태스크

## 선행 조건

- 권한·env·외부 API 변경 **없음**. `manifest.config.ts` 무변경.
- 새 의존성 **없음**(`tldts`는 `apiHostRow.ts`가 이미 쓴다).
- 착수 전 `docs/POSTMORTEM.md`를 다음 키워드로 grep: `replay`, `trim`, `AI 초안`, `취소 레인`, `console-recorder`, `pre-arm`.
- `pnpm test`가 green인 상태에서 시작(테스트 pre-훅이 `build:log-viewer`를 먼저 돌린다).

---

## 태스크

### Task 1: `ConsoleEntry.source` 신호 구분

- **변경 대상**: `src/types/console.ts`, `src/content/console-recorder.ts`, `src/content/__tests__/console-recorder*.test.ts`
- **작업 내용**:
  - `ConsoleEntry`에 `source?: "uncaught" | "rejection"` 추가.
  - `pushEntry(level, args, stack?, source?)`로 확장하고, `source`가 있을 때만 `entry.source`에 대입(`stack`·`preArm`과 같은 조건부 대입 패턴).
  - `window.addEventListener("error")` 경로 → `"uncaught"`, `unhandledrejection` 경로 → `"rejection"`.
  - **다른 어떤 경로에도 붙이지 않는다** — `console.error`/`warn` wrap, `console.assert`, `console.trace`는 인자를 생략한다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] uncaught error를 발생시키면 `source === "uncaught"`
  - [ ] `Promise.reject()`를 unhandled로 두면 `source === "rejection"`
  - [ ] `console.error("x")`는 `source`가 `undefined`
  - [ ] `console.assert(false)`는 `source`가 `undefined` (level은 여전히 `"error"`)
  - [ ] `pnpm check:prearm`이 여전히 통과(청크 self-contained 유지)

### Task 2: `anomaly.ts` 감지 판정 순수 함수

- **변경 대상**: `src/sidepanel/lib/anomaly.ts` (신규), `src/sidepanel/lib/__tests__/anomaly.test.ts` (신규)
- **작업 내용**: `design.md` 인터페이스대로 `detectAnomalies`·`anomalyTrimRangeMs`·`buildAnomalyPrompt`·`ANOMALY_TRIM_PAD_MS` 구현. origin 판정은 `apiHostRow.ts`의 `registrableDomain`을 import해 재사용한다(복제 금지).
- **검증**:
  - [ ] `source` 없는 `level:"error"` 엔트리는 감지되지 않는다
  - [ ] `status: 500`·`status: 503`은 감지, `status: 404`·`401`은 미감지
  - [ ] `phase: "error"` + `statusText: "Aborted"`는 미감지, `"Timeout"`·`"Network Error"`는 감지
  - [ ] `windowStart` 이전 타임스탬프는 제외된다
  - [ ] `pageUrl`이 `undefined`거나 `windowStart`가 `null`이면 빈 배열
  - [ ] 다른 registrable domain의 오류는 제외, 같은 도메인의 서브도메인(`api.example.com`)은 포함
  - [ ] 같은 시그니처 500건 → `length === 1`, `count === 500`, `timestamp`=최초·`lastTimestamp`=최후
  - [ ] 결과가 `timestamp` 오름차순
  - [ ] `anomalyTrimRangeMs`: 단일 시그니처면 span 6000ms, 빈 배열이면 `null`

### Task 3: 프레임 축 변환 (`anomaly-trim.ts`)

- **변경 대상**: `src/sidepanel/30s-replay/anomaly-trim.ts` (신규), `src/sidepanel/30s-replay/__tests__/anomaly-trim.test.ts` (신규)
- **작업 내용**: `frameOffsetsMs`로 절대 ms → 프레임 축 초 변환. `[0, duration]` clamp. `frames`가 비면 `null`.
- **검증**:
  - [ ] 구간이 버퍼 전체를 덮으면 `startSec === 0`, `endSec === duration` → `applyReplayTrim`의 `isFullRange`가 true가 된다
  - [ ] 구간이 버퍼 앞쪽으로 넘치면 `startSec === 0`으로 clamp
  - [ ] 구간이 버퍼 뒤쪽으로 넘치면 `endSec === duration`으로 clamp
  - [ ] 중간 구간이면 프레임 오프셋과 일치(`frameOffsetsMs` 결과 대조)
  - [ ] `frames: []` → `null`

### Task 4: editor-store 상태 3종

- **변경 대상**: `src/store/editor-store.ts`, `src/store/__tests__/editor-store*.test.ts`
- **작업 내용**: `anomalySignals`·`anomalyDraftDone`·`anomalyDraftFailed` + setter 3개. `initial`에 포함시키고 persist 대상에 넣는다. `onRecordingComplete`가 `anomalyDraftDone: false`·`anomalyDraftFailed: false`로 초기화(단 `anomalySignals`는 capture 쪽이 이후에 세팅하므로 여기서 건드리지 않는다). `reset`·`cancelRecording`은 `...initial`로 자동 청소.
- **검증**:
  - [ ] `onRecordingComplete` 후 두 래치가 false
  - [ ] `reset()` 후 `anomalySignals === null`
  - [ ] persist 왕복(직렬화→복원) 후 `anomalySignals`가 보존된다

### Task 5: 감지 훅 배선

- **변경 대상**: `src/sidepanel/hooks/useAnomalyDetection.ts` (신규), `src/sidepanel/30s-replay/use-30s-replay.ts`, `src/sidepanel/30s-replay/replay-context.ts`
- **작업 내용**:
  - `use30sReplay` 반환에 `bufferOldestTs` 추가(표시용 1초 타이머와 같은 주기로 갱신 — 별도 타이머를 만들지 않는다). `ReplayContextValue`에도 반영.
  - `useAnomalyDetection`: `editor-store`의 `consoleLog`/`networkLog` 구독 + `chrome.tabs.get`으로 `pageUrl` 추적(`useTabUnsupported`의 seq 가드 패턴 복제 — 늦게 온 응답이 최신 판정을 덮지 않게). `enabled`가 false면 빈 배열을 반환하고 리스너를 걸지 않는다.
  - **판정 조건을 이 훅에 두지 않는다.** `detectAnomalies` 호출만.
- **검증**:
  - [ ] `enabled: false`면 항상 빈 배열이고 `chrome.tabs.onUpdated` 리스너가 등록되지 않는다
  - [ ] 로그가 갱신되면 반환 배열이 갱신된다
  - [ ] 탭 URL이 바뀌면 재판정된다

### Task 6: 배지 + 감지 내역 다이얼로그

- **변경 대상**: `src/sidepanel/tabs/AnomalyDialog.tsx` (신규), `src/sidepanel/tabs/IssueTab.tsx`, `src/sidepanel/tabs/__tests__/AnomalyDialog.test.tsx` (신규), `src/i18n/namespaces/issue.ts`
- **작업 내용**:
  - `EmptyState`에 배지 버튼(`data-testid="anomaly-badge"`). 노출 조건 = `replayEnabled && isReady && !unsupported && signals.length > 0`. 위치는 제목 아래·캡처 버튼 열 위, `CONTENT_MAX_W` 안.
  - `AnomalyDialog`: 읽기 전용 목록(아이콘 + label + 시각) + [닫기]/[이슈 작성 시작]. `w-[90vw] max-w-[800px]`.
  - i18n 키 ko/en 동시 추가: `issue.anomaly.badge`(`{n}건`), `issue.anomaly.title`, `issue.anomaly.start`, `issue.anomaly.aiPrompt`.
- **검증**:
  - [ ] 신호 0건이면 배지가 렌더되지 않는다
  - [ ] `replayEnabled: false`면 신호가 있어도 배지가 없다
  - [ ] `isReady: false`면 배지가 없다
  - [ ] 배지 클릭 → 다이얼로그 open
  - [ ] 시그니처 2건이면 목록 행이 2개
  - [ ] [이슈 작성 시작] 클릭 시 `capture({ anomaly })`가 호출된다
  - [ ] i18n 훅이 `locales.test.ts`를 통과시킨다(ko/en 대칭·placeholder 일치)

### Task 7: 감지 캡처 경로 (auto trim)

- **변경 대상**: `src/sidepanel/30s-replay/use-30s-replay.ts`, `src/sidepanel/30s-replay/__tests__/use-30s-replay*.test.ts`
- **작업 내용**: `capture(opts?: { anomaly: AnomalySignal[] })`.
  - anomaly면 `onRecordingComplete(..., trim = null)` — 트림 다이얼로그를 띄우지 않는다.
  - 같은 `set()` 직후 `setAnomalySignals(opts.anomaly)`.
  - 이어서 `anomalyTrimRangeMs` → `anomalyTrimSeconds` → `applyReplayTrim({ frames, tabId, startSec, endSec })`.
  - **순서 불변**: 기존 버퍼 구간 로그 trim → `onRecordingComplete` → `applyReplayTrim`. 뒤집으면 넓은 경계가 좁은 경계를 덮는다.
  - `applyReplayTrim` 실패는 흡수한다 — 이 시점에 영상은 이미 붙어 있고, 잘리지 않은 원본이 남는 편이 아무것도 없는 것보다 낫다. 토스트로만 알린다.
- **검증**:
  - [ ] anomaly 캡처 후 `replayTrim === null`(다이얼로그 미노출)
  - [ ] `anomalySignals`가 store에 실린다
  - [ ] `applyReplayTrim`이 계산된 `startSec`/`endSec`로 호출된다
  - [ ] 감지 구간이 버퍼 전체면 `applyReplayTrim`이 재인코딩 없이 반환한다(`videoTrimmed === false`)
  - [ ] 일반 `capture()`(인자 없음)는 기존대로 트림 다이얼로그를 띄운다 — **회귀 가드**

### Task 8: AI 초안 자동 실행 + 폴백 체인

- **변경 대상**: `src/sidepanel/tabs/AiDraftDialog.tsx`, `src/sidepanel/tabs/DraftingPanel.tsx`, `src/sidepanel/hooks/useReproPrefill.ts`, 각 `__tests__`
- **작업 내용**:
  - `handleSubmit(overrideMsg?: string)` — `const msg = (overrideMsg ?? input).trim()`. `overrideMsg`가 있으면 `setInput("")`·`onOpenChange(false)`를 건너뛴다(다이얼로그가 애초에 안 열려 있다).
  - `autoRunPrompt?: string | null`·`onAutoRunError?: () => void` prop. effect가 `autoRunPrompt`를 1회 소비(ref 래치 + store의 `anomalyDraftDone`).
  - `aiStatus !== "available"`이면 자동 실행하지 않는다.
  - `DraftingPanel`: `anomalySignals && !anomalyDraftFailed && !anomalyDraftDone`일 때만 `buildAnomalyPrompt(signals, t)`를 넘긴다. `onAutoRunError` → `setAnomalyDraftFailed(true)`.
  - `useReproPrefill`: args에 `anomalyPending: boolean` 추가하고 `if (anomalyPending) return;` 게이트. `anomalyPending = !!anomalySignals && !anomalyDraftFailed`.
  - `submitDisabled`는 건드리지 않는다(사용자 UI 경로 불변).
- **검증**:
  - [ ] `autoRunPrompt`가 주어지면 다이얼로그가 열리지 않은 채 AI가 1회 실행된다
  - [ ] 재마운트해도 두 번 실행되지 않는다(`anomalyDraftDone` 래치)
  - [ ] `aiStatus: "unavailable"`이면 자동 실행이 없다
  - [ ] 자동 실행 중에는 `useReproPrefill`이 미발화
  - [ ] 자동 실행 실패 → `anomalyDraftFailed: true` → `useReproPrefill`이 발화
  - [ ] `autoRunPrompt: null`(일반 캡처)이면 기존 동작 그대로 — **회귀 가드**
  - [ ] 사용자가 다이얼로그를 직접 열어 쓰는 경로가 그대로 동작 — **회귀 가드**

### Task 9: 설정 기본값 + 계측

- **변경 대상**: `src/store/settings-ui-store.ts`, `src/sidepanel/lib/track-submit.ts`, `src/background/analytics.ts`, 각 `__tests__`
- **작업 내용**:
  - `replayEnabled` 초기값 `false` → `true`. **`migrate` 분기를 추가하지 않는다**(기존 사용자 값 보존).
  - `submitEventProperties`/`trackSubmit`에 `fromAnomaly` 인자 → `from_anomaly` 속성. 호출부에서 `!!anomalySignals`를 넘긴다.
  - `ALLOWED_EVENTS.issue_submitted`에 `"from_anomaly"` 추가.
- **검증**:
  - [ ] 새 store 인스턴스의 `replayEnabled === true`
  - [ ] persist된 `{ replayEnabled: false }`를 복원하면 여전히 `false`
  - [ ] `submitEventProperties`를 `filterProperties`에 통과시켜 `from_anomaly`가 살아남는다(양쪽 계약 대조 테스트 — v1.7.0에서 `trim_source`가 이 갭으로 드롭된 전례)

### Task 10: e2e

- **변경 대상**: `e2e/anomaly-capture.spec.ts` (신규), `e2e/fixtures/anomaly.html` (신규)
- **작업 내용**: 픽스처에 버튼 3개 — 5xx 요청 / uncaught throw / abort된 요청. 리플레이가 ready가 될 때까지 대기 후 신호 발생 → 배지 → 다이얼로그 → [이슈 작성 시작] → drafting 진입.
- **검증**: 아래 "e2e 시나리오" 참조

### Task 11: 문서

- **변경 대상**: `docs/DIRECTORY.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `docs/privacy.ko.md`·`docs/privacy.en.md`, `README.md`·`README.ko.md`, `docs/CI.md`
- **작업 내용**:
  - DIRECTORY: 신규 파일 6개 등록.
  - ARCHITECTURE: "자동 버그 감지 트리거" 섹션 — 게이트 단일 출처, 시간축, `applyReplayTrim` 재사용, 호출 순서 불변식, 폴백 체인.
  - CLAUDE.md: 게이트웨이/스택 항목에 한 줄. `replayEnabled` 기본값 변경 명시.
  - privacy ko/en: `issue_submitted`의 `from_anomaly` 속성 + 기본값 변경으로 신규 설치에서 리플레이 폴링이 기본 on이 되는 사실. **ko 원본 → en 번역, 상단 시행일 함께 갱신.**
  - README ko/en: 기능 한 줄(양쪽 같은 커밋).
  - CI.md: e2e spec/test 카운트 갱신.
- **검증**:
  - [ ] `pnpm sync:agents:check` 통과(CLAUDE.md 편집 시 훅이 자동 sync)
  - [ ] `/doc-check`로 대조 시 신규 stale 없음

---

## 테스트 계획

### 단위 테스트 (`*.test.ts`)

| 대상 | 케이스 |
|---|---|
| `detectAnomalies` | source 게이트(uncaught/rejection/undefined), status 게이트(500/503/404/401), phase+Aborted, windowStart 경계, pageUrl/windowStart null, registrable domain(동일/서브도메인/타도메인), 시그니처 중복 억제(count·timestamp·lastTimestamp), 정렬 순서 |
| `anomalyTrimRangeMs` | 단일 시그니처 6초, 복수 시그니처 span+6초, 빈 배열 null |
| `buildAnomalyPrompt` | 시그니처 label이 전부 포함, 빈 배열 방어 |
| `anomalyTrimSeconds` | 전체 덮음 → isFullRange 성립, 앞/뒤 clamp, 중간 구간 오프셋 일치, 빈 frames null |
| `editor-store` | 래치 초기화, persist 왕복 |
| `submitEventProperties` × `filterProperties` | `from_anomaly`가 허용목록을 통과 |
| `settings-ui-store` | 신규 기본값 true, 기존 persist false 보존 |
| `console-recorder` | source 3경로 |

### 컴포넌트 테스트 (`*.test.tsx`)

| 대상 | 케이스 |
|---|---|
| `EmptyState` | 배지 노출 게이트 4종(신호 0 / replayEnabled off / isReady false / 정상) |
| `AnomalyDialog` | 목록 행 수, [이슈 작성 시작] 호출, 닫기 |
| `AiDraftDialog` | autoRunPrompt 1회 실행, 재마운트 이중 실행 없음, aiStatus unavailable 미실행, autoRunPrompt null 회귀 |
| `useReproPrefill` | anomalyPending 게이트, anomalyDraftFailed 후 발화 |

### e2e 시나리오 (`/e2e-write` 입력)

- 리플레이가 ready인 상태에서 픽스처의 5xx 버튼을 누르면 캡처 진입 화면에 감지 배지가 나타난다.
- 같은 5xx 버튼을 10번 눌러도 배지 카운트가 1로 유지된다.
- abort 버튼만 누르면 배지가 나타나지 않는다.
- `replayEnabled`를 끄면 5xx를 내도 배지가 나타나지 않는다.
- 배지를 클릭하면 감지 내역 다이얼로그가 열리고 목록 행이 발생시킨 종류 수만큼 있다.
- [이슈 작성 시작]을 클릭하면 트림 다이얼로그 없이 작성 화면으로 진입하고 영상이 첨부돼 있다.
- 5xx와 uncaught error를 함께 발생시키면 목록 행이 2개다.

### 수동 테스트 (Chrome, `pnpm build` 후 로드 언팩)

- [ ] 실제 사이트에서 잘린 영상의 시작/끝이 오류 발생 시점 앞뒤 3초와 육안으로 맞는지
- [ ] 잘린 로그가 영상 구간과 어긋나지 않는지(로그 뷰어 타임라인 대조)
- [ ] AI 초안 자동 실행 오버레이가 뜨고 '중단' 버튼이 실제로 취소하는지
- [ ] 중단 후 재현 단계 자동 채움으로 폴백되지 않는지(중단은 명시적 포기 — `anomalyDraftFailed`를 세우면 안 된다)
- [ ] 광고가 많은 상용 페이지에서 배지가 상시 켜지는 정도가 실사용에 견딜 만한지
- [ ] 신규 프로필로 설치했을 때 리플레이가 기본 on이고 폴링이 idle에서만 도는지

---

## 구현 순서 권장

```
Task 1 ─┐
Task 2 ─┼─▶ Task 5 ─▶ Task 6 ─▶ Task 7 ─▶ Task 8 ─▶ Task 10 ─▶ Task 11
Task 3 ─┤              (배지·다이얼로그)  (auto trim)  (AI 배선)   (e2e)     (문서)
Task 4 ─┘
```

- **Task 1~4는 병렬 가능** — 서로 의존하지 않는 순수 함수·타입·store 작업이다.
- Task 5는 1·2·4에, Task 6은 5에, Task 7은 3·6에, Task 8은 4·7에 의존한다.
- Task 9는 어느 시점에나 끼울 수 있으나 Task 10 전에 끝내는 편이 낫다(계측 회귀를 e2e 전에 잡는다).
- Task 7·8은 각각 회귀 가드 검증 항목("일반 캡처는 기존대로")을 반드시 통과시킨 뒤 다음으로 넘어간다.

## 가이드 영향

- `guide/ko/video/replay.md`·`guide/en/video/replay.md` — 감지 배지·감지 내역 다이얼로그·자동 트림·AI 초안 자동 실행을 30초 리플레이 페이지에 추가한다. 리플레이 버퍼에 종속된 기능이므로 `record.md`가 아니라 여기다.
- `guide/ko/settings/issue.md`·`guide/en/settings/issue.md` — 30초 리플레이 토글의 기본값이 on으로 바뀐 점과, 끄면 감지도 함께 꺼진다는 점.
- `guide/AUTHORING.md` — 사실 스냅샷에 감지 트리거 항목 추가(신호 4종, 시간창, 3초 패딩, replayEnabled 종속), 재촬영 목록에 리플레이 캡처 진입 화면 추가.
- 작성 전 `guide/AUTHORING.md`를 먼저 읽는다. 구현 후 `/guide`로 처리한다.
