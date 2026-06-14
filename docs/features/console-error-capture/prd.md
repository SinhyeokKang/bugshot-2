# 페이지 console.error/warn 캡처

## 배경

현재 콘솔 레코더(`src/content/console-recorder.ts`)는 페이지가 직접 호출한 `console.error` / `console.warn`을 **의도적으로 캡처하지 않는다**. native `console.error/warn`을 wrap하면 호출 시점 콜스택에 확장 origin(`chrome-extension://`) 프레임이 끼어 Chrome이 "이 확장이 에러를 찍었다"로 잘못 attribution → `chrome://extensions` 오류 로그가 페이지 에러로 오염되기 때문이다.

그 결과 잡히는 에러는 (a) uncaught 예외(`window 'error'`), (b) unhandled rejection, (c) `console.assert` 실패뿐이다. 하지만 현실 프론트 에러의 큰 비중은 **catch돼서 `console.error`로 새는 부류**다:
- React error boundary가 잡아 `console.error`
- `try/catch` + `console.error(e)` (axios 인터셉터, SDK)
- 라이브러리 경고(`console.warn`: deprecation, 네트워크 경고)

이들은 uncaught가 아니라 `window 'error'`에 안 걸려 logs.html에서 영영 보이지 않는다. 네트워크에 흔적이 안 남는 순수 클라이언트 로직 버그에서 이 신호가 디버깅의 핵심인데 비어 있다.

벤치마크: 경쟁 제품 Jam은 rrweb console 플러그인으로 `error`/`warn`을 포함한 전 레벨을 **동기 wrap**하고 attribution을 그대로 감수하되, 캡처 스크립트를 **녹화(버퍼링) 세션에만 programmatic 주입**해 오염 창을 세션으로 한정한다. 회피 트릭은 없다(검증됨 — microtask 지연·inline 주입 모두 ext 프레임이 남거나 strict CSP에서 에러가 유실됨).

## 목표

- 페이지가 호출한 `console.error` / `console.warn`을 콘솔 로그에 캡처한다.
- 캡처는 백그라운드 레코더가 arm된 동안에만 이뤄지고, arm 해제(`stop`) 시 native로 복원해 **attribution 오염 창을 "사이드패널이 supported 페이지에서 레코더를 arm한 구간"으로 한정**한다.
- 30s 리플레이·수동 영상 캡처 모두에서 캡처 직전 구간의 error/warn이 채워진다(백그라운드 레코더가 캡처 전부터 arm돼 있으므로).
- 기존 캡처 신호(uncaught/rejection/assert/log/info/debug)와 뷰어 표현을 회귀 없이 유지한다.

## 비목표 (Non-goals)

- **attribution 오염 자체의 제거**: 동기 wrap인 이상 arm 구간 중에는 `chrome://extensions`에 페이지 error/warn이 수집된다. 이는 수용한다(일반 사용자는 개발자 모드에서만 노출). 회피 트릭은 추구하지 않는다.
- **레코더가 arm되기 전(패널 닫힘·미지원 페이지) 발생한 error/warn 소급 캡처**: 하지 않는다. 기존 log/info/debug 캡처 의미론과 동일하게 arm된 구간만.
- **`console.log/info/debug` 캡처 라이프사이클 변경**: 현행(콘텐츠 스크립트 평가 시 상시 wrap + `recording` 플래그로 capture 게이트) 유지. 이들은 오염을 유발하지 않으므로 건드리지 않는다.
- **소스맵 기반 스택 복원**: 캡처하는 스택은 페이지 번들 기준(prod는 minified). 복원하지 않는다.
- **새 UI / 새 필터**: Console 로그 탭은 이미 error/warn 레벨을 색·아이콘·필터로 렌더한다. 추가하지 않는다.

## 사용자 시나리오

### 주 시나리오: catch된 에러가 logs.html에 잡힌다
1. 사용자가 사이드패널을 열고 supported 페이지에 머문다 → 백그라운드 레코더 arm(`recording=true`).
2. 페이지에서 버그 동작이 발생, 앱이 `try/catch`로 잡아 `console.error("결제 토큰 만료", err)`를 호출.
3. 사용자가 30s 리플레이 또는 수동 영상으로 캡처.
4. 발행된 logs.html의 콘솔 로그에 `error` 레벨로 `"결제 토큰 만료 ..."`(+ 가능 시 스택)가 보인다.

### 엣지: 레코더 미arm 구간
- 패널을 닫거나 `chrome://`·웹스토어 등 미지원 페이지에 있을 때 발생한 `console.error`는 캡처되지 않으며, 그 구간 `console.error`는 native 그대로(=`chrome://extensions` 오염 없음).

### 엣지: 페이지가 console.error를 자체 wrap
- 페이지 코드가 우리 wrap 위에 또 `console.error`를 재정의한 경우, `stop` 시 복원은 **현재 `console.error`가 우리 wrapper일 때만** 수행한다(아니면 페이지 wrapper를 보존하고 건드리지 않음).

### 엣지: arm/disarm 반복
- 네비게이션·idle 복귀로 `setSentinel`↔`stop`이 반복돼도 wrap 설치는 멱등이고, 복원→재설치 사이클이 정상 동작한다.

## 성공 기준

- arm된 상태에서 페이지가 `console.error(...)` / `console.warn(...)`을 호출하면, 해당 텍스트가 각각 `error` / `warn` 레벨 콘솔 엔트리로 버퍼에 들어가고 logs.html에 나타난다.
- arm 해제(`stop`) 후 `console.error`/`console.warn`은 native 동작(원본 호출)으로 복원된다.
- DevTools 콘솔 출력은 wrap 여부와 무관하게 그대로 보인다(원본을 항상 호출).
- 기존 uncaught/rejection/assert 캡처와 log/info/debug 캡처가 동일하게 동작한다(회귀 없음).
- `pnpm test` 통과(기존 helper 단위 테스트 + 신규 분기 테스트).
- e2e: "arm 중 페이지 console.error 호출 → 콘솔 로그에 error 엔트리" 시나리오 green.
