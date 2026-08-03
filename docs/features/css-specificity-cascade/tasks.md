# CSS specificity 판정 정밀화 — 구현 태스크

## 선행 조건

- 착수 전 `docs/POSTMORTEM.md`를 `css-resolve`·`css-source-cache`·`specified`·
  `uncertain` 키워드로 grep해 과거 함정 확인(특히 "쓰기 판정 단일 출처"·"가드 복제
  드리프트"·"same/cross-origin 경로 비대칭" 항목).
- 권한·env·외부 의존성 없음. 새 파일 없음 — `css-resolve.ts` + 테스트만.

## 태스크

### Task 1: `selectorSpecificity` 순수 함수 (TDD)

- **변경 대상**: `src/content/__tests__/css-resolve.test.ts` → `src/content/css-resolve.ts`
- **작업 내용**: 테스트 먼저 작성(red) 후 구현(green). design.md "specificity 계산
  사양" 표·null 조건 전부. 케이스 최소:
  - 기본: `div`(`[0,0,1]`), `.a`(`[0,1,0]`), `#a`(`[1,0,0]`), `div.a#b`,
    `*`(`[0,0,0]`), 결합자 무기여(`.a > .b` = `[0,2,0]`)
  - 비교: `compareSpecificity` 사전식 비교와 1,000개 이상 반복 성분도 cap 없이 구분
  - pseudo: `:hover`(b), `::before`(c), 레거시 `:before`(c), `:nth-child(2n)`(b, 인자
    스킵), `:where(.a #b)`(0)
  - 따옴표 attr: `[data-x="a,b(c"]`(b — 괄호·콤마가 카운트 오염 안 함)
  - null: `:is(.a)`, `:not(.a)`, `:has(.a)`, `::part(x)`, `::slotted(.a)`, `& .a`,
    `:nth-child(2n of .a)`
  - 이스케이프: `.a\:b`(`[0,1,0]` — `\:`가 pseudo로 안 세짐)
- **검증**:
  - [ ] 신규 describe green, `pnpm test` 전체 green
  - [ ] null 반환 조건마다 WHY 주석 존재(보수적 uncertain 처리 판단 — 스펙 요구)

### Task 2: `matchedSpecificity` + `hasOpaqueCascadeContext` (TDD)

- **변경 대상**: 동일 파일들
- **작업 내용**: `matchedSpecificity`는 `splitSelectorList` import 후 el 스텁
  (`{ matches: (s) => … }`)으로 테스트. 케이스: 매치 파트 중 최고값 선택 / 비매치
  파트 무시(높은 spec이어도) / 매치 파트가 null-spec이면 전체 null / `matches` throw
  → null / 매치 0개 → null. `hasOpaqueCascadeContext`는
  `globalThis.CSSLayerBlockRule`/`CSSScopeRule` 스텁 클래스로 parentRule 체인,
  `CSSImportRule.layerName`(`""` 포함) 케이스를 고정.
- **검증**:
  - [ ] 신규 describe green
  - [ ] 두 CSS rule 전역 모두 `typeof` 가드 존재(node 환경에서 ReferenceError 없음)

### Task 3: `noteClaim` specificity 편입 + verdict 반환 (TDD)

- **변경 대상**: 동일 파일들
- **작업 내용**: `ClaimState.candidates`에 `specificity` 추가, `noteClaim`에
  **마지막 optional** 파라미터 `specificity: Specificity | null = null` + boolean 반환.
  design.md "판정 순서" 1–7 구현. 테스트 시나리오(스펙 요구 5종):
  - specificity 역전: `.a.b`(먼저, `[0,2,0]`) vs `.c`(나중, `[0,1,0]`) 다른 값 → 이전 승자
    유지, 반환 false, uncertain 비움
  - 동률+문서순서: `.a` vs `.b` 다른 값 → 나중 승자, 반환 true, **uncertain 비움**
  - 동일 값 승자 출처: 높은 spec/important/inline 이전 후보 뒤에 오는 패자는 반환 false,
    `sources[prop]`가 패자 origin으로 덮이지 않음. known-spec 동률은 뒤 후보 반환 true
  - 동일 값+null spec: uncertain을 늘리지 않고 이전 후보 유지, 반환 false
  - `!important` 교차: 낮은 spec + important > 높은 spec 일반 (기존 분기 유지 확인)
  - inline 교차: `[inline]` > 높은 spec 일반, important 일반 > inline 일반
  - uncertain 잔존: 한쪽 spec null → uncertain 유지 / 선(先) null-spec 충돌로
    uncertain된 prop이 후속 known-spec 패배 판정에서 **delete되지 않음**
  - 기존 `noteClaim` 테스트(742행~) 무수정 green(하위호환 확인)
- **검증**:
  - [ ] 위 시나리오 red→green, 기존 테스트 무수정 green

### Task 4: 스레딩 + 쓰기 게이트 + 수용 테스트

- **변경 대상**: `src/content/css-resolve.ts`(`collectRulesForElement`·
  `applyDeclarations`·`extractVarPropsFromCssText`·`extractVarPropsFromMap`) + 테스트
- **작업 내용**:
  1. `collectRulesForElement`: 규칙당 `spec = hasOpaqueCascadeContext(rule) ? null :
     matchedSpecificity(el, rule.selectorText)` 1회 계산, 세 호출에 전달. `@layer`/
     `@scope` 소속 규칙은 `null`, inline
     패스는 `null`.
  2. `applyDeclarations`(쓰기 2지점): `noteClaim` verdict `false`면 out 쓰기 skip.
     verdict `true`면 기존 `shouldOverwriteSpecified` 게이트 그대로(토큰 보호 유지).
  3. `extractVarPropsFromMap`: **직접 선언 prop**만 `noteClaim` verdict 게이트 추가
     (claims 없으면 통과). 파생 claim(`claimBorderProp`·split 전개)은 무변경.
  4. **수용 테스트**(스펙의 red→green 기준): 비공개 `applyDeclarations`를 export하지
     않고 공개 `collectSpecifiedStylesWithSources` 경로에서 `getMatchingRules`를 mock하고
     최소 CSSStyleRule/Element 전역을 스텁해 높은 spec 규칙 → 낮은 spec 규칙 순서를 검증:
     - [ ] `out[prop]` = 높은 spec 규칙 원문값 (패자 값이 안 덮음)
     - [ ] `claims.uncertain`에 prop 없음 → `resolveUncertainSpecified` 호출해도
       `[computed]` 대체가 일어나지 않음
     - 대조군: 한쪽 spec `null`이면 기존대로 uncertain → `[computed]` 대체
  5. `noteClaim`·`shouldOverwriteSpecified`·`resolveUncertainSpecified` 인접 주석을
     새 역할 분리(승자 판정 vs 표기 보호)에 맞게 갱신 — `css-resolve.ts:1037` 부근
     "specificity를 모르므로" 문구는 이제 거짓이 된다.
- **검증**:
  - [ ] `pnpm test` 전체 green + `pnpm typecheck` 통과
  - [ ] `shouldOverwriteSpecified`·`resolveUncertainSpecified` 시그니처·동작 무변경
    (git diff로 확인 — 스코프 밖 명시 항목)
  - [ ] cross-origin 경로(`mergeCrossOriginDecls`) diff 없음(design.md 확인 결과대로)

## 테스트 계획

- **단위 테스트**: Task 1–4에 인라인(위 참조). 전부 node 트랙(`css-resolve.test.ts`),
  DOM 불필요(el·decl 스텁).
- **e2e 시나리오** (`/e2e-write` 입력 후보 — 선택): "픽스처 페이지에 같은 속성을 다른
  값으로 선언한 specificity 다른 규칙 2개(`.btn` vs `button`)가 있을 때, 요소 선택
  후 CSS 뷰에 높은 specificity 규칙의 원문 hex가 표시되고 `rgb(` 표기가 없다."
  실브라우저 CSSOM 검증이라 가치 있으나 스펙 필수 검증은 단위+typecheck — 구현 보고의
  "e2e 영향" 플래그로 판단.
- **수동 테스트**:
  - [ ] google.com 검색 버튼 선택 → 편집 탭의 `background-color`가 `#f8f9fa` 원문
  - [ ] 같은 선택의 CSS 뷰에도 `#f8f9fa` 원문과 승자 selector가 표시
  - [ ] 같은 선택의 인스펙터 툴팁 색상·토큰 출처도 승자 규칙과 일치
  - [ ] `@layer` 쓰는 사이트에서 layer 충돌 prop이 기존처럼 computed 표시(회귀 아님)
  - [ ] `@scope` 쓰는 사이트에서 scope 충돌 prop이 기존처럼 computed 표시(회귀 아님)
  - [ ] naver.com(cross-origin 시트) 표시 기존과 동일

## 구현 순서 권장

Task 1 → 2 → 3 → 4 순차(각 태스크가 앞의 산출을 소비). 병렬 없음. 각 태스크 종료마다
`pnpm test` green 확인 후 다음으로.

## 가이드 영향: 없음

내부 판정 정밀화 — 레이아웃·라벨·조작 흐름은 불변이고 표시 값·출처 정확도만 개선.
