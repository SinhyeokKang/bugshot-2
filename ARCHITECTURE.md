# Architecture

bugshot-2의 서브시스템별 설계 상세. 해당 영역을 수정할 때 참고한다.

## Side Panel은 탭 스코프

**활성화한 탭에서만 side panel이 보이고, 탭을 이동하면 자동으로 닫힌다.** 돌아오면 다시 열린다.

구현:
- `chrome.storage.session`의 `sidePanel:activated` 키에 활성화된 tabId 셋을 저장
- `chrome.action.onClicked`에서 해당 탭을 셋에 추가하고 `sidePanel.setOptions({tabId, enabled:true, path:...?tabId=X})` + `sidePanel.open({tabId})`
- `chrome.tabs.onActivated` / `onUpdated`에서 각 탭이 활성화 셋에 있으면 enable, 없으면 disable
- **manifest의 `side_panel.default_path`가 전역 fallback을 제공하므로** `onInstalled`/`onStartup`에서 `chrome.sidePanel.setOptions({ enabled: false })`로 전역 비활성화 필수

## user gesture 보존

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

## 편집 세션 영속화

- tabId별로 `chrome.storage.session`의 `editor:${tabId}` 키에 저장
- `useEditorSessionSync(tabId)` 훅이 hydration + debounced save(300ms) 담당 (zustand persist 미들웨어 대신 직접 구현 — tabId-scoped 키가 persist의 "one store, one key" 모델에 맞지 않음)
- origin 변경 시 해당 탭의 세션은 버림 (`clearIfOriginChanged` in `tab-bindings.ts`)
- 탭 닫히면 `onRemoved`에서 정리
- **복수 element 버퍼(`bufferedElements`)도 세션 영속화**된다. 단 phase별 보존이 비대칭: `styling`에서 세션 만료/`reset`이 걸리면 버퍼가 폐기되고, `drafting`/`previewing`/`done`은 `selection`과 동일하게 스냅샷에 포함돼 패널을 닫았다 열어도 복원된다. quota 초과 시 lite 폴백이 버퍼 내부 before/after base64까지 명시적으로 null화.
- **draft 영속화도 버퍼 전체를 포함**한다. draft로 저장하면 버퍼가 `IssueRecord.bufferedElements`(+ element별 `b${i}-before/after` 이미지 blob in `blob-db`)로 IndexedDB에 저장되고, `DraftDetailDialog` 재오픈 시 전체가 복원·재제출 본문에 모두 포함된다. `resolveDraftStyleElements`가 라이브 `mergeStyleElements`와 동일 규칙으로 병합(`useDraftStyleElements`가 이미지 로드)해 라이브 세션과 결과가 일치. `IssueRecord.bufferedElements`는 optional이라 구 draft는 자동 하위호환(단일 element). 이슈 삭제 시 `deleteImageBlobs`가 `${issueId}:` 접두사 전체를 지워 버퍼 이미지 고아를 방지.

## 플랫폼 인증

6개 플랫폼 모두 **수동 인증(API Token/PAT) + OAuth** 두 방식을 동시 지원한다. 저장 형태는 discriminated union (`{Platform}Auth`, `kind` 판별자). OAuth는 `chrome.identity.launchWebAuthFlow` → 인가 코드 → 토큰 교환. `is{Platform}OAuthConfigured()` 가드가 false면 OAuth UI 비활성화.

| | Jira | GitHub | Linear | Notion | GitLab | Asana |
|---|---|---|---|---|---|---|
| 수동 인증 | API Token (Basic) | PAT (`token <pat>`) | API Key | Internal Integration Token | PAT (`Bearer`, self-managed baseUrl) | PAT (`Bearer`) |
| OAuth 타입 | 3LO (confidential) | Web Flow (confidential) | PKCE (public) | Public Integration (confidential) | PKCE (public) | OAuth 2.0 (confidential) |
| Proxy 경로 | `/token` | `/github/token`, `/github/refresh` | ❌ 직접 교환 | `/notion/token` | ❌ 직접 교환 (gitlab.com 한정) | `/asana/token`, `/asana/refresh` |
| Token Refresh | pre-refresh + 401 retry | hook 주입형, 1회 retry | hook 주입형, 1회 retry | ❌ (토큰 만료 없음) | hook 주입형, pre-refresh + 401 retry | hook 주입형, pre-refresh + 401 retry |
| dev/prod 분리 | 단일 App | 2 App (callback URL 1개 제한) | 단일 App (multi redirect) | 단일 App (multi redirect) | 단일 App (multi redirect) | 단일 App (multi redirect) |
| Env var | `VITE_ATLASSIAN_CLIENT_ID` | `VITE_GITHUB_CLIENT_ID` (+`_PROD`) | `VITE_LINEAR_CLIENT_ID` (+`_PROD`) | `VITE_NOTION_CLIENT_ID` | `VITE_GITLAB_CLIENT_ID` | `VITE_ASANA_CLIENT_ID` |

공통 env: `VITE_OAUTH_PROXY_URL` — Cloudflare Worker origin (Jira·GitHub·Notion·Asana 공유). manifest가 빌드 시 origin을 `host_permissions`에 자동 추가.

**왜 proxy가 필요한가**: confidential client는 `client_secret` 요구 — 확장에 비밀키를 번들할 수 없으므로 Worker가 `code↔token`·`refresh↔token` 교환만 중계. Linear·GitLab은 public client(PKCE)라 proxy 불필요. Asana는 native 앱 모드가 OOB redirect만 허용해 custom redirect(`chromiumapp.org`)를 쓰려면 confidential일 수밖에 없어 proxy 경유한다.

**GitLab self-managed**: OAuth는 `gitlab.com` 고정(host_permission). PAT는 임의 self-managed 인스턴스 URL(`gitlabInstanceUrl.normalizeInstanceUrl` — gitlab.com은 https 강제) 지원하며, 연결 시 `requestHostPermission(baseUrl)`로 optional host 권한을 런타임 획득. GitLab은 업로드→이슈생성 순서라 logs.html에 이슈 역링크를 사전 주입 불가 → 생성 후 `injectIssueUrl` 재업로드 + `gitlab.updateIssueDescription`(description PUT)으로 보강(실패는 격리).

**Asana**: REST·authorize는 `app.asana.com` 고정, token 교환은 proxy(`/asana/token`·`/asana/refresh`) 경유. 응답은 `{ data }` 래핑이라 `asanaFetch`가 언랩. html_notes는 인라인 이미지를 지원하므로(`<img data-asana-gid>`) **create → upload → updateTaskNotes** 2-write로 본문에 이미지를 임베드한다(첨부 후 GID 참조라 순서 강제). 캡처 이미지(As is/To be)뿐 아니라 에디터 본문에 붙여넣은 인라인 이미지(`inlineImages`, 본문 src `inline:refId`)도 같은 경로로 업로드·임베드한다. 단 Asana는 webp 인라인을 지원하지 않아 업로드 전 webp→jpeg로 폴백 변환하고, 작게 렌더되지 않도록 `src`(view_url)+`data-src-width/height`+`style`을 채운다. element 비교는 As is/To be 섹션(이미지+속성값)으로 배치(테이블은 `<pre>` 폴백이라 셀 이미지 불가). 영상·로그·메타는 인라인 불가라 task 첨부 영역에만 둔다(본문에 파일 리스트 미표기). logs.html은 createTask가 upload보다 먼저라 업로드 직전 `injectIssueUrl(task.permalinkUrl, task.gid)`로 백링크·key를 주입해 1회 업로드로 끝낸다(GitLab식 재업로드 불필요). refresh_token은 비회전이라 갱신 응답에 없으면 기존 토큰 유지.

**Refresh 실패 → 재인증**: refresh token 무효화 시 `OAuthError({ platform })` → BG `onOAuthExpired(platform)` → App.tsx AlertDialog 재인증 안내. GitHub은 OAuth App "Token expiration" OFF면 refresh token 미발급 → 즉시 재인증 안내. **OAuthError 분기**: `{ platform, cancelled }` → BG가 `body.platform`/`oauthCancelled`/`oauthRefreshFailed` 플래그 직렬화. 정규식 매칭 금지 — `isOAuthCancelled`/`getOAuthErrorPlatform` 헬퍼 사용.

## 플랫폼 어댑터 패턴

`PlatformId = "jira" | "github" | "linear" | "notion" | "gitlab" | "asana"` union (`src/types/platform.ts`).

- **저장**: `useSettingsStore.accounts` dict + `lastSubmitFields: Record<PlatformId, ...>` + 전역 `titlePrefix`.
- **메시지**: bg `{platform}.*` namespace 분기. `BgRequest` exhaustive switch 누락 검증. 새 타입은 `BG_REQUEST_TYPES` Set에도 등록.
- **API 어댑터**: `{platform}-api.ts`. 401 처리 — Jira: 즉시 refresh, GitHub·Linear·GitLab·Asana: hook 주입형(module side-effect 재등록), Notion: 즉시 throw.
- **이슈 상태 변경**: `statusBadges/SubmittedBadge` → 플랫폼별 read-only / Popover 상태 변경 분기.
- **본문 빌더**: `buildIssueAdf`(Jira), `buildIssueMarkdown`/`buildIssueHtml`(클립보드), `build{Github|Linear|Notion|Gitlab|Asana}IssueBody`. 모두 `MarkdownContext` 입력 → `NormalizedSubmitResult { key, url }` 통일. (GitLab은 github 빌더 계열 — DOM raw selector·before/after 표. Asana는 markdown 본문을 `markdownToAsanaHtml`로 html_notes subset 변환.)
- **AI 메타 첨부**: `buildAiMetaAttachment` → `bugshot.md` (`AI_META_FILENAME`). Jira: 첨부 REST, GitHub: 업로드+본문 링크, Linear/Notion: 별도 첨부.
- **다이얼로그**: `SubmitFieldsDialog`가 IssueCreateModal·DraftDetailDialog 공유. 연결 1개=Tab 숨김, 2개+=Tab 선택. prefill effect deps `[open, issue?.id]`만 — `issue.platform` 추가 시 다이얼로그 닫힘 버그.

**Jira 인라인 미디어 trap**: ADF `mediaSingle > media`는 `type:"file"` + UUID + `collection:""` 필수. `type:"external"`은 인증 실패로 표시 불가. UUID 추출은 `GET /attachment/content/{id}` redirect URL에서 (`probeMediaRedirect` — GET+Range → HEAD 순). **인라인 재생 실패 시 코덱·해상도 의심 전에 ADF attrs/UUID 추출 경로부터 확인** — 99% 그쪽이 원인.

**Notion 특이사항**: image·video는 본문 inline, log·other는 첨부 섹션 file 블록. element 모드는 Before/After heading_3 분리(표 셀이 image 불가). 페이지 ID 추출은 반드시 `extractNotionPageId()` 사용(slug garbage 방지). 상태 색은 `notionStatusCategory(color)` → new/indeterminate/done 매핑.

## 토큰 체인 resolve 룰

picker의 `resolveVarChain`은 `var()` 체인을 따라가며 어느 이름에서 멈출지 결정한다. 원칙: **디자인 토큰 이름은 보존, 컴포넌트 내부 alias는 펼침**.

- **공용 토큰** (`--radius-xxl`, `--color-text-semantic` 등): 처음 만나는 이름에서 멈춤. 시맨틱이 원시를 참조해도 시맨틱 이름 노출.
- **private alias** (`--_xxx` 언더스코어 prefix): 리터럴까지 끝까지 펼침.
- fallback `var(--x, var(--y))` — primary 미정의면 fallback 이름으로 resolve, 규칙 동일.

## CSSOM shorthand 한계 우회 (Raw CSS Cache)

shorthand(var 포함) + 같은 shorthand의 longhand override 조합에서 Chrome이 shorthand를 explode하며 **원본 var()를 빈 문자열로 대체**. CSSOM만으로 복구 불가.

**대응**: `src/content/css-source-cache.ts`가 raw CSS를 별도 확보해 룰별 매핑.

수집: `<style>` → `ownerNode.textContent`, `<link>` → `fetch(href)` (same-origin/CORS만), `adoptedStyleSheets` → `cssText` 직렬화. 픽커 활성화 시 `ensureLoaded()` + `MutationObserver`로 변경 감지, 비활성화 시 drop.

매핑: parsed rule list와 `sheet.cssRules`를 순서+selectorText로 1:1 매핑. mismatch 시 CSSOM fallback. `collectSpecifiedFromRules`에서 `getRawDeclarationsFor(rule)` 우선, null이면 CSSOM fallback.

비동기 영향: `picker.collectTokens` 등 메시지 핸들러가 `await ensureCssCacheLoaded()`. content script는 `return true` + IIFE 패턴. 여전히 못 잡는 케이스: CORS 헤더 없는 cross-origin stylesheet.

## 백그라운드 로그 캡처 (Network / Console / Action)

`src/content/recorders-entry.ts`를 MAIN world `document_start`로 등록해 fetch/XHR/sendBeacon/console/사용자 액션을 자동 wrap. 페이지 스크립트보다 먼저 실행되므로 Sentry 등이 `originalFetch` 캐싱 전에 wrap 설치.

**활성 게이트**: 세 레코더의 `recording` 기본값은 `false` — wrap은 document_start에 설치하되 **패널이 탭에 활성인 동안만** 적재한다. 패널 주입 시 `setSentinel`로 `true`, 패널 닫힘(`port.onDisconnect`)·탭 전환(`tab-bindings.ts` `onActivated`에서 직전 활성 탭에 stop)으로 `false`. `recording=false`면 fetch는 `createPatchedFetch`의 `shouldRecord` 게이트로 원본 경로(`new Request` 재구성 없음), XHR/sendBeacon/console/action은 push 차단 — 미활성 탭 트래픽에 일절 간섭하지 않는다. 같은 탭으로 (네비게이션 없이) 복귀해 패널 문서가 살아 있으면 패널 `visibilitychange`(visible)가 재주입을 트리거해 stop과 대칭을 맞춘다.

**페이지 무간섭(예외 격리)**: 세 레코더는 MAIN world에서 페이지와 같은 전역을 공유하므로 wrap이 페이지 동작을 절대 깨뜨리면 안 된다. 불변식 — ① 원본(fetch/XHR/`console.*`/`history.pushState·replaceState`)을 **먼저** 호출해 페이지 동작 보존, ② 기록 로직의 throw는 try/catch로 격리해 페이지 호출자로 전파 금지(`createPatchedFetch` record/settle, XHR `recordXhrSend`, console wrap의 `safeStringify`, action history wrap 모두 격리), ③ 응답 본문 read는 settle을 await하지 않음. 특히 `safeStringify`는 페이지 값의 throwing getter·커스텀 `toString`/`Symbol.toPrimitive`·Proxy trap에도 `[unserializable]`로 흡수해 wrap된 `console.log`(=페이지 코드)가 throw하지 않게 한다. 리팩터 시 이 3원칙을 깨면 페이지 요청·라우팅·콘솔이 깨질 수 있다(과거 fetch `new Request` 재구성이 GitHub 업로드·SigV4를 깬 회귀 전례).

**버퍼 전략**: 활성 구간 동안 적재. 메모리 보호 — Network: 50MB body cap(LRU trim) + 5000 entry FIFO, Console: 2000 entry FIFO, Action: 1000 entry FIFO. 요청 phase: send 시 `pending`, 응답 완료 `complete`, reject/abort/error/timeout 시 `error`로 in-place 갱신. 추가 캡처: `sendBeacon`, fetch reject, XHR error/abort/timeout.

**Body omission**: `string | NetworkBodyOmission` union. kind: `truncated`(3MB 초과), `binary`(image/font 등), `stream`(SSE/multipart), `omitted`(LRU 회수). UI·logs.html 모두 사유 표시.

**Console wrap 범위**: `log/info/debug` + `trace/assert/dir/table/group*/count*/time*`만 wrap. **`error/warn`은 의도적 제외** — wrap 함수가 콜스택에 끼면 Chrome이 확장 attribution해 `chrome://extensions`에 페이지 라이브러리 경고 누적. 진짜 에러는 `window.addEventListener("error")`/`unhandledrejection`/`console.assert`로 별도 캡처.

**액션 레코더**: click/input/change를 capture-phase에서, `pushState`/`replaceState` 래핑 + `popstate`/`hashchange`로 네비게이션 기록. 클릭은 가까운 interactive 요소로 정규화, accessible name과 implicit role을 **분리 저장** — 자연어 문장 조립은 뷰어(`ActionLogContent`)의 i18n 레이어가 담당. 입력은 같은 selector 연속 dedup. **민감 필드 마스킹**: `shouldMaskField`가 type=password, autocomplete 힌트, 필드명 키워드(`password|secret|card|cvv|ssn|token` 등)로 판별해 `***` 치환. 녹화 bind(`setSentinel`) 시 현재 페이지 진입 `load` 네비게이션을 1회 보충(`entryNavOnBind`) — document_start의 load는 `recording=false`라 버려지므로 cross-origin 진입 자취가 사라지는 것을 메운다.

**Cross-page 누적**: 네비게이션을 넘어 로그 누적. 떠나는 페이지 로그 꼬리는 `webNavigation.onBeforeNavigate`(주) + content `pagehide`(보조)로 sync. `mergeLogItems`가 id dedup + 시간 정렬 + maxEntries FIFO trim. `onCommitted` 시점에 `shouldClearLogs`로 초기화 판정 — cross-origin 또는 reload 시 리셋, same-origin 내부 이동은 보존. 단 사이드패널 `logClear` 핸들러가 `shouldPreserveBackgroundLogs(phase)`(recording/drafting/previewing/done)로 가드 → **녹화 중 cross-origin 이동도 로그를 유지**(진행 중 캡처가 페이지를 가로지른 한 세션이므로). `isLogFrozen(phase)` = drafting/previewing/done일 때 머지 동결.

**Freeze/Settle**: freeze 전환 직전 `syncAndSettleLogs`가 sync 후 반영 대기(store `endedAt` 증가 감지, 상한 300ms)해 진입 직전 로그를 고정. 30s replay는 settle 후 프레임 버퍼 구간으로 추가 trim.

**Cross-tab 격리**: `usePickerMessages`가 `sender.tab?.id !== myTabId`인 메시지 drop — 동일 origin 다른 탭의 로그가 섞이는 것 방지.

**로그 첨부**: `buildLogsHtml`(async)이 `dist-log-viewer/index.html` 템플릿에 데이터 주입 → self-contained HTML. 용량 최적화로 무거운 데이터(networkLog/consoleLog/actionLog/video/screenshot/report)는 gzip+base64(`gzip-base64.ts`)로 압축해 `__BUGSHOT_DATA__` 태그에, 작은 meta는 평문 `__BUGSHOT_META__` 태그에 분리 주입(제출 후 `injectIssueUrl`은 평문 meta만 함수형 치환 — 압축 blob 미접근). har/console·actionLogJson 등 파생 export는 raw 로그에서 다운로드 시점에 즉석 생성(중복 직렬화 회피, `meta.version` 사용). log-viewer는 Console/Network/Action 외 **Report 탭**(이슈 제목·재현 환경·본문 섹션 프리뷰 + 마크다운/HTML 클립보드 복사)을 추가 제공 — 본문은 `buildReportData`가 inline 이미지를 dataURL로 resolve해 임베드, 표시는 `IssuePreviewView`(PreviewPanel과 공용). AI 초안 `buildActionLogSummary`도 video 한정.

**로그 정책 매트릭스** — 단일 진실: `src/sidepanel/lib/captureLogSupport.ts` (`supportsConsoleNetworkLog`, `supportsActionLog`). UI 카드 표시(PreviewPanel·DraftDetailDialog `LogAttachmentCards`) / DraftDetailDialog blob 로드 / 제출 첨부(`buildCaptureFiles` → logs.html 생성 조건) / Notion 본문 log summary 블록 모두 이 기준.

| 캡처 모드 | console | network | action | 첨부 토글 기본값 |
|---|---|---|---|---|
| element | ❌ | ❌ | ❌ | — |
| screenshot | ✅ | ✅ | ❌ | off (사용자가 토글) |
| freeform | ✅ | ✅ | ❌ | on (자동) |
| video | ✅ | ✅ | ✅ | on (자동) |

기본값은 `editor-store.ts`의 모드 진입 액션(`startCapturing`/`startFreeform`/`startRecording`/`onRecordingComplete`)에서 설정. screenshot은 `preserveLogs`로 직전 상태만 승계 (`initial`은 모두 false).

**플랫폼별 패키징**:
- **Jira/Linear**: `logs.html` 그대로 첨부 → 이슈 생성 **후** `injectIssueUrl`로 뷰어 백링크 주입.
- **GitHub**: `logs.html` 그대로 첨부 (markdown link) → issueUrl 미주입(빈 값 → 뷰어가 링크 숨김).
- **Notion**: **`logs.zip`** (DEFLATE 압축 zip 1파일 래핑, `zipLogsHtml`). Cloudflare WAF가 `POST /v1/file_uploads/{id}/send`에서 평문 HTML/로그 콘텐츠(스택트레이스·URL·SQL스러운 토큰)를 공격 페이로드로 오탐해 403 반환. store-mode zip도 내부가 평문이라 같은 사유로 막힘 → DEFLATE 압축 바이트는 평문 패턴 매칭 회피. 부수효과로 size ~30%로 줄어 무료 워크스페이스 5 MiB 한도 여유. 단계: 페이지 생성 전 업로드 → issueUrl 주입 불가(GitHub과 동일, 빈 값 → 뷰어 자동 숨김).

**영상-로그 동기화**: `LogViewerData.video`에 영상 임베드 → log-viewer가 좌(영상)/우(3탭) 분할, `LogSeekChip`으로 행↔영상 양방향 seek + active 행 하이라이트. 동기화 0점은 `video.startedAt`. props 미공급(라이브 사이드패널 서브탭)이면 칩·active 안 생겨 기존 레이아웃 불변.

**타임라인 마커**: `markers.ts:buildMarkers`가 활성 로그 탭(console/network/action)에 따라 프로그레스 바 위에 핀 마커를 생성. 마커 variant(error/warn/info/pending/navigate/default)별 색 분류. `ProgressBar` 위에 `absolute` 핀으로 렌더, 호버 시 포탈 툴팁(stacking context clipping 방지). 마커 클릭 → `onMarkerClick` → 우측 로그 탭에서 해당 entry로 스크롤(`useScrollToEntry` 훅 — CSS.escape + 필터 리셋 후 재시도 + `scrollIntoView`). `VideoPlayer`는 커스텀 플레이어(재생/일시정지/다운로드 + 이슈 제목·키 오버레이).

**issueUrl 주입**: `buildLogsHtml`이 meta 마지막에 빈 `issueUrl:""` 예약. 이슈 생성 후 `injectIssueUrl`이 해당 자리만 치환(청크 단위 btoa로 ~20MB 블로킹 회피). Jira·Linear는 생성 후 주입, Asana는 create가 upload보다 먼저라 업로드 직전 주입, GitHub·Notion은 구조상 불가(빈 값 → 뷰어가 링크 숨김).

**handleStartVideo**: `injectNetworkRecorder` → `clearNetworkRecorder` → `startRecording` 순. 녹화 종료(`recording→drafting`) 시 `recordersStopped=true`로 drafting 중 재주입 차단.

**정리**: `shouldPreserveBackgroundLogs(phase)` = recording/drafting/previewing/done. idle 전환 시 레코더 재주입+새 sentinel. pending IDB는 탭 종료·이슈 저장·고아 정리(`pruneOrphanPendingLogsOncePerSession` — SW 부트 세션당 1회)에서 회수. clear→setSentinel은 sequential await 강제(fire-and-forget 시 Chrome 메시지 큐 순서 미보장으로 race).

## 30s Replay (직전 30초 캡처)

`src/sidepanel/30s-replay/`. 수동 녹화와 별개 경로 — "녹화 버튼을 누르기 전 30초"를 사후에 건지기 위한 look-back 캡처.

**권한**: `captureVisibleTab`은 `activeTab` 또는 광역 host permission 요구. activeTab은 cross-document 네비게이션에서 회수되고 프로그램적 재취득 불가 → 30s Replay는 `optional_host_permissions`의 `https://*/*`+`http://*/*`를 **런타임 요청**해 획득 (설정 Switch ON 시 1회 동의, Chrome 영구 저장).

**사이드 패널 종료/유지 정책** — `deactivatePanelIfCrossOrigin`가 `tabs.onUpdated` `status:loading`에서 origin 비교. 기준 URL: 에디터 세션 `target.url` 우선 → 활성화 시점 저장 URL → 둘 다 없으면 패널 유지.

| 조건 | 동작 |
|---|---|
| **same-origin** | 패널 유지. 비보존+page key 변경 시 stale 세션 제거 |
| **cross-origin + 비보존** (idle 포함) | 패널 닫기 + 세션 제거 |
| **cross-origin + 보존** (drafting/previewing/done/video) | 패널 유지, `activeTabExpiredDeferred` → idle 복귀 시 만료 다이얼로그 |

보존 → idle 사이 "좀비 구간"에서 캡처 시도 시 3중 방어(진입 `classifyTabSupport` / 런타임 `isActiveTabPermissionError` / tabCapture `isTabCaptureUnavailable`)가 즉시 만료 다이얼로그.

**버퍼링**: `use-30s-replay` 훅이 `enabled && phase==="idle" && tab.active`일 때 600ms 간격(Chrome `captureVisibleTab` 쿼터 초당 2회 이내) `captureVisibleTab`(jpeg q80) → `FrameBuffer`. **개수 cap(60) + 시간 cap(30s) 이중 제한**. `MIN_READY_FRAMES`(10) 이상이면 `isReady`. 진행 표시는 1초 벽시계 타이머(`now − oldestTimestamp`)로 갱신. 페이지 네비게이션과 무관하게 유지(이전·새 페이지 프레임 혼합은 의도).

**인코딩**: `capture()` → `frameBuffer.snapshot()` → `encodeToMp4()`(WebCodecs H.264 codec 후보 순차 탐색 + `mp4-muxer`) → 성공 시 `onRecordingComplete(blob, thumbnail, viewport)` 재사용 (`captureMode: "video"`).

**상태 공유**: `replay-context.ts`의 `ReplayProvider`가 `isReady`/`isEncoding`/`capture`를 EmptyState에 공급.

## chrome.scripting.executeScript MAIN world 주입 규칙

`executeScript({ world: "MAIN", func })`의 `func`는 직렬화 후 페이지에서 **재평가**. SW 모듈 스코프 클로저는 살아남지 않음 — 모듈 헬퍼 참조 시 `ReferenceError`.

규칙: 주입 함수는 **self-contained**. 헬퍼는 nested inline하거나 인자로 전달. 글로벌(`fetch`/`FormData` 등)과 인자만 사용 가능.

현재 사용처: `github-upload.ts:pageBatchUploadFn`. TypeScript·단위 테스트 모두 직렬화 경계를 못 잡으므로 **inject 경로 리팩터 시 실제 탭 수동 회귀 필수**.

## DOM 트리 Lazy Load

DOM 트리 Dialog는 전체 DOM 직렬화 시 프리즈 → 두 단계:

1. **초기 (`picker.describeInitial`)**: body→선택 요소까지 조상 경로 + 각 레벨 sibling만
2. **온디맨드 (`picker.describeChildren`)**: 노드 펼칠 때 자식만 추가 로드 → `injectChildren`으로 머지

`childCount > 0 && children === undefined`면 미로드 상태, 토글 시 fetch. 한 번 로드한 자식은 캐시.

## 마크다운 복사 (Preview)

Jira는 붙여넣기 시 **ProseMirror가 HTML을 해석**하므로 `ClipboardItem`으로 `text/plain`(GFM) + `text/html` 둘 다 쓴다. base64 이미지는 Jira sanitize 대상이라 클립보드 출력에서 **제외**.

구현: `buildIssueMarkdown()` + `buildIssueHtml()` 페어 (`src/sidepanel/lib/buildIssueMarkdown.ts`).

## 이슈 섹션 구성

사용자 입력 섹션 4종(`DEFAULT_ISSUE_SECTIONS` in `settings-ui-store`). 배열 순서 = 출력 순서.

| id | 기본 enabled | renderAs |
|---|---|---|
| `description` (발생 현상) | ✅ | paragraph |
| `stepsToReproduce` (재현 과정) | ✅ | orderedList |
| `expectedResult` (기대 결과) | ✅ | paragraph |
| `notes` (비고) | ⬜ | paragraph |

draft 모델: `{ title, sections: Record<string, string>, environment?: EnvironmentRow[] }`. `stepsToReproduce`는 `OrderedListEditor` 전용 UI, 나머지는 Textarea.

**재현 환경**: `ReproEnvironmentSection`이 모드별 메타를 readonly 표시 + `draft.environment` 사용자 정의 row 편집. 순수 헬퍼: `filterEnvironmentRows`(빈 row 제거) / `deriveReadonlyEnvRows`(모드별 파생).

**자동 메타 위치**: `POST_MEDIA_SECTION_IDS = {"expectedResult","notes"}` — 첫 해당 섹션 직전에 media/styleChanges emit. 둘 다 disabled면 모든 섹션 끝에 emit. 5종 빌더 + DraftingPanel + DraftDetailDialog에서 동일 룰. PreviewPanel·log-viewer Report 탭 프리뷰는 순수 헬퍼 `composePreviewLayout`로 이 순서를 단일화(`IssuePreviewView` 공용 컴포넌트).

**복수 element 직렬화(styleChanges)**: 한 이슈에 여러 요소의 스타일 변경을 담을 수 있다. `mergeStyleElements`(in `buildIssueMarkdown`)가 버퍼(`bufferedElements`) + 현재 요소를 selector 기준 dedup·재인덱싱해 단일 배열로 만들고, 6개 플랫폼 빌더가 모두 이 배열을 순회해 element별 섹션(selector 소제목 + before/after 스냅샷 + diff 테이블)을 emit한다. 이미지 파일명은 배열 인덱스 단일 출처(`before-${i}`/`after-${i}.webp`) — 본문 빌더·`buildCaptureFiles`·Jira `injectSnapshotRows`(ADF 후처리)가 같은 인덱스를 공유해 오귀속을 막는다. 플랫폼별 렌더 차이는 어댑터 패턴대로(Jira는 ADF table에 Snapshot 행 splice, Notion은 Before/After heading 분리, Asana는 As is/To be 섹션). element 모드는 **diff 필수** — 현재 요소에 스타일 변경이 없어도 버퍼에 담긴 요소가 있으면 진행 가능하고, 현재·버퍼 둘 다 비면 drafting 진입을 막고(`hasStyleChange` 게이트 + 버퍼 체크) 요소 캡처(element-screenshot) 모드로 안내한다. 스타일링 패널의 "변경사항 초기화"는 현재 + 버퍼 전체를 페이지 DOM까지 원복(`picker.resetAllEdits` → content `restoreAll`).

**마이그레이션**: `issues-store` v5, `settings-store` v6, `settings-ui-store` v5. 각각 순수 헬퍼로 분리해 테스트 (`migrateV2ToV3`, `migrateToV5`, `migrateIssueToV4` 등). 모두 멱등 가드 + sparse 저장. 빈 paragraph는 `(없음)` (`md.noValue`)로 통일.
