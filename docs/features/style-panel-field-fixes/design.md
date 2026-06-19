# 스타일 패널 필드 정확성·일관성 수정 묶음 — 기술 설계

## 개요

대부분 기존 순수 함수·작은 컴포넌트 분기의 국소 교정이다. 새 타입·스토리지·메시지·권한이 없다. 핵심 전략은 **단일 진실 정렬**: 색상 인식은 `categorizeToken`(css-resolve.ts)의 정규식에, 값 정규화는 하나의 `finalizeValue` 순수 함수에, 토큰 internal 판정은 `firstVarName`(css-resolve.ts)과 동일 기준에 맞춘다. 회귀 위험은 두 곳(D 라이브 적용 경로, E linked 상태 동기화)에 집중되며 별도로 표시한다.

각 항목은 PRD와 동일한 ID(A~J)로 추적한다.

## 변경 범위

### `src/sidepanel/tabs/styleEditor/colorLiteral.ts` — [A]
- 현재: `isRenderableColorLiteral`이 `HEX_RE` + `RGB_FN_RE = /^rgba?\s*\(/i` + `NAMED_COLORS`만 인정.
- 변경: 함수형 색상 정규식을 `categorizeToken`과 동일하게 확장.
  ```ts
  const COLOR_FN_RE = /^(rgb|rgba|hsl|hsla|hwb|oklch|oklab|lab|lch|color)\(/i;
  ```
  `RGB_FN_RE`를 `COLOR_FN_RE`로 교체. `currentcolor`는 계속 제외(좌표 밖 미해결), `transparent`는 `NAMED_COLORS`로 유지.

### `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx` — [B][D][I-소비측][J-일부]
- **[B] 우측 미리보기**: 트리거 토큰 분기(현 221-225, 255-259)의 우측 힌트를 color 토큰까지 확장. `showComputedHint`(length/number)는 그대로 두고, color/image 토큰일 때는 **첫 토큰 ref의 원시값**(`findTokenValue(tokens, ref.name)`)을 우측에 표시. 드롭다운 `TokenItem`(우측 `token.value`)과 동일 의미.
  - 신규 순수 헬퍼(파일 하단, `showComputedHint` 옆):
    ```ts
    function rightHintText(
      category: TokenCategory | undefined,
      computed: string,
      tokenRawValue: string | undefined,
      compact: boolean,
    ): string | null
    ```
    length/number → computed(`compact`면 `shortValue`), color/image 토큰 → `tokenRawValue`, 그 외 null. 호출부에서 `tokenRawValue = findTokenValue(tokens, tokenRefs[0]?.name)`.
- **[D] 라이브 정규화**: `finalize`(현 144-156)를 파일 밖 순수 함수 `finalizeValue(category, next)`로 추출(신규 모듈, 아래). `onValueChange`(현 291-296)의 라이브 set 경로를 `maybeNormalize` 대신 `finalizeValue(category, v.trim())`로 교체해 length도 px가 라이브 부착되게 한다. `commit`/`handleOpenChange` close 경로도 동일 `finalizeValue` 사용(중복 제거).
  - 주의: 라이브에 px를 붙이면 빈 입력·부분 입력 처리 필요. `finalizeValue`는 빈 문자열·정규식 미매치 입력을 그대로 통과시켜(현 동작 유지) 무한 px 부착을 막는다.
- **[J-소수]** `finalizeValue`의 length 정규식을 `/^-?(\d+(\.\d+)?|\.\d+)$/`로 넓혀 `.5` 같은 선행점 소수도 px 부착(multiplier 정규식 `-?\d*\.?\d+`과 정합).

### `src/sidepanel/tabs/styleEditor/valueFormat.ts` (신규) — [D][J]
- `finalizeValue(category, next)`와 라이브/커밋 공용 정규화 로직을 담는 순수 모듈. `hexUtils`의 `normalizeHexInput`/`expandShortHex`를 조합.
  ```ts
  export function finalizeValue(category: TokenCategory | undefined, next: string): string;
  ```
  - color: `expandShortHex(normalizeHexInput(next)) ?? normalizeHexInput(next)`
  - length + 순수 숫자(`.5` 포함): `${next}px`
  - 그 외: `next`
- 추출 이유: ValueCombobox 내부 `useCallback` 클로저라 단위 테스트 불가. 순수 함수로 빼 테스트 + 라이브/커밋 단일 출처.

### `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx` — [C][E][F][H]
- **[C] SelectProp 빈 옵션 역변환**: `onValueChange={set}`(현 236)을 `onValueChange={(v) => set(v === "__empty__" ? "" : v)}`로. 셀렉트 sentinel을 스토어로 흘리지 않는다. `set("")`은 styleHooks에서 이미 prop 삭제 처리.
- **[E] linked 상태 동기화**: `useLinkedProps`(현 65-94)의 `linked`를 요소 정체성 변화에 맞춰 재판정.
  - selection 식별 키를 도출(`selection?.selector ?? null` 등 안정 키)하고, 키가 바뀌면 현재 값 기준으로 linked 기본값을 재계산.
  - 구현: `const selKey = useEditorStore(s => s.selection?.selector ?? null);` + `useEffect(() => setLinked(computeLinked()), [selKey])`. 단, **사용자가 같은 요소에서 수동 토글한 상태는 보존**(같은 selKey 동안 useEffect 미발화). 초기 `useState`는 유지하고 selKey 변경 시에만 재설정.
  - `computeLinked()`는 현 `useState` 이니셜라이저 로직을 함수로 추출(props/inlineStyle/selection 값 비교). inlineStyle·selection은 effect 내부에서 `useEditorStore.getState()`로 읽어 deps 최소화.
- **[F] BoxShadow 레이어 수**: `count = Math.max(placeholderParts.length, 1)`(현 190)을 `Math.max(valueParts.length, placeholderParts.length, 1)`로. value 멀티레이어가 잘리지 않음. (레이어 추가 UI는 비목표)
- **[H] Alignment resolvedValue**: `resolvedValue`(현 269-270)의 매핑 확장 — `start`→`left`, `end`→`right`, 그 외 4탭(`left/center/right/justify`)에 없는 값(`match-parent` 등)은 `left`로 폴백해 항상 한 탭이 active. 토글 해제 조건(`v === resolvedValue && value`)은 유지.

### `src/sidepanel/tabs/styleEditor/tokenUtils.ts` — [G][I][J-isTokenValue]
- **[G] isInternalToken**: `--_` 추가.
  ```ts
  export function isInternalToken(name: string): boolean {
    return name.startsWith("--tw-") || name.startsWith("--_");
  }
  ```
  `firstVarName`(css-resolve.ts)·`collectTokens`의 internal 기준과 일치. `extractTokenRefs`와 ValueCombobox 토큰 필터(현 66) 양쪽에 자동 반영.
- **[I] extractTokenRefs fallback 제외**: 전역 정규식 대신 top-level `var()`의 primary 토큰만 추출. `var(` 발견 → 첫 `--name` 캡처 → 매칭 닫는 `)`까지 skip(중첩 fallback `var()`를 건너뜀). `calc(var(--a) + var(--b))`는 둘 다 top-level이라 보존, `var(--x, var(--y))`는 `--x`만. multiplier 계산(`readMultiplierAround`)은 primary 위치 기준 유지.
- **[J] isTokenValue 정밀화**: `v.includes("var(")` → `/\bvar\(/.test(v)` 또는 `/(^|[\s,(])var\(/.test(v)`로 substring 오탐 축소. (낮은 위험, 최소 변경)

### `src/sidepanel/tabs/StyleEditorPanel.tsx` — [J-라벨]
- transition 라벨/매핑 정합: `<TextProp label="transition" prop="transition-property" />`(현 386 부근)에서 라벨을 `transition-property`로 바꾸거나, 의도가 shorthand면 `prop`을 `transition`으로. **권장: 라벨을 `transition-property`로** (외과적, prop 동작 불변). 최종 선택은 구현 시 확정.

### `src/sidepanel/tabs/styleEditor/hexUtils.ts` — [J-단축hex]
- 라이브 무효값 완화: [D]에서 라이브 경로가 `finalizeValue`(=expandShortHex 포함)를 타게 되면 3/4자리 단축 hex도 라이브에서 `#`+확장 적용된다. 즉 [J 단축hex]는 [D] 통합으로 자연 해소. `hexUtils` 자체 변경은 불필요(확인만).

### 좁은 패널 리플로우 — [J-container-query]
- `Row2`(grid-cols-2)·`QuadProp`/`RadiusProp`(grid-cols-4)에 `@container` 기반 리플로우 적용 검토. CLAUDE.md가 `@tailwindcss/container-queries` 채택을 권장. **범위 주의**: 시각 회귀 위험이 있어 최소 적용(예: 매우 좁을 때 4열→2열). 구현 난도 대비 우선순위 최하 — tasks에서 마지막, 생략 가능 항목으로 표시.

## 데이터 흐름

값 입력 경로(교정 후):
```
사용자 입력
  → CommandInput.onValueChange(라이브)  → finalizeValue(category, v) → set/onLinkedCommit → applyStyles(라이브 미리보기)
  → 팝오버 close / raw item 선택(커밋)   → finalizeValue(category, v) → set/onLinkedCommit
  → SelectProp 선택                      → (v === "__empty__" ? "" : v) → set
```
- `set`/`setAllProps`는 기존대로 `inlineStyle` 갱신 + `applyStyles(tabId, nextInline)`. 변경은 라이브 경로의 정규화 단계 추가뿐.
- 표시 경로: 트리거가 `value`/`tokenRefs`/`placeholder` 분기로 swatch·우측 힌트 렌더. [A]는 swatch 게이트(`isRenderableColorLiteral`) 확장, [B]는 우측 힌트(`rightHintText`)에 토큰 원시값 추가.

## 인터페이스 설계

```ts
// colorLiteral.ts (변경)
export function isRenderableColorLiteral(v: string): boolean; // 시그니처 동일, 함수형 색상 확대

// valueFormat.ts (신규)
export function finalizeValue(category: TokenCategory | undefined, next: string): string;

// ValueCombobox.tsx (신규 내부 헬퍼)
function rightHintText(
  category: TokenCategory | undefined,
  computed: string,
  tokenRawValue: string | undefined,
  compact: boolean,
): string | null;

// tokenUtils.ts (변경)
export function isInternalToken(name: string): boolean;       // --_ 추가
export function extractTokenRefs(value: string): TokenRef[];  // fallback 제외, 시그니처 동일
export function isTokenValue(v: string): boolean;             // 정규식화
```

신규/변경 타입 없음. `TokenCategory`는 기존 `@/types/picker`.

## 기존 패턴 준수

- **테스트 우선**(CLAUDE.md): 신규 `finalizeValue`·변경 `isRenderableColorLiteral`/`isInternalToken`/`extractTokenRefs`/SelectProp 역변환은 `__tests__/*.test.ts`에 Vitest 단위 테스트 먼저.
- **순수 함수 분리**: 로직은 순수 함수(colorLiteral/valueFormat/tokenUtils), 컴포넌트는 호출만. ValueCombobox 내부 클로저 `finalize`를 모듈로 빼는 것도 이 원칙.
- **외과적 변경**: 각 항목은 해당 라인만. shorthand 충돌(비목표)·token grouping(비목표)은 손대지 않는다.
- **i18n**: 새 사용자 노출 텍스트 없음(우측 힌트는 토큰 원시값, 라벨 변경은 CSS prop 영문 리터럴). i18n 키 추가 불필요.
- **단일 진실 정렬**: 색상 인식은 `categorizeToken`, internal 토큰은 `firstVarName` 기준에 맞춤(드리프트 방지).

## 대안 검토

1. **[A] `CSS.supports('color', v)`로 색상 검증** — 가장 견고(브라우저 네이티브). 그러나 단위 테스트가 Vitest/jsdom에서 도는데 jsdom의 `CSS.supports`는 함수형 색상 다수를 신뢰성 있게 처리하지 못해 순수 함수 테스트가 깨진다. → 기각. 대신 `categorizeToken`과 동일한 정규식으로 결정적 판정 유지.
2. **[D] 라이브는 raw 유지, 커밋만 finalize** — 변경 최소지만 "라이브 미리보기와 커밋값 불일치"라는 근본 문제가 남는다(타이핑 중 무효 CSS 적용). 사용자 결정대로 **라이브도 정규화**로 일치시킨다. → 기각.
3. **[C] sentinel 자체를 없애고 Radix `value=""` 사용** — Radix Select는 빈 문자열 value를 금지(placeholder 충돌)해 sentinel이 필요. → sentinel 유지 + set 직전 역변환이 최소 변경.
4. **[E] 매 렌더 linked 재계산(useState 제거)** — 사용자의 수동 토글이 매 렌더 덮여 토글이 안 먹는다. → selKey 변경 시에만 재설정하는 절충 채택.

## 위험 요소

- **[E] linked 동기화 회귀** — selKey 도출·effect 타이밍에 따라 (a) 같은 요소에서 토글이 풀리거나 (b) 재선택 시에도 stale이 남을 수 있다. 재현 시나리오(4면 동일 요소→4면 상이 요소 repick)를 e2e/수동으로 반드시 검증. selection 식별 키가 `selector`로 충분히 안정적인지 확인(동일 selector의 다른 인스턴스 가능성).
- **[D] 라이브 적용 회귀** — 라이브 px 부착이 length 외 카테고리(color/select 미해당)나 multiplier/calc 입력을 건드리지 않는지 확인. `finalizeValue`가 length+순수숫자에만 px를 붙이고 나머지는 통과하므로 안전하나, `calc(...)`·`var(...)` 라이브 입력이 px로 오염되지 않는지 테스트.
- **[I] extractTokenRefs 재작성** — 칩 렌더·family grouping·multiplier(`×N`) 표시가 모두 이 함수에 의존. `calc(var(--a)*2)`·`var(--a)`·중첩 fallback 케이스 회귀 테스트 필수.
- **[A] swatch 확대** — `color()`·`lab()` 등은 구형 Chrome에서 미지원일 수 있으나 `minimum_chrome_version: 116` 기준 대부분 지원. swatch는 `backgroundColor`라 미지원 색은 투명 박스로 그려질 뿐 크래시 없음.
- **[J] container-query 리플로우** — 시각 회귀 위험이 가장 크고 우선순위 최하. 생략 가능 항목으로 분리.
