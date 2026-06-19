# 스타일 패널 필드 정확성·일관성 수정 묶음 — 구현 태스크

## 선행 조건

- 권한·env·의존성 추가 없음. 순수 로컬 변경.
- 작업 전 `pnpm test` baseline green 확인.
- 기존 테스트: `colorLiteral.test.ts`, `hexUtils.test.ts`, `tokenUtils.test.ts` (styleEditor/`__tests__`).

태스크는 **테스트 우선**. 각 순수 함수는 테스트를 먼저 작성/갱신하고 구현한다. 시급도순(🔴 → 🟡 → ⚪) + 순수함수 우선.

## 태스크

### Task 1 [A][🔴]: 색상 리터럴 인식 확대 (swatch)
- **변경 대상**: `src/sidepanel/tabs/styleEditor/colorLiteral.ts`, `__tests__/colorLiteral.test.ts`
- **작업 내용**: `RGB_FN_RE`를 `COLOR_FN_RE = /^(rgb|rgba|hsl|hsla|hwb|oklch|oklab|lab|lch|color)\(/i`로 교체. `categorizeToken`(css-resolve.ts) 색상 정규식과 동일.
- **검증**:
  - [ ] 테스트: `hsl(...)`/`hsla(...)`/`hwb(...)`/`oklch(...)`/`oklab(...)`/`lab(...)`/`lch(...)`/`color(...)` → true
  - [ ] 테스트: hex(3/4/6/8)·rgb/rgba·named·transparent → true 유지, `currentcolor`·빈값·`12px`·`solid` → false 유지
  - [ ] `pnpm test --run colorLiteral`

### Task 2 [C][🔴]: SelectProp 빈 옵션 리셋
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx` (SelectProp), 필요 시 작은 순수 헬퍼 + 테스트
- **작업 내용**: `onValueChange={set}` → `onValueChange={(v) => set(v === "__empty__" ? "" : v)}`. (선택: `fromSelectValue(v)` 순수 헬퍼로 빼고 테스트)
- **검증**:
  - [ ] `(none)` 옵션 선택 시 `inlineStyle[prop]`가 삭제됨(garbage 미기록)
  - [ ] 일반 옵션 선택은 그대로 set
  - [ ] (헬퍼 추출 시) 단위 테스트 `__empty__`→`""`, 그 외 통과

### Task 3 [D][J-소수][🔴]: 값 정규화 순수 함수 추출 + 라이브 적용
- **변경 대상**: `src/sidepanel/tabs/styleEditor/valueFormat.ts`(신규) + `__tests__/valueFormat.test.ts`(신규), `ValueCombobox.tsx`
- **작업 내용**:
  1. `finalizeValue(category, next)` 순수 함수 신규(설계 시그니처). length 정규식 `/^-?(\d+(\.\d+)?|\.\d+)$/`로 `.5` 포함.
  2. ValueCombobox의 내부 `finalize`를 `finalizeValue` 호출로 교체.
  3. `onValueChange`(라이브) 경로를 `maybeNormalize` → `finalizeValue(category, v.trim())`로 교체. `maybeNormalize`가 더 안 쓰이면 제거(내 변경이 만든 고아).
- **검증**:
  - [ ] 테스트: `("length","16")→"16px"`, `("length","-8")→"-8px"`, `("length",".5")→".5px"`, `("length","16px")→"16px"`(이중 px 금지), `("length","calc(1px + 2px)")→통과`, `("color","fff")→"#ffffff"`, `("color","hsl(0 0% 0%)")→통과`, `(undefined,"x")→"x"`, `("length","")→""`
  - [ ] 라이브: padding-top에 `16` 타이핑 중 페이지에 `16px` 적용(수동/e2e)
  - [ ] 팝오버 닫아도 값 불변
  - [ ] `pnpm test --run valueFormat`

### Task 4 [G][🟡]: `--_` private alias 토큰 숨김
- **변경 대상**: `src/sidepanel/tabs/styleEditor/tokenUtils.ts`, `__tests__/tokenUtils.test.ts`
- **작업 내용**: `isInternalToken`에 `|| name.startsWith("--_")` 추가.
- **검증**:
  - [ ] 테스트: `--_x`/`--tw-x` → true, `--color-x`/`--space-1` → false
  - [ ] ValueCombobox 드롭다운·family에 `--_` 토큰 미노출(수동)

### Task 5 [I][🟡]: extractTokenRefs fallback 토큰 제외
- **변경 대상**: `src/sidepanel/tabs/styleEditor/tokenUtils.ts`, `__tests__/tokenUtils.test.ts`
- **작업 내용**: top-level `var()` primary 토큰만 추출(중첩 fallback `var()` skip). multiplier 계산은 primary 위치 기준 유지.
- **검증**:
  - [ ] 테스트: `var(--x, var(--y))` → `[--x]`, `calc(var(--a) + var(--b))` → `[--a,--b]`, `var(--a)` → `[--a]`, `calc(var(--g)*2)` → `[{--g, x2}]`, `calc(2 * var(--g))` → `[{--g, x2}]`, `--tw-`/`--_` 포함 입력은 internal 필터
  - [ ] `pnpm test --run tokenUtils`

### Task 6 [B][🟡]: 선택 필드 우측 미리보기 — 토큰 원시값 (앵커)
- **변경 대상**: `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx` (+ 가능 시 `rightHintText` 순수 테스트)
- **작업 내용**: `rightHintText(category, computed, tokenRawValue, compact)` 헬퍼 추가. 토큰 분기 두 곳(현 221-225, 255-259)의 우측 힌트를 이 헬퍼로 교체. color/image 토큰은 `findTokenValue(tokens, tokenRefs[0]?.name)`(또는 placeholderTokenRefs) 원시값 표시, length/number는 computed 유지.
- **검증**:
  - [ ] color 토큰 선택 시 선택 필드 우측에 원시값(`hsl(...)` 등) 표시 — 드롭다운 `TokenItem` 우측과 일치
  - [ ] length 토큰은 기존 computed 힌트 유지(회귀 없음)
  - [ ] (헬퍼 테스트 시) 카테고리별 반환 검증

### Task 7 [F][🟡]: BoxShadow 멀티레이어 표시 누락
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx` (BoxShadowProp)
- **작업 내용**: `count = Math.max(placeholderParts.length, 1)` → `Math.max(valueParts.length, placeholderParts.length, 1)`.
- **검증**:
  - [ ] value가 2-layer인데 placeholder 1-layer일 때 입력칸 2개 노출(수동)
  - [ ] 단일 레이어 회귀 없음

### Task 8 [H][🟡]: AlignmentProp computed 폴백
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx` (AlignmentProp)
- **작업 내용**: `resolvedValue` 매핑 확장 — `start`→`left`, `end`→`right`, 4탭에 없는 값은 `left` 폴백. 토글 해제 조건 유지.
- **검증**:
  - [ ] computed `start`/`end`/`match-parent`에서도 한 탭 active 표시
  - [ ] left/center/right/justify 명시값 토글 회귀 없음

### Task 9 [E][🟡]: linked 상태 요소 재선택 동기화 (회귀 위험)
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx` (useLinkedProps)
- **작업 내용**: 현 `useState` 이니셜라이저를 `computeLinked()` 함수로 추출. selection 식별 키(`selection?.selector`) 변경 시 `useEffect`로 `setLinked(computeLinked())` 재설정. 같은 키 동안 수동 토글 보존.
- **검증**:
  - [ ] 4면 동일 요소(linked=true) → 4면 상이 요소로 repick → linked가 false로 재판정, 한 면 입력이 4면 안 덮음
  - [ ] 같은 요소 내 수동 토글이 다음 렌더에 안 풀림
  - [ ] reload 세션 복원 후 linked 합리적 표시

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
- **e2e 시나리오**(`/e2e-write` 입력 후보):
  - "padding-top에 `16`을 타이핑하면 페이지 요소에 `16px`가 라이브 적용된다" (D)
  - "display 셀렉트에서 `(none)`을 고르면 inline display가 제거되고 StyleChanges에 `__empty__`가 안 남는다" (C)
  - "4면 동일 요소에서 linked 켠 뒤 4면 상이 요소로 다시 선택하면 한 면 입력이 4면을 덮지 않는다" (E)
- **수동 테스트**(시각 정합):
  - hsl/oklch 색 직접 입력 시 좌측 swatch 표시 (A)
  - color 토큰 선택 시 우측 원시값 미리보기 (B)
  - BoxShadow 멀티레이어 표시 (F), Alignment computed 폴백 (H)
  - 좁은 패널 리플로우 (Task 11, 적용 시)

## 구현 순서 권장

1. **순수 함수 먼저(병렬 가능)**: Task 1(colorLiteral), Task 3(valueFormat), Task 4·5(tokenUtils) — 서로 독립.
2. **컴포넌트 소비측**: Task 2(SelectProp), Task 6(우측 힌트, Task 1/5 의존), Task 7·8.
3. **회귀 위험**: Task 9(linked) — 단독 집중, e2e 검증.
4. **잔여·생략 가능**: Task 10, Task 11.

Task 5(extractTokenRefs)는 Task 6(우측 힌트가 tokenRefs 소비)보다 먼저. Task 1은 Task 6의 swatch 표시 전제.

## 가이드 영향

스타일 패널은 사용자 노출 UX다. 대부분 버그 수정(동작 교정)이라 신규 기능 설명은 불필요하나, 색상 입력/토큰 미리보기 동작이 가이드에 기술돼 있으면 문구 정합 확인 필요.
- `guide/ko`·`guide/en`의 element 스타일 편집 페이지(예: `element/styling.md` 류) — 색상 입력·디자인 토큰·미리보기 서술이 있으면 A/B 동작과 대조. 대부분 변경 불필요 예상.
- 구현 후 `/guide`로 ko·en 대조(`guide/AUTHORING.md` 규칙). 실제 갱신 대상 페이지는 구현 시점에 확정.
