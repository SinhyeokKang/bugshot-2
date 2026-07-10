# PH 갤러리 제작 스펙

Product Hunt 갤러리 6장의 카피·목업 지시서. **웹스토어 리스팅과 목적이 다르다** — 웹스토어는 "이게 뭔지" 설명하지만, PH 방문자는 tagline과 description으로 이미 그걸 읽고 들어온다. 갤러리는 **왜 다른지**를 앞에서 때린다.

그래서 순서가 웹스토어와 다르다. 라이브 CSS 편집(2번)이 앞으로 온다 — Jam.dev를 비롯한 경쟁 제품에 없는 유일한 축이라, 여기서 차별화가 안 되면 뒤 장을 볼 이유가 없다.

## 공통 규격

| 항목 | 값 |
|---|---|
| 크기 | 1270×760 (PH 권장. 새로 만드니 정확히 맞춘다) |
| 포맷 | PNG, 5MB 미만 |
| 배경 | 기존 웹스토어 스크린샷과 동일한 연파랑→라벤더 그라디언트 |
| 카피 | 헤드라인 + 서브카피 1줄. 헤드라인은 기존 톤 유지(동사 시작, 마침표 최소) |
| 목업 | 패널 2장 겹침(뒤 흐릿 + 앞 선명), 라운드 코너 + 드롭섀도 |
| 언어 | 영문 |

**모바일 썸네일에서도 헤드라인이 읽혀야 한다.** PH 갤러리는 목록에서 축소 렌더된다 — 헤드라인이 3줄을 넘으면 뭉갠다.

카피 위치는 좌·중앙·우를 번갈아 배치해 6장을 넘길 때 리듬이 생기게 한다.

## 1. Hero — 결과물

- **헤드라인**: `The report writes itself`
- **서브카피**: `Environment, styles, and logs — already attached.`
- **카피 위치**: 좌측 중앙
- **목업**: 완성된 이슈 프리뷰 패널. `Environment` 섹션(OS / Browser / Page / Viewport / Captured)이 채워져 있고, 아래로 `Description`이 이어진다. 우상단 `Copy markdown` 버튼 노출.
- **왜 이 장이 먼저인가**: tagline이 "one shot"을 약속하니 첫 장은 그 약속의 **결과**를 보여준다. 무슨 제품인지는 옆의 description이 설명한다.

## 2. 차별점 — 고치고 나서 올린다

- **헤드라인**: `Fix the bug before you file it`
- **서브카피**: `Edit CSS on the live page. Every change ships as a before → after table.`
- **카피 위치**: 우측 상단
- **목업**: 2단 구성
  - 뒤: 실제 웹페이지에서 요소 하나가 picker로 하이라이트된 상태 (파란 아웃라인 + 셀렉터 라벨 칩)
  - 앞: `Style changes` 다이얼로그. before → after 행이 3~4개 보이게 하고, **최소 한 행은 디자인 토큰**(`--color-primary` 같은 이름)이 값으로 찍히게 한다. 이게 "raw computed 값이 아니라 디자인 시스템 언어로 말한다"는 증거다.
- **주의**: 이 장이 갤러리 전체에서 가장 중요하다. before/after 테이블의 텍스트가 축소 렌더에서도 "뭔가 좌→우로 바뀌는 표"로 읽혀야 한다. 행을 너무 많이 넣지 말 것.

## 3. 캡처

- **헤드라인**: `Capture exactly what broke`
- **서브카피**: `An element, a region, a recording, or the last 30 seconds.`
- **카피 위치**: 중앙 상단
- **목업**: `Choose capture mode` 화면 — `Edit element styles` / `Capture element` / `Capture area` / `Record screen` / `30s replay` 5개 버튼이 모두 보이게. 뒤쪽에 어노테이션(화살표·형광펜)이 얹힌 스크린샷 한 장을 겹쳐 "찍고 마킹한다"를 암시.

## 4. 로그

- **헤드라인**: `Console, network, actions. All captured`
- **서브카피**: `Even inside cross-origin iframes.`
- **카피 위치**: 좌측 상단
- **목업**: 기존 `webstore-3-en.png` 구성 그대로 — Console 탭(배지 숫자 있는 상태)과 Network 탭(요청 목록 + Headers 상세)을 겹쳐서. `Copy as cURL` 버튼이 보이면 개발자에게 강하게 먹힌다.
- **서브카피 근거**: 로그 레코더가 `all_frames: true`로 전 프레임에 주입돼 cross-origin iframe의 console/network까지 잡는다. 경쟁 제품이 흔히 놓치는 지점이라 명시할 값어치가 있다.

## 5. AI 초안

- **헤드라인**: `AI drafts the report`
- **서브카피**: `Steps to reproduce, written from what you did.`
- **카피 위치**: 좌측 하단
- **목업**: `Steps to reproduce` 섹션에 번호 매겨진 3단계가 채워진 상태. 하단에 `Let AI write your draft` 바(Chrome AI 배지 포함) 노출.

## 6. 연동 + 클로징

- **헤드라인**: `Send dev-ready reports in one shot`
- **서브카피**: `Free. No sign-up. Your reports go straight to your tracker.`
- **카피 위치**: 중앙 상단
- **목업**: 8개 플랫폼 로고 그리드 (Jira · GitHub · Linear · Notion · GitLab · Asana · ClickUp · Slack). 기존 `webstore-5-en.png` 레이아웃 그대로.
- **왜 서브카피를 바꾸는가**: 마지막 장은 설치를 결정하는 자리다. PH 관객은 계정 생성을 특히 싫어하므로 "무료 · 가입 없음 · 리포트 직행"을 여기서 못박는다.
- **"우리 서버를 안 거친다"고 쓰지 않는다**: OAuth 프록시가 6개 플랫폼의 인가 코드 교환을 중계한다. 참인 주장은 "**리포트**가 직행한다"뿐. README·privacy와 표현을 맞춘다.

## 재사용 가능 여부

새로 만들면 좋지만, 시간이 없으면 아래는 기존 파일을 거의 그대로 쓸 수 있다.

| 슬라이드 | 기존 파일 | 필요한 작업 |
|---|---|---|
| 1 | `webstore-1-en.png` | 헤드라인만 교체 |
| 2 | — | **신규 제작 필수** |
| 3 | `webstore-2-en.png` | 헤드라인·서브카피 교체 |
| 4 | `webstore-3-en.png` | 서브카피 추가 |
| 5 | `webstore-4-en.png` | 헤드라인 교체 |
| 6 | `webstore-5-en.png` | 서브카피 추가 |

**최소 공수 경로: 2번만 새로 만들고 나머지는 카피만 얹는다.** 2번이 없으면 갤러리에 차별점이 통째로 빠진다.

## UI 라벨 (목업에 찍힐 실제 문자열)

코드에서 확인한 값이라 목업이 실물과 어긋나지 않는다.

- `Review changes` — 변경사항 다이얼로그 트리거
- `Style changes` — 다이얼로그 제목
- `Reset all` / `Reset this change`
- `Choose capture mode`
- `Edit element styles` · `Capture element` · `Capture area` · `Record screen` · `30s replay`
- `Steps to reproduce`
- `Environment` · `Description`
- `Copy markdown` · `Copy as cURL`
- `Let AI write your draft`
- 탭: `Debug` · `Issues` · `Integrations` · `Settings`
