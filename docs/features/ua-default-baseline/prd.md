# UA 기본값 기준선 — 유령 기본값의 구조적 제거

## 배경

스타일 편집기는 "이 값이 저자가 설정한 것인가, 브라우저 기본값인가"를 계속 판정해야 한다. 이 판정이 두 곳을 좌우한다.

- `sectionDefaultOpen`(`src/sidepanel/lib/sectionDefaultOpen.ts`) — 섹션을 펼친 채로 띄울지
- `ValueCombobox` / `StylePropEditors` — 값을 실값으로 보여줄지, 디밍된 기본값으로 보여줄지

지금 이 판정의 단일 출처는 **손으로 적은 테이블**이다. `KNOWN_DEFAULTS`(`src/sidepanel/tabs/styleEditor/propMetadata.ts:51`)에 prop **58개**의 기본값 문자열이 박혀 있다.

문제는 `getComputedStyle`이 **거의 모든 prop을 빈값 아닌 resolve값으로 돌려준다**는 것이다. 그래서 테이블에 없는 prop은 자동으로 "기본값 아님" → 항상 활성으로 샌다. POSTMORTEM이 이 계열을 두 번 기록했다.

- **2026-06-29** — Transition 섹션이 트랜지션 없는 요소에서도 항상 펼쳐졌다. `getComputedStyle`이 `transition-property: all` / `transition-duration: 0s` / `transition-timing-function: ease` / `transition-delay: 0s`를 **항상 채워** 돌려주는데 이 4개가 `KNOWN_DEFAULTS`에 없었다. 회고의 문장: *"getComputedStyle이 longhand로 항상 채우는 단축 프롭(transition·animation·background·font·grid 등)은 전부 같은 함정 — shorthand 섹션을 추가할 때마다 재발한다."*
- **2026-06-28** — 테두리가 없는 요소에 border-color(= 글자색)가 실제 값처럼 노출됐다. `KNOWN_DEFAULTS`에 적어둔 `"currentcolor"` 엔트리가 **dead**였다 — `getComputedStyle`은 그 키워드를 절대 리터럴로 안 돌려주고 이미 concrete rgb로 해석해 준다.

**이 문서가 구조로 바꾸는 것은 두 회고 중 앞의 1건이다.** 뒤의 border-color는 UA 차분이 **못 잡고**(아래 표), 기존 가드 `isInactiveBorderColor`가 그대로 그 자리를 지킨다. 두 회고를 함께 인용하는 이유는 규모가 아니라 대비다 — 어떤 계열이 새 축으로 풀리고 어떤 계열이 안 풀리는지가 이 기능의 사정거리를 정의한다.

기준선 확보 방법: 페이지에 숨김 `about:blank` iframe을 하나 만들고 같은 태그의 빈 요소를 넣어 `getComputedStyle`을 뜬다. `about:blank`엔 페이지 CSS가 0이므로 그 결과가 **순수 UA 기본 스타일**이다. 선택 요소의 computed와 차분하면 "저자가 손댄 것"만 남는다.

### 사정거리 (먼저 읽을 것)

이 기능이 실효를 갖는 범위는 좁고, 그 경계를 흐리면 검증 항목이 공허해진다.

1. **`INTERESTING_PROPS`에 등록된 prop만.** `selection.computedStyles`는 `INTERESTING_PROPS`(`src/content/css-resolve.ts`, **79개**)로만 채워진다. 거기 없는 prop은 애초에 `computedStyles`에 안 담기고, 기준선 수집도 같은 목록을 순회하므로 baseline에도 안 담긴다. 즉 `SECTION_PROPS`에만 prop을 추가하면 섹션은 "항상 펼쳐지는" 게 아니라 **항상 접힌다**(`sectionDefaultOpen`의 `v == null` 가지). **손으로 채워야 할 목록이 사라지는 게 아니라 `KNOWN_DEFAULTS` → `INTERESTING_PROPS` 하나로 줄어든다.**
2. **비상속 prop만.** 기준선은 `about:blank`의 문서 루트 문맥이다. 페이지 요소는 조상 체인에서 상속을 받으므로, `body { font-size: 14px }` 한 줄만 있어도 하위 모든 요소의 `font-size`가 영구히 "다름 → 실값"이 된다. `color`·`line-height`·`text-align`·`direction`·`white-space`·`letter-spacing`·`cursor`·`visibility`도 같다. S2가 이를 "정답"이라 부르는 것은 판정 기준이 *"저자가 손댔는가"*이기 때문이고 그건 맞지만, *"섹션이 항상 펼쳐진다"* 는 증상의 관점에서는 **Typography 섹션이 실사이트 대부분에서 여전히 펼쳐진다**는 뜻이다.
3. **레이아웃 비의존 prop만.** `width`/`height`/`min-*`/`max-*`는 used value가 나와 차분이 거의 항상 "다름"이 된다.

정리하면 UA 축이 새로 잡아내는 것은 **`INTERESTING_PROPS` 등록 ∩ 비상속 ∩ 레이아웃 비의존 ∩ `KNOWN_DEFAULTS` 미등록**의 교집합이다. 좁지만, 그 교집합이 정확히 POSTMORTEM 2026-06-29가 터진 자리다(`transition-*`·`animation-*` 같은 shorthand longhand 계열).

## 목표

- **G1** — `INTERESTING_PROPS`에는 등록했으나 `KNOWN_DEFAULTS` 등록을 잊은 prop도 기본값 판정이 된다. **사정거리는 비상속·레이아웃 비의존 prop 한정**(위 절).
- **G2** — 기준선은 **tagName별로 1회 계산 후 캐시**된다. 요소를 선택할 때마다 DOM을 만들고 지우지 않는다.
- **G3** — 기준선 확보가 실패해도(`contentDocument` null) 오늘과 **같은 판정 결과**로 폴백한다.
- **G4** — 숨김 iframe이 페이지 렌더링·스크린샷·스크롤 캡처·로그 수집·DOM 트리 네비게이터에 영향을 주지 않고, picker 세션 종료 시 확실히 제거된다.
- **G5** — 판정이 엄격해져 섹션이 더 많이 접히는 대신, **접힌 섹션이 "무엇을 감췄는지"를 헤더에서 알 수 있다.** 정보 소실 없이 접기만 늘리지 않는다.

## 비목표 (Non-goals)

- **`KNOWN_DEFAULTS` 테이블 삭제** — 남긴다. UA 차분은 **덮어쓰기가 아니라 보강**이다. 이유는 아래 "왜 대체가 아니라 보강인가" 참조.
- **`isInactiveBorderColor` 제거** — 남긴다. UA 차분이 이 케이스를 **못 잡는다**(아래 참조).
- **`INTERESTING_PROPS` 확장** — 이 기능에서 목록을 늘리지 않는다. "이왕 하는 김에"의 유혹이 가장 큰 지점이고, 늘리면 페이로드·기준선 계산이 함께 커져 변경의 효과를 분리 측정할 수 없게 된다.
- **상속 prop의 부모 대비 차분** — 위 사정거리 2를 푸는 별도 축이다(부모 computed와 비교). 이 문서 범위 밖이고, iframe에 부모 체인을 복제하는 방향은 기각한 Hoverify식 복사로 되돌아가는 길이라 특히 경계한다.
- **속성 의존 UA 룰** — `input[type=checkbox]` vs `[type=text]`, `a`의 `href` 유무, `li`의 `ol`/`ul` 조상은 UA 기본이 서로 다르지만 캐시 키는 `tagName` 단독으로 묶는다. **틀리는 방향이 "걸러내지 않고 실값으로 표시"** 라 오늘과 같은 동작이고 안전하다.
- **상태 pseudo(`:hover`)·pseudo-element 기준선** — `css-inspector-backlog.md` 소관.
- **Hoverify식 `innerHTML` 복사** — 베끼지 않는다. 비싸고, 페이지 콘텐츠를 우리가 만든 iframe에 복제하는 건 프라이버시 표면이 된다.
- **레이아웃 의존 prop의 기본값 판정** — 오늘과 동일하게 실값 취급한다.
- **디밍 색 대비 상향**(`text-muted-foreground/50` → `/70`) — 기존 문제이고 이 기능과 독립이라 별건으로 분리한다. 다만 아래 "접근성"의 저비용 2건은 스코프에 포함한다.
- **새 권한·env·의존성**. 없음.

## 프라이버시

캡처·수집·전송 동작이 늘지 않는다. 이 기능이 추가하는 유일한 외부 접촉면은 **페이지 DOM에 숨김 iframe 1개**이며, 그 iframe은 (a) `src`가 없어 네트워크 요청을 하지 않고 (b) 페이지 콘텐츠를 복사하지 않으며(`innerHTML` 미복사는 명시적 설계 결정) (c) picker 세션 종료 시 제거된다. `docs/privacy.{ko,en}.md` 대조는 tasks.md "가이드 영향" 절 참조.

## 왜 대체가 아니라 보강인가

UA 차분이 답하는 질문은 **"about:blank의 맨 `<tag>`와 값이 같은가"**다. `KNOWN_DEFAULTS`가 답하는 질문은 **"이 값이 이 prop의 명세상 초기값인가"**다. 둘은 다르고, 각자 못 잡는 게 있다.

| 케이스 | UA 차분 | KNOWN_DEFAULTS |
|---|---|---|
| `animation-name: none` (테이블 미등록, `INTERESTING_PROPS` 등록 가정) | ✅ 기준선도 `none` → 걸러짐 | ❌ 테이블에 없어 통과 |
| 테두리 없는 요소의 `border-top-color` | ❌ 기준선은 UA 글자색 `rgb(0,0,0)`, 페이지 요소는 `rgb(45,49,54)` → **다름 → 통과** | ❌ dead keyword (POSTMORTEM 2026-06-28) |
| 저자가 `body { font-size: 14px }`로 상속시킨 값 | ✅ 기준선 `16px`와 다름 → 실값 (정답) | ❌ 테이블에 없음 |
| 상속 prop인데 저자가 안 건드린 경우 (조상이 UA와 다른 값을 준 경우) | ⚠️ 다름 → 실값 (사정거리 2 — 여전히 펼쳐짐) | ⚠️ 테이블에 있으면 걸러짐 |
| 저자가 UA 기본값과 **같은 값**을 명시 (`margin: 0`) | ⚠️ 같아서 걸러짐 — `isSpecified` 가드가 먼저 막는다 | ⚠️ 동일 |

border-color 행이 결정적이다. **`isInactiveBorderColor`는 반드시 남아야 한다** — 그 판정은 "같은 side의 border-style/width가 비활성이면 색은 의미 없다"는 **cross-prop 종속**이고, 단일 값 비교로는 표현할 수 없다.

그래서 판정 순서는 `KNOWN_DEFAULTS → (isSpecified면 중단) → UA 차분 → isInactiveBorderColor`이고, **어느 하나라도 "기본값"이라 하면 기본값**이다.

## 사용자 시나리오

### S1. 테이블 등록을 잊어도 섹션이 항상 펼쳐지지 않는다

1. 개발자가 `SECTION_PROPS`와 `INTERESTING_PROPS`에 `animation` 섹션(`animation-name`·`animation-duration`·…)을 추가하고 **`KNOWN_DEFAULTS` 등록만 잊는다.** (`INTERESTING_PROPS` 등록은 전제다 — 그것도 빠뜨리면 값 자체가 안 실려 섹션은 반대로 항상 접힌다.)
2. **현재**: `getComputedStyle`이 `animation-name: none` 등을 항상 채우고 테이블엔 없어 → 어떤 요소를 골라도 Animation 섹션이 펼쳐진다.
3. **변경 후**: 기준선 `<div>`의 `animation-name`도 `none`이라 차분에서 걸러진다 → 애니메이션이 실제로 걸린 요소에서만 펼쳐진다.

### S2. 상속받은 저자 값은 실값으로 남는다

1. 페이지가 `body { font-size: 14px; color: #333 }`를 두고, 사용자가 그 안의 `<span>`을 선택한다.
2. 기준선 `<span>`은 `16px` / `rgb(0,0,0)`이다 → 차분에서 다름 → 실값으로 표시된다. (저자가 손댄 게 맞으므로 정답)
3. 단, 이 정답에는 대가가 있다 — 조상이 UA와 다른 값을 준 **모든** 상속 prop이 같은 경로로 실값이 되므로, Typography 섹션은 실사이트 대부분에서 계속 펼쳐진다(사정거리 2).

### S3. 기준선을 못 만드는 페이지

1. 어떤 이유로든 `iframe.contentDocument`가 `null`이다.
2. **UA 축만 빠지고** `KNOWN_DEFAULTS` + `isInactiveBorderColor` 2축으로 판정한다 — 오늘과 같은 결과. 사용자에게 오류 표시나 기능 저하 안내는 없다.
3. 대가를 인정한다: 같은 사용자가 A페이지에선 Layout이 접히고 B페이지(폴백)에선 펼쳐진다. **"접힘 = 여기 볼 게 없다"는 신호의 신뢰도가 페이지마다 달라진다.** 사용자가 조치할 수 없는 내부 실패라 알리지 않는 쪽을 택했다.

### S4. 접힌 섹션에서 값을 찾는다 (역방향)

1. 판정이 엄격해져 Layout 섹션이 접힌 채로 뜬다. 사용자는 `display`를 고치러 왔다.
2. 접힌 섹션은 자식이 **DOM에서 언마운트**되고(`Section.tsx`), "모두 펼치기"·prop 검색 UI가 없으며, Code 뷰는 specified + 편집 오버라이드만 담아 computed-only 값을 안 보여준다. 즉 **접힘은 정보 소실이다.**
3. 완화: 섹션 헤더에 **"기본값과 다른 prop 수" 배지**를 띄운다(G5). `(0)`이면 배지 없이 접고, `(3)`이면 접되 3을 보여준다 — 사용자는 열어볼지 판단할 근거를 얻는다.
4. 회복 비용은 섹션당 헤더 토글 클릭 1회다. 이 이상의 완화(모두 펼치기·검색)는 이 기능 범위 밖이다.

### 엣지 케이스

- **E1. 세션 종료 / 탭 이동** — `handleClear`에서 iframe을 제거한다. 남으면 페이지에 우리 DOM이 잔류한다.
- **E2. 캡처 중** — iframe은 `display:none`이라 `captureVisibleTab`·스크롤 캡처 스티칭에 안 찍힌다. 스크롤 캡처의 fixed/sticky 후보 추적에도 안 잡힌다(렌더 박스가 없음).
- **E3. 페이지의 MutationObserver** — 우리가 `documentElement`에 노드를 하나 붙이므로 페이지가 반응할 수 있다. overlay 호스트가 이미 같은 일을 하고 있어 새로운 위험 축은 아니다.
- **E4. 로그 레코더** — iframe이 `about:blank`이라 네트워크 요청이 없다. content script 주입 여부는 **미확인**이다(정적 `content_scripts`에 `match_about_blank`가 없어 주입 안 될 가능성이 높지만, `chrome.scripting.executeScript({allFrames:true})` 경로는 별개다). 실측해 확인하고, origin이 새는 것이 관측되면 origin 파생에서 제외한다 — design.md 위험 6.
- **E5. 알 수 없는 태그** — 커스텀 엘리먼트(`<my-widget>`)도 기준선 생성은 된다(UA는 unknown element를 `display:inline`으로 취급). 정상 동작.
- **E6. 1-depth iframe 내부 요소** — picker는 프레임마다 독립 인스턴스라 자식 프레임 요소를 선택하면 기준선 iframe이 **자식 문서 안에** 생긴다. 자식 문서의 UA 기본값을 재는 것이므로 이게 정답이고, 정리도 프레임별로 돌아야 한다.
- **E7. 편집 중 재판정** — `selectionUpdated`가 120ms 디바운스로 반복 발화하고 `Section`은 `defaultOpen` 변경 시 열림 상태를 강제 동기화한다. 사용자가 수동으로 편 섹션이 편집 도중 닫히면 안 된다.

## 성공 기준

1. `INTERESTING_PROPS`에 있고 `KNOWN_DEFAULTS`에 없는 비상속 prop(예: `animation-name`)에 대해, 그 prop이 `uaDefaultProps`에 실리면 `sectionActiveCount`가 그 prop을 세지 않는다 — 단위 테스트로 고정.
2. 기준선은 tagName당 1회만 계산된다 — 같은 태그의 요소를 5개 연속 선택했을 때 페이지의 `#__bugshot_ua_baseline__` 개수가 1이고 baseline 계산이 2회차부터 캐시 히트다.
3. `uaDefaultProps`가 `undefined`인 경로(스냅샷 복원·폴백)에서 **5개 콜사이트의 판정 결과가 변경 전과 동일**하다 — 단위 테스트로 고정하고 e2e로 섹션 펼침을 확인.
4. picker 세션 종료 후 top 문서와 자식 프레임 문서 **양쪽에** `#__bugshot_ua_baseline__`가 없다.
5. POSTMORTEM 2026-06-29 계열(테이블 미등록 prop) 증상이 회귀 테스트로 고정되고, 2026-06-28(유령 border-color)은 **UA 축이 못 잡고 `isInactiveBorderColor`가 잡는다**는 사실 자체가 테스트로 고정된다.
6. 접힌 섹션 헤더에 "기본값과 다른 prop 수"가 노출되고, 0이면 배지가 없다.
7. `pnpm test` + `pnpm typecheck` 통과, 기존 e2e green.
