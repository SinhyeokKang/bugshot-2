# BugShot-2 PRD v0.5

스펙 정의서. UX 플로우와 기능/통합/기술 제약만 나열.

> **v0.5 스코프**: 3가지 캡처 모드(DOM 요소 · 스크린샷 · 영상 녹화) → 이슈 작성 → Jira 제출 또는 마크다운 추출. CSS 토큰 매핑 + 스타일 편집(요소 모드). 스크린샷 주석(markerjs2). 영상 녹화(tabCapture, 최대 60초).

## 1. UX 플로우

### 1.1 초기 설정 (최초 1회)
1. Side Panel 열기 → Jira 미연결 시 **Jira 연동** 탭으로 자동 전환
2. 인증 방식 선택 (세그먼트 컨트롤): **OAuth** 또는 **API Token**
   - OAuth: **[Atlassian으로 로그인]** → 브라우저 인가 창 → 권한 승인 → 접근 가능한 사이트가 2개 이상이면 사이트 선택 UI 노출 → `GET /rest/api/3/myself`로 이메일 추출 후 저장
   - API Token: `baseUrl` / `email` / `API token` 입력 → **[검증]** 버튼 → `GET /rest/api/3/myself` 성공 시 저장
3. 저장 위치: `chrome.storage.local` (`bugshot-settings` envelope, `version: 2`)
4. **프로젝트 선택** (전역 1개). 프로젝트 목록은 저장 직후 로드

OAuth 환경변수 미설정 시(`VITE_ATLASSIAN_CLIENT_ID` / `VITE_OAUTH_PROXY_URL`) OAuth 탭은 안내 메시지로 대체되고 API Token만 사용 가능.

### 1.2 이슈 등록 (메인 플로우)

**캡처 모드 선택** — idle 상태에서 3가지 중 택 1:
- **DOM 요소 선택** (element)
- **화면 캡처** (screenshot)
- **영상 녹화** (video)

모드별 선형 플로우. 단계 간 **[← 뒤로]** 버튼으로 이전 단계 수정 가능.

#### 1.2.1 Element 모드

**[1] DOM 선택** (`picking`)
- [DOM 요소 선택] → Background가 picker content script를 현재 탭에 on-demand 주입
- 호버로 요소 하이라이트, 클릭으로 선택 (ESC로 취소)
- **뷰포트 배너**: picker 활성 시 상단에 현재 뷰포트 크기(`{width} × {height}`) 상시 표시, 리사이즈 실시간 반영
- **Interaction-blocker 오버레이**: 페이지 상호작용 전면 차단, disabled 요소도 hover/click 가능
- **DOM 트리 Dialog** (선택 후 제목 클릭): 조상 경로만 expand 상태로 초기 로드 (`picker.describeInitial`), 유저가 노드를 펼칠 때 자식을 온디맨드 fetch (`picker.describeChildren`)

**[2] Style 수정** (`styling`)
- Tailwind 클래스명 편집 + CSS property/value 편집 병행
- 타이핑 즉시 페이지에 반영 (To-Be 실시간 확인)
- As-Is는 `getComputedStyle` 스냅샷으로 자동 기록
- CSS 토큰 매핑 + 패밀리 그룹 + Quad 속성 링크 (상세: §4)

**[3] 이슈 작성** (`drafting`)
- 제목 / 본문 / 기대 결과 자동 초안 생성 → 사용자 편집
- 스타일 변경사항 테이블 (read-only)
- Before/After 스크린샷 자동 캡처

**[4] 프리뷰 + 제출** (`previewing`)
- 본문 read-only. [이슈 생성] 모달 또는 [마크다운 추출]

**[5] 완료** (`done`)
- 이슈 키 + 열기 링크 + [이슈 목록] / [확인] 버튼

#### 1.2.2 Screenshot 모드

**[1] 영역 캡처** (`capturing`)
- [화면 캡��] → content script에 영역 선택 오버레이 ��입
- 크로스헤어 커서 + 드래그로 영역 선택 (dimming + 사이즈 라벨)
- 선택 완료 → `captureVisibleTab`으로 크롭 스냅샷

**[2] 이슈 작성** (`drafting`)
- 캡처 이미지에 주석 가능 (markerjs2, side panel 내 AnnotationOverlay)
- 주석 제거(원복) 버튼 제공
- 제목 / 본문 / 기대 결과 편집

**[3] 프리뷰 + ���출** (`previewing`) → **[4] 완료** (`done`)

#### 1.2.3 Video 모드

**[1] 녹화** (`recording`)
- [영상 녹화] → `tabCapture.getMediaStreamId` + `MediaRecorder`
- 경과 시간 + 진행률 바 표시, 최대 60초 자동 종료
- 완료 시 WebM blob + JPEG 썸네일 자동 생성

**[2] 이슈 작성** (`drafting`)
- 비디오 플레이어 또는 썸네일 표시
- 제목 / 본문 / 기대 결과 편집

**[3] 프리뷰 + 제출** (`previewing`) → **[4] 완료** (`done`)

### 1.3 편집 세션 라이프사이클
- 탭별 `chrome.storage.session`의 `editor:${tabId}` 키에 영속화 (`useEditorSessionSync` 훅, debounce 300ms)
- Phase: `idle` → `picking`/`capturing`/`recording` → [`styling` →] `drafting` → `previewing` → `done`
- **세션 보존 규칙** (`shouldPreserveSession`):
  - video 모드: 모든 phase 보존
  - element/screenshot 모드: `drafting`, `previewing`, `done`만 보존
  - 그 외 phase(`idle`, `picking`, `styling`, `capturing`, `recording`): 페이지 변경 시 세션 클리어
- 같은 origin+pathname 내 이동: 보존 대상 세션 유지, picker/area-select UI만 정리
- 다른 origin 또는 pathname으로 navigation: `clearIfPageChanged`에서 비보존 세��� 클리어. element+styling 중이면 `sessionExpired` 플래그 → "페이지가 갱신되었습니다" AlertDialog
- 탭 닫힘: `onRemoved`에서 세션 정리
- 브라우저 재시작: `chrome.storage.session` 소멸

---

## 2. 기능 스펙

### 2.1 화면 (Side Panel)
상단 Radix Tabs 4개.

**탭 1: 이슈 작성**
- 캡처 모드 선택 (idle) → 모드별 단계 UI (§1.2)

**탭 2: 이슈 목록**
- 드래프트 + 제출 이슈 히스토리
- 날짜 그룹핑, 상태별 필터 (초안/제출됨)
- 제출 이슈: Jira 상태 뱃지 (new/indeterminate/done, 조회 실패 시 "알 수 없음")
- 드래프트 클릭 → DraftDetailDialog (재제출/삭제 가능)
- 모두 삭제 버튼

**탭 3: Jira 연동**
- **Jira 연결**: OAuth / API Token 세그먼트 컨트롤
  - OAuth: [Atlassian으로 로그인] → (다중 사이트 시) 사이트 선택 → 연결
  - API Token: baseUrl / email / apiToken / [검증]
- 연결 후 `JiraSummary`에 사이트 host + 인증 방식 배지 노출, [재설정]으로 해제
- **프로젝트**: 프로젝트 드롭다운 (전역 1개)
- **기본 이슈 타입**: 프로젝트 변경 시 이슈 타입 드롭다운 노출
- 담당자/우선순위는 이슈별 마지막 선택값으로만 관리 (설정 탭엔 노출 안 함)

**탭 4: 앱 설정**
- **테마**: light / dark / system
- **언어**: ko / en (설정 스토어 + UI 토글 구현 완료, 문자열 외재화는 미구현)

### 2.2 요소 선택 (picker)
- on-demand 주입 (`chrome.scripting.executeScript`, `activeTab` + `scripting`)
- **오버레이 렌더링**: Shadow DOM(`attachShadow({ mode: "open" })`) 내부에만. `:host { all: initial !important }`로 페이지 CSS 오염 방지
- 호버: 경계 오버레이 + 태그/클래스 툴팁
- ESC: 취소, 클릭: 선택 확정
- 선택 시 패널로 전달: `{ selector, tagName, classList, computedStyles, specifiedStyles, hasParent, hasChild, text, viewport, capturedAt }`
- Selector 생성: [`@medv/finder`](https://github.com/antonmedv/finder) (fallback: CSS path)
- **Interaction-blocker 오버레이**: 전면 투명 블로커로 페이지 클릭/스크롤 차단, disabled 요소도 hover/click 정상 처리
- **Parent/Child 내비게이션**: 선택 후 DOM 트리 상하 탐색
- **메시징**: 장수명 Port로 picker 세션 관리. 단발성 요청은 `sendMessage`
- 선택 확정 직후 picker cleanup (Shadow DOM 제거)

### 2.3 편집 세션 스키마
```ts
EditorState {
  captureMode: "element" | "screenshot" | "video"
  phase: "idle" | "picking" | "styling" | "capturing" | "recording"
       | "drafting" | "previewing" | "done"
  target: { tabId, url, title, frameUrl? } | null

  // Element 모드
  selection: { selector, tagName, classList, computedStyles, specifiedStyles,
               hasParent, hasChild, text, viewport, capturedAt } | null
  styleEdits: { classList, inlineStyle, text }
  tokens: Token[]
  beforeImage: string | null    // data URL
  afterImage: string | null

  // Screenshot 모드
  screenshotRaw: string | null
  screenshotAnnotated: string | null
  screenshotViewport: { width, height } | null
  screenshotCapturedAt: number | null

  // Video 모드
  videoBlob: Blob | null        // 비직렬화 — session storage 미포함
  videoThumbnail: string | null // 480px JPEG data URL
  videoViewport: { width, height } | null
  videoCapturedAt: number | null

  // 공통
  draft: { title, body, expectedResult } | null
  issueFields: { issueTypeId?, assigneeId?, assigneeName?, priorityId?,
                 priorityName?, parentKey?, parentLabel?, relatesKey?, relatesLabel? }
  currentIssueId: string | null
  submitResult: { key, url } | null
  sessionExpired: boolean
}
```
- 저장: Zustand + `chrome.storage.session` 탭별 영속화 (`editor:${tabId}`)
- `EditorSnapshot`에서 `videoBlob`과 `sessionExpired` 제외 (비직렬화/일시적 플래그)
- **이슈별 필드 마지막값**: `chrome.storage.local` (`lastSubmitFields`, 같은 projectKey일 때만 복원)

### 2.4 Jira 필드 섹션 (이슈 생성 모달)
- **이슈 ���입** (필수): `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes` (subtask 제외). 설정 탭 기본값 pre-filled
- **담당자** (선택): `GET /rest/api/3/user/search?query=` (워크스페이스 전체, search-as-you-type)
- **우선순위** (선택): `GET /rest/api/3/priority` 목록
- **부모 에픽** (선택): `GET /rest/api/3/search/jql` with `hierarchyLevel = 1`, search-as-you-type
- **연결 이슈** (선택): 동일 방식, 단일 선택, Issue Link type `Relates`로 생성 후 연결
- 각 Combobox: debounce 300ms, sequence 번호로 stale 응답 폐기

### 2.5 이슈 본문 템플릿

모든 모드 공통 4개 블록:

```markdown
<!-- bugshot-meta-for-ai { JSON } -->

# {제목}

## 재현 환경
- **Page**: {url}
- **DOM**: {selector}        ← element 모드만
- **Viewport**: {w}×{h}
- **Captured**: {timestamp}

## 발생 현상
{사용자 편집 가능한 본문}

## 스타일 변경사항 / 미디어    ← 모드별 분기
(element: As is/To be 테이블 + before/after 이미지)
(screenshot: 첨부 이미지 참조 → 제출 시 mediaSingle 치환)
(video: 첨부 영상 참조 → 제출 시 mediaSingle 치환)

## 기대 결과
{사용자 서술 영역}
```

**편집 UI (drafting 단계)**
- 제목 Input + 본문 Textarea + 기대 결과 Textarea
- Element: 스타일 변경사항 테이블 read-only 표시
- Screenshot: 주석 가능한 이미지 (AnnotationOverlay)
- Video: 비디오 플���이어 또는 썸네일

**AI 메타데이터 블록** (`<!-- bugshot-meta-for-ai -->`):
- 마크다운/HTML 최상단에 HTML 코멘트로 삽입
- 구조화 JSON: `version`, `url`, `selector`, `tagName`, `viewport`, `capturedAt`, `classListBefore/After`, `specifiedStyles`, `cssChanges`, `tokens`

### 2.6 마크다운 추출
- **출력**: `ClipboardItem`으로 `text/plain`(GFM) + `text/html`(`<h1>/<h2>/<p>/<table>`) 동시 복사
  - Jira/Notion/Confluence가 HTML의 네이티브 테이블로 변환, Slack/Gmail은 plain text fallback
- **이미지**: base64 이미지는 Jira가 sanitize하므로 클립보드 출력에서 **제외**
- **문법**: GFM 파이프 테이블 포함

### 2.7 이슈 목록 + 드래프트 관리
- 이슈 생성 시 `IssuesStore`에 `IssueRecord` 저장 (chrome.storage.local)
- 드래프트: previewing 진입 시 자동 저장 (타이틀, 본문, 스냅샷 등)
- 제출 후: Jira key/url + siteId 기록, Jira 상태 뱃지 fetch
- **DraftDetailDialog**: 드래프트 상세 보기 + Jira 재제출 + 삭제
- Video 드래프트: IndexedDB에서 blob 복원하여 플레이어 표시

---

## 3. Jira 통합 스펙

### 3.1 대상
- **Jira Cloud 전용** (v1). DC/Server는 미지원
- baseUrl: `https://{workspace}.atlassian.net`

### 3.2 인증

두 방식 지원. 저장은 discriminated union (`JiraAuth = { kind: "apiKey" | "oauth", ... }`).

**API Token**
- Basic Auth: `Authorization: Basic base64("{email}:{apiToken}")`
- 요청 호스트: `{baseUrl}` (예: `https://{workspace}.atlassian.net`)

**OAuth 3LO (권장)**
- 인가: `chrome.identity.launchWebAuthFlow` → `https://auth.atlassian.com/authorize`
  - scope: `read:jira-user read:jira-work write:jira-work offline_access`
  - `prompt=consent`, state 검증
  - redirect_uri: `chrome.identity.getRedirectURL()` (`https://<ext-id>.chromiumapp.org/`)
- 토큰 교환: `client_secret`이 필요하므로 **oauth-proxy** (Cloudflare Worker, `POST {PROXY_URL}/token`) 경유
  - `grant_type=authorization_code` / `refresh_token` 두 흐름 모두 중계
- 사이트 선택: `GET https://api.atlassian.com/oauth/token/accessible-resources` → site가 2개 이상이면 유저가 선택
- 이메일 보강: 선택된 사이트에 대해 `GET /rest/api/3/myself` 호출 후 envelope에 저장
- 요청 호스트: `https://api.atlassian.com/ex/jira/{cloudId}`, `Authorization: Bearer {accessToken}`
- 토큰 갱신: 요청 전 `expiresAt` 체크로 프리-리프레시 + 401 응답 시 `refresh_token`으로 재시도. 성공 시 storage envelope in-place 갱신 (`persistOAuthTokens`). refresh token 무효 시 `OAuthError` → 재인증 AlertDialog + Jira 연동 탭 이동

**공통**
- 저장: `chrome.storage.local` (`bugshot-settings`, sync ❌ — 기기 간 토큰 동기화 회피)
- 모든 API 호출은 background service worker에서 수행
- UI는 토큰 마스킹 + "교체" 패턴 (원문 재표시 없음)

**빌드 타임 환경변수 (OAuth)**
- `VITE_ATLASSIAN_CLIENT_ID` — Atlassian OAuth 앱 client_id
- `VITE_OAUTH_PROXY_URL` — Cloudflare Worker origin
- 둘 중 하나라도 없으면 OAuth 경로가 비활성화되고 안내 메시지 노출

### 3.3 엔드포인트

경로는 API Token 기준 표기. OAuth 사용 시 베이스는 `https://api.atlassian.com/ex/jira/{cloudId}` 로 치환된다.

| 용도 | 메서드 + 경로 |
|---|---|
| 자격증명 검증 | `GET /rest/api/3/myself` |
| 프로젝트 목록 | `GET /rest/api/3/project/search` |
| 이슈 타입 | `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes` |
| 담당자 검색 | `GET /rest/api/3/user/search?query=` (워크스페이스 전체) |
| 우선순위 | `GET /rest/api/3/priority` |
| Epic 검색 | `GET /rest/api/3/search/jql?jql=project='{key}' AND hierarchyLevel=0` |
| Issue Link 타입 목록 | `GET /rest/api/3/issueLinkType` (Relates 찾기 위함, 캐시) |
| 이슈 생성 | `POST /rest/api/3/issue` |
| 이슈 설명 업데이트 | `PUT /rest/api/3/issue/{idOrKey}` (첨부 업로드 후 미디어 노드 치환) |
| Issue Link 생성 | `POST /rest/api/3/issueLink` (이슈 생성 후) |
| 첨부 업로드 | `POST /rest/api/3/issue/{idOrKey}/attachments` (multipart, `X-Atlassian-Token: no-check`) |
| 이슈 상태 조회 | `GET /rest/api/3/issue/{idOrKey}?fields=status` (이슈 목록 뱃지용) |

**OAuth 전용**
| 용도 | 메서드 + 경로 |
|---|---|
| 인가 | `GET https://auth.atlassian.com/authorize` |
| 토큰 교환/갱신 | `POST {VITE_OAUTH_PROXY_URL}/token` (Worker 중계) |
| 사이트 목록 | `GET https://api.atlassian.com/oauth/token/accessible-resources` |

### 3.4 필드 매핑
- 필수: `project.key`, `issuetype.id`, `summary`, `description(ADF)`, `assignee.accountId`(선택), `priority.id`(선택)
- 옵셔널: `parent.key` (부모 에픽)
- 2단계: 이슈 생성 후 연결 이슈가 있으면 `POST /issueLink` 로 Relates 생성

### 3.5 제출 시퀀스
1. 마크다운 본문 → ADF 변환 (`buildIssueAdf`)
2. `POST /issue` with 필드 + ADF + summary
3. 성공 응답 이슈 키 획득
4. 첨부 업로드: `POST /issue/{key}/attachments`
   - Element: `before.png`, `after.png`
   - Screenshot: `screenshot.png`
   - Video: `recording.webm`
5. 첨부 업로드 성공 시 `PUT /issue/{key}` — ADF 내 placeholder를 `mediaSingle` 노드로 치환 (Media API / External 이미지 응답 형식 분기)
6. 연결 이슈 있으면: `POST /issueLink`
7. 성공 시 완료 화면 표시 + IssuesStore에 결과 기록

### 3.6 에러 처리
- `401/403`: OAuth는 자동 refresh 시도 → 실패 시 재인증 안내. API Token은 토큰 재입력 안내
- `429 / 5xx`: 지수 백오프 (3회, base 1s)
- 이슈 생성 성공 + 첨부 실패: 이슈 유지, UI에 부분 성공 + 첨부만 재시도 버튼
- 이슈 생성 성공 + 링크 실패: 이슈 유지, 부분 성공 + 링크만 재시도 버튼

---

## 4. 스타일 편집 스펙 (Element 모드)

### 4.1 입력 모드 (병행)
- **className 에디터**: `element.className` 원문을 텍스트 에디터에 노출, Tailwind 클래스 추가/삭제/수정. 변경 즉시 `element.className = newValue`로 반영
  - 입력한 클래스가 페이지 CSS에 없으면 시각 반영 안 됨 → ⚠ 안내
- **CSS 에디터**: property/value 페어. 인라인 `element.style`에 주입

### 4.2 To-Be 즉시 반영
- className 변경: `element.className = value`
- CSS 변경: `element.style.setProperty(prop, value, important ? 'important' : '')`

### 4.3 As-Is 캡처
- 선택 즉시 `getComputedStyle` 스냅샷 + `specifiedStyles` (authored CSS 값, var() 포함) 저장
- `className`은 `element.className` 원문 저장

### 4.4 CSS 토큰 매핑
- 페이지의 CSS 커스텀 프로퍼티(`var(--xxx)`)를 수집, 값 편집 시 토큰 combobox로 제안
- `hsl(var(--xxx))` 등 래핑된 var()도 인식
- 상속 속성(color, font-size, font-weight, line-height, text-align, letter-spacing) 부모 체인 탐색
- shorthand(padding, margin, gap, border-radius, overflow) → longhand 자동 분해
- 토큰 정렬: `localeCompare({ numeric: true })`로 자연 정렬
- **var() 체인 resolve**: 공용 토큰(`--spacing-*`, `--color-*` 등)은 이름 보존, private alias(`--_xxx`)는 리터럴까지 펼침
- **adoptedStyleSheets** 포함 병합

### 4.5 토큰 검색 UX
- 패밀리 그룹: 같은 prefix 토큰을 상단 그룹으로 묶어 표시 (동적 prefix 탐색, 최소 2개 이상 sibling)
- `--`로 시작하는 ��색어도 정상 검색 가능
- **Quad 속성 링크**: padding, margin, border-radius의 4개 서브 속성을 체인 아이콘으로 연동/해제

### 4.6 변경 취소
- 제출 전: **[초기화]** → className 원복 + inline style 원복
- ���출 후: 페이지 새로고침 시 자연 원복 (BugShot이 cleanup 보장 ❌)

---

## 5. 기술 제약

### 5.1 Manifest v3 / 권한
- `permissions`: `sidePanel`, `activeTab`, `scripting`, `storage`, `commands`, `contextMenus`, `identity` (OAuth용)
- `host_permissions`:
  - `https://*.atlassian.net/*` (API Token 직접 호출)
  - `https://api.atlassian.com/*` (OAuth gateway + accessible-resources)
  - `https://auth.atlassian.com/*` (authorize)
  - `{VITE_OAUTH_PROXY_URL origin}/*` (빌드 타임에 `manifest.config.ts`가 동적 추가)
- 클립보드 쓰기: Side Panel 내 사용자 클릭 컨텍스트에서 `navigator.clipboard.write()` 사용
- 상시 `content_scripts` 없음 — picker만 on-demand 주입
- **manifest `key`**: dev/언팩 빌드는 고정 `key`로 확장 ID 고정 (OAuth redirect URI 안정화용). 스토어 업로드 시 `BUGSHOT_STORE_BUILD=1` → `key` 제거

### 5.2 Chrome 최소 버전
- **116+** (Side Panel API 안정)

### 5.3 활성화 방법
- **액션 아이콘 클릭**: 툴바 아이콘
- **단축키**: `Alt+Shift+B` (`_execute_action`)
- **컨텍스트 메뉴**: 페이지 우클릭 → "BugShot"

### 5.4 i18n
- `default_locale: ko`
- `_locales/ko/messages.json` (manifest 레벨)
- 앱 설정에 ko/en 토글 존재. UI 내부 문자열 외재화는 미구현 (하드코딩 한국어)

### 5.5 스크린샷
- **Element 모드**: `chrome.tabs.captureVisibleTab` → 선택 요소 rect 기준 크롭 (before/after)
- **Screenshot 모드**: content script 영역 선택 오버레이 → 드래그 rect 확정 → `captureVisibleTab` → 크롭
- **주석**: markerjs2 (side panel 내 AnnotationOverlay). 주석 결과는 `screenshotAnnotated`에 저장, 원본은 `screenshotRaw` 보존
- 전체 페이지 스크롤 스티칭은 out-of-scope

### 5.6 영상 녹화
- `chrome.tabCapture.getMediaStreamId` → `navigator.mediaDevices.getUserMedia` → `MediaRecorder`
- 포맷: WebM (VP9/VP8 코덱, 1.5Mbps)
- 최대 60초 (`MAX_DURATION_SEC`), 자동 종료
- 썸네일: 480px JPEG quality 0.7
- `videoBlob`은 Blob이므로 `chrome.storage.session` 직렬화 불가 → IndexedDB 영속화 (`bugshot-video` DB)
- Jira WebM 인라인 재생 미지원 인지 — 첨부 파일로만 제공

### 5.7 Side Panel 동작
- 액션 아이콘 클릭, `Alt+Shift+B`, 또는 컨텍스트 메뉴 → 현재 탭에 Side Panel 오픈
- **탭 스코프**: 활성화한 탭에서만 side panel 표시, 탭 이동 시 자동 닫힘, 돌아오면 재오픈
  - `chrome.storage.session`의 `sidePanel:activated` 키에 활성화 tabId 셋 관리
  - manifest 전역 fallback → `onInstalled`/`onStartup`에서 전역 비활성화
  - **user gesture 보존**: `sidePanel.open()`을 리스너에서 동기적 호출 (await 금지)
- **탭 바인딩**: `chrome.tabs.onActivated` / `onUpdated`에서 활성화 셋 기반 enable/disable

### 5.8 지원 URL 스킴
- 지원: `http://`, `https://`, `file://`
- 미지원: `chrome://`, `chrome-extension://`, `about:`, Chrome 내장 PDF 뷰어, 웹스토어 페이지 등
- 미지원 URL에서는 `sidePanel.setOptions({ tabId, enabled: false })`. 이미 열린 상태에서 이동 시 "이 페이지에서는 사용할 수 없습니다" 폴백 화면

### 5.9 스토리지 레이어
| 데이터 | 위치 | 수명 |
|---|---|---|
| Jira 설정 (`auth` discriminated union) | `chrome.storage.local` (`bugshot-settings`, v2) | 영구 |
| 전역 프로젝트 (projectKey) | `chrome.storage.local` | 영구 |
| 이슈 필드 마지막값 | `chrome.storage.local` (`lastSubmitFields`) | 영구 |
| 이슈 목록 (드래프트+제출) | `chrome.storage.local` (`bugshot-issues`) | 영구 |
| 앱 설정 (테마/언어) | `chrome.storage.local` (`bugshot-app-settings`) | 영구 |
| 편집 세션 (EditorSnapshot) | `chrome.storage.session` (`editor:${tabId}`) | 탭 수명 |
| 활성화 탭 셋 | `chrome.storage.session` (`sidePanel:activated`) | 브라우저 세션 |
| 비디오 blob | IndexedDB (`bugshot-video`, store: `blobs`) | 영구 (드래프트 삭제 시 정리) |

**settings 마이그레이션 v2**: 초기 스키마는 flat (`{ baseUrl, email, apiToken }`). v2는 `auth: { kind, ... }`로 래핑된 discriminated union이며 OAuth 필드 포함. hydration 시 legacy shape은 자동 변환.

---

## 6. Out-of-scope (v1 미포함, 추후 검토 가능)
- **배치(cart) 작성** — 여러 요소를 한 이슈에 묶음 (v2 우선 후보)
- 액션 아이콘 뱃지 표시
- DC/Server 지원, 다중 Jira 인스턴스
- 전체 페이지 스크롤 캡처
- GitHub / Linear / Notion 등 다른 트래커 연동
- 이슈 업데이트/댓글 기능 (v1은 신규 생성만)
- 팀 단위 설정 공유 (sync 스토리지)
- Jira 필드 확장: `components`, `fixVersions`, `sprint`, `reporter`, labels, 커스텀 필드
- Tailwind Play CDN 주입으로 JIT 런타임 지원
- 마크다운 추출 시 이미지 별도 파일 + .zip
- WebM → MP4 트랜스코딩 (Jira 인라인 재생 지원용)
