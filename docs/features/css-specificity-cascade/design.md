# CSS specificity 판정 정밀화 — 기술 설계

## 개요

specified 수집의 유일한 규칙 순회 지점인 `collectRulesForElement()`(`css-resolve.ts:813`)
에서 규칙당 specificity를 1회 계산해 `noteClaim()`까지 내려보낸다. `noteClaim`은
후보 비교에 specificity를 편입해 승자를 확정하고, **승자 verdict를 반환**해 쓰기
경로(`applyDeclarations`·`claimSpecified`)가 패자 값의 out 덮어쓰기를 막게 한다.
specificity를 신뢰할 수 없는 규칙(`:is()` 등 미지원 셀렉터·`@layer` 소속·`el.matches()`
throw)은 `null`로 전달돼 기존 uncertain 경로를 그대로 탄다.

두 소비 경로(`collectSpecifiedStylesWithSources` = 편집/CSS 뷰, `collectInspectorSpecRefs`
= 인스펙터)는 모두 `collectRulesForElement`를 경유하므로(POSTMORTEM "경로 분기" 함정
회피) 통합 지점은 하나다. 조상 순회(상속 prop)도 같은 함수를 요소만 바꿔 호출하므로
자동으로 같은 판정을 탄다.

## 변경 범위

### `src/content/css-resolve.ts` (수정)

- **`selectorSpecificity(selector: string): number | null`** (신규 export, 순수):
  단일 셀렉터(콤마 없음) → `a * 1_000_000 + b * 1_000 + c` 스칼라
  (버킷당 `Math.min(n, 999)` 캡 — 진짜 셀렉터는 세 자리를 넘지 않고, 캡이 있어야
  버킷 오버플로가 상위 버킷을 오염하지 않는다). 판정 불가면 `null`.
- **`matchedSpecificity(el, selectorText): number | null`** (신규 export):
  `splitSelectorList()`로 나눈 뒤 `el.matches()`로 실제 매치되는 파트 중 최고
  specificity(CSS 사양과 동일). `el`은 `matches(sel: string): boolean`만 요구하는
  구조적 타입으로 받아 node 테스트에서 스텁 주입 가능하게 한다.
- **`isRuleLayered(rule: CSSStyleRule): boolean`** (신규, 내부): `@layer` 소속 판정.
- **`ClaimState.candidates`** 항목에 `specificity: number | null` 추가.
- **`noteClaim()`**: `specificity: number | null = null` 파라미터 추가 + **boolean
  반환**(이 선언이 현재 승자인가). 기존 호출부(테스트 포함)는 기본값·반환 무시로
  컴파일 유지.
- **`applyDeclarations()`·`extractVarPropsFromCssText()`·`extractVarPropsFromMap()`**:
  `specificity` 파라미터 스레딩. `applyDeclarations`의 두 쓰기 지점은
  `noteClaim` verdict && `shouldOverwriteSpecified` 둘 다 통과해야 쓴다.
- **`collectRulesForElement()`**: 규칙당
  `isRuleLayered(rule) ? null : matchedSpecificity(el, rule.selectorText)` 1회 계산 후
  세 호출(`extractVarPropsFromMap`/`FromCssText`, `applyDeclarations`)에 전달.
  inline 패스는 `null` 전달(inline은 origin `"[inline]"` 분기가 이미 처리).
- `shouldOverwriteSpecified()`·`resolveUncertainSpecified()`·`claimBorderProp()`·
  shorthand split 파생 claim은 **무변경**(아래 "역할 분리" 참조).

### `src/content/__tests__/css-resolve.test.ts` (수정)

신규 describe: `selectorSpecificity`·`matchedSpecificity`·`noteClaim` specificity
시나리오. 기존 `noteClaim` 테스트는 시그니처 하위호환이라 그대로 green.

### `src/content/css-source-cache.ts` (무변경)

`splitSelectorList`를 css-resolve에서 import만 추가(이미 같은 모듈에서 다른 심볼
import 중).

## specificity 계산 사양

`selectorSpecificity` 는 한 패스 토크나이저로 계산한다:

| 토큰 | 기여 |
|---|---|
| `#id` | a += 1 |
| `.class`, `[attr…]`(따옴표 인식 스킵), 함수형 아닌 pseudo-class(`:hover`) | b += 1 |
| 함수형 pseudo-class(`:nth-child(2n)` 등) | b += 1, 괄호 인자 스킵 |
| `:where(…)` | 0 기여, 인자 스킵 |
| type(`div`), pseudo-element(`::before` + 레거시 단일콜론 `:before/:after/:first-line/:first-letter`) | c += 1 |
| `*`, 결합자, `\` 이스케이프 다음 문자 | 0 기여 |

**`null` (판정 불가) 반환 조건** — 이 규칙의 충돌은 기존 uncertain 경로로:

- `:is(`/`:not(`/`:has(` 포함 — 인자 내부 specificity의 정확 재현(인자 중 최고값)이
  중첩·매치 판정까지 요구해 부담이므로 보수적으로 uncertain 처리(스펙이 허용한 판단
  — 코드 주석으로 남긴다).
- `::slotted(`/`::part(` — 인자가 specificity에 가산되는 특례.
- `&` 포함(CSS nesting — `:is(부모)` 상당이라 위와 같은 이유).
- `:nth-child(… of S)`/`:nth-last-child(… of S)` — `of` 셀렉터 인자 가산 특례.
  인자 내 최상위 ` of ` 감지 시 null.

`matchedSpecificity` 추가 규칙:

- 파트별 `el.matches()`가 throw → 전체 `null`(그 파트가 승자인지 알 수 없다).
- 매치된 파트 중 하나라도 specificity `null` → 전체 `null`(그 파트가 최고일 수 있다).
- 매치 파트 0개(인덱스 손상 등 비정상) → `null`.

`isRuleLayered`:

- `rule.parentRule` 체인에 `CSSLayerBlockRule`(`typeof` 가드 — jsdom 부재 대비) 존재,
  또는 `rule.parentStyleSheet`의 `ownerRule` 체인에 `layerName != null`인
  `CSSImportRule`(익명 layer는 `""`라 `!= null` 판정) 존재 시 true.

## noteClaim 판정 순서 (변경 후)

기존 분기(1–5) 유지, 6을 신설. 반환값은 "이 선언이 현재 승자로 남았는가":

1. 첫 후보 → 채택, `true`.
2. 같은 값 → 기존대로 inline/important 승격만, `true`.
3. `previous.important && !important` → 유지, `false`.
4. `!previous.important && important` → 채택 + `uncertain.delete`, `true`.
5. inline 교차(기존) → 각각 `true`/`false`.
6. **(신설)** `previous.specificity != null && specificity != null`:
   - `specificity >= previous.specificity` → 채택(동률은 문서순 뒤 승 — 순회가
     `seq` 오름차순임을 `getMatchingRules`가 보장), `true`. **uncertain 추가 안 함.**
   - `<` → 이전 승자 유지, `false`. **`uncertain.delete` 하지 않는다** — 이 prop이
     앞서 null-spec 후보와의 충돌로 이미 uncertain이면 그 판정 불가 이력은 유효하다
     (candidates는 마지막 승자 1개만 기억하므로 삭제하면 이력을 잃는다). 보수 유지.
7. 폴백(어느 한쪽 `null`) → 기존대로 채택 + `uncertain.add`, `true`.

## 역할 분리 (쓰기 게이트)

승자 판정과 표기 보호를 한 함수에 겸하게 하지 않는다(POSTMORTEM 2026-07 "한 대입문이
둘을 겸하면 조용히 하나를 버린다"):

- **`noteClaim` = 규칙 간 캐스케이드 승자** (important > inline > specificity > 문서순).
- **`shouldOverwriteSpecified` = 표기 보호** (var() 토큰 강등 방지·shorthand 파생
  양보·중요도) — 시그니처·동작 무변경.

`applyDeclarations`의 쓰기: `noteClaim` verdict가 `false`면 skip(패자 값이 out을
덮지 않는다 — 이게 없으면 uncertain만 줄고 out엔 여전히 마지막 규칙 값이 남아
**패자 원문이 확정 표시되는 더 나쁜 회귀**가 된다). verdict `true`면 기존
`shouldOverwriteSpecified` 게이트를 그대로 통과해야 쓴다(토큰 보호 규율 유지 —
specificity 승자가 리터럴이고 현재 값이 author var()면 여전히 안 덮는다. 이는
`resolveUncertainSpecified`의 기존 토큰 보존 트레이드오프와 같은 방향).

var 경로(`extractVarPropsFromMap`)의 **직접 선언 prop**(shorthand 키 자체·var 낀
longhand)도 `claims`가 있으면 `noteClaim`을 먼저 태워 같은 verdict 게이트를 적용한다.
CSSOM 패스(`applyDeclarations`)가 같은 선언을 중복 등록해도 같은 값+같은 origin이라
분기 2(같은 값)로 무해하다. **파생 longhand claim(`claimBorderProp`·split 전개)은
`noteClaim`을 태우지 않는다(현행 유지)** — 파생값을 후보로 등록하면 직접 선언과의
교차에서 지금 없던 uncertain이 새로 생겨 computed 폴백이 늘어난다(회귀). 파생-직접
간 specificity 무시는 기존의 수용된 근사다(POSTMORTEM 2026-06-28 "의도된 근사").

## 데이터 흐름

```
collectRulesForElement(el, …)
  └ for rule of getMatchingRules(el)          // seq 오름차순 = 문서 순서
      spec = isRuleLayered(rule) ? null : matchedSpecificity(el, rule.selectorText)
      ├ extractVarPropsFromMap/FromCssText(…, spec)   // 직접 prop: noteClaim verdict → claimSpecified
      └ applyDeclarations(decl, …, spec)              // noteClaim verdict && shouldOverwriteSpecified → out 쓰기
  └ inline 패스: applyDeclarations(style, …, "[inline]", null)
  └ mergeCrossOriginDecls(…)                  // 무변경 (아래)
  └ return claims.uncertain                   // → resolveUncertainSpecified (무변경)
```

## 인터페이스 설계

```typescript
// 단일 셀렉터(콤마 없음)의 specificity. a*1e6 + b*1e3 + c 스칼라, 판정 불가면 null.
export function selectorSpecificity(selector: string): number | null;

// selector list에서 el에 실제 매치되는 파트 중 최고 specificity. el은 구조적 타입.
export function matchedSpecificity(
  el: { matches(selectors: string): boolean },
  selectorText: string,
): number | null;

export interface ClaimState {
  important: Set<string>;
  derived: Set<string>;
  candidates: Map<
    string,
    { value: string; important: boolean; origin: string; specificity: number | null }
  >;
  uncertain: Set<string>;
}

// 반환: 이 선언이 현재 승자로 남았는가. false면 호출부가 out 쓰기를 건너뛴다.
export function noteClaim(
  claims: ClaimState,
  property: string,
  value: string,
  important: boolean,
  origin: string,
  specificity?: number | null, // default null — 기존 호출부 하위호환
): boolean;
```

## cross-origin 경로 확인 결과 (스펙 지시 이행)

`mergeCrossOriginDecls()`(`css-resolve.ts:870`)는 `noteClaim`을 호출하지 않는다 —
same-origin이 채운 prop은 건드리지 않는 gap-fill이고, cross-origin 규칙끼리는 seq
오름차순 last-wins(`shouldOverwriteSpecified` 기본 플래그 호출)다. **uncertain 마킹
자체가 없어 computed 폴백 경로와 무관**하므로 스펙의 "같은 판정을 타면 동일 적용"
조건이 성립하지 않는다 → 무변경. cross-origin 파서(`indexCrossOriginRules`)는 `@layer`
블록을 평탄화해 layer 정보 자체가 소실되는 점도 동일 판정을 불가능하게 한다. 이
last-wins 근사는 POSTMORTEM 2026-06-28에 "의도된 근사"로 이미 수용돼 있다.

## 기존 패턴 준수

- 순수 함수 + node 트랙 테스트(`*.test.ts`), 같은 디렉터리 `__tests__/` (CLAUDE.md
  테스트 2트랙).
- 쓰기 판정 단일 출처 유지(POSTMORTEM 2026-07-22): `shouldOverwriteSpecified`/
  `claimSpecified` 경유 구조를 깨지 않고, 승자 판정만 `noteClaim`으로 분리 강화.
- 주석은 WHY 비자명한 곳 한 줄(보수적 null 처리 사유·uncertain 비삭제 사유·파생
  경로 제외 사유).

## 대안 검토

1. **`@layer` 순서까지 재현해 layer 규칙도 확정** — 기각. layer 트리 순서·중첩·
   `revert-layer`까지 필요해 스코프 대비 과대. 스펙이 명시적으로 제외.
2. **specificity를 `[a,b,c]` 튜플로 반환** — 기각. 비교·저장이 스칼라가 단순하고
   버킷 캡(999)이면 충돌 없음. 스펙이 양쪽 허용.
3. **`shouldOverwriteSpecified`에 specificity 파라미터를 직접 추가** — 기각.
   candidates(이전 승자의 specificity)를 모르는 함수라 호출부마다 조회 코드가 복제돼
   POSTMORTEM의 "가드 복제 드리프트" 함정을 재현한다. verdict 반환으로 판정을
   `noteClaim` 한 곳에 모은다.
4. **`:is()`/`:not()` 인자 specificity 정확 재현** — 보류(보수적 null). 인자 최고값
   규칙 + 중첩 파싱이 필요하고, 실패 시 잘못된 확정(패자 표시)이 uncertain보다
   해롭다. 스펙이 보수 처리를 허용.

## 위험 요소

- **verdict 게이트 누락 회귀**: `noteClaim`만 고치고 쓰기 게이트를 빼먹으면 out에
  패자 값이 확정 표시된다(uncertain 감소가 오히려 해가 됨). Task 4의 수용 테스트가
  "uncertain 비움 + out 값 = 승자 값" **둘 다** 검증해야 한다.
- **매치 순회 비용**: 규칙당 `splitSelectorList` + 파트별 `el.matches()` 재호출이
  추가된다. 매치된 규칙은 요소당 수십 개 수준이고 파트 수는 작아 수용 —
  selectorText 단위 memoize는 측정 없이 추가하지 않는다(요청 없는 유연성 금지).
- **테스트 시그니처 결합**: 기존 `noteClaim` 테스트가 positional 인자라 파라미터를
  중간에 끼우면 전부 깨진다 — 반드시 **마지막 optional**로 추가.
- **serialization 차이로 인한 자기 충돌**: 같은 규칙을 raw 파서와 CSSOM이 다른
  표기로 읽으면(공백 등) 분기 2(같은 값)를 빠져나갈 수 있다. var 경로는 var() 값만
  다루고 `resolveUncertainSpecified`가 var() 값은 computed로 대체하지 않으므로
  (`css-resolve.ts:1049`) 실해 없음 — 주석으로 남긴다.
- **jsdom에 `CSSLayerBlockRule` 부재**: `typeof` 가드 필수. 단위 테스트는
  `globalThis`에 동명 클래스를 세워 스텁한다.
