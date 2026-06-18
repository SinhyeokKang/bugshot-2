# 로그 레코더 Pre-arm 버퍼링 — 기술 설계

## 개요

세 MAIN world 레코더(network/console/action)에 **pre-arm 버퍼링 모드**를 추가한다. `document_start` 주입 시 sessionStorage의 active 플래그를 동기로 읽어, 플래그가 있으면 sentinel 도착 전에도 후킹 결과를 버퍼에 쌓는다(dispatch는 sentinel 없으면 no-op). `setSentinel`이 도착하면 버퍼를 그대로 flush해 초반 로그가 소급 전송된다. 플래그는 레코더가 armed될 때(`setSentinel`) 기록되고 stop 시 제거된다 — "이 origin/탭에서 bugshot이 활성"이라는 신호.

재무장 타이밍(`useBackgroundRecorder`의 `status:complete`)과 iframe 경로는 건드리지 않는다. 버퍼링이 누락 창을 덮는다.

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
  try {
    return isPreArmFlag(sessionStorage.getItem(PREARM_FLAG_KEY));
  } catch {
    return false;
  }
}
export function setPreArmFlag(): void {
  try { sessionStorage.setItem(PREARM_FLAG_KEY, "1"); } catch { /* sandboxed */ }
}
export function clearPreArmFlag(): void {
  try { sessionStorage.removeItem(PREARM_FLAG_KEY); } catch { /* sandboxed */ }
}
```

### `src/content/network-recorder.ts`
- 현재: `recording=false`로 시작, `recordHook`이 `if (!recording) return`으로 sentinel 전 요청 버림.
- 변경:
  - 모듈 init에서 `const preArm = readPreArmFlag(); let capturing = preArm;` 도입. `recording`은 dispatch 자격(=sentinel 보유)과 동일하게 유지.
  - `recordHook` 게이트를 `if (!capturing) return` 으로 교체(버퍼 적재 조건). dispatch는 기존대로 `currentSentinel` 없으면 no-op이므로 pre-arm 중 전송은 자동 차단.
  - `setSentinel(sentinel)`: 기존 동작 + `capturing = true; setPreArmFlag(); if (buffer.length) throttle.schedule();`(쌓인 초반 버퍼 소급 flush).
  - `stopHandler`: 기존 `recording=false; throttle.flushNow()` + `capturing = false; clearPreArmFlag();`.
  - `clearHandler`(clearBuffer): 변경 없음.

### `src/content/console-recorder.ts`
- network와 동일한 `preArm`/`capturing` 도입. `pushEntry` 게이트를 `if (!capturing) return`로 교체.
- **error/warn 후킹 시점 변경**: 현재 `installEw()`(error/warn wrap)는 `setSentinel`에서만 호출(`console-recorder.ts:69` "attribution 오염 창 한정"). 변경 후 — `preArm===true`이면 모듈 init에서도 `installEw()`를 호출해 `document_start`부터 error/warn을 후킹한다(초반 에러/경고 캡처). `installEw`는 직전 메서드(페이지 Sentry 등)를 먼저 호출하므로 DevTools/모니터링 보존은 유지. stop 시 `uninstallEw()` + `clearPreArmFlag()`.
- `setSentinel`: `capturing=true; setPreArmFlag();` + 버퍼 소급 flush. (이미 init에서 ew 후킹된 경우 `installEw`는 멱등 가드(`ewState.installed`)로 재설치 안 함.)

### `src/content/action-recorder.ts`
- network와 동일한 `preArm`/`capturing` 도입. `pushAction`/input dedup 게이트를 `capturing` 기준으로 교체.
- `setSentinel`: 기존 `entryNavOnBind` 진입 네비 보충 로직 유지(중복 방지 가드 `entryNavEmitted`가 있어 pre-arm 중 캡처된 load 액션과 충돌 없음) + `capturing=true; setPreArmFlag();` + 버퍼 소급 flush.
- `stopHandler`: `capturing=false; clearPreArmFlag()` 추가.

### 변경 없음 (확인용)
- `src/background/index.ts`(navigation/logClear), `useBackgroundRecorder.ts`(재무장 트리거), `picker-control.ts`(sentinel 발행/rebroadcast), `recorder-bridge.ts` — 모두 무변경. 플래그 set/clear는 MAIN world 레코더 내부에서 자기완결.

## 데이터 흐름

```
[active origin 새로고침]
 document_start
   └ MAIN 레코더 init → readPreArmFlag()===true → capturing=true (preArm)
        (console: error/warn wrap도 여기서 설치)
 페이지 스크립트 실행
   └ fetch/XHR/console/click → 게이트 통과(capturing) → buffer 적재
        dispatch는 currentSentinel 없어 no-op (전송 0)
 status:complete
   └ useBackgroundRecorder.inject() → activateXRecorder → setSentinel(new)
        └ MAIN setSentinel: recording=true, capturing=true, setPreArmFlag(),
          throttle.schedule() → buffer(초반 로그 포함) dispatch
 → 사이드패널/IDB에 초반 로그까지 반영

[bugshot 미사용 origin]
 document_start → readPreArmFlag()===false → capturing=false
   └ recordHook/pushEntry 즉시 return → 무부하 (현행과 동일)
```

상태 모델: `capturing`(버퍼 적재 여부) = `preArm || recording`. `recording`(=sentinel 보유, dispatch 자격)은 의미 그대로. stop은 둘 다 false + 플래그 제거.

## 인터페이스 설계

- `recorder-prearm.ts`: 위 4개 export(`PREARM_FLAG_KEY`, `isPreArmFlag`, `readPreArmFlag`, `setPreArmFlag`, `clearPreArmFlag`).
- 세 레코더 IIFE 내부 지역 변수 `capturing: boolean` 추가. 외부 시그니처(메시지 타입, `CTRL_KEY` 인터페이스, dispatch payload) 변경 없음 → 사이드패널/브리지 호환 유지.

## 기존 패턴 준수

- **순수 헬퍼 분리 + `__tests__`**: `action-recorder-helpers.ts`/`entryNavOnBind`처럼 판정부(`isPreArmFlag`)를 순수 함수로 분리해 Vitest로 검증(CLAUDE.md "테스트 우선").
- **세션 영속화**: sessionStorage는 같은 탭·origin의 reload/same-origin 네비에서 살아남고 탭 종료 시 자동 소멸 — 별도 정리 로직 불필요.
- **MAIN world self-contained**: 플래그 set/clear/read 모두 페이지 sessionStorage(모든 world 공유)로 MAIN 레코더 안에서 완결. `executeScript({world:"MAIN"})` 직렬화 제약과 무관(import는 번들 시 inline).
- **캡 재사용**: 기존 entry cap(`buffer.shift`)·memory cap(`enforceMemoryCap`)이 pre-arm 버퍼에도 그대로 적용돼 sentinel 미도착 시 메모리 상한 보장.

## 대안 검토

1. **top frame 재무장을 `onCommitted`/`onDOMContentLoaded`로 앞당김** (iframe `frameCommitted` 경로를 top frame에 확장): 변경은 작지만 background→사이드패널→executeScript→setSentinel async 왕복 갭이 남아 **맨 초반 버스트는 여전히 일부 누락**. 누락을 완전히 닫지 못해 기각. 채택안(버퍼링)은 `document_start`부터 적재하므로 갭이 없다.
2. **모든 페이지에서 무조건 pre-arm 버퍼링**(게이트 없음): 구현은 더 단순하나 패널을 안 연 모든 페이지가 상시 fetch/XHR/console 후킹+바디 복제 비용을 짊어짐(성능·프라이버시 후퇴). sessionStorage 게이트로 "사용 중 origin"에 한정해 기각.
3. **MAIN 레코더가 chrome.storage로 활성 여부 확인**: chrome.storage는 비동기라 `document_start` 동기 판정 불가 → 초반 요청을 놓침. sessionStorage(동기)가 유일하게 맞음.

## 위험 요소

- **console error/warn 조기 후킹 회귀**: `captureStack`의 `slice(4)`가 V8 인라인 가정에 의존(`console-recorder.ts:70-72`)해 실탭에서만 검증 가능. error/warn wrap을 `document_start`로 당기면 스택 정렬·페이지 Sentry 상호작용을 **실제 탭에서 회귀 확인** 필요(단위 테스트로 못 잡음).
- **sessionStorage 부수효과**: 페이지 sessionStorage에 `__bugshot_recorder_active__` 키를 남김(페이지 JS가 관측 가능). 키명 충돌·노출 최소화를 위해 prefix 유지. 일부 사이트가 sessionStorage를 전수 검사/직렬화하면 키가 보일 수 있음(데이터 아님, 상수 "1").
- **privacy.md 대조 필요**: 광역 호스트 권한(기존)으로 캡처 **시작 시점이 앞당겨진다**(active origin 한정, 페이지 메모리에 일시 보관, sentinel 없으면 전송 0·네비 시 폐기). manifest diff는 0이지만 CLAUDE.md 프라이버시 게이트상 "기존 권한의 새 캡처 타이밍"에 해당 → docs/privacy.md 대조·필요 시 시행일 갱신.
- **pre-arm 중 totalSeen**: pre-arm 적재분도 `totalSeen` 증가(게이트 뒤에서 증가) → flush 시 카운트 일관. 변경 불필요하나 회귀 테스트로 확인.
- **iframe 동작**: 게이트가 프레임-origin별 sessionStorage라 cross-origin iframe은 자기 origin 플래그로 독립 판정. 기존 `frameCommitted` 경로와 충돌 없음(set/clear 주체가 동일 MAIN 레코더).
