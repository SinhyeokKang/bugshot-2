# 스타일 패널 필드 정확성·일관성 수정 묶음 — 구현 태스크

## 선행 조건

- 권한·env·의존성 추가 없음. 순수 로컬 변경.
- 작업 전 `pnpm test` baseline green 확인.
- 기존 테스트: `colorLiteral.test.ts`, `hexUtils.test.ts`, `tokenUtils.test.ts` (styleEditor/`__tests__`).

태스크는 **테스트 우선**. 각 순수 함수는 테스트를 먼저 작성/갱신하고 구현한다. 시급도순(🔴 → 🟡 → ⚪) + 순수함수 우선.

## 태스크

### Task 1 [A][🔴]: 색상 리터럴 인식 확대 (swatch)
- **변경 대상**: `src/sidepanel/tabs/styleEditor/colorLiteral.ts`, `__tests__/colorLiteral.test.ts`
- **작업 내용**: `RGB_FN_RE`를 `COLOR_FN_RE = /^(rgb|rgba|hsl|hsla|hwb|oklch|oklab|lab|lch|color)\(/i`로 교체. **함수형 색상 정규식만** `categorizeToken`(css-resolve.ts)과 동일하게 맞춘다.
  - 주의(의도된 차이): `isRenderableColorLiteral`은 `NAMED_COLORS` 150여 개를 추가로 인정(categorizeToken은 `transparent`/`currentColor`만 regex). 그리고 `currentcolor`는 categorizeToken이 color로 분류하지만 여기서는 **계속 false**(좌표 밖 미해결 — swatch 의미 없음). "categorizeToken과 완전 동일"이 아니라 "함수형 색상 목록 정렬"임.
  - `color-mix()`는 이번 목록에서 **제외**(116+ 렌더 가능하나 이번 스코프 밖 — swatch 미표시 허용). tasks/design에 명시.
- **검증**:
  - [ ] 테스트: `hsl(...)`/`hsla(...)`/`hwb(...)`/`oklch(...)`/`oklab(...)`/`lab(...)`/`lch(...)`/`color(...)` → true
  - [ ] 테스트: 대소문자·선행 공백(`  HSL(...)`) 처리 확인
  - [ ] 테스트: hex(3/4/6/8)·rgb/rgba·named·transparent → true 유지, `currentcolor`·`color-mix(...)`·빈값·`12px`·`solid` → false
  - [ ] `pnpm test --run colorLiteral`

### Task 2 [C][🔴]: SelectProp 빈 옵션 리셋
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx` (SelectProp), 필요 시 작은 순수 헬퍼 + 테스트
- **작업 내용**: `onValueChange={set}` → `onValueChange={(v) => set(v === "__empty__" ? "" : v)}`. 헬퍼 추출은 선택 — 인라인 유지 시 삭제 동작은 아래 e2e가 커버하므로 별도 단위 테스트 불요(`set("")`은 styleHooks가 이미 prop 삭제).
- **검증**:
  - [ ] `(none)` 옵션 선택 시 `inlineStyle[prop]`가 삭제됨(garbage 미기록)
  - [ ] 일반 옵션 선택은 그대로 set
  - [ ] **회귀(내보내기)**: 다른 prop이 남아 있는 상태에서 `(none)` 선택 후 StyleChangesDialog/이슈 본문 As-is·To-be 표에 `__empty__` 문자열이 없는지 확인
  - [ ] **회귀(영속)**: `set("")` 후 reload 세션 복원 시 해당 prop이 inlineStyle에서 실제 삭제 유지
  - [ ] (헬퍼 추출 시) 단위 테스트 `__empty__`→`""`, 그 외 통과

### Task 3 [D][J-소수][🔴]: 값 정규화 순수 함수 추출 + 라이브 적용
- **변경 대상**: `src/sidepanel/tabs/styleEditor/valueFormat.ts`(신규) + `__tests__/valueFormat.test.ts`(신규), `ValueCombobox.tsx`
- **작업 내용**:
  1. `finalizeValue(category, next)` 순수 함수 신규(설계 시그니처). length 정규식 `/^-?(\d+(\.\d+)?|\.\d+)$/`로 `.5` 포함.
  2. ValueCombobox의 내부 `finalize`를 `finalizeValue` 호출로 교체.
  3. `onValueChange`(라이브) 경로를 `maybeNormalize` → `finalizeValue(category, v.trim())`로 교체. `maybeNormalize`가 더 안 쓰이면 제거(내 변경이 만든 고아).
- **검증**:
  - [ ] 테스트: `("length","16")→"16px"`, `("length","-8")→"-8px"`, `("length",".5")→".5px"`, `("length","0")→"0px"`, `("length","16px")→"16px"`(이중 px 금지), `("length","calc(1px + 2px)")→통과`, `("length","var(--x)")→"var(--x)"`(px 오염 금지), `("length","1.")→"1."`(부분입력 통과), `("color","fff")→"#ffffff"`, `("color","hsl(0 0% 0%)")→통과`, `(undefined,"x")→"x"`, `("length","")→""`
  - [ ] trim 위치 확인: 호출부가 `finalizeValue(category, v.trim())`이므로 `" 16 "`→`"16px"`
  - [ ] 라이브: padding-top에 `16` 타이핑 중 페이지에 `16px` 적용(수동/e2e)
  - [ ] 팝오버 닫아도 값 불변
  - [ ] **성능(D reflow)**: length 필드에 빠른 연속 입력 시 라이브 px 적용으로 인한 눈에 띄는 버벅임/지연 없음(수동). throttle은 도입 안 함(applyStyles는 기존에도 매 입력 호출).
  - [ ] `pnpm test --run valueFormat`

### Task 4 [G][🟡]: `--_` private alias 토큰 숨김
- **변경 대상**: `src/sidepanel/tabs/styleEditor/tokenUtils.ts`, `__tests__/tokenUtils.test.ts`
- **작업 내용**: `isInternalToken`에 `|| name.startsWith("--_")` 추가.
- **순서**: Task 5의 `--_` 필터 검증이 이 변경에 의존(`extractTokenRefs`가 `isInternalToken` 호출). **Task 4 → Task 5** 순서로. 같은 `tokenUtils.test.ts`를 둘이 건드리니 `--_` 필터 검증은 Task 4 쪽에 둔다.
- **검증**:
  - [ ] 테스트: `--_x`/`--tw-x` → true, `--color-x`/`--space-1` → false
  - [ ] 테스트: `extractTokenRefs("var(--_x)")` → `[]`(internal 필터)
  - [ ] ValueCombobox 드롭다운·family에 `--_` 토큰 미노출(수동)

### Task 5 [I][🟡]: extractTokenRefs fallback 토큰 제외
- **변경 대상**: `src/sidepanel/tabs/styleEditor/tokenUtils.ts`, `__tests__/tokenUtils.test.ts`
- **작업 내용**: top-level `var()` primary 토큰만 추출(중첩 fallback `var()` skip). multiplier 계산은 primary 위치 기준 유지. fallback skip 후 닫는 `)`는 **바깥 var()의 `)`**를 잡아야 `calc(var(--g)*2)`의 `*2`를 정확히 귀속(회귀 주의).
- **검증**:
  - [ ] 테스트: `var(--x, var(--y))` → `[--x]`, `calc(var(--a) + var(--b))` → `[--a,--b]`, `var(--a)` → `[--a]`
  - [ ] 테스트(multiplier): `calc(var(--g)*2)` → `[{--g, x2}]`, `calc(2 * var(--g))` → `[{--g, x2}]`, `calc(.5 * var(--g))` → `[{--g, x0.5}]`, `calc(-1 * var(--g))` → `[{--g, x-1}]`
  - [ ] (Task 4 머지 후) `--tw-`/`--_` 포함 입력 internal 필터 — 단 `--_` 필터 단위 케이스는 Task 4에 위치
  - [ ] `pnpm test --run tokenUtils`

### Task 6 [B][🟡]: 선택 필드 우측 미리보기 — 토큰 원시값 (앵커)
- **변경 대상**: `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx` + `__tests__/` (`rightHintText` 단위 테스트 **필수**)
- **작업 내용**: `rightHintText(category, computed, tokenRawValue, compact)` 순수 헬퍼 추가(**추출 필수** — ValueCombobox에 data-testid가 없어 e2e 자동화가 어려워 단위 테스트가 유일한 자동 그물). 토큰 분기 두 곳(현 221-225, 255-259)의 우측 힌트를 이 헬퍼로 교체. color/image 토큰은 `findTokenValue(tokens, tokenRefs[0]?.name)`(value 없으면 placeholderTokenRefs) 원시값 표시(compact 포함 **항상 표시**), length/number는 computed 유지.
- **표시**: 우측 `<span>`에 `max-w-[120px] truncate`(드롭다운 `TokenItem` 우측과 동일 패턴)로 좁은 셀 오버플로 방지.
- **검증**:
  - [ ] **단위 테스트(필수)**: `rightHintText("color", _, "hsl(0 0% 0%)", false)` → 원시값, `("length", "16px", _, false)` → `"16px"`, `("length","16px",_,true)` → `shortValue`, primary 토큰 미해결(`tokenRawValue===undefined`) → null
  - [ ] color 토큰 선택 시 선택 필드 우측에 원시값(`hsl(...)` 등) 표시 — 드롭다운 `TokenItem` 우측과 일치(수동)
  - [ ] length 토큰은 기존 computed 힌트 유지(회귀 없음)
  - [ ] **엣지**: `var(--x, var(--y))`에서 primary `--x`가 색 토큰 목록에 없고 fallback `--y`만 색일 때 — Task 5로 `--x`만 추출되므로 우측 힌트는 빈다(의도된 동작, 무시). 케이스 인지만.

### Task 7 [F][🟡]: BoxShadow 멀티레이어 표시 누락
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx` (BoxShadowProp)
- **작업 내용**: `count = Math.max(placeholderParts.length, 1)` → `Math.max(valueParts.length, placeholderParts.length, 1)`.
- **검증**:
  - [ ] value가 2-layer인데 placeholder 1-layer일 때 입력칸 2개 노출(수동)
  - [ ] 단일 레이어 회귀 없음
  - [ ] Tailwind `ring`/`shadow` 유틸 적용 요소(레이어가 `--tw-` 참조뿐) — `splitShadowLayers`가 internal-only 레이어를 필터(157-174)하므로 `valueParts.length===0` → placeholder 폴백되는지 확인(의도된 동작)

### Task 8 [H][🟡]: AlignmentProp computed 폴백
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx` (AlignmentProp)
- **작업 내용**: `resolvedValue` 매핑 확장 — `start`→`left`, `end`→`right`, 4탭에 없는 값은 `left` 폴백. 토글 해제 조건 유지.
- **검증**:
  - [ ] computed `start`/`end`/`match-parent`에서도 한 탭 active 표시
  - [ ] left/center/right/justify 명시값 토글 회귀 없음

### Task 9 [E][🟡, 회귀 위험 — e2e 필수]: linked 상태 동기화 + 자동 해제
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx` (useLinkedProps)
- **작업 내용**:
  1. 현 `useState` 이니셜라이저를 `computeLinked()`/`sidesEqual()` 함수로 추출.
  2. selKey = `${selector}@${capturedAt}` 변경 시 `useEffect`로 `setLinked(computeLinked())` 재설정(같은 키 동안 수동 토글 보존).
  3. **effective linked = `linked && sidesEqual`** — 4면 값이 어긋나면 자동 해제. `onLinkedCommit`·LinkToggle 표시는 effectiveLinked 기준.
- **검증**:
  - [ ] 4면 동일 요소(linked=true) → 4면 상이 요소로 repick → linked 재판정, 한 면 입력이 4면 안 덮음 (**e2e**)
  - [ ] 같은 요소에서 한 면 편집해 4면 어긋나면 effectiveLinked 자동 false (**e2e**)
  - [ ] 같은 요소 내 수동 토글이 다음 렌더에 안 풀림
  - [ ] **동일 selector 다른 인스턴스** repick 시에도 capturedAt로 재판정됨
  - [ ] reload 세션 복원 후 linked 합리적 표시(복원 순서로 빈 값 false 고착 없는지)

### Task 10 [J 잔여][⚪]
- **변경 대상**: `StyleEditorPanel.tsx`(transition 라벨), `tokenUtils.ts`(isTokenValue 정규식화)
- **작업 내용**:
  - transition 라벨 `transition` → `transition-property`(외과적, prop 불변)
  - `isTokenValue`: `v.includes("var(")` → `/(^|[\s,(])var\(/.test(v)`
- **검증**:
  - [ ] 라벨 표기만 변경, 동작 불변
  - [ ] 테스트: `isTokenValue("var(--x)")` true, `"linear-gradient(...)"` false, `"avar("` 같은 오탐 false
  - [ ] 단축 hex 라이브(Task 3 통합)·`.5` 소수(Task 3)는 별도 작업 없이 해소 확인

### Task 11 [J-container-query][⚪, 생략 가능]
- **변경 대상**: `StylePropEditors.tsx` (`Row2`, QuadProp/RadiusProp grid)
- **작업 내용**: 매우 좁은 패널에서 4열→2열 리플로우(`@container`). **시각 회귀 위험 — 강행 전 확인 권장.** 우선순위 최하, 생략 가능.
- **검증**:
  - [ ] 좁은 패널에서 텍스트 과잘림 완화, 기본 폭에서 회귀 없음(수동)

## 테스트 계획

- **단위 테스트(Vitest)**:
  - `colorLiteral.test.ts` — 함수형 색상 true/false (Task 1)
  - `valueFormat.test.ts`(신규) — `finalizeValue` 카테고리·엣지 (Task 3)
  - `tokenUtils.test.ts` — `isInternalToken --_`(Task 4), `extractTokenRefs` fallback/multiplier(Task 5), `isTokenValue`(Task 10)
  - SelectProp 역변환 헬퍼(추출 시, Task 2), `rightHintText`(추출 시, Task 6)
- **e2e 시나리오**(`/e2e-write` 입력 후보) — 기존 인프라(`setQuadLinkedValue`/`setQuadSideValue`/`selectStyleValue`/`toHaveCSS`/`changes-row[data-prop]`)로 자동화 가능, **새 data-testid 거의 불필요**:
  - "padding QuadProp의 top 단면(`setQuadSideValue idx=0`)에 `16`을 타이핑하면 페이지 요소에 `16px`가 라이브 적용된다(`toHaveCSS`)" (D)
  - "display 셀렉트에서 `(none)`을 고르면 inline display가 제거되고, 다른 prop이 남은 상태에서도 StyleChanges As-is/To-be에 `__empty__` 문자열이 없다" (C)
  - "4면 동일 요소에서 linked 켠 뒤 4면 상이 요소로 다시 선택하면 한 면 입력이 4면을 덮지 않는다" (E) — **fixture 전제**: `e2e/...basic.html`의 대상 요소(예 `#el2`) padding을 4면 상이하게 수정 필요(현재 동일). e2e-write 시 fixture 보강.
  - (B 우측 힌트는 data-testid 부재로 e2e 제외 — Task 6 단위 테스트로 대체)
- **수동 테스트**(시각 정합):
  - hsl/oklch 색 직접 입력 시 좌측 swatch 표시 (A)
  - color 토큰 선택 시 우측 원시값 미리보기 (B)
  - BoxShadow 멀티레이어 표시 (F), Alignment computed 폴백 (H)
  - 좁은 패널 리플로우 (Task 11, 적용 시)

## 구현 순서 권장

1. **순수 함수 먼저**: Task 1(colorLiteral), Task 3(valueFormat)은 독립·병렬 가능. tokenUtils는 **Task 4 → Task 5** 순서(extractTokenRefs가 isInternalToken 의존 + 같은 `tokenUtils.test.ts` 공유).
2. **컴포넌트 소비측**: Task 2(SelectProp), Task 6(우측 힌트, Task 1/5 의존), Task 7·8.
3. **회귀 위험**: Task 9(linked) — 단독 집중, e2e 검증.
4. **잔여·생략 가능**: Task 10, Task 11.

Task 5(extractTokenRefs)는 Task 6(우측 힌트가 tokenRefs 소비)보다 먼저. Task 1은 Task 6의 swatch 표시 전제.

## 가이드 영향

스타일 패널은 사용자 노출 UX다. 대부분 버그 수정(동작 교정)이라 신규 기능 설명은 불필요하나, 색상 입력/토큰 미리보기 동작이 가이드에 기술돼 있으면 문구 정합 확인 필요.
- `guide/ko`·`guide/en`의 element 스타일 편집 페이지(예: `element/styling.md` 류) — 색상 입력·디자인 토큰·미리보기 서술이 있으면 A/B 동작과 대조. 대부분 변경 불필요 예상.
- 구현 후 `/guide`로 ko·en 대조(`guide/AUTHORING.md` 규칙). 실제 갱신 대상 페이지는 구현 시점에 확정.
