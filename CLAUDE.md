# CLAUDE.md

bugshot-2: Chrome MV3 Side Panel 확장. 웹 페이지의 DOM 요소를 골라 스타일을 수정·비교한 후 Jira·GitHub·Linear·Notion 이슈로 등록한다.

사용자는 한국어로 간결한 답변을 선호한다. 불필요한 꾸밈말·서두 금지.

## 작업 원칙

- **가정을 명시**: 해석이 여러 개면 조용히 하나 고르지 말고 선택지를 제시. 불확실하면 물어라.
- **더 단순한 방법이 있으면 제안**: 200줄을 50줄로 줄일 수 있으면 줄여라. 요청하지 않은 유연성·설정 가능성·추상화 추가 금지.
- **외과적 변경**: 요청과 직접 관련 없는 인접 코드 개선·리팩터 금지. 기존 스타일 따르기. 기존 dead code는 언급만 하고 삭제하지 않는다 — 내 변경이 만든 고아만 제거.
- **검증 가능한 목표로 전환**: "버그 고쳐" → "재현 테스트 작성 후 통과시켜". 멀티스텝 작업은 단계별 검증 체크를 포함한 플랜을 먼저 제시.
- **테스트 우선**: 신규 인터페이스(함수·헬퍼·어댑터) 추가 시 테스트를 먼저 작성하고 구현한다. 기존 로직 변경 시에도 관련 순수 함수의 단위 테스트를 작성/갱신하고 `pnpm test` 통과를 확인한 뒤 작업을 마친다. 테스트 없이 코드만 변경하지 않는다.

## 스택

- React 18 + TypeScript + Vite (via `@crxjs/vite-plugin`)
- Tailwind CSS v3 + shadcn/ui (style `new-york`, base color `slate`)
- Zustand + `chrome.storage` (session/local 혼용)
- Tiptap (ProseMirror) WYSIWYG 에디터 + `tiptap-markdown` 양방향 변환 + `markdown-it` (HTML/ADF/Notion 변환용 파서)
- 아이콘: lucide-react (UI 일반), `@icons-pack/react-simple-icons` (브랜드 — Jira/GitHub 등 플랫폼 마크는 `Si{Name}` import, `color="default"` + GitHub만 `dark:invert`), 폰트: Pretendard
- MV3 service worker + content script + side panel

## 명령어

| 용도 | 명령 |
|---|---|
| 개발 서버 | `pnpm dev` |
| 빌드 | `pnpm build` |
| 스토어 업로드용 빌드 | `pnpm build:store` (manifest `key` 제거) |
| 타입 체크만 | `pnpm typecheck` |
| 테스트 | `pnpm test` |
| 테스트 (watch) | `pnpm test:watch` |

**빌드는 자동 실행하지 않는다.** 사용자가 명시적으로 요청하거나 `/build` 스킬을 실행할 때만 돌린다. 타입 확인이 필요하면 `pnpm typecheck` 선호.

`build:store`는 `BUGSHOT_STORE_BUILD=1`을 세팅해 `manifest.config.ts`에서 dev용 `key`를 생략한다. 로컬 dev/로드 언팩 시에는 `key`가 있어야 OAuth redirect URI(`chrome-extension://<ID>/...`)가 고정되므로 **기본 `pnpm build` 유지**.

## 디렉터리 구조

파일별 역할은 **[DIRECTORY.md](./DIRECTORY.md)** 참조.

## 아키텍처 원칙

설계 상세(Side Panel 탭 스코프, user gesture, 세션 영속화, 4개 플랫폼 인증, 어댑터 패턴, 토큰 체인 resolve, CSSOM 캐시, DOM lazy load, 마크다운 복사, 이슈 섹션 구성, 마이그레이션)는 **[ARCHITECTURE.md](./ARCHITECTURE.md)** 참조.

## 릴리스 & 버전

### 버전 체계

semver(`MAJOR.MINOR.PATCH`). `package.json`의 `version`이 manifest에 자동 반영된다. Chrome 웹스토어는 업로드마다 버전이 올라가야 하므로 **`/merge` 단계에서 dev에 bump 커밋을 얹어 PR에 포함**시키고, squash로 main에 들어간 뒤 `/deploy`가 그 버전을 가리키는 tag만 별도 push한다.

```bash
pnpm version patch --no-git-tag-version   # 1.0.0 → 1.0.1 (버그 수정)
pnpm version minor --no-git-tag-version   # 1.0.0 → 1.1.0 (기능 추가)
pnpm version major --no-git-tag-version   # 1.0.0 → 2.0.0 (Breaking change)
```

`--no-git-tag-version`이 핵심. 자동 commit/tag를 막고 직접 commit 메시지를 통제하며, tag는 **dev HEAD가 아닌 main의 squash 커밋을 가리켜야 의미가 있으므로** `/deploy`에서 찍는다.

### 브랜치 정책

- 작업 브랜치: **`dev`** — 자유롭게 push (force push 허용).
- 메인 브랜치: **`main`** — 브랜치 프로텍션 적용. 직접 push 금지, PR squash 머지만 허용(linear history 강제). approval 0이라 1인 셀프 머지 OK. 버전 commit은 PR을 통해 들어오고 tag push는 ref 종류가 달라 보호 규칙과 무관하므로, **보호 우회가 필요한 시점이 없다**.

### 워크플로우 (스킬 라인업)

```
/feature        → 기능 아이디어 → PRD·기술 설계·태스크 문서 산출 (코딩 안 함)
/feature-review → feature 산출물을 CPO·CDO·CTO·QA Lead 4명이 병렬 검수 → 피드백 수렴 → 문서 수정
/tdd            → 테스트만 작성 (구현·픽스·커밋 안 함). interface 모드(신규 헬퍼 시그니처) / regression 모드(리뷰 발견 회귀 테스트)
/pull           → dev 최신 받고 작업 맥락 브리핑
/build          → pnpm build + 테스트 체크리스트 (작업 중 검증)
/code-review    → origin/main 대비 변경 코드 시급도별 리포트 (리포트 전용, fix·빌드·커밋 안 함)
/audit          → 코드베이스 전체 컨벤션·패턴 감사 (리포트 전용, fix·빌드·커밋 안 함)
/push           → dev push (main에서 호출 차단)
/merge          → dev에서 버전 bump 커밋 + dev → main squash PR 생성 + 자동 머지
/deploy         → main 한정. tag push → 스토어 빌드 → zip → GitHub Release draft → 심사 요청 안내
/sync           → dev를 origin/main으로 hard reset + force push (배포/머지 후)
```

권장 흐름: `/feature` → `/feature-review` → `/tdd interface` → 구현 → `/code-review` → `/tdd regression` → 픽스/리팩터 → `/push`. `/tdd` 분류표(스킬 정의 안)에 따라 컴포넌트·OAuth·DOM 측정 같은 영역은 스킵 OK.

각 단계 게이트는 `.claude/commands/` 스킬 정의에 명시.

### 문서 신선도

`/push`는 항상 CLAUDE.md / DIRECTORY.md / ARCHITECTURE.md / README.md / docs/privacy.md 신선도 검사를 거친다. 아래 중 하나라도 해당하면 문서 갱신을 별도 커밋(`docs(CLAUDE): ...` / `docs(DIRECTORY): ...` / `docs(ARCHITECTURE): ...` / `docs(README): ...` / `docs(privacy): ...`)으로 묶어 함께 푸시:

- 새 디렉터리·파일 추가/삭제 (특히 `src/` 하위 구조 변화)
- `package.json` scripts 변경
- `manifest.config.ts` 변경 (권한·명령어·스킴)
- 새 하위 시스템·아키텍처 핵심 파일 큰 변경
- 새 컨벤션·게이트웨이 도입
- 기능 추가/삭제로 README의 사용법·기능 설명이 어긋남
- 워크플로우/스킬 라인업 변경
- `manifest.config.ts`의 permissions·host_permissions·optional_host_permissions 변경, 또는 새 플랫폼/연동·데이터 수집·외부 API 엔드포인트 추가

## 코드 컨벤션

- 스타일: `src/components/ui/` 이외에 주석 최소화. WHY가 비자명할 때만 한 줄.
- 경로: `@/` → `src/`
- **UI 컴포넌트**: 직접 스타일링 금지. shadcn/ui 컴포넌트를 우선 사용하고, 없으면 `npx shadcn@latest add <component>`로 설치해서 사용. 설치 후 `src/components/ui/`에 위치 확인 필수 (shadcn이 `@/` 루트에 생성할 수 있음)
- Tailwind: shadcn CSS 변수 사용, 커스텀 색상 남발 금지
- 버튼 사이즈: CTA는 `default`(h-9) 통일. `xl`(`h-11 px-10 text-base`)은 랜딩/온보딩 등 특수 CTA 전용
- 커밋 메시지·PR title/body·GitHub Release notes는 **영문**으로 작성
- IconButton 사이즈: 패널/섹션 헤더·액션은 `h-8 w-8` (32px), Input·Textarea 우측에 직접 붙는 경우(LinkToggle, OrderedListEditor 행 삭제 등)만 `h-9 w-9` (36px, 필드 높이와 맞춤). 일관성 위해 새로 추가 시 동일하게.
- 탭 컨텐츠: `data-[state=inactive]:hidden` 필수 (비활성 탭 동시 렌더 버그 방지)
- **테스트**: 코드 변경 시 관련 순수 함수의 단위 테스트 작성 + `pnpm test` 통과 확인 필수. 테스트 파일은 대상과 같은 디렉터리의 `__tests__/*.test.ts`에 위치. Vitest 사용.

## 게이트웨이 (알아두면 유용)

- 매니페스트 `minimum_chrome_version: "116"` — sidePanel API 요구사항
- 지원 URL: `http:`, `https:`, `file:` 스킴만. 추가로 `chromewebstore.google.com` 전체와 `chrome.google.com/webstore/*` 트리는 Chrome이 content script 주입을 차단해서 `src/lib/url-support.ts`의 `isSupportedUrl()`이 미지원으로 처리. 그 외 페이지에서는 side panel을 enable하지 않고, 사용 중 race로 unsupported로 진입하면 picker가 `onPickerUnavailable` 이벤트를 발화해 안내 다이얼로그 노출.
- iframe 제약: content script가 `all_frames=false`라 iframe 내부 DOM은 picker로 선택 불가. iframe 박스 자체를 클릭하면 `picker.iframeUnsupported` → `onPickerIframeUnsupported` 이벤트로 안내 다이얼로그 노출 + picker 즉시 idle 복귀 (cross-document 경계 + 빈 결과로 인한 콘솔 에러 누적 방지).
- 단축키: `_execute_action`(`Cmd/Ctrl+Shift+E`, 사이드패널 토글) + 캡처 커맨드 3개(`capture-element`=`Shift+S` / `capture-screenshot`=`Shift+F` / `capture-video`=`Shift+X`). 총 4개 = Chrome `suggested_key` 상한. 캡처 단축키는 디버그>이슈작성 진입 화면에서만 발화. `suggested_key`는 best-effort라 OS·타 확장과 충돌 시 미배정될 수 있음 (그 경우 자연 no-op + 호버 툴팁 미표시)
- permissions: `sidePanel`, `activeTab`, `scripting`, `storage`, `commands`, `contextMenus`, `identity`, `tabCapture`
- host_permissions: `*.atlassian.net` (Jira REST), `api.atlassian.com` (OAuth gateway), `auth.atlassian.com` (authorize), `api.github.com` (GitHub REST), `github.com` (파일 업로드 page injection), `uploads.github.com` (파일 업로드 S3), `api.linear.app` (Linear GraphQL + OAuth token), `api.notion.com` (Notion REST + OAuth token), + `VITE_OAUTH_PROXY_URL` origin (빌드 타임 주입)
- optional_host_permissions: `https://*/*`, `http://*/*` — BYOK LLM 프로바이더 연결 시 `chrome.permissions.request()`로 런타임 획득
- OAuth 관련 env: `VITE_ATLASSIAN_CLIENT_ID`, `VITE_GITHUB_CLIENT_ID` (dev), `VITE_GITHUB_CLIENT_ID_PROD` (store build 시 치환), `VITE_LINEAR_CLIENT_ID` (dev), `VITE_LINEAR_CLIENT_ID_PROD` (store build 시 치환), `VITE_NOTION_CLIENT_ID`, `VITE_OAUTH_PROXY_URL` — 누락 시 해당 플랫폼 OAuth UI 자동 비활성화 (`isOAuthConfigured()` / `isGithubOAuthConfigured()` / `isLinearOAuthConfigured()` / `isNotionOAuthConfigured()`)
- `BUGSHOT_STORE_BUILD=1`: 스토어 업로드용 빌드 (manifest `key` 제거)
- `chrome.scripting.executeScript({world:"MAIN", func})`: 직렬화·재평가라 클로저가 안 살아남는다. 주입 함수는 self-contained(헬퍼는 nested로 inline). 현재 사용처 `github-upload.ts:pageBatchUploadFn` — 리팩터 시 실제 탭 회귀 필수. 상세: ARCHITECTURE.md 동명 섹션.

## 메모리 & 참고 문서

- `docs/privacy.md` — 개인정보처리방침 (GitHub Pages로 공개)
- 사용자 개인 메모리: `~/.claude/projects/-Users-sinhyeokkang-code-bugshot-2/memory/`에 있음 (머신 로컬, git에 안 올라감)
