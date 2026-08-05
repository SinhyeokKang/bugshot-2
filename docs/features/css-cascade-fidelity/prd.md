# CSS 캐스케이드 충실도 — cross-origin 경로 통일 + specificity 확정 범위 확대

## 배경

`docs/POSTMORTEM.md`의 `스타일해석` 영역 회고 중 4건(2026-06-27, 06-28 ×3)이 전부 같은 한 문장으로 요약된다: **"cross-origin 경로가 same-origin과 비대칭"**. 개별 픽스로 하나씩 막아왔지만 계열 자체는 살아 있어서 다음 prop·다음 사이트에서 다시 터진다.

비대칭의 실체는 스타일 수집 경로가 **완전히 두 벌**이라는 것이다.

| | same-origin | cross-origin |
|---|---|---|
| 규칙 표현 | `CSSStyleRule` (CSSOM) | `ParsedRule {selectorText, decls}` (자체 IR) |
| 후보 좁히기 | class/tag/id 인덱스 (`buildRuleIndex`) | 전체 선형 스캔 (`matchCrossOriginRules`) |
| `@media`/`@supports` | **조건 평가 후 하강** (`walkRulesForIndex:164-181`) | **조건 무시하고 하강** (`parseRulesFrom:773`) |
| specificity | `matchedSpecificity` | 없음 |
| `!important` | `getPropertyPriority` | 없음 (raw 파서가 값에서 벗겨냄) |
| `@layer` 불투명 판정 | `hasOpaqueCascadeContext` | 없음 |
| 캐스케이드 지위 | 정상 경쟁 | **gap-fill 전용** — same-origin이 채운 prop은 무조건 양보 |

여기서 나오는 구체적 오답이 셋이다.

1. **안 맞는 미디어쿼리가 섞인다.** `parseRulesFrom`(`css-source-cache.ts:773`)은 `@media`/`@supports`/`@layer`/`@container`/`@scope`를 조건 평가 없이 하강한다. cross-origin 시트의 `@media (max-width: 400px)` 안 규칙이 데스크톱에서도 수집된다. same-origin 경로엔 없는 결함이다.
2. **specificity 역전을 못 잡는다.** cross-origin 규칙은 `mergeCrossOriginDecls`(`css-resolve.ts:846`)에서 same-origin이 이미 채운 prop을 건드리지 못한다. cross-origin의 `#id .btn { color: red }`가 same-origin의 `.btn { color: blue }`에 진다.
3. **`:is()/:not()/:has()`가 통째로 uncertain이다.** `selectorSpecificity`(`css-resolve.ts:1087`)의 `UNRESOLVABLE_FUNCTIONAL_PSEUDOS`가 이 셋을 `null`로 던져 computed 폴백을 태운다. Tailwind·shadcn 계열 사이트에서 대량 발생한다 — 사용자에겐 "저자가 쓴 원문 대신 브라우저가 계산한 리터럴이 뜬다"로 보인다.

그리고 이 두 벌은 **드리프트한다**. POSTMORTEM 2026-06-28의 "var 보존 가드가 same-origin에만 있었다"가 그 사례다. `mergeCrossOriginDecls:876`의 주석이 "가드를 손으로 복제하면 한쪽만 고쳐져 드리프트한다"고 경고하고 있는데, 그 경고 자체가 두 벌 구조의 증상이다.

## 목표

- **G1 — 경로 통일**: cross-origin author 규칙이 `CSSStyleRule`로 수렴해 same-origin과 **같은 인덱스·같은 seq 축·같은 판정 함수**를 탄다. 판정 로직이 한 벌만 남는다.
- **G2 — 조건 평가**: cross-origin 규칙의 `@media`/`@supports` 조건이 실제로 평가된다. 안 맞는 조건의 규칙은 수집되지 않는다.
- **G3 — 정상 캐스케이드**: cross-origin 규칙이 specificity·source order·`!important`로 same-origin과 정상 경쟁한다. gap-fill 강등이 사라진다.
- **G4 — uncertain 축소**: `:is()`/`:not()`/`:has()`/`:nth-child(An+B of S)`가 uncertain에서 확정으로 전환된다.
- **G5 — 회귀 없음**: 페이로드 shape(`PickerSelectionPayload`)과 사이드패널 UI가 무변경. 기존 `e2e/style-*.spec.ts` 17개가 전부 green.

## 비목표 (Non-goals)

- **cross-origin 시트 내부의 `@import` 하위 시트** — 구현 수단(`replaceSync`)이 `@import` 규칙을 드롭한다. 단 **오늘도 안 보인다**(`collectCrossOriginHrefs`는 `HTMLLinkElement` 소유 시트만 수집하고, cross-origin 부모의 `cssRules` 접근이 throw라 `flattenSheets`가 하강 못 함). 회귀가 아니라 유지다.
- **`&`(CSS nesting) / `::part()` / `::slotted()` specificity** — 부모 문맥이나 shadow 경계 매칭이 필요해 순수 구문으로 확정 불가. `null`(uncertain) 유지.
- **fetch 정책 변경** — Hoverify의 무가드 fetch는 베끼지 않는다. `isFetchableSheetUrl`(SSRF 가드) + `MAX_SHEET_BYTES`(2MB) + `SHEET_FETCH_TIMEOUT_MS`(8s) + `MAX_SHEETS`(50) 전부 현행 유지. 이 변경은 **받아온 텍스트를 어떻게 소비하는가**만 바꾼다.
- **새 UI·새 권한·새 env**. 없음.
- **`:hover` 등 상태 pseudo 규칙 수집** — 별도 스펙(다음 라운드).

## 사용자 시나리오

### S1. cross-origin CSS를 쓰는 사이트에서 값이 DevTools와 일치한다

1. 사용자가 `naver.com`처럼 CSS가 다른 도메인(`pstatic.net`)에 있는 페이지에서 요소를 선택한다.
2. 1차 `picker.selected`가 same-origin·inline만으로 즉시 도착해 패널이 그려진다(현행과 동일).
3. background fetch가 끝나면 2차 `picker.selectionUpdated`가 cross-origin 규칙까지 반영해 도착한다.
4. **달라지는 것**: 이제 그 값이 specificity 경쟁을 거친 승자다. cross-origin의 `#gnb .link { color: #03A94D }`가 same-origin의 `a { color: #333 }`을 이긴다. `propSources`에도 이긴 셀렉터가 뜬다.

### S2. 반응형 사이트에서 유령 값이 사라진다

1. cross-origin 시트에 `@media (max-width: 600px) { .card { padding: 8px } }`가 있고 사용자는 데스크톱 폭이다.
2. **현재**: `padding: 8px`가 specified에 섞여 들어온다.
3. **변경 후**: 조건이 평가되어 수집되지 않는다. 실제 적용값인 데스크톱 `padding`만 뜬다.

### S3. Tailwind 사이트에서 원문이 보인다

1. `.dark\:bg-slate-800:is(.dark *)` 같은 셀렉터가 매칭되는 요소를 선택한다.
2. **현재**: `:is()`가 uncertain → `background-color`가 `rgb(30, 41, 59)` 리터럴(computed 폴백)로 뜬다.
3. **변경 후**: specificity가 확정되어 승자 판정이 되고, 저자 원문(`var(--…)` 포함)이 보존된다.

### 엣지 케이스

- **E1. fetch 실패/차단** — SSRF 가드 거부, 타임아웃, 404, 2MB 초과. 해당 시트는 shadow가 안 만들어지고 오늘과 같이 **그 시트만 통째로 안 보인다**. 다른 시트는 영향 없음.
- **E2. `replaceSync` throw** — 구문이 깨진 텍스트. 해당 시트만 skip, 나머지 진행.
- **E3. 로드 중 페이지가 시트를 갈아끼움** — `epoch` 기반 `isStaleLoad` 가드로 옛 로드 결과를 통째 폐기(현행 메커니즘 재사용).
- **E4. 세션 종료** — `invalidate()`가 shadow 시트 참조를 전부 놓는다. 문서에 adopt한 적이 없으므로 페이지에 잔재가 남지 않는다.
- **E5. `@layer` 안의 cross-origin 규칙** — 이제 `hasOpaqueCascadeContext`가 적용되어 uncertain으로 강등된다. **오늘보다 보수적으로 바뀌는 유일한 지점**이고 의도된 것이다(POSTMORTEM 2026-07-31: "잘못된 확정이 uncertain보다 해롭다").

## 성공 기준

1. `mergeCrossOriginDecls` / `getMatchingCrossOriginRules` / `indexCrossOriginRules` / `crossOriginRules` 및 그 전용 테스트가 삭제되고, 규칙 판정 로직이 한 벌만 남는다.
2. cross-origin fixture(`e2e/fixtures/pages/cross-origin-style.html`) 확장 시나리오에서:
   - 안 맞는 `@media` 안 선언이 패널에 뜨지 않는다
   - cross-origin의 높은 specificity 규칙이 same-origin의 낮은 규칙을 이긴다
   - `propSources`에 cross-origin 셀렉터가 표시된다
3. `selectorSpecificity(".a:is(#b, .c)")`가 `[1,1,0]`을, `selectorSpecificity(".a:not(#b)")`가 `[1,1,0]`을, `selectorSpecificity(":has(.x .y)")`가 `[0,2,0]`을 돌려준다(단위 테스트).
4. `pnpm test` + `pnpm typecheck` 통과, 기존 `e2e/style-*.spec.ts` 17개 green.
5. `pnpm check:prearm` 통과 — `recorders-entry` 청크에 외부 static import가 유입되지 않는다.
6. 신규 의존성 0개.
