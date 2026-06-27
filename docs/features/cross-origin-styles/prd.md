# Cross-origin 스타일 보강 (Cross-origin author styles)

## 배경

picker로 선택한 요소의 스타일이 **다른 origin의 stylesheet**(예: `www.naver.com` 페이지인데 CSS는 `pstatic.net` CDN)에서 올 때, BugShot의 specified(author rule) 채널이 통째로 빈다. 원인:

- `sheet.cssRules` 접근이 cross-origin이면 `SecurityError` → rule 인스턴스 자체를 못 얻음 (`css-source-cache.ts:buildRuleIndex` try-catch skip).
- 보완용 `fetch(href)`도 `url.origin !== location.origin`이면 명시적 skip (`css-source-cache.ts:fetchSheetText:419`).

결과: 클래스명만 보이고 "어느 규칙에서 무슨 스타일이 왔는지"가 손실된다. 직전에 섹션 펼침(`sectionDefaultOpen`)으로 computed fallback은 노출되게 했지만, **author 전용 값**(sprite `background-image`, `var()` 토큰으로 쓴 색·간격, 소스 출처)은 여전히 안 잡힌다.

content script(ISOLATED)는 cross-origin stylesheet를 직접 fetch할 수 없지만(CORS), **background service worker는 host_permissions로 grant된 origin을 CORS 우회로 fetch**할 수 있다(기존 GitHub/Notion API fetch와 동일 메커니즘). 이미 `<all_urls>`를 optional로 보유(30s Replay·BYOK가 런타임 요청)하므로, 그 권한이 grant된 사용자에 한해 cross-origin CSS를 읽어 specified 채널을 채울 수 있다.

## 목표

- `<all_urls>`가 이미 grant된 사용자가 cross-origin stylesheet에서만 스타일을 받는 요소를 선택하면, background가 그 stylesheet를 fetch하고 원문 CSS를 파싱해 **specified 값·소스 출처**를 보강한다.
- cross-origin sheet의 `:root` 커스텀 프로퍼티(`--*`)까지 파싱해 `var()` 토큰을 실제 값으로 해석한다 (naver처럼 `var()` 범벅인 사이트도 의미 있는 값 노출).
- 보강된 specified는 기존 same-origin과 동일한 UI 경로(필드 값·소스 툴팁·섹션 펼침)로 표시된다.
- 권한 미보유·fetch 실패 시 **조용히 computed fallback**으로 떨어진다(에러 노출 없음, `sectionDefaultOpen` 동작 유지).

## 비목표 (Non-goals)

- `<all_urls>`를 required host_permission으로 승격하지 않는다 (optional 유지, 심사 리스크 회피).
- cross-origin 보강 전용 권한 요청 UI를 만들지 않는다 (Replay/BYOK로 이미 grant된 권한만 재사용).
- 정확한 CSS cascade·specificity 재현은 하지 않는다. same-origin이 이미 채운 prop은 덮지 않고, **빈 prop만** cross-origin으로 채우는 보강에 한정.
- pseudo-element(`::before`/`::after`)·media query 외 조건부 규칙의 정밀 평가는 기존 수준 유지(별도 확장 안 함).
- iframe 내부 요소는 여전히 미지원 (picker top-frame 한정 제약 불변).
- sprite `background-image`의 이미지 자체 표시·추출은 하지 않는다 (url 문자열까지만 specified로 노출).

## 사용자 시나리오

### 주 시나리오 (권한 보유)
1. 사용자가 30s Replay 또는 BYOK로 `<all_urls>`를 이미 허용한 상태.
2. naver.com에서 로그인 버튼(`#account > div > a`)을 picker로 선택.
3. 즉시(동기): same-origin specified가 비어 computed fallback으로 섹션 펼침 — 기존 동작.
4. 잠시 후(비동기): background가 `pstatic.net`의 stylesheet를 fetch → 파싱 → 매칭 → specified 보강 메시지 도착.
5. 스타일 필드가 author 값으로 채워지고(예: `color`, `padding`, `background-image` sprite url), `var()` 토큰은 실제 값으로 해석되며, 소스 툴팁에 `external · main.css`가 표시된다.

### 엣지 케이스
- **권한 미보유**: 4단계 fetch를 시도하지 않고 computed fallback 유지. 사용자 체감은 직전 픽스 상태와 동일.
- **fetch 실패**(4xx, 네트워크, 일부 CDN 차단): 해당 sheet만 skip, 나머지는 보강. 에러 안 띄움.
- **same-origin + cross-origin 혼재**: same-origin이 채운 prop은 유지, cross-origin은 빈 prop만 채움.
- **요소 전환·DOM nav**: 새 요소 선택 시 보강도 다시 수행(기존 `picker.selectionUpdated` 흐름 재사용).
- **fetch 도착 전 요소 변경**: 도착 시점 선택 요소와 불일치하면 보강 결과 폐기(기존 `selectedEl !== el` 가드 패턴).

## 성공 기준

- `<all_urls>` grant 상태에서 cross-origin stylesheet에서만 스타일을 받는 요소를 선택하면, specified 필드에 author 값이 채워지고 소스가 `external · <파일명>`으로 표시된다.
- cross-origin `:root` 변수를 쓴 prop이 `var(...)` 문자열이 아니라 해석된 실제 값으로 표시된다.
- 권한 미보유 시 fetch가 전혀 일어나지 않고(네트워크 0), UI는 computed fallback을 유지한다.
- same-origin 페이지의 specified 수집·표시에 회귀가 없다(기존 e2e green 유지).
- e2e: cross-origin fixture에서 specified 값 보강 + 소스 표시가 자동 판정된다.
