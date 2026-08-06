# UA 기본값 기준선 — 구현 태스크

## 선행 조건

- **착수 전 `docs/POSTMORTEM.md`에서 2026-06-29(Transition 항상 펼침)·2026-06-28(유령 border-color) 두 항목 전문을 읽는다.** 이 기능은 앞의 1건을 구조로 바꾸고 뒤의 1건은 기존 가드로 존치하는 작업이라, 원 증상을 모르면 검증 항목이 공허해진다.
- **PRD "사정거리" 절을 먼저 읽는다.** UA 축이 실효를 갖는 범위는 `INTERESTING_PROPS` 등록 ∩ 비상속 ∩ 레이아웃 비의존 ∩ `KNOWN_DEFAULTS` 미등록의 교집합이다. 이 경계를 흐리면 검증이 통과해도 의미가 없다.
- 권한·env·의존성 변경 **없음**.
- `css-cascade-fidelity`와 **독립**이지만 무관하지는 않다 — 그 기능은 `isSpecified`가 true로 확정되는 prop을 늘리고, `isDefaultValue`는 `isSpecified`면 UA 축을 보지 않는다. **cascade 구현 후 UA 축의 적용 범위는 줄어든다.** 순서 제약은 없으나 둘 다 `css-resolve.ts`를 건드리므로 같은 브랜치에서 동시 편집은 피한다.

---

## 태스크

### Task 1: 순수 비교 함수 (테스트 먼저)

- **변경 대상**: `src/content/css-resolve.ts`, `src/content/__tests__/css-resolve.test.ts`
- **작업 내용**:
  - 테스트를 먼저 써서 red를 만든다(CLAUDE.md 테스트 우선).
  - `propsMatchingBaseline(computed, baseline)` 구현. `baseline`이 `null`이면 `[]`.
  - 레이아웃 의존 prop 제외 상수를 함께 둔다:
    ```ts
    // display:none iframe엔 레이아웃이 없어 used value가 무의미하다. 비교 대상에서 뺀다.
    const LAYOUT_DEPENDENT = new Set([
      "width", "height", "min-width", "max-width", "min-height", "max-height",
    ]);
    ```
    **이 목록의 근거는 코드가 아니라 실측이다** — Task 9 수동 덤프 결과로 확정하고, 그때까지는 잠정이다(design.md 위험 3).
- **검증** — 단위 테스트:
  - [ ] `baseline === null` → `[]`
  - [ ] 값이 같은 prop만 반환 (`{color:"rgb(0,0,0)"}` vs 동일 → `["color"]`)
  - [ ] 값이 다르면 제외
  - [ ] `LAYOUT_DEPENDENT` prop은 값이 같아도 반환하지 않는다
  - [ ] baseline에만 있고 computed에 없는 키는 무시
  - [ ] `pnpm test` + `pnpm typecheck` 통과

### Task 2: `ua-baseline.ts` — iframe 수명 + tagName 캐시

- **변경 대상**: `src/content/ua-baseline.ts`(신규), `src/content/dom-describe.ts`, `src/content/scroll-capture.ts`, `scripts/coverage-report.mjs`
- **작업 내용**:
  - design.md 골자대로 `getUaBaseline` / `disposeUaBaseline` / `removeOrphanBaselineFrame` 구현.
  - **수명 정책 3가지를 코드에 반영**: `unavailable` 래치는 리셋하지 않는다 / `disposeUaBaseline()`은 iframe만 지우고 캐시는 유지한다 / **모듈 최상위에서 `document`·`INTERESTING_PROPS`를 만지지 않는다**(순환 import + node 환경 테스트 크래시 — design.md "순환 import 회피").
  - `doc.createElement(tagName)`을 try/catch로 감싼다.
  - `dom-describe.ts`의 `isRenderable` 제외 목록에 `BASELINE_HOST_ID` 추가 — 안 하면 DOM 트리 네비게이터에 뜨고 **사용자가 선택할 수 있다**(design.md 위험 4).
  - `scroll-capture.ts`의 예외 id 목록에도 추가(현재는 실해 없음 — 숨김 방식 변경 대비 예방).
  - `BROWSER_BOUND_EXACT`에 `"src/content/ua-baseline.ts"` 추가 (CLAUDE.md — 유닛 불가 런타임 파일 등재 규칙).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 통과 — 특히 **`css-resolve.test.ts`가 import 시점에 죽지 않는다**(node 환경에서 `document` 접근 여부를 이 테스트가 대신 잡는다)
  - [ ] `grep -n "ua-baseline" scripts/coverage-report.mjs`가 `BROWSER_BOUND_EXACT` 블록 안에서 1건
  - [ ] `pnpm coverage:report`의 **로직 스코프 total 라인 수가 신규 파일 라인 수만큼 늘지 않는다**(리포트는 파일별 포함/제외를 출력하지 않으므로 총량으로 확인한다)

### Task 3: 페이로드 배선 (content → store)

- **변경 대상**: `src/types/picker.ts`, `src/content/css-resolve.ts`, `src/content/picker.ts`, **`src/store/editor-store.ts`**, **`src/sidepanel/hooks/usePickerMessages.ts`**, `src/store/__tests__/editor-store.test.ts`
- **작업 내용**:
  - `PickerSelectionPayload` / `PickerSelectionUpdatePayload`에 `uaDefaultProps?: string[]` 추가. **optional 필수** — 세션 스냅샷 복원 경로가 이 필드 없이 돌아온다.
  - `collectSelection`이 `getUaBaseline(el.tagName)` → `propsMatchingBaseline`으로 채운다. **호출 위치는 `normalizePositionOffsets(...)` 이후**다 — 그 전에 넣으면 `top/right/bottom/left` 4개가 영구히 불일치한다(design.md).
  - `postSelectionUpdate`(`picker.ts:1123`)도 같은 필드를 싣는다.
  - **store 배선 4곳**(design.md 표): `EditorSelection` 필드 추가 / `onElementSelected` 나열에 추가 / `updateSelectionStyles` patch 타입 / **`mergeSelectionStyles` 반환**. 마지막 것을 빠뜨리면 `selectionUpdated` 경로에서 값이 **조용히 버려진다**.
  - `handleClear`에 `disposeUaBaseline()` 추가 (`inspectorCache = new WeakMap()` 옆, :642 근처).
  - `removeOrphanBaselineFrame()`을 **`removeOrphanOverlay()` 호출 3곳 전부**(`:593`·`:1217`·`:1252`)에, 그리고 **`if (!overlay)` 가드 밖**에 둔다. `:593`(세션 시작)을 빠뜨리면 비정상 종료 후 재진입에서 고아 iframe이 그대로 남는다.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] **단위**: `mergeSelectionStyles`가 `uaDefaultProps`를 반환한다 — patch에 있으면 갱신, 없으면 prev 유지
  - [ ] **단위**: `onElementSelected` 매핑이 `uaDefaultProps`를 포함한다(필드 나열 누락 방지 — optional이라 타입 에러가 안 난다)
  - [ ] `uaDefaultProps`를 `undefined`로 강제한 스냅샷 복원에서 패널이 정상 렌더된다
  - (UI 관측은 Task 5로 미룬다 — 이 시점엔 값이 판정에 쓰이지 않아 e2e로 볼 것이 없다)

### Task 4: 판정식 3종 → 1종 수렴 (`isDefaultValue`)

**이 태스크는 "동작 무변경"이 아니다.** 콜사이트 5곳의 판정식이 이미 2축/3축/1축으로 갈라 있어(design.md 표), 수렴하면 #3·#4에 `isInactiveBorderColor` 축이 **새로 붙는다** — 의도된 개선이므로 테스트로 고정한다. UA 축은 Task 5에서 연결한다.

- **변경 대상**: `src/sidepanel/tabs/styleEditor/propMetadata.ts`, `src/sidepanel/lib/sectionDefaultOpen.ts`, `styleEditor/ValueCombobox.tsx`, `styleEditor/StylePropEditors.tsx`, `src/sidepanel/tabs/StyleEditorPanel.tsx`, 관련 `__tests__`
- **작업 내용**:
  - `isDefaultValue(input)` 추가. 이 시점엔 `uaDefaultProps` 인자를 아무도 안 넘긴다.
  - `sectionDefaultOpen` → **`sectionActiveCount`**(number 반환)로 교체. `uaDefaultProps`는 **optional 4번째 인자** — 필수로 만들면 기존 테스트 전부가 3-인자 호출이라 즉시 깨진다. 호출부는 `StyleEditorPanel.tsx:150` 하나.
  - **빈값 가드를 잃지 않는다** — 원본은 `if (v == null || v === "" || isKnownDefault(p, v)) return false;`다. `isDefaultValue`로 치환하면서 `v == null || v === ""` 가지가 사라지면 안 된다.
  - 콜사이트 #1~#4를 교체. **#5(`AlignmentProp:362`)는 판정 축이 "미편집"뿐이라 `isDefaultValue` 대상이 아니다** — 시각 표현만 Task 7에서 통일한다.
  - **#3·#4는 드롭인이 아니다**: `isSpecified`·`computedStyles`가 스코프에 없어 `useEditorStore` 셀렉터를 추가해야 한다. #4의 `SideStyleSelect`는 `controlled` 주입 경로가 있어 `prop in specifiedStyles` 조회가 표시 중인 prop과 어긋날 수 있으니 별도로 확인한다.
  - `isKnownDefault`·`isInactiveBorderColor` export는 유지(기존 테스트가 직접 호출).
- **검증**:
  - [ ] `grep -rn "isKnownDefault\|isInactiveBorderColor" src/sidepanel | grep -v __tests__ | grep -v propMetadata.ts` 결과가 **import 라인을 포함해 0건** — import까지 제거하는 것이 전제다
  - [ ] **신규 단위**: `StylePropEditors` #3·#4 경로에서 `border-top-style: none`인 요소의 `border-top-color`가 이제 기본값으로 판정된다(가드 확산이 의도대로 붙었다는 증명)
  - [ ] 기존 `propMetadata.test.ts` 무수정 통과 / `sectionDefaultOpen.test.ts`는 **count 반환으로 시그니처가 바뀌므로 최소 수정**(`toBe(true)` → `toBeGreaterThan(0)`)만 허용, 케이스 자체는 유지
  - [ ] `pnpm test:e2e -- "style-|border-|linked-quad"` green — `border-per-side.spec.ts`·`linked-quad-merge.spec.ts`가 Border 섹션에 의존하므로 `style-` 접두만으로는 사거리를 놓친다

### Task 5: UA 축 연결

- **변경 대상**: `src/sidepanel/tabs/styleEditor/styleHooks.ts`, 콜사이트 #1~#4, `propMetadata.test.ts`
- **작업 내용**:
  - `useUaDefaultProps(): ReadonlySet<string>` 훅 추가. `useEditorStore((s) => s.selection?.uaDefaultProps)`를 읽고 `useMemo`로 `Set`을 고정한다 — 매 렌더 새 `Set`을 만들면 하위 `memo` 컴포넌트가 전부 깨진다.
  - 콜사이트가 이 훅의 결과를 `isDefaultValue`에 넘긴다. `sectionActiveCount`는 순수 함수라 `StyleEditorPanel`에서 인자로 주입한다.
  - **`isSpecified` 전달을 4곳 전부 확인한다** — 빠뜨리면 author가 명시한 값이 조용히 디밍된다(design.md 위험 5).
- **검증** — 단위 테스트 (`propMetadata.test.ts`):
  - [ ] `uaDefaultProps`에 있는 prop + `isSpecified: false` → `true`
  - [ ] `uaDefaultProps`에 있는 prop + `isSpecified: true` → `false` (author 명시가 우선)
  - [ ] `uaDefaultProps`가 `undefined` → 기존 판정과 동일 (폴백)
  - [ ] `isKnownDefault`가 true면 `isSpecified` 무관하게 `true` (기존 동작 보존)
  - [ ] `pnpm test` + `pnpm typecheck` 통과

### Task 6: 접힌 섹션 count 배지 + e2e 셀렉터 부착

접힘은 정보 소실이다(PRD S4). 이 태스크가 그 손실을 메우고, 동시에 e2e가 섹션 상태를 판정할 수단을 만든다.

- **변경 대상**: `src/sidepanel/components/.../Section.tsx`, `src/sidepanel/tabs/StyleEditorPanel.tsx`, `src/i18n/`
- **작업 내용**:
  - `sectionActiveCount`의 결과를 섹션 헤더에 배지로 노출. **0이면 배지를 렌더하지 않는다**(접힌 상태 + 배지 없음 = "볼 게 없다").
  - **`data-testid` 부착**: 현재 `testId`를 받는 섹션은 `section-class`·`section-position`·`section-table` 3개뿐이고 Transition·Border엔 없다. e2e 시나리오가 요구하는 `section-transition`·`section-border`(+ toggle)를 부착한다.
  - **디밍 상태에 `data-default="true"` 부착** — 현재 디밍은 Tailwind 클래스로만 표현되고 e2e 전체에서 `toHaveClass`를 쓰는 spec이 0건이라, 클래스로 판정하는 것은 이 저장소의 관례가 아니다.
  - i18n 키는 ko/en 동시 추가(PostToolUse 훅이 대칭을 강제).
- **검증**:
  - [ ] 단위(tsx): count가 0이면 배지가 없고, 3이면 `3`이 보인다
  - [ ] `pnpm test` 통과 (i18n 대칭 테스트 포함)

### Task 7: 접근성 저비용 2건

- **변경 대상**: `styleEditor/ValueCombobox.tsx`, `styleEditor/StylePropEditors.tsx`, `src/i18n/`
- **작업 내용**:
  - `buildTriggerTitle`(및 `title`)에 "기본값" 표기 추가 — 시각 변화 0, i18n 키 2개. 스크린리더 사용자가 기본값/명시값을 구분할 유일한 수단이다.
  - `AlignmentProp:362`의 `[&_[data-state=active]]:opacity-50` → `text-muted-foreground/50` 계열로 통일. `opacity-50`은 이 저장소에서 **disabled 신호**라(UI 프리미티브 전반 + 사이드패널 ~30곳) 활성 탭에 쓰면 축이 충돌한다.
  - 색 대비 상향(`/50` → `/70`)은 **하지 않는다** — 별건(PRD 비목표).
- **검증**:
  - [ ] 단위(tsx): 기본값 상태의 트리거 `title`에 해당 문구가 포함된다
  - [ ] `grep -rn "opacity-50" src/sidepanel/tabs/styleEditor`가 0건
  - [ ] `pnpm test` 통과

### Task 8: 회귀 테스트 고정 (POSTMORTEM 2건)

- **변경 대상**: `src/sidepanel/lib/__tests__/sectionDefaultOpen.test.ts`, `styleEditor/__tests__/propMetadata.test.ts`
- **작업 내용**: 두 회고를 **각각 다른 방식으로** 못 박는다.
  1. **테이블 미등록 prop (2026-06-29 계열)** — `transition-*` 4개는 **이미 `KNOWN_DEFAULTS`에 등록돼 있어** `isKnownDefault`가 먼저 `true`를 돌려주므로 UA 축의 증명이 원리상 불가능하다. 게다가 `KNOWN_DEFAULTS`는 export되지 않아 "뺀 상태"를 만들 수도 없다. → **테이블에 실제로 없는 prop(`animation-name`·`animation-duration` 등)으로 케이스를 짠다.** 같은 함정의 같은 계열이고, 이게 "테이블 등록을 잊어도 안 터진다"의 증명이다.
     ```ts
     // POSTMORTEM 2026-06-29 계열 회귀 — transition-*는 이미 테이블에 있으므로
     // 동일 함정의 미등록 prop으로 고정한다.
     expect(sectionActiveCount(
       ["animation-name", "animation-duration"],
       {},                                                    // specified 없음
       { "animation-name": "none", "animation-duration": "0s" },
       new Set(["animation-name", "animation-duration"]),
     )).toBe(0);
     ```
  2. **유령 border-color (2026-06-28)** — `uaDefaultProps`에 `border-top-color`가 **없고**(기준선 글자색 ≠ 페이지 글자색) `border-top-style: none`일 때 여전히 `isInactiveBorderColor`가 잡아 `true`가 된다. **UA 축이 이 케이스를 못 잡는다는 무능력 자체를 테스트로 고정**한다 — 다음 리팩터에서 `isInactiveBorderColor` 삭제를 막는 것이 이 테스트의 목적이다.
- **검증**:
  - [ ] 두 케이스가 테스트로 존재하고 통과
  - [ ] 각 테스트에 POSTMORTEM 날짜를 주석으로 남긴다

### Task 9: 실측 덤프 (수동, 목록 확정)

`LAYOUT_DEPENDENT`의 근거를 만드는 작업이다. 상수를 상수로 검증하는 테스트는 목록이 **틀렸을 때** 아무것도 못 잡는다(design.md 위험 3).

- **작업 내용**: 실제 Chrome에서 기준선 iframe의 `INTERESTING_PROPS` **79개 전체**를 덤프하고 같은 태그의 실제 페이지 요소 computed와 대조한다. `display:none` 문서에서 무의미해지는 prop이 width/height류 외에 있는지(offset `auto`, `line-height: normal`, flex 계열 등) 전수 확인한다.
- **검증**:
  - [ ] 덤프 결과 표를 design.md 위험 3에 붙인다
  - [ ] `LAYOUT_DEPENDENT` 목록을 그 결과로 확정하고, 잠정 표기를 제거한다

---

## 테스트 계획

### 단위 테스트

| 대상 | 파일 | 케이스 |
|---|---|---|
| `propsMatchingBaseline` | `content/__tests__/css-resolve.test.ts` | Task 1 검증 5건 |
| `mergeSelectionStyles` / `onElementSelected` | `store/__tests__/editor-store.test.ts` | Task 3 배선 2건 |
| `isDefaultValue` | `styleEditor/__tests__/propMetadata.test.ts` | Task 5 검증 4건 + Task 4 가드 확산 1건 |
| `sectionActiveCount` | `lib/__tests__/sectionDefaultOpen.test.ts` | Task 8 회귀 2건 + 기존 케이스(count로 최소 수정) |
| count 배지 / title 표기 | 해당 `*.test.tsx` | Task 6·7 각 1건 |

`getUaBaseline`은 jsdom의 iframe `contentDocument`가 실제 UA 스타일을 재현하지 않아 **유닛 대상이 아니다**. e2e와 수동이 그물이다.

### e2e 시나리오 (`/e2e-write`의 입력)

신규 spec `e2e/style-ua-baseline.spec.ts`. fixture는 `e2e/fixtures/pages/basic.html`에 요소를 추가하거나 신규 페이지를 둔다. **Task 6의 `data-testid`·`data-default` 부착이 선행 조건이다.**

1. transition이 전혀 없는 요소를 선택하면 `[data-testid="section-transition"]`이 **접힌 상태**로 뜬다.
2. `transition: opacity 200ms`가 걸린 요소를 선택하면 같은 섹션이 **펼쳐진 상태**로 뜬다.
3. `border` 선언이 전혀 없는 요소를 선택하면 `section-border`가 접히고, border-color 필드가 `data-default="true"`다.
4. picker 세션 진입 → **top 요소 1개 + 1-depth iframe 자식 요소 1개**를 선택 → 세션 종료 후 **top 문서와 자식 프레임 문서 양쪽에** `#__bugshot_ua_baseline__`가 없다. (fixture `iframe.html`·`iframe-child.html` 실재)
5. `uaDefaultProps`가 `undefined`인 세션 스냅샷에서 복원하면 섹션 펼침이 **변경 전과 같다**(폴백 경로 — CSP fixture 대신 이쪽으로 검증한다. design.md 위험 1).
6. `cross-origin.html`(2 origin) fixture에서 picker 세션을 태우고, 로그 origin 필터에 **`data-origin="__unknown__"`가 나타나지 않는다**. (`about:blank`는 `originKey()`가 `__unknown__`로 접으므로 그 문자열을 봐야 한다. 단일 origin fixture는 `OriginFilterBar`가 아예 렌더되지 않아 공허한 green이 된다.)
7. 섹션을 **수동으로 편 뒤** 값을 편집해도 그 섹션이 닫히지 않는다(design.md 위험 8 — `Section`의 `defaultOpen` 강제 동기화).
8. DOM 트리 네비게이터에 `#__bugshot_ua_baseline__`가 항목으로 뜨지 않는다(design.md 위험 4).
9. 기본값과 다른 prop이 3개인 섹션이 접힌 채로 뜨면 헤더에 `3`이 보이고, 0개면 배지가 없다.

### 수동 테스트 (Chrome)

`/build` 실행 후 진행한다 — dist가 stale이면 헛테스트다. (CLAUDE.md: 빌드는 사용자가 명시 요청하거나 `/build`를 실행할 때만.)

- [ ] `<table>`/`<td>`/`<li>`/`<input>`/`<svg>` 선택 시 — **`<div>`에선 Table 섹션이 접히고 `<table>`에선 펼쳐진다**
- [ ] 커스텀 엘리먼트(`<my-widget>`) 선택 시 콘솔 에러 0건, 패널 정상 렌더
- [ ] 같은 태그 5회 연속 선택 — `#__bugshot_ua_baseline__` 개수가 **1**이고, 2회차부터 baseline 계산이 캐시 히트다(`performance.mark` 또는 임시 로그로 확인)
- [ ] `notion.so` 등 CSP가 빡빡한 사이트 — 콘솔 CSP violation이 **0건 또는 정확히 1건**(1건이면 `unavailable` 래치가 재시도를 막았다는 증명)
- [ ] picker 세션 중 페이지 렌더가 변하지 않고, 캡처한 스크린샷에 빈 프레임 흔적이 없다
- [ ] `chrome.scripting.executeScript({allFrames:true})` 경로에서 기준선 iframe에 picker/recorder가 주입되는지, `webNavigation.onCommitted`가 이 프레임에 발화해 `restartPickerInFrame` 재시도가 도는지 (design.md 위험 6 — **실측으로만 확정 가능**)
- [ ] Task 9의 `INTERESTING_PROPS` 79개 전체 덤프·대조

## 구현 순서 권장

```
Task 1 (순수 비교)  ┐
                    ├─► Task 3 (배선) ──► Task 5 (UA 축) ──► Task 6 (배지·testid) ──► Task 7 (a11y)
Task 2 (iframe)     ┘                 ▲
                                      │
Task 4 (판정식 수렴) ─────────────────┘
                    └─► Task 8 케이스 2 (border 무능력 고정)
Task 5 ─────────────► Task 8 케이스 1 (미등록 prop)
Task 9 (실측) ──────► Task 1의 LAYOUT_DEPENDENT 확정
```

- **Task 1·2·4는 서로 독립** — 병렬 가능. 4는 content script를 전혀 안 건드린다.
- **Task 4를 별도 커밋으로 끊는다.** 무변경 리팩터는 아니지만(#3·#4에 가드가 붙는다) 그 변화가 UA 축과 섞이지 않게 분리해야, Task 5 이후 회귀가 어느 쪽에서 왔는지 판정할 수 있다.
- Task 3은 1·2 둘 다 필요. Task 5는 3·4 둘 다 필요.
- **Task 8 케이스 2는 Task 4까지만 있으면 된다** — Task 5에 의존하지 않는다.

## 가이드 영향

**없음.** 사용자 노출 문자열은 count 배지와 "기본값" title 표기 2개가 늘지만 조작 방식은 그대로다 — 같은 화면에서 섹션 펼침과 값 디밍이 더 정확해질 뿐이다.

`docs/privacy.{ko,en}.md`는 **대조 대상이다.** 새 캡처·수집·전송은 없지만 `about:blank` iframe을 페이지에 삽입하는 **새 DOM 동작**이 생긴다. 프라이버시 문서는 "권한 문자열이 아니라 실제 동작에 묶인다"(CLAUDE.md)는 규칙이 있으므로, 구현 후 다음을 확인해 기록한다: 이 iframe은 `src`가 없어 네트워크 요청을 하지 않고, 페이지 콘텐츠를 복사하지 않으며(`innerHTML` 미복사 — 명시적 설계 결정), 세션 종료 시 제거된다. **대조 결과 갱신 불필요라고 판단되면 그 판단 자체를 커밋 메시지에 남긴다.**

## 문서 갱신

- **`e2e/COVERAGE.md`** — 신규 spec `style-ua-baseline.spec.ts` 행 추가(README가 요구).
- **`docs/CI.md`** — 하드코딩된 spec/테스트 개수가 stale이 되므로 함께 갱신.
