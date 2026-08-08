# 디바이스 뷰포트 — 프레임 차단 헤더 우회

## 배경

디바이스 뷰포트 모드는 페이지 안에 same-origin iframe 래퍼(`#__bugshot_device_frame__`)를 심고
`location.href`를 그 안에서 재로드한다. 그런데 대상 사이트가 `X-Frame-Options` 또는
CSP `frame-ancestors`로 프레임 삽입을 거부하면 브라우저가 로드를 막고, background가 그 신호를
`frameBlocked`로 판정해 모드가 `전체`로 롤백된다.

실측(2026-08-08):

| 사이트 | 결과 | 원인 |
|---|---|---|
| google.com | 성공 | `X-Frame-Options: SAMEORIGIN` — 래퍼가 same-origin이라 통과 |
| skillflo.com | 성공 | 차단 헤더 없음 |
| github.com | 실패 | `X-Frame-Options: deny` |
| naver.com | 실패 | 래퍼 요청이 `net::ERR_BLOCKED_BY_RESPONSE`로 거부 |

naver 실패 시점의 background 상태는 `{armed: true, topUrl: "https://www.naver.com/",
provisionalFrameId: 1623, binding: null}`이었다 — **판정 로직 자체는 정상이었다.** 래퍼를
잠정 등록까지 마친 뒤 브라우저가 응답을 거부했고, 그걸 `frameBlocked`로 올바르게 접었다.
고쳐야 할 것은 판정이 아니라 "거부당한다"는 사실 쪽이다.

`net::ERR_BLOCKED_BY_RESPONSE`는 **XFO와 CSP `frame-ancestors` 위반에 공통으로 쓰인다** —
에러 코드로는 둘을 못 가른다. 그래서 e2e는 두 갈래를 각각의 픽스처로 덮어야 한다.

`SAMEORIGIN`은 래퍼가 top과 same-origin이라는 불변식 덕에 자연히 통과한다. 문제는 `DENY`와
`frame-ancestors`를 쓰는 사이트다.

**클릭재킹 방어는 로그인 있는 서비스의 사실상 표준이다.** 즉 디바이스 뷰포트를 쓸 이유가 가장
큰 대상(사내 SaaS, 인증 뒤 화면, 결제 플로우)일수록 차단 헤더를 건다. 우회 없이는 이 기능이
"차단하지 않는 사이트에서만 되는 기능"으로 남는다.

경쟁 확장(Hoverify)은 같은 문제를 `declarativeNetRequest` 세션 룰로 `Content-Security-Policy`와
`X-Frame-Options` 응답 헤더를 제거해 푼다. 다만 그쪽은 responsive viewer가 **확장 소유의 전용
탭**(`chrome-extension://…/responsive.html`)에서 돌아 헤더 제거의 영향이 그 탭에 갇힌다.
BugShot은 사용자가 보던 탭에 in-page로 심는 구조라 적용 범위를 더 좁혀야 한다.

## 목표

1. `X-Frame-Options: DENY` 또는 CSP `frame-ancestors`로 프레임 삽입을 막는 사이트에서도
   디바이스 뷰포트 모드가 정상적으로 선다.
2. 헤더 제거의 영향 범위가 **디바이스 모드가 켜진 탭의 서브프레임 응답**으로 한정된다 —
   사용자가 보던 top 문서의 CSP는 그대로 유지된다.
3. 모드가 꺼지거나 탭이 닫히거나 판정이 차단으로 끝나면 룰이 즉시 사라진다. 확장이 상시로
   보안 헤더를 끄는 상태가 존재하지 않는다.
4. 우회해도 여전히 못 서는 경우(그 외 원인)의 UX는 지금과 동일하다 — `전체` 롤백 +
   `issue.device.blocked` 토스트.

## 비목표 (Non-goals)

- **사용자 토글 제공하지 않는다.** 모드 ON이면 자동 적용이다. 설정 항목을 늘릴 값이 없다.
- **실패 문구를 분화하지 않는다.** "프레임 삽입이 막혔다" vs "페이지가 응답하지 않는다"를
  가르지 않고 기존 단일 문구를 유지한다.
- **CSP를 지시어 단위로 편집하지 않는다.** `declarativeNetRequest`는 헤더 단위 remove/set만
  지원하고 원본 값을 읽을 수 없어 `frame-ancestors`만 빼는 것이 불가능하다. MV3라 blocking
  `webRequest`로 값을 재작성하는 우회도 없다.
- **top 문서(MAIN_FRAME)의 헤더는 건드리지 않는다.** 래퍼만 새로 로드되므로 필요가 없다.
- **전용 탭 방식(Hoverify형)으로 아키텍처를 바꾸지 않는다.** 사이드패널이 탭 스코프인 구조와
  picker·로그 레코더 배선 전체가 in-page 래퍼를 전제로 서 있다.

## 사용자 시나리오

### 주요 플로우 — 차단 사이트에서 모드 켜기

1. 사용자가 `github.com`에서 사이드패널을 열고 Debug > 이슈 진입 화면에서 폭 `390`을 고른다.
2. (최초 1회) 확인 다이얼로그가 뜨고 [계속]을 누른다.
3. 사이드패널이 background에 `device.arm {on:true}`를 보낸다. **background가 그 탭에 대한
   헤더 제거 세션 룰을 등록한 뒤** 감시창을 연다.
4. 사이드패널이 `device.set`으로 래퍼를 마운트시킨다. 래퍼가 `location.href`를 로드하고,
   그 응답에서 `X-Frame-Options`·`Content-Security-Policy`가 제거돼 로드가 성공한다.
5. background가 `committed`/`frameReady`로 성공을 판정해 `frameLoaded`를 push한다.
6. 페이지가 390px 폭으로 서고, 이후 캡처·로그·요소 선택이 평소대로 동작한다.

### 모드 끄기

1. 사용자가 `전체`를 고른다.
2. 래퍼가 걷히고 `location.reload()`가 돌아 top이 다시 커밋된다.
3. background의 `clearDeviceFrame`이 binding과 함께 **헤더 제거 룰도 제거**한다.
4. 이후 그 탭의 모든 요청은 사이트 원래 헤더를 그대로 받는다.

### 엣지 케이스

| 상황 | 기대 동작 |
|---|---|
| 우회했는데도 래퍼가 안 섬 (다른 원인) | 기존과 동일 — `frameBlocked` → `전체` 롤백 + `issue.device.blocked` 토스트. **그 판정 시점에 룰도 제거**된다 |
| 모드 ON 중 다른 출처로 이동 (handoff) | top이 그 주소로 이동 → top 커밋에서 `clearDeviceFrame`이 룰 제거 → 재수립의 `device.arm`이 새 탭 상태로 다시 등록 |
| 모드 ON 중 탭 종료 | `forgetTab` → `clearDeviceFrame` → 룰 제거 |
| 모드 ON 중 SW 종료·재시작 | 세션 룰은 브라우저 세션 동안 유지되므로 모드는 계속 동작한다. 정리는 다음 top 커밋의 `clearDeviceFrame` 또는 탭 종료가 맡는다 |
| 확장 재시작(reload·업데이트) | `onStartup`/`onInstalled`에서 우리 네임스페이스의 잔여 룰을 전부 제거한다 |
| 룰 등록 자체가 실패 | 조용히 진행한다(fail-open). 차단 사이트면 기존과 똑같이 실패할 뿐, 새 실패 모드를 만들지 않는다 |
| 모드 OFF 상태 | 룰이 존재하지 않는다. 그 탭의 헤더는 손대지 않는다 |

## 성공 기준

1. `e2e/device-viewport.spec.ts`의 "X-Frame-Options: DENY 페이지에서는 3초 안에 전체로
   롤백된다" 테스트가 **뒤집혀** — 같은 픽스처에서 모드가 정상적으로 서는 것을 검증한다.
2. CSP `frame-ancestors 'none'`을 내는 e2e 픽스처 라우트를 새로 추가하고, 그 페이지에서도
   모드가 선다.
3. 모드를 끈 뒤 같은 탭에서 요청한 응답에 사이트 원래 `X-Frame-Options`가 그대로 남아 있다
   (룰 제거 검증).
4. `chrome.declarativeNetRequest.getSessionRules()`가 모드 OFF 상태에서 BugShot 룰 0건을
   돌려준다 — 모드 ON·OFF 왕복 후에도 누적되지 않는다.
5. manifest에 추가되는 권한은 `declarativeNetRequestWithHostAccess` **하나**다.
6. `docs/privacy.{ko,en}.md`에 응답 헤더 수정 사실과 그 범위·수명이 명시된다.
