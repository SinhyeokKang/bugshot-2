# 액션 로그 인라인 텍스트 디자인 강화

## 배경
액션 로그(`ActionLogContent`)의 각 항목은 현재 `"값" 따옴표`로만 변수 부분을 구분한 평문 한 줄이다. 입력한 값·클릭한 요소·키 조합이 주변 텍스트와 섞여 빠르게 훑기 어렵다. 버그 재현 흐름을 검토할 때 "무엇을 입력/클릭/이동했는가"가 한눈에 들어와야 한다.

레퍼런스(`~/Desktop/스크린샷 2026-06-25 15.06.25.png`)는 변수 부분을 박스 칩·문법 하이라이팅·링크로 구분한 형태다. 추적성을 위해 핵심 디자인 규칙을 본문(아래 "디자인 규칙")에 텍스트로 고정한다.

함께, 외부 링크(`<a target="_blank">`) 인라인 렌더가 `ActionLogContent`·`ConsoleLogContent`에 동일 스타일로 **중복**돼 있어, 이번에 공용 컴포넌트로 추출해 통합한다(사용자 요구).

## 목표
- 사용자가 **입력·선택한 값**(input 텍스트, select 옵션, 키 조합)을 monospace **박스 칩**으로 강조한다.
- 클릭 대상에 **접근성 이름이 없을 때** 요소를 `<tag type="...">` 형태로 **문법 하이라이팅**한다.
- 클릭 대상에 **접근성 이름이 있으면** 그 이름을 강조 텍스트로 보여준다(칩 아님).
- 네비게이션 URL은 blue+underline 링크를 유지한다.
- 인라인 외부 링크를 공용 `InlineLink` 컴포넌트로 추출하고, 값 칩을 공용 `InlineChip`으로 만든다. 기존 중복 링크 호출부(`ConsoleLogContent`)를 공용 컴포넌트로 **시각 변화 없이** 치환한다.
- ko/en 동사 어순을 유지한다(템플릿 문자열 불변).
- 사이드패널과 로그 뷰어(`dist-log-viewer`) 양쪽에 동일하게 적용된다(공유 컴포넌트).

## 디자인 규칙 (고정 — 레퍼런스 파일 비의존)
- **값 칩(InlineChip)**: 흰 배경 + 얇은 테두리 + `rounded-md` + monospace(각진 코드 칩). shadcn `Badge`(rounded-full)가 아님.
- **마스킹 값 칩**: 점선 테두리 + muted 색 + `aria-label`로 스크린리더에 "masked value" 전달.
- **클릭 태그 하이라이트(ClickTarget)** — 기존 `DomTreeDialog` 팔레트에 통일:
  - 태그명: `text-sky-600 dark:text-sky-400`
  - `type` 속성명: `text-amber-600 dark:text-amber-400`
  - 속성 값(`"submit"`): `text-red-700 dark:text-red-400` (= `JsonTreeViewer.VALUE_COLORS.string`)
  - 장식 괄호 `< > =`: `text-muted-foreground` + `aria-hidden`
- **링크(InlineLink)**: `text-blue-600 underline dark:text-blue-400`, `target="_blank" rel="noopener noreferrer"`.
- emerald/rose 등 코드베이스 미사용 색을 신규 도입하지 않는다(CLAUDE.md "커스텀 색 남발 금지").

## 비목표 (Non-goals)
- 콘솔/네트워크 로그에 **새 칩 디자인 도입**(콘솔 인자·네트워크 status 칩화 등). 이번 콘솔/네트워크 변경은 **외부 링크 호출부의 공용 컴포넌트 치환(시각 동일)** 으로 한정.
- 클릭 대상에 `type` 외 속성(`name`/`role`/`id`/`href`) 노출.
- 클릭 대상에 접근성 이름과 태그를 동시 표시.
- toggle 항목에 value(checked/unchecked) 칩 표시 — 동사(Checked/Unchecked)가 상태를 이미 반영하므로 생략.
- 액션 로그 JSON/HTML export 포맷 변경.
- 새 i18n **동사** 키 추가 또는 기존 동사 템플릿 문자열 변경. (단, `log-viewer/i18n.ts`에 누락된 기존 동사 키 보강은 회귀 수정으로 허용.)
- 렌더 성능 최적화(메모이제이션·가상 스크롤). 항목당 `splitTemplate` 파싱·다중 노드 생성이 추가되나 최적화는 이번 스코프 밖.
- 영상 타임라인 마커(`log-viewer/markers.ts`) 텍스트 변경 — 마커는 기존 `role` 단어 표기를 유지(본문과 비대칭, 의도).

## 사용자 시나리오
액션 녹화 후 사이드패널 또는 로그 뷰어의 "액션" 탭을 연다.

1. **텍스트 입력** → `Entered [cheese] in "Email"` — 값 `cheese`가 박스 칩.
2. **비밀번호 입력** → `Entered [********] in "Password"` — 마스킹 값(`MASKED_DISPLAY = "[********]"`)이 점선 muted 칩.
3. **select 선택** → `Selected [Option 1] in "Category"` — 옵션 텍스트가 칩.
4. **단축키** → `Pressed [Ctrl+S]` — 키 조합이 칩. (현재 코드는 keypress value를 따옴표 없이 출력 → 평문에서 칩으로 전환.)
5. **이름 있는 클릭**(버튼 텍스트 "Save") → `Clicked Save` — 강조 텍스트. (기존 `"Save" button`의 role 단어 `button`은 사라짐 — 의도된 변화.)
6. **이름 없는 클릭, type 있음**(빈 submit 버튼) → `Clicked <button type="submit">`.
7. **이름 없는 클릭, type 없음**(빈 div, role=button) → `Clicked <div>`.
8. **페이지 이동** → `Navigated to https://...` — URL이 blue+underline 링크(새 탭).
9. **토글**(체크박스/라디오) → `Checked "Remember me"` — 필드 라벨은 따옴표 유지(칩 아님), value 칩 없음.

엣지 케이스:
- 좁은 사이드패널(~400px)에서 긴 값(이메일 등) 칩이 줄바꿈돼도 박스 양 끝 라운드가 유지된다(`[box-decoration-break:clone]`).
- 멀티 select 값(`"A, B, C"`)도 단일 칩 — 길면 줄바꿈.
- 값이 빈 문자열이면 빈 칩 박스(`[]`)를 피한다(아래 성공 기준).
- 마이그레이션 전 저장된 세션의 클릭 항목(태그 정보 없음)은 기존처럼 이름(없으면 selector)을 따옴표로 표시한다(회귀 없음).
- 콘솔 로그의 페이지 URL 링크는 공용 컴포넌트로 치환돼도 시각·동작이 동일하다.

## 성공 기준
- 위 9개 시나리오가 의도대로 렌더된다(수동 + e2e). **완성 판정선**: 칩/태그/링크가 시각적으로 구분되고 색이 디자인 규칙과 일치하면 충족 — 레퍼런스 픽셀 매칭은 요구하지 않는다.
- 값이 빈 문자열인 input/select는 빈 칩을 만들지 않는다(칩 생략 또는 placeholder).
- `ConsoleLogContent`의 외부 링크가 공용 컴포넌트 치환 후에도 시각·동작 무회귀.
- `pnpm typecheck`·`pnpm test` 통과, i18n locales 대칭 테스트 통과.
- 로그 뷰어 빌드(`pnpm build:log-viewer`)에서도 동일 렌더(keypress/toggle/select 포함 — i18n 키 누락 없음 확인).
- 기존 저장 세션 로드 시 클릭 항목이 깨지지 않는다.
