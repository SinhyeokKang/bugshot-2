# BugShot

디자인 QA를 위한 Chrome 확장 프로그램.
웹 페이지에서 문제를 발견하면, 그 자리에서 바로 Jira 또는 GitHub 이슈로 만들 수 있습니다.

[Chrome 웹스토어에서 설치](https://chromewebstore.google.com/detail/bugshot-%E2%80%94-%EB%94%94%EC%9E%90%EC%9D%B8-%EC%9D%B4%EC%8A%88-%ED%8A%B8%EB%9E%98%EC%BB%A4/ohakhekagkodklkickemonmifdcbhmig)

<br>

## 왜 BugShot인가요?

디자인 리뷰에서 발견한 문제를 이슈 트래커에 등록하려면 스크린샷 찍고, 셀렉터 복사하고, CSS 값 비교하고, 이슈 본문 쓰고… 번거롭습니다.

BugShot은 이 과정을 **요소 선택 → 스타일 수정 → 이슈 생성**의 한 흐름으로 줄여줍니다. 수정 전/후 비교표, 스크린샷, 영상 녹화, 네트워크/콘솔 로그까지 자동으로 이슈에 담깁니다.

<br>

## 주요 기능

### 요소를 골라서 CSS를 바로 고쳐보세요

DevTools를 열지 않아도 됩니다. 페이지 위에서 요소를 클릭하면 CSS를 바로 수정할 수 있고, 결과가 실시간으로 페이지에 반영됩니다. `padding`을 `16px`에서 `20px`로 바꾸면? 바로 보입니다.

수정이 끝나면 **변경 전/후 비교표**와 **Before/After 스크린샷**이 자동으로 만들어집니다. "여기 패딩이 잘못됐어요"를 정확한 수치와 증거로 전달할 수 있습니다.

디자인 시스템을 쓰고 있다면 더 유용합니다. `var(--spacing-14)`처럼 **디자인 토큰을 자동으로 인식**해서, computed value가 아닌 토큰 이름으로 변경사항을 보여줍니다.

### DOM 트리로 요소 구조를 확인하세요

선택한 요소의 DOM 트리를 사이드 패널에서 탐색할 수 있습니다. 조상 경로와 형제 요소를 한눈에 보고, 자식 노드는 필요할 때 펼쳐서 확인합니다.

### 화면을 캡처하고 주석을 다세요

드래그로 원하는 영역만 잘라내고, 화살표·텍스트·도형·형광펜으로 "여기가 문제야"를 명확하게 표시할 수 있습니다. 별도 캡처 도구가 필요 없습니다.

### 재현이 필요한 버그는 녹화하세요

"스크롤하면 깜빡인다", "호버하면 레이아웃이 밀린다" — 스크린샷으로 설명하기 어려운 버그는 현재 탭을 최대 60초까지 녹화해서 그대로 첨부할 수 있습니다.

### 네트워크·콘솔 로그도 함께 담으세요

API 에러, 콘솔 경고 같은 개발 맥락이 필요한 버그는 네트워크 요청과 콘솔 로그를 자동으로 수집해서 이슈에 첨부합니다. 개발자가 "재현 좀 해주세요" 할 일이 줄어듭니다.

### AI가 초안을 대신 써줍니다

Chrome Built-in AI(Gemini Nano)를 지원하는 환경에서는 AI가 캡처 맥락을 분석해 이슈 초안을 자동으로 작성합니다. 외부 API 키 없이 로컬에서 동작하며, 미지원 환경에서는 자동으로 숨겨집니다.

### 캡처한 그대로 이슈가 됩니다

이슈 제목, 본문, 기대 결과가 자동으로 채워집니다. 한 번 작성한 초안은 어떤 플랫폼이든 같은 형태로 들어가고, 둘 다 연결돼 있으면 제출 다이얼로그에서 탭으로 선택할 수 있습니다.

### 이슈 섹션을 원하는 대로 구성하세요

발생 현상, 재현 과정, 기대 결과, 비고 — 4가지 섹션을 앱 설정에서 켜고 끌 수 있습니다. 팀의 이슈 템플릿에 맞춰 필요한 섹션만 사용하세요.

### 지원 플랫폼

**Jira**
- OAuth 3LO와 API Token 모두 지원. 토큰 갱신은 자동.
- Atlassian 사이트 자동 발견, 프로젝트·이슈 타입·담당자·우선순위·Epic·연결 이슈 등 메타를 사이드 패널에서 바로 채울 수 있습니다.
- 스크린샷·영상·네트워크/콘솔 로그가 첨부 파일로 자동 업로드됩니다.
- 등록한 이슈의 진행 상태도 목록 탭에서 추적됩니다.

**GitHub**
- OAuth Web Flow와 Personal Access Token 모두 지원.
- 리포지토리·라벨·담당자(여러 명)을 사이드 패널에서 채울 수 있습니다.
- 본문에는 첨부 파일명만 안내로 들어갑니다. GitHub은 본문 인라인 첨부를 지원하지 않아, 사이드 패널에서 다운로드한 뒤 GitHub UI에 직접 드래그하여 붙이는 흐름입니다.
- 등록한 이슈의 Open / Closed / Not planned 상태도 목록 탭에서 추적됩니다.

### 트래커 없이도 쓸 수 있습니다

마크다운으로 복사하면 Notion, Slack, Confluence 어디든 붙여넣을 수 있습니다. 비교표도 테이블 그대로 유지됩니다.

### 한국어 / English

브라우저 언어에 따라 자동 설정됩니다. 앱 설정에서 직접 전환할 수도 있습니다.

<br>

## 설치

[Chrome 웹스토어에서 설치](https://chromewebstore.google.com/detail/bugshot-%E2%80%94-%EB%94%94%EC%9E%90%EC%9D%B8-%EC%9D%B4%EC%8A%88-%ED%8A%B8%EB%9E%98%EC%BB%A4/ohakhekagkodklkickemonmifdcbhmig)

### 직접 빌드해서 설치하기

```bash
pnpm install
pnpm build
```

1. Chrome에서 `chrome://extensions` 열기
2. 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** 클릭 → `dist` 폴더 선택

<br>

## 사용법

1. 아무 웹 페이지에서 **툴바의 BugShot 아이콘** 클릭 (또는 `Cmd+Shift+E` / `Ctrl+Shift+E`)
2. 사이드 패널이 열리면 캡처 모드를 선택:
   - **DOM 요소 선택** — 요소를 골라 스타일 수정
   - **화면 캡처** — 영역 선택 + 주석
   - **영상 녹화** — 탭 녹화
3. 이슈 제목·본문을 확인/수정하고 **연결된 트래커에 제출** 또는 **마크다운 복사**

플랫폼 연동(Jira / GitHub)은 사이드 패널의 **연동 설정** 탭에서 합니다.

<br>

## 개발

```bash
pnpm install
pnpm dev          # 개발 서버
pnpm build        # 프로덕션 빌드
pnpm build:store  # 웹스토어 업로드용 빌드
pnpm typecheck    # 타입 체크
pnpm test         # 테스트
pnpm test:watch   # 테스트 (watch)
```

| 스택 | |
|---|---|
| Chrome MV3 | Side Panel + Service Worker + Content Script |
| UI | React 18, TypeScript, Tailwind CSS, shadcn/ui |
| 상태 관리 | Zustand + chrome.storage |
| 빌드 | Vite + @crxjs/vite-plugin |
| 테스트 | Vitest |

<br>

## 개인정보처리방침

[개인정보처리방침](https://sinhyeokkang.github.io/bugshot-2/privacy)
