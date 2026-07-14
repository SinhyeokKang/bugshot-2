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
12. [광역 host 권한 (`<all_urls>`, required) 사용처](#12-광역-host-권한-all_urls-required-사용처)
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

### host_permissions (설치 시 부여)

```
<all_urls>   — 유일 항목. 모든 페이지 picker·로그 레코더 주입 + captureVisibleTab(화면·페이지 전체 캡처 + 30s Replay) + BYOK LLM·GitLab self-managed 임의 origin fetch + cross-origin stylesheet 원문 fetch(스타일 보강, SSRF 가드) + 8개 플랫폼 REST/OAuth host + OAuth proxy origin fetch까지 전부 커버
```

`<all_urls>`가 상위집합이라 플랫폼별 REST/OAuth host(`*.atlassian.net`·`api.github.com`·`github.com`(에셋 업로드 정책)+GitHub 발급 S3 업로드 URL·`api.linear.app`·`api.notion.com`·`gitlab.com`·`app.asana.com`·`api.clickup.com`·`api.atlassian.com`·`slack.com`)와 OAuth proxy origin(`VITE_OAUTH_PROXY_URL`)을 **manifest에 따로 나열하지 않는다** — 전부 `<all_urls>`로 동작한다. OAuth authorize endpoint(`auth.atlassian.com`·`app.clickup.com`·`slack.com/oauth/v2/authorize` 등)는 `launchWebAuthFlow`가 Chrome 관리 팝업에서 처리하므로 host_permission 자체가 불요. 어느 플랫폼·proxy로 트래픽이 나가는지(데이터 전송 대상)는 §11과 docs/privacy.ko.md의 전송 표 참조.

`<all_urls>`가 required인 이유: `captureVisibleTab`은 일반 host 패턴(`https://*/*`)을 캡처 권한으로 인정하지 않고 `<all_urls>` 또는 activeTab만 받는다. 30s Replay가 cross-origin 이동 후에도 캡처하려면 `<all_urls>`가 필요한데, activeTab은 cross-document 네비게이션에서 회수돼 프로그램적 재취득이 불가하므로 광역 host 권한을 **설치 시 상시 보유**(required)한다. BYOK LLM·GitLab self-managed의 임의 origin fetch도 이 권한으로 커버된다.

> **과거 모델(폐기)**: `<all_urls>`는 한때 `optional_host_permissions`에 있었고 30s Replay·BYOK·GitLab 연결 시 `chrome.permissions.request()`로 런타임 획득했다. required로 승격하며 설치 시 "모든 사이트의 데이터 읽기/변경" 경고가 상시 노출되고 런타임 권한 프롬프트는 사라졌다. BYOK/GitLab의 `requestHostPermission` 호출은 코드에 남아있으나 이미 보유라 즉시 grant(프롬프트 없음). `chrome.permissions.contains`/`BROAD_HOST_ORIGINS`는 코드에서 제거됐다.

---

## 2. activeTab

**가장 핵심적인 권한.** 사용자의 명시적 제스처(아이콘 클릭·단축키·컨텍스트 메뉴)로 부여되며, 탭 네비게이션 시 만료된다.

### 부여 시점

| 트리거 | 코드 위치 |
|---|---|
| 툴바 아이콘 클릭 | `tab-bindings.ts:253` — `chrome.action.onClicked → activateTab()` |
| `Cmd+Shift+E` 단축키 | `_execute_action` → 아이콘 클릭과 동일하게 `action.onClicked` 발화 |
| 컨텍스트 메뉴 "BugShot" 클릭 | `background/index.ts:79` — `contextMenus.onClicked → activateTab()` |

### 의존 API

| API | 용도 | 사용 위치 |
|---|---|---|
| `chrome.tabs.captureVisibleTab()` | 요소·영역·**화면(뷰포트)**·**페이지 전체(스크롤 타일 N장)**·인라인 이미지·30s Replay 스크린샷 | `background/messages.ts:203` (bg handler — 모든 호출이 `capture-throttle` 직렬 큐 경유). 호출처: `capture.ts:48`(요소), `usePickerMessages.ts`(영역·인라인), `scroll-capture.ts:83`(페이지 전체 타일 루프), `use-30s-replay.ts:71` |
| `chrome.tabCapture.getMediaStreamId()` | 수동 영상 녹화 스트림 (실패 시 `getDisplayMedia` 폴백) | `video-recorder.ts:startTabStream` |
| `chrome.tabs.get() → tab.url` | 탭 URL 읽기 | `tab-bindings.ts`, `picker-control.ts,204,446(pageKeyOf),565`, `video-capture.ts`, `video-recorder.ts`, `use-30s-replay.ts:68,149` |
| `chrome.scripting.executeScript()` | content script 재주입(picker·recorder-bridge는 `allFrames:true`)·뷰포트 측정 | `picker-control.ts` (`ensureMainWorldRecorders`·`getTopViewport` 등) |

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

- `picker-control.ts:183` — `ensureSupportedTab()`: 모든 캡처 진입점(picker, area, inline, freeform, video)에서 호출
- `tab-bindings.ts:150` — `deactivatePanelIfCrossOrigin()`: URL 판독 불가 시 cross-origin으로 간주

#### 2단계: 캡처 시점 에러 매칭 (런타임 가드)

진입 가드를 통과했지만 캡처 직전에 grant가 풀린 경우.

```
capture-error.ts:isActiveTabPermissionError()
├── "activetab" 포함
├── "all_urls" 포함
└── "extension has not been invoked" 포함
```

- `picker-control.ts:195` — `maybeSurfacePermissionExpired()`: captureVisibleTab 실패 시 호출
- `capture.ts:45` — 요소 스냅샷 실패
- `usePickerMessages.ts,376` — 영역 캡처·인라인 캡처 실패

#### 3단계: tabCapture 에러 매칭 (영상 녹화)

```
video-capture.ts:isTabCaptureUnavailable()
├── "extension has not been invoked"
├── "chrome pages cannot be captured"
└── "activetab"
```

- `video-capture.ts:110` — `isTabCaptureUnavailable()` 정의(호출부 `:41`, `startTabStream` 실패 분기)

### 만료 시 동작

`<all_urls>`가 required라 광역 host 권한은 **항상 보유**한다. 새 URL이 커버 범위(http/https 지원 URL)면 cross-origin도 same-origin처럼 패널 유지 — `<all_urls>`가 captureVisibleTab 캡처 권한을 실제로 주므로 만료 자체가 발생하지 않는다. 아래 두 경로는 **`file:`·미지원 URL 등 비커버 URL로의 이동에만** 적용된다(`<all_urls>`는 file:을 포함하지만 캡처는 별도 "파일 URL 액세스" 토글을 요구해 `isBroadCoveredUrl`이 의도적으로 배제).

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
| Picker 재주입 | ISOLATED | `picker-control.ts:39` | `ping` 실패 시 `manifest.content_scripts[0].js`를 `allFrames:true`(top+iframe)로 재주입 (`ensureContentScript` — iframe picker 자가복구) |
| Recorder bridge 재주입 | ISOLATED | `picker-control.ts:75` | `recorder-bridge.ts` (sentinel 수신·중계)를 `allFrames:true`로 재주입 |
| Recorder entry 재주입 | MAIN | `picker-control.ts:92` | `recorders-entry.ts` (network/console/action 후크) 재주입 (MAIN world, `allFrames` 미지정 → top 한정) |
| 뷰포트 측정 | ISOLATED | `picker-control.ts` | Freeform 진입·iframe 요소 선택 시 top 프레임 `innerWidth/Height` 읽기 (`getTopViewport` — world 미지정 → 기본 ISOLATED) |
| GitHub 업로드 | MAIN | `background/github-upload.ts:154` | GitHub 페이지 세션으로 에셋 업로드 (self-contained 함수) |

### 주입 실패 시

- `PickerUnavailableError` → `onPickerUnavailable.fire()` → "이 페이지에서는 사용할 수 없습니다" 다이얼로그
- MAIN world 주입은 `catch {}` 로 조용히 실패 (host permission 부족 시 recorder 없이 진행)

### 주의사항

- MAIN world에서 `chrome.scripting.executeScript({ func })` 사용 시 함수는 직렬화·재평가됨 — **클로저 참조 불가**, 헬퍼는 함수 내부에 inline 정의 필수 (`github-upload.ts:pageBatchUploadFn` 참고)
- 주입 차단 호스트: `chromewebstore.google.com` 전체, `chrome.google.com/webstore/*` (`url-support.ts:8-22`)

---

## 4. tabCapture

탭의 오디오·비디오 미디어 스트림을 획득한다. **탭 녹화**에만 사용. (화면 전체 녹화는 `tabCapture`를 안 쓰고 웹 표준 `getDisplayMedia`로 처리 — 아래 "영상 캡처 3종" 참고.)

### 사용 흐름

```
video-capture.ts:startVideoCapture(tabId)
  → video-recorder.ts:startTabStream(tabId)
    → chrome.tabCapture.getMediaStreamId({ targetTabId })
    → navigator.mediaDevices.getUserMedia({ audio: false, video: { chromeMediaSource: "tab" } })
    → MediaRecorder 생성 (2Mbps, 1초 chunk, 최대 60초)
    → recorder.onstop → Blob 조립 → 썸네일 생성 → editor store 저장
```

### 스틸 캡처 3종 (영역 / 화면 / 페이지 전체)

스크린샷 모드(`capturing` phase)의 하단 툴바에서 고르는 세 방식. **API는 셋 다 `captureVisibleTab`**(background 단일 관문 → `capture-throttle` 2회/초 게이트)이고, 갈리는 건 호출 횟수와 페이지 부작용이다.

| | 영역 캡처 | 화면 캡처 | 페이지 전체 캡처 |
|---|---|---|---|
| 캡처 범위 | 드래그한 사각형 | 뷰포트 1장 | 문서 전체 (스크롤 타일 스티칭) |
| 호출 횟수 | 1 | 1 | N (타일 수 — bg 큐가 500ms 간격 직렬화) |
| 페이지 부작용 | 없음 | 없음 | **자동 스크롤** + `position:fixed` 요소 임시 `visibility:hidden !important` 후 복원 + blocker로 클릭·휠 차단 |
| 상한 | — | — | 20타일 / 캔버스 32000px / 출력 4M 픽셀 (초과 시 잘라내고 안내 toast) |
| 진입 | `picker.startAreaSelect` 드래그 | `picker.selectFullViewport` | `picker.beginScrollCapture` → `scrollCaptureTo` × N → `endScrollCapture` |

주입 경로: 셋 다 **기존 picker content script**(manifest `content_scripts[0]`)에 메시지로 위임 — `chrome.scripting` 신규 사용처 없음. 페이지 전체 캡처의 스크롤·고정 요소 변형은 `finally`의 `endScrollCapture` + picker port disconnect 자가 복원으로 항상 원복된다(`src/content/scroll-capture.ts`). 이 표가 `docs/privacy.{ko,en}.md` §1의 "페이지 전체 캡처" 문단의 근거다.

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
| 추가 권한 | `tabCapture` + activeTab | 없음 (user gesture만) | `<all_urls>` (설치 시 부여, required) |

### 실패 시 동작 — 만료 다이얼로그가 아니라 **화면 공유 폴백**

`video-capture.ts:startVideoCapture` — `startTabStream`이 reject하고 `isTabCaptureUnavailable(err)`이면(activeTab 만료·chrome 페이지 등) **`startScreenCapture(tabId, { preferTab: true })`로 자동 폴백**한다. `getDisplayMedia({ displaySurface: "browser" })`라 Chrome 화면 공유 picker가 탭을 우선 제시하고, 사용자가 대상을 직접 고른다. **추가 권한 없이 살아있는 user activation만** 쓰므로 스트림 획득(`getMediaStreamId`)을 핸들러의 **첫 await**로 빼는 게 전제다(그래야 실패 시점에 activation이 남아 곧장 picker를 띄운다 — POSTMORTEM 참조). 사용자가 picker를 취소(`NotAllowedError`)하면 조용히 no-op.

즉 **"탭 녹화"를 눌러도 결과 소스가 `screen`이 될 수 있다** — 아래 3종 표는 진입 경로 기준이고, 탭 녹화는 실패 시 화면 녹화 경로로 전이한다.

---

## 5. sidePanel

### 전역 비활성화 패턴

```
background/index.ts:31 — disableGlobalSidePanel()
├── chrome.runtime.onInstalled → 호출
└── chrome.runtime.onStartup  → 호출
```

설치/시작 시 전역 패널을 비활성화. 이후 **탭별로** `setOptions({ tabId, enabled: true })` 해야만 열린다.

### 탭별 활성화/비활성화

| 함수 | 위치 | 동작 |
|---|---|---|
| `activateTab()` | `tab-bindings.ts:208` | user gesture → `setOptions({enabled:true})` + `sidePanel.open()` + 활성화 URL 저장(`sidePanel:url:{tabId}`) |
| `apply()` | `tab-bindings.ts:37` | 탭 전환·URL 변경 시 — activated + supported면 path 재등록, 아니면 비활성화 |
| `deactivatePanelIfCrossOrigin()` | `tab-bindings.ts` | origin 비교 → same-origin 유지, cross-origin은 커버 URL(http/https)이면 유지·비커버(file:)면 닫기/deferred |

### sidePanel.open() 호출 조건

`sidePanel.open()`은 user gesture 컨텍스트에서만 호출 가능. 코드베이스에서 **단 한 곳**에서만 호출:

```
tab-bindings.ts:220 — activateTab() 내부
```

트리거: `action.onClicked` (아이콘 클릭 / `_execute_action` 단축키) 또는 `contextMenus.onClicked`. 둘 다 동기 이벤트 핸들러에서 즉시 호출 → user gesture 유지.

### 패널 종료/유지 정책

`deactivatePanelIfCrossOrigin()`이 `tabs.onUpdated` `status:loading` 시점에 호출되어 패널을 닫을지 유지할지 결정한다.

**기준 URL 결정**: 에디터 세션의 `target.url` → 없으면 `activateTab()` 시점에 저장한 활성화 URL(`sidePanel:url:{tabId}`) → 둘 다 없으면 비교 불가로 패널 유지.

**분기표** (`<all_urls>`가 required라 광역 권한은 항상 보유 → 호출부가 `broadGranted=true` 고정, cross-origin 행은 **새 URL의 커버 여부** 기준):

| 네비게이션 | 세션 상태 | 동작 |
|---|---|---|
| same-origin | 보존/비보존 무관 | 패널 유지. 비보존이고 page key 변경 시 stale 세션만 제거 |
| cross-origin + 커버 URL(http/https 지원 URL) | 보존/비보존 무관 | same-origin과 동일 취급 — 패널 유지, 비보존이면 stale 세션만 제거. deferred 미발생 |
| cross-origin + 비커버(`file:`) | 비보존 (idle 포함) | 패널 닫기 + `setActivated(false)` + 세션 제거 |
| cross-origin + 비커버(`file:`) | 보존 (drafting/previewing/done/video) | 패널 유지, `activeTabExpiredDeferred` 메시지 전송 → idle 복귀 시 만료 다이얼로그 |
| URL 판별 불가 | — | cross-origin·비커버로 간주 → 닫기/deferred 분기 |

`chrome.permissions.contains` 조회는 제거됐다(`broadGranted=true` 고정). `file:`은 지원 URL이지만 광역 권한 커버 밖(Chrome '파일 URL 액세스' 별도 토글 필요)이라 닫힘/만료 분기를 탄다. 미보유 분기는 프로덕션 도달 불가 — `resolveNavigationAction` 순수함수 테스트의 회귀 자산으로만 남는다.

### 세션 보존 규칙

`shouldPreserveSession()` (`tab-bindings.ts:70`): 네비게이션 중에도 패널을 유지할 captureMode/phase 조합.

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
| `sidePanel:activated` | `number[]` (tab ID 목록) | `tab-bindings.ts:13` — 패널 활성화 탭 추적 |
| `sidePanel:url:{tabId}` | `string` (활성화 시점 URL) | `tab-bindings.ts:164` — idle 상태 origin 비교 fallback |
| `editor:{tabId}` | `EditorSnapshot` 전체 에디터 상태 | `useEditorSessionSync.ts` — 300ms 디바운스 저장·수화 |
| `pendingPrunedAt` | `number` (timestamp) | `pending-log-prune.ts:93` — 브라우저 세션당 1회 정리 가드 |

### chrome.storage.local (브라우저 재시작 후에도 유지)

| 키 | 데이터 | 사용처 |
|---|---|---|
| `bugshot-settings` | 플랫폼 계정·OAuth 토큰·submit 기본값·titlePrefix | `settings-store.ts` (Zustand persist), `settings-storage.ts` (bg 직접 접근) |
| `bugshot-issues` | `IssueRecord[]` 이슈 기록 | `issues-store.ts` (Zustand persist) |
| `bugshot-app-settings` | 테마·언어·이슈 섹션·LLM 설정·replay 활성화 | `settings-ui-store.ts` (Zustand persist) |
| `bugshot:install-id` | 익명 설치 ID (UUID, 최초 1회 생성) | `background/analytics.ts` — PostHog `distinct_id` |

### 쓰기 패턴 특이사항

- **session quota 초과 대응** (`useEditorSessionSync.ts`): 이미지 필드를 제거한 "lite" 스냅샷으로 폴백. 3연속 실패 시 저장 중단 + `onSessionSaveExhausted` 발화
- **bg ↔ sidepanel 동기화** (`main.tsx`): bg가 OAuth 토큰을 `chrome.storage.local`에 직접 쓰면 `onChanged` 리스너가 Zustand 재수화 트리거
- **세션 외부 삭제 감지** (`useEditorSessionSync.ts:193`): `session` area의 editor 키가 null이 되면(bg에서 `remove` 호출) 세션 만료/리셋 처리

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
| ClickUp | `app.clickup.com/api` | `${PROXY}/clickup/token` | X | O | 없음 (토큰 만료 없음) |
| Slack | `slack.com/oauth/v2/authorize` | `${PROXY}/slack/token` (oauth.v2.access) | X | O | 없음 (user token 만료 없음) |

### 토큰 저장

모든 토큰은 `chrome.storage.local`의 `bugshot-settings` 키 아래 `accounts.{platform}.auth`에 저장.

bg service worker에서 직접 읽기/쓰기:
- `settings-storage.ts` — `readStoredAuth()`, `writeStoredOAuthTokens()` 등

### 토큰 갱신 (Pre-refresh + 401 재시도)

| 플랫폼 | Pre-refresh 임계값 | 401 재시도 | 갱신 중복 방지 |
|---|---|---|---|
| Jira | 60초 (`jira-api.ts:64`) | O (`authedFetch`) | `refreshInFlight` Promise 중복 제거 |
| GitHub | 60초 (`github-api.ts:97` → `background/lib/createRefreshRunner.ts`) | O (`authedFetch`) | `refreshOnceWithLock` 훅 주입 |
| Linear | 60초 (`linear-api.ts:52`) | O (`authedGraphQL`) | `refreshOnceWithLock` 훅 주입 |
| Notion | — | 401 시 `OAuthError` throw → 재인증 안내 | — |
| GitLab | 60초 (`gitlab-api.ts`) | O (`authedFetch`, OAuth 한정) | `refreshInFlight` 훅 주입 |
| Asana | 60초 (`asana-api.ts:90` → `background/lib/createRefreshRunner.ts`) | O (`authedFetch`, OAuth 한정) | `refreshInFlight` 훅 주입 |
| ClickUp | 없음 (토큰 만료 없음) | X | 없음 — 401은 곧 권한 박탈 → 재연결 (`clickup-api.ts`) |
| Slack | 없음 (user token 만료 없음) | X | 없음 — `ok:false`(`token_revoked`/`invalid_auth`)는 곧 권한 박탈 → 재연결 (`slack-api.ts`) |

### OAuth 에러 처리

- `OAuthError` (`oauth/errors.ts` — `oauth.ts`가 re-export): `cancelled`, `platform` 필드 포함
- bg에서 시리얼라이즈: `body.oauthCancelled` 또는 `body.oauthRefreshFailed` 플래그 (`background/oauth.ts:26` `serializeOAuthError` — `background/index.ts`에서 호출)
- `onOAuthExpired` 이벤트 (`types/messages.ts`): refresh 실패 시 발화 → 재인증 UI 표시
- 사용자 취소 코드: `access_denied` (전 플랫폼), `user_cancelled_login`/`user_cancelled_authorize` (Jira), `user_denied` (Notion)

### Env 가드

구성 판정은 `oauth/config.ts`의 `OAUTH_CONFIG` 테이블 + `isConfigured()` 단일 경로 — `messages.ts`의 `*.oauth.available` 핸들러가 이 판정으로 OAuth UI 노출을 결정한다.

| 플랫폼 | 필요 env |
|---|---|
| Jira | `VITE_ATLASSIAN_CLIENT_ID` + `VITE_OAUTH_PROXY_URL` |
| GitHub | `VITE_GITHUB_CLIENT_ID` + `VITE_OAUTH_PROXY_URL` |
| Linear | `VITE_LINEAR_CLIENT_ID` |
| Notion | `VITE_NOTION_CLIENT_ID` + `VITE_OAUTH_PROXY_URL` |
| GitLab | `VITE_GITLAB_CLIENT_ID` |
| Asana | `VITE_ASANA_CLIENT_ID` + `VITE_OAUTH_PROXY_URL` |
| ClickUp | `VITE_CLICKUP_CLIENT_ID` + `VITE_OAUTH_PROXY_URL` |
| Slack | `VITE_SLACK_CLIENT_ID` + `VITE_OAUTH_PROXY_URL` |

env 누락 시 해당 플랫폼의 OAuth 버튼이 UI에서 자동 비활성화. (GitLab·Asana·ClickUp은 OAuth 미구성이어도 PAT/토큰 연결은 가능. Slack은 OAuth 전용이라 env 누락 시 연결 자체가 불가.)

### 이중 인증 모드

**Slack을 제외한** 모든 플랫폼은 OAuth 외에 API Key/PAT 인증도 지원. discriminated union의 `kind` 필드로 구분(Slack은 `SlackAuth = SlackOAuthAuth` 단일 — BYOK 없음):

| 플랫폼 | OAuth 타입 | 대안 타입 |
|---|---|---|
| Jira | `JiraOAuthAuth` | `JiraApiKeyAuth` (email + API token + baseUrl) |
| GitHub | `GithubOAuthAuth` | `GithubPatAuth` (PAT) |
| Linear | `LinearOAuthAuth` | `LinearApiKeyAuth` |
| Notion | `NotionOAuthAuth` | `NotionApiKeyAuth` (Internal Integration Token) |
| GitLab | `GitlabOAuthAuth` (baseUrl 포함) | `GitlabPatAuth` (PAT + self-managed baseUrl) |
| Asana | `AsanaOAuthAuth` | `AsanaPatAuth` (PAT) |
| ClickUp | `ClickupOAuthAuth` (만료·refresh 없음) | `ClickupPatAuth` (`pk_` 토큰) |
| Slack | `SlackOAuthAuth` (user token, 만료·refresh 없음) | ❌ 없음 (OAuth 전용) |

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
background/index.ts:48 — setupContextMenu()
├── runtime.onInstalled → 호출
├── runtime.onStartup  → 호출
└── 직렬화 Promise 체인으로 중복 ID 방지
```

단일 메뉴 항목: `bugshot-activate` — "BugShot — ⌘⇧E" (단축키 있으면 표시).

### 클릭 핸들러

```
background/index.ts:79 — contextMenus.onClicked
  → activateTab(tab) — 사이드 패널 활성화 (user gesture 제공)
```

---

## 10. webNavigation

### 리스너 2개

#### onBeforeNavigate — 로그 꼬리 보존

```
background/index.ts:115 — webNavigation.onBeforeNavigate
├── frameId !== 0 → 무시 (메인 프레임만)
├── editor:{tabId} 세션 없음 → 무시 (패널 미바인딩 탭)
├── 현재 tab.url을 navUrlPromise Map에 저장 (onCommitted에서 사용)
└── networkRecorder.sync + consoleRecorder.sync + actionRecorder.sync 메시지 전송
```

**목적**: 페이지 떠나기 직전에 MAIN world의 네트워크/콘솔/액션 로그 버퍼를 사이드패널 누적기로 flush. 이 타이밍에 기존 페이지의 content script는 아직 살아있어 메시지 수신 가능. (정상 흐름에서는 레코더가 ~200ms trailing throttle로 이미 stream 중이라 이 sync는 마지막 꼬리 보강.)

#### onCommitted — iframe sentinel 재발행 + 로그 초기화 판정

```
background/index.ts:136 — webNavigation.onCommitted
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

설치 시 부여되는 `host_permissions`는 **`<all_urls>` 단일 항목**이다. 아래 표는 manifest 권한 목록이 아니라 **그 광역 권한으로 실제 어디에 트래픽이 나가는지(기능 ↔ 호스트 매핑)**다 — 각 행의 호스트는 별도 권한이 아니라 `<all_urls>`로 커버된다. (과거엔 이 호스트들을 `host_permissions`에 개별 나열했으나 전부 중복이라 제거 — §1 참조.)

| 호스트 (트래픽 대상) | 사용 기능 | API 호출 위치 |
|---|---|---|
| 모든 페이지 | picker·로그 레코더 주입 + `captureVisibleTab`(화면·페이지 전체 캡처 + 30s Replay) + BYOK LLM·GitLab self-managed 임의 origin fetch + cross-origin stylesheet 원문 fetch(스타일 보강) | `picker.ts`, `recorders-entry.ts`, `background/messages.ts`(captureVisibleTab·fetchCssSheets), `ai-provider.ts` |
| `*.atlassian.net` | Jira REST API (API Key 모드) | `jira-api.ts` — `${baseUrl}/rest/api/3/*` |
| `api.atlassian.com` | Jira OAuth API + accessible-resources | `jira-api.ts`, `oauth.ts` |
| `auth.atlassian.com` | Jira OAuth authorize (launchWebAuthFlow — host_permission 불요) | `oauth.ts` — `launchWebAuthFlow` URL |
| `api.github.com` | GitHub REST API | `github-api.ts` — repos, issues, users |
| `github.com` | GitHub 파일 업로드 page injection + 에셋 업로드 정책(`github.com/upload/policies/assets`) | `github-upload.ts` — `executeScript({world:"MAIN"})` |
| GitHub 발급 S3 업로드 URL | 정책 응답의 동적 `policy.upload_url`로 실제 바이트 PUT (고정 host 아님) | `github-upload.ts` — `policy.upload_url` |
| `api.linear.app` | Linear GraphQL + OAuth token | `linear-api.ts`, `linear-oauth.ts` |
| Linear 발급 업로드 URL | `requestFileUpload`가 반환하는 pre-signed URL로 첨부 바이트 PUT (고정 host 아님) | `linear-api.ts` — `uploadUrl` |
| `api.notion.com` | Notion REST + OAuth token | `notion-api.ts`, `notion-oauth.ts` |
| `gitlab.com` | GitLab REST + OAuth token (gitlab.com 한정) | `gitlab-api.ts`, `gitlab-oauth.ts` |
| `app.asana.com` | Asana REST + OAuth authorize (token 교환은 proxy) | `asana-api.ts`, `asana-oauth.ts` |
| `api.clickup.com` | ClickUp REST (task 생성·첨부 업로드·본문 갱신) | `clickup-api.ts`, `clickup-oauth.ts` |
| `slack.com` | Slack Web API (메시지 전송·채널/DM·멤버 조회·files 2-step 업로드) + OAuth authorize. files PUT은 Slack이 런타임 반환하는 `upload_url`(`*.slack.com` 등)도 `<all_urls>` 커버 | `slack-api.ts`, `slack-oauth.ts` |
| `us.i.posthog.com` (또는 `VITE_POSTHOG_HOST`) | 익명 분석 — 이슈 제출·연동 집계(`$ip:"0.0.0.0"`·geoip 비활성·person profile 미생성) | `background/analytics.ts` — `/capture/` fetch |
| OAuth proxy origin | OAuth proxy (client_secret 은닉) | `oauth.ts`, `github-oauth.ts`, `notion-oauth.ts`, `asana-oauth.ts`, `clickup-oauth.ts`, `slack-oauth.ts` |

### OAuth Proxy 엔드포인트

| 엔드포인트 | 플랫폼 |
|---|---|
| `${PROXY}/token` | Jira (auth code 교환 + refresh) |
| `${PROXY}/github/token` | GitHub (auth code 교환) |
| `${PROXY}/github/refresh` | GitHub (token refresh) |
| `${PROXY}/notion/token` | Notion (auth code 교환) |
| `${PROXY}/asana/token` | Asana (auth code 교환) |
| `${PROXY}/asana/refresh` | Asana (token refresh, refresh_token 비회전) |
| `${PROXY}/clickup/token` | ClickUp (auth code 교환, refresh 없음) |
| `${PROXY}/slack/token` | Slack (auth code 교환 → user token, refresh 없음) |

Linear·GitLab은 PKCE 지원으로 proxy 불필요 — 각각 `api.linear.app/oauth/token`·`gitlab.com/oauth/token`으로 직접 교환.

---

## 12. 광역 host 권한 (`<all_urls>`, required) 사용처

`<all_urls>`는 `host_permissions`에 required로 선언돼 **설치 시 부여**된다(과거 optional + 런타임 요청 모델은 폐기 — §1 참조). 따라서 `chrome.permissions.contains`/`remove` 기반의 확인·철회 흐름은 코드에서 제거됐고(`chrome.permissions.request`는 BYOK/GitLab의 `requestHostPermission`으로 **잔존** — 이미 보유라 즉시 grant, 아래 §requestHostPermission 잔존 호출 참조), `BROAD_HOST_ORIGINS` 상수(`src/lib/broad-host-origins.ts`)도 삭제됐다.

### 사용처

| 위치 | 용도 |
|---|---|
| `picker.ts` / `recorders-entry.ts` | 모든 페이지에 picker·로그 레코더 content script 주입 |
| `background/messages.ts` (`captureVisibleTab`) | 30s Replay + 스틸 캡처(영역·화면·페이지 전체) — cross-origin 네비게이션 후에도 캡처 유지(activeTab은 회수되므로 광역 권한이 필요) |
| `tab-bindings.ts` (`deactivatePanelIfCrossOrigin`) | cross-origin 커버 URL(http/https) 이동 시 패널 유지 — `broadGranted=true` 고정(§ 패널 종료/유지 정책 분기표) |
| `ai-provider.ts` (`requestHostPermission`) | BYOK LLM 프로바이더 연결 — 임의 baseUrl origin 요청이 `<all_urls>`에 포섭돼 **즉시 grant**(프롬프트 없음) |
| `GitlabConnectForm.tsx` | GitLab self-managed 인스턴스 PAT 연결 — `requestHostPermission` 공유, 동일하게 즉시 grant |
| `background/messages.ts` (`fetchCssSheets`) | cross-origin stylesheet 원문 fetch — content가 보낸 page-controlled href를 CORS 우회로 읽어 스타일 specified 값 보강. http(s) 공개 호스트 한정(SSRF 가드 `lib/ssrf-guard.ts` `isFetchableSheetUrl` — loopback·사설·link-local 차단), `credentials:omit` · `redirect:manual` · CSS content-type · 2MB 캡 |

### requestHostPermission 잔존 호출

`ai-provider.ts`의 `requestHostPermission(baseUrl)`는 코드에 남아있다(BYOK·GitLab self-managed). `<all_urls>`를 required로 보유하므로 하위 origin 요청은 Chrome이 프롬프트 없이 즉시 `true`로 resolve한다. 함수 제거는 별도 정리 사항(현재 무해한 즉시-grant no-op).

### 권한 범위 좁히기 (사용자 측)

required 권한이라 설치 시 "모든 사이트의 데이터 읽기/변경"에 동의해야 한다. 사용자가 Chrome 확장 설정에서 site access를 "특정 사이트"·"클릭 시"로 좁히면 광역 동작이 제한될 수 있으나, 코드에는 optional revoke 모델(`permissions.contains` 재확인·자동 비활성화) 분기가 더 이상 없다.

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
  ├─ cross-origin + 커버 URL(http/https)         │
  │   → [패널 유지] (same-origin 취급,            │
  │      deferred 미발생 — <all_urls> required)   │
  │                                            │
  ├─ cross-origin + 비커버(file:) + 비보존        │
  │   → 패널 닫기 ─────────────────────────────┘
  │                                            │
  └─ cross-origin + 비커버(file:) + 보존         │
      → [패널 유지 + deferred 플래그]              │
         │                                      │
         ├─ 캡처 시도 → 3중 방어 → 즉시 다이얼로그  │
         │                                      │
         └─ phase → idle 전환                    │
            → [만료 다이얼로그] ─ OK ─► close() ──┘
```

### 광역 host 권한 (`<all_urls>`, required) 라이프사이클

```
[설치]
  │
  │ "모든 사이트의 데이터 읽기/변경" 동의 (required — 거부 시 확장 미동작)
  ▼
[상시 부여]
  │
  ├─ 30s Replay 토글 ON → captureVisibleTab 폴링 시작 (권한 확인 없음)
  ├─ cross-origin 커버 URL 이동 → 패널 유지 (broadGranted=true 고정)
  ├─ BYOK/GitLab self-managed 연결 → requestHostPermission 즉시 grant (프롬프트 없음)
  └─ 모든 페이지 picker·로그 레코더 주입
```

> 런타임 요청·철회·자동 비활성화 흐름은 없다(required 모델). 사용자가 Chrome 설정에서 site access를 좁히는 것만 가능.

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
