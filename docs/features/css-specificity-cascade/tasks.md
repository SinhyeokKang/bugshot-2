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
  - 비교: `compareSpecificity`가 사전식이고 성분 cap이 없음을 튜플 직접 입력으로
    고정 — `compareSpecificity([0, 1000, 0], [1, 0, 0]) === -1` 등(스칼라 인코딩
    회귀 방지)
  - pseudo: `:hover`(b), `::before`(c), 레거시 `:before`(c), `:nth-child(2n)`(b, 인자
    스킵), `:where(.a #b)`(0)
  - 따옴표 attr: `[data-x="a,b(c"]`(b — 괄호·콤마가 카운트 오염 안 함)
  - null: `:is(.a)`, `:not(.a)`, `:has(.a)`, `::part(x)`, `::slotted(.a)`, `& .a`,
    `:nth-child(2n of .a)`, `ns|div`(최상위 `|`), `:host(.a)` — 단 `[attr|=x]`는
    b 정상 카운트(대괄호 스킵에 흡수)
  - 이스케이프: `.a\:b`(`[0,1,0]` — `\:`가 pseudo로 안 세짐)
- **검증**:
  - [x] 신규 describe green, `pnpm test` 전체 green
  - [x] null 반환 조건마다 WHY 주석 존재(보수적 uncertain 처리 판단 — 스펙 요구)

### Task 2: `matchedSpecificity` + `hasOpaqueCascadeContext` (TDD)

- **변경 대상**: 동일 파일들
- **작업 내용**: `matchedSpecificity`는 `splitSelectorList` import 후 el 스텁
  (`{ matches: (s) => … }`)으로 테스트. 케이스: 매치 파트 중 최고값 선택 / 비매치
  파트 무시(높은 spec이어도) / 매치 파트가 null-spec이면 전체 null / `matches` throw
  → null / 매치 0개 → null. `hasOpaqueCascadeContext`는
  `globalThis.CSSLayerBlockRule`/`CSSScopeRule` 스텁 클래스로 parentRule 체인,
  `CSSImportRule.layerName`(`""` 포함) 케이스를 고정.
- **검증**:
  - [x] 신규 describe green
  - [x] 두 CSS rule 전역 모두 `typeof` 가드 존재(node 환경에서 ReferenceError 없음)

### Task 3: `noteClaim` specificity 편입 + verdict 반환 (TDD)

- **변경 대상**: 동일 파일들
- **작업 내용**: `ClaimState.candidates`에 `specificity` 추가, `noteClaim`에
  **마지막 optional** 파라미터 `specificity: Specificity | null = null` + boolean 반환.
  design.md "판정 순서" 1–6 구현. 테스트 시나리오(스펙 요구 5종 + 리뷰 추가분):
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
  - **uncertain 확정 복귀**: null-spec 충돌로 uncertain 선적재된 prop에 important
    (또는 inline) 도착 → 채택 + `uncertain.delete`(현행 1084·1089행 동작을 테스트로
    처음 고정 — design.md 판정 순서 2·3)
  - **var 교차 2방향**(design.md "var() 방향 전환"): ① verdict true + var 보호 —
    승자 리터럴 vs 현재 author var() → candidates는 리터럴 승자, out은 var 유지
    (의도된 비대칭) ② verdict false + var 패자 — 낮은 spec var() 후속 도착 → 쓰기
    막힘, 승자 리터럴 유지(토큰 소멸이 의도임을 고정)
  - 기존 `noteClaim` 테스트(742행~) 무수정 green(하위호환 확인)
- **검증**:
  - [x] 위 시나리오 red→green, 기존 테스트 무수정 green — 단 `css-resolve.test.ts:790`
    ·`:1372`의 `[computed]` 단언은 픽스처 충돌이 known-spec이면 새 판정에서 승자
    확정으로 red 전환될 수 있다. 해당 시 픽스처를 null-spec 셀렉터로 조정하거나
    단언을 새 의도로 갱신(예외 허용 — 이유를 커밋에 남길 것)

### Task 4: 스레딩 + 쓰기 게이트 + 수용 테스트

- **변경 대상**: `src/content/css-resolve.ts`(`collectRulesForElement`·
  `applyDeclarations`·`extractVarPropsFromCssText`·`extractVarPropsFromMap`) + 테스트
- **작업 내용**:
  1. `collectRulesForElement`: 규칙당 `spec = hasOpaqueCascadeContext(rule) ? null :
     matchedSpecificity(el, rule.selectorText)` 1회 계산, 세 호출에 전달. `@layer`/
     `@scope` 소속 규칙은 `null`, inline 패스는 `null`, **`customPropsOnly`면 계산
     자체를 건너뛰고 `null`**(그 경로는 noteClaim 도달 선언 0개 — design.md).
  2. `applyDeclarations`(쓰기 2지점): `noteClaim` verdict `false`면 out 쓰기 skip.
     verdict `true`면 기존 `shouldOverwriteSpecified` 게이트 그대로(토큰 보호 유지).
     **부기 3지점은 게이트 밖 유지** — `claims.important.add`(954·975행)와 값 빈
     pending longhand의 important 기록(932행)이 게이트 안으로 들어가면 후속 중요도
     판정이 무너진다.
  3. `extractVarPropsFromMap`: **직접 선언 prop**만 `noteClaim` verdict 게이트 추가
     (claims 없으면 통과). **직접 prop verdict가 `false`면 그 규칙의 파생 전개
     (`claimBorderProp`·split)도 통째로 스킵**(design.md "역할 분리" — 리뷰 확정).
     파생 claim 자체는 `noteClaim`을 태우지 않는다(무변경).
  4. **수용 테스트**(스펙의 red→green 기준): 비공개 `applyDeclarations`를 export하지
     않고 공개 `collectSpecifiedStylesWithSources` 경로로 검증. **node 트랙 스텁
     전수(누락 시 즉사 — QA 확정 목록)**:
     - vi.mock factory(css-source-cache): 기존 3키에 `getMatchingCrossOriginRules`·
       `getMatchingCrossOriginCustomPropRules`·`getCrossOriginCustomProps` 추가
       (css-resolve.ts:853-862에서 호출), `splitSelectorList`는 `vi.importActual`
       스프레드로 **실제 구현** 포함(모듈 통째 mock이라 빠지면 `matchedSpecificity`가
       undefined 호출 → TypeError)
     - 테스트별 규칙 교체는 `vi.hoisted` mutable 변수로(vi.mock hoisting 제약)
     - 전역: `window.getComputedStyle`(:300·305)·`HTMLElement`(:844 instanceof).
       `CSSStyleRule` 전역은 이 경로에서 불필요(collectTokens 전용)
     - el 스텁: `matches`·`parentElement: null` / rule 스텁: `selectorText`·
       duck-typed `style`(`length`/`item`/`getPropertyValue`/`getPropertyPriority`/
       `cssText`)·`parentRule: null`
     - 검증 prop은 `INTERESTING_PROPS` 내(`background-color` 등)로 — 반환 직전
       필터(:312)에 걸리면 out 검증이 헛빈다
     검증 항목:
     - [x] `styles[prop]` = 높은 spec 규칙 원문값 (패자 값이 안 덮음)
     - [x] uncertain 없음 → `[computed]` 대체가 일어나지 않음
     - 대조군: 한쪽 spec `null`이면 기존대로 uncertain → `[computed]` 대체
     - [x] **3규칙 교차(desync 방지)**: 높은 spec 직접 `border-top-color` → 낮은
       spec `border` shorthand → 더 낮은 spec 직접 — 파생 스킵으로 out=승자 원문
     - [x] **var 신규 uncertain 대조**: var vs var 충돌(null spec)이 새로 uncertain
       되는 케이스 — out이 var로 남는 한 `:1049` 가드로 `[computed]` 대체가 없음을
       고정(리터럴이 out을 점유하는 조합이 존재하면 대조 테스트로 의도 명시)
  5. `noteClaim`·`shouldOverwriteSpecified`·`resolveUncertainSpecified` 인접 주석을
     새 역할 분리(승자 판정 vs 표기 보호)에 맞게 갱신 — `css-resolve.ts:1037` 부근
     "specificity를 모르므로" 문구는 이제 거짓이 된다. **ARCHITECTURE.md "CSSOM
     shorthand 한계 우회"의 "specificity는 여전히 무시하는 의도된 근사" 문구도 대조
     갱신**(직접 선언 경로에선 거짓이 되고 파생 경로만 참으로 남는다 — /push
     트라이아지에 맡기지 말고 이 태스크에서 처리).
- **검증**:
  - [x] `pnpm test` 전체 green + `pnpm typecheck` 통과
  - [x] `shouldOverwriteSpecified`·`resolveUncertainSpecified` 시그니처·동작 무변경
    (git diff로 확인 — 스코프 밖 명시 항목)
  - [x] cross-origin 경로(`mergeCrossOriginDecls`) diff 없음(design.md 확인 결과대로)
  - [x] 부기 3지점(954·975·932행 상당)이 verdict 게이트 밖에 있음(코드 리뷰 항목)
  - [ ] 기존 e2e green — 로컬 전수 실행 대신 push 후 CI 결론으로 확인(`e2e/style-*.spec.ts`
    14개가 specified 값 단정을 포함 — uncertain 감소로 값 표기가 바뀌면 여기서 잡힌다)

## 테스트 계획

- **단위 테스트**: Task 1–4에 인라인(위 참조). 전부 node 트랙(`css-resolve.test.ts`),
  DOM 불필요(el·decl 스텁).
- **e2e 시나리오** (`/e2e-write` 입력 후보 — 선택): "픽스처 페이지에 같은 속성을 다른
  값으로 선언한 specificity 다른 규칙 2개(`.btn` vs `button`)가 있을 때, 요소 선택
  후 CSS 뷰에 높은 specificity 규칙의 원문 hex가 표시되고 `rgb(` 표기가 없다."
  실브라우저 CSSOM 검증이라 가치 있으나 스펙 필수 검증은 단위+typecheck — 구현 보고의
  "e2e 영향" 플래그로 판단. 픽스처는 신규 페이지(`e2e/fixtures/pages/*.html`) 추가
  방식(기존 `style-*.spec.ts` 패턴).
- **수동 테스트**:
  - [ ] google.com 검색 버튼 선택 → 편집 탭의 `background-color`가 `#f8f9fa` 원문
  - [ ] 같은 선택의 CSS 뷰에도 `#f8f9fa` 원문과 승자 selector가 표시
  - [ ] 인스펙터 툴팁: var vs var 충돌(문서순≠specificity) 케이스에서 토큰 **이름**이
    승자 규칙 것으로 표시(색·표시값은 computed라 전후 동일 — 실효 범위 한정)
  - [ ] `@layer` 쓰는 사이트에서 layer 충돌 prop이 기존처럼 computed 표시(회귀 아님)
  - [ ] `@scope` 쓰는 사이트에서 scope 충돌 prop이 기존처럼 computed 표시(회귀 아님)
  - [ ] naver.com(cross-origin 시트) 표시 기존과 동일
  - [ ] 다운스트림(design.md "다운스트림 영향"): 변경 다이얼로그 as-is 값·섹션 기본
    펼침 회귀 없음, 4면 균일 padding에서 `collapseShorthands` 축약 관찰
  - [ ] CSS 뷰 초안 존재 상태에서 class 편집(재수집) → "미적용 초안" 배너 오탐 없음

## 구현 순서 권장

Task 1 → 2 → 3 → 4 순차(각 태스크가 앞의 산출을 소비). 병렬 없음. 각 태스크 종료마다
`pnpm test` green 확인 후 다음으로.

## 가이드 영향: 없음

내부 판정 정밀화 — 레이아웃·라벨·조작 흐름은 불변이고 표시 값·출처 정확도만 개선.
