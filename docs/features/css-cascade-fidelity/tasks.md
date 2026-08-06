# CSS 캐스케이드 충실도 — 구현 태스크

## 선행 조건

- **착수 전 `docs/POSTMORTEM.md`를 `cross-origin`·`스타일해석`으로 grep** — 이 영역이 회고 1위(13건/16%)다. 특히 **2026-06-27 / 06-28 ×2 / 07-31 / 08-03**을 읽는다(08-03이 가장 최근·가장 관련 깊은 cross-origin 회고다).
- `docs/ARCHITECTURE.md`의 "CSSOM shorthand 한계 우회" 절을 읽는다 (CLAUDE.md 지시).
- 권한·env·의존성 변경 **없음**. `pnpm install` 불필요.
- `pnpm build:e2e` 후 `pnpm test:e2e -- style-` 로 **착수 전 baseline green**을 확인한다. 이 영역은 변경 후 green/red 판정이 전부라 시작점을 못 박아야 한다.
- **`e2e/GOTCHAS.md:86`과 `e2e/COVERAGE.md:118`을 먼저 읽는다** — 기존 cross-origin fixture가 SSRF 가드로 inert하다는 사실이 여기 적혀 있고, Task 5(신규 fixture)가 그 제약을 푸는 작업이다.

---

## 태스크

### Task 1: `resolveSheetRules` 단일 접근자 도입 (동작 무변경 리팩터)

- **변경 대상**: `src/content/css-source-cache.ts`, `src/content/css-resolve.ts`
- **작업 내용**:
  - `sheetShadows: WeakMap<CSSStyleSheet, CSSStyleSheet>`와 `resolveSheetRules(sheet)`를 추가하고 export. 이 시점엔 맵이 항상 비어 있어 **동작이 완전히 동일**하다. (`WeakMap`인 이유는 design.md 참조 — 모든 조회가 갓 얻은 시트 객체 기준이라 약참조로 잃는 게 없고, `link.href` 교체로 버려진 옛 시트가 strong key로 고착되는 걸 막는다.)
  - **교체 대상은 2곳이다**: `buildRuleIndex`(`css-source-cache.ts:136-143`)와 `collectTokens`(`css-resolve.ts:421-430`). `allStyleSheets`(`css-resolve.ts:775-781`)는 **`cssRules`를 아예 만지지 않으므로**(`flattenSheets`에 위임해 시트 집합만 만든다) 교체 대상이 아니다.
  - **`try/catch` 블록은 유지한 채 안쪽의 `sheet.cssRules` 한 줄만 접근자로 바꾼다.** 현행 `try`는 `cssRules` 접근이 아니라 `walkRulesForIndex` **전체 순회**(및 `collectTokens`의 재귀 `collectFromRules`)를 감싸고 있다 — nested `cssRules`·`selectorText`가 walk 내부에서 throw할 수 있고, `try`를 걷어내면 그 throw가 `getMatchingRules` → `collectRulesForElement`까지 전파돼 **선택 전체가 깨진다.** 이걸 놓치면 "동작 무변경"이 성립하지 않는다.
  - `flattenSheets`(`css-source-cache.ts:434-469`)·`serializeAdoptedSheet`(`:598`)·`alignAndStore`(`:618`)의 `cssRules` 접근은 **교체하지 않는다** — shadow와 무관한 문맥이다(`@import` 하강·직렬화·정렬). 즉 저장소의 `cssRules` 직접 접근 5곳 중 shadow 폴백이 필요한 건 2곳뿐이다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과 (기존 테스트 무수정)
  - [ ] `pnpm build:e2e && pnpm test:e2e -- style-` 전부 green — **이 태스크는 동작 무변경이므로 red가 하나라도 나오면 교체를 잘못한 것**

---

### Task 2: shadow sheet 주입 (`loadCrossOrigin` 재작성)

- **변경 대상**: `src/content/css-source-cache.ts`
- **작업 내용**:
  - **fetch 대상 판정을 2축으로 분리** (design.md "fetch 대상 판정" 표):
    - shadow 축 = `cssRules` 접근 실패 + `href` 존재 → `collectShadowTargets()`
    - raw 축 = `href`가 non-same-origin (기존 `collectCrossOriginHrefs` 기준 유지) — `fetchSheetText`가 cross-origin이면 즉시 `null`이라 background가 유일한 raw 출처다
    - background에 보내는 URL은 두 집합의 **합집합**, `Set`으로 **dedup**(같은 href를 가리키는 `<link>` 2개가 `MAX_SHEETS=50` 캡을 두 번 갉는 걸 막는다)
    - **접근성 기준 하나로 통합하지 말 것** — CORS로 열리는 cross-origin 시트가 fetch 대상에서 빠져 `ruleToRaw`가 비고 `var()` shorthand specified가 손실된다
  - **`media`/`disabled` 비활성 시트를 원본에서 읽어 제외**한다. shadow는 `media`가 비고 `disabled=false`라 나중에 복구 불가. 오늘은 gap-fill이라 무해하지만 변경 후엔 `<link media="print">` 시트가 same-origin을 이긴다.
  - `loadCrossOrigin`을 design.md 골자대로 재작성: fetch → `new CSSStyleSheet()` + `replaceSync` → `cssRules.length === 0` 가드 → `sheetShadows.set` → `alignAndStore(shadow, text, "cross-origin")` → `ruleIndex = null`.
  - **shadow를 만들 때 원본 시트의 `ownerRule`을 함께 기록**한다 — `@import url(…) layer(vendor)` 문맥이 shadow에서 소실되면 `hasOpaqueCascadeContext`가 `false`를 돌려 확신 오답이 된다(design.md "shadow 시트의 `@layer` 구멍").
  - **`document.adoptedStyleSheets`에 절대 push하지 않는다.** 코드에 한 줄 주석으로 이유를 남긴다.
  - fetch 실패 `catch`에 `dlog`를 넣는다 — 오늘은 background(`allSettled` + `return null`)와 content(`catch { return }`) 양쪽이 완전 무음이라 E1 진단이 불가능하다.
  - `invalidate()`는 **4줄 중 3줄만** 교체한다. **`crossLoadPromise = null`(`css-source-cache.ts:95`)은 반드시 남긴다** — `ensureCrossOriginLoaded`(`:1013-1017`)의 멱등 래치라, 지우면 MutationObserver invalidate(`:363-379`) 이후 재로드가 **영구 차단**된다. `sheetShadows`는 `WeakMap`이라 `clear()`가 없고 필요도 없다.
  - `isStaleLoad(startedEpoch)` 가드는 fetch await 직후에 그대로 유지.
- **검증**:
  - [ ] **shadow 주입 성공 신호를 e2e로 관측 가능한 형태로 만든다.** `dlog`는 `window.__BUGSHOT_CSS_DEBUG__` 게이트인데 picker는 `world` 미지정 = ISOLATED(`manifest.config.ts:39-43`)라 Playwright `addInitScript`로 켤 수 없다 — **`dlog` 단언은 e2e로 불가**하므로 수동(DevTools context 전환) 항목으로 내리거나, 관측 가능한 다른 신호(패널에 뜬 값 자체)로 대체한다
  - [ ] picker 세션 **전/후**로 `document.adoptedStyleSheets.length`가 변하지 않는다 (렌더 무영향 — e2e에서 단언). **"세션 중"은 비교 대상이 아니다** — 오버레이·blocker·하이라이트가 붙어 있어 성립하지 않는다
  - [ ] 시각 회귀 없음: fixture 페이지 스크린샷이 picker 세션 **전/후** 동일(세션 중 제외)
  - [ ] **end-to-end 지연 계측**: 요소 선택 → 2차 `selectionUpdated` 도착까지를 `performance.now()`로 잰다. `replaceSync` 단독이 아니다 — `alignAndStore`의 JS 재파싱(같은 2MB 두 번째 순회)과 `ruleIndex = null` 이후의 동기 `buildRuleIndex` 재실행이 포함돼야 한다. 완화책으로 시트당 `setTimeout(0)`을 넣으면 `picker.ts:240`·`:1168`·`:1200`에서 await되는 경로가 그만큼 늦어지므로 **양보는 계측 결과를 보고 결정**한다
  - [ ] `pnpm test:e2e -- style-` green
  - [ ] (판단 항목) MutationObserver에 `attributes: true`를 추가해 `link.href`/`disabled`/`media` 변경을 잡을지 결정하고 근거를 기록. 안 하면 stale shadow가 남는다(design.md 위험 6)

---

### Task 3: 이원 경로 삭제

- **변경 대상**: `src/content/css-resolve.ts`, `src/content/css-source-cache.ts`, `src/content/__tests__/css-resolve.test.ts`, **`src/content/__tests__/css-source-cache.test.ts`**
- **작업 내용**:
  - `collectRulesForElement`(`css-resolve.ts:827-839`)의 cross-origin 블록과 `crossProps` 지역변수 삭제.
  - `mergeCrossOriginDecls`(`:846-887`) 삭제.
  - `css-source-cache.ts`에서 자체 IR 관련 심볼 삭제: `CrossOriginRule` / `CrossOriginIndexedRule` / `indexCrossOriginRules` / `crossOriginRules` / `crossOriginCustomPropRules` / `crossOriginCustomProps` / `getMatchingCrossOriginRules` / `getMatchingCrossOriginCustomPropRules` / `getCrossOriginCustomProps` / `matchCrossOriginRules`.
  - **`hasGlobalCustomPropSelector` / `GLOBAL_CUSTOM_PROP_SELECTORS`는 삭제하지 않는다** — `collectTokens`의 전역 스코프 필터로 재사용한다. 이걸 지우면 shadow의 전 규칙에서 `--*`가 긁혀 Tailwind/Bootstrap CDN의 `--tw-*` 수백 개가 토큰 드롭다운에 유입된다(PRD G5 위반, `ARCHITECTURE.md`가 현 경계를 "의도된 범위"로 기록 중).
  - `collectTokens`의 `mergeCrossOriginTokens(seen, getCrossOriginCustomProps())` 호출 삭제 — Task 1·2로 cross-origin 시트의 `--*`가 정상 루프에 들어온다. `mergeCrossOriginTokens` 자체도 고아가 되면 함께 제거. **단 전역 스코프 판정은 정상 루프 쪽에 적용해 유지한다.**
  - **테스트 삭제**: `css-resolve.test.ts`의 `mergeCrossOriginDecls`/`mergeCrossOriginTokens` 케이스 + **`css-source-cache.test.ts:228-304`의 `indexCrossOriginRules` describe(it 9개)와 `:10`의 import**. 후자를 놓치면 typecheck가 즉시 실패한다.
  - **범위 밖 잔재도 처리**: `src/sidepanel/**/__tests__/inspector-refs.test.tsx:22-24`, `e2e/COVERAGE.md:118`, `e2e/GOTCHAS.md:86`.
  - **툴팁 경로가 함께 바뀐다** — `getMatchingCrossOriginRules`의 소비처에 `collectInspectorSpecRefs`(`content/overlay.ts` 계열, 요소 툴팁 spec 참조)가 포함돼 선택의 여지 없이 전환된다. 툴팁이 cross-origin 규칙을 여전히 참조하는지 확인한다.
- **검증**:
  - [ ] **grep 12개 심볼 전부 0건**:
        `mergeCrossOriginDecls` / `mergeCrossOriginTokens` / `crossOriginRules` / `crossOriginCustomPropRules` / `crossOriginCustomProps` / `getMatchingCrossOriginRules` / `getMatchingCrossOriginCustomPropRules` / `getCrossOriginCustomProps` / `matchCrossOriginRules` / `indexCrossOriginRules` / `CrossOriginRule` / `CrossOriginIndexedRule`
        (기존 4개 패턴만 돌리면 8개를 놓친다. `GLOBAL_CUSTOM_PROP_SELECTORS`·`hasGlobalCustomPropSelector`는 **남아야 하므로 grep 대상이 아니다.**)
  - [ ] `pnpm typecheck` + `pnpm test` 통과
  - [ ] **POSTMORTEM 2026-07-31 재발 방지 (3) 계약 대조**: `css-resolve.ts`의 `TRANSPARENT_GROUP_RULES`와 `css-source-cache.ts`의 `CSSMediaRule|CSSSupportsRule` 하강 목록이 일치하는지 확인. 이 스펙이 cross-origin 규칙을 **처음으로 `walkRulesForIndex`에 태우는** 변경이라 정확히 이 계약의 상대편을 건드린다
  - [ ] `pnpm test:e2e -- style-cross-origin-section` green — **cross-origin 시트에서 스타일 섹션이 펼쳐지는지**(POSTMORTEM 2026-06-27의 원 증상)
  - [ ] 툴팁(요소 hover spec 참조)에 cross-origin 규칙이 여전히 뜬다 — 수동 확인
  - [ ] `pnpm test:e2e -- style-` 전체 green

---

### Task 3.5: 하류 소비처 전환 (specified "비어 있음 → 채워짐")

이 변경의 본질은 cross-origin 페이지에서 `specifiedStyles`가 **비어 있던 것이 채워지는 것**이고, "specified가 비었나"에 걸린 코드가 전부 분기를 바꾼다. **이걸 태스크로 세우지 않으면 "UX 변화 없음"이 거짓이 된다.**

- **변경 대상**: `src/sidepanel/lib/sectionDefaultOpen.ts`, `src/sidepanel/**/StyleChangesTable.tsx`, `hasStyleChange.ts`, `src/sidepanel/lib/buildMarkdownContext.ts`, `propMetadata.ts` (실제 경로는 착수 시 grep으로 확정)
- **작업 내용**: 각 소비처가 새 입력에서 의도대로 동작하는지 확인하고, 필요한 곳만 수정한다. 목록:
  - `sectionDefaultOpen.ts` — 2026-06-27 픽스가 만든 "specified 있음" 분기. **섹션 펼침 상태가 뒤집힌다.**
  - `StyleChangesTable.tsx:304-305`의 `asIs = specifiedStyles[prop] ?? computedStyles[prop]`와 `hasStyleChange.ts:16`의 **동일 폴백식 복제쌍** — `:307`의 `before === after`가 diff 행 존재 여부를 좌우한다. 둘이 어긋나면 표에 안 뜨는 변경이 생긴다
  - `buildMarkdownContext.ts:69-73` — specified 문자열 `includes`로 이슈 본문 토큰을 선별. **골든 스냅샷 58장이 봉인 중이라 재생성이 필요할 수 있다**
  - `StyleCssView.tsx:31,63,71` — CSS 뷰의 specified 소비
  - `propMetadata.ts`의 cross-prop 가드 — 2026-06-28 회고가 "author 명시값은 가드를 우회한다"고 못박은 지점이 **새로 발동**한다
- **검증**:
  - [ ] 각 소비처의 새 동작을 확인하고 의도와 다른 곳을 수정했다
  - [ ] 골든 스냅샷 재생성이 필요했는지 판정하고, 필요했다면 diff를 눈으로 검토한 기록을 남긴다 (**무비판 재생성 금지** — 스냅샷이 봉인하던 게 무너진 건지 개선된 건지 구분)
  - [ ] `pnpm test` 통과
  - [ ] cross-origin fixture에서 스타일 섹션 펼침·diff 표 행 존재가 의도대로다

---

### Task 4: `selectorSpecificity` 재귀 확장

**Task 1~3.5와 독립**이지만, 아래 선행 조건이 있다.

- **변경 대상**: `src/content/css-resolve.ts`, `src/content/css-source-cache.ts`(`splitSelectorList`), `src/content/__tests__/css-resolve.test.ts`
- **선행 조건 — 토크나이저 하드닝 (먼저 한다)**:
  재귀의 실패 방향이 `null`이 아니라 **조용한 오답**이라 이 층이 fail-closed가 아니면 "잘못된 확정 < uncertain" 원칙이 무너진다. A1(라이브러리) 기각이 유효하려면 이 조치가 조건이다(design.md "실패 방향 판정").
  - `splitSelectorList`(`css-source-cache.ts:241-257`) — 따옴표·이스케이프를 전혀 모른다. `:is(a[title=","], .b)`를 3조각으로, `.a\,b`를 2조각으로 오분할
  - `skipBalanced`(`css-resolve.ts:1065-1083`) — 따옴표 *안*의 `\`만 처리하고 밖의 `\)`·`\(`를 놓쳐 `argEnd`가 어긋난다
  - 두 함수의 차등 테스트를 **먼저** 작성해 red를 만들고 고친다
- **작업 내용**:
  - **테스트 먼저 작성**(CLAUDE.md 테스트 우선). Selectors 4 사양 예제 + Tailwind 실전 셀렉터로 red를 만든다.
  - `ARG_MAX_PSEUDOS = new Set(["is","not","has","matches","-webkit-any","-moz-any","any"])`를 **새로 만들어 먼저 검사**하고, `UNRESOLVABLE_FUNCTIONAL_PSEUDOS`(`:1018-1024`)는 **교체가 아니라 분리**로 남긴다 — 그 집합에는 `host`·`host-context`가 들어 있고 그 둘의 `null`은 유지해야 한다.
  - `maxArgSpecificity(args, depth)` 재귀 추가. `splitSelectorList` + `skipBalanced` 재사용, 신규 의존성 0.
  - `:nth-child(An+B of S)` / `:nth-last-child(An+B of S)` — `of` 뒤를 `maxArgSpecificity`에 넘기고 `b++`를 함께 가산.
  - `MAX_SELECTOR_DEPTH = 8` 초과 시 `null`. **최상위 호출을 depth 0으로 센다**(off-by-one을 코드와 테스트에 못 박는다).
  - **`null` 유지 목록**: `&`, `|`, `::part()`, `::slotted()`, `:host`, `:host-context`, 미폐합 괄호.
  - **기존 테스트 4건을 반드시 수정한다** — `css-resolve.test.ts:1755-1768`의 "판정 불가 셀렉터는 null" 배열에 `":is(.a)"`, `":not(.a)"`, `":has(.a)"`, `"li:nth-child(2n of .a)"`가 들어 있다. 이 4건 제거가 필수. (같은 배열의 `":host(.a)"`는 **남긴다** — 위 "분리"가 지켜지는지 지키는 그물이다.)
- **검증** — 단위 테스트 케이스:
  - [ ] `":where(.a, #b)"` → `[0,0,0]` (기존 동작 유지)
  - [ ] `".a:is(#b, .c)"` → `[1,1,0]`
  - [ ] `".a:not(#b)"` → `[1,1,0]`
  - [ ] `".a:not(.b, #c)"` → `[1,1,0]` (Selectors 4 다중 인자)
  - [ ] `":has(.x .y)"` → `[0,2,0]`
  - [ ] `":has(> .x)"` → `[0,1,0]` (선행 결합자)
  - [ ] `":is(.a, :is(#b))"` → `[1,0,0]` (중첩 재귀)
  - [ ] `":is()"` → `[0,0,0]` (빈 인자 목록 = 0 기여)
  - [ ] `"li:nth-child(2n of .item)"` → `[0,2,1]`
  - [ ] `":is(.a, &)"` → `null` (인자 하나가 불가면 전체 불가)
  - [ ] `":host(.a)"` → `null` (분리가 지켜지는지 — 회귀 방어)
  - [ ] `":is(.a"` → `null` (미폐합)
  - [ ] `".dark\\:bg-slate-800:is(.dark *)"` → `[0,2,0]` (이스케이프 처리 생존 — `skipEscape` 회귀 방어)
  - [ ] `':is(a[title=","], .b)'` → `[0,2,0]` (따옴표 안 콤마 — 하드닝 없이는 오분할)
  - [ ] `MAX_SELECTOR_DEPTH` 경계: depth 8 정확히 → 확정, depth 9 → `null`. **셀렉터 문자열을 명시적으로 박는다**
  - [ ] `pnpm test` + `pnpm typecheck` 통과
  - [ ] `pnpm test:e2e -- style-specificity` green — **단, 기존 `e2e/style-specificity.spec.ts`는 케이스 3개(문서순/hex 이스케이프/`@container`)뿐이라 `:is()` 확정을 전혀 검증하지 않는다. 이 green은 vacuous이므로 Task 5의 신규 spec이 정본이다**

---

### Task 5: e2e fixture·spec 신설 (SSRF 가드를 실제로 통과시킨다)

기존 fixture로는 그물이 안 쳐진다. `isFetchableSheetUrl`(`src/lib/ssrf-guard.ts:19,42`)이 `localhost`·`127.0.0.1`을 차단하므로 `e2e/fixtures/pages/cross-origin-style.html`(시트 호스트가 `localhost`)에서는 **fetch가 아예 일어나지 않는다** — shadow도 안 생기고 시나리오가 전부 공회전 green이 된다.

- **변경 대상**: `e2e/fixtures/pages/` (신규), `e2e/style-cross-origin-cascade.spec.ts` (신규), fixture 서버 설정
- **작업 내용**:
  - **신규 fixture**를 만든다. 기존 `cross-origin-style.*`은 "fetch 차단 → computed 폴백" 회귀 방어가 목적이므로 **확장하지 말고 분리**한다.
  - 시트를 `http://css.bugshot.test:${port}/…`로 서빙한다 — `e2e/fixtures/extension.ts:196`의 `--host-resolver-rules=MAP *.bugshot.test 127.0.0.1`가 이미 있어 loopback 서버에 도달하면서도 **호스트명이 loopback이 아니라 가드를 정상 통과**한다(우회가 아니다).
  - `.css`는 반드시 `text/css`로 서빙한다(strict MIME 거부 — POSTMORTEM 2026-06-27).
  - **각 시나리오는 "fetch가 실제로 일어났다"를 증명하는 mutation을 요구한다** — 앞 게이트가 잘라서 green이 나는 걸 막는다(POSTMORTEM 2026-07-31 동일 함정).
- **e2e 시나리오** (`/e2e-write`의 입력):
  1. cross-origin 시트에 `#target.btn { width: 12rem }`, same-origin에 `.btn { width: 100px }`를 두고 요소를 선택하면 **패널의 width가 `12rem`이 된다**(specificity 승리 — 오늘은 gap-fill이라 same-origin이 이긴다). **판별값이 `12rem`인 이유**: 판정이 죽어 computed 폴백으로 떨어지면 `192px`가 나오므로 실패가 드러난다. 리터럴(`rgb(1,2,3)` 등)을 쓰면 computed가 곧 승자 값이라 판정 사망 시에도 같은 문자열이 나와 **테스트가 공허해진다**(POSTMORTEM 2026-07-31).
  2. 같은 조건에서 **`propSources`의 width 출처가 `#target.btn`으로 표시된다** — 단언 대상은 `FieldRow`의 **`title` 속성 문자열**이다(현재 유일한 노출 경로가 네이티브 툴팁이고, e2e에 `title` 단언 선례가 0건이라 헬퍼가 필요할 수 있다).
  3. cross-origin 시트의 `@media (max-width: 1px) { .btn { padding: 77px } }`가 있을 때 요소를 선택하면 **패널에 `77px`가 나타나지 않는다**(조건 평가 — 오늘은 나타난다). **이 시나리오는 부정 단언이라 fetch가 실패해도 통과한다** — 반드시 같은 spec 안에서 시나리오 1의 mutation(fetch 성공 증명)을 먼저 확인한 뒤 판정한다.
  4. cross-origin 시트에 `.btn { margin: 5px !important }`, same-origin에 `#target.btn { margin: 1rem }`를 두면 **패널의 margin이 `5px`가 된다**(`!important` 축). same-origin 쪽을 `1rem`으로 두는 것도 같은 이유 — 표기가 갈려야 판별된다.
  5. picker 세션 **전후**로 `document.adoptedStyleSheets.length`가 변하지 않는다(렌더 무영향). 세션 "중"은 오버레이 때문에 비교 대상이 아니다.
  6. cross-origin 시트만 있는 페이지에서 요소를 선택하면 **스타일 섹션이 펼쳐진 채로 뜬다**(기존 `style-cross-origin-section.spec.ts` 시나리오 유지 — Task 3.5의 `sectionDefaultOpen` 회귀 방어).
  7. **`@layer` 강등(E5)**: cross-origin 시트에 `@layer vendor { #target.btn { width: 12rem } }`를 두면 uncertain으로 강등돼 **`192px`(computed 폴백)이 뜨고, 값이 사라지지는 않는다.** 같은 시트에 `@layer vendor { #target.btn { color: var(--brand) } }`를 두면 `var()` 보존 가드 때문에 **원문이 유지된다.**
  8. **`@import url(…) layer(vendor)`로 들어온 cross-origin 시트**가 확신 오답을 내지 않는다(design.md "shadow 시트의 `@layer` 구멍" 방어 검증).
  9. **`<link media="print">` cross-origin 시트**의 선언이 패널에 뜨지 않는다.
- **검증**:
  - [ ] 9개 시나리오 green
  - [ ] 시나리오 1의 mutation이 없으면 spec이 red — 즉 fetch가 정말 일어난다는 것이 spec 자체로 증명된다
  - [ ] `e2e/COVERAGE.md`·`e2e/GOTCHAS.md`의 "cross-origin 보강은 항상 inert" 서술을 갱신한다

---

### Task 6: 엣지 케이스 검증 (E1~E5)

PRD가 E1~E5를 열거했으나 대응 검증이 없었다. fixture로 재현 가능한 것은 e2e로, 나머지는 수동으로 고정한다.

- [ ] **E1 fetch 실패/SSRF 거부** — 기존 `cross-origin-style.*` fixture(localhost 시트)가 그대로 이 케이스다. 값이 computed 폴백으로 채워지고 패널이 깨지지 않는다. `dlog`에 실패가 찍힌다(수동)
- [ ] **E2 `replaceSync` throw** — 구문이 깨진 `.css`를 서빙하는 fixture. 그 시트만 skip되고 나머지 시트의 규칙은 정상 반영
- [ ] **E2' `@import`만 있는 매니페스트 시트** — 빈 shadow가 만들어지지 않고 `injected`가 오르지 않는다(`cssRules.length === 0` 가드)
- [ ] **E3 로드 중 시트 교체 / 세션 중 재로드** — `isStaleLoad` 가드가 옛 결과를 폐기한다
- [ ] **E4 세션 종료 후 잔재** — `invalidate()` 후 `document.adoptedStyleSheets`에 잔재 없음, 다음 세션에서 cross-origin이 **다시 로드된다**(`crossLoadPromise` 보존 확인 — Task 2의 함정 회귀 방어)
- [ ] **E5 `@layer` 강등** — Task 5 시나리오 7
- [ ] **빈 데이터** — cross-origin 시트가 0장인 페이지에서 회귀 없음
- [ ] **`pnpm check:prearm` 통과** — `recorders-entry` 청크에 외부 static import 무유입

---

## 테스트 계획

### 단위 테스트 (`src/content/__tests__/`)

- `selectorSpecificity` — Task 4 검증 항목 15건이 그대로 케이스.
- `splitSelectorList` / `skipBalanced` — Task 4 선행 조건의 차등 테스트(따옴표·이스케이프).
- `resolveSheetRules` — **대상 파일은 node 환경이다**(`vitest.config.ts:17`이 `*.test.tsx`만 jsdom으로 분기). node에는 `CSSStyleSheet` 생성자·`replaceSync`가 아예 없다. 구조적 타입 스텁으로 분기를 고정하되, **shadow 폴백 분기를 타려면 `sheetShadows`에 주입할 수 있어야 한다** — 접근자만 export하면 "둘 다 없으면 null" 분기만 검증 가능하다. 테스트용 주입 진입점을 열거나(권장), 이 항목을 e2e로 넘긴다.

### e2e

Task 5 참조 — 신규 fixture + 신규 spec 9개. 기존 spec 15개는 무수정 green이 목표이고, red가 나면 그 자체가 회귀 신호다.

### 수동 테스트 (Chrome)

`pnpm build` 선행 필요 — dist가 stale이면 헛테스트가 된다.

**외부 사이트는 보조 스모크로만 쓴다** — 셀렉터·CSS 구조가 시간이 지나면 바뀌어 판정 불가가 된다. 정본은 Task 5·6의 fixture다.

- [ ] 대형 CSS 사이트(시트 20장+)에서 요소 선택 시 **체감 지연**이 없는지, 그리고 **2차 도착 시 값이 눈앞에서 바뀌는지**(design.md "알려진 UX 부채" — 지연이 아니라 무통보 *교체*가 문제다)
- [ ] 같은 페이지에서 **이슈 미리보기의 "변경 전"(As-is) 컬럼** 값이 패널과 일치하는지 (PRD S4 — 이 값이 8개 플랫폼 본문과 AI meta로 나간다)
- [ ] **토큰 드롭다운 후보가 과다하지 않은지** — Task 3의 전역 스코프 필터 유지가 지켜졌는지 확인(CDN 디자인 시스템 사이트)
- [ ] 시각 회귀: picker 세션 중 페이지 렌더링이 변하지 않는지
- [ ] (스모크) `naver.com` 로그인 버튼 — color·border-color·background-color가 `var(--…)` 토큰으로 뜨고 swatch가 붙는지
- [ ] (스모크) Tailwind 사이트 — `:is()`가 낀 유틸리티 요소. **v4는 출력 전체가 `@layer`라 단독 선언만 수혜**임을 감안해 판정

---

## 구현 순서 권장

```
Task 1 ──► Task 2 ──► Task 3 ──► Task 3.5
   │                              │
   │                              ▼
   └──► Task 4 (독립)          Task 5 (e2e) ──► Task 6 (엣지)
```

- **Task 1→2→3→3.5는 순차 필수.** 1이 접근자를 만들고, 2가 그 맵을 채우고, 3이 옛 경로를 지우고, 3.5가 하류를 맞춘다. 3을 먼저 하면 cross-origin이 통째로 사라진 상태가 된다.
- **Task 4는 독립** — `selectorSpecificity`는 shadow sheet와 무관한 순수 함수라 아무 때나 병렬 가능하다. 다만 **1~3.5와 같은 커밋에 섞지 않는다** — 둘 다 "specified 값이 바뀐다"는 같은 증상을 만들어 회귀 원인 분리가 어려워진다.
- **Task 5(e2e)는 Task 2 이후 아무 때나 시작 가능**하고, 오히려 **일찍 시작할수록 좋다.** 기존 spec은 fetch가 막혀 무반응이라 Task 2·3의 실제 동작을 아무것도 검증하지 못한다 — 신규 fixture가 서기 전까지는 사실상 눈을 감고 가는 구간이다.

> **구 문서의 "Task 2 완료 시점 = 두 경로 동시 생존" 서술은 삭제한다.** 재작성된 `loadCrossOrigin`은 `crossOriginRules`를 더 이상 채우지 않으므로 `mergeCrossOriginDecls` gap-fill은 중복이 아니라 **no-op 죽은 코드**가 된다. 값 충돌은 나지 않는다. 반대로 이 시점에서 동작은 이미 크게 바뀌므로(specificity 경쟁·`@media` 평가) "여기서 멈춰 기존 e2e 전체 green"을 게이트로 삼는 것도 무의미하다 — 신규 spec이 없고 기존 spec은 fetch가 막혀 무반응이라 아무것도 검증하지 못한다.

---

## 드롭된 항목

### ~~Task 0: `style.cssText` shorthand 원문 전제 검증~~ — 드롭됨

**사유**: 게이트의 결정적 케이스(`color: red; color: var(--x)` 중복 선언)가 **CSSOM 사양으로 이미 결정돼 있다** — 선언 블록은 prop당 항목이 1개인 순서 집합이라 반드시 마지막 하나로 접힌다. raw 텍스트 파서는 둘 다 본다. 즉 `cssText`는 raw 파서의 상위호환이 될 수 없고, 게이트는 실측해도 통과할 수 없다. 확정된 결론에 fixture + Chrome 계측을 태우는 건 낭비다.

### ~~Task 5(구): `cssText` 주 경로 승격~~ — 드롭됨

**사유**: 위 게이트가 통과 불가이므로 조건이 성립하지 않는다. 또한 이 태스크는 PRD의 목표·비목표·성공 기준 어디에도 근거가 없었다(스코프 밖 유입). PRD 비목표에 명시적으로 편입했다.

**남기는 사실**: `CSS_DECL_RE`(`css-resolve.ts:209`, `/([\w-]+)\s*:\s*([^;]+)/g`)는 `url(a;b.png)`(값 안 세미콜론)·`content: ":"`(값 안 콜론)에서 깨지는 나이브 정규식이다. 실재하는 결함이고 Hoverify도 같은 결함을 갖고 있다(브리프가 "베끼지 말 것"으로 지목). 이번 스펙과 독립이므로 별도 항목으로 백로그에 남긴다.

---

## 가이드 영향

**없음.** 사용자 노출 UX·기능 변화가 없다 — 같은 화면에 더 정확한 값이 뜬다.

**단, 문서 3종은 `/push` 트라이아지 대상이다:**

- `docs/ARCHITECTURE.md`의 "CSSOM shorthand 한계 우회" 절과 CLAUDE.md의 "요소 스타일 캐스케이드 판정" 항목 — **cross-origin 경로 설명이 통째로 바뀐다.**
- `docs/privacy.{ko,en}.md` — **"갱신 불필요"로 단정하지 않는다.** `collectCrossOriginHrefs`(origin 비교) → shadow/raw 2축 판정으로 **fetch 대상 집합이 바뀌므로**, POSTMORTEM 2026-08-03 재발 방지 (4)("외부 요청 트리거 시점/대상이 바뀌면 privacy를 갱신한다. manifest diff 0을 이유로 건너뛰지 말 것")에 따라 **재검토가 필요하다.** 결론이 "갱신 불필요"여도 확인했다는 기록을 남긴다(웹스토어 심사 탈락 전례).
- `e2e/COVERAGE.md`·`e2e/GOTCHAS.md` — cross-origin 커버리지 서술이 Task 5로 바뀐다.
