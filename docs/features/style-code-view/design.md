# 스타일 편집 코드 뷰 — 기술 설계

## 개요

코드 뷰는 **새 데이터 모델을 도입하지 않는다**. 기존 `editor-store.styleEdits.inlineStyle`(`Record<string, string>`, prop→value)이 이미 DevTools의 `element.style {}` 블록과 동형이고, 적용 경로(`applyStyles` → `picker.applyStyles` → `el.style.setProperty`)도 prop→value 기반이다. 따라서 코드 뷰는 "같은 `inlineStyle`을 raw CSS 텍스트로 렌더/편집하는 또 하나의 뷰"에 불과하다. 핵심 신규 인터페이스는 `inlineStyle` ↔ CSS 텍스트 **양방향 변환 순수 함수** 하나이며, 이것이 유일한 테스트 우선 대상이다.

`SelectedPanel`에서 스타일 속성 편집 영역(현재 layout~transition 섹션 묶음)만 조건부로 스왑한다. 클래스·텍스트 편집, DOM 네비, 변경사항 다이얼로그, 푸터, before/after는 모두 두 모드가 공유한다.

## 편집 스코프 (왜 인라인만인가)

DevTools는 두 가지를 편집할 수 있다: (A) `element.style {}` 인라인, (B) 매칭 규칙 `.class {}`. 코드 뷰는 **A만** 채택한다.

- Bugshot의 편집 모델은 요소별 인라인 오버라이드(`styleEdits.inlineStyle`)이고 before/after 비교도 요소 단위다.
- B(규칙 편집)는 그 셀렉터에 걸리는 페이지의 모든 요소를 바꾸는 전역 stylesheet 조작이라, 요소별 인라인 모델·요소별 before/after와 1:1 동기화가 불가능하다. 변경사항 다이얼로그도 "요소별 diff" 구조라 규칙별 diff를 담을 수 없다.
- DevTools도 요소 하나만 고칠 땐 규칙이 아니라 `element.style`에 오버라이드를 얹는다 — A는 그 동작과 정확히 일치한다.

즉 "완전 동기화 + 다이얼로그 공유"라는 요구가 A를 강제한다. B는 요구 자체와 모순되므로 채택하지 않는다.

## 변경 범위

### 신규 파일

**`src/sidepanel/tabs/styleEditor/inlineCssText.ts`** — 핵심 순수 변환기(테스트 우선).
- `serializeInlineStyle(inlineStyle: Record<string, string>): string` — 맵을 `prop: value;` 줄들로 직렬화. 맵 삽입 순서 유지(JS 문자열 키 iteration = 삽입 순서).
- `parseInlineStyle(text: string): Record<string, string>` — CSS 선언 텍스트를 맵으로 파싱. 관대(tolerant) 파싱: 값 없는 선언·콜론 없는 줄 무시, 중복 prop last-wins, top-level `;`만 분리(괄호/따옴표 내부 `;`는 값의 일부로 보존 — `url(data:...;base64,...)`·`content: ";"` 대응), prop명은 trim+lowercase.

**`src/sidepanel/tabs/styleEditor/StyleCodeEditor.tsx`** — 코드 모드 편집 컴포넌트.
- `styleEdits.inlineStyle`을 `serializeInlineStyle`로 초기화한 로컬 `textarea` 상태를 들고, `onChange`마다 `parseInlineStyle`→`setStyleEdits({ inlineStyle })`→`applyStyles(tabId, frameId, next)` 호출(폼의 `useStyleProp.set`과 동일 경로).
- **커서 보존 패턴**: `ClassEditor`(StyleEditorPanel.tsx:515)와 동일하게, 내가 직전에 커밋한 직렬화 결과를 `lastCommittedRef`로 기억하고, store의 `inlineStyle`이 **외부**(폼 편집·revert·버퍼 복원)로 바뀐 경우에만 textarea를 재직렬화해 덮어쓴다. 사용자 본인 타이핑 중에는 재직렬화하지 않아 커서 점프를 막는다.
- **빈 상태**: 오버라이드 0개면 textarea가 공백이므로 placeholder 힌트(예: `padding: 3rem;`)를 노출한다(shadcn `Textarea` placeholder, i18n 키).
- v1은 매칭 소스 참조 뷰 없이 편집 textarea만 렌더한다(참조 뷰는 v2 이관 — 아래 참조).

**`src/sidepanel/tabs/styleEditor/__tests__/inlineCssText.test.ts`** — 변환기 단위 테스트.

### 변경 파일

**`src/sidepanel/tabs/StyleEditorPanel.tsx`** (`SelectedPanel`)
- 현재 역할: styling 화면 전체 렌더. class 섹션 + layout~transition 폼 섹션들 + AI 배너 + 푸터.
- 변경: `useSettingsUiStore`에서 `styleEditorView`(`"form" | "code"`)를 읽어, layout~transition 폼 섹션 묶음을 조건부로 렌더. `code`면 그 자리에 `<StyleCodeEditor />` 하나를 렌더. class 섹션·text 섹션·AI 배너·푸터·다이얼로그는 두 모드 공통으로 유지.
- **토글 위치**: DOM 네비 **sticky 헤더 밴드**(StyleEditorPanel.tsx:169, `sticky top-0`) 안에 폼/코드 세그먼트 토글을 편입한다. "스타일 영역 최상단"(class 섹션 아래)은 `PageScroll` 내부라 폼 모드에서 스크롤을 내리면 토글이 사라져(섹션 10개+) 재전환에 스크롤 업이 필요하므로 채택하지 않는다. sticky 밴드에 두면 두 모드 모두 항상 도달 가능하다.
- **토글 컴포넌트**: shadcn `Tabs`(2-way)를 쓴다 — `RecordingSettingsCard.tsx:44`의 tab/screen 모드 토글과 구조적으로 동일한 직접 선례다. `ToggleGroup`/`toggle`의 `segment` variant는 코드베이스 실사용 0이라 채택하지 않는다(관례 이탈 방지). 토글 클릭 시 `useSettingsUiStore.setStyleEditorView` 호출(영속 + 초기값 소스 단일화).

**`src/store/settings-ui-store.ts`**
- 현재 역할: theme·locale·issueSections·llm·recordingMode 등 UI 설정을 `zustand persist`(chrome.storage.local, `bugshot-app-settings`)로 영속.
- 변경: `styleEditorView: "form" | "code"` 필드 + `setStyleEditorView` 액션 추가. `persist` version 6→7, `migrateSettingsUi`에 `state.styleEditorView = state.styleEditorView ?? "form"` 기본값 분기 추가.

**`src/content/picker.ts`** (`handleApplyStyles` + `handleApplyEditsBySelector`) — `!important` 대응.
- 현재 역할: 두 핸들러가 **각자 인라인 `for...of` 루프**로 `el.style.setProperty(prop, value)`(priority 인자 없음)를 호출한다. `handleApplyStyles`는 첫 적용·라이브 프리뷰, `handleApplyEditsBySelector`는 **패널 재오픈·`rebindStylingSession`·복수요소 버퍼 재적용** 경로. (`handleResetAllEdits`는 `setAttribute("style", 원본)`으로만 복원 — `setProperty`를 안 타므로 무관.)
- 변경: **공통 헬퍼 `applyInlineStyle(el, inlineStyle)` 신설**로 split을 단일화하고 두 핸들러가 함께 쓴다. 헬퍼는 값 문자열 끝 `/\s*!important\s*$/`를 분리해 `el.style.setProperty(prop, base, "important")`, 아니면 `el.style.setProperty(prop, value)`. `Record<string, string>` 타입·메시지 스키마는 불변(값에 `!important`를 문자열로 담고 적용 시점에만 split).
- **왜 두 곳 다인가**: CSSOM은 `setProperty(prop, "red !important")`를 무효값으로 조용히 무시한다. split을 `handleApplyStyles`에만 넣으면 패널 재오픈·버퍼 복원(`handleApplyEditsBySelector`) 시 `!important`가 유실된다. 헬퍼로 단일화하면 이 회귀가 원천 차단된다.

## 데이터 흐름

```
[코드 모드]
textarea onChange
  → parseInlineStyle(text): Record<prop,value>
  → setStyleEdits({ inlineStyle })            (store 갱신, 폼과 동일 필드)
  → applyStyles(tabId, frameId, inlineStyle)  (picker.applyStyles → handleApplyStyles → setProperty)
  → picker.selectionUpdated → updateSelectionStyles (mergeSelectionStyles가 baseline 보존)

[폼 모드]  useStyleProp.set → 위와 동일하게 setStyleEdits + applyStyles

[모드 전환]  StyleCodeEditor 마운트 시 store.inlineStyle을 serializeInlineStyle로 textarea 초기화.
            폼 편집이 store를 바꾸면 lastCommittedRef 비교로 textarea 재동기화(외부 변경만).

[영속]  setStyleEditorView → settings-ui-store persist → chrome.storage.local
        다음 styling 진입 시 SelectedPanel이 styleEditorView로 초기 모드 결정.
```

두 모드가 같은 `styleEdits.inlineStyle`·같은 `applyStyles` 경로를 쓰므로 변경사항 다이얼로그(`buildStyleDiff`)·`hasStyleChange`·`confirmDraft` 저장은 **수정 없이** 두 모드를 동일하게 커버한다.

## 참조 뷰 (matched sources) — v1 제외, v2 이관

DevTools의 아래쪽 매칭 규칙 리스트를 재현하는 read-only 참조 뷰는 **v1 스코프에서 뺀다**. 근거:
- 코드 뷰의 핵심 가치(raw 타이핑 + 임의 속성 편집)와 무관하다 — 없어도 기능이 성립한다.
- `selection.propSources`는 prop별 **승자 셀렉터 하나**만 담아 정보 밀도가 낮고, 폼 모드는 소스를 label 툴팁(`usePropSource` → `StylePropEditors`)으로만 노출하는데 코드 모드만 하단 상시 리스트로 노출하면 두 모드가 비대칭이다. ~400px 패널에서 인지 부하도 크다.
- 모든 매칭 규칙·`file:line`·덮어쓰인 선언을 담는 DevTools 전체 캐스케이드는 `propSources`로 재구성 불가(css-source-cache에 raw 룰은 있으나 캐스케이드 재현은 별개 작업) — creep 진입점이다.

v2에서 필요해지면 `specifiedStyles`+`propSources` 기반 collapsible read-only 목록(`ReproEnvironmentSection`의 접힘 + `bg-muted` 패턴)으로 분리 도입한다.

## 인터페이스 설계

```ts
// src/sidepanel/tabs/styleEditor/inlineCssText.ts
export function serializeInlineStyle(inlineStyle: Record<string, string>): string;
export function parseInlineStyle(text: string): Record<string, string>;

// src/store/settings-ui-store.ts (추가)
export type StyleEditorView = "form" | "code";
interface SettingsUiState {
  // ...기존...
  styleEditorView: StyleEditorView;
  setStyleEditorView: (view: StyleEditorView) => void;
}

// src/content/picker.ts (신설 헬퍼 — handleApplyStyles·handleApplyEditsBySelector 공유)
// 값 끝 !important를 분리해 priority로 적용. 접미사 없는 값은 기존 동작 그대로.
function applyInlineStyle(el: HTMLElement, inlineStyle: Record<string, string>): void;
```

## `!important` 처리 결정

Tailwind 등은 페이지 규칙에 `!important`를 광범위하게 건다(스크린샷의 preflight.css처럼). 인라인 오버라이드가 `!important` 없이 얹히면 페이지의 `!important` 규칙을 못 이긴다. 코드 뷰는 사용자가 `!important`를 직접 칠 수 있는 유일한 채널이므로 대응 방식을 정한다.

- **권장(채택)**: 값 문자열에 `!important`를 그대로 보존하고, **공통 헬퍼 `applyInlineStyle(el, inlineStyle)`**(위 "변경 파일" 참조)에서 적용 시점에만 `/\s*!important\s*$/`를 분리해 `setProperty(prop, base, "important")`로 넣는다. store 타입(`Record<string,string>`)·메시지 스키마·직렬화기 모두 불변 — `serializeInlineStyle`/`parseInlineStyle`은 값을 opaque 문자열로 취급하고 `!important`를 값의 일부로 왕복시킨다. 변경 지점은 신설 헬퍼 한 곳이며, `handleApplyStyles`·`handleApplyEditsBySelector` 두 callsite가 이 헬퍼를 공유한다(각 callsite에 split을 중복 인라인하지 않는다).
- 대안(비채택): `!important`를 파서에서 버림 → Tailwind 페이지에서 코드 뷰가 사실상 무력해져 기능 목적을 훼손.

> 주의(기존 동작): 폼 모드는 `!important`를 생성하지 않으므로 이 결정은 코드 뷰 신규 동작에만 영향. 단 `applyInlineStyle` 헬퍼는 폼·코드·재바인딩 공유 경로라, split 로직이 기존 폼 값(정상 값)을 건드리지 않도록 **접미사 매칭으로 한정**한다.
>
> 폼-지원 속성에 `!important`가 붙은 경우(예: `color: red !important`): 폼 모드의 `useStyleProp.value`가 `"red !important"`를 그대로 컨트롤에 흘린다. 이 값이 폼 컨트롤에서 mangle 없이 왕복되는지 확인이 필요하다(tasks.md Task 6 검증).

## 기존 패턴 준수

- **controlled textarea + lastCommittedRef 재동기화**: `ClassEditor`(StyleEditorPanel.tsx:515-558) 패턴을 그대로 따른다. store→로컬 재동기화를 외부 변경으로 한정해 커서 점프 방지.
- **applyStyles 경로 단일화**: 폼의 `useStyleProp.set`(styleHooks.ts:18)과 동일하게 `setStyleEdits` 직후 `applyStyles(tabId, frameId, inlineStyle)`를 호출한다. 별도 적용 경로를 만들지 않는다.
- **frameId 정규화**: `useEditorStore.getState().selection?.frameId ?? 0`로 소비 지점에서 정규화(picker-control `send`의 frameId required 규약).
- **persist 마이그레이션**: `settings-ui-store`의 기존 `migrateSettingsUi` 컨벤션(버전 bump + `?? 기본값`)을 따른다.
- **i18n 동시 갱신**: 토글 라벨·참조 뷰 헤더 등 신규 문자열은 `src/i18n/ko`·`en` 양쪽에 함께 추가(PostToolUse 훅이 대칭 검사).
- **UI 컨벤션**: 토글은 shadcn 컴포넌트(Tabs 또는 ToggleGroup) 사용, 직접 스타일링 금지. DESIGN.md 참조.

## 대안 검토

- **별도 store 필드로 코드 뷰 텍스트 보관 (비채택)**: 코드 뷰용 `codeText` 상태를 store에 따로 두면 폼과 동기화 로직이 이중화되고 진실 원천이 갈라진다. `inlineStyle` 단일 원천 + 파생 직렬화가 더 단순하고 동기화가 공짜다.
- **매칭 규칙 편집(스코프 B, 비채택)**: 전역 stylesheet 주입 필요 + 요소별 before/after와 충돌. 비목표 참조.
- **CodeMirror 등 에디터 라이브러리 도입 (비채택)**: 신택스 하이라이팅·자동완성은 비목표이고 번들·의존성 비용이 크다. 순수 `textarea`로 충분.
- **모드 상태를 editor-store에 두기 (비채택)**: 모드는 세션 자산이 아니라 사용자 UI 선호라 `settings-ui-store`(영속) 소속이 맞다. editor-store는 `reset`이 잦아 초기값 영속에 부적합.

## 위험 요소

- **커서 점프**: store↔textarea 재동기화를 외부 변경으로 한정하지 않으면 타이핑 중 커서가 튄다. `ClassEditor` 패턴 준수 필수. e2e/수동으로 확인.
- **`;` 분리 오파싱**: 값 내부 `;`(data URI·`content`)를 top-level 분리에서 보존해야 한다. 단위 테스트로 고정.
- **`!important` split 회귀 + 재바인딩 유실**: split을 `handleApplyStyles` 한 곳에만 넣으면 `handleApplyEditsBySelector`(재오픈·버퍼 복원) 경로에서 `!important`가 조용히 유실된다 → 반드시 공통 헬퍼로 두 callsite를 함께 커버. 헬퍼 split이 정상 값을 훼손하지 않도록 접미사 한정 매칭 + 실제 탭 재오픈 회귀 확인.
- **Task 3↔6 hard dependency**: Task 6(`!important` 헬퍼) 없이 Task 3만 배포하면 `color: red !important`가 2-arg `setProperty`에서 **선언 자체가 드롭**(priority만 무시가 아니라 declaration drop → 색이 아예 안 먹음)된다. 두 태스크는 **동시 배포 필수**.
- **폼 미지원 속성 가시성**: 코드 뷰에서 넣은 임의 속성이 폼에서 안 보이는 건 의도된 동작이나, `resetAllStyleEdits`·섹션 revert가 이들을 의도치 않게 날리지 않는지 확인(현재 revert는 `SECTION_PROPS` 대상만 조작 — 임의 속성 불변이어야 정상).
- **buildStyleDiff/hasStyleChange 커버리지 + phantom diff**: 임의 속성·`!important` 값이 diff 계산에서 "변경"으로 잡히는지 확인(baseline은 specified/computed 폴백). `buildStyleDiff`는 `src/sidepanel/components/StyleChangesTable.tsx:163`, `hasStyleChange`는 `hasStyleChange.ts:14` — 둘 다 `before === after` 순수 문자열 비교다. baseline인 `specifiedStyles`·`computedStyles`는 **둘 다 수집 단계에서 `!important`를 제거**한다(`css-resolve.ts:915` `replace(/\s*!\s*important\s*$/i,"")`, `css-source-cache.ts:793`). 따라서 `!important` 값은 baseline과 영구 문자열 불일치로 **항상 changed(phantom diff 행/Next 게이트 활성)**. 허용 가능한 동작이나 단위 테스트 또는 명시 검증 항목으로 고정한다.
