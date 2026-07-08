# 스타일 편집 코드 뷰 리팩터 — 구현 태스크

## 선행 조건

- **CodeMirror 6 의존성 추가**: `@uiw/react-codemirror` + `@codemirror/lang-css`. `pnpm add`가 `pnpm-workspace.yaml`의 `minimumReleaseAge: 1440`(24h)에 걸릴 수 있음 — 안정 버전이라 통상 통과하나, 막히면 정책 확인. `onlyBuiltDependencies` 경고(빌드 스크립트) 뜨면 검토.
- 신규 권한·env·OAuth·외부 API 없음. privacy/PERMISSION 무관(로컬 편집, 새 수집·전송 없음).
- i18n 신규/변경 키는 ko/en 동시(PostToolUse 훅 대칭 검사).

## 태스크

### Task 1: cssBlock 순수 변환기 (테스트 우선)
- **변경 대상**: `src/sidepanel/tabs/styleEditor/cssBlock.ts`(신규), `styleEditor/__tests__/cssBlock.test.ts`(신규)
- **작업 내용**: `serializeCssBlock`/`parseCssBlock`/`computeOverrides` 구현. `inlineCssText.ts`의 `parseInlineStyle`/`serializeInlineStyle` 재사용. **테스트 먼저**(`/tdd interface`).
  - `serializeCssBlock(sel, {color:"red"})` → `"sel {\n  color: red;\n}"`, 빈 맵 → `"sel {\n}"`.
  - `parseCssBlock("sel {\n color: red;\n}")` → `{color:"red"}`, 중괄호 없는 텍스트도 관대 파싱, selector 무시.
  - `computeOverrides({color:"red",margin:"0"}, {color:"red",padding:"8px"})` → `{margin:"0",padding:"initial"}`(color는 specified와 동일 → 제외, margin은 변경 → 포함, **padding은 edited에서 빠짐 → `initial` 원복**).
- **검증**:
  - [x] `pnpm test` — 신규 테스트 통과 (cssBlock.test.ts 20 케이스)
  - [x] round-trip: `parseCssBlock(serializeCssBlock(sel,m))`가 `m`과 동치
  - [x] **무편집 불변식**: `computeOverrides(parseCssBlock(serializeCssBlock(sel, specified)), specified) === {}` — 합성 맵뿐 아니라 **실제 `getComputedStyle` 파생 형태 값**(`rgb(0, 0, 0)`·공백 포함 shorthand·소수 px)에서도 빈 맵
  - [x] **삭제=원복**: specified에 있던 prop이 edited에서 빠지면 `{prop:"initial"}` 방출
  - [x] 엣지: `!important` 값·임의 속성·중복 prop·값 없는 선언·selector만 있는 입력

### Task 2: parseBoxModel 순수 함수 (테스트 우선)
- **변경 대상**: `src/sidepanel/tabs/styleEditor/boxModel.ts`(신규), `styleEditor/__tests__/boxModel.test.ts`(신규)
- **작업 내용**: `parseBoxModel(computed)` + `BoxModel`/`BoxSides` 타입. **테스트 먼저**.
  - margin/border-width/padding 4면 + content width/height를 px 숫자로 파싱. `"11px"`→11, `"auto"`/파싱실패→0. `contentLabel`은 `${width}×${height}` 원문(소수 보존).
- **검증**:
  - [x] `pnpm test` — 정상(전 필드 px) / `auto`·빈값 → 0 / 소수 width(`100.273px`) 보존 케이스 (boxModel.test.ts 6 케이스)
  - [x] 부분 누락 computed(키 없음) → 0으로 안전

### Task 3: CodeMirror 의존성 추가 + StyleCssView 에디터
- **변경 대상**: `package.json`(deps), `src/sidepanel/tabs/styleEditor/StyleCssView.tsx`(신규)
- **작업 내용**: `@uiw/react-codemirror` + `@codemirror/lang-css`를 **동적 `import()`로 lazy 로드(필수)** + 로드 중 fallback UI(스켈레톤/spinner). `StyleCssView`에 CodeMirror 마운트 — `doc = serializeCssBlock(selection.selector, {...specifiedStyles, ...inlineStyle})`, 확장 `[css(), 값 자동완성 커스텀 completionSource, lineNumbers 기본, EditorView.lineWrapping]` + `indentWithTab={false}`(Tab 포커스 이탈 — 트랩 방지), 라이트/다크 테마(사이드패널 테마 토큰). onChange → `parseCssBlock` → `computeOverrides(parsed, specifiedStyles)` → `setStyleEdits({inlineStyle})` → `applyStyles`. 외부 변경 재동기화는 `lastCommittedRef`(직전 **재구성 문자열** `serializeCssBlock(sel,{...specified,...overrides})`, raw 텍스트 아님) 비교 후 `onChange` 아닌 controlled `value` 갱신. 요소 전환은 상위에서 `key={elementKey(selection)}` remount(Task 5). `data-testid="style-css-view"`.
- **검증** (자동=단위/e2e, 수동=시각):
  - [x] (자동/로직) 선언 값 변경이 페이지 라이브 반영 + 변경사항 다이얼로그에 그 prop만 — 폼 useStyleProp.set과 동일 apply 경로 확인 (e2e green은 `/e2e-write`)
  - [x] (자동/로직) specified prefill 안 건드리면 [다음] 비활성(오버라이드 0) — computeOverrides 무편집 {} 테스트 고정
  - [x] (자동/로직) 외부 변경(폼 편집) 시 재동기화로 doc 갱신, 요소 A→B 전환 시 doc 재파생(remount) — 재구성 문자열 ref + key={elementKey} (e2e green은 `/e2e-write`)
  - [ ] (수동) CSS 탭에서 selector{}+specified 선언이 신택스 하이라이팅·줄번호로 표시
  - [ ] (수동) 자동완성 — prop명(lang-css) + 값(커스텀 completionSource) 제안 동작
  - [ ] (수동) 타이핑 중 커서 점프 없음(빠른 연속 입력), Tab 키로 에디터 밖 탈출 가능
  - [ ] (수동) CSS 탭 진입 시 lazy 로드 fallback 표시 후 에디터 마운트, 초기 메인 청크 번들 증가 없음(lazy 확인)

### Task 4: BoxModelDiagram 컴포넌트
- **변경 대상**: `src/sidepanel/tabs/styleEditor/BoxModelDiagram.tsx`(신규), StyleCssView에 편입
- **작업 내용**: `parseBoxModel` 결과를 중첩 div로 렌더(margin 주황·border 노랑·padding 초록·content 파랑, 각 변 값 텍스트, 가운데 `contentLabel`). read-only. 다크모드 대비. **접근성**: 각 영역에 `aria-label`(색상만 의존 회피). **세로 예산**: 높이 상한(`max-h`)으로 좁은 패널 상단 과점 방지. `box={parseBoxModel(selection.computedStyles)}`라 apply 후 computedStyles 재수집 시 자동 재측정.
- **검증**:
  - [ ] computed 값과 각 변 표시가 일치(수동 — 실제 요소), 편집→apply 후 재측정 갱신
  - [ ] 라이트/다크 모두 가독(수동), 각 영역 aria-label 존재
  - [ ] 박스모델이 상단을 과점하지 않고 에디터 가시 영역 확보(수동)

### Task 5: StyleEditorPanel 통합 (탭 재구성 + 아이콘 + 뷰 스왑)
- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`, `src/i18n/namespaces/editor.ts`
- **작업 내용**:
  - 탭 토글을 DOM 네비 밴드 아래 별도 sticky 컨테이너로 분리(`border-t px-4 py-3`, 같은 sticky wrapper 안).
  - `TabsTrigger`에 아이콘: 편집=`Paintbrush`(`SlidersHorizontal`은 SettingsTab general 점유라 회피), CSS=`Code2`(lucide-react) + 라벨. 아이콘 사이징은 기존 탭 컨벤션 토큰 `h-3.5 w-3.5 shrink-0` + 트리거 `gap-1.5`.
  - `view === "code"` → `<StyleCssView key={sameElementKey(selection)} />`(요소 전환 remount), `view === "form"` → 기존 폼 섹션. class·Text 섹션은 **편집 탭 전용**(CSS 탭에서 hidden). 조건부 `hidden` + `[&>section:last-child]:border-b`. **언마운트 아닌 hidden**(collapsible open-state 보존).
  - i18n `editor.view.form`=`편집`/`Edit`, `editor.view.code`=`CSS`/`CSS`. `editor.codePlaceholder`는 **완전 제거**(ko/en) — 신규 에디터에 placeholder 표면이 없어 재활용 대상이 사라짐. 유일 참조처 StyleCodeEditor를 같은 배치(Task 6)에서 삭제하므로 dangling 없음(typecheck·grep 확인).
  - `styleEditorView` 값(`"form"|"code"`)·persist v7 그대로(마이그레이션 불필요).
- **검증**:
  - [x] `pnpm typecheck` + i18n locales 대칭 테스트 통과
  - [x] 탭 아이콘(Paintbrush/Code2)·라벨(편집/CSS) 표시, 전환 시 편집 영역만 스왑(DOM 네비·푸터·변경사항 불변)
  - [x] CSS 탭에서 class·Text 섹션 숨김, 편집 탭에서 노출
  - [x] 탭 영속(재진입 시 유지) — styleEditorView persist 그대로
  - [x] 편집↔CSS 왕복 후 폼 collapsible 섹션 open-state 보존(언마운트 아님 — 폼 섹션은 hidden 유지)

### Task 6: 기존 StyleCodeEditor 제거 + 참조 정리
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StyleCodeEditor.tsx`(삭제), import 참조
- **작업 내용**: v1 `StyleCodeEditor` 제거(StyleCssView가 대체). `inlineCssText.ts`는 cssBlock이 재사용하므로 유지. 고아 import 정리.
- **검증**:
  - [x] `pnpm typecheck` 통과(참조 없음 — StyleCodeEditor·codePlaceholder·style-code-editor grep 0건)
  - [x] `inlineCssText.test.ts` 여전히 green(재사용)

## 테스트 계획

- **단위 테스트**:
  - `cssBlock.test.ts` — serialize/parse round-trip + `computeOverrides`(변경분만·**무편집 시 실제 형태 값 `rgb(0, 0, 0)`으로 빈 맵**·**삭제=`initial` 원복**·엣지).
  - `boxModel.test.ts` — `parseBoxModel`(정상 px·auto·소수·부분 누락).
  - `inlineCssText.test.ts` — 기존 유지(재사용 회귀 가드).
- **e2e 시나리오** (`/e2e-write` 입력 — v1 `style-code-view.spec.ts` 전면 개편):
  - **입력/읽기 방식(필수 명시)**: CodeMirror는 `<textarea>`가 아니라 `.cm-content` contenteditable — 기존 spec의 `fill()`/`toHaveValue()`가 throw한다. 타이핑은 `.cm-content` 포커스 후 `pressSequentially`/`keyboard`, 텍스트 검증은 `toHaveText`/`textContent`로 한다. `style-css-view` 컨테이너 안 `.cm-content`를 내부 셀렉터로. **GOTCHAS에 신규 등록**.
  - **뷰 누출 방지(필수)**: `styleEditorView`는 persist(v7)라 `afterAll`(또는 각 테스트 종료)에서 `"form"`으로 복원해야 폼 기본을 가정하는 인접 스타일 스펙(`style-changes-dialog`·`style-field-fixes`·`border-per-side`·`buffered-reselect-edit` 등)이 깨지지 않는다.
  - CSS 탭 진입 시 selector + specified 선언이 에디터(`style-css-view`)에 prefill돼 있다.
  - CSS 탭 상단에 박스모델 그래픽이 보인다.
  - 에디터에서 specified 값을 다른 값으로 바꾸면 페이지 라이브 반영 + 변경사항 다이얼로그에 그 prop.
  - specified 값을 안 건드리면 변경사항 0(`changes-trigger` 비활성).
  - specified 선언 라인을 지우면 그 속성이 `initial`로 원복되고 변경사항에 잡힌다(삭제=원복).
  - 폼 미지원 임의 속성(`cursor: pointer;`) 추가 → 페이지 반영 + 편집 탭 왕복해도 코드 유지.
  - 편집(폼) 탭에서 값 바꾸면 CSS 탭 재진입 시 코드 반영(양방향 동기화 — 외부변경 재동기화 커버).
  - 버퍼 다중요소: CSS 탭으로 A 편집 → B repick → A 재선택 시 편집 복원(요소 전환 remount로 doc 재파생).
  - 탭(편집/CSS) 선택 후 패널 재열기 시 그 탭으로 시작(영속).
  - CSS 탭에서 class·Text 섹션 숨김(편집 탭에선 보임), 편집↔CSS 왕복 후 폼 섹션 open-state 보존.
- **e2e 회귀 게이트**: 개편 후 **스타일 e2e 스위트 전수 재실행**(뷰 누출로 인접 스펙 깨지지 않음 확인).
- **수동 테스트** (자동화 어려움):
  - CodeMirror 신택스 하이라이팅·줄번호·자동완성(prop명 + 값) 시각/동작.
  - 타이핑 중 커서 점프 없음(빠른 연속 입력), Tab 키 에디터 밖 탈출.
  - 박스모델 그래픽이 실제 요소 computed와 일치·apply 후 재측정, 라이트/다크 가독.
  - lazy 로드 fallback 표시 → 에디터 마운트.
  - `!important`가 Tailwind `!important` 페이지에서 실제 적용.

## 구현 순서 권장

1. **Task 1**(cssBlock)·**Task 2**(boxModel) — 순수 함수, 독립·병렬 가능. 테스트 우선.
2. **Task 3**(CodeMirror + StyleCssView) — Task 1 의존. 의존성 설치 포함.
3. **Task 4**(BoxModelDiagram) — Task 2 의존. StyleCssView에 편입.
4. **Task 5**(StyleEditorPanel 통합) — Task 3·4 의존.
5. **Task 6**(정리) — 마지막.

## 가이드 영향

사용자 노출 UX 변경(코드 탭 → CSS 편집 뷰, 탭명 편집/CSS, 박스모델, 자동완성). `/guide`로 아래 ko·en 동시 갱신(작성 전 `guide/AUTHORING.md` 규칙 확인):
- `element/styling.md`(ko·en) — v1에서 추가한 "폼으로, 또는 코드로" 섹션을 **편집/CSS 탭 + CodeMirror CSS 에디터(selector·specified prefill·자동완성) + 박스모델 그래픽**으로 갱신. class·Text가 CSS 탭에서 빠진다는 점 반영.
- `guide/AUTHORING.md` 사실 스냅샷의 "스타일 편집 폼/코드 뷰" 항목 → "편집/CSS 뷰"로 갱신(탭명·CodeMirror·specified prefill·박스모델).
