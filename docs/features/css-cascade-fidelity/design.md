# CSS 캐스케이드 충실도 — 기술 설계

## 개요

cross-origin 스타일시트의 원문을 자체 IR로 파싱하는 대신, **`new CSSStyleSheet()` + `replaceSync(text)`로 브라우저 CSSOM에 되먹여** `CSSStyleRule` 객체를 얻는다. 이 "shadow sheet"를 원본(접근 불가) 시트의 **문서 순서 자리에 대입**하면 기존 인덱서·조건 평가기·specificity 판정기가 그대로 cross-origin 규칙에 적용된다. 두 번째 축으로, `selectorSpecificity`가 `null`로 던지던 `:is()/:not()/:has()`를 자체 토크나이저 재귀로 확정한다 — 이 셋의 specificity는 "인자 중 최대"라는 **순수 구문 규칙**이라 매칭 판정이 필요 없다.

핵심 안전 전제: **shadow sheet를 `document.adoptedStyleSheets`에 넣지 않는다.** 구성된 스타일시트는 adopt 되기 전까지 렌더링에 아무 영향이 없다. 우리는 `cssRules`를 읽기만 한다.

검증된 전제(코드 확인 완료): **`walkRulesForIndex`(`css-source-cache.ts:153-186`)는 치환 안전하다.** `conditionText` + `matchMedia`/`CSS.supports`만 쓰고 `parentStyleSheet`·`ownerNode`·`href`를 일절 만지지 않으며, seq를 규칙 층에서 발급하므로 문서 순서가 그대로 보존된다. 이 설계 전체가 이 사실 위에 서 있다.

## 변경 범위

### `src/content/css-source-cache.ts` (핵심)

현재 역할: 스타일시트 원문 확보(same-origin fetch + raw 파싱 + CSSOM 정렬), 규칙 인덱싱, cross-origin 별도 IR 관리.

변경:

1. **shadow 레지스트리 + 단일 접근자 추가**
   ```ts
   // cross-origin 시트의 CSSOM 대역. 원본 시트를 키로 잡아 문서 순서 자리를 유지한다.
   // adoptedStyleSheets에 넣지 않으므로 페이지 렌더에 영향이 없다 — 읽기 전용 대역이다.
   //
   // WeakMap인 이유: 모든 조회가 collectAllSheets()에서 갓 얻은 시트 객체 기준이라
   // 약참조로 잃는 게 없다. Map이면 link.href 교체(테마 전환)로 버려진 옛 CSSStyleSheet가
   // strong key로 영구 고착된다 — MutationObserver가 attributes를 안 보므로 invalidate도 안 온다.
   const sheetShadows = new WeakMap<CSSStyleSheet, CSSStyleSheet>();

   // 시트의 규칙 목록. cross-origin이면 shadow로 폴백하고, 둘 다 없으면 null.
   // cssRules를 직접 만지는 곳은 전부 이 함수를 거친다 — 폴백을 손으로 복제하면
   // 한 곳만 고쳐져 드리프트한다(POSTMORTEM 2026-06-28 계열).
   function resolveSheetRules(sheet: CSSStyleSheet): CSSRuleList | null;
   ```

2. **`buildRuleIndex`(:136-143) 안쪽 접근만 교체** — `try { … } catch {}` 블록은 **그대로 둔다.** 현행 `try`는 `cssRules` 접근만이 아니라 `walkRulesForIndex` **전체 순회**를 감싸고 있고(nested `cssRules`·`selectorText`가 walk 내부에서 throw할 수 있다), 접근자로만 바꾸면 그 throw가 `getMatchingRules` → `collectRulesForElement`까지 전파돼 선택 전체가 깨진다. 교체하는 것은 `try` 안의 `sheet.cssRules` 한 줄뿐이다.

   이것만으로 cross-origin 규칙이 same-origin과 **한 seq 축**에 들어가고, 인덱싱·`@media`/`@supports` 조건 평가·source order가 전부 붙는다.

3. **`loadCrossOrigin` 재작성** — 파싱/인덱싱 대신 shadow 주입:
   ```ts
   async function loadCrossOrigin(startedEpoch: number): Promise<void> {
     const targets = collectShadowTargets();               // [{sheet, href}] — 아래 판정 2축 참조
     if (targets.length === 0) return;
     if (typeof CSSStyleSheet === "undefined") return;
     const urls = [...new Set(targets.map(t => t.href))];  // dedup — 같은 href를 가리키는 <link> 2개가
                                                           // MAX_SHEETS(50) 캡을 두 번 갉는 걸 막는다
     let sheets: Array<{ url: string; text: string }>;
     try {
       ({ sheets } = await sendBg({ type: "css.fetchSheets", urls }));
     } catch (e) {
       dlog("cross-origin fetch failed", e);               // E1: 오늘은 완전 무음이라 진단 불가
       return;
     }
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
       if (shadow.cssRules.length === 0) continue;          // @import만 있는 매니페스트 시트 —
                                                            // replaceSync가 @import를 드롭해 빈 shadow가 된다.
                                                            // 넣어봐야 전면 재빌드만 유발한다.
       sheetShadows.set(sheet, shadow);
       alignAndStore(shadow, text, "cross-origin");         // raw 선언 맵도 그대로 확보
       injected++;
     }
     if (injected > 0) ruleIndex = null;                    // 다음 조회에서 재구축
   }
   ```

4. **fetch 대상 판정을 2축으로 분리** — `collectCrossOriginHrefs`를 그냥 "접근 실패" 기준으로 바꾸면 안 된다. 두 요구가 서로 다른 집합을 가리키기 때문이다.

   | 필요 | 판정 | 이유 |
   |---|---|---|
   | **shadow 필요** | `cssRules` 접근 실패 + `href` 존재 | CSSOM 대역이 없어야만 만든다 |
   | **raw 텍스트 필요** | `href`가 non-same-origin | `fetchSheetText`(`css-source-cache.ts:550-554`)가 `url.origin !== location.origin`이면 즉시 `null`을 돌려준다 — cross-origin 시트의 raw는 **background 경로로만** 온다 |

   두 집합은 **CORS로 열리는 cross-origin 시트**에서 갈린다. 그런 시트는 `cssRules`가 읽히므로 shadow는 불필요하지만, raw 텍스트는 여전히 background fetch가 유일한 출처다. 접근성 기준 하나로 통합하면 이런 시트가 fetch 대상에서 빠져 `ruleToRaw`가 영영 비고, **`var()`가 낀 shorthand의 specified가 손실**된다(이 파서의 존재 이유 자체가 그것이다 — 아래 인용 참조).

   ~~`collectInaccessibleSheets`~~ 대신 `collectShadowTargets()`(shadow 축)와 기존 raw 축을 **각각 유지**하고, background에 보내는 URL 목록은 두 집합의 합집합으로 만든다.

   추가로 **원본 시트에서 `media`/`disabled`를 읽어 비활성 시트를 제외한다.** `<link media="print">`나 `link.disabled = true`인 cross-origin 시트는 오늘은 gap-fill이라 구멍만 채워 무해하지만, 변경 후엔 정상 경쟁해 **same-origin을 이긴다.** shadow는 `media`가 비고 `disabled`가 `false`라 나중에 복구할 수 없으므로 `collectShadowTargets` 시점에 원본에서 판정해야 한다. (참고: 코드베이스의 유일한 media 게이트는 `isActiveImport`(`:471-486`)이고 `CSSImportRule` 전용이다.)

5. **`collectTokens` 소비처 정렬** — `css-resolve.ts:421`의 동일한 `try/catch` 루프도 `resolveSheetRules`를 쓰도록 접근자를 export한다(여기도 `try`는 유지 — 내부에 재귀 `collectFromRules`가 있다).

   **단, 스코프 필터는 유지한다.** 오늘 cross-origin custom property는 `GLOBAL_CUSTOM_PROP_SELECTORS`(`:root`/`html`/`*`, `:968-975`)로 걸러진다. 이 필터 없이 shadow의 전 규칙에서 `--*`를 긁으면 Tailwind/Bootstrap CDN에서 `--tw-*` 수백 개가 토큰 드롭다운에 유입된다. `ARCHITECTURE.md`가 현 경계를 "의도된 범위 / 수용된 한계"로 기록 중이고, PRD G5(UI 무변경)와도 직결된다 — cross-origin 시트에도 같은 전역 스코프 판정을 적용한다.

6. **삭제**: `CrossOriginRule` / `CrossOriginIndexedRule` / `indexCrossOriginRules` / `crossOriginRules` / `crossOriginCustomPropRules` / `crossOriginCustomProps` / `getMatchingCrossOriginRules` / `getMatchingCrossOriginCustomPropRules` / `getCrossOriginCustomProps` / `matchCrossOriginRules`.

   > **`hasGlobalCustomPropSelector` / `GLOBAL_CUSTOM_PROP_SELECTORS`는 삭제하지 않는다** — 위 5번의 스코프 필터로 재사용한다.

7. **`invalidate()` 갱신 — 4줄 중 3줄만 교체한다.**
   ```ts
   crossOriginRules = [];              // ┐
   crossOriginCustomPropRules = [];    // ├─ 이 3줄만 제거 (sheetShadows는 WeakMap이라 clear 불필요)
   crossOriginCustomProps = {};        // ┘
   crossLoadPromise = null;            // ★ 반드시 유지 — ensureCrossOriginLoaded(:1013-1017)의 멱등 래치다.
                                       //   지우면 MutationObserver invalidate(:363-379) 이후 옛 promise가
                                       //   반환돼 cross-origin 재로드가 영구 차단된다.
   ```

> **`parseStylesheet` / `parseRulesFrom` / `stripComments` / `parseDeclBlock`은 남긴다.** 이들은 cross-origin 전용이 아니라 same-origin raw 원문 정렬(`alignAndStore`)의 파서이고, `var()`가 낀 shorthand의 유일한 specified 출처다(CLAUDE.md). 이번 변경으로 **호출자가 늘어난다**(shadow 시트도 같은 정렬을 탄다).

### `src/content/css-resolve.ts`

현재 역할: 캐스케이드 판정, specified 수집, shorthand 전개, 토큰 수집.

변경:

1. **`collectRulesForElement`(:827-839)에서 cross-origin 블록 삭제** — `mergeCrossOriginDecls` 호출과 `crossProps` 지역변수를 지운다. cross-origin 규칙은 이제 `getMatchingRules(el)`이 돌려주는 `matched` 루프에 들어와 있다.
2. **`mergeCrossOriginDecls`(:846-887) 삭제.** `mergeCrossOriginTokens`도 고아가 되면 함께 제거.
3. **`collectTokens`(:421)** — `resolveSheetRules` 경유로 교체(스코프 필터는 유지, 위 참조). `allStyleSheets`(:775-781)는 **`cssRules`를 읽지 않으므로**(`flattenSheets`에 위임해 시트 집합만 만든다) 교체 대상이 아니다.
4. **`hasOpaqueCascadeContext`의 `@layer` 감지에 shadow 축 추가** — 아래 "shadow 시트의 `@layer` 구멍" 참조.
5. **`selectorSpecificity`(:1087) 재귀 확장** — 아래 인터페이스 절 참조. **선행 조건: 토크나이저 하드닝**(같은 절).

### `src/content/__tests__/css-resolve.test.ts` · `css-source-cache.test.ts`

`mergeCrossOriginDecls` / `mergeCrossOriginTokens` 관련 케이스 삭제, `indexCrossOriginRules` describe(`css-source-cache.test.ts:228-304`, it 9개) 삭제, `selectorSpecificity` 재귀 케이스 추가 및 기존 "판정 불가" 배열 정리(tasks.md 참조).

### 변경 없음

`src/background/messages.ts`(`css.fetchSheets` 핸들러), `src/lib/ssrf-guard.ts`, `src/types/picker.ts`.

**사이드패널 컴포넌트도 코드 변경은 없다. 다만 출력값은 바뀐다** — `specifiedStyles`가 cross-origin 페이지에서 "비어 있음 → 채워짐"으로 전환되므로, "specified가 비었나"에 걸려 있는 하류 소비처가 전부 영향을 받는다(`sectionDefaultOpen.ts`의 섹션 펼침 판정, `StyleChangesTable.tsx:304`+`hasStyleChange.ts:16`의 diff 행 존재 판정, `buildMarkdownContext.ts:69-73`의 이슈 본문 토큰 선별 — **골든 스냅샷 58장이 봉인 중**, `propMetadata.ts`의 cross-prop 가드). tasks.md에 별도 전환 태스크를 둔다.

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
            │  collectShadowTargets() ∪ (raw 축: non-same-origin href)
            │  sendBg("css.fetchSheets")    ← 가드·캡 그대로, href dedup
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

> **알려진 UX 부채 — 2차 갱신이 "추가"에서 "교체"로 바뀐다.** 실제 갱신은 3단이다(`picker.ts:1155` selected → `:1165` same-origin 캐시 보강 → `:1170` cross-origin 보강). `mergeSelectionStyles`(`editor-store.ts:455-457`)는 gap-fill이 아니라 **세 맵 전면 교체**이고 사용자가 이미 편집한 prop만 prev로 되돌린다. 오늘은 cross-origin이 gap-fill 강등이라 2차가 바꾸는 값이 "1차에 비어 있던 prop"에 한정되지만, 변경 후엔 **specificity 승자가 바뀌는 모든 prop이 무통보로 교체**된다. 로딩 인디케이터·전환 효과·알림은 전부 없고 대기 상한은 시트당 8s(end-to-end 타임아웃 없음)다. 사용자는 "이 값 기준으로 고치겠다"고 보던 baseline이 몇 초 뒤 소리 없이 바뀌는 걸 겪는다. 최소 개입(2차 도착 시 변경 행 1회 배경 플래시)은 별도 스펙으로 뗀다 — 여기서는 관찰 항목만 tasks.md 수동 테스트에 둔다.

## 인터페이스 설계

```ts
// src/content/css-source-cache.ts

/**
 * 시트의 규칙 목록. cross-origin이라 cssRules가 throw 하면 shadow sheet로 폴백한다.
 * 원본·shadow 둘 다 못 읽으면 null.
 *
 * 호출부의 try/catch는 이 함수가 대체하지 않는다 — walkRulesForIndex·collectFromRules의
 * 순회 내부 throw까지 감싸는 것이 원래 역할이라 그대로 유지한다.
 */
export function resolveSheetRules(sheet: CSSStyleSheet): CSSRuleList | null;

/** shadow가 필요한(= cssRules 접근이 막힌) 시트와 그 href. media/disabled 비활성 시트는 제외. */
function collectShadowTargets(): Array<{ sheet: CSSStyleSheet; href: string }>;
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

### 선행 조건 — 토크나이저 하드닝 (재귀보다 먼저)

재귀 확장의 기반이 되는 두 함수에 결함이 있고, **실패 방향이 `null`이 아니라 조용한 오답**이다. 이 층에서 fail-closed가 성립하지 않으면 "잘못된 확정 < uncertain" 원칙이 무너진다.

- **`splitSelectorList`(`css-source-cache.ts:241-257`)가 따옴표·이스케이프를 전혀 모른다** — `:is(a[title=","], .b)`를 3조각으로, `.a\,b`를 2조각으로 오분할한다.
- **`skipBalanced`(`css-resolve.ts:1065-1083`)는 따옴표 *안*의 `\`만 처리하고 밖의 `\)`·`\(`를 놓친다** — `argEnd`가 어긋나면 이후 전체가 잘못된 오프셋에서 재토큰화돼 `null`이 아니라 그럴듯한 오답이 나온다.

두 함수를 하드닝하고 차등 테스트를 붙이는 것이 재귀 확장의 **선행 조건**이다. (참고: 지금 `:matches()`/`:-webkit-any()`는 `UNRESOLVABLE_FUNCTIONAL_PSEUDOS`에 없어 `b++`로 떨어지는 **기존** 오답인데, `ARG_MAX_PSEUDOS` 도입이 이걸 함께 고친다.)

### 재귀 구현 골자

기존 `skipBalanced`·`splitSelectorList` 재사용, 신규 의존성 0:

```ts
const MAX_SELECTOR_DEPTH = 8;   // 병리적 중첩 방어. 최상위 호출을 depth 0으로 센다.

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

`UNRESOLVABLE_FUNCTIONAL_PSEUDOS`(`:1018-1024`)는 **교체가 아니라 분리**한다 — 이 집합에는 `host`·`host-context`도 들어 있고 그 둘의 `null`은 유지해야 한다. `ARG_MAX_PSEUDOS = new Set(["is","not","has","matches","-webkit-any","-moz-any","any"])`를 **새로 만들어** 먼저 검사하고, 나머지는 기존 집합에 남긴다. `:nth-child`/`:nth-last-child`의 `of S`는 `of` 뒤 부분을 `maxArgSpecificity`에 넘긴 뒤 `b++`를 함께 가산한다.

**유지되는 null(uncertain)**: `&`(부모 문맥 필요), `|`(네임스페이스), `::part()`/`::slotted()`(shadow 경계), `:host`/`:host-context`(document 시트 순회 범위 밖 — 방어적 유지), 미폐합 괄호, depth 초과.

### shadow 시트의 `@layer` 구멍 (확신 오답 방어)

`hasOpaqueCascadeContext`는 두 루프로 `@layer`를 찾는다: ① `rule.parentRule` 체인 ② `sheet.ownerRule`(`css-resolve.ts:1226-1237`). **구성 스타일시트는 `ownerRule`이 항상 `null`이라 두 번째 루프가 `:1228`에서 즉시 break한다.**

문제가 되는 경우: same-origin 부모가 `@import url(https://cdn/x.css) layer(vendor)`로 cross-origin 시트를 끌어오는 상황. `flattenSheets`(`:434-469`)가 부모를 읽어 자식 시트 객체를 노출하고, 새 판정이 그 자식을 shadow 대상에 포함한다. 그런데 shadow에는 `ownerRule`이 없어 `layer(vendor)` 문맥이 사라지고, `hasOpaqueCascadeContext`가 `false`를 돌려줘 **확신 있는 specificity로 경쟁**하게 된다. 방향이 "잘못된 확정"이라 위험하다.

방어: shadow를 만들 때 **원본 시트의 `ownerRule`을 함께 기록**하고, `hasOpaqueCascadeContext`의 두 번째 루프가 shadow 시트를 만나면 그 기록된 `ownerRule`부터 체인을 잇도록 한다. (기록이 없거나 판정이 애매하면 opaque 쪽으로 — uncertain이 잘못된 확정보다 낫다.)

## 기존 패턴 준수

- **화이트리스트 우선 (CLAUDE.md / POSTMORTEM 2026-07-31)** — `hasOpaqueCascadeContext`의 `TRANSPARENT_GROUP_RULES`는 그대로 둔다. shadow sheet 안의 `@layer`/`@container` 규칙은 자동으로 opaque 판정을 받아 uncertain이 된다. 이건 회귀가 아니라 **오늘의 잘못된 확정이 고쳐지는 것**이다. 단, 이 스펙은 cross-origin 규칙을 **처음으로 `walkRulesForIndex`에 태우는** 변경이므로 POSTMORTEM 2026-07-31 재발 방지 (3)의 계약 대조(`TRANSPARENT_GROUP_RULES` ↔ `CSSMediaRule|CSSSupportsRule` 목록 일치)를 검증 항목에 넣는다.
- **잘못된 확정 < uncertain** — specificity 재귀에서 인자 하나라도 모르면 전체를 `null`로 되돌린다. 부분 계산으로 그럴듯한 오답을 만들지 않는다. **단 이 원칙은 토크나이저가 fail-closed일 때만 성립한다** — 위 선행 조건 참조.
- **가드 복제 금지 (POSTMORTEM 2026-06-28)** — `cssRules` 접근 폴백을 `resolveSheetRules` 한 곳에 둔다. 저장소에 `cssRules` 직접 접근은 **5곳**(`css-source-cache.ts:138`·`:445`·`:598`·`:618`, `css-resolve.ts:425`)이고, shadow 폴백이 필요한 실 교체 대상은 **2곳**(`css-source-cache.ts:138`, `css-resolve.ts:425`)이다. 나머지 3곳(`flattenSheets`·`serializeAdoptedSheet`·`alignAndStore`)은 shadow와 무관한 문맥이라 교체하지 않는다 — **즉 "한 곳에만"은 정확히는 "shadow 폴백은 한 곳에만"이다.**
- **pre-arm 청크 제약 (CLAUDE.md)** — `css-resolve.ts`/`css-source-cache.ts`는 `picker.ts`만 import하고 `recorders-entry.ts` 그래프와 무관하다(`grep`으로 확인). 신규 의존성이 0개라 `check:prearm`에 영향이 없지만, 태스크에 검증을 넣는다.
- **테스트 우선 (CLAUDE.md)** — `selectorSpecificity` 재귀는 순수 함수라 유닛이 정본. cross-origin 통일은 브라우저 실동작이라 e2e가 유일한 그물.

## 대안 검토

### A1. `@bramus/specificity` 라이브러리 도입 (브리프 #8의 원안) — 기각

브리프는 라이브러리 도입을 권했지만 기각한다.

- **번들 비용이 프레임 단위로 곱해진다.** `css-resolve.ts`는 `picker.ts`가 import하고 picker는 `all_frames: true` content script다. `@bramus/specificity`는 `css-tree`(파서·lexer·패치 데이터) 전체를 끌고 온다 — 모든 페이지의 모든 프레임에서 파싱된다.
- **필요한 게 그 라이브러리의 일부뿐이다.** `:is/:not/:has`의 "인자 중 최대"는 순수 구문 규칙이고, 우리 토크나이저엔 이미 `skipBalanced`(중첩 괄호·따옴표 인식)와 `splitSelectorList`가 있다. 재귀 한 겹이면 된다.
- **`minimumReleaseAge: 1440` 정책**과 공급망 표면이 추가된다.
- 기존 `selectorSpecificity`엔 **이 코드베이스에서만 나온 방어**가 박혀 있다 — Chrome CSSOM이 Tailwind 클래스를 `.\32 xl\:mt-4`로 직렬화하는 hex 이스케이프 처리(`skipEscape`)가 그것이다. 라이브러리로 갈아끼우면 이 케이스를 재검증해야 한다.

**실패 방향 판정 (POSTMORTEM 2026-07-31 재발 방지 (1) — "기각 사유를 뽑고 각각 방향을 판정하라")**

그 회고의 실패는 "근사의 실패 방향을 오판해 정확한 라이브러리를 기각한 것"이었다. 같은 함정인지 검사한다.

- **손수 재귀의 실패 방향은 `null`(uncertain)이 아니라 "잘못된 확정"이다.** 인자 재귀는 하나라도 모르면 전체를 `null`로 되돌리므로 그 층은 fail-closed지만, **토크나이저 층은 아니다** — 따옴표·이스케이프 오분할이 `null` 대신 오프셋이 어긋난 그럴듯한 값을 만든다. 이건 computed 폴백보다 해롭다.
- 따라서 **기각은 그 방향 위험을 상쇄할 조치를 조건으로만 유효하다**: 위 "선행 조건 — 토크나이저 하드닝"(두 함수 수정 + 차등 테스트)이 그 조치이고, Task 4의 선행 조건으로 박는다.
- 상쇄 후에도 남는 저울: `all_frames`마다 곱해지는 `css-tree` 번들 비용 vs 하드닝된 자체 토크나이저 + 사양 예제 유닛. 후자를 택한다.

### A2. `mergeCrossOriginDecls`에 specificity·조건 평가를 직접 추가 — 기각

두 벌 유지를 인정하고 기능만 맞추는 방향. 조건 평가를 위해 `@media` 컨텍스트를 자체 IR에 싣고, `matchedSpecificity`를 자체 IR에도 붙이고, `@layer` 감지도 복제해야 한다. **드리프트 원인을 그대로 두고 표면만 늘린다** — POSTMORTEM 2026-06-28이 정확히 이 패턴의 실패 기록이다.

### A3. shadow sheet를 `adoptedStyleSheets`에 넣어 실제 적용 — 기각

`replaceSync` 결과를 adopt하면 `getComputedStyle`까지 통일된다는 발상. **페이지 렌더링을 우리가 바꾸게 되므로 절대 금지.** 이미 적용 중인 시트를 한 번 더 적용하면 캐스케이드 순서가 바뀌어 화면이 깨지고, before/after 스냅샷이 오염된다.

### A4. `style.cssText`를 shorthand 원문 소스로 (브리프 #2) — 기각 (실측 없이)

실측 게이트를 두려 했으나 **CSSOM 사양으로 이미 결정돼 있다**: 선언 블록은 prop당 항목이 1개인 순서 집합이라 `color: red; color: var(--x)` 같은 폴백 패턴이 반드시 마지막 하나로 접힌다. raw 텍스트 파서는 둘 다 본다 — 즉 `cssText`는 raw 파서의 **상위호환이 아니고** `ruleToRaw`·`alignAndStore`·`parseStylesheet` 기구를 대체할 수 없다. 게이트는 통과할 수 없으므로 실측 없이 드롭한다. (부수적으로 확인된 사실: `CSS_DECL_RE`(`css-resolve.ts:209`)의 나이브 정규식은 `url(a;b.png)`·`content: ":"`에서 깨진다. 실재하는 결함이지만 이번 스펙과 독립이라 별도 항목으로 남긴다.)

## 위험 요소

1. **동기 파싱 비용이 순증이다.** `replaceSync`는 네이티브 파서라 빠르지만 **`alignAndStore`의 JS 재파싱을 대체하지 않고 그 위에 얹힌다** — 같은 2MB를 두 번 훑는다. 게다가 완화책으로 제안했던 시트당 `await new Promise(r => setTimeout(r, 0))`은 실효가 의심스럽다: `loadCrossOrigin`은 idle 경로뿐 아니라 **선택·토큰 경로에서 await되므로**(`picker.ts:240`·`:1168`·`:1200`) 양보를 넣으면 2·3차 `selectionUpdated`가 그만큼 늦어진다. 계상에서 빠진 비용도 있다 — `ruleIndex = null`이 다음 hover render의 **동기** `buildRuleIndex`를 커진 규칙셋으로 재실행시킨다(`css-source-cache.ts:99` ← `css-resolve.ts:797` ← hover). 캡도 총량을 안 묶는다: `MAX_SHEETS`(50)·`MAX_SHEET_BYTES`(2MB)는 개수·시트당 크기만 제한하고 동시성 캡이 없어(`messages.ts:713-714` all-at-once) 최악 100MB가 SW와 content에 각각 문자열로 실체화된다. **계측 대상은 `replaceSync` 단독이 아니라 "선택 → 2차 도착" end-to-end다.**

2. **`@layer` 회귀처럼 보이는 변화 (PRD E5)** — cross-origin 시트가 `@layer`를 쓰면 오늘은 gap-fill로 값이 뜨지만 변경 후엔 opaque 판정 → uncertain → computed 폴백이 된다. 실제 체감 범위는 `var()` 보존 가드와 단독 선언 예외 때문에 "리터럴 값 + 경쟁 있음" 교집합으로 좁고, 값이 사라지지도 않는다(표기가 바뀐다: `12rem` → `192px`). 그래도 의도된 정확도 향상이 회귀로 오인될 수 있으니 커밋 메시지와 POSTMORTEM에 남긴다. **Tailwind v4는 출력 전체가 `@layer`라 S3의 수혜 범위가 이 위험과 정면으로 겹친다.**

3. **specificity 확정 확대의 양날** — `:is()` 등이 확정되면서 **오늘 uncertain(computed 폴백)이던 prop이 저자 원문으로 바뀐다.** 재귀나 토크나이저에 버그가 있으면 "그럴듯한 오답"이 되고, computed 폴백보다 해롭다(POSTMORTEM 원칙). 유닛 테스트를 사양 문서(Selectors 4) 예제로 채워 고정하고, 토크나이저 하드닝을 선행 조건으로 둔다.

4. **`alignAndStore`의 셀렉터 정렬 실패가 cross-origin에선 신규 손실이다.** 오늘 cross-origin 선언은 **100% raw 파서**에서 온다(`mergeCrossOriginDecls`가 `rule.decls`를 읽음, `css-resolve.ts:868`). 변경 후엔 `normalizeSelector`(`css-source-cache.ts:684-703`) 키 조인 성공에 의존하는데, **이 함수는 속성 셀렉터의 따옴표를 정규화하지 않는다**(`:683` 주석). 미니파이된 CDN CSS의 `[type=text]`를 Chrome이 `[type="text"]`로 재직렬화하면 `missed++` → `extractVarPropsFromCssText` 폴백 → shorthand `var()` 소실. same-origin에서는 이미 감수 중인 위험이지만 cross-origin에는 **없던 위험**이다. `dlog("aligned", …)`의 `missed` 비율을 same-origin과 비교해 크게 다르면 조사한다.

5. **`collectShadowTargets`가 same-origin 실패 시트까지 잡을 수 있다** — 예: `<style>` 태그인데 CSP로 파싱 실패. fetch할 href가 없으면 자동 제외되므로 실해는 없다(`href` 필수).

6. **무효화 커버리지가 부족하다.** MutationObserver가 `{childList, subtree}`만 관찰하고 **`attributes: true`가 없어**(`css-source-cache.ts:375-378`) 테마 전환의 `link.href` / `link.disabled` / `link.media` 변경을 못 잡는다. `href`가 바뀌면 브라우저가 새 `CSSStyleSheet` 객체를 만들므로 새 시트는 shadow가 없고(값이 조용히 same-origin만으로 판정됨) 옛 시트는 `sheetShadows`에 남는다 — `WeakMap`이라 메모리 고착은 없지만 **stale은 남는다.** `handleStop`(`picker.ts:608-611`)도 invalidate를 호출하지 않는다(`handleClear`만, `:649`). 이번 스펙에서 관찰 범위를 넓힐지는 tasks.md의 판단 항목으로 둔다.

7. **`replaceSync`는 `@import`에 throw하지 않는다** — 사양상 조용히 제거하고 성공한다(Chrome은 **페이지 콘솔에** 경고를 찍는다 — 버그 리포팅 도구엔 그 자체가 부작용이다). 따라서 `catch { continue }`가 이 경우를 잡지 못하고, `@import`만으로 구성된 매니페스트 시트는 **빈 shadow**가 된다. 위 3번 골자의 `cssRules.length === 0` 가드가 그 방어다. 덧붙여 구성 시트의 base URL은 **문서 기준**이라 cross-origin 시트의 상대 `url(../img/x.png)`가 페이지 origin으로 절대화된다 — `background-image`가 `INTERESTING_PROPS`에 있으므로(`css-resolve.ts:57`) 오늘 보이던 저자 원문 리터럴과 값이 달라질 수 있다.

8. **테스트 불가 영역** — CLAUDE.md 명시대로 이 영역은 유닛으로 못 고정한다. e2e가 유일한 그물인데 **기존 fixture로는 그물이 안 쳐진다**: `isFetchableSheetUrl`(`src/lib/ssrf-guard.ts:19,42`)이 `localhost`·`127.0.0.1`을 차단하므로 `e2e/fixtures/pages/cross-origin-style.html`(시트가 `localhost`)에서는 **fetch가 아예 일어나지 않아** shadow도 안 생기고 시나리오가 공회전 green이 된다(`e2e/COVERAGE.md:118`·`e2e/GOTCHAS.md:86`이 이 제약을 명시 중). 우회로는 코드에 이미 있다 — `e2e/fixtures/extension.ts:196`의 `--host-resolver-rules=MAP *.bugshot.test 127.0.0.1`. 시트를 `http://css.bugshot.test:${port}/…`로 서빙하면 **가드 우회가 아니라** 호스트명이 loopback이 아니어서 정상 통과한다. 기존 fixture는 "fetch 차단 → computed 폴백" 회귀 방어가 목적이므로 확장하지 말고 신규 fixture로 분리한다. `.css`는 반드시 `text/css`로 서빙해야 한다(strict MIME 거부 — POSTMORTEM 2026-06-27).
