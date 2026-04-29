# CLAUDE.md

bugshot-2: Chrome MV3 Side Panel 확장. 웹 페이지의 DOM 요소를 골라 스타일을 수정·비교한 후 Jira 이슈로 등록한다.

사용자는 한국어로 간결한 답변을 선호한다. 불필요한 꾸밈말·서두 금지.

## 스택

- React 18 + TypeScript + Vite (via `@crxjs/vite-plugin`)
- Tailwind CSS v3 + shadcn/ui (style `new-york`, base color `slate`)
- Zustand + `chrome.storage` (session/local 혼용)
- 아이콘: lucide-react, 폰트: Pretendard
- MV3 service worker + content script + side panel

## 명령어

| 용도 | 명령 |
|---|---|
| 개발 서버 | `pnpm dev` |
| 빌드 | `pnpm build` |
| 스토어 업로드용 빌드 | `pnpm build:store` (manifest `key` 제거) |
| 타입 체크만 | `pnpm typecheck` |

**빌드는 자동 실행하지 않는다.** 사용자가 명시적으로 요청하거나 `/build` 스킬을 실행할 때만 돌린다. 타입 확인이 필요하면 `pnpm typecheck` 선호.

`build:store`는 `BUGSHOT_STORE_BUILD=1`을 세팅해 `manifest.config.ts`에서 dev용 `key`를 생략한다. 로컬 dev/로드 언팩 시에는 `key`가 있어야 OAuth redirect URI(`chrome-extension://<ID>/...`)가 고정되므로 **기본 `pnpm build` 유지**.

## 디렉터리 구조

```
src/
├── background/      # service worker
│   ├── index.ts         # 메시지 라우터 + 전역 sidePanel 비활성화
│   ├── tab-bindings.ts  # 탭별 side panel on/off (활성화 셋 기반)
│   ├── jira-api.ts      # Jira REST 래퍼 (Basic + Bearer, 401 시 refresh 재시도)
│   ├── oauth.ts         # Atlassian 3LO (launchWebAuthFlow + proxy 교환)
│   └── messages.ts      # 메시지 핸들러 디스패치
├── content/
│   ├── picker.ts          # DOM picker 메인 (메시지 라우터 + 모드 FSM + hover/select 이벤트)
│   ├── css-resolve.ts     # CSS 스타일 수집·토큰 resolve (resolveVarChain, collectSelection, collectTokens)
│   ├── css-source-cache.ts# raw CSS 텍스트 캐시 (CSSOM shorthand explode 우회, fetch + 경량 파서 + MutationObserver)
│   ├── dom-describe.ts    # DOM 트리 직렬화 (buildSelector, buildInitialTree, buildChildrenResponse)
│   ├── overlay.ts         # Shadow DOM 오버레이 (아웃라인·배너·블로커·프리뷰)
│   └── area-select.ts     # 영역 드래그 선택 (dimming + 사이즈 라벨)
├── sidepanel/
│   ├── App.tsx          # Radix Tabs 4개 (이슈 작성/목록/설정/앱 설정)
│   ├── main.tsx
│   ├── capture.ts       # 요소 크롭 스냅샷
│   ├── picker-control.ts
│   ├── hooks/           # useBoundTabId, useEditorSessionSync, useIssueImages, usePickerMessages, useThemeEffect
│   ├── components/      # 공통 UI (Section/PageShell/PageScroll/PageFooter/AnnotationOverlay 등)
│   ├── tabs/            # 탭별 진입점 + 편집 패널 (StyleEditorPanel/IssueTab/IssueListTab/SettingsTab 등)
│   │   └── styleEditor/ # ValueCombobox, StylePropEditors와 헬퍼 (propMetadata, tokenUtils, styleHooks, TokenChip)
│   └── lib/             # buildIssueMarkdown, buildIssueAdf 등 순수 유틸
├── store/               # Zustand 스토어 (editor/issues/settings/app-settings), blob-db(IndexedDB 이미지·비디오 저장), settings는 v2 마이그레이션(flat → discriminated auth)
├── i18n/                # 다국어 (ko/en 로케일, t()/useT() 훅)
├── lib/                 # 공용 유틸 (session-keys, adf-sentinels, url-support)
├── components/ui/       # shadcn 컴포넌트
├── styles/
└── types/
oauth-proxy/             # Cloudflare Worker — Atlassian /token 교환 (client_secret 서버 보관)
docs/
├── STORE_DEPLOY.md  # 웹스토어 배포 가이드
└── privacy.md       # 개인정보처리방침 (GitHub Pages)
```

## 아키텍처 원칙

### Side Panel은 탭 스코프

ui-inspector 참고. **활성화한 탭에서만 side panel이 보이고, 탭을 이동하면 자동으로 닫힌다.** 돌아오면 다시 열린다.

구현:
- `chrome.storage.session`의 `sidePanel:activated` 키에 활성화된 tabId 셋을 저장
- `chrome.action.onClicked`에서 해당 탭을 셋에 추가하고 `sidePanel.setOptions({tabId, enabled:true, path:...?tabId=X})` + `sidePanel.open({tabId})`
- `chrome.tabs.onActivated` / `onUpdated`에서 각 탭이 활성화 셋에 있으면 enable, 없으면 disable
- **manifest의 `side_panel.default_path`가 전역 fallback을 제공하므로** `onInstalled`/`onStartup`에서 `chrome.sidePanel.setOptions({ enabled: false })`로 전역 비활성화 필수

### user gesture 보존

`chrome.sidePanel.open()`은 **user gesture 안에서만** 동작한다. `chrome.action.onClicked` 리스너에서:

```ts
// ❌ 잘못된 예: await 때문에 user gesture 소실
chrome.action.onClicked.addListener(async (tab) => {
  await setActivated(tab.id, true);
  await chrome.sidePanel.setOptions(...);
  await chrome.sidePanel.open({ tabId: tab.id }); // silently fails
});

// ✅ 올바른 예: open을 동기적으로 호출
chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null || !isSupportedUrl(tab.url)) return;
  void chrome.sidePanel.setOptions({ tabId: tab.id, path, enabled: true });
  void chrome.sidePanel.open({ tabId: tab.id });
  void setActivated(tab.id, true); // fire-and-forget
});
```

### 편집 세션 영속화

- tabId별로 `chrome.storage.session`의 `editor:${tabId}` 키에 저장
- `useEditorSessionSync(tabId)` 훅이 hydration + debounced save(300ms) 담당 (zustand persist 미들웨어 대신 직접 구현 — tabId-scoped 키가 persist의 "one store, one key" 모델에 맞지 않음)
- origin 변경 시 해당 탭의 세션은 버림 (`clearIfOriginChanged` in `tab-bindings.ts`)
- 탭 닫히면 `onRemoved`에서 정리

### Jira 인증 (OAuth 3LO + API Token)

두 방식을 동시에 지원한다. 저장 형태는 discriminated union (`JiraAuth = JiraApiKeyAuth | JiraOAuthAuth`, `kind` 판별자).

- **API Token**: Basic Auth, `{workspace}.atlassian.net` 직접 호출
- **OAuth 3LO**: `chrome.identity.launchWebAuthFlow` → 인가 코드 → **oauth-proxy**(`/token`)에서 `client_secret`과 교환 → accessible-resources로 사이트 선택 → `api.atlassian.com/ex/jira/{cloudId}/...`로 Bearer 호출

**왜 proxy가 필요한가**: Atlassian `/oauth/token`은 confidential client(`client_secret` 요구)라 확장에 비밀키를 번들할 수 없다. `oauth-proxy/` (Cloudflare Worker)가 `code↔token`·`refresh↔token` 교환만 중계한다.

**토큰 갱신**: `jira-api.ts`가 요청 전 `expiresAt`을 확인해 프리-리프레시, 또는 401 수신 시 자동 `refreshOAuthToken` 후 원 요청 재시도. 새 토큰은 `persistOAuthTokens`가 storage envelope을 찾아 제자리 갱신. refresh token 자체가 무효화되면 `OAuthError` → `sendBg`의 `onOAuthExpired` 이벤트 → App.tsx AlertDialog로 재인증 안내 + Jira 연동 탭 이동.

**환경 변수** (빌드 타임):
- `VITE_ATLASSIAN_CLIENT_ID` — OAuth 앱 client_id
- `VITE_OAUTH_PROXY_URL` — Worker origin (예: `https://bugshot-oauth.<subdomain>.workers.dev`)

둘 다 비어있으면 설정 탭은 OAuth 버튼을 비활성화하고 API Token 전용 UI를 노출 (`isOAuthConfigured()` 가드).

**manifest 동적 host_permissions**: `manifest.config.ts`가 `VITE_OAUTH_PROXY_URL`의 origin을 자동으로 `host_permissions`에 추가한다. 빌드 시점에 결정되므로 런타임 권한 요청은 없음.

### 토큰 체인 resolve 룰

picker의 `resolveVarChain`은 `var()` 체인을 따라가며 어느 이름에서 멈출지 결정한다. 원칙: **디자인 토큰 이름은 보존, 컴포넌트 내부 alias는 펼침**.

- **공용(public) 토큰** (`--radius-xxl`, `--color-text-semantic`, `--spacing-14` 등): 처음 만나는 이름에서 멈춘다. 원시 > 시맨틱 구조에서 시맨틱이 원시를 참조해도(`--color-text-semantic: var(--color-gray-scale-900)`) 시맨틱 이름이 그대로 노출된다.
- **private alias** (`--_xxx` 언더스코어 prefix 컨벤션): 리터럴까지 끝까지 펼친다. 컴포넌트 내부 임시변수(`--_padding: var(--spacing-14)`, `--_size: 40px`)는 실제 참조 토큰/값으로 대체.

조합 예:
- `padding: var(--_padding)` + `--_padding: var(--spacing-14)` → 노출: `var(--spacing-14)`
- `color: var(--color-text-semantic)` + `--color-text-semantic: var(--color-gray-scale-900)` → 노출: `var(--color-text-semantic)`
- fallback `var(--x, var(--y))` — primary 정의 없으면 fallback의 이름으로 resolve 시도, 규칙은 동일.

### CSSOM shorthand 한계 우회 (Raw CSS Cache)

배경: **shorthand(var 포함) + 같은 shorthand의 longhand 부분 override** 조합에서 Chrome이 shorthand를 explode하면서 **원본 var() 값을 빈 문자열로 대체**한다. CSSOM만으로는 복구 불가.

예:
```css
.user-message {
  border-radius: var(--radius-xxl);
  border-bottom-right-radius: 4px;
}
```

CSSOM이 보여주는 것: `border-top-left-radius: ""` / `border-top-right-radius: ""` / `border-bottom-left-radius: ""` / `border-bottom-right-radius: "4px"`. `getPropertyValue("border-radius")` → `""`.

**대응**: `src/content/css-source-cache.ts`가 raw CSS 텍스트를 별도 확보해 룰별로 매핑.

수집 경로:
- `<style>` 블록: `ownerNode.textContent` (sync)
- `<link rel=stylesheet>`: `fetch(href)` — same-origin / CORS-safe만 성공, cross-origin은 silent fallback
- `adoptedStyleSheets`: 각 룰의 `cssText` 직렬화 (constructable sheet은 explode 없음)

라이프사이클: 픽커 활성화(`handleStart`) 시 `ensureLoaded()` 호출 + `MutationObserver`로 `<link>`/`<style>` 추가·제거·HMR 감지해 invalidate. 비활성화(`handleClear`) 시 cache drop.

매핑: parsed rule list와 `sheet.cssRules` flatten 결과를 **순서 + selectorText 검증**으로 1:1 매핑. mismatch 시 해당 sheet은 cache miss 처리 → 기존 CSSOM 경로로 fallback.

`collectSpecifiedFromRules`(css-resolve.ts)에서 매칭된 룰별로 `getRawDeclarationsFor(rule)` 우선 사용, null이면 CSSOM `decl.cssText` fallback. `extractVarPropsFromMap` 헬퍼가 raw map 입력을 받아 shorthand → longhand expansion 처리.

비동기 영향: `picker.collectTokens` 메시지 핸들러 + `emitSelected` / `scheduleSelectionUpdate` / `scheduleTokenBuild`가 응답 전 `await ensureCssCacheLoaded()`. content script 메시지 핸들러는 `return true` + IIFE 패턴으로 비동기 응답.

여전히 못 잡는 케이스: cross-origin stylesheet 중 CORS 헤더 없는 것 (대부분의 CDN). 이 경우 기존 한계 그대로 — computed literal 폴백.

### DOM 트리 Lazy Load

DOM 트리 Dialog(`IssueTab.tsx`의 `DomTree`)는 큰 페이지에서 전체 DOM을 한 번에 직렬화하면 프리즈된다. 그래서 두 단계로 동작:

1. **초기 트리 (`picker.describeInitial`)**: `body`부터 현재 선택된 요소까지의 **조상 경로**와 각 레벨의 **sibling**만 내려준다. `{ tree, ancestorPath[] }`.
2. **자식 온디맨드 (`picker.describeChildren`)**: 유저가 노드를 펼칠 때 `{ selector }`로 요청, 해당 노드의 자식만 추가 로드 → `injectChildren`으로 트리에 머지.

노드의 `childCount > 0 && children === undefined`면 "아직 안 불러온 상태"로 간주하고 토글 시 fetch. 한 번 로드한 자식은 캐시.

### 마크다운 복사 (Preview)

Jira는 마크다운 원본을 파싱하지 않고, 붙여넣기는 **ProseMirror가 HTML을 해석**한다. 그래서 `ClipboardItem`으로 `text/plain` + `text/html` **둘 다** 쓴다.

- `text/plain`: GFM 파이프 테이블 포함 MD (Slack/Gmail fallback)
- `text/html`: `<h1>/<h2>/<p>/<table>` — Jira·Notion·Confluence가 네이티브 테이블로 변환
- base64 이미지는 Jira가 sanitize하므로 클립보드 출력에서 **제외**

구현: `src/sidepanel/lib/buildIssueMarkdown.ts` — `buildIssueMarkdown()` + `buildIssueHtml()` 페어.

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
/pull   → dev 최신 받고 작업 맥락 브리핑
/build  → pnpm build + 테스트 체크리스트 (작업 중 검증)
/push   → dev push (main에서 호출 차단)
/merge  → dev에서 버전 bump 커밋 + dev → main squash PR 생성 + 자동 머지
/deploy → main 한정. tag push → 스토어 빌드 → zip → 심사 요청 안내
/sync   → dev를 origin/main으로 hard reset + force push (배포/머지 후)
```

각 단계 게이트는 `.claude/commands/` 스킬 정의에 명시.

### 문서 신선도

`/push`는 항상 README / CLAUDE.md 신선도 검사를 거친다. 아래 중 하나라도 해당하면 문서 갱신을 별도 커밋(`docs(CLAUDE): ...` / `docs(README): ...`)으로 묶어 함께 푸시:

- 새 디렉터리·파일 추가/삭제 (특히 `src/` 하위 구조 변화)
- `package.json` scripts 변경
- `manifest.config.ts` 변경 (권한·명령어·스킴)
- 새 하위 시스템·아키텍처 핵심 파일 큰 변경
- 새 컨벤션·게이트웨이 도입
- 기능 추가/삭제로 README의 사용법·기능 설명이 어긋남
- 워크플로우/스킬 라인업 변경

## 코드 컨벤션

- 스타일: `src/components/ui/` 이외에 주석 최소화. WHY가 비자명할 때만 한 줄.
- 경로: `@/` → `src/`
- **UI 컴포넌트**: 직접 스타일링 금지. shadcn/ui 컴포넌트를 우선 사용하고, 없으면 `npx shadcn@latest add <component>`로 설치해서 사용. 설치 후 `src/components/ui/`에 위치 확인 필수 (shadcn이 `@/` 루트에 생성할 수 있음)
- Tailwind: shadcn CSS 변수 사용, 커스텀 색상 남발 금지
- 버튼 사이즈: shadcn 기본 + `xl` 추가 (`h-11 px-10 text-base`, CTA용)
- 탭 컨텐츠: `data-[state=inactive]:hidden` 필수 (비활성 탭 동시 렌더 버그 방지)

## 게이트웨이 (알아두면 유용)

- 매니페스트 `minimum_chrome_version: "116"` — sidePanel API 요구사항
- 지원 URL: `http:`, `https:`, `file:` 스킴만. 추가로 `chromewebstore.google.com` 전체와 `chrome.google.com/webstore/*` 트리는 Chrome이 content script 주입을 차단해서 `src/lib/url-support.ts`의 `isSupportedUrl()`이 미지원으로 처리. 그 외 페이지에서는 side panel을 enable하지 않고, 사용 중 race로 unsupported로 진입하면 picker가 `onPickerUnavailable` 이벤트를 발화해 안내 다이얼로그 노출.
- 단축키: `Cmd+Shift+E` (mac) / `Ctrl+Shift+E` (default) — `_execute_action`
- permissions: `sidePanel`, `activeTab`, `scripting`, `storage`, `commands`, `contextMenus`, `identity`, `tabCapture`
- host_permissions: `*.atlassian.net` (Jira REST), `api.atlassian.com` (OAuth gateway), `auth.atlassian.com` (authorize), + `VITE_OAUTH_PROXY_URL` origin (빌드 타임 주입)
- OAuth 관련 env: `VITE_ATLASSIAN_CLIENT_ID`, `VITE_OAUTH_PROXY_URL` — 누락 시 OAuth UI 자동 비활성화
- `BUGSHOT_STORE_BUILD=1`: 스토어 업로드용 빌드 (manifest `key` 제거)

## 메모리 & 참고 문서

- `docs/privacy.md` — 개인정보처리방침 (GitHub Pages로 공개)
- 사용자 개인 메모리: `~/.claude/projects/-Users-sinhyeokkang-code-bugshot-2/memory/`에 있음 (머신 로컬, git에 안 올라감)
