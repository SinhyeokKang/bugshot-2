# CSS 캐스케이드 충실도 — 구현 태스크

## 선행 조건

- **착수 전 `docs/POSTMORTEM.md`를 `cross-origin`·`스타일해석`으로 grep** — 이 영역이 회고 1위(13건/16%)다. 특히 2026-06-27 / 06-28 ×3 / 07-31을 읽는다.
- `docs/ARCHITECTURE.md`의 "CSSOM shorthand 한계 우회" 절을 읽는다 (CLAUDE.md 지시).
- 권한·env·의존성 변경 **없음**. `pnpm install` 불필요.
- `pnpm build:e2e` 후 `pnpm test:e2e -- style-` 로 **착수 전 baseline green**을 확인한다. 이 영역은 변경 후 green/red 판정이 전부라 시작점을 못 박아야 한다.

---

## 태스크

### Task 0: `style.cssText` shorthand 원문 전제 검증 (게이트 — 통과해야 Task 5가 열린다)

브리프 #2의 전제 "Chrome이 `CSSStyleDeclaration.cssText`에서 shorthand를 저자 원문 형태로 되돌려준다"는 **실측 미검증**이다. 통과하면 raw fetch/align 기구(`ruleToRaw`·`alignAndStore`·`parseStylesheet`)를 크게 줄일 수 있고, 실패하면 이 항목을 드롭한다.

- **변경 대상**: 없음 (조사 전용). 결과를 이 파일 하단 "Task 0 결과" 절에 기록.
- **작업 내용**: `e2e/fixtures/pages/`에 검증용 픽스처를 두고 실제 Chrome에서 `rule.style.cssText` 반환값을 관측한다. 최소 6케이스:
  1. `margin: var(--m) auto` — pending-substitution shorthand
  2. `padding: 1px 1px 1px 1px` — 축약 가능한 동일값 (Chrome이 `padding: 1px`로 재직렬화하는지)
  3. `border: 1px solid var(--c)` — 혼합 문법 shorthand
  4. `background: url(a;b.png) no-repeat` — 값 안 세미콜론
  5. `content: ":"` — 값 안 콜론
  6. `color: red; color: var(--x)` — **같은 prop 중복 선언(폴백 패턴)**
- **판정 기준**:
  - 1·3이 원문 형태로 나오면 "shorthand 보존" 성립.
  - 2가 `padding: 1px`로 축약되면 **원문이 아니라 재직렬화**임이 확정 — "저자 원문"이라는 표현을 쓸 수 없다(값은 등가라 실해는 없을 수 있음).
  - **6이 결정적이다.** CSSOM은 중복 선언을 마지막 하나로 접는다. raw 텍스트 파서는 둘 다 본다. 접힌다면 `cssText`는 raw 파서의 상위호환이 **아니고**, 기구를 대체할 수 없다.
  - 4·5는 현행 `CSS_DECL_RE`(`css-resolve.ts:209`, `/([\w-]+)\s*:\s*([^;]+)/g`)가 **깨지는 것이 이미 확인된** 나이브 정규식이다. `cssText`를 주 경로로 승격하려면 문자열·괄호 인식 토크나이저가 선행 조건임을 기록한다.
- **검증**:
  - [ ] 6케이스 실측 결과가 "Task 0 결과" 절에 값과 함께 기록됐다
  - [ ] 게이트 판정(진행/드롭)이 근거와 함께 적혔다
  - [ ] 드롭 시 Task 5를 이 문서에서 삭제하지 않고 "드롭됨 + 사유"로 남긴다

> **Task 0은 Task 1~4와 독립이다.** 병렬로 돌려도 되고, 게이트가 실패해도 나머지는 그대로 진행한다.

---

### Task 1: `resolveSheetRules` 단일 접근자 도입 (동작 무변경 리팩터)

- **변경 대상**: `src/content/css-source-cache.ts`, `src/content/css-resolve.ts`
- **작업 내용**:
  - `sheetShadows: Map<CSSStyleSheet, CSSStyleSheet>`와 `resolveSheetRules(sheet)`를 추가하고 export. 이 시점엔 맵이 항상 비어 있어 **동작이 완전히 동일**하다.
  - `cssRules`를 직접 만지는 3곳을 교체: `buildRuleIndex`(`css-source-cache.ts:136-143`), `collectTokens`(`css-resolve.ts:423-430`), 그리고 `allStyleSheets` 소비처.
  - `flattenSheets`(:443-448)는 **교체하지 않는다** — `@import` 하강 전용이고 shadow엔 `@import`가 없다(비목표).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과 (기존 테스트 무수정)
  - [ ] `pnpm build:e2e && pnpm test:e2e -- style-` 전부 green — **이 태스크는 동작 무변경이므로 red가 하나라도 나오면 교체를 잘못한 것**

### Task 2: shadow sheet 주입 (`loadCrossOrigin` 재작성)

- **변경 대상**: `src/content/css-source-cache.ts`
- **작업 내용**:
  - `collectCrossOriginHrefs`를 `collectInaccessibleSheets()`로 교체 — 판정 기준을 origin 비교에서 **`cssRules` 접근 실패 + `href` 존재**로 옮긴다.
  - `loadCrossOrigin`을 design.md 골자대로 재작성: fetch → `new CSSStyleSheet()` + `replaceSync` → `sheetShadows.set` → `alignAndStore(shadow, text, "cross-origin")` → `ruleIndex = null`.
  - **`document.adoptedStyleSheets`에 절대 push하지 않는다.** 코드에 한 줄 주석으로 이유를 남긴다.
  - `invalidate()`의 `crossOrigin*` 초기화 3줄을 `sheetShadows.clear()`로 교체.
  - `isStaleLoad(startedEpoch)` 가드는 fetch await 직후에 그대로 유지.
- **검증**:
  - [ ] cross-origin fixture 페이지에서 `dlog("aligned", { kind: "cross-origin", … })`의 `mapped`가 0보다 크다
  - [ ] 같은 페이지에서 `document.adoptedStyleSheets.length`가 변하지 않는다 (렌더 무영향 — e2e에서 단언)
  - [ ] 시각 회귀 없음: fixture 페이지 스크린샷이 picker 세션 전/중/후 동일
  - [ ] 50장 × 대용량 시트에서 `replaceSync` 총 소요를 `performance.now()`로 계측해 기록. 프레임 예산(16ms) 대비 과도하면 시트당 `setTimeout(0)` 양보를 넣는다
  - [ ] `pnpm test:e2e -- style-` green

### Task 3: 이원 경로 삭제

- **변경 대상**: `src/content/css-resolve.ts`, `src/content/css-source-cache.ts`, `src/content/__tests__/css-resolve.test.ts`
- **작업 내용**:
  - `collectRulesForElement`(`css-resolve.ts:827-839`)의 cross-origin 블록과 `crossProps` 지역변수 삭제.
  - `mergeCrossOriginDecls`(:846-887) 삭제.
  - `css-source-cache.ts`에서 design.md 목록대로 자체 IR 관련 심볼 12개 삭제.
  - `collectTokens`의 `mergeCrossOriginTokens(seen, getCrossOriginCustomProps())` 호출 삭제 — Task 1로 cross-origin 시트의 `--*`가 정상 루프에 들어온다. `mergeCrossOriginTokens` 자체도 고아가 되면 함께 제거한다.
  - 대응 테스트 삭제.
- **검증**:
  - [ ] `grep -rn "mergeCrossOriginDecls\|crossOriginRules\|getMatchingCrossOrigin\|getCrossOriginCustomProps" src` 결과가 0건
  - [ ] `pnpm typecheck` + `pnpm test` 통과
  - [ ] `pnpm test:e2e -- style-cross-origin-section` green — **cross-origin 시트에서 스타일 섹션이 펼쳐지는지**(POSTMORTEM 2026-06-27의 원 증상)
  - [ ] `pnpm test:e2e -- style-` 전체 green

### Task 4: `selectorSpecificity` 재귀 확장

- **변경 대상**: `src/content/css-resolve.ts`, `src/content/__tests__/css-resolve.test.ts`
- **작업 내용**:
  - **테스트 먼저 작성**(CLAUDE.md 테스트 우선). Selectors 4 사양 예제 + Tailwind 실전 셀렉터로 red를 만든다.
  - `UNRESOLVABLE_FUNCTIONAL_PSEUDOS`를 `ARG_MAX_PSEUDOS`(`is|not|has|matches|-webkit-any|-moz-any|any`)로 교체하고 `maxArgSpecificity(args, depth)` 재귀를 추가. `splitSelectorList` + `skipBalanced` 재사용, 신규 의존성 0.
  - `:nth-child(An+B of S)` / `:nth-last-child(An+B of S)` — `of` 뒤를 `maxArgSpecificity`에 넘기고 `b++`를 함께 가산.
  - `MAX_SELECTOR_DEPTH = 8` 초과 시 `null`.
  - **`null` 유지 목록**: `&`, `|`, `::part()`, `::slotted()`, `:host`, `:host-context`, 미폐합 괄호.
- **검증** — 단위 테스트 케이스:
  - [ ] `":where(.a, #b)"` → `[0,0,0]` (기존 동작 유지)
  - [ ] `".a:is(#b, .c)"` → `[1,1,0]`
  - [ ] `".a:not(#b)"` → `[1,1,0]`
  - [ ] `":has(.x .y)"` → `[0,2,0]`
  - [ ] `":is(.a, :is(#b))"` → `[1,0,0]` (중첩 재귀)
  - [ ] `"li:nth-child(2n of .item)"` → `[0,2,1]`
  - [ ] `":is(.a, &)"` → `null` (인자 하나가 불가면 전체 불가)
  - [ ] `":is(.a"` → `null` (미폐합)
  - [ ] `".dark\\:bg-slate-800:is(.dark *)"` → 이스케이프 처리가 살아 있다 (`skipEscape` 회귀 방어)
  - [ ] 깊이 9 중첩 → `null`
  - [ ] `pnpm test` + `pnpm typecheck` 통과
  - [ ] `pnpm test:e2e -- style-specificity` green

### Task 5: `cssText` 주 경로 승격 — **Task 0 게이트 통과 시에만**

- **변경 대상**: Task 0 결과에 따라 확정.
- **작업 내용**: Task 0에서 6케이스가 모두 통과했을 때만 착수한다. 최소 선행 조건 2개:
  1. `CSS_DECL_RE`(`css-resolve.ts:209`)를 문자열·괄호 인식 토크나이저로 교체 — 지금 정규식은 `url(a;b.png)`·`content: ":"`에서 깨진다(Hoverify가 같은 결함을 갖고 있고, 브리프가 "베끼지 말 것"으로 지목한 항목).
  2. `!important`는 `getPropertyPriority` 경로를 그대로 유지 — 값 문자열에서 파싱하지 않는다.
- **검증**: Task 0 게이트 결과와 함께 재정의한다. 게이트 실패 시 이 태스크는 **삭제하지 말고 "드롭됨 + 사유"로 남긴다.**

---

## Task 0 결과

> 구현 시 채운다. (미실행)

---

## 테스트 계획

### 단위 테스트 (`src/content/__tests__/css-resolve.test.ts`)

- `selectorSpecificity` — Task 4 검증 항목 10건이 그대로 케이스.
- `resolveSheetRules` — jsdom엔 `CSSStyleSheet` 생성자·`replaceSync`가 없어 **직접 테스트 불가**. 구조적 타입 스텁으로 "throw 하면 shadow 폴백, 둘 다 없으면 null"의 분기만 고정한다.

### e2e 시나리오 (`/e2e-write`의 입력)

fixture는 `e2e/fixtures/pages/cross-origin-style.html` + `cross-origin-style.css`를 확장한다(`127.0.0.1` 페이지 + `localhost` 시트로 cross-origin 재현, `.css`는 `text/css`로 서빙 — POSTMORTEM 2026-06-27).

신규 spec `e2e/style-cross-origin-cascade.spec.ts`:

1. cross-origin 시트에 `#target.btn { color: rgb(1, 2, 3) }`, same-origin에 `.btn { color: rgb(9, 9, 9) }`를 두고 요소를 선택하면 **패널의 color가 `rgb(1, 2, 3)`이 된다** (specificity 승리 — 오늘은 gap-fill이라 same-origin이 이긴다).
2. 같은 조건에서 **`propSources`의 color 출처가 `#target.btn`으로 표시된다**.
3. cross-origin 시트의 `@media (max-width: 1px) { .btn { padding: 77px } }`가 있을 때 요소를 선택하면 **패널에 `77px`가 나타나지 않는다** (조건 평가 — 오늘은 나타난다).
4. cross-origin 시트에 `.btn { margin: 5px !important }`, same-origin에 `#target.btn { margin: 1px }`를 두면 **패널의 margin이 `5px`가 된다** (`!important` 축).
5. picker 세션 진입 전후로 **`document.adoptedStyleSheets.length`가 변하지 않는다** (렌더 무영향).
6. cross-origin 시트만 있는 페이지에서 요소를 선택하면 **스타일 섹션이 펼쳐진 채로 뜬다** (기존 `style-cross-origin-section.spec.ts` 시나리오가 유지되는지 — 회귀 방어).

기존 spec은 무수정 green이 목표다. red가 나면 그 자체가 회귀 신호다.

### 수동 테스트 (Chrome)

`pnpm build` 선행 필요 — dist가 stale이면 헛테스트가 된다.

- [ ] `naver.com` 로그인 버튼(`#account > div > a`) — POSTMORTEM 3건이 나온 기준 요소. color·border-color·background-color가 `var(--…)` 토큰으로 뜨고 swatch가 붙는지
- [ ] Tailwind v4 사이트(`tailwindcss.com`) — `:is()`가 낀 유틸리티 요소에서 computed 리터럴 대신 저자 원문이 뜨는지
- [ ] `@layer`를 쓰는 cross-origin 사이트 — uncertain 강등이 일어나되 값이 **사라지지는 않는지**(computed 폴백이 채워야 한다)
- [ ] 대형 CSS 사이트(시트 20장+)에서 요소 선택 시 체감 지연이 없는지
- [ ] 시각 회귀: picker 세션 중 페이지 렌더링이 변하지 않는지

## 구현 순서 권장

```
Task 0 ──────────────────────────────────► (게이트) ──► Task 5
                                                        [조건부]
Task 1 ──► Task 2 ──► Task 3
   │
   └────────────────► Task 4
```

- **Task 0은 완전 독립** — 다른 작업과 병렬로 돌린다.
- **Task 4도 독립** — `selectorSpecificity`는 shadow sheet와 무관한 순수 함수라 Task 1 이후 아무 때나 병렬 가능하다. 다만 **1~3과 같은 커밋에 섞지 않는다** — 둘 다 "specified 값이 바뀐다"는 같은 증상을 만들어 회귀 원인 분리가 어려워진다.
- Task 1→2→3은 **순차 필수**. 1이 접근자를 만들고, 2가 그 맵을 채우고, 3이 옛 경로를 지운다. 3을 먼저 하면 cross-origin이 통째로 사라진 상태가 된다.
- Task 2 완료 시점에서 **한 번 멈추고 e2e 전체를 돌린다.** 이 지점이 두 경로가 동시에 살아 있는 유일한 순간이라(shadow + gap-fill 중복), 값이 이상하면 3 이전에 잡는 게 싸다.

## 가이드 영향

**없음.** 사용자 노출 UX·기능 변화가 없다 — 같은 화면에 더 정확한 값이 뜬다.

단, `docs/ARCHITECTURE.md`의 "CSSOM shorthand 한계 우회" 절과 CLAUDE.md의 "요소 스타일 캐스케이드 판정" 항목은 **cross-origin 경로 설명이 통째로 바뀌므로 `/push` 트라이아지 대상**이다. `docs/privacy.{ko,en}.md`는 fetch 동작·대상·캡이 전부 그대로라 갱신 불필요(변경 없음을 확인한 것으로 기록).
