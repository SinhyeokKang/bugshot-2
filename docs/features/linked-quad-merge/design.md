# Linked 4면 속성 병합 필드 — 기술 설계

## 개요

`useLinkedProps` 훅에 "4면 공통 상태"(공통 편집값·공통 placeholder·mixed 여부) 계산을 추가하고,
`QuadProp`/`QuadStyleProp`/`RadiusProp`/`GapPairProp` 4개 컴포넌트가 `linked`일 때 grid 대신
**단일 입력 필드**를 렌더하도록 분기한다. 단일 필드는 `ValueCombobox`의 기존 `controlled` prop으로
구현하고(값/placeholder/set 주입), border-style은 `SideStyleSelect`에 `controlled`를 추가해 단일
select로 접는다. 상태·메시지·diff 직렬화는 일절 건드리지 않는다. UI 표현 분기뿐이다.

## 변경 범위

### `src/sidepanel/tabs/styleEditor/StylePropEditors.tsx` (핵심)

- **`useLinkedProps` 확장** (현재 79–115행)
  - 반환에 `merged: { value: string; placeholder: string; mixed: boolean }` 추가.
  - store를 셀렉터로 구독해(현재는 `selection`만 구독) inlineStyle 변경 시 단일 필드가 리렌더되게 한다.
    구독은 **분리된 primitive 셀렉터**(`value`/`placeholder`/`mixed` 각각 별도 `useEditorStore((s)=>...)`)로
    한다 — `{value,placeholder,mixed}` 객체를 단일 셀렉터로 반환하면 매 store 변경마다 새 객체가 돼
    `Object.is` 비교가 항상 실패, 불필요 리렌더 + "getSnapshot should be cached" 경고가 난다.
  - 계산은 아래 순수 함수(같은 파일에 추출·export)에 위임.
- **`QuadProp`** (505–565행): `linked`면 단일 `ValueCombobox`(통합 아이콘 + `controlled`, **`compact` 미전달**) + `LinkToggle`,
  `!linked`면 기존 `grid-cols-4` 그대로. (단일 필드는 `w-full`이라 `compact`면 popover 폭이 trigger 2배(~688px)로
  패널(376px)을 초과해 잘린다 — non-compact로 렌더.)
- **`QuadStyleProp`** (465–503행): `linked`면 단일 `SideStyleSelect`(통합 모드, `controlled`),
  `!linked`면 기존 4-select grid.
- **`RadiusProp`** (636–), **`GapPairProp`** (599–627행): 동일 분기. gap은 `grid-cols-2`.
- **`SideStyleSelect`** (416–): `controlled?: { value; placeholder; set }` prop 추가.
  주어지면 `useStyleProp(prop)` 대신 controlled 값/placeholder를 쓰고 `commit`이 `controlled.set`을 호출.
  (현재 `onLinkedCommit`은 per-side 필드의 linked-write용으로 유지 — 단일 필드는 controlled.set로 충분.)
- **통합 아이콘**: per-side `SideEdgeIcon`/`CornerRadiusIcon` 대신 쓸 단일 통합 아이콘.
  **4면/4코너를 모두 균일 강조한 인라인 SVG**로 만든다 — 기존 `SIDE_LINES`/`CORNER_PATHS` 좌표를
  재사용해 박스 윤곽(opacity 0.35) + 전 변/코너 굵게(`strokeWidth` 동일). lucide `Square`는 기존 커스텀
  SVG 강조 언어와 이질적이라 채택하지 않는다(신규 자산 0, 시각 일관).
  `iconTitle`은 묶음 종류별로 분리: side(margin/padding/border-*) → `t("prop.side.all")`,
  corner(radius) → `t("prop.corner.all")`, axis(gap) → `t("prop.axis.all")`.

추출할 순수 함수(같은 파일, 단위 테스트 대상):

```ts
// 4면 inlineStyle 편집값이 모두 동일하면 그 값, 아니면 "" (편집값이 일부라도 없으면 "")
export function commonEditValue(
  props: string[],
  inlineStyle: Record<string, string>,
): string;

// 4면 baseline(편집값 우선 → specified → computed)이 모두 동일하면 그 값, 아니면 ""
export function commonBaseline(
  props: string[],
  inlineStyle: Record<string, string>,
  selection: EditorSelection | null,
): string;

// baseline 4면이 서로 다르면 true (단일 필드 placeholder를 "mixed"로 띄울지 판정)
export function sidesMixed(
  props: string[],
  inlineStyle: Record<string, string>,
  selection: EditorSelection | null,
): boolean;
```

> 기존 `sidesAllEqual`(65–77행)과 로직이 겹친다. `sidesAllEqual = commonBaseline(...) !== ""`로
> 재정의해 중복을 제거하거나, 최소한 baseline 추출 헬퍼(`sideBaselineValues`)를 공유한다.
> **외과적 범위 원칙**: 기존 `sidesAllEqual` 호출부(`useLinkedProps` 초기값·재판정)의 동작은 보존.

### `src/i18n/namespaces/editor.ts`

- 키 4개 추가(`prop.*` 블록 — 실제 위치 ko 47–63행 / en 156–172행 **양쪽 동시**):
  - `"prop.side.all"`: ko `"전체"` / en `"All sides"` — side 묶음(margin/padding/border-*) 단일 필드 아이콘 title.
  - `"prop.corner.all"`: ko `"전체 모서리"` / en `"All corners"` — radius 단일 필드 title.
  - `"prop.axis.all"`: ko `"양축"` / en `"Both axes"` — gap 단일 필드 title.
  - `"prop.mixed"`: ko `"혼합"` / en `"Mixed"` — 단일 필드 placeholder/단일 select trigger 라벨(4면 불일치 시).
- Edit/Write 시 `.claude/settings.json` PostToolUse 훅이 `locales.test.ts`(ko/en 대칭)를 자동 실행하므로
  반드시 양쪽 동시 추가.

### `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx`

- **변경 없음.** `controlled?: { value; placeholder; set }` prop이 이미 존재(39–58행). 단일 필드는
  `controlled={{ value: merged.value, placeholder: merged.mixed ? t("prop.mixed") : merged.placeholder, set: setAllProps }}`로 호출.

### `src/sidepanel/components/StyleChangesTable.tsx` (border 2차 통합)

- `collapseShorthands`(229–263행)에 **2차 패스** 추가. 1차 패스(면→`border-width`/`border-style`/
  `border-color`)가 끝난 `result`에서 세 행이 **모두 존재**하면 `border` 한 행으로 합치고 셋을 소비한다.
  - 조합 순서는 CSS 표준 `width style color`:
    `toBe = "${w.toBe} ${s.toBe} ${c.toBe}"`, `asIs = "${w.asIs} ${s.asIs} ${c.asIs}"`.
    단 **셋 다 asIs가 빈 값이면 결합 결과가 `"  "`(공백만)가 되므로 `trim()` 후 빈 문자열이면 `""`로 정규화**해
    개별 행의 빈 asIs와 일관되게 한다(단위 테스트로 고정).
  - 세 행 중 하나라도 없으면(=변경 안 됨 또는 4면 불일치라 1차 미축약) 통합하지 않는다 → 부분 변경
    자동 처리.
  - 명시 `border` 행이 이미 있으면 중복 생성 금지. 2차 패스는 1차 축약 후의 `result`에서 동작하므로
    가드도 `result.some(r => r.prop === "border")`로 `result` 기준 일관 적용(원본 `rows`와 동치).
  - 삽입 위치: 정렬상 가장 앞서는 `border-color` 자리(`collapsedAt` 동일 패턴)에 끼워 순서 유지.
- 1차 `SHORTHAND_GROUPS`·트리거 조건은 변경 없음. border 2차만 추가.
- `buildStyleDiff`는 `collapseShorthands` 결과를 그대로 반환하므로 모든 플랫폼 body builder(markdown/
  ADF/Notion/meta JSON)에 자동 반영 — 각 builder 수정 불필요.

## 데이터 흐름

변경 없음. 단일 필드든 4필드든 최종 write 경로는 동일:

```
단일 필드 입력 → ValueCombobox.commit → setAllProps(value)
  → useEditorStore.setStyleEdits({ inlineStyle })  ← 4면 동일 키 일괄 set/delete
  → applyStyles(tabId, inlineStyle) → "picker.applyStyles" 메시지
  → content script handleApplyStyles → el.style.setProperty (면별 longhand 적용)

이슈 제출 시:
  styleEdits.inlineStyle(4면 longhand) → buildStyleDiff → collapseShorthands
  → StyleDiffRow[]("padding: 16px" 1행) → 각 플랫폼 body builder
```

단일 필드는 표시(read)만 4면 공통값으로 묶고, 저장 모델은 그대로 면별 longhand다. 따라서 diff
축약·issue 출력은 자동으로 한 줄로 유지된다.

border 2차 통합 흐름:

```
inlineStyle(border-*-width/style/color 12개 longhand)
  → buildStyleDiff → collapseShorthands
     1차: border-top/right/bottom/left-width(4면 동일) → border-width 행 (style·color 동일)
     2차: border-width + border-style + border-color 3행 존재 → border: "2px solid red" 1행
  → StyleDiffRow[]("border" 1행) → 각 플랫폼 body builder
```

## 인터페이스 설계

```ts
// useLinkedProps 반환 확장
function useLinkedProps(props: string[]): {
  linked: boolean;
  toggle: () => void;
  setAllProps: (value: string) => void;
  merged: { value: string; placeholder: string; mixed: boolean };
};

// SideStyleSelect prop 확장
function SideStyleSelect(props: {
  prop: string;
  side: keyof typeof SIDE_LINES;
  sideTitle: string;
  onLinkedCommit?: (value: string) => void;
  controlled?: { value: string; placeholder: string; set: (v: string) => void };
}): JSX.Element;
```

`merged` 구성:
- `value = commonEditValue(props, inlineStyle)` — 4면 편집값 동일 시 그 값, 아니면 ""
- `placeholder = commonBaseline(props, inlineStyle, selection)` (mixed면 호출부에서 `t("prop.mixed")`로 대체)
- `mixed = sidesMixed(props, inlineStyle, selection)`

## 기존 패턴 준수

- **`controlled` 주입 패턴**: `ValueCombobox`가 이미 `controlled`로 외부 상태 제어를 지원 → 단일 필드는
  새 컴포넌트 없이 이걸 재사용(최소 설계).
- **순수 함수 + `__tests__`**: 공통값/mixed 판정은 순수 함수로 추출해 `__tests__/*.test.ts` 단위 테스트
  (CLAUDE.md 테스트 우선 원칙). 기존 `propMetadata.test.ts`/`valueFormat.test.ts`와 동일 위치.
- **i18n 동시 갱신**: ko/en 키를 같은 파일 양 블록에 동시 추가, 훅 자동 검증.
- **shadcn/Tailwind**: 단일 필드도 기존 `ValueCombobox`/`Select` 컴포넌트 그대로. 새 스타일링 없음.

## 대안 검토

- **대안 A: linked일 때도 4필드 유지하되 첫 필드만 활성·나머지 비활성(disable).**
  폭 낭비가 그대로라 목표(시각적 단순화)에 미달. 기각.
- **대안 B: 단일 필드를 전용 신규 컴포넌트(`MergedSideField`)로 작성.**
  `ValueCombobox`의 토큰 검색·단위 자동부착·color swatch를 전부 재구현해야 함. `controlled` prop이
  이미 있으므로 불필요한 중복. 기각(채택: controlled 재사용).
- **대안 C: 4면 불일치 + linked 진입 시 top 값으로 4면을 즉시 통일.**
  사용자 의도와 무관하게 데이터를 덮어씀. PRD에서 "기존 값 보존" 선택 → `mixed` placeholder 방식 채택.

## 위험 요소

- **리렌더 구독**: 단일 필드의 `merged.value`는 inlineStyle 변경에 반응해야 한다. 현재
  `useLinkedProps`는 `selection`만 구독하므로, 공통값을 `useEditorStore((s) => ...)` 셀렉터로 구독하도록
  추가해야 단일 필드가 라이브 갱신된다(누락 시 입력 후 값이 안 보이는 회귀).
- **linked 토글과 unlinked 잔여값**: unlinked에서 면별로 다르게 편집 → linked로 토글 시 inlineStyle에는
  4면 다른 값이 남아 있다. 단일 필드는 `mixed`로 표시하되 **inlineStyle은 건드리지 않는다**(덮어쓰기
  금지). 사용자가 단일 필드에 입력해야 `setAllProps`로 통일. toggle은 순수 표시 토글이라 unlink로 되돌리면
  4면 값이 그대로 복원된다(데이터 손실 없음). 다만 mixed 진입 시 "값이 사라졌다"는 오인을 줄 수 있으니
  단일 필드/select에 `title`(예: "면별 값이 달라요. 입력하면 통일됩니다")을 검토. 더불어 `LinkToggle`이
  아이콘 전용 버튼이므로 `aria-label`/`title`(linked/unlinked 상태) 부여 여부를 구현 시 확인·보강한다.
- **`SideStyleSelect` controlled 분기**: `value`/`set` 출처가 둘(useStyleProp vs controlled)로 갈리므로
  `current`·`commit` 계산을 controlled 우선으로 정확히 분기. per-side 모드 회귀 주의.
- **border-style 단일 placeholder**: select는 옵션 목록 기반이라 `mixed` 표시 방식이 input과 다르다.
  4면 불일치(mixed)면 trigger 라벨에 `t("prop.mixed")`(`혼합`/`Mixed`)를 muted 텍스트로 노출 —
  input placeholder와 **동일 문구·시각**으로 일관(`—` 대시는 쓰지 않는다). select value는 빈 문자열 유지.
- **`sidesAllEqual` 재정의 시 회귀**: 초기 linked 판정·요소 재선택 재판정이 기존과 동일하게 동작하는지
  단위 테스트로 고정.
- **border-color 단일 필드 mixed placeholder swatch**: border-color 같은 color 필드의 `ValueCombobox`가
  placeholder 문자열을 color swatch 렌더 입력으로 쓰면 `혼합`/`Mixed`를 색으로 파싱하려다 깨질 수 있다.
  구현 전 ValueCombobox의 swatch 파싱이 비유효 색 문자열에 가드되는지 확인하고, 없으면 mixed placeholder는
  swatch를 띄우지 않도록 처리.
- e2e: 필드 개수가 모드에 따라 4↔1로 바뀌므로 기존 e2e 셀렉터가 per-side 필드를 직접 잡고 있으면
  깨질 수 있다. `data-testid` 확인 필요(tasks 참조).
- **생성 본문 diff e2e 판정 수단**: "diff에 `padding: 16px`/`border: 2px solid red` 한 줄" e2e는 생성
  markdown/diff 테이블을 DOM에서 assert해야 한다. 기존 e2e 하니스에 draft diff/생성 markdown을 읽는 패턴이
  없을 수 있으므로 `/e2e-write`에서 판정 수단(셀렉터·미리보기 노출)을 먼저 확인한다.
- **border 2차 통합 — asIs 조합의 빈 값**: width/style/color 중 baseline이 비어 있으면(`specifiedStyles`·
  `computedStyles`에 없음) asIs 조합에 빈칸이 생긴다(`" solid red"`). 기존 개별 행도 asIs를 빈 문자열로
  노출하므로 일관성은 유지되나, 단위 테스트로 빈 asIs 케이스를 고정한다.
- **border 2차 통합 — 1차 미축약 잔존**: width는 4면 동일이라 `border-width`로 축약됐지만 color는 4면
  불일치라 `border-top-color` 등 개별 행이 남는 경우, `border-color` 행이 없으므로 2차 통합은 일어나지
  않아야 한다(부분 통합 금지). 이 케이스 회귀 테스트 필요.
- **border 2차는 1차 패스 이후에만**: `result` 구성 후(또는 1차 collapsedAt 반영 후) 한 번 더 스캔하는
  순서를 지켜야 한다. 1차와 동시에 처리하면 border-width/style/color 행이 아직 안 만들어져 누락된다.
