# 페이지 console.error/warn 캡처 — 기술 설계

## 개요

`console-recorder.ts`(MAIN world)에 `console.error`/`console.warn`을 wrap하는 로직을 추가한다. 단 기존 `log/info/debug`처럼 IIFE 평가 시 상시 설치하지 않고, **`setSentinel`(백그라운드 레코더 arm) 시 설치 → `stop` 시 native 복원**한다. wrap은 원본을 동기 호출(DevTools 출력 보존)한 뒤 버퍼에 push한다. attribution 오염은 arm 구간으로 한정되는 것을 수용한다. 데이터 모델·뷰어·메시지·sidepanel은 변경하지 않는다(이미 `error`/`warn` 레벨 지원).

## 변경 범위

### `src/content/console-recorder.ts` (변경)
- **현재 역할**: MAIN world에서 console 후크 + uncaught/rejection 캡처. `LEVELS_TO_WRAP = ["log","info","debug"]`만 wrap(IIFE 시 상시). `error`/`warn`은 attribution 오염 때문에 미wrap(주석 명시).
- **변경 내용**:
  1. IIFE 평가 시점에 원본 native 참조를 캡처: `const nativeError = console.error.bind(console)`, `const nativeWarn = console.warn.bind(console)` (다른 wrap보다 먼저).
  2. error/warn wrapper를 만들어 보관할 모듈 스코프 변수(`errorWrapper`, `warnWrapper`)와 설치 가드(`let errorWarnInstalled = false`).
  3. `installErrorWarnWrap()` / `restoreErrorWarnWrap()` 함수 추가.
     - install: 가드가 true면 no-op. 아니면 `console.error = errorWrapper`, `console.warn = warnWrapper`, 가드 true.
     - restore: `shouldRestoreWrapper(console.error, errorWrapper)`가 true일 때만 `console.error = nativeError`(warn 동일). 가드 false.
  4. wrapper 본체: `nativeError(...args)` 호출 → `pushEntry("error", serializeArgs(args), captureStack())`. warn은 level/native만 다름. (`pushEntry`는 `recording`이 false면 자체 early-return하므로 추가 게이트 불필요.)
  5. `setSentinel()` 내부 `recording = true` 직후 `installErrorWarnWrap()` 호출.
  6. `stopHandler` 내부 `recording = false` 직후 `restoreErrorWarnWrap()` 호출.
  7. 기존 `LEVELS_TO_WRAP` 위의 "error/warn은 wrap하지 않는다…" 주석을 **새 동작(arm 구간 한정 wrap + 오염 수용)**으로 갱신.

### `src/content/console-recorder-helpers.ts` (변경 — 신규 순수 함수)
- **현재 역할**: console-recorder의 테스트 가능한 순수 함수 모음(`formatErrorEvent`, `serializeArgs`, `safeStringify` 등).
- **변경 내용**: 아래 두 순수 함수 추가(단위 테스트 대상).
  - `makeConsoleWrapper(native, level, record)`: wrapper 함수를 만들어 반환. native 동기 호출 후 `record(level, args)` 호출.
  - `shouldRestoreWrapper(current, ours)`: `current === ours`를 반환(페이지가 위에 재wrap했으면 false → 복원 스킵).
- `console-recorder.ts`는 이 헬퍼로 wrapper를 생성·복원 판정한다(IIFE 내 인라인 로직 최소화, 테스트 가능성 확보).

### 변경 없음 (확인 완료)
- `src/types/console.ts` — `ConsoleLevel`에 `warn`/`error` 이미 존재, `ConsoleEntry.stack?` 존재.
- `src/sidepanel/components/ConsoleLogContent.tsx` — error/warn 색·아이콘·필터 이미 구현.
- `src/content/recorder-bridge.ts`, `src/sidepanel/picker-control.ts`, `useBackgroundRecorder.ts` — sentinel/data 흐름 변경 없음.
- `manifest.config.ts` — 권한/주입 변경 없음.

## 데이터 흐름

```
페이지 console.error("x", err)
  └─ errorWrapper (arm 구간에만 설치됨)
       ├─ nativeError("x", err)              ← DevTools 출력 보존
       └─ pushEntry("error", serializeArgs(args), captureStack())
            └─ recording? → buffer.push(entry)  (cap 2000 FIFO)
                 └─ throttle.schedule() → dispatch (CustomEvent, sentinel-bound)
                      └─ recorder-bridge: handleConsoleData → postToRuntime
                           └─ sidepanel: consoleRecorder.data → 누적 → blob-db → logs.html
```

라이프사이클:
```
useBackgroundRecorder (패널 open & supported URL)
  → activateConsoleRecorder → consoleRecorder.setSentinel
      → console-recorder.setSentinel(): recording=true; installErrorWarnWrap()   ← 오염 창 시작
  ... 백그라운드 버퍼링 (30s 리플레이/수동 영상이 이 버퍼를 시간창으로 읽음) ...
  → 패널 close / 미지원 이동 / 이슈완료 idle: consoleRecorder.stop
      → stopHandler: recording=false; restoreErrorWarnWrap()                     ← native 복원, 오염 창 종료
```

## 인터페이스 설계

```ts
// console-recorder-helpers.ts (신규)
type RecordFn = (level: "error" | "warn", args: unknown[]) => void;

/** native를 동기 호출한 뒤 record로 캡처를 위임하는 wrapper를 생성. */
export function makeConsoleWrapper(
  native: (...args: unknown[]) => void,
  level: "error" | "warn",
  record: RecordFn,
): (...args: unknown[]) => void;

/** 현재 console 메서드가 우리가 설치한 wrapper일 때만 복원하도록 판정. */
export function shouldRestoreWrapper(
  current: unknown,
  ours: unknown,
): boolean;
```

`console-recorder.ts` 내부(비exported, IIFE 스코프)에서:
```ts
const nativeError = console.error.bind(console);
const nativeWarn = console.warn.bind(console);
const record: RecordFn = (level, args) => pushEntry(level, serializeArgs(args), captureStack());
const errorWrapper = makeConsoleWrapper(nativeError, "error", record);
const warnWrapper = makeConsoleWrapper(nativeWarn, "warn", record);
let errorWarnInstalled = false;
function installErrorWarnWrap(): void { /* 가드 + 할당 */ }
function restoreErrorWarnWrap(): void { /* shouldRestoreWrapper 판정 후 native 복원 */ }
```

## 기존 패턴 준수

- **sentinel 기반 라이프사이클**: 설치/복원을 기존 `setSentinel`/`stopHandler` 훅에 얹어 새 메시지·새 상태를 만들지 않는다.
- **MAIN world self-contained**: 헬퍼는 import해 쓰지만(번들 시 인라인됨) IIFE 내 클로저 안전성 유지. `serializeArgs`/`captureStack`/`pushEntry` 등 기존 장치 재사용.
- **throwing getter 방어**: 인자 직렬화는 기존 `serializeArgs`(내부 `safeStringify` try/catch)로 처리 — 페이지 객체의 throwing toString/Proxy trap이 wrapper를 깨지 않는다.
- **테스트 우선(CLAUDE.md)**: 신규 순수 함수(`makeConsoleWrapper`, `shouldRestoreWrapper`)는 단위 테스트를 먼저 작성한다.
- **FIFO cap**: error/warn도 기존 `pushEntry`의 `MAX_ENTRIES` FIFO·throttle를 그대로 탄다.

## 대안 검토

1. **상시 wrap(IIFE에서 log/info/debug와 함께 설치)** — 구현은 가장 단순하나, 레코더 MAIN 스크립트가 주입된 이후 패널을 닫아도 `console.error`가 wrap된 채로 남아 `chrome://extensions` 오염이 arm 종료 후에도 지속된다. 채택 안 함 — 오염 창을 arm 구간으로 한정하는 목표에 위배.
2. **attribution 회피 트릭(microtask 지연 / inline `<script>` flush)** — 실측 결과 microtask는 ext 프레임이 그대로 남아 오염 미해소, inline flush는 strict CSP(skillflo·GitHub 등)에서 차단돼 에러가 큐에 갇혀 유실(현 상태보다 악화). 채택 안 함.
3. **`chrome.debugger`(CDP) 콘솔 수집** — attribution 오염 없음이나 "○○가 브라우저를 디버깅 중" 배너가 상시 노출돼 항시 레코더 UX에 부적합. 권한도 추가 필요. 채택 안 함.

## 위험 요소

- **attribution 오염(수용)**: arm 구간 중 페이지 error/warn이 `chrome://extensions` 오류 로그에 확장 귀속으로 수집된다. 개발자 모드에서만 노출이라 일반 사용자 영향은 없으나, **개발 중 본인 chrome://extensions가 페이지 에러로 도배**된다(기존 대비 신규 비용). Jam도 동일 비용을 감수.
- **복원 안전성**: 페이지가 우리 wrap 위에 자체 wrap을 얹은 경우 `stop` 시 무조건 복원하면 페이지 wrapper를 날린다 → `shouldRestoreWrapper` 동일성 검사로 우리 wrapper일 때만 복원.
- **이중 캡처 가능성(낮음)**: uncaught 예외는 `window 'error'`로, 페이지의 명시적 `console.error`는 wrapper로 — 서로 다른 이벤트라 일반적으로 중복 아님. 단 일부 코드가 throw와 `console.error`를 함께 내면 2개 신호가 남을 수 있음(정상 동작으로 간주).
- **arm/disarm 멱등성**: `setSentinel` 다회 호출(프레임 rebroadcast 포함) 시 `errorWarnInstalled` 가드로 이중 wrap 방지. `stop`→`setSentinel` 사이클에서 복원→재설치가 정상이어야 함.
- **minified 스택**: prod 페이지의 `captureStack()` 결과는 minified 위치라 "이 줄" 핀포인트 불가 — 메시지가 주 단서. (설계 한계로 수용, 비목표.)
