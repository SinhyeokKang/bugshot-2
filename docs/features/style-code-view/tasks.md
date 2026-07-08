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
  - [x] `pnpm test` — 신규 테스트 통과 (18 cases)
  - [x] round-trip: `parse(serialize(m))` 가 의미상 동치(값 정규화 제외)
  - [x] 엣지 케이스 케이스별 통과: `background-image: url(data:image/png;base64,AAA);`, `content: "a;b";`, `color: red !important;`, `colr: red`(오타 유지), `padding:`(무시), 중복 `color` 2줄(마지막 채택) + 커스텀 프로퍼티(`--*`) 케이스 보존

### Task 2: settings-ui-store에 styleEditorView 추가
- **변경 대상**: `src/store/settings-ui-store.ts`, `src/store/__tests__/settings-ui-store.test.ts`(실재 — `migrateSettingsUi({}, N)`를 직접 호출하는 persist migrate 테스트. **갱신 필수**)
- **작업 내용**: `StyleEditorView` 타입 + `styleEditorView` 필드(기본 `"form"`) + `setStyleEditorView` 액션 추가. persist version 6→7, `migrateSettingsUi`에 `state.styleEditorView = state.styleEditorView ?? "form"` 추가.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] `pnpm test` — `migrateSettingsUi({}, 6).styleEditorView === "form"` 단위 테스트 추가·통과
  - [x] 기존 영속 데이터(version ≤6) 로드 시 `styleEditorView === "form"`로 마이그레이트 (단위 테스트)
  - [ ] `setStyleEditorView("code")` 후 재로드 시 `"code"` 유지(persist) — e2e/수동

### Task 3: StyleCodeEditor 컴포넌트
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StyleCodeEditor.tsx` (신규)
- **작업 내용**: `styleEdits.inlineStyle`을 `serializeInlineStyle`로 초기화한 로컬 textarea. `ClassEditor`(StyleEditorPanel.tsx:515)의 `lastCommittedRef` 패턴으로 커서 보존. onChange → `parseInlineStyle` → `setStyleEdits({ inlineStyle })` → `applyStyles(tabId, frameId, next)`. (v1은 참조 뷰 없음 — Task 5 참조.)
  - store→textarea 재동기화는 외부 변경(폼 편집·revert·버퍼 복원)일 때만: `serializeInlineStyle(store.inlineStyle) !== lastCommittedRef.current`면 textarea 갱신.
  - shadcn `Textarea`(`[field-sizing:content]`, `spellCheck={false}`, `data-testid="style-code-editor"`) 사용. **빈 상태 placeholder**(예: `padding: 3rem;`, i18n 키) 부착.
- **검증**:
  - [ ] 코드 모드에서 타이핑 시 커서 점프 없음(수동/e2e)
  - [ ] 타이핑이 대상 요소에 라이브 반영 + 변경사항 다이얼로그에 나타남
  - [ ] 오버라이드 0개일 때 placeholder 힌트 노출
  - [ ] 대량 선언(수십 줄) 타이핑 시 keystroke jank 허용 범위(수동) — `handleApplyStyles`가 매 onChange마다 style 전량 리셋+재적용

### Task 4: SelectedPanel 모드 스왑 + 토글
- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`, `src/i18n/ko.ts`·`src/i18n/en.ts`(토글 라벨 키)
- **작업 내용**: `useSettingsUiStore`에서 `styleEditorView`·`setStyleEditorView` 구독. layout~transition 폼 섹션 묶음을 `view === "form"`일 때만 렌더, `code`면 `<StyleCodeEditor />` 렌더. class 섹션·text 섹션·AI 배너·푸터·`StyleChangesDialog`는 공통 유지.
  - **토글 위치**: DOM 네비 **sticky 헤더 밴드**(StyleEditorPanel.tsx:169, `sticky top-0`) 안에 편입 — `PageScroll` 내부(스타일 영역 최상단)에 두면 스크롤 시 사라지므로 지양.
  - **토글 컴포넌트**: shadcn `Tabs`(2-way, `RecordingSettingsCard.tsx:44` 선례). `ToggleGroup`은 실사용 0이라 지양. `data-testid="style-view-toggle"`, 옵션 `form`/`code`, onChange → `setStyleEditorView`.
  - **i18n**: form/code 토글 라벨 키를 `ko`·`en` **동시 추가**(PostToolUse 훅이 대칭 강제).
- **검증**:
  - [ ] 토글 전환 시 스타일 편집 영역만 바뀌고 DOM 네비·클래스·텍스트·푸터·다이얼로그 불변
  - [ ] 토글이 sticky 밴드에 있어 스크롤을 내려도 항상 도달 가능
  - [x] `pnpm typecheck` 통과 + i18n locales 대칭 테스트 통과
  - [ ] 폼→코드→폼 왕복 시 값 유실 없음(폼 지원 속성)

### Task 5: 참조 뷰 (matched sources) — v1 미구현, v2 이관
- **v1에서 구현하지 않는다.** 코드 뷰 핵심 가치(raw 타이핑 + 임의 속성)와 무관하고, `propSources`가 prop별 승자 하나뿐이라 정보 밀도가 낮으며 폼과 비대칭 + ~400px 인지 부하 + 캐스케이드 creep 진입점(design.md "참조 뷰 — v1 제외, v2 이관" 참조).
- v2에서 필요 시: `selection.specifiedStyles` + `selection.propSources` 기반 collapsible read-only 목록(`ReproEnvironmentSection`의 접힘 + `bg-muted` 패턴)으로 분리 도입.

### Task 6: `!important` 적용 대응 (공통 헬퍼)
- **변경 대상**: `src/content/picker.ts` — 신설 헬퍼 `applyInlineStyle(el, inlineStyle)` + **`handleApplyStyles`·`handleApplyEditsBySelector` 두 핸들러가 이 헬퍼를 공유하도록 교체**.
- **작업 내용**: 헬퍼가 값 문자열 끝 `/\s*!important\s*$/` 분리 시 `el.style.setProperty(prop, base, "important")`, 아니면 `setProperty(prop, value)`. 두 핸들러의 기존 인라인 `for...of setProperty` 루프를 헬퍼 호출로 대체. 타입·메시지 스키마 불변. (`handleResetAllEdits`는 `setAttribute("style", 원본)` 복원이라 대상 아님.)
- **⚠️ Task 3와 hard dependency — 동시 배포 필수**: 이 태스크 없이 Task 3만 나가면 `color: red !important`가 2-arg `setProperty`에서 **선언 자체가 드롭**돼 색이 아예 안 먹는다.
- **검증**:
  - [ ] `color: red !important`가 Tailwind `!important` 규칙을 오버라이드(실제 탭 수동 확인)
  - [ ] **패널 재오픈/버퍼 복원 후에도** `!important` 유지(`handleApplyEditsBySelector` 경로 — 실탭 재오픈 회귀)
  - [ ] 기존 폼 값(정상 값)에 회귀 없음 — 접미사 없는 값은 경로 불변
  - [ ] 폼-지원 속성에 `!important`(예: `color: red !important`)를 넣고 폼 모드로 전환 시 컨트롤이 값을 mangle 없이 왕복
  - [ ] phantom diff 확인: `!important` 값이 변경사항 다이얼로그/Next 게이트에 "changed"로 잡히되(baseline strip 때문) 앱이 정상 동작

## 테스트 계획

- **단위 테스트**: `inlineCssText.test.ts` — serialize/parse round-trip + 엣지(Task 1 검증 항목). settings-ui migrate 테스트가 있으면 `styleEditorView` 기본값 케이스 추가.
- **e2e 시나리오** (`/e2e-write` 입력):
  - 요소 선택 후 스타일 영역에 폼/코드 토글(`style-view-toggle`)이 보인다.
  - 코드 토글을 누르면 `style-code-editor` textarea가 나타나고 폼 섹션은 사라진다.
  - textarea에 `padding-top: 32px;`를 입력하면 변경사항 다이얼로그에 변경이 잡힌다.
  - 코드에서 **롱핸드** `padding-top: 32px;` 입력 후 폼 토글로 전환하면 폼의 padding-top 컨트롤에 `32px`가 반영돼 있다(숏핸드 `padding: 32px;`는 폼에 반영되지 않음 — 의도된 동작, 별도 시나리오로 명시).
  - 코드에서 폼 미지원 속성(`cursor: pointer;`) 입력 후 폼↔코드 왕복해도 코드 textarea에 `cursor: pointer;`가 남아있다.
  - **버퍼 다중요소 + 코드 모드**: 코드 모드로 요소 A 편집 → 다른 요소 B로 repick(A 버퍼링) → A 재선택 시 복원된 편집이 코드 textarea에 그대로 뜨고 커서/재동기화가 정상(`onElementSelected` 복원 ↔ `lastCommittedRef` 트리거 검증 — 최고위험 지점).
  - 코드 모드를 선택하고 세션을 새로 열면(재진입) 코드 모드로 시작한다(영속).
- **수동 테스트** (자동화 어려움):
  - 코드 textarea 타이핑 중 커서 점프 없음(빠른 연속 입력·중간 삽입).
  - `!important` 오버라이드가 Tailwind `!important` 페이지에서 실제 적용됨(captureVisibleTab/실제 렌더 의존).
  - 참조 뷰가 실제 페이지 요소에서 올바른 소스 셀렉터를 보여줌.

## 구현 순서 권장

1. **Task 1**(변환기, 테스트 우선) · **Task 2**(store 필드) · **Task 6**(`!important` 헬퍼) 는 서로 독립 — 병렬 가능.
2. **Task 3**(StyleCodeEditor) 는 Task 1 의존. **Task 6과 hard dependency — 반드시 함께 배포**(Task 6 없이 Task 3만 나가면 `!important` 선언 드롭).
3. **Task 4**(SelectedPanel 스왑) 는 Task 2·3 의존.
4. **Task 5**(참조 뷰) 는 v1 미구현(v2 이관).

## 가이드 영향

사용자 노출 UX 추가(코드 편집 모드 토글). `/guide`로 아래를 ko·en 동시 갱신 — 작성 전 `guide/AUTHORING.md` 규칙 확인.
- 요소 스타일 편집 가이드 페이지(현행 폼 편집 설명 위치): 폼/코드 두 모드 토글, 코드 모드의 raw CSS 입력·임의 속성 지원 설명 추가.
- 정확한 파일명은 `guide/ko`·`guide/en` 구조 확인 후 `/guide`에서 결정.
