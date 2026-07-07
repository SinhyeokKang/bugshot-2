# 스타일 편집 코드 뷰 리팩터 (DevTools 스타일 패널화)

## 배경

v1 코드 뷰(`style-code-view`)는 요소 스타일 편집 패널에 폼/코드 두 모드를 두고, 코드 모드는 사용자가 편집한 오버라이드(`styleEdits.inlineStyle`)만 담긴 순수 `<textarea>`였다. 두 문제가 드러났다.

1. **빈 출발점**: 코드 탭을 열면 편집한 것만 보여, 요소가 실제로 어떤 스타일을 갖고 있는지 파악할 수 없다. Chrome DevTools 스타일 패널처럼 "이 요소의 현재 스타일"이 채워져 있어야 편집 출발점이 된다.
2. **밋밋한 비주얼**: plain textarea라 신택스 하이라이팅·줄번호·자동완성이 없어 CSS를 다루는 개발자 경험이 빈약하다.

이 리팩터는 코드 탭을 **Chrome DevTools 스타일 패널에 가까운 CSS 편집 경험**으로 끌어올린다.

## 목표

- 탭을 **편집(폼) / CSS(코드)** 2탭으로 재구성하고, 각 탭에 아이콘을 부여한다(탭명 변경: 폼→편집, 코드→CSS).
- CSS 탭을 **CodeMirror 6 기반 CSS 에디터**로 교체한다 — 신택스 하이라이팅, 줄번호, CSS 자동완성(prop명·값 제안), prop 추가·삭제.
- CSS 탭에 요소가 **실제 지정한 스타일(`specifiedStyles`)을 `selector { … }` 블록으로 prefill**한다. DevTools의 element rule처럼 요소 selector를 헤더로 표시한다.
- CSS 탭 상단에 **computed 박스모델 그래픽**(margin/border/padding/content 중첩 시각화 + 각 변 값)을 read-only로 표시한다.
- 편집은 v1의 **inlineStyle 오버라이드 모델을 유지**한다 — prefill된 specified 값을 그대로 두면 변경 없음(오버라이드 0), 값을 바꾸거나 prop을 추가하면 그 prop만 오버라이드로 잡혀 라이브 반영·before/after diff·변경사항 다이얼로그에 흐른다.

## 비목표 (Non-goals)

- **매칭 규칙(스코프 B) 편집**: DevTools처럼 여러 `.class {}` 규칙을 개별 블록으로 편집하는 것. 요소별 인라인 오버라이드·요소별 before/after 모델과 충돌하므로 v1과 동일하게 제외한다(단일 병합 블록만).
- **전체 computed 속성 리스트(filter/show all/group)**: 박스모델 그래픽만 넣고, ~90개 전체 computed prop 리스트는 이번 스코프에서 제외한다.
- **박스모델 인라인 편집**: 박스모델 그래픽은 read-only. 각 변 값 더블클릭 편집(DevTools)은 제외한다.
- **CSS 이외 언어·멀티 셀렉터·미디어쿼리 편집**.
- 폼(편집) 탭의 컨트롤·섹션 구성 변경 — 기존 그대로 유지한다.

## 사용자 시나리오

1. 요소를 선택하면 편집 패널이 열리고, DOM 네비 밴드 아래 **[편집][CSS]** 탭(아이콘 포함)이 별도 컨테이너에 고정(sticky)돼 있다.
2. **CSS** 탭을 누르면:
   - 상단에 요소의 **박스모델 그래픽**(margin/border/padding/content 중첩 + 각 변 px, content 크기)이 뜬다.
   - 그 아래 CodeMirror 에디터에 `div.card#hero:nth-child(2) { … }` 형태로 요소 selector와 **specified 선언들**이 신택스 하이라이팅·줄번호와 함께 prefill돼 있다.
3. 선언 값을 바꾸거나(`color: #333;` → `color: red;`) 새 prop을 타이핑하면 자동완성이 제안하고, 페이지에 **즉시 반영**된다. 바뀐 prop만 오버라이드로 잡혀 변경사항 다이얼로그·before/after에 나타난다.
4. specified prefill 값을 건드리지 않으면 오버라이드 0 — [다음]은 비활성(변경 없음), phantom diff 없음.
5. **편집** 탭으로 돌아가면 폼 컨트롤에 그 변경이 반영돼 있고(양방향 동기화), 폼에서 바꾼 값도 CSS 탭 재진입 시 코드에 반영된다.
6. 여러 요소를 버퍼링해도(다시 선택) 각 요소의 CSS 편집이 복원된다(v1 동작 유지).
7. 고른 탭(편집/CSS)은 영속돼 다음 요소 선택·패널 재열기에서 유지된다.

### 엣지 케이스

- **specified가 비었거나 적은 요소**(인라인·매칭 규칙 없음): selector 헤더 + 빈/소수 선언. 자동완성으로 새 prop을 추가해 편집.
- **폼 미지원 임의 속성**(`cursor` 등)·`!important`: CSS 탭에서 자유 입력, v1대로 오버라이드에 담기고 적용된다.
- **specified 값과 정확히 같은 값으로 다시 타이핑**: 오버라이드 아님(baseline=specified와 문자열 일치 → diff 0).
- **CSS 문법 오류**(닫는 `}` 없음, 값 없는 선언): 관대 파싱으로 유효 선언만 반영, 나머지 무시(v1 tolerant 파서 계승).

## 성공 기준

- CSS 탭 진입 시 요소 selector + specified 선언이 신택스 하이라이팅·줄번호로 채워진다.
- 박스모델 그래픽이 computed 값(margin/border/padding/size)을 정확히 표시한다.
- 선언 편집이 라이브 반영되고, specified와 다른 prop만 변경사항으로 잡힌다(phantom diff 없음).
- CSS 자동완성이 prop명·값을 제안한다.
- 편집↔CSS 양방향 동기화·버퍼 복원·탭 영속이 v1 수준으로 유지된다.
- `pnpm test`(순수 함수)·`pnpm typecheck` 통과, e2e 개편 후 green.
