# 로그 레코더 Pre-arm 버퍼링 — 기술 설계

## 개요

세 MAIN world 레코더(network/console/action)에 **pre-arm 버퍼링 모드**를 추가한다. `document_start` 주입 시 sessionStorage의 active 플래그를 동기로 읽어, 플래그가 있으면 sentinel 도착 전에도 후킹 결과를 버퍼에 쌓는다(dispatch는 sentinel 없으면 no-op). `setSentinel`이 도착하면 버퍼를 flush해 초반 로그가 소급 전송된다.

핵심 제약: **reload는 사이드패널의 `logClear`(→`lastLogClearAt` 필터)를 유발**해, pre-arm 초반 로그가 그 경계보다 과거 타임스탬프라 flush돼도 필터에 걸려 버려진다(`usePickerMessages.ts:191-192, 215-216, 238-240`). 이를 막기 위해 **pre-arm으로 캡처된 엔트리에 `preArm: true` 마커**를 달아 사이드패널 필터에서 우회한다.

플래그는 레코더가 armed될 때(`setSentinel`) 기록되며 **명시적으로 clear하지 않고 sessionStorage 자연 소멸(탭 종료)에 의존**한다(아래 "플래그 라이프사이클" 참조). 재무장 타이밍(`useBackgroundRecorder`의 `status:complete`)과 iframe 경로(`rebroadcastSentinelsToFrame`)는 건드리지 않는다.

## 변경 범위

### 신규: `src/content/recorder-prearm.ts`
세 레코더가 공유하는 pre-arm 게이트 헬퍼. sessionStorage 접근은 sandboxed iframe 등에서 throw할 수 있어 try/catch로 감싼다. 순수 판정부는 분리해 단위 테스트 대상으로 둔다.

```ts
export const PREARM_FLAG_KEY = "__bugshot_recorder_active__";

// 순수: 플래그 문자열 → pre-arm 여부 (단위 테스트 대상)
export function isPreArmFlag(value: string | null): boolean {
  return value === "1";
}

// 부수효과 래퍼 (sessionStorage 미접근 환경에서 안전)
export function readPreArmFlag(): boolean {
  try { return isPreArmFlag(sessionStorage.getItem(PREARM_FLAG_KEY)); }
  catch { return false; }
}
export function setPreArmFlag(): void {
  try { sessionStorage.setItem(PREARM_FLAG_KEY, "1"); } catch { /* sandboxed */ }
}
```
> `clearPreArmFlag`는 두지 않는다(플래그 라이프사이클 결정). 필요해지면 추가.

### 데이터 모델: pre-arm 마커
`NetworkRequest`(`src/types/network.ts`) / `ConsoleEntry`(`src/types/console.ts`) / `ActionEntry`(`src/types/action.ts`)에 선택 필드 `preArm?: boolean` 추가. pre-arm 모드(`capturing===true && recording===false`)에서 적재된 엔트리에만 `true`. payload 타입(`src/types/picker.ts:99,104,109`)은 이 엔트리 배열을 그대로 전달하므로 별도 변경 불필요(마커가 엔트리에 실려 자동 전파).

### `src/content/network-recorder.ts`
- 현재: `recording=false` 시작, `recordHook`이 `if (!recording) return`(182-183)으로 sentinel 전 요청 버림.
- 변경:
  - init: `const preArm = readPreArmFlag(); let capturing = preArm;`. `recording`은 dispatch 자격(=sentinel 보유)으로 유지.
  - `recordHook` 게이트를 `if (!capturing) return`으로 교체. 적재 시 `recording===false`이면 엔트리에 `preArm: true` 마킹.
  - `setSentinel`: 기존 동작 + `capturing = true; setPreArmFlag(); if (buffer.length) throttle.schedule();`(초반 버퍼 소급 flush).
  - `stopHandler`: 기존 `recording=false; throttle.flushNow()` 유지. **`capturing`/플래그는 건드리지 않는다**(자연 소멸).
  - dispatch는 `currentSentinel` 없으면 no-op(기존) → pre-arm 중 전송 자동 차단.

### `src/content/console-recorder.ts`
- network와 동일한 `preArm`/`capturing`/`preArm` 마커 도입. `pushEntry` 게이트(53)를 `if (!capturing) return`로 교체.
- **error/warn 후킹 시점 변경**: 현재 `installConsoleWrap(console, ewState, …)`는 `setSentinel`(262-264)에서만 호출, `restoreConsoleWrap`은 `stopHandler`(265-269)에서만 호출. 변경 후 — `preArm===true`이면 init에서도 `installConsoleWrap`을 호출해 `document_start`부터 error/warn 후킹(`ewState.installed` 멱등 가드로 이후 `setSentinel`의 재호출은 무시). install이 직전 메서드(native + 페이지가 나중에 얹는 Sentry 체인)를 먼저 호출하므로 출력 보존(`console-recorder-helpers.ts:158-177`).
  - **uninstall 경로 보강**: 현재 `restoreConsoleWrap`은 `stopHandler` 안에서만 호출된다. pre-arm으로 init에서 wrap을 설치하면 sentinel 미도착 시 stopHandler가 등록 안 돼 복원 경로가 없다 → **pagehide(282)에 `restoreConsoleWrap(console, ewState)` 추가**(MAIN world 파괴 직전 원복; 멱등이라 stop과 중복 안전).
- `setSentinel`: `capturing=true; setPreArmFlag();` + 버퍼 소급 flush.

### `src/content/action-recorder.ts`
- network와 동일한 `preArm`/`capturing`/마커 도입. `pushAction`(52-53) 및 input dedup 분기(157-158) 게이트를 `capturing` 기준으로 교체.
- `setSentinel`(384-401): 기존 `entryNavOnBind` 진입 네비 보충 + `entryNavEmitted` 가드 유지(pre-arm 중 캡처된 load 액션과 중복 방지) + `capturing=true; setPreArmFlag();` + 버퍼 소급 flush.
- `stopHandler`: 기존 유지, 플래그 무변경.

### `src/sidepanel/hooks/usePickerMessages.ts`
- `networkRecorder.data`/`consoleRecorder.data`/`actionRecorder.data` 머지의 `lastLogClearAt` 필터(191-192, 215-216, 238-240)를 **엔트리별 `preArm` 마커 우회**로 교체. 순수 함수로 추출:
```ts
// src/sidepanel/log-prearm-filter.ts (신규) — 단위 테스트 대상
export function shouldDropPreArmEntry(
  timestamp: number, lastLogClearAt: number, isPreArm: boolean,
): boolean {
  return lastLogClearAt > 0 && !isPreArm && timestamp < lastLogClearAt;
}
```
  필터를 `requests.filter((r) => !shouldDropPreArmEntry(r.startTime, lastLogClearAt, !!r.preArm))` 형태로. pre-arm 엔트리는 reload 경계보다 과거여도 보존, 비-pre-arm 옛 로그는 기존대로 폐기.

### 변경 없음 (확인용)
- `src/background/index.ts`(navigation/logClear), `useBackgroundRecorder.ts`(재무장 트리거), `picker-control.ts`(sentinel 발행/`rebroadcastSentinelsToFrame`), `recorder-bridge.ts` — 무변경. 플래그 set은 MAIN world 레코더 내부, 필터 우회는 sidepanel 수신부에서 자기완결.

## 데이터 흐름

```
[active origin 새로고침]
 onCommitted(reload) → background logClear 발송
   └ usePickerMessages: store.clear*Log() + lastLogClearAt = now (T_clear)
 document_start
   └ MAIN 레코더 init → readPreArmFlag()===true → capturing=true (preArm)
        (console: installConsoleWrap도 여기서 — error/warn 조기 후킹)
 페이지 스크립트 실행 (T_clear 전후 경합)
   └ fetch/XHR/console/click → capturing 통과 → buffer 적재 + preArm:true 마킹
        dispatch는 currentSentinel 없어 no-op (전송 0)
 status:complete
   └ inject() → activateXRecorder → setSentinel(new)
        └ MAIN setSentinel: recording=true, capturing=true, setPreArmFlag(),
          throttle.schedule() → buffer(초반+preArm 마커) dispatch
   └ usePickerMessages: shouldDropPreArmEntry → preArm 엔트리는 T_clear 과거여도 보존
 → 사이드패널/IDB에 초반 로그까지 반영

[bugshot 미사용 origin]
 document_start → readPreArmFlag()===false → capturing=false
   └ recordHook/pushEntry 즉시 return → 무부하 (현행과 동일)
```

상태 모델: `capturing`(버퍼 적재 여부) = `preArm || recording`. `recording`(=sentinel 보유, dispatch 자격)은 의미 그대로. 기존 stop/sync/clear 핸들러는 `recording`/throttle만 만져 `capturing`과 직교.

### 플래그 라이프사이클 (clear 안 함)
`stop` 메시지는 **탭 전환마다** 발생한다(`tab-bindings.ts` `onActivated`→`stopRecorders`). 따라서 `clearPreArmFlag`를 `stop`에 묶으면 active origin 도중에도 플래그가 지워져, 바로 그때 새로고침하면 pre-arm이 안 켜진다(노리던 케이스가 깨짐). 그래서 **플래그는 clear하지 않고 sessionStorage 자연 소멸(탭 종료)에 맡긴다.**
- 비용: 한 번 armed된 origin은 그 탭이 살아있는 한 reload/same-origin 네비에서 계속 pre-arm 적재(메모리는 기존 entry/memory cap이 상한, 전송은 currentSentinel 게이트가 차단).
- cross-origin 하드 네비: 도착 origin sessionStorage는 새 것이라 플래그 없음 → 첫 진입은 pre-arm 안 됨(현행과 동일).
- 녹화 정상 종료(phase=drafting~done): `recordersStopped`로 재주입 억제(`useBackgroundRecorder.ts:122-123`) → sentinel 미도착. 플래그는 남아 pre-arm 버퍼가 쌓이지만 flush할 sentinel이 없어 네비/pagehide 시 폐기 — **전송 0의 무해한 적재 비용**(허용).

## 인터페이스 설계

- `recorder-prearm.ts`: `PREARM_FLAG_KEY`, `isPreArmFlag`(순수), `readPreArmFlag`, `setPreArmFlag`.
- `log-prearm-filter.ts`: `shouldDropPreArmEntry`(순수).
- `NetworkRequest`/`ConsoleEntry`/`ActionEntry`에 `preArm?: boolean` 추가.
- 세 레코더 IIFE 내부 지역 변수 `capturing: boolean` 추가. 메시지 타입·`CTRL_KEY` 인터페이스 변경 없음.

## 기존 패턴 준수

- **순수 헬퍼 분리 + `__tests__`**: `entryNavOnBind`/`createTrailingThrottle`처럼 판정부(`isPreArmFlag`, `shouldDropPreArmEntry`)를 순수 함수로 분리해 Vitest 검증(CLAUDE.md "테스트 우선").
- **세션 영속화**: sessionStorage는 같은 탭·origin의 reload/same-origin 네비에서 살아남고 탭 종료 시 자동 소멸 — 정리 로직 불필요.
- **MAIN world self-contained**: 플래그 read/set은 페이지 sessionStorage(모든 world 공유)로 MAIN 레코더 안에서 완결. content_script 파일 주입이라 `executeScript({world:"MAIN", func})` 직렬화 제약과 무관(import는 번들 inline).
- **캡 재사용**: 기존 entry cap(`buffer.shift`)·memory cap(`enforceMemoryCap`)이 pre-arm 버퍼에도 적용돼 메모리 상한 보장.
- **정렬·필터 흡수**: pre-arm 엔트리가 늦게 flush돼도 `mergeLogItems`가 `startTime`/`timestamp` 오름차순 안정 정렬(`log-merge.ts:16-47`)해 발생 시간 위치로 재배치. cross-origin 다중 origin도 기존 topOrigin 보존·origin 필터 동적 도출이 그대로 처리(회귀 없음).

## 대안 검토

1. **top frame 재무장을 `onCommitted`/`onDOMContentLoaded`로 앞당김**(iframe `rebroadcastSentinelsToFrame` 경로를 top frame에 확장): 변경은 작지만 background→사이드패널→executeScript→setSentinel async 왕복 갭이 남아 맨 초반 버스트는 여전히 일부 누락. 게다가 재무장이 빨라져도 그 전 초반 요청은 못 잡고 `lastLogClearAt` 문제도 남는다. 기각. 채택안(버퍼링+마커)은 `document_start`부터 적재해 갭이 없다.
2. **모든 페이지 무조건 pre-arm 버퍼링**(게이트 없음): 패널을 안 연 모든 페이지가 상시 후킹+바디 복제 비용을 짐(성능·프라이버시 후퇴). sessionStorage 게이트로 "사용 중 origin"에 한정해 기각.
3. **MAIN 레코더가 chrome.storage로 활성 여부 확인**: 비동기라 `document_start` 동기 판정 불가 → 초반 요청 놓침. sessionStorage(동기)가 유일.
4. **logClear 충돌 해법으로 "active origin은 reload에서 logClear 스킵"**: background가 active 여부를 모르고 content script→background 통보가 필요해 "background 무변경" 원칙과 충돌. 대신 sidepanel 수신부에서 엔트리 `preArm` 마커로 우회하는 편이 변경면이 작아 채택.

## 위험 요소

- **console error/warn 조기 후킹 회귀(최우선 실탭 검증)**: `captureStack`의 `slice(4)`가 V8 인라인 가정에 의존(`console-recorder.ts:70-72`). error/warn wrap을 `document_start`로 당기면 스택 정렬·페이지 Sentry 상호작용·uninstall(pagehide 복원) 경로를 **실제 탭에서 회귀 확인** 필요(단위 테스트로 못 잡음). 회귀 시 attribution 오염이 active origin에 상시화되므로 위험도 높음 → Task 3 단독 커밋.
- **pre-arm 마커 오·과적용**: `preArm` 마커는 새 document에서 document_start 이후 적재분에만 붙어야 한다(reload 전 옛 로그는 이미 store.clear로 비워지고 늦은 sync는 preArm=false라 필터됨). 마킹 조건(`recording===false`일 때만 true)을 정확히 지킬 것 — 단위 테스트(`shouldDropPreArmEntry`) + 회귀로 검증.
- **사용자 노출 "녹화 중" UI와 무관함 명시**: 사용자에게 보이는 "녹화 중"(`RecordingState`)은 **video 캡처 phase 전용**이고 로그 레코더 `recording` 플래그와 별개다. pre-arm은 로그 레코더에만 관여하므로 이 UI에 영향 없음. 로그 탭은 video recording phase 동안 잠겨(`logTabsLocked`) flush 점프가 사용자에게 실시간 노출되지 않음 → 별도 UI 처리 불필요.
- **privacy.md 대조 필요**: 광역 호스트 권한(기존)으로 캡처 **시작 시점이 앞당겨진다**(active origin 한정, 페이지 메모리 일시 보관, sentinel 없으면 전송 0·네비 시 폐기). manifest diff 0이지만 CLAUDE.md 프라이버시 게이트상 "기존 권한의 새 캡처 타이밍"에 해당 → docs/privacy.md 대조·필요 시 시행일 갱신.
- **sessionStorage 부수효과**: 페이지 sessionStorage에 `__bugshot_recorder_active__`="1" 키를 남김(페이지 JS 관측 가능, 데이터 아닌 상수). prefix로 충돌 최소화.
- **totalSeen·entryNavEmitted 일관성**: pre-arm 적재분도 게이트 뒤에서 `totalSeen++` → flush 시 카운트 일관. action-recorder는 pre-arm 캡처 load 액션과 `setSentinel` 보충 load(`entryNavOnBind`)의 중복을 `entryNavEmitted` 가드가 막는지 회귀 테스트로 확인.
