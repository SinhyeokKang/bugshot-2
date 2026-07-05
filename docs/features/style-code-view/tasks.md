# 스타일 편집 코드 뷰 — 구현 태스크

## 선행 조건

- 신규 권한·env·OAuth·외부 API 없음.
- shadcn 토글 컴포넌트가 없으면 `npx shadcn@latest add tabs`(또는 `toggle-group`) 필요 — 구현 시 확인. 직접 스타일링 금지.
- i18n 신규 키는 ko/en 동시 추가(PostToolUse 훅 대칭 검사).

## 태스크

### Task 1: inlineStyle ↔ CSS 텍스트 변환기 (테스트 우선)
- **변경 대상**: `src/sidepanel/tabs/styleEditor/inlineCssText.ts` (신규), `src/sidepanel/tabs/styleEditor/__tests__/inlineCssText.test.ts` (신규)
- **작업 내용**: `serializeInlineStyle`·`parseInlineStyle` 구현. 테스트 먼저 작성(`/tdd interface`).
  - serialize: `{padding:"2rem", color:"#fff"}` → `"padding: 2rem;\ncolor: #fff;"`, 삽입 순서 유지, 빈 맵 → `""`.
  - parse: 관대 파싱 — 값 없는 선언/콜론 없는 줄 무시, 중복 prop last-wins, prop trim+lowercase, top-level `;`만 분리(괄호·따옴표 내부 `;` 보존), `!important`는 값의 일부로 왕복.
- **검증**:
  - [ ] `pnpm test` — 신규 테스트 통과
  - [ ] round-trip: `parse(serialize(m))` 가 의미상 동치(값 정규화 제외)
  - [ ] 엣지 케이스 케이스별 통과: `background-image: url(data:image/png;base64,AAA);`, `content: "a;b";`, `color: red !important;`, `colr: red`(오타 유지), `padding:`(무시), 중복 `color` 2줄(마지막 채택)

### Task 2: settings-ui-store에 styleEditorView 추가
- **변경 대상**: `src/store/settings-ui-store.ts`, `src/store/__tests__/`(migrate 테스트가 있으면 갱신)
- **작업 내용**: `StyleEditorView` 타입 + `styleEditorView` 필드(기본 `"form"`) + `setStyleEditorView` 액션 추가. persist version 6→7, `migrateSettingsUi`에 `state.styleEditorView = state.styleEditorView ?? "form"` 추가.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 영속 데이터(version ≤6) 로드 시 `styleEditorView === "form"`로 마이그레이트
  - [ ] `setStyleEditorView("code")` 후 재로드 시 `"code"` 유지(persist)

### Task 3: StyleCodeEditor 컴포넌트
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StyleCodeEditor.tsx` (신규)
- **작업 내용**: `styleEdits.inlineStyle`을 `serializeInlineStyle`로 초기화한 로컬 textarea. `ClassEditor`(StyleEditorPanel.tsx:515)의 `lastCommittedRef` 패턴으로 커서 보존. onChange → `parseInlineStyle` → `setStyleEdits({ inlineStyle })` → `applyStyles(tabId, frameId, next)`. 하단에 참조 뷰(Task 5)를 슬롯으로 배치.
  - store→textarea 재동기화는 외부 변경(폼 편집·revert·버퍼 복원)일 때만: `serializeInlineStyle(store.inlineStyle) !== lastCommittedRef.current`면 textarea 갱신.
  - shadcn `Textarea`(`[field-sizing:content]`, `spellCheck={false}`, `data-testid="style-code-editor"`) 사용.
- **검증**:
  - [ ] 코드 모드에서 타이핑 시 커서 점프 없음(수동/e2e)
  - [ ] 타이핑이 대상 요소에 라이브 반영 + 변경사항 다이얼로그에 나타남

### Task 4: SelectedPanel 모드 스왑 + 토글
- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`
- **작업 내용**: `useSettingsUiStore`에서 `styleEditorView`·`setStyleEditorView` 구독. layout~transition 폼 섹션 묶음을 `view === "form"`일 때만 렌더, `code`면 `<StyleCodeEditor />` 렌더. class 섹션·text 섹션·AI 배너·푸터·`StyleChangesDialog`는 공통 유지. DOM 네비 sticky 헤더 아래(스타일 영역 최상단)에 shadcn 세그먼트 토글 추가(`data-testid="style-view-toggle"`, 옵션 `form`/`code`), onChange → `setStyleEditorView`.
- **검증**:
  - [ ] 토글 전환 시 스타일 편집 영역만 바뀌고 DOM 네비·클래스·텍스트·푸터·다이얼로그 불변
  - [ ] `pnpm typecheck` 통과
  - [ ] 폼→코드→폼 왕복 시 값 유실 없음(폼 지원 속성)

### Task 5: 참조 뷰 (matched sources, read-only)
- **변경 대상**: `StyleCodeEditor.tsx` 내부 하위 컴포넌트 또는 `styleEditor/MatchedSources.tsx`(신규)
- **작업 내용**: `selection.specifiedStyles` + `selection.propSources` 기반 read-only 목록. prop별 `값 (소스셀렉터)` 표시(`↑` 상속 접미사 보존). 편집 불가. i18n 헤더 키 ko/en 추가.
- **검증**:
  - [ ] 매칭 소스가 있는 요소에서 목록 렌더, 없으면 빈/생략
  - [ ] 순수 표시 — 클릭·편집 부작용 없음
- **비고**: 분리 태스크. 구현 부담이 크면 v1에서 목록을 최소화하거나 후속으로 미룰 수 있음(design.md 참조).

### Task 6: `!important` 적용 대응
- **변경 대상**: `src/content/picker.ts` (`handleApplyStyles`)
- **작업 내용**: 값 문자열 끝 `/\s*!important\s*$/` 분리 시 `el.style.setProperty(prop, base, "important")`, 아니면 기존대로 `setProperty(prop, value)`. 타입·메시지 스키마 불변.
- **검증**:
  - [ ] `color: red !important`가 Tailwind `!important` 규칙을 오버라이드(실제 탭 수동 확인)
  - [ ] 기존 폼 값(정상 값)에 회귀 없음 — 접미사 없는 값은 경로 불변
  - [ ] `applyEditsBySelector`(재바인딩)·`resetAllEdits` 경로에도 동일 값이 흐르는지 확인(같은 setProperty 재적용 지점 점검)

## 테스트 계획

- **단위 테스트**: `inlineCssText.test.ts` — serialize/parse round-trip + 엣지(Task 1 검증 항목). settings-ui migrate 테스트가 있으면 `styleEditorView` 기본값 케이스 추가.
- **e2e 시나리오** (`/e2e-write` 입력):
  - 요소 선택 후 스타일 영역에 폼/코드 토글이 보인다.
  - 코드 토글을 누르면 `style-code-editor` textarea가 나타나고 폼 섹션은 사라진다.
  - textarea에 `padding: 32px;`를 입력하면 변경사항 다이얼로그에 padding 변경이 잡힌다.
  - 코드에서 `padding: 32px;` 입력 후 폼 토글로 전환하면 padding 컨트롤에 `32px`가 반영돼 있다.
  - 코드에서 폼 미지원 속성(`cursor: pointer;`) 입력 후 폼↔코드 왕복해도 코드 textarea에 `cursor: pointer;`가 남아있다.
  - 코드 모드를 선택하고 세션을 새로 열면(재진입) 코드 모드로 시작한다(영속).
- **수동 테스트** (자동화 어려움):
  - 코드 textarea 타이핑 중 커서 점프 없음(빠른 연속 입력·중간 삽입).
  - `!important` 오버라이드가 Tailwind `!important` 페이지에서 실제 적용됨(captureVisibleTab/실제 렌더 의존).
  - 참조 뷰가 실제 페이지 요소에서 올바른 소스 셀렉터를 보여줌.

## 구현 순서 권장

1. **Task 1**(변환기, 테스트 우선) → **Task 2**(store 필드) 는 병렬 가능. 둘 다 독립.
2. **Task 3**(StyleCodeEditor) 는 Task 1 의존.
3. **Task 4**(SelectedPanel 스왑) 는 Task 2·3 의존.
4. **Task 6**(`!important`) 는 독립 — 언제든. Task 3와 함께 검증하면 좋다.
5. **Task 5**(참조 뷰) 는 Task 3 이후, 가장 마지막(분리 가능·후순위).

## 가이드 영향

사용자 노출 UX 추가(코드 편집 모드 토글). `/guide`로 아래를 ko·en 동시 갱신 — 작성 전 `guide/AUTHORING.md` 규칙 확인.
- 요소 스타일 편집 가이드 페이지(현행 폼 편집 설명 위치): 폼/코드 두 모드 토글, 코드 모드의 raw CSS 입력·임의 속성 지원 설명 추가.
- 정확한 파일명은 `guide/ko`·`guide/en` 구조 확인 후 `/guide`에서 결정.
