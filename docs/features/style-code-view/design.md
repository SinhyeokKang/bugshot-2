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
- 하단에 매칭 소스 참조(아래 "참조 뷰") 렌더.

**`src/sidepanel/tabs/styleEditor/__tests__/inlineCssText.test.ts`** — 변환기 단위 테스트.

### 변경 파일

**`src/sidepanel/tabs/StyleEditorPanel.tsx`** (`SelectedPanel`)
- 현재 역할: styling 화면 전체 렌더. class 섹션 + layout~transition 폼 섹션들 + AI 배너 + 푸터.
- 변경: `useSettingsUiStore`에서 `styleEditorView`(`"form" | "code"`)를 읽어, layout~transition 폼 섹션 묶음을 조건부로 렌더. `code`면 그 자리에 `<StyleCodeEditor />` 하나를 렌더. class 섹션·text 섹션·AI 배너·푸터·다이얼로그는 두 모드 공통으로 유지.
- DOM 네비 sticky 헤더 아래(또는 스타일 영역 최상단)에 폼/코드 세그먼트 토글 추가. 토글 클릭 시 `useSettingsUiStore.setStyleEditorView` 호출(영속 + 초기값 소스 단일화).

**`src/store/settings-ui-store.ts`**
- 현재 역할: theme·locale·issueSections·llm·recordingMode 등 UI 설정을 `zustand persist`(chrome.storage.local, `bugshot-app-settings`)로 영속.
- 변경: `styleEditorView: "form" | "code"` 필드 + `setStyleEditorView` 액션 추가. `persist` version 6→7, `migrateSettingsUi`에 `state.styleEditorView = state.styleEditorView ?? "form"` 기본값 분기 추가.

**`src/content/picker.ts`** (`handleApplyStyles`) — `!important` 대응 시에만 (아래 결정 참조).
- 현재 역할: `inlineStyle` 항목을 원본 리셋 후 `el.style.setProperty(prop, value)`로 재적용.
- 변경(권장안 채택 시): 값 문자열 끝의 `!important`를 분리해 `el.style.setProperty(prop, val, "important")`로 적용. `Record<string, string>` 타입·메시지 스키마는 불변(값에 `!important`를 문자열로 담고 적용 시점에만 split).

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

## 참조 뷰 (matched sources)

DevTools의 아래쪽 매칭 규칙 리스트를 **경량 read-only**로만 재현한다. 데이터는 기존 `selection.propSources`(`Record<prop, sourceSelector>`, 상속은 `↑` 접미사) + `selection.specifiedStyles`뿐이다.

- 표시: prop별로 "이 속성의 현재 값이 어느 셀렉터에서 왔는지"를 `specifiedStyles[prop]` 값과 `propSources[prop]` 셀렉터로 나열. 예: `padding — 2rem  (.p-8)`.
- **한계(non-goal)**: `propSources`는 prop별 **승자 소스 하나**만 담는다. 모든 매칭 규칙·`file:line`·덮어쓰인 선언을 담는 DevTools 전체 캐스케이드는 재구성하지 않는다(css-source-cache에 raw 룰은 있으나 캐스케이드 재현은 스코프 밖).
- 참조 뷰는 편집 불가. 순수 표시라 회귀 위험이 낮고, 최소 구현으로 시작해 필요 시 확장한다.

> 최소 설계 판단: 참조 뷰가 없어도 코드 뷰의 핵심 가치(raw 타이핑 + 임의 속성)는 성립한다. v1에서 참조 뷰는 `specifiedStyles`+`propSources` 기반의 단순 목록으로 한정하고, 구현 부담이 크면 뒤로 미룰 수 있는 분리된 태스크로 둔다.

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
```

## `!important` 처리 결정

Tailwind 등은 페이지 규칙에 `!important`를 광범위하게 건다(스크린샷의 preflight.css처럼). 인라인 오버라이드가 `!important` 없이 얹히면 페이지의 `!important` 규칙을 못 이긴다. 코드 뷰는 사용자가 `!important`를 직접 칠 수 있는 유일한 채널이므로 대응 방식을 정한다.

- **권장(채택)**: 값 문자열에 `!important`를 그대로 보존하고, `handleApplyStyles`에서 적용 시점에만 `/\s*!important\s*$/`를 분리해 `setProperty(prop, val, "important")`로 넣는다. store 타입(`Record<string,string>`)·메시지 스키마·직렬화기 모두 불변 — `serializeInlineStyle`/`parseInlineStyle`은 값을 opaque 문자열로 취급하고 `!important`를 값의 일부로 왕복시킨다. 변경 지점이 `handleApplyStyles` 한 곳으로 국소화된다.
- 대안(비채택): `!important`를 파서에서 버림 → Tailwind 페이지에서 코드 뷰가 사실상 무력해져 기능 목적을 훼손.

> 주의(기존 동작): 폼 모드는 `!important`를 생성하지 않으므로 이 결정은 코드 뷰 신규 동작에만 영향. 단 `handleApplyStyles`는 폼·코드 공유 경로라, split 로직이 기존 폼 값(정상 값)을 건드리지 않도록 접미사 매칭으로 한정한다.

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
- **`!important` split 회귀**: `handleApplyStyles`가 폼·코드 공유 경로라, split이 정상 값을 훼손하지 않도록 접미사 한정 매칭 + 실제 탭 회귀 확인.
- **폼 미지원 속성 가시성**: 코드 뷰에서 넣은 임의 속성이 폼에서 안 보이는 건 의도된 동작이나, `resetAllStyleEdits`·섹션 revert가 이들을 의도치 않게 날리지 않는지 확인(현재 revert는 `SECTION_PROPS` 대상만 조작 — 임의 속성 불변이어야 정상).
- **buildStyleDiff/hasStyleChange 커버리지**: 임의 속성·`!important` 값이 diff 계산에서 자연스럽게 "변경"으로 잡히는지 확인(baseline은 specified/computed 폴백). 값에 `!important`가 붙으면 computed(`!important` 없음)와 문자열 불일치로 항상 changed 처리 — 허용 가능하나 테스트로 명시.
