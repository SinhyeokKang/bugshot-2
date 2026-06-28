# 회고 (Postmortems)

회귀·버그를 잡아 고칠 때마다 "왜 틀렸나 → 다음에 어떻게 막나"를 한 항목으로 남긴다. e2e 8회 루프 같은 자동 복구는 **그 자리에서** 문제를 메우지만, 같은 함정을 다음에 또 밟지 않으려면 사후분석이 코드 옆에 남아 있어야 한다. git에 커밋되는 이 파일이 그 정본이다.

작성은 `/postmortem` 스킬이 직전 픽스 컨텍스트로 자동 추가한다. 손으로 쓸 때도 아래 형식을 따른다.

## 작성 형식

각 항목은 최신순(위가 최신)으로 추가한다.

```
## YYYY-MM-DD — <한 줄 제목>

- **증상**: 사용자가 관측한 잘못된 동작.
- **근본 원인**: 코드상의 진짜 원인(표면 증상 말고).
- **재발 방지**: 다음에 같은 류를 막는 구체적 체크(grep 패턴·전수 대상·테스트).
- **관련**: 손댄 파일·핵심 함수.
```

자명한 것(git diff만 봐도 아는 것)은 빼고, **코드만 읽어선 안 보이는 구조적 함정·재발 패턴**만 남긴다.

---

## 2026-06-28 — 내보낸 로그 뷰어 라벨이 i18n 키 raw 노출 + 검색 placeholder stale (복제 dict 미동기화)

- **증상**: 다운로드한 `logs.html`(로그 뷰어)에서 액션 로그 필터가 번역 대신 `actionLog.filter.keypress`처럼 **키 문자열 그대로** 노출. 네트워크 탭 검색 placeholder도 "URL 검색…"이라 본문(body)까지 검색되는 걸 안내 못 함.
- **근본 원인**: log-viewer는 사이드패널과 **별도 standalone 번들**(`dist-log-viewer`, 빌드 시 사이드패널에 inline)이라 메인 React i18n 시스템을 import 못 하고 `src/log-viewer/i18n.ts`에 ko/en dict를 **수작업 복제**한다. 메인 테이블(`src/i18n/namespaces/logs.ts`)에 키가 추가(`actionLog.filter.keypress/toggle/select`)되거나 문구가 갱신(`networkLog.search`에 "·본문" 추가)될 때 복제본이 안 따라온 게 근본. 두 실패 모드가 다른 얼굴을 한다: (1) **누락** = 복제 dict에 키 자체가 없어 `t()`가 키 문자열로 폴백 → raw 노출. (2) **drift** = 키는 있는데 값이 옛 문구 → 조용히 stale. 기존 log-viewer 테스트의 ko/en 대칭 검사는 **양쪽 dict에 동시에 빠지면** 대칭이 유지돼 누락을 못 걸렀다(대칭 ≠ 완전성).
- **재발 방지**: (1) **복제 dict의 회귀는 ko/en 대칭으론 안 잡힌다 — 메인 테이블을 source of truth로 대조**해야 한다. 추가한 두 검사(`log-viewer/__tests__/i18n.test.ts`): 코드가 `t("리터럴")`로 참조하는 키 전부가 dict에 존재(누락 차단) + 메인과 공통 키는 값도 일치(drift 차단). (2) **메인 i18n 키·문구를 바꾸면 log-viewer dict도 본다** — `grep -nE '"(actionLog|networkLog|consoleLog|debug)\.' src/log-viewer/i18n.ts`로 복제 범위 확인. (3) **이미 내보낸 `logs.html`은 빌드 시점 i18n이 박혀 소급 수정 안 됨** — `pnpm build:log-viewer` 후 재내보내기 필요(고쳐도 옛 파일은 그대로). (4) 같은 "standalone 번들이 메인 모듈을 복제" 함정 류: recorder pre-arm 청크(외부 static import 0 제약, `content/log-throttle.ts` vs `sidepanel/lib/trailing-throttle.ts` 복제)도 동일 구조 — **복제본은 늘 대조 테스트로 묶는다.**
- **관련**: `src/log-viewer/i18n.ts`(복제 dict — `koDict`/`enDict`), 정본 `src/i18n/namespaces/logs.ts:logs`, 회귀 검사 `src/log-viewer/__tests__/i18n.test.ts`(`referencedKeys` 코드 스캔 + 메인 테이블 drift 대조).

---

## 2026-06-28 — 사이드패널 탭 녹화가 cross-origin 이동 후 권한 에러 (activeTab은 패널에선 재취득 불가)

- **증상**: A origin에서 사이드패널을 연 뒤 B origin으로 이동하고 탭 녹화를 누르면 `getMediaStreamId`가 "extension has not been invoked"로 거부됐다. `host_permissions: <all_urls>`를 required로 갖고 있는데도 막혀서 "광역 권한 있는데 왜?"
- **근본 원인**: 두 겹의 비자명 함정. (1) **`<all_urls>`는 `tabCapture`를 커버하지 못한다** — `captureVisibleTab`은 `<all_urls> OR activeTab`이라 30s Replay가 광역 권한으로 우회됐지만, `tabCapture.getMediaStreamId`는 host permission으로 대체 불가하고 **"현재 페이지에서 확장이 invoke됨"(activeTab) 상태가 필수**다(Chrome이 `<all_urls`로 tabCapture 허용하는 옵션을 의도적으로 거부). (2) **사이드패널 열기는 activeTab을 부여하지 않는다** — Chrome 공식 입장("패널 열기는 충분한 user intent가 아님", 변경 계획 없음). 그래서 패널을 연 invoke(아이콘 클릭/단축키)의 activeTab은 그 origin에만 유효하고, cross-origin 이동 시 회수된다. 패널 내부 버튼 클릭은 invoke가 아니라 activeTab을 새로 주지 못한다. Jam이 같은 증상을 안 겪는 건 **popup 기반**이라 매 녹화가 아이콘 클릭(=invoke)에서 시작해 현재 탭에 activeTab을 fresh하게 받기 때문 — 아키텍처 차이지 우회 트릭이 아니다.
- **재발 방지**: (1) **`chrome.permissions.request(['activeTab'])`로 activeTab을 "재취득"하려는 시도는 무효다** — activeTab은 optional permission처럼 request로 부여되지 않고 오직 사용자 invoke(action click·command 단축키·contextMenu)로만 생긴다. Jam popup이 이걸 부르는 건 popup이 이미 아이콘클릭 activeTab을 가진 상태의 보강일 뿐, 사이드패널에선 효과 없다(첫 패치가 이걸로 실패함). (2) **사이드패널에서 tabCapture가 막히면 정공법은 getDisplayMedia 폴백** — 단 user activation 보존이 관건이다. 스트림 획득(`getMediaStreamId`)을 핸들러의 **첫 await**로 빼야, 실패 시점에 activation이 살아있어 곧장 getDisplayMedia picker를 띄울 수 있다. `getMediaStreamId`는 미디어 캡처 API가 아니라 실패해도 activation을 소비하지 않는다. (3) **스트림 획득과 recorder 시작을 분리**(`startTabStream`/`beginTabRecording`)해 그 사이에 `prepareRecorders`(로그 레코더 준비)를 끼운다 — 붙여두면 폴백 위해 분리할 때 streamId 만료(수초) 위험. 로그가 녹화 시작 시점부터 잡히도록 recorder.start는 prepareRecorders 뒤. (4) 새 캡처 진입점을 추가할 때 `grep -rn 'getMediaStreamId\|getDisplayMedia\|captureVisibleTab' src`로 권한 모델(activeTab 요구 vs 광역 허용)을 분기별로 확인 — 셋이 권한 요구가 다 다르다.
- **관련**: `src/sidepanel/video-capture.ts:startVideoCapture`(첫 await로 스트림 시험 + 실패 시 `startScreenCapture(tabId,{preferTab:true})` 자동 폴백), `startScreenCapture`(폴백은 `displaySurface:"browser"`로 탭 우선, 일반은 `"monitor"`), `src/sidepanel/video-recorder.ts:startTabStream`/`beginTabRecording`(스트림 획득/recorder 시작 분리). 판정은 `isTabCaptureUnavailable`(video-capture.ts) / `isActiveTabPermissionError`(capture-error.ts).

---

## 2026-06-28 — 하드코딩 색(placeholder)·입력중·diff에서 색 swatch 누락 (value 분기만 칠함)

- **증상**: 요소 색이 `#444444`처럼 하드코딩이면 스타일 편집기 필드에 색 미리보기 사각형(swatch)이 안 떴다. 같은 hex를 사용자가 combobox로 직접 입력하면 swatch가 떴다. "prefill인데 왜 색 칩만 없나?"
- **근본 원인**: swatch가 **렌더 분기마다 따로 인라인**돼 있고 각 분기가 독립적으로 swatch 여부를 결정했다. `ValueCombobox`는 `value`(사용자 입력 = `inlineStyle[prop]`) 분기에만 swatch를 그렸고, 페이지 하드코딩 색은 `value`가 아니라 `placeholder`(`specifiedStyles`/`computedStyles`)로 들어온다. placeholder 분기는 토큰 참조(`var(...)`)만 칠하고 일반 색 리터럴은 텍스트만 표시 → 누락. 같은 누락이 manual-input 드롭다운 항목·diff 비교 뷰(`DiffValue`)에도 독립적으로 존재했다. "색이 있으면 swatch"라는 불변식이 한 곳이 아니라 **N개 렌더 분기에 흩어져** 있어, 한 분기(value)만 충족하고 나머지는 조용히 빠진 게 핵심.
- **재발 방지**: (1) **swatch는 분기마다 인라인하지 말고 단일 컴포넌트(`ColorSwatch`)를 거치게** 한다 — 색 표시 지점이 늘 때 swatch를 빠뜨릴 구조적 여지를 없앤다. 색을 텍스트로 그리는 새 지점을 추가하면 `isRenderableColorLiteral(v)`면 `ColorSwatch`도 같이. (2) **전수 점검 grep**: `grep -rn 'backgroundColor\|isRenderableColorLiteral\|ColorSwatch' src/sidepanel`로 색 렌더 지점을 모아 swatch 동반 여부 확인 — value/placeholder/manual-input/diff처럼 분기가 갈리면 각각 본다. (3) swatch 스타일도 분기·content script마다 제각각이었다(필드 10px/12px·radius 4px vs picker 툴팁 12px/3px) — `ColorSwatch`로 필드를 picker `.pl-swatch`에 통일. content script(`overlay.ts`)는 raw HTML이라 컴포넌트 공유 불가, 시각만 맞춤(리팩터 시 양쪽 동기 주의). (4) `isRenderableColorLiteral=false`(`currentColor`·`inherit`·`calc()`)는 미리보기 불가라 의도적 텍스트-only — computed는 이미 `rgb()`로 resolve돼 통과.
- **관련**: `src/sidepanel/components/ColorSwatch.tsx`(신규 — 공용 swatch, picker `.pl-swatch` 스타일 정본), `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx`(placeholder·manual-input 분기 swatch 추가), `src/sidepanel/tabs/styleEditor/TokenChip.tsx`(`TokenChip`·`TokenItem` swatch 교체), `src/sidepanel/components/StyleChangesTable.tsx:DiffValue`(diff 색값 swatch), 판정은 `colorLiteral.ts:isRenderableColorLiteral`. 같은 element 색 resolve 가족 버그는 아래 항목들 참조.

---

## 2026-06-28 — 테두리 없는 요소에 유령 border-color(글자색)가 실제 값처럼 노출

- **증상**: `course-chatbot-nine.vercel.app`의 form(`.welcome-form form`)은 DevTools Styles에 border/border-color 선언이 **전혀 없는데** BugShot 스타일 편집기가 `rgb(45, 49, 54)`를 border-color로 뿌렸다(= 그 요소의 글자색). border 섹션도 자동으로 펼쳐졌다. "DevTools엔 없는 색이 왜 뜨나?"
- **근본 원인**: 증상(border-color 값)과 원인(다른 레이어)이 어긋났다. `getComputedStyle`은 테두리가 없어도(`border-style:none`/`border-width:0`) `border-{side}-color`를 **항상 `currentColor`의 resolve값**(= `color`, 여기선 `rgb(45,49,54)`)으로 돌려준다. `propMetadata.ts`의 `KNOWN_DEFAULTS`엔 `"border-*-color": ["rgb(0, 0, 0)", "currentcolor"]`로 기본값을 박아뒀지만 **`"currentcolor"` 엔트리는 dead** — `getComputedStyle`은 그 키워드를 절대 리터럴로 안 돌려주고 이미 concrete rgb로 해석해 준다. 그래서 `isKnownDefault`가 매칭에 실패 → 유령색이 non-default로 판정 → `sectionDefaultOpen`이 섹션을 펼치고 `ValueCombobox`가 값을 실값처럼 표시. **border-color는 단독으로 의미가 없고 같은 side의 style/width에 종속**인데 그 cross-prop 가드가 없었던 게 핵심.
- **재발 방지**: (1) **dead keyword default 패턴** — `KNOWN_DEFAULTS`에 `currentcolor`/`auto`/`medium`처럼 *getComputedStyle이 concrete로 resolve해 버리는 키워드*를 적는 건 무효다. `getComputedStyle`이 그 키워드를 그대로 돌려주는지 콘솔로 먼저 확인하고 박을 것. 같은 함정이 `width/height: ["auto"]`에도 잠재(이번엔 실해 없어 미수정 — `auto`→used px라 Size 섹션이 늘 펼쳐지지만 진짜 크기라 무해). (2) **cross-prop 종속 값** — 한 prop의 의미가 다른 prop에 묶이면(border-color↔style/width) 단일 `isKnownDefault(prop, value)`로는 못 거른다. computedStyles 전체를 받는 가드(`isInactiveBorderColor`)가 필요. 비활성 = `style===none OR width===0px`(가시 조건 `style!=none AND width>0`의 드모르간). (3) 같은 판정을 쓰는 **3곳을 동시에** 맞춰야 한다 — `grep -rn 'isInactiveBorderColor\|isKnownDefault' src/sidepanel`로 `sectionDefaultOpen`(섹션 펼침)·`ValueCombobox`(값 디밍) 누락 점검. author가 명시한 값은 가드를 우회해야(`specifiedStyles` 존중) 두 경로가 일관. 순수 함수는 `propMetadata.test.ts`·`sectionDefaultOpen.test.ts`로 고정.
- **관련**: `src/sidepanel/tabs/styleEditor/propMetadata.ts:isInactiveBorderColor`(신규 — cross-prop 가드), `src/sidepanel/lib/sectionDefaultOpen.ts`(섹션 펼침 가드), `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx`(`isDefault` 디밍 + specified 우회). 색 resolve의 같은 cross-origin 가족 버그는 아래 06-28 항목들 참조.

---

## 2026-06-28 — cross-origin 전용 custom prop 토큰은 이름만 뜨고 swatch/hex hint 누락

- **증상**: naver(`#account > div > a`)에서 `--color-primary-background-default` 같은 변수가 스타일 편집기에 **이름은 잘 뜨는데** 옆의 색 swatch·hex 미리보기가 안 떴다. 값(`var(--…)`)도 정상 표시. "이름은 찾았는데 왜 색 칩만 없나?"
- **근본 원인**: **변수 이름과 swatch가 서로 다른 데이터 경로**에서 나온다. 이름은 속성 값 문자열을 `extractTokenRefs`가 정규식으로 뽑아 항상 표시되지만, swatch는 `findTokenValue(tokens, name)`로 store `tokens` 배열에서 그 변수를 찾아야 칠해진다. 그 배열을 만드는 `collectTokens`(`css-resolve.ts`)는 same-origin `cssRules`(cross-origin이면 `sheet.cssRules`가 throw→`catch{}`로 skip)와 inline만 모아서, cross-origin 시트에 정의된 변수는 `tokens`에 안 들어가 `findTokenValue`가 undefined → swatch 누락. 값 경로(`mergeCrossOriginDecls`)는 이미 cross-origin 보강을 소비하는데 토큰 수집 경로만 비대칭으로 빠져 있었다(2026-06-28 위 항목·06-27 항목과 **같은 "same-origin/cross-origin 경로 비대칭" 가족**).
- **1차 fix가 불충분했던 이유 (핵심 교훈)**: 처음엔 `collectTokens`가 `getCrossOriginCustomProps()`를 merge하도록 고쳤다(변수 **정의** 수집). 그런데 그게 잡는 건 cross-origin **`:root`/`html`/`*` 전역 셀렉터** 정의뿐(`GLOBAL_CUSTOM_PROP_SELECTORS` 필터). naver는 토큰을 **스코프 셀렉터**(테마 클래스/`[data-theme]`)에 정의해서 그 필터를 빠져나가 여전히 누락. **정의 수집은 fetch 성공 + 전역 스코프 두 전제에 의존**한다. 진짜 해법은 정의가 아니라 **참조**를 모으는 것: 요소의 specified 값에 남아있는 `var(--x)` 참조 이름만 `seen`에 넣고(`collectReferencedTokenNames`), 값은 `getComputedStyle(el).getPropertyValue('--x')`가 채우게 한다 — `getComputedStyle`은 **출처·스코프·fetch 여부 무관**하게 적용된 custom prop을 concrete 값으로 해석(콘솔에서 `--color-primary-background-default` → `#03A94D` 확인). 즉 cross-origin enrichment 자체에 매달리지 말고, **브라우저가 이미 해석해 둔 computed 값을 쓰라**.
- **재발 방지**: (1) cross-origin custom prop을 다룰 땐 **"정의를 어디서 읽나"가 아니라 "computed로 이미 해석되나"**를 먼저 본다 — `getComputedStyle(el).getPropertyValue('--x')`가 값을 주면 정의 출처/스코프를 추적할 필요가 없다. 정의 수집(`getCrossOriginCustomProps`)은 전역 스코프 + fetch 성공에만 동작하는 **부분해**임을 기억(드롭다운 보조용으로는 유지). (2) cross-origin author 스타일 소비 경로가 여럿(값 resolve=`mergeCrossOriginDecls`, 토큰 수집=`collectTokens`, 역참조=`buildTokenLookup`)이라 한 곳만 고치면 조용히 빠진다 — `grep -n 'getCrossOriginCustomProps\|getMatchingCrossOriginRules' src/content/css-resolve.ts`로 점검. (3) 순수 헬퍼는 `css-resolve.test.ts > collectReferencedTokenNames`·`mergeCrossOriginTokens`로 고정. loopback e2e는 SSRF 가드로 보강 fetch가 막혀 inert지만 **참조 수집 경로는 fetch 무관**이라 same-origin var 페이지로는 e2e 가능(추후). 양성 검증은 공개 CDN·naver 수동.
- **관련**: `src/content/css-resolve.ts:collectReferencedTokenNames`(신규 — 참조 var 이름 수집, 실해법), `collectTokens`(specified 값에서 참조 수집 + `mergeCrossOriginTokens` 전역 정의 보조), `mergeCrossOriginTokens`(1차 부분해 — 전역 정의 gap-fill), `src/content/picker.ts`(`picker.collectTokens`에 `ensureCrossOriginLoaded()` await — specified에 cross-origin 룰이 잡히게), `src/content/__tests__/css-resolve.test.ts`. swatch 렌더는 `ValueCombobox.tsx`의 `findTokenValue`. 같은 element의 다른 레이어는 아래 항목들 참조.

---

## 2026-06-28 — cross-origin author 스타일에서 var() 토큰이 일부 prop만 computed로 강등

- **증상**: naver 로그인 버튼(`#account > div > a`)에서 `background-color`는 토큰(`var(--…)`)으로 잡히는데 `color`·`border-color`는 computed 리터럴로 표시. DevTools Styles엔 셋 다 `var()` 존재. "왜 일부 prop만 토큰?"
- **근본 원인**: `mergeCrossOriginDecls`(`css-resolve.ts`)가 cross-origin 매칭 룰을 seq 오름차순 **무조건 last-wins**로 병합했다. same-origin 경로(`collectRulesForElement`의 decl 루프)엔 있던 var 보존 가드(`out[name]?.includes("var(") && !val.includes("var(")` → skip)가 cross-origin 병합엔 빠져 있었다(8c949b4가 shorthand-claim 가드만 추가하며 누락). `<a>`처럼 한 prop이 여러 룰에서 재선언되면(테마 `color: var(--fg)` → 일반 `a { color:#333 }` 리셋) 이른 토큰을 나중 리터럴이 덮어 강등. `background-color`는 `<a>`에 단일 선언이라 안 덮여서 토큰 유지 → "일부 prop만 토큰" 비대칭. `styleHooks`의 `placeholder = specified || computed`라 specified가 비어서가 아니라 **리터럴로 채워져** computed처럼 보였다(빈 폴백 아님 — 강등).
- **두 번째 메커니즘 (같은 증상, 다른 원인)**: border는 naver가 `border: 1px solid var(--color-neutral-stroke-subtle-2)` **shorthand**로 선언. `border`는 width|style|color 혼합이라 `SHORTHAND_MAP`(동질 longhand 리스트/TRBL split 전제)에 없어 `expandShorthands`가 border-*-color로 전개하지 못했다 → color 토큰이 specified에 안 잡혀 computed로 폴백. 토큰 클로버(첫 메커니즘)와 별개로, **shorthand 미전개**가 원인. `parseBorderShorthand`(토큰을 width/style/color로 분류, 모호한 var는 color로)로 분해해 `border`/`border-{side}`를 변별 longhand에 fill-if-absent 전개.
- **재발 방지**: (1) specified 수집의 same-origin·cross-origin 두 경로는 **동일 시맨틱**(var 보존·shorthand claim)이어야 한다 — 가드를 한쪽에만 넣지 말 것. `grep -n 'includes("var(")' src/content/css-resolve.ts`로 대칭 점검. (2) 새 CSS shorthand를 패널에 노출할 땐 `SHORTHAND_MAP`/`TRBL_SHORTHANDS`/`BORDER_SHORTHAND_SIDES` 전개 경로에 등록됐는지 확인 — 등록 안 된 shorthand는 longhand가 통째로 빈다(border가 그 사각지대였다). 한 prop이 여러 규칙에서 재선언되는 케이스(`<a>` color + 리셋)와 shorthand-only 선언(`border: … var()`)을 회귀 테스트로 고정. 토큰 우선은 specificity 무시하는 **의도된 근사**(same-origin도 동일) — 정확한 computed는 별도 표시되므로 수용.
- **관련**: `src/content/css-resolve.ts:mergeCrossOriginDecls`(var 가드), `expandShorthands`+`parseBorderShorthand`(border 전개), `collectRulesForElement`(미러 원본), `src/content/__tests__/css-resolve.test.ts`. 같은 element(`#account > div > a`)의 다른 레이어 버그는 아래 2026-06-27 항목(섹션 펼침) 참조.

---

## 2026-06-27 — cross-origin stylesheet면 스타일 섹션이 전부 접혀 "값 있는데 안 보임"

- **증상**: naver.com 로그인 버튼(`#account > div > a`)을 picker로 선택하면 BugShot 스타일 편집기에 클래스명만 보이고 스타일 섹션이 전부 비어 보였다. 개발자도구 Styles 패널에선 정상으로 보였다.
- **근본 원인**: 두 레이어가 겹쳤다. (1) 스타일 수집의 specified(author rule) 채널은 `sheet.cssRules` 접근 시 cross-origin이면 SecurityError, fetch도 cross-origin이면 skip(`css-source-cache.ts:fetchSheetText`) → naver는 CSS가 `pstatic.net`(페이지는 `naver.com`)이라 specified가 통째로 빈다. (2) `StyleEditorPanel.tsx`의 섹션 `defaultOpen`이 specified 채널에만 묶여 있어(`props.some(p => p in specifiedStyles)`), specified가 비면 **모든 섹션이 접힌 채 시작**. computed 값(getComputedStyle, cross-origin 무관)은 살아있어 수동으로 펼치면 보였다 — 그래서 "값은 있는데 안 보임". 표면 증상은 "스타일 수집 실패"인데 사용자 체감 원인은 UI 펼침 상태였다.
- **재발 방지**: cross-origin이면 비는 채널(specifiedStyles·propSources·var() 토큰 전개)에 UI 가시성/상태를 **단독으로** 묶지 말 것 — computed fallback을 함께 본다. `grep "specifiedStyles\|propSources"`로 그 채널에 의존하는 UI 분기를 점검. 단순 `specified || computed` OR는 금물(computed는 `INTERESTING_PROPS` 전부 항상 채워서 모든 섹션이 늘 펼쳐짐) → "specified 전무일 때만 computed fallback" 분기. e2e는 `127.0.0.1` 페이지 + `localhost` stylesheet로 cross-origin 재현(`style-cross-origin-section.spec.ts`, fixture 서버 `.css`는 `text/css`로 — text/html이면 strict MIME 거부).
- **관련**: `src/sidepanel/lib/sectionDefaultOpen.ts`(신규 순수함수), `src/sidepanel/tabs/StyleEditorPanel.tsx`(`sectionOpen`), `src/content/css-source-cache.ts:fetchSheetText`(cross-origin skip 지점), `e2e/style-cross-origin-section.spec.ts`.

---

## 2026-06-25 — video + action-only일 때 logs.html이 본문에서 누락

- **증상**: 녹화(video) 모드에서 콘솔/네트워크 로그 없이 **액션 로그만** 있을 때, logs.html이 이슈에 첨부되지 않는 것처럼 보였다.
- **근본 원인**: `MarkdownContext`에 액션 로그 요약 필드가 아예 없었다. 이슈 본문 빌더 8개(`emitLogSummary*`)가 전부 `if (!net && !con) return`으로 로그 요약 섹션을 게이트해, 액션만 있으면 섹션을 통째로 스킵했다. `buildCaptureFiles`는 logs.html을 정상 생성·업로드했지만 본문이 참조(href/링크 노드)를 안 넣어 첨부가 고아가 됐다(GitLab/GitHub는 링크 누락, Jira ADF는 `injectLogsLink`가 붙을 노드 자체가 없음).
- **재발 방지**: 로그/미디어 종류를 본문에 노출·변경할 땐 `grep "emitLogSummary"`로 **8개 빌더**(buildIssueMarkdown md/html · buildIssueAdf · linear/github/gitlab/asana/notion)와 ctx 생성 **4곳**(buildMarkdownContext 헬퍼 · buildEditorMarkdownContext · PreviewPanel · DraftDetailDialog)을 전수 확인한다. 빌더 한 곳만 고치면 나머지 7곳이 조용히 빠진다. 빌더별 회귀 테스트 필수.
- **관련**: `src/sidepanel/lib/buildIssueMarkdown.ts`(`MarkdownContext.actionLogCaptured`), `buildMarkdownContext.ts`, `buildEditorCapture.ts`, 6개 플랫폼 body 빌더, `src/i18n/namespaces/logs.ts`(`logSummary.action.line`).
