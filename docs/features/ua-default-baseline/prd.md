# UA 기본값 기준선 — 유령 기본값의 구조적 제거

## 배경

스타일 편집기는 "이 값이 저자가 설정한 것인가, 브라우저 기본값인가"를 계속 판정해야 한다. 이 판정이 두 곳을 좌우한다.

- `sectionDefaultOpen`(`src/sidepanel/lib/sectionDefaultOpen.ts`) — 섹션을 펼친 채로 띄울지
- `ValueCombobox` — 값을 실값으로 보여줄지, 디밍된 기본값으로 보여줄지

지금 이 판정의 단일 출처는 **손으로 적은 테이블**이다. `KNOWN_DEFAULTS`(`src/sidepanel/tabs/styleEditor/propMetadata.ts:51`)에 prop 60여 개의 기본값 문자열이 박혀 있다.

문제는 `getComputedStyle`이 **거의 모든 prop을 빈값 아닌 resolve값으로 돌려준다**는 것이다. 그래서 테이블에 없는 prop은 자동으로 "기본값 아님" → 항상 활성으로 샌다. POSTMORTEM이 이 계열을 두 번 기록했다.

- **2026-06-29** — Transition 섹션이 트랜지션 없는 요소에서도 항상 펼쳐졌다. `getComputedStyle`이 `transition-property: all` / `transition-duration: 0s` / `transition-timing-function: ease` / `transition-delay: 0s`를 **항상 채워** 돌려주는데 이 4개가 `KNOWN_DEFAULTS`에 없었다. 회고의 문장: *"getComputedStyle이 longhand로 항상 채우는 단축 프롭(transition·animation·background·font·grid 등)은 전부 같은 함정 — shorthand 섹션을 추가할 때마다 재발한다."*
- **2026-06-28** — 테두리가 없는 요소에 border-color(= 글자색)가 실제 값처럼 노출됐다. `KNOWN_DEFAULTS`에 적어둔 `"currentcolor"` 엔트리가 **dead**였다 — `getComputedStyle`은 그 키워드를 절대 리터럴로 안 돌려주고 이미 concrete rgb로 해석해 준다.

두 회고의 재발 방지책이 전부 **"테이블을 손으로 채워라"**다. 즉 지금 구조에서는 다음 prop·다음 섹션에서 또 터진다. 이 문서는 그 테이블을 **런타임 실측 기준선**으로 대체해 계열 자체를 끊는다.

기준선 확보 방법: 페이지에 숨김 `about:blank` iframe을 하나 만들고 같은 태그의 빈 요소를 넣어 `getComputedStyle`을 뜬다. `about:blank`엔 페이지 CSS가 0이므로 그 결과가 **순수 UA 기본 스타일**이다. 선택 요소의 computed와 차분하면 "저자가 손댄 것"만 남는다.

## 목표

- **G1** — `KNOWN_DEFAULTS` 테이블에 없는 prop도 기본값 판정이 된다. `SECTION_PROPS`에 새 섹션을 추가할 때 테이블 동시 등록을 잊어도 섹션이 항상 펼쳐지지 않는다.
- **G2** — 기준선은 **tagName별로 1회 계산 후 캐시**된다. 요소를 선택할 때마다 DOM을 만들고 지우지 않는다.
- **G3** — 기준선 확보가 실패해도(CSP·`contentDocument` null) 오늘과 **정확히 같은 동작**으로 폴백한다.
- **G4** — 숨김 iframe이 페이지 렌더링·스크린샷·스크롤 캡처·로그 수집에 영향을 주지 않고, picker 세션 종료 시 확실히 제거된다.

## 비목표 (Non-goals)

- **`KNOWN_DEFAULTS` 테이블 삭제** — 남긴다. UA 차분은 **덮어쓰기가 아니라 보강**이다. 이유는 아래 "왜 대체가 아니라 보강인가" 참조.
- **`isInactiveBorderColor` 제거** — 남긴다. UA 차분이 이 케이스를 **못 잡는다**(아래 참조).
- **Hoverify식 `innerHTML` 복사** — 베끼지 않는다. 비싸고, 페이지 콘텐츠를 우리가 만든 iframe에 복제하는 건 프라이버시 표면이 된다.
- **레이아웃 의존 prop의 기본값 판정** — `width`/`height`/`min-*`/`max-*`는 used value가 나오므로 차분이 거의 항상 "다름"이 된다. 오늘과 동일하게 실값 취급한다.
- **새 권한·env·의존성**. 없음.

## 왜 대체가 아니라 보강인가

UA 차분이 답하는 질문은 **"about:blank의 맨 `<tag>`와 값이 같은가"**다. `KNOWN_DEFAULTS`가 답하는 질문은 **"이 값이 이 prop의 명세상 초기값인가"**다. 둘은 다르고, 각자 못 잡는 게 있다.

| 케이스 | UA 차분 | KNOWN_DEFAULTS |
|---|---|---|
| `transition-duration: 0s` (미등록 prop) | ✅ 기준선도 `0s` → 걸러짐 | ❌ 테이블에 없어 통과 |
| 테두리 없는 요소의 `border-top-color` | ❌ 기준선은 UA 글자색 `rgb(0,0,0)`, 페이지 요소는 `rgb(45,49,54)` → **다름 → 통과** | ❌ dead keyword (POSTMORTEM 2026-06-28) |
| 저자가 `body { font-size: 14px }`로 상속시킨 값 | ✅ 기준선 `16px`와 다름 → 실값 (정답) | ❌ 테이블에 없음 |
| 저자가 UA 기본값과 **같은 값**을 명시 (`margin: 0`) | ⚠️ 같아서 걸러짐 — 저자 의도를 놓침 | ⚠️ 동일 |

border-color 행이 결정적이다. **`isInactiveBorderColor`는 반드시 남아야 한다** — 그 판정은 "같은 side의 border-style/width가 비활성이면 색은 의미 없다"는 **cross-prop 종속**이고, 단일 값 비교로는 표현할 수 없다.

그래서 판정 순서는 `specified 명시 → isInactiveBorderColor → UA 차분 → KNOWN_DEFAULTS`이고, **어느 하나라도 "기본값"이라 하면 기본값**이다.

## 사용자 시나리오

### S1. 새 섹션을 추가해도 항상 펼쳐지지 않는다

1. 개발자가 `SECTION_PROPS`에 `animation` 섹션(`animation-name`·`animation-duration`·…)을 추가하고 `KNOWN_DEFAULTS` 등록을 잊는다.
2. **현재**: `getComputedStyle`이 `animation-name: none` 등을 항상 채우고 테이블엔 없어 → 어떤 요소를 골라도 Animation 섹션이 펼쳐진다.
3. **변경 후**: 기준선 `<div>`의 `animation-name`도 `none`이라 차분에서 걸러진다 → 애니메이션이 실제로 걸린 요소에서만 펼쳐진다.

### S2. 상속받은 저자 값은 실값으로 남는다

1. 페이지가 `body { font-size: 14px; color: #333 }`를 두고, 사용자가 그 안의 `<span>`을 선택한다.
2. 기준선 `<span>`은 `16px` / `rgb(0,0,0)`이다 → 차분에서 다름 → 실값으로 표시된다. (저자가 손댄 게 맞으므로 정답)

### S3. 기준선을 못 만드는 페이지

1. CSP `frame-src 'none'` 등으로 `iframe.contentDocument`가 `null`이다.
2. 차분 없이 `KNOWN_DEFAULTS`만으로 판정한다 — **오늘과 완전히 동일한 동작**. 사용자에게 오류 표시나 기능 저하 안내는 없다.

### 엣지 케이스

- **E1. 세션 종료 / 탭 이동** — `handleClear`에서 iframe과 캐시를 함께 제거한다. 남으면 페이지에 우리 DOM이 잔류한다.
- **E2. 캡처 중** — iframe은 `display:none`이라 `captureVisibleTab`·스크롤 캡처 스티칭에 안 찍힌다. 스크롤 캡처의 fixed/sticky 후보 추적에도 안 잡힌다(렌더 박스가 없음).
- **E3. 페이지의 MutationObserver** — 우리가 `documentElement`에 노드를 하나 붙이므로 페이지가 반응할 수 있다. overlay 호스트가 이미 같은 일을 하고 있어 새로운 위험 축은 아니다.
- **E4. 로그 레코더** — iframe이 `about:blank`이라 네트워크 요청이 없고, `all_frames: true` content script는 `about:blank`에 주입되지 않거나 되더라도 sentinel이 없어 no-op다. 로그 오염 없음을 e2e로 확인한다.
- **E5. 알 수 없는 태그** — 커스텀 엘리먼트(`<my-widget>`)도 기준선 생성은 된다(UA는 unknown element를 `display:inline`으로 취급). 정상 동작.

## 성공 기준

1. `SECTION_PROPS`의 모든 prop에 대해, `KNOWN_DEFAULTS` 등록 여부와 무관하게 "손대지 않은 요소"에서 기본값 판정이 된다.
2. 기준선은 tagName당 1회만 계산된다 — 같은 태그의 요소를 10개 연속 선택해도 iframe DOM 조작이 1회다.
3. `contentDocument`가 `null`일 때 판정 결과가 변경 전과 **바이트 단위로 동일**하다.
4. picker 세션 종료 후 `document.querySelectorAll("iframe")` 개수가 세션 진입 전과 같다.
5. POSTMORTEM 2026-06-29(Transition 항상 펼침)·2026-06-28(유령 border-color) 두 증상이 회귀 테스트로 고정된다.
6. `pnpm test` + `pnpm typecheck` 통과, 기존 e2e green.
