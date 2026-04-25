# BugShot

디자인 QA를 위한 Chrome 확장 프로그램. 웹 페이지에서 문제를 발견하면, 그 자리에서 바로 Jira 이슈로 만들 수 있습니다.

<br>

## 이런 걸 할 수 있어요

### DOM 요소 선택 + 스타일 편집

페이지 위에서 요소를 골라 CSS를 바로 고쳐보세요. 수정 전/후를 자동으로 비교해서 변경사항 테이블을 만들어줍니다. 디자인 토큰(`var(--spacing-14)` 등)도 자동으로 인식합니다.

### 스크린샷 캡처 + 주석

원하는 영역을 드래그로 선택하고, 화살표·텍스트·형광펜으로 주석을 달 수 있습니다.

### 영상 녹화

현재 탭을 최대 60초까지 녹화합니다. 재현이 어려운 버그를 공유할 때 유용합니다.

### Jira 이슈 생성

캡처한 내용이 이슈 본문에 자동으로 들어갑니다. 스크린샷과 영상도 첨부 파일로 함께 올라갑니다.
Jira를 안 쓰더라도 마크다운으로 복사해서 Notion, Slack, Confluence 등에 붙여넣을 수 있습니다.

### 한국어 / English

앱 설정에서 언어를 전환할 수 있습니다.

<br>

## 설치

> Chrome 웹스토어 링크 (준비 중)

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

1. 아무 웹 페이지에서 **툴바의 BugShot 아이콘** 클릭 (또는 `Alt+Shift+B`)
2. 사이드 패널이 열리면 캡처 모드를 선택:
   - **DOM 요소 선택** — 요소를 골라 스타일 수정
   - **화면 캡처** — 영역 선택 + 주석
   - **영상 녹화** — 탭 녹화
3. 이슈 제목·본문을 확인/수정하고 **Jira에 제출** 또는 **마크다운 복사**

Jira 연동은 사이드 패널의 **Jira 연동** 탭에서 설정합니다. OAuth 로그인 또는 API Token 입력 중 선택할 수 있습니다.

<br>

## 개발

```bash
pnpm install
pnpm dev          # 개발 서버
pnpm build        # 프로덕션 빌드
pnpm build:store  # 웹스토어 업로드용 빌드
pnpm typecheck    # 타입 체크
```

| 스택 | |
|---|---|
| Chrome MV3 | Side Panel + Service Worker + Content Script |
| UI | React 18, TypeScript, Tailwind CSS, shadcn/ui |
| 상태 관리 | Zustand + chrome.storage |
| 빌드 | Vite + @crxjs/vite-plugin |
