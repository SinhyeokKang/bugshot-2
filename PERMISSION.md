# PERMISSION.md

BugShot이 사용자로부터 취득하는 Chrome 권한, 각 권한을 사용하는 기능, 만료·거부 시 동작, 재취득 흐름을 정리한다.

> 선언 위치: `manifest.config.ts`

---

## 목차

1. [권한 전체 목록](#1-권한-전체-목록)
2. [activeTab](#2-activetab)
3. [scripting](#3-scripting)
4. [tabCapture](#4-tabcapture)
5. [sidePanel](#5-sidepanel)
6. [storage](#6-storage)
7. [identity](#7-identity)
8. [commands](#8-commands)
9. [contextMenus](#9-contextmenus)
10. [webNavigation](#10-webnavigation)
11. [host_permissions (고정)](#11-host_permissions-고정)
12. [optional_host_permissions (런타임 요청)](#12-optional_host_permissions-런타임-요청)
13. [권한 라이프사이클 다이어그램](#13-권한-라이프사이클-다이어그램)

---

## 1. 권한 전체 목록

### permissions (설치 시 부여)

| 권한 | 목적 |
|---|---|
| `sidePanel` | 사이드 패널 등록·열기·닫기 |
| `activeTab` | 현재 탭 캡처·URL 읽기·스크립트 주입 (user gesture 필요) |
| `scripting` | content script 프로그래매틱 주입 |
| `storage` | `chrome.storage.session` / `chrome.storage.local` 사용 |
| `commands` | 키보드 단축키 1개 등록 (`_execute_action` 사이드 패널 토글) |
| `contextMenus` | 우클릭 컨텍스트 메뉴 등록 |
| `identity` | `chrome.identity.launchWebAuthFlow()` OAuth 팝업 |
| `tabCapture` | 탭 미디어 스트림 획득 (수동 영상 녹화) |
| `webNavigation` | 네비게이션 이벤트 감지 (로그 꼬리 보존 + 커밋된 iframe에 로그 sentinel 재발행) |

### host_permissions (설치 시 부여 — 고정 호스트)

```
https://*.atlassian.net/*          — Jira REST API
https://api.atlassian.com/*        — Jira Cloud OAuth gateway
https://auth.atlassian.com/*       — Jira OAuth authorize endpoint
https://api.github.com/*           — GitHub REST API
https://github.com/*               — GitHub 파일 업로드 (page injection)
https://uploads.github.com/*       — GitHub 파일 업로드 S3
https://api.linear.app/*           — Linear GraphQL API + OAuth token
https://api.notion.com/*           — Notion REST API + OAuth token
https://gitlab.com/*               — GitLab REST API + OAuth token (gitlab.com 한정)
https://app.asana.com/*            — Asana REST API + OAuth authorize (token 교환은 confidential이라 proxy 경유)
${VITE_OAUTH_PROXY_URL origin}/*   — OAuth proxy (빌드 타임 주입)
```

### optional_host_permissions (런타임 요청)

```
<all_urls>
```

`<all_urls>`인 이유: `captureVisibleTab`은 일반 host 패턴(`https://*/*`)을 캡처 권한으로 인정하지 않고 `<all_urls>` 또는 activeTab만 받는다. 30s Replay가 cross-origin 이동 후에도 캡처하려면 `<all_urls>`가 필요하다(`https://*/*`이면 activeTab 만료 시 캡처가 "Permission expired"로 실패).

BYOK LLM 프로바이더 연결 + GitLab **self-managed 인스턴스**(gitlab.com 외 임의 호스트) 연결 시 `chrome.permissions.request()`로 런타임 획득. 이 둘은 특정 origin(`{protocol}//{host}/*`)만 요청하며, `<all_urls>`가 optional에 선언돼 있으므로 그 하위 origin 요청도 허용된다. GitLab PAT 검증·업로드·이슈 생성은 이 권한 획득 이후 background fetch.

사용처: 30s Replay 활성화, BYOK LLM 프로바이더 연결.

---

## 2. activeTab

**가장 핵심적인 권한.** 사용자의 명시적 제스처(아이콘 클릭·단축키·컨텍스트 메뉴)로 부여되며, 탭 네비게이션 시 만료된다.

### 부여 시점

| 트리거 | 코드 위치 |
|---|---|
| 툴바 아이콘 클릭 | `tab-bindings.ts:265` — `chrome.action.onClicked → activateTab()` |
| `Cmd+Shift+E` 단축키 | `_execute_action` → 아이콘 클릭과 동일하게 `action.onClicked` 발화 |
| 컨텍스트 메뉴 "BugShot" 클릭 | `background/index.ts:77` — `contextMenus.onClicked → activateTab()` |

### 의존 API

| API | 용도 | 사용 위치 |
|---|---|---|
| `chrome.tabs.captureVisibleTab()` | 요소·영역·30s Replay 스크린샷 | `background/messages.ts:156` (bg handler) |
| `chrome.tabCapture.getMediaStreamId()` | 수동 영상 녹화 스트림 | `video-recorder.ts:25` |
| `chrome.tabs.get() → tab.url` | 탭 URL 읽기 | `tab-bindings.ts:160`, `picker-control.ts:113,238,267,365`, `video-capture.ts:13`, `video-recorder.ts:81`, `use-30s-replay.ts:65,145` |
| `chrome.scripting.executeScript()` | content script 재주입·뷰포트 측정 | `picker-control.ts:39,69,86,612` |

### 만료 조건

- 탭이 **다른 origin**으로 네비게이션
- 탭이 **같은 origin 다른 페이지**로 네비게이션 (경우에 따라)
- 확장이 포커스를 잃는 경우 (Chrome 버전에 따라)

### 만료 감지 (3중 방어)

#### 1단계: URL 읽기 실패 (진입 가드)

`tab.url`이 `undefined`/빈 문자열 → activeTab grant 만료 신호.

```
url-support.ts:classifyTabSupport()
├── tab.url 있음 → isSupportedUrl() → "supported" | "unsupported"
└── tab.url 없음 → content script에 location.href 질의
    ├── 지원 URL → "permission-expired"
    └── 미지원/응답 없음 → "unsupported"
```

- `picker-control.ts:92-100` — `ensureSupportedTab()`: 모든 캡처 진입점(picker, area, inline, freeform, video)에서 호출
- `tab-bindings.ts:97` — `deactivatePanelIfCrossOrigin()`: URL 판독 불가 시 cross-origin으로 간주

#### 2단계: 캡처 시점 에러 매칭 (런타임 가드)

진입 가드를 통과했지만 캡처 직전에 grant가 풀린 경우.

```
capture-error.ts:isActiveTabPermissionError()
├── "activetab" 포함
├── "all_urls" 포함
└── "extension has not been invoked" 포함
```

- `picker-control.ts:104-108` — `maybeSurfacePermissionExpired()`: captureVisibleTab 실패 시 호출
- `capture.ts:21` — 요소 스냅샷 실패
- `usePickerMessages.ts:160,218` — 영역 캡처·인라인 캡처 실패

#### 3단계: tabCapture 에러 매칭 (영상 녹화)

```
video-capture.ts:isTabCaptureUnavailable()
├── "extension has not been invoked"
├── "chrome pages cannot be captured"
└── "activetab"
```

- `video-capture.ts:37` — `startRecording()` 실패 시 호출

### 만료 시 동작

아래 두 경로는 **광역 host 권한(`BROAD_HOST_ORIGINS` = `<all_urls>`) 미보유 기준**이다. 광역 권한 보유 시(30s Replay 옵트인으로 부여) 새 URL이 커버 범위(http/https 지원 URL)면 cross-origin도 same-origin처럼 패널 유지 — `<all_urls>`가 captureVisibleTab 캡처 권한을 실제로 주므로 만료 자체가 발생하지 않는다. file:·미지원 URL 등 비커버 URL로의 이동은 보유 여부와 무관하게 아래 경로 그대로(`<all_urls>`는 file:을 포함하지만 캡처는 별도 "파일 URL 액세스" 토글을 요구해 `isBroadCoveredUrl`이 의도적으로 배제).

**즉시 경로 (비보존 상태)**:

- cross-origin 네비게이션 → bg `deactivatePanelIfCrossOrigin`이 패널 비활성화 + 세션 제거. 사용자가 아이콘 재클릭으로 복구.
- 캡처 시도 시 실패 → `onPickerPermissionExpired.fire()` → AlertDialog ("권한이 만료되었습니다") → `window.close()`

**지연 경로 (보존 상태 — drafting/previewing/done/video)**:

1. cross-origin 네비게이션 감지 → bg가 `activeTabExpiredDeferred` 메시지 전송 (패널은 유지)
2. `usePickerMessages`가 플래그 세팅, phase가 idle로 전환될 때 `onPickerPermissionExpired.fire()`
3. AlertDialog → `window.close()`
4. idle 복귀 전 캡처 시도 시에는 기존 3중 방어가 즉시 다이얼로그를 띄움

### 재취득 흐름

```
사이드 패널 닫힘 (window.close)
      ↓
사용자가 아이콘 클릭 / Cmd+Shift+E / 컨텍스트 메뉴
      ↓ (user gesture → 새 activeTab grant)
activateTab() → sidePanel.setOptions({enabled:true}) → sidePanel.open()
      ↓
새 사이드 패널 인스턴스 로드
```

activeTab은 프로그래매틱 재취득이 불가능하다. 반드시 사용자 제스처가 필요.

---

## 3. scripting

content script를 프로그래매틱으로 주입하는 데 사용. SW 하이버네이션이나 네비게이션 후 content script가 사라졌을 때 재주입한다.

### 사용처

| 모드 | world | 코드 위치 | 설명 |
|---|---|---|---|
| Picker 재주입 | ISOLATED | `picker-control.ts:39` | `ping` 실패 시 `manifest.content_scripts[0].js` 재주입 (`ensureContentScript`) |
| Recorder bridge 재주입 | ISOLATED | `picker-control.ts:69` | `recorder-bridge.ts` (sentinel 수신·중계) 재주입 |
| Recorder entry 재주입 | MAIN | `picker-control.ts:86` | `recorders-entry.ts` (network/console/action 후크) 재주입 |
| 뷰포트 측정 | MAIN | `picker-control.ts:612` | Freeform 캡처 시 `innerWidth/Height` 읽기 |
| GitHub 업로드 | MAIN | `background/github-upload.ts:154` | GitHub 페이지 세션으로 에셋 업로드 (self-contained 함수) |

### 주입 실패 시

- `PickerUnavailableError` → `onPickerUnavailable.fire()` → "이 페이지에서는 사용할 수 없습니다" 다이얼로그
- MAIN world 주입은 `catch {}` 로 조용히 실패 (host permission 부족 시 recorder 없이 진행)

### 주의사항

- MAIN world에서 `chrome.scripting.executeScript({ func })` 사용 시 함수는 직렬화·재평가됨 — **클로저 참조 불가**, 헬퍼는 함수 내부에 inline 정의 필수 (`github-upload.ts:pageBatchUploadFn` 참고)
- 주입 차단 호스트: `chromewebstore.google.com` 전체, `chrome.google.com/webstore/*` (`url-support.ts:8-22`)
- 정적 자동 주입 제외(`manifest.config.ts` `content_scripts[].exclude_matches`): `https://bugshot.gitbook.io/*` — 자사 가이드(GitBook)는 새 탭으로만 열리고, 페이지 로드 시 picker/recorder가 자동 주입되면 GitBook 자체 preload 경고가 확장 오류로 귀속되므로 제외. `*.gitbook.io` 전체가 아니라 자사 도메인만 제외(타 GitBook 사이트에서의 사용은 유지). 단 이는 *정적* 주입만 막으며, 사이드패널 바인딩 시 `useBackgroundRecorder` → `executeScript` 동적 주입은 그대로 동작(가이드 페이지 내 picker/캡처 정상)

---

## 4. tabCapture

탭의 오디오·비디오 미디어 스트림을 획득한다. **탭 녹화**에만 사용. (화면 전체 녹화는 `tabCapture`를 안 쓰고 웹 표준 `getDisplayMedia`로 처리 — 아래 "영상 캡처 3종" 참고.)

### 사용 흐름

```
video-capture.ts:startVideoCapture(tabId)
  → video-recorder.ts:startRecording(tabId)
    → chrome.tabCapture.getMediaStreamId({ targetTabId })
    → navigator.mediaDevices.getUserMedia({ audio: false, video: { chromeMediaSource: "tab" } })
    → MediaRecorder 생성 (2Mbps, 1초 chunk, 최대 60초)
    → recorder.onstop → Blob 조립 → 썸네일 생성 → editor store 저장
```

### 영상 캡처 3종 (탭 녹화 / 화면 녹화 / 30s Replay)

세 경로가 권한 모델이 다르다.

- **탭 녹화**: `tabCapture.getMediaStreamId` → 현재 탭 뷰포트만. `tabCapture` 권한 + activeTab 필요.
- **화면 녹화**: `video-capture.ts:startScreenCapture` → `navigator.mediaDevices.getDisplayMedia({video:{displaySurface:"monitor", ≤1920×1080, frameRate:12}})`. **웹 표준 API라 추가 manifest 권한이 없다** — Chrome 화면 공유 picker가 사용자 동의를 직접 받고, 사용자가 [전체 화면/창/탭]을 고른다. transient user activation만 요구(버튼 onClick 첫 await로 호출). 사용자가 "공유 중지"(track `ended`) 또는 60초 상한 시 종료. tabCapture/activeTab/`<all_urls>` 어느 것도 불요.
- **30s Replay**: `tabCapture` 미사용. `captureVisibleTab` 폴링(600ms)으로 JPEG 프레임 수집 → WebCodecs `VideoEncoder`+`mp4-muxer` H.264 MP4.

| | 탭 녹화 | 화면 녹화 | 30s Replay |
|---|---|---|---|
| API | `tabCapture.getMediaStreamId` | `getDisplayMedia` (웹 표준) | `captureVisibleTab` 폴링 |
| 캡처 범위 | 현재 탭 뷰포트 | 사용자 선택 화면/창/탭 (탭 밖 포함) | 현재 탭 |
| 오디오 | 없음 (`audio: false`) | 없음 (`audio: false`) | 없음 |
| 최대 길이 | 60초 | 60초 | 30초 (링 버퍼) |
| 출력 | WebM/MP4 (MediaRecorder) | WebM/MP4 (MediaRecorder) | H.264 MP4 (WebCodecs) |
| 추가 권한 | `tabCapture` + activeTab | 없음 (user gesture만) | `<all_urls>` 필요 |

### 실패 시 동작

`video-capture.ts:37` — `isTabCaptureUnavailable(err)` → `onPickerPermissionExpired.fire()` → activeTab 만료 다이얼로그와 동일한 재실행 안내.

---

## 5. sidePanel

### 전역 비활성화 패턴

```
background/index.ts:33 — disableGlobalSidePanel()
├── chrome.runtime.onInstalled → 호출
└── chrome.runtime.onStartup  → 호출
```

설치/시작 시 전역 패널을 비활성화. 이후 **탭별로** `setOptions({ tabId, enabled: true })` 해야만 열린다.

### 탭별 활성화/비활성화

| 함수 | 위치 | 동작 |
|---|---|---|
| `activateTab()` | `tab-bindings.ts:220` | user gesture → `setOptions({enabled:true})` + `sidePanel.open()` + 활성화 URL 저장(`sidePanel:url:{tabId}`) |
| `apply()` | `tab-bindings.ts:21` | 탭 전환·URL 변경 시 — activated + supported면 path 재등록, 아니면 비활성화 |
| `deactivatePanelIfCrossOrigin()` | `tab-bindings.ts` | origin 비교 → same-origin 유지, cross-origin 닫기/deferred (광역 권한 보유 + 커버 URL이면 유지) |

### sidePanel.open() 호출 조건

`sidePanel.open()`은 user gesture 컨텍스트에서만 호출 가능. 코드베이스에서 **단 한 곳**에서만 호출:

```
tab-bindings.ts:231 — activateTab() 내부
```

트리거: `action.onClicked` (아이콘 클릭 / `_execute_action` 단축키) 또는 `contextMenus.onClicked`. 둘 다 동기 이벤트 핸들러에서 즉시 호출 → user gesture 유지.

### 패널 종료/유지 정책

`deactivatePanelIfCrossOrigin()`이 `tabs.onUpdated` `status:loading` 시점에 호출되어 패널을 닫을지 유지할지 결정한다.

**기준 URL 결정**: 에디터 세션의 `target.url` → 없으면 `activateTab()` 시점에 저장한 활성화 URL(`sidePanel:url:{tabId}`) → 둘 다 없으면 비교 불가로 패널 유지.

**분기표** (cross-origin 행은 광역 host 권한 미보유 기준):

| 네비게이션 | 세션 상태 | 동작 |
|---|---|---|
| same-origin | 보존/비보존 무관 | 패널 유지. 비보존이고 page key 변경 시 stale 세션만 제거 |
| cross-origin + 광역 권한 보유 + 커버 URL(http/https 지원 URL) | 보존/비보존 무관 | same-origin과 동일 취급 — 패널 유지, 비보존이면 stale 세션만 제거. deferred 미발생 |
| cross-origin | 비보존 (idle 포함) | 패널 닫기 + `setActivated(false)` + 세션 제거 |
| cross-origin | 보존 (drafting/previewing/done/video) | 패널 유지, `activeTabExpiredDeferred` 메시지 전송 → idle 복귀 시 만료 다이얼로그 |
| URL 판별 불가 | — | cross-origin으로 간주 → 위 분기 적용 (새 URL 미가시면 광역 커버 판정도 false) |

광역 권한 여부는 cross-origin 판정일 때만 `chrome.permissions.contains({ origins: BROAD_HOST_ORIGINS })`로 조회. file:은 지원 URL이지만 광역 권한 커버 밖이라 현행 분기 유지.

### 세션 보존 규칙

`shouldPreserveSession()` (`tab-bindings.ts:71`): 네비게이션 중에도 패널을 유지할 captureMode/phase 조합.

| captureMode | phase | 보존 여부 |
|---|---|---|
| `video` | 모든 phase | O — 녹화 중단 방지 |
| `screenshot` | `drafting` / `previewing` / `done` | O |
| `element` | `drafting` / `previewing` / `done` | O |
| `freeform` | `drafting` / `previewing` / `done` | O |
| 그 외 | | X — 비보존 |

### Deferred 권한 만료 (보존 상태 전용)

보존 상태에서 cross-origin 네비게이션이 감지되면:

```
tab-bindings.ts → cross-origin + preserved
  → chrome.runtime.sendMessage({ type: "activeTabExpiredDeferred", tabId })

usePickerMessages.ts
  → 메시지 수신 → deferredActiveTabExpiry 플래그 세팅
  → useEditorStore.subscribe로 phase 감시
  → phase === "idle" 전환 시 → onPickerPermissionExpired.fire()
  → 만료 다이얼로그 → window.close()
```

idle 복귀 전 캡처를 시도하면 기존 3중 방어(진입 가드 / 런타임 가드 / tabCapture 가드)가 즉시 만료 다이얼로그를 띄운다.

---

## 6. storage

### chrome.storage.session (브라우저 재시작 시 소멸)

| 키 | 데이터 | 사용처 |
|---|---|---|
| `sidePanel:activated` | `number[]` (tab ID 목록) | `tab-bindings.ts:6` — 패널 활성화 탭 추적 |
| `sidePanel:url:{tabId}` | `string` (활성화 시점 URL) | `tab-bindings.ts:157` — idle 상태 origin 비교 fallback |
| `editor:{tabId}` | `EditorSnapshot` 전체 에디터 상태 | `useEditorSessionSync.ts` — 300ms 디바운스 저장·수화 |
| `pendingPrunedAt` | `number` (timestamp) | `pending-log-prune.ts:57` — 브라우저 세션당 1회 정리 가드 |

### chrome.storage.local (브라우저 재시작 후에도 유지)

| 키 | 데이터 | 사용처 |
|---|---|---|
| `bugshot-settings` | 플랫폼 계정·OAuth 토큰·submit 기본값·titlePrefix | `settings-store.ts` (Zustand persist), `settings-storage.ts` (bg 직접 접근) |
| `bugshot-issues` | `IssueRecord[]` 이슈 기록 | `issues-store.ts` (Zustand persist) |
| `bugshot-app-settings` | 테마·언어·이슈 섹션·LLM 설정·replay 활성화 | `settings-ui-store.ts` (Zustand persist) |

### 쓰기 패턴 특이사항

- **session quota 초과 대응** (`useEditorSessionSync.ts:128`): 이미지 필드를 제거한 "lite" 스냅샷으로 폴백. 3연속 실패 시 저장 중단 + `onSessionSaveExhausted` 발화
- **bg ↔ sidepanel 동기화** (`main.tsx:33`): bg가 OAuth 토큰을 `chrome.storage.local`에 직접 쓰면 `onChanged` 리스너가 Zustand 재수화 트리거
- **세션 외부 삭제 감지** (`useEditorSessionSync.ts:146`): `session` area의 editor 키가 null이 되면(bg에서 `remove` 호출) 세션 만료/리셋 처리

---

## 7. identity

`chrome.identity.launchWebAuthFlow()`로 OAuth 인증 팝업을 띄운다. `chrome.identity.getRedirectURL()`로 extension의 redirect URI를 생성한다.

### 플랫폼별 OAuth 흐름

| 플랫폼 | 인증 URL | 토큰 교환 | PKCE | Proxy 필요 | Refresh |
|---|---|---|---|---|---|
| Jira | `auth.atlassian.com/authorize` | `${PROXY}/token` | X | O | `${PROXY}/token` (refresh_token) |
| GitHub | `github.com/login/oauth/authorize` | `${PROXY}/github/token` | X | O | `${PROXY}/github/refresh` |
| Linear | `linear.app/oauth/authorize` | `api.linear.app/oauth/token` | O (S256) | X | `api.linear.app/oauth/token` |
| Notion | `api.notion.com/v1/oauth/authorize` | `${PROXY}/notion/token` | X | O | 없음 (토큰 무기한) |
| GitLab | `gitlab.com/oauth/authorize` | `gitlab.com/oauth/token` | O (S256) | X | `gitlab.com/oauth/token` |
| Asana | `app.asana.com/-/oauth_authorize` | `${PROXY}/asana/token` | X | O | `${PROXY}/asana/refresh` (refresh_token 비회전) |

### 토큰 저장

모든 토큰은 `chrome.storage.local`의 `bugshot-settings` 키 아래 `accounts.{platform}.auth`에 저장.

bg service worker에서 직접 읽기/쓰기:
- `settings-storage.ts` — `readStoredAuth()`, `writeStoredOAuthTokens()` 등

### 토큰 갱신 (Pre-refresh + 401 재시도)

| 플랫폼 | Pre-refresh 임계값 | 401 재시도 | 갱신 중복 방지 |
|---|---|---|---|
| Jira | 60초 (`jira-api.ts:64`) | O (`authedFetch`) | `refreshInFlight` Promise 중복 제거 |
| GitHub | 60초 (`github-api.ts:109`) | O (`authedFetch`) | `refreshOnceWithLock` 훅 주입 |
| Linear | 60초 (`linear-api.ts:52`) | O (`authedGraphQL`) | `refreshOnceWithLock` 훅 주입 |
| Notion | — | 401 시 `OAuthError` throw → 재인증 안내 | — |
| GitLab | 60초 (`gitlab-api.ts`) | O (`authedFetch`, OAuth 한정) | `refreshInFlight` 훅 주입 |
| Asana | 60초 (`asana-api.ts:102`) | O (`authedFetch`, OAuth 한정) | `refreshInFlight` 훅 주입 |

### OAuth 에러 처리

- `OAuthError` (`oauth.ts:26`): `cancelled`, `platform` 필드 포함
- bg에서 시리얼라이즈: `body.oauthCancelled` 또는 `body.oauthRefreshFailed` 플래그 (`background/index.ts:205`)
- `onOAuthExpired` 이벤트 (`types/messages.ts:209`): refresh 실패 시 발화 → 재인증 UI 표시
- 사용자 취소 코드: `access_denied` (전 플랫폼), `user_cancelled_login`/`user_cancelled_authorize` (Jira), `user_denied` (Notion)

### Env 가드

| 함수 | 위치 | 필요 env |
|---|---|---|
| `isOAuthConfigured()` | `oauth.ts:222` | `VITE_ATLASSIAN_CLIENT_ID` + `VITE_OAUTH_PROXY_URL` |
| `isGithubOAuthConfigured()` | `github-oauth.ts:14` | `VITE_GITHUB_CLIENT_ID` + `VITE_OAUTH_PROXY_URL` |
| `isLinearOAuthConfigured()` | `linear-oauth.ts:12` | `VITE_LINEAR_CLIENT_ID` |
| `isNotionOAuthConfigured()` | `notion-oauth.ts:12` | `VITE_NOTION_CLIENT_ID` + `VITE_OAUTH_PROXY_URL` |
| `isGitlabOAuthConfigured()` | `gitlab-oauth.ts:13` | `VITE_GITLAB_CLIENT_ID` |
| `isAsanaOAuthConfigured()` | `asana-oauth.ts:14` | `VITE_ASANA_CLIENT_ID` + `VITE_OAUTH_PROXY_URL` |

env 누락 시 해당 플랫폼의 OAuth 버튼이 UI에서 자동 비활성화. (GitLab·Asana는 OAuth 미구성이어도 PAT 연결은 가능.)

### 이중 인증 모드

모든 플랫폼은 OAuth 외에 API Key/PAT 인증도 지원. discriminated union의 `kind` 필드로 구분:

| 플랫폼 | OAuth 타입 | 대안 타입 |
|---|---|---|
| Jira | `JiraOAuthAuth` | `JiraApiKeyAuth` (email + API token + baseUrl) |
| GitHub | `GithubOAuthAuth` | `GithubPatAuth` (PAT) |
| Linear | `LinearOAuthAuth` | `LinearApiKeyAuth` |
| Notion | `NotionOAuthAuth` | `NotionApiKeyAuth` (Internal Integration Token) |
| GitLab | `GitlabOAuthAuth` (baseUrl 포함) | `GitlabPatAuth` (PAT + self-managed baseUrl) |
| Asana | `AsanaOAuthAuth` | `AsanaPatAuth` (PAT) |

API Key/PAT 모드는 OAuth 인프라(refresh, proxy, identity API)를 일절 거치지 않는다. (GitLab PAT는 self-managed 인스턴스 host 권한만 런타임 획득.)

---

## 8. commands

1개 단축키만 등록.

| 커맨드 | 기본 키 (Mac) | 동작 |
|---|---|---|
| `_execute_action` | `Cmd+Shift+E` | 사이드 패널 토글 (`action.onClicked` 발화) |

`_execute_action`은 Chrome이 내부 처리해 `action.onClicked`를 발화하므로 별도 `onCommand` 리스너가 필요 없다. `background/index.ts:getActionShortcut()`이 `chrome.commands.getAll()`로 현재 할당 키를 조회해 context menu 타이틀에 표기한다.

### 마이그레이션 (캡처 단축키 제거 — 무손실)

이전 버전의 캡처 단축키 3개(`capture-element`/`capture-screenshot`/`capture-video`)는 제거됐다. 단축키는 manifest `commands`로만 관리되고 chrome.storage/zustand에 영속값이 없으므로 마이그레이션 코드가 불필요하다. 업데이트 시 Chrome이 사라진 command의 키바인딩만 자동 정리하고, **`_execute_action`(사용자 재할당 키 포함)과 모든 영속 설정은 보존**된다. 캡처는 진입 화면 버튼으로 동일하게 가능.

---

## 9. contextMenus

### 설정

```
background/index.ts:46-61 — setupContextMenu()
├── runtime.onInstalled → 호출
├── runtime.onStartup  → 호출
└── 직렬화 Promise 체인으로 중복 ID 방지
```

단일 메뉴 항목: `bugshot-activate` — "BugShot — ⌘⇧E" (단축키 있으면 표시).

### 클릭 핸들러

```
background/index.ts:77 — contextMenus.onClicked
  → activateTab(tab) — 사이드 패널 활성화 (user gesture 제공)
```

---

## 10. webNavigation

### 리스너 2개

#### onBeforeNavigate — 로그 꼬리 보존

```
background/index.ts:113 — webNavigation.onBeforeNavigate
├── frameId !== 0 → 무시 (메인 프레임만)
├── editor:{tabId} 세션 없음 → 무시 (패널 미바인딩 탭)
├── 현재 tab.url을 navUrlPromise Map에 저장 (onCommitted에서 사용)
└── networkRecorder.sync + consoleRecorder.sync + actionRecorder.sync 메시지 전송
```

**목적**: 페이지 떠나기 직전에 MAIN world의 네트워크/콘솔/액션 로그 버퍼를 사이드패널 누적기로 flush. 이 타이밍에 기존 페이지의 content script는 아직 살아있어 메시지 수신 가능. (정상 흐름에서는 레코더가 ~200ms trailing throttle로 이미 stream 중이라 이 sync는 마지막 꼬리 보강.)

#### onCommitted — iframe sentinel 재발행 + 로그 초기화 판정

```
background/index.ts:134 — webNavigation.onCommitted
├── frameId !== 0 (iframe) → 활성 세션 있으면 frameCommitted 메시지 전송
│   └── 사이드패널이 보유 sentinel을 그 프레임에 재발행
│       (broadcast 이후 커밋된 cross-origin iframe을 로그 캡처에 합류)
├── (메인 프레임) navUrlPromise에서 이전 URL 꺼냄
├── shouldClearLogs(prevUrl, newUrl, transitionType)
│   ├── cross-origin → true (다른 사이트 로그 무관)
│   ├── reload → true (DevTools UX — 새로고침 시 리셋)
│   └── same-origin 내부 이동 → false (멀티페이지 디버깅용 보존)
├── editor:{tabId} 세션 없음 → 무시
└── logClear 메시지 전송 → 사이드패널 clearNetworkLog/clearConsoleLog
    (frozen phase에서는 무시)
```

`shouldClearLogs()` 위치: `src/lib/navigation-clear.ts`.

---

## 11. host_permissions (고정)

설치 시 부여. 각 호스트별 사용 기능:

| 호스트 패턴 | 사용 기능 | API 호출 위치 |
|---|---|---|
| `*.atlassian.net/*` | Jira REST API (API Key 모드) | `jira-api.ts` — `${baseUrl}/rest/api/3/*` |
| `api.atlassian.com/*` | Jira OAuth API + accessible-resources | `jira-api.ts`, `oauth.ts:143` |
| `auth.atlassian.com/*` | Jira OAuth authorize endpoint | `oauth.ts:89` — `launchWebAuthFlow` URL |
| `api.github.com/*` | GitHub REST API | `github-api.ts` — repos, issues, users |
| `github.com/*` | GitHub 파일 업로드 page injection | `github-upload.ts:154` — `executeScript({world:"MAIN"})` |
| `uploads.github.com/*` | GitHub 에셋 업로드 S3 | `github-upload.ts` — 업로드 응답 URL |
| `api.linear.app/*` | Linear GraphQL + OAuth token | `linear-api.ts`, `linear-oauth.ts` |
| `api.notion.com/*` | Notion REST + OAuth token | `notion-api.ts`, `notion-oauth.ts` |
| `gitlab.com/*` | GitLab REST + OAuth token (gitlab.com 한정) | `gitlab-api.ts`, `gitlab-oauth.ts` |
| `app.asana.com/*` | Asana REST + OAuth authorize (token 교환은 proxy) | `asana-api.ts`, `asana-oauth.ts` |
| `${PROXY_URL origin}/*` | OAuth proxy (client_secret 은닉) | `oauth.ts`, `github-oauth.ts`, `notion-oauth.ts`, `asana-oauth.ts` |

### OAuth Proxy 엔드포인트

| 엔드포인트 | 플랫폼 |
|---|---|
| `${PROXY}/token` | Jira (auth code 교환 + refresh) |
| `${PROXY}/github/token` | GitHub (auth code 교환) |
| `${PROXY}/github/refresh` | GitHub (token refresh) |
| `${PROXY}/notion/token` | Notion (auth code 교환) |
| `${PROXY}/asana/token` | Asana (auth code 교환) |
| `${PROXY}/asana/refresh` | Asana (token refresh, refresh_token 비회전) |

Linear·GitLab은 PKCE 지원으로 proxy 불필요 — 각각 `api.linear.app/oauth/token`·`gitlab.com/oauth/token`으로 직접 교환.

---

## 12. optional_host_permissions (런타임 요청)

### chrome.permissions.request() 호출 3곳

#### 1. 30s Replay 토글

```
SettingsTab.tsx — handleReplayToggle()
├── chrome.permissions.contains({ origins: BROAD_HOST_ORIGINS })
├── 미부여 시 chrome.permissions.request({ origins: BROAD_HOST_ORIGINS })
├── 부여 → setReplayEnabled(true)
└── 거부 → toast.error("settings.replay.permissionDenied")
```

`BROAD_HOST_ORIGINS` = `["<all_urls>"]` (`src/lib/broad-host-origins.ts`)

부여된 광역 권한은 30s Replay 캡처 외에 **cross-origin 네비게이션 시 패널 선제 닫기 스킵·일반 캡처 지속**에도 사용된다(§ 패널 종료/유지 정책 분기표). 리플레이 스위치를 꺼도 권한이 유지되는 한 적용.

#### 2. BYOK LLM 프로바이더 연결

```
ai-provider.ts:383 — requestHostPermission(baseUrl)
├── new URL(baseUrl) → origin 추출
└── chrome.permissions.request({ origins: ["${protocol}//${host}/*"] })
```

#### 3. GitLab self-managed 인스턴스 연결

```
GitlabConnectForm.tsx:217 — requestHostPermission(baseUrl)
└── 사용자 입력 self-managed 인스턴스 origin에 대해 ai-provider.ts의 requestHostPermission 재사용
```

gitlab.com OAuth 경로는 고정 host_permission이라 런타임 요청이 없고, **self-managed 인스턴스(임의 origin) PAT 연결만** optional `<all_urls>` 하위 origin을 런타임 요청한다.

### chrome.permissions.contains() 호출 3곳

| 위치 | 용도 |
|---|---|
| `SettingsTab.tsx` | Replay 토글 시 이미 부여됐는지 확인 (불필요한 프롬프트 방지) |
| `use-30s-replay.ts` | Replay 활성화 시작 시 — 사용자가 설정에서 권한 철회했으면 자동 비활성화 + 토스트 |
| `tab-bindings.ts` | cross-origin 네비게이션 판정 시 — 보유 + 커버 URL이면 패널 유지 (same-origin 취급) |

### chrome.permissions.remove()

코드베이스에서 **사용하지 않음**. 한번 부여된 optional permission은 사용자가 Chrome 설정에서 직접 철회하지 않는 한 유지.

### 권한 철회 시 동작

사용자가 Chrome 설정에서 수동으로 권한을 철회한 경우:
- `use-30s-replay.ts`: 다음 Replay 시작 시 `contains()` 체크 → 미부여 → `setReplayEnabled(false)` + 토스트 "permissionRevoked"
- `tab-bindings.ts`: 다음 cross-origin 네비게이션부터 즉시 미보유 분기(닫힘/deferred)로 동작 — 사용 직전 조회라 캐시 stale 없음

---

## 13. 권한 라이프사이클 다이어그램

### activeTab 라이프사이클

```
[설치]
  │
  ▼
[대기] ◄──────────────────────────────────────┐
  │                                            │
  │ 사용자 제스처 (아이콘/단축키/메뉴)              │
  ▼                                            │
[activeTab 부여]                                │
  │                                            │
  │ activateTab() → sidePanel.open()           │
  │                  + 활성화 URL 저장            │
  ▼                                            │
[패널 활성] ── captureVisibleTab ──►            │
  │            tabCapture                      │
  │            tabs.get(url)                   │
  │            scripting.executeScript         │
  │                                            │
  │ 네비게이션 발생                              │
  ▼                                            │
[origin 비교] (target.url → 없으면 활성화 URL)    │
  │                                            │
  ├─ same-origin → [패널 유지]                   │
  │                                            │
  ├─ cross-origin + 광역 권한 보유 + 커버 URL      │
  │   → [패널 유지] (same-origin 취급,            │
  │      deferred 미발생 — 미보유 시 아래 분기)     │
  │                                            │
  ├─ cross-origin + 비보존(idle 포함)             │
  │   → 패널 닫기 ─────────────────────────────┘
  │                                            │
  └─ cross-origin + 보존(drafting/video 등)      │
      → [패널 유지 + deferred 플래그]              │
         │                                      │
         ├─ 캡처 시도 → 3중 방어 → 즉시 다이얼로그  │
         │                                      │
         └─ phase → idle 전환                    │
            → [만료 다이얼로그] ─ OK ─► close() ──┘
```

### optional_host_permissions 라이프사이클

```
[미부여]
  │
  │ 30s Replay 토글 ON / LLM 연결
  ▼
[chrome.permissions.request()] ── 거부 ──► [토스트 에러, 기능 비활성]
  │
  │ 승인
  ▼
[부여됨]
  │
  ├─ 30s Replay: captureVisibleTab 폴링 시작
  ├─ 광역 보유 시: cross-origin 네비게이션에도 패널 유지 (선제 닫기 스킵)
  └─ LLM: 외부 API fetch 허용
  │
  │ 사용자 Chrome 설정에서 철회
  ▼
[철회됨]
  │
  │ 다음 Replay 시작 시 contains() 체크 / 다음 cross-origin 이동은 즉시 미보유 분기
  ▼
[자동 비활성화 + 토스트]
```

### OAuth 토큰 라이프사이클

```
[미연결]
  │
  │ Connect 버튼 / OAuth 버튼
  ▼
[identity.launchWebAuthFlow()]
  │
  ├─ 사용자 취소 → [무시, 미연결 유지]
  ├─ 에러 → [토스트 에러]
  └─ 성공 → auth code
  │
  ▼
[토큰 교환] (proxy 경유 or 직접)
  │
  ▼
[연결됨] ── API 호출 시 토큰 사용
  │
  ├─ 만료 60초 전 → pre-refresh (자동)
  ├─ 401 응답 → refresh 재시도 (자동)
  ├─ refresh 실패 → onOAuthExpired → 재인증 안내
  └─ Notion: refresh 없음, 401 시 재인증 안내
  │
  │ 연결 해제 버튼
  ▼
[removeAccount()] → storage에서 삭제 → [미연결]
```
