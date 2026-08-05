# CSS 캐스케이드 충실도 — 기술 설계

## 개요

cross-origin 스타일시트의 원문을 자체 IR로 파싱하는 대신, **`new CSSStyleSheet()` + `replaceSync(text)`로 브라우저 CSSOM에 되먹여** `CSSStyleRule` 객체를 얻는다. 이 "shadow sheet"를 원본(접근 불가) 시트의 **문서 순서 자리에 대입**하면 기존 인덱서·조건 평가기·specificity 판정기가 그대로 cross-origin 규칙에 적용된다. 두 번째 축으로, `selectorSpecificity`가 `null`로 던지던 `:is()/:not()/:has()`를 자체 토크나이저 재귀로 확정한다 — 이 셋의 specificity는 "인자 중 최대"라는 **순수 구문 규칙**이라 매칭 판정이 필요 없다.

핵심 안전 전제: **shadow sheet를 `document.adoptedStyleSheets`에 넣지 않는다.** 구성된 스타일시트는 adopt 되기 전까지 렌더링에 아무 영향이 없다. 우리는 `cssRules`를 읽기만 한다.

## 변경 범위

### `src/content/css-source-cache.ts` (핵심)

현재 역할: 스타일시트 원문 확보(same-origin fetch + raw 파싱 + CSSOM 정렬), 규칙 인덱싱, cross-origin 별도 IR 관리.

변경:

1. **shadow 레지스트리 + 단일 접근자 추가**
   ```ts
   // cross-origin 시트의 CSSOM 대역. 원본 시트를 키로 잡아 문서 순서 자리를 유지한다.
   // adoptedStyleSheets에 넣지 않으므로 페이지 렌더에 영향이 없다 — 읽기 전용 대역이다.
   const sheetShadows = new Map<CSSStyleSheet, CSSStyleSheet>();

   // 시트의 규칙 목록. cross-origin이면 shadow로 폴백하고, 둘 다 없으면 null.
   // cssRules를 직접 만지는 곳은 전부 이 함수를 거친다 — 폴백을 손으로 복제하면
   // 한 곳만 고쳐져 드리프트한다(POSTMORTEM 2026-06-28 계열).
   function resolveSheetRules(sheet: CSSStyleSheet): CSSRuleList | null;
   ```

2. **`buildRuleIndex`(:136-143) 교체** — `try { sheet.cssRules } catch {}`를 `resolveSheetRules(sheet)`로. cross-origin 규칙이 same-origin과 **한 seq 축**에 들어간다. 이것만으로 인덱싱·`@media`/`@supports` 조건 평가(`walkRulesForIndex`)·source order가 전부 붙는다.

3. **`loadCrossOrigin` 재작성** — 파싱/인덱싱 대신 shadow 주입:
   ```ts
   async function loadCrossOrigin(startedEpoch: number): Promise<void> {
     const targets = collectInaccessibleSheets();          // [{sheet, href}]
     if (targets.length === 0) return;
     if (typeof CSSStyleSheet === "undefined") return;
     let sheets: Array<{ url: string; text: string }>;
     try {
       ({ sheets } = await sendBg({ type: "css.fetchSheets", urls: targets.map(t => t.href) }));
     } catch { return; }
     if (isStaleLoad(startedEpoch)) return;
     const byUrl = new Map(sheets.map(s => [s.url, s.text]));
     let injected = 0;
     for (const { sheet, href } of targets) {
       const text = byUrl.get(href);
       if (text == null) continue;
       let shadow: CSSStyleSheet;
       try {
         shadow = new CSSStyleSheet();
         shadow.replaceSync(text);
       } catch { continue; }                                // 구문 파손 시트만 skip
       sheetShadows.set(sheet, shadow);
       alignAndStore(shadow, text, "cross-origin");         // raw 선언 맵도 그대로 확보
       injected++;
     }
     if (injected > 0) ruleIndex = null;                    // 다음 조회에서 재구축
   }
   ```
   `collectCrossOriginHrefs`는 `collectInaccessibleSheets`로 대체한다 — **origin 비교가 아니라 `cssRules` 접근 성공 여부**가 기준이 된다. origin이 달라도 CORS로 열리는 시트가 있고(그건 오늘도 same-origin 경로가 처리 중), origin이 같아도 못 여는 경우가 없으므로 판정을 실제 접근성으로 옮기는 게 정확하다.

4. **`collectTokens` 소비처 정렬** — `css-resolve.ts:423-430`의 동일한 `try/catch` 루프도 `resolveSheetRules`를 쓰도록 접근자를 export한다. cross-origin 시트의 `--*` 정의가 토큰 드롭다운에 정상 유입된다.

5. **삭제**: `CrossOriginRule` / `CrossOriginIndexedRule` / `indexCrossOriginRules` / `crossOriginRules` / `crossOriginCustomPropRules` / `crossOriginCustomProps` / `getMatchingCrossOriginRules` / `getMatchingCrossOriginCustomPropRules` / `getCrossOriginCustomProps` / `matchCrossOriginRules` / `hasGlobalCustomPropSelector` / `GLOBAL_CUSTOM_PROP_SELECTORS`.

6. **`invalidate()` 갱신** — `crossOrigin*` 초기화 3줄을 `sheetShadows.clear()`로 교체.

> **`parseStylesheet` / `parseRulesFrom` / `stripComments` / `parseDeclBlock`은 남긴다.** 이들은 cross-origin 전용이 아니라 same-origin raw 원문 정렬(`alignAndStore`)의 파서이고, `var()`가 낀 shorthand의 유일한 specified 출처다(CLAUDE.md). 이번 변경으로 **호출자가 늘어난다**(shadow 시트도 같은 정렬을 탄다).

### `src/content/css-resolve.ts`

현재 역할: 캐스케이드 판정, specified 수집, shorthand 전개, 토큰 수집.

변경:

1. **`collectRulesForElement`(:827-839)에서 cross-origin 블록 삭제** — `mergeCrossOriginDecls` 호출과 `crossProps` 지역변수를 지운다. cross-origin 규칙은 이제 `getMatchingRules(el)`이 돌려주는 `matched` 루프에 들어와 있다.
2. **`mergeCrossOriginDecls`(:846-887) 삭제.**
3. **`allStyleSheets`(:775) / `collectTokens`(:423)** — `resolveSheetRules` 경유로 교체.
4. **`selectorSpecificity`(:1087) 재귀 확장** — 아래 인터페이스 절 참조.

### `src/content/__tests__/css-resolve.test.ts`

`mergeCrossOriginDecls` 관련 케이스 삭제, `selectorSpecificity` 재귀 케이스 추가. (`mergeCrossOriginTokens` 테스트도 함수와 함께 정리.)

### 변경 없음

`src/background/messages.ts`(`css.fetchSheets` 핸들러), `src/lib/ssrf-guard.ts`, `src/types/picker.ts`, 사이드패널 전체.

## 데이터 흐름

### 현재

```
picker.selected (1차: same-origin + inline)
      │
      └─ ensureCrossOriginLoaded()
            │  collectCrossOriginHrefs()  ← origin != location.origin 인 link 시트
            │  sendBg("css.fetchSheets")  ← SSRF 가드 + 캡
            │  parseStylesheet(text) ──────────────┐  자체 IR
            │  indexCrossOriginRules()             │  (조건 미평가, specificity 없음)
            ▼                                      ▼
      picker.selectionUpdated ← collectRulesForElement
                                  ├─ getMatchingRules(el)      [CSSOM 경로]
                                  ├─ el.style                  [inline]
                                  └─ mergeCrossOriginDecls()   [gap-fill 강등]
```

### 변경 후

```
picker.selected (1차: same-origin + inline)
      │
      └─ ensureCrossOriginLoaded()
            │  collectInaccessibleSheets()  ← cssRules 접근이 throw 하는 시트
            │  sendBg("css.fetchSheets")    ← 가드·캡 그대로
            │  new CSSStyleSheet().replaceSync(text)   ← adopt 안 함
            │  sheetShadows.set(원본시트, shadow)
            │  alignAndStore(shadow, text)             ← raw 선언 맵
            │  ruleIndex = null                        ← 재구축 예약
            ▼
      picker.selectionUpdated ← collectRulesForElement
                                  ├─ getMatchingRules(el)   [단일 경로]
                                  │    └─ buildRuleIndex → resolveSheetRules(sheet)
                                  │         └─ walkRulesForIndex  (@media/@supports 평가)
                                  └─ el.style               [inline]
```

seq 축이 하나가 되므로 `matched.sort((a,b) => a.seq - b.seq)`가 문서 순서를 그대로 표현한다. 오늘은 cross-origin이 seq 축 밖(별도 배열)이라 표현할 수 없던 것이다.

## 인터페이스 설계

```ts
// src/content/css-source-cache.ts

/**
 * 시트의 규칙 목록. cross-origin이라 cssRules가 throw 하면 shadow sheet로 폴백한다.
 * 원본·shadow 둘 다 못 읽으면 null.
 */
export function resolveSheetRules(sheet: CSSStyleSheet): CSSRuleList | null;

/** cssRules 접근이 막힌(= 보강 fetch 대상) 시트와 그 href. */
function collectInaccessibleSheets(): Array<{ sheet: CSSStyleSheet; href: string }>;
```

```ts
// src/content/css-resolve.ts

/**
 * 단일 셀렉터의 specificity. 판정 불가면 null(uncertain → computed 폴백).
 *
 * :is()/:not()/:has() 및 :nth-child(An+B of S)는 "인자 중 최대"가 가산되는데,
 * 이건 매칭 여부와 무관한 **순수 구문 규칙**(Selectors 4)이라 재귀로 확정할 수 있다.
 * 인자 하나라도 판정 불가면 전체를 null로 되돌린다 — 부분 확정은 오답을 만든다.
 */
export function selectorSpecificity(selector: string): Specificity | null;
```

재귀 구현 골자 (기존 `skipBalanced`·`splitSelectorList` 재사용, 신규 의존성 0):

```ts
const MAX_SELECTOR_DEPTH = 8;   // 병리적 중첩 방어

function maxArgSpecificity(args: string, depth: number): Specificity | null {
  if (depth > MAX_SELECTOR_DEPTH) return null;
  let best: Specificity | null = null;
  for (const part of splitSelectorList(args)) {
    const spec = specificityAt(part, depth + 1);
    if (spec === null) return null;                       // 하나라도 모르면 전체 uncertain
    if (best === null || compareSpecificity(spec, best) > 0) best = spec;
  }
  return best ?? [0, 0, 0];                               // 빈 인자 목록 = 0 기여
}
```

`ARG_MAX_PSEUDOS = new Set(["is","not","has","matches","-webkit-any","-moz-any","any"])`로 교체하고, `:nth-child`/`:nth-last-child`의 `of S`는 `of` 뒤 부분을 `maxArgSpecificity`에 넘긴 뒤 `b++`를 함께 가산한다.

**유지되는 null(uncertain)**: `&`(부모 문맥 필요), `|`(네임스페이스), `::part()`/`::slotted()`(shadow 경계), `:host`/`:host-context`(document 시트 순회 범위 밖 — 방어적 유지), 미폐합 괄호, depth 초과.

## 기존 패턴 준수

- **화이트리스트 우선 (CLAUDE.md / POSTMORTEM 2026-07-31)** — `hasOpaqueCascadeContext`의 `TRANSPARENT_GROUP_RULES`는 그대로 둔다. shadow sheet 안의 `@layer`/`@container` 규칙은 자동으로 opaque 판정을 받아 uncertain이 된다. 이건 회귀가 아니라 **오늘의 잘못된 확정이 고쳐지는 것**이다.
- **잘못된 확정 < uncertain** — specificity 재귀에서 인자 하나라도 모르면 전체를 `null`로 되돌린다. 부분 계산으로 그럴듯한 오답을 만들지 않는다.
- **가드 복제 금지 (POSTMORTEM 2026-06-28)** — `cssRules` 접근 폴백을 `resolveSheetRules` 한 곳에만 둔다. 호출부 4곳(`buildRuleIndex`·`collectTokens`·`allStyleSheets` 소비처)이 전부 이 함수를 거친다.
- **pre-arm 청크 제약 (CLAUDE.md)** — `css-resolve.ts`/`css-source-cache.ts`는 `picker.ts`만 import하고 `recorders-entry.ts` 그래프와 무관하다(`grep`으로 확인). 신규 의존성이 0개라 `check:prearm`에 영향이 없지만, 태스크에 검증을 넣는다.
- **테스트 우선 (CLAUDE.md)** — `selectorSpecificity` 재귀는 순수 함수라 유닛이 정본. cross-origin 통일은 브라우저 실동작이라 e2e가 유일한 그물.

## 대안 검토

### A1. `@bramus/specificity` 라이브러리 도입 (브리프 #8의 원안) — 기각

브리프는 라이브러리 도입을 권했지만 기각한다.

- **번들 비용이 프레임 단위로 곱해진다.** `css-resolve.ts`는 `picker.ts`가 import하고 picker는 `all_frames: true` content script다. `@bramus/specificity`는 `css-tree`(파서·lexer·패치 데이터) 전체를 끌고 온다 — 모든 페이지의 모든 프레임에서 파싱된다.
- **필요한 게 그 라이브러리의 일부뿐이다.** `:is/:not/:has`의 "인자 중 최대"는 순수 구문 규칙이고, 우리 토크나이저엔 이미 `skipBalanced`(중첩 괄호·따옴표 인식)와 `splitSelectorList`가 있다. 재귀 한 겹이면 된다.
- **`minimumReleaseAge: 1440` 정책**과 공급망 표면이 추가된다.
- 기존 `selectorSpecificity`엔 **이 코드베이스에서만 나온 방어**가 박혀 있다 — Chrome CSSOM이 Tailwind 클래스를 `.\32 xl\:mt-4`로 직렬화하는 hex 이스케이프 처리(`skipEscape`)가 그것이다. 라이브러리로 갈아끼우면 이 케이스를 재검증해야 한다.

### A2. `mergeCrossOriginDecls`에 specificity·조건 평가를 직접 추가 — 기각

두 벌 유지를 인정하고 기능만 맞추는 방향. 조건 평가를 위해 `@media` 컨텍스트를 자체 IR에 싣고, `matchedSpecificity`를 자체 IR에도 붙이고, `@layer` 감지도 복제해야 한다. **드리프트 원인을 그대로 두고 표면만 늘린다** — POSTMORTEM 2026-06-28이 정확히 이 패턴의 실패 기록이다.

### A3. shadow sheet를 `adoptedStyleSheets`에 넣어 실제 적용 — 기각

`replaceSync` 결과를 adopt하면 `getComputedStyle`까지 통일된다는 발상. **페이지 렌더링을 우리가 바꾸게 되므로 절대 금지.** 이미 적용 중인 시트를 한 번 더 적용하면 캐스케이드 순서가 바뀌어 화면이 깨지고, before/after 스냅샷이 오염된다.

### A4. `style.cssText`를 shorthand 원문 소스로 (브리프 #2) — 보류, 검증 태스크로 분리

`tasks.md`의 Task 0 참조. 전제가 실측 미검증이라 게이트를 통과해야만 후속을 연다.

## 위험 요소

1. **`replaceSync`의 동기 파싱 비용** — 최대 50장 × 2MB. 네이티브 파서라 현행 JS `parseStylesheet`보다 빠를 것으로 보이지만 **메인 스레드 동기 작업**이다. 실측 필요(Task 2 검증 항목). 캡을 넘는 지연이 관측되면 시트당 `await new Promise(r => setTimeout(r, 0))`로 양보를 끼운다.

2. **`@layer` 회귀처럼 보이는 변화 (E5)** — cross-origin 시트가 `@layer`를 쓰면 오늘은 gap-fill로 값이 뜨지만 변경 후엔 opaque 판정 → uncertain → computed 폴백이 된다. **사용자에겐 "저자 원문이 리터럴로 바뀌었다"로 보인다.** 의도된 정확도 향상이지만 회귀로 오인될 수 있으니 커밋 메시지와 POSTMORTEM에 남긴다.

3. **specificity 확정 확대의 양날** — `:is()` 등이 확정되면서 **오늘 uncertain(computed 폴백)이던 prop이 저자 원문으로 바뀐다.** 재귀에 버그가 있으면 "그럴듯한 오답"이 되고, computed 폴백보다 해롭다(POSTMORTEM 원칙). 유닛 테스트를 사양 문서(Selectors 4) 예제로 채워 고정한다.

4. **`alignAndStore`의 셀렉터 정렬 실패** — shadow의 `cssRules`와 우리 파서 결과를 `normalizeSelector` 키로 맞추는데, Chrome이 셀렉터를 재직렬화하면 키가 어긋나 raw 선언이 안 붙는다(`missed` 카운트). 이건 same-origin에서 이미 감수 중인 위험이고 `dlog("aligned", …)`로 관측 가능하다. shadow 경로에서 `missed` 비율이 same-origin과 크게 다르면 조사한다.

5. **`collectInaccessibleSheets`가 same-origin 실패 시트까지 잡을 수 있다** — 예: `<style>` 태그인데 CSP로 파싱 실패. fetch할 href가 없으면 자동 제외되므로 실해는 없다(`href` 필수).

6. **테스트 불가 영역** — CLAUDE.md 명시대로 이 영역은 유닛으로 못 고정한다. `e2e/style-cross-origin-section.spec.ts`와 신규 spec이 유일한 그물이다. e2e fixture 서버의 `.css`는 반드시 `text/css`로 서빙해야 한다(strict MIME 거부 — POSTMORTEM 2026-06-27).
