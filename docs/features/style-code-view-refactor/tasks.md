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
  - `computeOverrides({color:"red",margin:"0"}, {color:"red",padding:"8px"})` → `{margin:"0"}`(color는 specified와 동일 → 제외, padding은 edited에 없음 → 제외).
- **검증**:
  - [ ] `pnpm test` — 신규 테스트 통과
  - [ ] round-trip: `parseCssBlock(serializeCssBlock(sel,m))`가 `m`과 동치
  - [ ] `computeOverrides`가 specified와 동일 값 전부 제거(빈 맵) — phantom diff 방지 케이스
  - [ ] 엣지: `!important` 값·임의 속성·중복 prop·값 없는 선언·selector만 있는 입력

### Task 2: parseBoxModel 순수 함수 (테스트 우선)
- **변경 대상**: `src/sidepanel/tabs/styleEditor/boxModel.ts`(신규), `styleEditor/__tests__/boxModel.test.ts`(신규)
- **작업 내용**: `parseBoxModel(computed)` + `BoxModel`/`BoxSides` 타입. **테스트 먼저**.
  - margin/border-width/padding 4면 + content width/height를 px 숫자로 파싱. `"11px"`→11, `"auto"`/파싱실패→0. `contentLabel`은 `${width}×${height}` 원문(소수 보존).
- **검증**:
  - [ ] `pnpm test` — 정상(전 필드 px) / `auto`·빈값 → 0 / 소수 width(`100.273px`) 보존 케이스
  - [ ] 부분 누락 computed(키 없음) → 0으로 안전

### Task 3: CodeMirror 의존성 추가 + StyleCssView 에디터
- **변경 대상**: `package.json`(deps), `src/sidepanel/tabs/styleEditor/StyleCssView.tsx`(신규)
- **작업 내용**: `@uiw/react-codemirror` + `@codemirror/lang-css` 설치. `StyleCssView`에 CodeMirror 마운트 — `doc = serializeCssBlock(selection.selector, {...specifiedStyles, ...inlineStyle})`, 확장 `[css(), lineNumbers 기본 포함, EditorView.lineWrapping]`, 라이트/다크 테마(사이드패널 테마 토큰). onChange → `parseCssBlock` → `computeOverrides(parsed, specifiedStyles)` → `setStyleEdits({inlineStyle})` → `applyStyles`. 외부 변경 재동기화는 `lastCommittedRef`(직전 doc 문자열) 비교 후 `onChange` 아닌 controlled `value` 갱신. `data-testid="style-css-view"`, 에디터 컨테이너 식별용.
- **검증**:
  - [ ] CSS 탭에서 selector{}+specified 선언이 신택스 하이라이팅·줄번호로 표시(수동/e2e)
  - [ ] 선언 값 변경이 페이지 라이브 반영 + 변경사항 다이얼로그에 그 prop만
  - [ ] specified prefill 안 건드리면 [다음] 비활성(오버라이드 0)
  - [ ] CSS 자동완성(prop명 타이핑 시 제안) 동작(수동)
  - [ ] 타이핑 중 커서 점프 없음(수동)
  - [ ] 번들 영향 확인 — lazy import 검토(CSS 탭 진입 시 로드)

### Task 4: BoxModelDiagram 컴포넌트
- **변경 대상**: `src/sidepanel/tabs/styleEditor/BoxModelDiagram.tsx`(신규), StyleCssView에 편입
- **작업 내용**: `parseBoxModel` 결과를 중첩 div로 렌더(margin 주황·border 노랑·padding 초록·content 파랑, 각 변 값 텍스트, 가운데 `contentLabel`). read-only. 다크모드 대비.
- **검증**:
  - [ ] computed 값과 각 변 표시가 일치(수동 — 실제 요소)
  - [ ] 라이트/다크 모두 가독(수동)

### Task 5: StyleEditorPanel 통합 (탭 재구성 + 아이콘 + 뷰 스왑)
- **변경 대상**: `src/sidepanel/tabs/StyleEditorPanel.tsx`, `src/i18n/namespaces/editor.ts`
- **작업 내용**:
  - 탭 토글을 DOM 네비 밴드 아래 별도 sticky 컨테이너로 분리(`border-t px-4 py-3`).
  - `TabsTrigger`에 아이콘: 편집=`SlidersHorizontal`, CSS=`Code2`(lucide-react) + 라벨.
  - `view === "code"` → `<StyleCssView />`, `view === "form"` → 기존 폼 섹션. class·Text 섹션은 **편집 탭 전용**(CSS 탭에서 hidden). 조건부 `hidden` + `[&>section:last-child]:border-b`.
  - i18n `editor.view.form`=`편집`/`Edit`, `editor.view.code`=`CSS`/`CSS`. `editor.codePlaceholder` 정리(빈 selector 안내로 재활용 또는 제거). ko/en 동시.
  - `styleEditorView` 값(`"form"|"code"`)·persist v7 그대로(마이그레이션 불필요).
- **검증**:
  - [ ] `pnpm typecheck` + i18n locales 대칭 테스트 통과
  - [ ] 탭 아이콘·라벨(편집/CSS) 표시, 전환 시 편집 영역만 스왑(DOM 네비·푸터·변경사항 불변)
  - [ ] CSS 탭에서 class·Text 섹션 숨김, 편집 탭에서 노출
  - [ ] 탭 영속(재진입 시 유지)

### Task 6: 기존 StyleCodeEditor 제거 + 참조 정리
- **변경 대상**: `src/sidepanel/tabs/styleEditor/StyleCodeEditor.tsx`(삭제), import 참조
- **작업 내용**: v1 `StyleCodeEditor` 제거(StyleCssView가 대체). `inlineCssText.ts`는 cssBlock이 재사용하므로 유지. 고아 import 정리.
- **검증**:
  - [ ] `pnpm typecheck` 통과(참조 없음)
  - [ ] `inlineCssText.test.ts` 여전히 green(재사용)

## 테스트 계획

- **단위 테스트**:
  - `cssBlock.test.ts` — serialize/parse round-trip + `computeOverrides`(specified 동일 제거·변경분만·엣지).
  - `boxModel.test.ts` — `parseBoxModel`(정상 px·auto·소수·부분 누락).
  - `inlineCssText.test.ts` — 기존 유지(재사용 회귀 가드).
- **e2e 시나리오** (`/e2e-write` 입력 — v1 `style-code-view.spec.ts` 전면 개편):
  - CSS 탭 진입 시 selector + specified 선언이 에디터(`style-css-view`)에 prefill돼 있다(요소가 지정한 prop이 코드에 보인다).
  - CSS 탭 상단에 박스모델 그래픽이 보인다.
  - 에디터에서 specified 값을 다른 값으로 바꾸면 페이지에 라이브 반영되고 변경사항 다이얼로그에 그 prop이 잡힌다.
  - specified 값을 안 건드리면 변경사항 0(오버라이드 없음, `changes-trigger` 비활성).
  - 폼 미지원 임의 속성(`cursor: pointer;`)을 추가하면 페이지 반영 + 편집 탭 왕복해도 코드에 유지.
  - 편집(폼) 탭에서 값 바꾸면 CSS 탭 재진입 시 코드에 반영(양방향 동기화).
  - 버퍼 다중요소: CSS 탭으로 A 편집 → B repick → A 재선택 시 편집 복원(코드에 반영).
  - 탭(편집/CSS) 선택 후 패널 재열기 시 그 탭으로 시작(영속).
  - CSS 탭에서 class·Text 섹션이 숨겨진다(편집 탭에선 보인다).
- **수동 테스트** (자동화 어려움):
  - CodeMirror 신택스 하이라이팅·줄번호·자동완성 시각/동작.
  - 타이핑 중 커서 점프 없음(빠른 연속 입력).
  - 박스모델 그래픽이 실제 요소 computed와 일치, 라이트/다크 가독.
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
