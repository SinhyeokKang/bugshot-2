# Aside 실사이트 스모크 (MANUAL-SMOKE)

`e2e/COVERAGE.md`의 **수동 잔여** 중 "환경 제약으로 자동화 밖에 남은" 항목을 Aside 브라우저 에이전트로 훑는 시나리오 정의. 절차·금지는 `/manual-smoke` 스킬(`.claude/commands/manual-smoke.md`)이, **시나리오 내용·판정 기준·실행 이력은 이 문서가** 단일 출처다.

**게이트가 아니다.** 실사이트 의존이라 결정론이 없다. e2e 차단 게이트는 CI(`e2e-gate`) 단독이고, 이 문서의 항목이 빨개도 아무것도 막지 않는다. 대신 **e2e가 원리적으로 못 보는 축**(실 cross-origin CSS, 실 sticky 사이트, 실 광고 iframe, 픽셀·시각 판정)을 본다.

## 왜 e2e가 아닌가

수동 잔여의 사유는 네 갈래인데, 넷 다 "Playwright를 더 잘 써서" 해결되지 않는다.

| 사유 | 대표 항목 | Aside에서 풀리는 이유 |
|---|---|---|
| fixture 서버가 loopback → SSRF 가드가 보강 fetch 차단 | cross-origin 스타일 보강 양성 경로 (**자동 그물 0**) | 실제 공개 도메인을 연다 |
| `captureVisibleTab` quota flaky → 캡처 진입 spec 금지 | 스크롤 캡처 실경로, 컨텍스트 확장 나머지 축 | 게이트가 아니라 재시도·skip이 허용된다 |
| 픽셀·시각 판정 불가 | 다크모드 대비, 좁은 폭 truncate, 캡처 썸네일 정합 | 스크린샷을 **보고** 판정한다 |
| 실제 외부 호스트 필요 | webstore 차단 호스트 | 실제로 접속한다 |

## 승격 기준

지금 산출물이 `.md` 2개(이 문서 + 스킬)라 `e2e/` 안에 둔다. `playwright.config.ts`의 `testMatch`가 `**/*.spec.ts`라 `.md`는 스위트에 안 걸린다.

**파일이 3개를 넘거나 실행 스크립트(`.mjs`)가 생기면** `git mv`로 최상위 `smoke/`로 옮기고 `docs/DIRECTORY.md`·`CLAUDE.md`를 함께 갱신한다. `e2e/`는 `DIRECTORY.md`에 "Playwright e2e 스위트"로 정의돼 있어 비-Playwright 자산이 늘면 정의와 충돌하기 시작한다.

## 판정 어휘

| 결과 | 의미 |
|---|---|
| `PASS` | 판정 문장이 그대로 관측됐다 |
| `FAIL` | 판정 문장과 다른 것이 관측됐다. **제품 결함 후보** |
| `skip(사이트 변경)` | 전제 단언이 깨졌다. 사이트 개편이지 회귀가 아니다 |
| `skip(환경)` | quota·`tab.active` 등 실행 환경 실패. 1회 재시도 후에도 실패한 경우 |

**전제 단언이 이 문서의 핵심 장치다.** 사이트 개편 한 번이면 판정 대상이 통째로 사라지는데, 그때 "확장이 안 됐다"는 관측은 회귀와 구별되지 않는다(`GOTCHAS.md`의 "픽스처가 무너져도 spec은 '확장이 안 걸렸다'만 보고"와 같은 함정의 실사이트판). **전제가 깨지면 판정하지 말고 skip한다.**

---

## S1 — cross-origin 스타일 보강 (양성 경로)

**COVERAGE 매핑**: *"cross-origin 스타일 보강(양성 경로) — specified author 값 채움·source 셀렉터 라벨·`var()` 해석·부분 보강 fallback·cross-origin-only 토큰 swatch hint"*

> **최우선 항목.** 이것만 현재 자동 그물이 **0**이다. 나머지는 순수 함수 단위 테스트가 부분적으로라도 받친다(`ssrf-guard.test.ts`·`css-resolve.test.ts`·`capture-basis.test.ts`). e2e fixture는 loopback 전용이라 `isFetchableSheetUrl`이 보강 fetch를 차단해 `style-cross-origin-section.spec`이 **음성 경로만** 태운다.

**대상**: `naver.com` · `github.com` · `ui.shadcn.com`

**전제 단언** — 대상 요소의 스타일 출처가 실제 cross-origin이고 CSSOM 접근이 막혀야 한다. 아니면 `skip(사이트 변경)`.

```js
// 대상 탭에서
for (const sh of document.styleSheets) {
  if (!sh.href) continue;
  const cross = new URL(sh.href).origin !== location.origin;
  try { void sh.cssRules.length; } catch (e) { /* cross면 SecurityError */ }
}
// cross-origin이면서 SecurityError인 시트가 1개 이상일 것
```

**절차**: 요소 스타일 편집 진입 → 외부 CDN 시트로만 스타일이 오는 요소 클릭 → 편집 탭 값 확인 → CSS 탭 전환 → 값 입력창을 열어 토큰 목록 확인.

**판정 문장** — computed로는 만들 수 없는 표기가 떠야 한다. **표기가 바뀌는 축으로만 판정한다**(색 리터럴은 CSSOM이 `rgb()`로 정규화하고 computed가 곧 승자 값이라 보강 실패와 구별되지 않는다 — `GOTCHAS.md` "색으로는 캐스케이드를 검증할 수 없다"와 같은 이유).

- 편집 탭 length 필드에 `rem`·`%` 등 **author 원문 표기**가 뜬다. computed 폴백이면 `px`로 환산돼 보인다.
- `margin`처럼 `auto`가 낀 값이 `auto`로 뜬다(computed는 해석된 px를 준다).
- `color`가 `inherit`로 뜬다(computed는 항상 해석된 `rgb()`).
- CSS 탭에 승자 규칙 원문이 shorthand 형태로 보인다(`margin: 0 auto` 등).
- length 값 입력창의 `토큰 · length` 그룹에 cross-origin `:root` 정의 custom prop이 나타난다(`mergeCrossOriginTokens` 실경로).
- 보강이 부분 실패한 사이트에서도 에러 없이 computed 유지로 폴백한다.
- **3개 사이트 중 최소 1개에서 양성**. 0개면 판정 기준이나 사이트 선정이 잘못된 것이니 기준을 고친다.

**2026-08-16 실측 (naver.com)** — cross-origin 시트 2개(`ssl.pstatic.net`·`pm.pstatic.net`) 모두 `SecurityError`인 상태에서 `span.service_icon.type_stock` 선택 시 `font-size: 1.4rem`(computed 14.7px) · `line-height: 1.7rem` · `margin` 4면이 `0`/`auto`(computed 10px) · `color: inherit`가 떴고, CSS 뷰가 `margin: 0 auto`를 shorthand 원문으로 보여줬다. github.com에서는 `var(--h5-size,14px)`·`var(--fgColor-muted)`가 뜨고 토큰 드롭다운에 length 토큰 1300개 이상이 로드됐다.

---

## S2 — 페이지 전체(스크롤) 캡처 실사이트

**COVERAGE 매핑**: *"afterImage·캡처 썸네일 시각 정합"* + 캡 3종(20타일·32000px·4M px) 실경로

**대상**: `ko.wikipedia.org` 긴 문서 · `news.naver.com` 기사

**전제 단언** — 문서 높이가 뷰포트의 3배 이상이고 `position: fixed|sticky` 요소가 1개 이상 존재한다. 아니면 `skip(사이트 변경)`.

**절차**: 스크린샷 모드 → 하단 툴바 `페이지 캡처` → 진행률 관측(250ms 폴링) → 완료 후 미디어 이미지 추출 → 타일 경계 확대 검사.

**판정 문장**

- 진행률이 0%에서 단조 증가해 100%에 도달하고, 증가 폭이 `1/타일수`와 일치한다.
- 결과 이미지 크기가 캡 계산과 일치한다. `canvasLimit = floor(32000 / (vh × dpr))`, `count = min(needed, min(20, canvasLimit))`, 이후 `MAX_OUTPUT_PIXELS`(4M) 비율 축소.
- 캡에 걸리면 **"페이지가 길어 일부만 캡처했습니다" toast가 뜬다.** toast는 수 초 후 사라지므로 완료 직후 폴링해서 잡는다 — 놓치고 "안내가 없다"고 적으면 오판이다.
- **타일 경계에서 sticky/fixed 요소가 반복되지 않는다**(첫 타일에만 존재).
- 캡처 후 페이지 `scrollY`가 원래 값으로 복원된다.
- 캡처 중 `position`이 바뀐 요소의 인라인 `style` 잔여가 0이다.
- 캡처 실패(quota·`tab.active`)는 1회 재시도 후 `skip(환경)`.

**2026-08-16 실측 (ko.wikipedia.org/wiki/대한민국)** — 문서 38,643px / vh 900 / dpr 2에서 `canvasLimit = floor(32000/1800) = 17`이 20타일 캡보다 먼저 걸렸고, 진행률이 6%(≈1/17)씩 증가해 결과가 `614×6519`로 나왔다(2880×30600 → 4M px 축소, 계산과 일치). truncated toast도 관측됐다. **1.7.25에서 2회차를 돌렸을 때 결과 크기가 `614×6519`로 바이트 수준 일치**해 이 축은 결정론적이다. `scrollY`는 2500→2500으로 원복됐고(0이 아닌 값으로 검증해 공허하지 않다), sticky 2개의 인라인 `style`은 둘 다 `null`·문서 전체 `visibility:hidden` 잔여 0개였다.

> **sticky 반복은 현재 FAIL이다.** 좌측 목차·우측 도구 패널(`.vector-sticky-pinned-container`, `position: sticky`, `top: 24px`, 높이 454/476px)이 타일 경계마다 반복 출력됐다. `isRepeatedPositionedElement`의 `stuckTop` 조건 중 **`flowBottom <= scrollY + topInset`이 이 사이트에서 성립 불가**다 — `documentOffsetTop`이 주는 `flowTop`이 sticky 이동을 따라가서(scrollY 0→194, scrollY 1800→1823) `flowBottom = flowTop + height`가 항상 기준보다 height만큼 크다. `POSTMORTEM.md` 2026-07-23이 같은 함수의 회고이고, 그 조건은 "뷰포트보다 긴 sticky를 영구 누락시키는" 반대 실패를 막으려 넣은 것이라 **한쪽을 고치면 다른 쪽이 깨질 수 있다** — 회고의 음성 케이스(뷰포트보다 긴 top/bottom sticky)를 함께 들고 고쳐야 한다.

---

## S3 — element 캡처 컨텍스트 확장 (과확장·인접 개인정보)

**COVERAGE 매핑**: *"확장 이미지에 인접 개인정보가 불필요하게 포함되지 않는지와 `buildSelector` 동기 블로킹(선택당 최대 2회) 체감도 수동 전용"*

**대상**: `github.com` 이슈 목록(`li` 행 구조) · `bug-shot.com/ko` 카드

> **모드를 헷갈리지 마라.** 컨텍스트 확장(`captureContext`)은 **요소 스타일 편집**(`issue.mode.element`)의 before/after 캡처 경로 전용이다. 진입 화면의 `요소 캡처`(`issue.mode.elementShot`)는 **다른 모드**이고 확장을 타지 않아 bbox+패딩만 나온다 — 그걸로 판정하면 "확장이 안 된다"는 거짓 FAIL이 난다. 호출처는 `StyleEditorPanel.tsx`·`StyleChangesDialog.tsx`·`useBufferThenSwitch.ts` 셋뿐이다.

**전제 단언** — 대상 요소에 의미 단위 조상이 있고 확장 게이트 3개를 실제로 만족해야 한다. 불만족이면 `skip(사이트 변경)`.

```js
// 뷰포트 완전 포함 / 요소 포함 / 뷰포트 면적 40% 이하
const r = row.getBoundingClientRect();
const inViewport = r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
const ratio = (r.width * r.height) / (innerWidth * innerHeight);
// inViewport && ratio <= 0.4 && row.contains(target)
```

**절차**: 요소 스타일 편집 진입 → 행 안쪽 텍스트 요소 선택 → 값 하나 변경(예: `font-size`) → `변경사항 보기` → `확인` → `다음` → 초안의 `변경 전/후 스냅샷` 추출.

**판정 문장**

- 확장 범위가 의미 단위 컨테이너에서 멈추고 **형제 행까지 번지지 않는다**.
- 확장 이미지에 인접 사용자 데이터가 불필요하게 포함되지 않는다(육안 — privacy 코어 밸류 축).
- 요소 선택 시 selector 생성 동기 블로킹이 체감되지 않는다(대형 DOM에서 선택→에디터 표시까지 체감 지연을 기록).
- **before와 after의 촬영 조건이 같다** — 한쪽에만 hover 팝오버·툴팁이 찍히면 비교가 오염된다.

> **`form`·`fieldset` 제외은 이 시나리오의 항목이 아니다.** 초안에는 넣었다가 2026-08-16 실측으로 똄다. 제외는 `capture-context.ts`의 `CONTEXT_SELECTOR`에 둘을 **안 적어둔 방식**이라 사이트와 무관하게 상수고, `capture-context.test.tsx`가 이미 결정론적으로 덮는다("form 안 input이면 null"·"fieldset 안 input도 null"). 게다가 **실사이트엔 전제를 세우기도 어렵다** — 판별이 서려면 "form은 게이트를 만족하는데 form 외 후보가 없고 크기도 다른" 요소가 필요한데, 위키백과 전체를 훑어 **0건**이었다(form 안 요소가 전부 `li` 조상을 갖고, 그 `li`가 form과 같은 박스라 어느 쪽으로 확장되든 결과가 같다). 유닛이 덮는 상수를 전제도 못 세우는 곳에서 재판정하면 공허한 PASS만 나온다.

**2026-08-16 실측 (github.com/microsoft/vscode/issues)** — 이슈 행 `li`(1119×64, 뷰포트 5.5%)가 게이트 3개를 만족한 상태에서 그 안 `span`(370×19)을 선택하니 스냅샷이 `1104×106`(before) / `1104×129`(after)로 나왔다. 폭이 `li`에 근접하므로 **확장 자체는 동작**한다.

> **관찰 2건.** ① 상하 패딩 때문에 위쪽 필터바와 아래쪽 다음 이슈 행이 부분적으로 걸쳐 들어왔다. 공개 이슈라 문제는 아니었지만 사내 트래커였다면 인접 행 정보가 새는 구조다. ② **after 스냅샷에 GitHub 호버카드 팝오버가 통째로 찍혔다** — 요소를 클릭해 선택하면 마우스가 그 위에 남으므로 실사용에서도 재현될 조건이고, before는 깨끗해 두 컷의 비교 자체가 오염된다.

---

## S4 — picker 실사이트 정합 (광고 iframe 다수)

**COVERAGE 매핑**: *"iframe hover 하이라이트 시각 정합·blocker 핸드오프 경계 깜빡임·다수 iframe(광고) 성능 체감"*

**대상**: `news.naver.com`

**전제 단언** — 페이지의 iframe이 3개 이상이고 그중 렌더되는 것이 1개 이상이다. 아니면 `skip(사이트 변경)`.

**절차**: 요소 스타일 편집 진입 → 일반 콘텐츠 영역 hover → 광고 iframe 위 hover → iframe 클릭.

**판정 문장**

- 페이지에 `#__bugshot_picker_host`가 주입되고 shadow root에 `.hover-shield`·`.interaction-blocker`·`.picker-label`·`.banner`가 있다. **id다 — 태그명이 아니다.** `querySelector("__bugshot_picker_host")`는 실패한다.
- hover 라벨이 커서 아래 요소와 일치한다(엉뚱한 요소에 붙지 않음).
- 등록 iframe 경계를 넘나들 때 하이라이트 깜빡임이 사용 불가 수준이 아니다(육안).
- picking 중 인접 링크로 오네비게이션이 발생하지 않는다.
- **미등록 iframe(2-depth·srcdoc·sandbox) 클릭 시 안내 다이얼로그가 뜨고 idle로 복귀한다.**
- 프레임 수십 개에서 선택 반응이 체감상 멈추지 않는다(진입 소요를 기록).

**2026-08-16 실측 (news.naver.com)** — iframe 9개(렌더 3개) 환경에서 picker 진입 1,542ms, 일반 요소 hover 라벨 `div.comp_news_feed.comp_news_none 344 × 227`, 광고 iframe(300×250) hover 시 iframe 요소 자체를 잡고, 클릭하니 `이 iframe은 선택할 수 없습니다` 안내 후 idle 복귀. 전부 PASS.

---

## S5 — 미지원 URL (webstore 차단 호스트)

**COVERAGE 매핑**: *"picker unsupported URL 중 webstore 차단 호스트 — 실제 webstore 접근이 필요해 fixture 서버로 재현 불가"*

**대상**: `chromewebstore.google.com/detail/...`

> **가장 싼 시나리오다.** 사이트 하나 열고 스냅샷 한 번이면 끝나므로 **배선 검증용으로 항상 먼저 돌린다** — 전제 확인·reload·`?tabId=` 바인딩·탭 정리가 여기서 전부 검증된다. 이게 안 되면 S1~S4를 돌려봐야 같은 지점에서 죽는다.

**전제 단언** — 대상 URL이 `isSupportedUrl()` 기준 미지원이어야 한다(`chromewebstore.google.com` 전체 + `chrome.google.com/webstore/*`). 웹스토어 도메인이 바뀌면 `skip(사이트 변경)`.

**판정 문장**

- 캡처 진입 화면이 `app.captureUnsupported.*` 안내로 바뀌고 **캡처 버튼 5개가 부재**하다.
- `이슈 작성` 버튼이 자리를 유지한 채 비활성이다(`aria-disabled`).
- 콘솔·네트워크 서브탭이 잠긴다(`disabled`).
- **연동·설정·이슈 목록 탭은 완전히 동작한다** — 미지원은 패널이 무엇을 그리는지만 결정하고 패널 표시 여부는 activation을 따른다.
- 같은 탭을 지원 URL로 보내면 **조작 없이** 캡처 진입 화면이 복구된다.
- 시나리오 종료 시 열었던 탭이 전부 닫힌다.

**2026-08-16 실측** — 캡처 화면이 `이 페이지에서는 캡처할 수 없습니다 / 브라우저가 확장 프로그램 접근을 막아 둔 화면입니다…`로 바뀌고 캡처 버튼 5개 부재, `이슈 작성` disabled, 콘솔·네트워크 서브탭 disabled, 연동 탭은 5개 연동이 프로젝트·라벨 콤보박스까지 정상 렌더. **자동 복구도 PASS**(1.7.25) — 패널을 전혀 건드리지 않고 `chrome.tabs.update`로 대상 탭만 지원 URL로 보냈는데, 콘솔·네트워크 서브탭 잠금이 풀리고 캐프처 버튼 5개가 돌아오며 `이슈 작성`이 다시 활성화됐다.

---

## S6 — 시각 회귀 스윕 (light/dark × 320·376·480px)

**COVERAGE 매핑**: *"`integrations-cta` 배너의 시각 접합·트렁케이션"* 5항목 + *"action 로그 필터 탭 376px 가로 오버플로"*

**대상**: S1~S4 중 아무 사이트 1개 고정(패널만 보므로 대상 페이지는 배경일 뿐)

**전제 단언** — `window.innerWidth`가 override 지정값과 같아야 한다. 다르면 override가 풀린 것이니 재적용한다(최대 4회).

**절차**: 폭 3종 × 테마 2종 = **6조합**. 각 조합에서 연동 탭·로그 탭·idle 화면을 찍는다.

**함정 3개** — 전부 실측으로 확인된 것이다.

1. **폭은 CDP로만 걸린다.** Aside `page`에는 `setViewportSize`가 없다(`TypeError`). `page._sendToTarget("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile: false })`.
2. **override는 네비게이션·reload에 조용히 풀린다.** 찍기 직전 `innerWidth`를 검증하고, 다르면 `clearDeviceMetricsOverride` 후 재적용한다. 풀린 채 찍으면 넓은 레이아웃의 왼쪽 일부만 잘려 나오는데 **에러가 아니라 "그럴듯하게 이상한" 결과**라 눈으로만 걸린다.
3. **다크는 앱 테마를 바꿔서 만든다.** `Emulation.setEmulatedMedia`는 `matchMedia`엔 걸리지만 `.dark` 클래스가 안 붙는다 — `settings-ui-store`의 기본 `theme`가 `"system"`이 아니라 `"light"`라 `useThemeEffect`가 media 변화를 아예 구독하지 않는다. **`chrome.storage.local` 직접 seed도 안 통한다**(살아있는 패널이 zustand persist로 메모리 state를 다시 쓴다). 설정 > 일반 > 테마 Select를 조작한다.

**판정 문장**

- `integrations-cta` 배너: 320px ko 문구가 truncate돼도 우측 아이콘 + `플랫폼 추가`가 살아있다.
- 다크모드 대비가 WCAG AA를 만족한다(육안 + 필요 시 computed 색 추출).
- **로그 필터 탭이 가로로 잘리지 않는다.** 잘림은 **폭 × 필터 개수**의 함수라 둘을 함께 적는다 — 로그 구성에 따라 필터 종류가 변하므로 "376px PASS"만 적으면 다음 세션이 다른 조건에서 측정해 판정이 뒤집힌다.
- idle 1×2×2 레이아웃의 3행 정렬·녹화/리플레이 균등 너비가 좁은 폭에서 깨지지 않는다.
- 스크린샷에 **override와 같은 `clip`** 을 준다(안 주면 좁은 렌더가 창 폭만큼 가로로 반복돼 찍힌다).
- **6조합 전부 찍는다** — 조합 누락이 가장 흔한 실수다.

> **자동 오버플로 검사만 믿지 마라.** `scrollWidth > clientWidth`를 `overflowX: visible|clip`인 요소에서만 세면 **`overflow-x: auto`인 컨테이너가 통째로 빠진다** — 스크롤이 되니 오버플로로 안 잡히지만 사용자에겐 잘려 보인다. 2026-08-16 실측에서 이 검사가 `count: 0`을 돌려준 화면이 육안으론 명백히 잘려 있었다. **육안이 이 항목의 본체다.**

**2026-08-16 실측** — 다크 × 연동 탭 320/376/480 전부 오버플로 0, 워크스페이스 URL·이메일 truncate 정상, 380px 이하에서 앱 탭바가 아이콘만 남는 전환도 의도대로.

**로그 필터 탭 잘림은 320px에서 ko·en 공통으로 재현된다.**

| 로케일 | 폭 | 필터 | 결과 |
|---|---|---|---|
| ko | 320px | `전체`/`JSON`/`기타` (로그 16건) | **잘림** — `기타` 사라지고 `JSON` 절반 |
| ko | 480px | 같음 | 정상 |
| en | 320px | `All`/`JSON` (로그 2건) | **잘림** — `JSON` 절반 + 가로 스크롤바 노출 |
| en | 376px | 같음 | 정상 |

COVERAGE는 이 축을 *"en에서만 발생"*으로 적지만 **로케일이 아니라 폭이 지배변수**다 — en은 필터가 2개뿐인데도 320px에서 잘렸다. 다만 **en·376px·액션 필터 6종**(COVERAGE 원문의 조건)은 여전히 미검증이다 — 액션 로그는 idle에 전용 서브탭이 없어 캐프처→drafting→로그 다이얼로그를 거쳐야 하고, 그 전에 6종 액션을 생성해둔야 한다.

---

## 대상 사이트

| 시나리오 | 사이트 | 왜 이 사이트인가 |
|---|---|---|
| S1 | `naver.com` | CDN(`pstatic.net`)이 별도 origin이고 `rem`·`auto`·`inherit`가 섞여 표기 축 판정이 선다 |
| S1 | `github.com` | 디자인 토큰 그래프가 커서 cross-origin custom prop 병합 경로를 크게 태운다 |
| S1 | `ui.shadcn.com` | 부분 보강·폴백 경로 대조군 |
| S2 | `ko.wikipedia.org` 긴 문서 | 문서가 뷰포트 40배 이상이라 캡 3종이 전부 걸리고, sticky 사이드바가 2개 있다 |
| S2 | `news.naver.com` 기사 | 광고·지연 로드가 섞인 실전 스티칭 |
| S3 | `github.com` 이슈 목록 | `li` 행이 게이트 3개를 자연스럽게 만족하고, 인접 행에 사용자 데이터(작성자)가 있다 |
| S3 | `bug-shot.com/ko` | 카드 레이아웃 대조군. 자사 사이트라 개편 시점을 안다 |
| S4 | `news.naver.com` | 광고 iframe이 상시 여럿이고 srcdoc·cross-origin이 섞인다 |
| S5 | `chromewebstore.google.com` | Chrome이 content script 주입을 차단하는 실제 호스트 |
| S6 | S1~S4 중 1개 | 패널만 보므로 대상은 배경. 고정해야 조합 간 비교가 선다 |

**사이트가 바뀌면 이 표만 고친다.** 스킬 본문에는 사이트를 박지 않는다 — 사이트는 절차보다 훨씬 자주 바뀌는데, 스킬을 고치면 `pnpm sync:agents`로 미러를 재생성해야 한다.

---

## 최근 실행 이력

| 날짜 | 버전 | 커밋 | S1 | S2 | S3 | S4 | S5 | S6 | 비고 |
|---|---|---|---|---|---|---|---|---|---|
| 2026-08-16 | 1.7.24 | 재작성됨 — `f456445d`에 포함 | PASS | **FAIL** | 부분 | PASS | PASS | **FAIL** | 스킬 작성 **전** 예비 실행이라 이 문서의 절차를 따른 것이 아니다. S2=위키 sticky 사이드바 타일 반복(`isRepeatedPositionedElement` 조건 4 성립 불가) / S6=ko·320px 네트워크 필터 탭 잘림 / S3=확장은 동작하나 after에 호버카드 유입. ⚠️ **관측 대상 dist가 stale이었다**(1.7.24 빌드, 17:42) — 그 뒤 `f456445d`가 `IssueTab.tsx`·`issue.ts`를 바꿔(진행률 a11y) **S2 진행률·S6 idle 축은 최신 빌드에서 재확인이 필요**하고, 결함 3건은 해당 모듈(`content/scroll-capture.ts`·`NetworkLogContent.tsx`)이 그 커밋에서 안 바뀜어 유효로 본다. S5 자동복구·S2 scrollY 원복·S3 `form` 제외·S6 en 376px은 미검증 |
| 2026-08-16 | 1.7.25 | `63521601` | — | **FAIL** | — | — | PASS | **FAIL** | 스킬 절차대로 돌린 첫 실행(미검증 항목 보충 + 2회차 결정론 확인). **판정이 뒤집힌 항목 0개** — S2 sticky 반복과 S6 필터 잘림은 새 빌드에서도 동일하고 S2 결과는 `614×6519`로 바이트 일치. 보충 결과: S5 자동복구 PASS / S2 `scrollY` 2500 원복·인라인 `style` 잔여 0 PASS / S6 필터 잘림이 **en·320px에서도 재현**(로케일이 아니라 폭이 지배변수) / S3 `form` 제외은 **항목에서 제거**(유닛이 덮는 상수이고 실사이트에 전제가 0건). 미검증 잔여: S6 en·376px·액션 필터 6종 |
