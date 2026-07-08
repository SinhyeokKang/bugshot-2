# 스타일 편집 코드 뷰 리팩터 — 기술 설계

## 개요

v1의 코드 뷰(`StyleCodeEditor` = plain textarea + `inlineStyle` 직렬화)를 **CodeMirror 6 기반 CSS 편집 뷰**(`StyleCssView`)로 교체한다. 데이터 모델은 v1을 그대로 계승한다 — 편집 결과는 여전히 `styleEdits.inlineStyle`(요소별 인라인 오버라이드)이고, 적용 경로(`applyStyles` → `picker.applyStyles`)·before/after diff·변경사항 다이얼로그는 수정 없이 재사용한다. **바뀌는 것은 뷰뿐이다**: (a) 편집 출발점을 빈 오버라이드가 아니라 요소의 `specifiedStyles`로 prefill하고, (b) 편집 결과를 specified 대비 diff로 환원해 오버라이드만 store에 남기며(순수 함수 `computeOverrides` — store 위생 + apply 후 specified 재수집 시 옛값이 오버라이드로 고정되는 drift 방지가 목적. phantom diff는 기존 `hasStyleChange`/`before===after` 스킵 가드로 이미 안 생긴다), (c) 표시를 `selector { … }` CSS 블록 + 신택스 하이라이팅 + 자동완성 + 상단 박스모델 그래픽으로 격상한다.

## 변경 범위

### 신규 파일

**`src/sidepanel/tabs/styleEditor/cssBlock.ts`** — CSS 블록 ↔ 오버라이드 순수 변환기(테스트 우선). v1 `inlineCssText.ts`의 `parseInlineStyle`/`serializeInlineStyle`을 재사용·확장.
- `serializeCssBlock(selector: string, decls: Record<string,string>): string` — `${selector} {\n  prop: value;\n  …\n}` 문자열. 선언 없으면 `${selector} {\n}`. 들여쓰기 2칸.
- `parseCssBlock(text: string): Record<string,string>` — 첫 `{`와 마지막 `}` 사이 본문을 추출해 `parseInlineStyle`로 파싱(중괄호 없거나 selector만이면 전체를 본문으로 관대 처리). selector 라인은 무시(요소 고정이라 편집 대상 아님).
- `computeOverrides(edited: Record<string,string>, specified: Record<string,string>): Record<string,string>` — `edited`에서 **`specified[prop]`와 문자열이 다른 prop만** 남긴다(같으면 오버라이드 아님 → 제외). specified에 있었으나 edited에서 **빠진 prop은 `initial` 오버라이드로 방출**(삭제=원복 — 사용자가 그 라인을 지운 건 원복 의도). → prefill을 안 건드리면 `{}` 반환(무편집 시 오버라이드 0). 인라인 오버라이드 모델이라 cascade 원값 복원이 아닌 `initial` 리셋이고, `initial`이 specified와 같아지는 경우는 없으므로 삭제는 항상 변경사항으로 잡힌다.

**`src/sidepanel/tabs/styleEditor/boxModel.ts`** — computed → 박스모델 순수 함수(테스트 우선).
- `parseBoxModel(computed: Record<string,string>): BoxModel` — `margin-*`/`border-*-width`/`padding-*`/`width`/`height`를 px 숫자로 파싱. `BoxModel = { margin/border/padding: {top,right,bottom,left:number}, content:{width,height:number} }`. 파싱 실패·비px(`auto` 등)는 `0`(표시용). 원문 문자열도 `contentLabel`로 보존(`100.273×34`처럼).

**`src/sidepanel/tabs/styleEditor/BoxModelDiagram.tsx`** — read-only 박스모델 그래픽. `parseBoxModel` 결과를 중첩 `<div>`(DevTools 색: margin 주황·border 노랑·padding 초록·content 파랑, 다크모드 토큰)로 렌더. 각 변에 값 텍스트, 가운데 content `width×height`. 순수 표시(인터랙션 없음). Tailwind CSS 변수 사용, 직접 색 하드코딩은 DevTools 관례색이라 예외적으로 허용하되 다크모드 대비 확인. **접근성**: 색상만으로 구분되지 않게 각 영역(margin/border/padding/content)에 `aria-label`(예: `margin 8px`) 부여. **세로 예산**: 좁은 사이드패널에서 상단을 과점하지 않게 높이 상한(예 `max-h`)을 둔다.

**`src/sidepanel/tabs/styleEditor/StyleCssView.tsx`** — CSS 탭 본체(v1 `StyleCodeEditor` 대체).
- **요소 전환 = remount**: `StyleEditorPanel`에서 `<StyleCssView key={sameElementKey(selection)} />`로 key를 건다. 요소가 바뀌면 컴포넌트가 새로 마운트돼 doc·ref가 selector·specifiedStyles 기준으로 재파생된다. v1 doc은 `serialize(inlineStyle)`만이라 key가 불필요했지만, 신규 doc은 `selector`+`specifiedStyles`에도 의존하므로 `inlineStyle`만 감시하는 effect로는 stale doc이 남는다(오버라이드 둘 다 `{}`인 A→B 전환, cross-origin의 늦은 specified 보강). key remount가 이 재파생을 단순·확실하게 보장. (동일 요소 내 specified 지연 보강은 아래 재동기화 effect가 흡수.)
- 상단 `<BoxModelDiagram box={parseBoxModel(selection.computedStyles)} />`. 편집→`applyStyles` 후 picker가 computed를 재수집(`selectionUpdated`)하면 `selection.computedStyles`가 갱신돼 박스모델이 라이브로 다시 그려진다.
- 그 아래 CodeMirror 에디터. `doc` 초기값 = `serializeCssBlock(selection.selector, { ...specified, ...inlineStyle })`(specified prefill + 기존 오버라이드 반영). **specified는 `selection.specifiedStyles`**.
- onChange(에디터 편집) → `parseCssBlock(doc)` → `computeOverrides(parsed, specifiedStyles)` → `setStyleEdits({ inlineStyle })` → `applyStyles(tabId, frameId, inlineStyle)`. (폼의 `useStyleProp.set`과 동일 경로.)
- **외부 변경 재동기화**: store의 `inlineStyle`이 외부(폼 편집·revert·버퍼 복원·동일 요소 specified 지연 보강)로 바뀌면 CodeMirror `doc`을 `serializeCssBlock(...)`로 재설정. v1 `lastCommittedRef` 패턴을 CodeMirror에 이식하되, **ref에 넣는 값은 사용자가 친 raw 텍스트가 아니라 재구성 문자열** `serializeCssBlock(selector, {...specified, ...computeOverrides(...)})`이다(store는 오버라이드만 갖고 doc은 `{...specified, ...overrides}` 재구성이라, raw를 넣으면 판별이 어긋나 커서 점프·라인 소실). 재직렬화 결과가 ref와 다를 때만 `view.dispatch({changes: replaceAll})`. 사용자 타이핑 중(내 dispatch=lastCommitted 일치)엔 재설정 안 함(커서 보존).
- CodeMirror 확장: `@codemirror/lang-css`(신택스+prop명 자동완성), **값 자동완성 커스텀 `completionSource`**(color·키워드 등 — lang-css 기본이 값 완성을 약하게 주므로 보강), 줄번호(`lineNumbers`), 기본 편집 키맵, **Tab escape 키맵**(contenteditable 포커스 트랩 해소 — Esc→Tab 관례로 에디터 밖 탈출), 라인랩. 테마는 라이트/다크 대응(사이드패널 테마 토큰).
- **lazy import(필수)**: CodeMirror 코어·`@uiw/react-codemirror`·`@codemirror/lang-css`를 동적 `import()`로 CSS 탭 진입 시 로드(기존 lazy 선례 계승, 메인 청크 증가 회피). 로드 중 fallback UI(스켈레톤/spinner)를 `Suspense`/조건부 렌더로 표시.

### 변경 파일

**`src/sidepanel/tabs/StyleEditorPanel.tsx`** (`SelectedPanel`)
- 탭 토글을 **DOM 네비 밴드 아래 별도 sticky 컨테이너**로 분리(`border-t`로 구분, 같은 sticky wrapper 안에서 함께 고정).
- `TabsTrigger`에 아이콘 부여: **편집=`Paintbrush`**(스타일 편집 — `SlidersHorizontal`은 `SettingsTab` general 서브탭이 점유 중이라 회피), **CSS=`Code2`**(lucide-react). 아이콘은 기존 탭 컨벤션 토큰 `h-3.5 w-3.5 shrink-0` + 트리거 `gap-1.5`, 라벨은 아이콘 우측(`App.tsx`·`SettingsTab.tsx` 패턴).
- `view === "code"`(CSS)일 때 `<StyleCssView key={sameElementKey(selection)} />` 렌더(v1 `<StyleCodeEditor />` 교체). `view === "form"`(편집)일 때 기존 폼 섹션.
- **class 섹션**: 편집(폼) 탭에서만 렌더(CSS 탭에선 제외). class는 CSS 블록 편집 대상이 아니라 별도 컨트롤이므로 CSS 탭에서 숨긴다. Text 섹션도 CSS 탭에서 제외(코드 편집과 무관). → 조건부 `hidden` wrapper로 감싸고 `[&>section:last-child]:border-b`로 구분선 복원(v1 hidden 패턴 계승).
- `styleEditorView` 값은 `"form"|"code"` 그대로 유지(마이그레이션 불필요). 탭 라벨만 i18n에서 편집/CSS로 바꾼다.

**`src/i18n/namespaces/editor.ts`**
- `editor.view.form`: `폼`→`편집` / `Form`→`Edit`. `editor.view.code`: `코드`→`CSS` / `Code`→`CSS`.
- `editor.codePlaceholder`는 **제거하지 않고 빈 selector 블록 안내 문구로 재활용**(specified 0인 요소에서 표시). 제거하면 삭제 대상 `StyleCodeEditor.tsx`의 `t()` 참조가 Task 6 전까지 dangling되므로 재활용이 순서 안전. 문구만 ko/en 동시 갱신.

**`package.json`** — CodeMirror 6 의존성 추가. `@uiw/react-codemirror`(React 래퍼, CodeMirror 코어 번들 포함) + `@codemirror/lang-css`. `pnpm-workspace.yaml`의 `minimumReleaseAge`(24h) 정책 통과 확인(안정 버전).

### 제거 파일

**`src/sidepanel/tabs/styleEditor/StyleCodeEditor.tsx`** — `StyleCssView`로 대체. `inlineCssText.ts`는 `cssBlock.ts`가 재사용하므로 유지.

## 데이터 흐름

```
[CSS 탭 진입 / 요소 선택]
  doc = serializeCssBlock(selection.selector, {...specifiedStyles, ...inlineStyle})
  → CodeMirror 표시 (selector{} + specified 선언 prefill, 신택스+줄번호)
  BoxModelDiagram = parseBoxModel(selection.computedStyles)

[에디터 편집]
  onChange(doc)
    → parseCssBlock(doc): Record<prop,value>        (중괄호 본문 선언 추출)
    → computeOverrides(parsed, specifiedStyles)      (specified와 다른 것만 + 빠진 specified는 initial 원복)
    → setStyleEdits({ inlineStyle })                 (store = 오버라이드만)
    → applyStyles(tabId, frameId, inlineStyle)       (라이브 반영)
    → picker 재수집(selectionUpdated) → computedStyles 갱신 → BoxModelDiagram 재측정

[폼 탭 편집·specified 지연 보강 → store 변경]
  StyleCssView useEffect: 재구성 문자열(serializeCssBlock(sel,{...specified,...overrides})) ≠ lastCommitted → view.dispatch(doc 교체)
  요소 전환은 이 effect가 아니라 key remount로 처리(selector·specified 재파생).

[baseline/diff]  변경 없음 — buildStyleDiff/hasStyleChange가 specified??computed 대비.
                 무편집 시 computeOverrides가 {} → 변경사항 0. (phantom diff는 기존 before===after 스킵 가드로도 안 남,
                 computeOverrides의 목적은 store 위생 + specified 재수집 drift 방지.)
```

두 탭이 같은 `styleEdits.inlineStyle`·같은 `applyStyles`를 쓰므로 변경사항 다이얼로그·before/after·confirmDraft는 수정 없이 커버된다(v1과 동일).

## 인터페이스 설계

```ts
// src/sidepanel/tabs/styleEditor/cssBlock.ts
export function serializeCssBlock(selector: string, decls: Record<string, string>): string;
export function parseCssBlock(text: string): Record<string, string>;
export function computeOverrides(
  edited: Record<string, string>,
  specified: Record<string, string>,
): Record<string, string>;

// src/sidepanel/tabs/styleEditor/boxModel.ts
export interface BoxSides { top: number; right: number; bottom: number; left: number; }
export interface BoxModel {
  margin: BoxSides;
  border: BoxSides;
  padding: BoxSides;
  content: { width: number; height: number };
  contentLabel: string; // "100.273×34" 등 원문 표시용
}
export function parseBoxModel(computed: Record<string, string>): BoxModel;
```

## 기존 패턴 준수

- **inlineStyle 단일 출처**: v1 대안 검토대로 별도 `codeText` store 필드를 두지 않는다. specified prefill은 파생 표시이고 store엔 오버라이드만.
- **controlled 재동기화 + 커서 보존**: `ClassEditor`/v1 `StyleCodeEditor`의 `lastCommittedRef` 패턴을 CodeMirror dispatch에 이식(외부 변경만 doc 교체). ref 값은 **재구성 문자열**(`serializeCssBlock(sel,{...specified,...overrides})`)이지 사용자 raw 텍스트가 아니다 — store가 오버라이드만 갖는 신규 모델에서 자기입력 판별이 어긋나지 않도록.
- **요소 전환 재파생**: doc가 `selector`+`specifiedStyles`에 의존하므로 `StyleCssView`를 `sameElementKey(selection)`로 key remount(요소별 doc·ref 재초기화). `@/lib/element-key.ts` 단일 출처 재사용.
- **applyStyles 경로 단일화**: `setStyleEdits` 직후 `applyStyles(tabId, frameId, inlineStyle)`. frameId는 `selection?.frameId ?? 0`.
- **i18n 동시 갱신**: `editor.view.*` 라벨 ko/en 동시(PostToolUse 훅 대칭 검사).
- **UI 컨벤션**: 탭은 shadcn `Tabs`(기존), 아이콘은 lucide-react. CodeMirror는 서드파티 에디터라 shadcn 대상 아님 — 사이드패널 테마 토큰에 맞춘 CodeMirror 테마로 라이트/다크 대응.
- **hidden 뷰 스왑**: 편집/CSS 전환은 편집 영역만 조건부 `hidden`(언마운트 아님), `[&>section:last-child]:border-b`로 구분선 복원.

## 대안 검토

- **CodeMirror 대신 textarea+Prism 오버레이 (비채택)**: 자동완성·정확한 토큰·prop 추가삭제 UX를 직접 구현해야 해 비용이 크고, "DevTools 유사" 요구를 못 채운다. CodeMirror가 CSS 언어·자동완성·줄번호를 표준 제공. 번들 증가는 사이드패널 청크 한정(content script pre-arm 제약과 무관)이라 수용.
- **매칭 규칙별 다중 블록 편집 (스코프 B, 비채택)**: 전역 stylesheet 조작 + 요소별 before/after와 충돌. PRD 비목표.
- **specified를 store(inlineStyle)에 실제 prefill (비채택)**: 폼 탭 필드가 전부 값으로 차고(placeholder→value) setProperty로 재적용돼 UX가 바뀐다. `computeOverrides`로 "표시만 prefill, 변경분만 오버라이드"가 v1 모델·"코드탭 표시만" 요구에 부합.
- **전체 computed 리스트 포함 (비채택)**: 박스모델만으로 "요소가 가진 스타일" 파악 요구를 충족. ~90행 리스트는 인지 부하·스코프 확대라 이번 제외(필요 시 후속).

## 위험 요소

- **요소 전환 시 stale doc (🔴)**: 신규 doc은 `selector`+`specifiedStyles`에 의존하는데 재동기화 effect가 `inlineStyle`만 감시하면, 오버라이드 둘 다 `{}`인 A→B 전환·cross-origin 늦은 specified 보강에서 이전 요소 값이 남는다. → `StyleCssView`를 `sameElementKey`로 key remount(요소별 재파생), 동일 요소 내 지연 보강은 재동기화 effect가 흡수. 단위/e2e로 A→B 전환 doc 갱신 고정.
- **specified 문자열 표기 불일치로 인한 phantom override**: `computeOverrides`는 문자열 정확 비교다. specified가 `rgb(0,0,0)`인데 사용자가 `black`으로 재타이핑하면 다른 문자열이라 오버라이드로 잡힌다(값은 동치라도). DevTools도 유사하게 동작하므로 허용하되, prefill(실제 `getComputedStyle` 파생 형태 값 — `rgb(0, 0, 0)`·공백 포함 shorthand·소수 px)을 안 건드리면 override 0임을 단위 테스트로 고정.
- **삭제=원복 시맨틱**: prefill된 specified 라인을 지우면 `computeOverrides`가 `initial` 오버라이드를 방출해 원복한다. 인라인 오버라이드 모델이라 cascade 원값 복원이 아닌 `initial` 리셋(DevTools 규칙 제거와 다름) — 이 caveat를 수용. apply 경로가 `element.style.setProperty(prop,'initial')`로 실제 적용됨을 실탭 검증.
- **CodeMirror 재동기화 커서 점프**: doc 교체를 외부 변경으로 한정하지 않으면 타이핑 중 커서가 튄다. `lastCommittedRef`에 **재구성 문자열**(raw 텍스트 아님) 저장 후 비교 필수. e2e(외부변경 재동기화)/수동(타이핑 중 커서) 검증.
- **selector 라인 편집**: 사용자가 selector 줄을 지우거나 고칠 수 있다. `parseCssBlock`이 selector를 무시(본문만 파싱)하고, 재동기화 시 `serializeCssBlock`이 정본 selector로 복원하므로 무해. read-only 강제는 하지 않는다(복잡도 대비 이득 적음) — 위험은 재직렬화가 흡수.
- **content script import 회귀**: CodeMirror는 **사이드패널 전용**이다. 실수로 `src/content/*`(recorders-entry 그래프)에서 import하면 pre-arm 동기 IIFE 제약이 깨진다(CLAUDE.md). content 계층에서 import 금지.
- **번들 크기·의존성 정책**: CodeMirror는 수백 KB. 사이드패널 메인 청크(이미 1.5MB)에 더해진다. → **lazy import(동적 `import()`)를 필수로** CSS 탭 진입 시 로드(초기 로드 영향 최소화, 로드 중 fallback UI). `minimumReleaseAge` 24h·`onlyBuiltDependencies` 정책 확인(안정 버전 통과, 빌드 스크립트 없음).
- **박스모델 비px 값**: `width:auto`·`%` 등은 computed에서 used px로 오지만, `margin:auto`는 `0px`로 올 수 있다. `parseBoxModel`은 표시용이라 파싱 실패 시 `0` + 원문 라벨 보존으로 처리.
- **e2e 전면 개편**: v1 `style-code-view.spec.ts`의 testid(`style-code-editor`)·동작이 바뀐다. CodeMirror는 `<textarea>`가 아니라 contenteditable/`.cm-content`라 셀렉터·입력 방식이 달라진다(GOTCHAS 신규 등록 대상).
- **문서 갱신**: DESIGN.md(탭·hidden 패턴)·ARCHITECTURE.md(스타일 편집 뷰)·DIRECTORY.md(신규 파일)·guide(element/styling)·AUTHORING 스냅샷·PERMISSION(무관)·privacy(무관 — 새 수집/전송 없음, 로컬 편집)까지 후속 갱신.
