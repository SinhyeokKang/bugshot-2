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

같은 함정이 **화면 녹화의 `getDisplayMedia`**에도 적용된다(transient user activation 요구). `startScreenCapture`(`video-capture.ts`)는 **getDisplayMedia를 첫 await로** 호출하고 `chrome.tabs.get`·레코더 activate를 그 뒤로 미룬다 — 앞에 다른 await를 두면 activation이 만료돼 picker가 안 뜬다. 탭 녹화(`startVideoCapture`)도 같은 이유로 `startTabStream`(`getMediaStreamId`+`getUserMedia`)을 **첫 await로** 호출하고 레코더 준비를 그 뒤로 미룬다. tabCapture는 activeTab 기반이라 사이드패널에서 cross-origin 이동 후엔 invoke가 회수돼 막히는데(Chrome은 패널 열기를 activeTab 부여로 인정 안 함), 이때 `startScreenCapture(tabId, {preferTab:true})`로 자동 폴백한다 — `getMediaStreamId` 실패는 미디어 캡처 API가 아니라 activation을 소비하지 않아 폴백 picker가 정상적으로 뜬다.

## 편집 세션 영속화

- tabId별로 `chrome.storage.session`의 `editor:${tabId}` 키에 저장
- `useEditorSessionSync(tabId)` 훅이 hydration + debounced save(300ms) 담당 (zustand persist 미들웨어 대신 직접 구현 — tabId-scoped 키가 persist의 "one store, one key" 모델에 맞지 않음)
- page key 변경 시 해당 탭의 세션은 버림 (`clearIfPageChanged` in `tab-bindings.ts` — `pageKeyOf(prevUrl) !== pageKeyOf(newUrl)` 비교)
- 탭 닫히면 `onRemoved`에서 정리
- **복수 element 버퍼(`bufferedElements`)도 세션 영속화**된다. 단 phase별 보존이 비대칭: `styling`에서 세션 만료/`reset`이 걸리면 버퍼가 폐기되고, `drafting`/`previewing`/`done`은 `selection`과 동일하게 스냅샷에 포함돼 패널을 닫았다 열어도 복원된다. quota 초과 시 lite 폴백이 버퍼 내부 before/after base64까지 명시적으로 null화. `picking` 중 닫힌 세션은 hydrate 시 idle 강등과 함께 버퍼도 폐기한다(DOM 편집이 이미 원복된 ghost — 남기면 `preserveBuffer`로 다음 세션에 합류).
- **styling 세션 복원은 DOM 재바인딩까지 수행**한다. 패널이 닫히면 picker port disconnect로 페이지 편집이 전부 원복되므로 store만 복원하면 유령 세션이 된다. hydrate 시 phase=`styling`(element 모드)이면 `rebindStylingSession`(`picker-control.ts`)이 ① content script 보장 ② content 보고 URL의 pageKey 대조 ③ 현재 요소 편집 재적용(요소 소실 시 `sessionExpired`+`picker.clear`) ④ 버퍼 편집 재적용(`applyEditsBySelector` — 미등록 요소는 원본 등록 후 적용) ⑤ 현재 요소를 버퍼 경유 `selectByPath` 재선택(승격 경로가 styleEdits·baseline·이미지 복원)으로 봉합한다.
- **draft 영속화도 버퍼 전체를 포함**한다. draft로 저장하면 버퍼가 `IssueRecord.bufferedElements`(+ element별 `b${i}-before/after` 이미지 blob in `blob-db`)로 IndexedDB에 저장되고, `DraftDetailDialog` 재오픈 시 전체가 복원·재제출 본문에 모두 포함된다. `resolveDraftStyleElements`가 라이브 `mergeStyleElements`와 동일 규칙으로 병합(`useDraftStyleElements`가 이미지 로드)해 라이브 세션과 결과가 일치. `IssueRecord.bufferedElements`는 optional이라 구 draft는 자동 하위호환(단일 element). 이슈 삭제 시 `deleteImageBlobs`가 `${issueId}:` 접두사 전체를 지워 버퍼 이미지 고아를 방지.

## 플랫폼 인증

8개 플랫폼 중 7개(Jira~ClickUp)는 **수동 인증(API Token/PAT) + OAuth** 두 방식을 동시 지원한다. **Slack은 OAuth user token 전용**(BYOK·수동 인증 없음 — 메시지 앱이라 사용자가 직접 토큰을 발급하기 어려움). 저장 형태는 discriminated union (`{Platform}Auth`, `kind` 판별자). OAuth는 `chrome.identity.launchWebAuthFlow` → 인가 코드 → 토큰 교환. `is{Platform}OAuthConfigured()` 가드가 false면 OAuth UI 비활성화.

| | Jira | GitHub | Linear | Notion | GitLab | Asana | ClickUp | Slack |
|---|---|---|---|---|---|---|---|---|
| 수동 인증 | API Token (Basic) | PAT (`token <pat>`) | API Key | Internal Integration Token | PAT (`Bearer`, self-managed baseUrl) | PAT (`Bearer`) | PAT (`pk_`, raw `Authorization` — Bearer 없음) | ❌ (OAuth 전용) |
| OAuth 타입 | 3LO (confidential) | Web Flow (confidential) | PKCE (public) | Public Integration (confidential) | PKCE (public) | OAuth 2.0 (confidential) | OAuth 2.0 (confidential) | OAuth v2 user token (confidential) |
| Proxy 경로 | `/token` | `/github/token`, `/github/refresh` | ❌ 직접 교환 | `/notion/token` | ❌ 직접 교환 (gitlab.com 한정) | `/asana/token`, `/asana/refresh` | `/clickup/token` (refresh 없음) | `/slack/token` (refresh 없음) |
| Token Refresh | pre-refresh + 401 retry | hook 주입형, 1회 retry | hook 주입형, 1회 retry | ❌ (토큰 만료 없음) | hook 주입형, pre-refresh + 401 retry | hook 주입형, pre-refresh + 401 retry | ❌ (토큰 만료 없음) | ❌ (토큰 만료 없음) |
| dev/prod 분리 | 단일 App | 2 App (callback URL 1개 제한) | 단일 App (multi redirect) | 단일 App (multi redirect) | 단일 App (multi redirect) | 단일 App (multi redirect) | 단일 App (multi redirect) | 단일 App (multi redirect) |
| Env var | `VITE_ATLASSIAN_CLIENT_ID` | `VITE_GITHUB_CLIENT_ID` (+`_PROD`) | `VITE_LINEAR_CLIENT_ID` | `VITE_NOTION_CLIENT_ID` | `VITE_GITLAB_CLIENT_ID` | `VITE_ASANA_CLIENT_ID` | `VITE_CLICKUP_CLIENT_ID` | `VITE_SLACK_CLIENT_ID` |

공통 env: `VITE_OAUTH_PROXY_URL` — Cloudflare Worker origin (Jira·GitHub·Notion·Asana·ClickUp·Slack 공유). proxy origin fetch는 required `<all_urls>`가 커버하므로 manifest `host_permissions`에 별도 추가하지 않는다.

Slack은 메시지 앱이라 어댑터 공통 패턴에서 갈리는 지점이 있다: OAuth user token은 응답의 **`authed_user.access_token`**에서 추출(최상위 `access_token`=bot 토큰 아님), 에러는 HTTP 200 + **`ok:false`** 패턴이라 `slackFetch`가 status가 아닌 `ok`로 분기(`SlackError`), 전송은 **제목=부모 메시지 / 본문·첨부=스레드 답글**(`postMessage` thread_ts), 파일은 **2-step 업로드**(`getUploadURLExternal`→PUT→`completeUploadExternal`), 상태가 없어 폴링 없는 정적 "전송됨" 배지.

**왜 proxy가 필요한가**: confidential client는 `client_secret` 요구 — 확장에 비밀키를 번들할 수 없으므로 Worker가 `code↔token`·`refresh↔token` 교환만 중계. Linear·GitLab은 public client(PKCE)라 proxy 불필요. Asana는 native 앱 모드가 OOB redirect만 허용해 custom redirect(`chromiumapp.org`)를 쓰려면 confidential일 수밖에 없어 proxy 경유한다.

**GitLab self-managed**: OAuth는 `gitlab.com` 고정(host 접근은 `<all_urls>` 커버). PAT는 임의 self-managed 인스턴스 URL(`gitlabInstanceUrl.normalizeInstanceUrl` — gitlab.com은 https 강제) 지원하며, 연결 시 `requestHostPermission(baseUrl)` 호출(required `<all_urls>`에 이미 커버돼 즉시 grant — 프롬프트 없음). GitLab은 업로드→이슈생성 순서라 logs.html에 이슈 역링크를 사전 주입 불가 → 생성 후 `injectIssueUrl` 재업로드 + `gitlab.updateIssueDescription`(description PUT)으로 보강(실패는 격리).

**Asana**: REST·authorize는 `app.asana.com` 고정, token 교환은 proxy(`/asana/token`·`/asana/refresh`) 경유. 응답은 `{ data }` 래핑이라 `asanaFetch`가 언랩. html_notes는 인라인 이미지를 지원하므로(`<img data-asana-gid>`) **create → upload → updateTaskNotes** 2-write로 본문에 이미지를 임베드한다(첨부 후 GID 참조라 순서 강제). 캡처 이미지(As is/To be)뿐 아니라 에디터 본문에 붙여넣은 인라인 이미지(`inlineImages`, 본문 src `inline:refId`)도 같은 경로로 업로드·임베드한다. 단 Asana는 webp 인라인을 지원하지 않아 업로드 전 webp→jpeg로 폴백 변환하고, 작게 렌더되지 않도록 `src`(view_url)+`data-src-width/height`+`style`을 채운다. element 비교는 As is/To be 섹션(이미지+속성값)으로 배치(테이블은 `<pre>` 폴백이라 셀 이미지 불가). 영상·로그·메타는 인라인 불가라 task 첨부 영역에만 둔다(본문에 파일 리스트 미표기). logs.html은 createTask가 upload보다 먼저라 업로드 직전 `injectIssueUrl(task.permalinkUrl, task.gid)`로 백링크·key를 주입해 1회 업로드로 끝낸다(GitLab식 재업로드 불필요). refresh_token은 비회전이라 갱신 응답에 없으면 기존 토큰 유지.

**ClickUp**: REST는 `api.clickup.com/api/v2` 고정, authorize는 `app.clickup.com`(host_permission 불필요 — launchWebAuthFlow 처리), token 교환은 proxy(`/clickup/token`, confidential) 경유. **PAT/OAuth 모두 raw token 헤더**(`Authorization: <token>`, Bearer 접두사 없음 — Asana와 다름, `clickupAuthHeader`). **토큰 만료가 없어 refresh hook 자체가 없다**(Notion 유사) — 401은 곧 권한 박탈이라 `clickup.oauthRevoked` 재연결 에러로 직행. 본문은 `markdown_content`를 1급 지원하므로 HTML 변환 없이 markdown을 그대로 전송. 대상은 **Workspace → Space → List 3단계 종속**(task는 `list_id` 필수, 다른 플랫폼은 1~2단계) — List는 folderless list + folder 하위 list를 `flattenLists`로 평탄화해 한 콤보박스로 합친다. 완료 상태는 boolean이 없고 List별 커스텀 status라 `setTaskCompleted`가 list statuses에서 done/non-done type을 매핑해 PUT한다.

**Refresh 실패 → 재인증**: refresh token 무효화 시 `OAuthError({ platform })` → BG `onOAuthExpired(platform)` → App.tsx AlertDialog 재인증 안내. GitHub은 OAuth App "Token expiration" OFF면 refresh token 미발급 → 즉시 재인증 안내. **OAuthError 분기**: `{ platform, cancelled }` → BG가 `body.platform`/`oauthCancelled`/`oauthRefreshFailed` 플래그 직렬화. 정규식 매칭 금지 — `isOAuthCancelled`/`getOAuthErrorPlatform` 헬퍼 사용.

## 플랫폼 어댑터 패턴

`PlatformId = "jira" | "github" | "linear" | "notion" | "gitlab" | "asana" | "clickup" | "slack"` union (`src/types/platform.ts`).

- **저장**: `useSettingsStore.accounts` dict + `lastSubmitFields: Record<PlatformId, ...>` + 전역 `titlePrefix`.
- **메시지**: bg `{platform}.*` namespace 분기. `BgRequest` exhaustive switch 누락 검증. 새 타입은 `BG_REQUEST_TYPES` Set에도 등록.
- **API 어댑터**: `{platform}-api.ts`. 401 처리 — Jira: 즉시 refresh, GitHub·Linear·GitLab·Asana: hook 주입형(module side-effect 재등록), Notion·ClickUp·Slack: 즉시 throw(만료 없음 → refresh 없이 재연결). Slack은 status가 아닌 `ok:false`(HTTP 200+실패) 패턴이라 `slackFetch`가 `ok` 필드로 분기해 `SlackError`(`token_revoked`/`invalid_auth` 등)를 던진다.
- **이슈 상태 변경**: `statusBadges/SubmittedBadge` → 플랫폼별 read-only / Popover 상태 변경 분기.
- **본문 빌더**: `buildIssueAdf`(Jira), `buildIssueMarkdown`/`buildIssueHtml`(클립보드), `build{Github|Linear|Notion|Gitlab|Asana}IssueBody`. 모두 `MarkdownContext` 입력 → `NormalizedSubmitResult { key, url }` 통일. (GitLab은 github 빌더 계열 — DOM raw selector·before/after 표. Asana는 markdown 본문을 `markdownToAsanaHtml`로 html_notes subset 변환.)
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

비동기 영향: `picker.collectTokens` 등 메시지 핸들러가 `await ensureCssCacheLoaded()`. content script는 `return true` + IIFE 패턴.

**cross-origin 보강 (병렬 경로)**: cross-origin stylesheet는 `cssRules` 접근이 `SecurityError`라 same-origin 정렬 경로에 못 끼운다. content(ISOLATED)는 직접 fetch도 불가(CORS)하므로, **background가 raw CSS를 대신 fetch**한다 — `ensureCrossOriginLoaded()`가 `collectCrossOriginHrefs()`로 타 origin `<link>` href를 모아 `css.fetchSheets` RPC(`background/messages.ts:fetchCssSheets`, `<all_urls>` CORS 우회)로 위임. background는 **SSRF 가드**(`lib/ssrf-guard.ts:isFetchableSheetUrl` — loopback·사설·link-local·IPv6 ULA·IPv4-mapped 차단)를 통과한 공개 http(s) 호스트만 `credentials:omit`·`redirect:manual`·2MB 캡으로 읽는다. 받은 텍스트를 `parseStylesheet`로 파싱 → `indexCrossOriginRules`가 seq 부여 + `:root`/`html`/`*`의 `--*`를 customProps로 분리 → `getMatchingCrossOriginRules(el)`가 `el.matches(selectorText)`로 매칭(throw는 rule별 skip) → `css-resolve.ts:mergeCrossOriginDecls`가 **빈 specified prop만** 채운다(same-origin·inline 우선, source = selectorText). 멱등(`crossLoadPromise`)이고 `invalidate()`에서 함께 초기화. picker는 `ensureCrossOriginLoaded` 완료 후 **2차/3차 `picker.selectionUpdated`**를 비동기 발화하며, payload selector ≠ 현재 선택이면 무시하는 stale 가드(picker `selectedEl !== el` 재확인 + store `updateSelectionStyles` selector 비교)로 늦은 보강이 타 요소를 오염시키지 않게 한다. 여전히 못 잡는 케이스: SSRF 가드 차단·네트워크 실패로 fetch 불가한 sheet(조용히 computed fallback).

## 백그라운드 로그 캡처 (Network / Console / Action)

`src/content/recorders-entry.ts`를 MAIN world `document_start`로 등록해 fetch/XHR/sendBeacon/WebSocket/console/사용자 액션을 자동 wrap. 페이지 스크립트보다 먼저 실행되므로 Sentry 등이 `originalFetch` 캐싱 전에 wrap 설치. **선행 전제 — 동기 IIFE emit**: 이 "먼저 실행"은 recorders-entry 청크가 crxjs에 의해 동기 IIFE로 emit돼야 성립한다(crxjs 조건: 청크의 static import·dynamic import·export가 0인 self-contained). 청크가 외부 import를 끌어들이면 crxjs가 async-import loader로 되돌려 후크가 페이지 인라인 스크립트보다 늦게 깔리고 pre-arm(아래 활성 게이트)이 무력화된다 — 그래서 레코더는 `content/log-throttle.ts`를, 사이드패널 수신부는 복제본 `sidepanel/lib/trailing-throttle.ts`를 쓰도록 의도적으로 분리한다(`log-persist-guard`가 `@/content/log-throttle`을 import하면 공유 청크화). 리팩터 시 청크에 외부 static import 유입 금지(회귀).

**iframe 커버리지**: 로그 레코더는 picker(`picker.ts`, top frame 한정)와 분리된 별도 content_scripts 2개로 **모든 프레임**(`all_frames: true`)에 주입한다 — `recorders-entry.ts`(MAIN, 후크 본체)와 `recorder-bridge.ts`(ISOLATED, sentinel 수신·`recorder.*` data를 `chrome.runtime`으로 중계). 각 프레임 레코더는 entry를 자기 프레임의 `pageUrl: location.href`로 스탬프 → cross-origin iframe(Stripe·임베드 위젯 등) 로그도 캡처된다. (sentinel·data가 MAIN world CustomEvent로 오가므로 페이지 스크립트가 자기 탭 로그를 위조 주입할 수는 있다 — 영향 범위는 해당 탭 로그 무결성 한정.) `picker.ts`에 있던 인라인 로그 브리지는 이 파일로 추출됨. `webNavigation.onCommitted`(iframe `frameId !== 0`) 시 `picker-control.ts:rebroadcastSentinelsToFrame`가 그 프레임에만 sentinel을 재발행해 늦게 뜬 iframe도 활성 세션에 합류(setSentinel은 `recording=true`만 켜고 버퍼는 비우지 않아 재수신 안전). origin은 entry `pageUrl`에서 `originOf()`로 런타임 파생(데이터 모델 불변) — ① cap evict 시 `mergeLogItems`의 `topOrigin` 인자로 top-page-origin을 우선 보존(cross-origin = 주로 광고 iframe부터 oldest evict; **console/network만** — action은 광고가 폭증시키지 않아 순수 FIFO 유지로 `topOrigin` 미전달), ② 로그 탭에 출처별 필터(`OriginFilterBar`, console/network/action 공용, origin 2개+ 일 때만 노출). opaque(`data:`/`about:blank` → `originOf`가 `"null"`) 출처는 필터에서 `UNKNOWN_ORIGIN` 한 그룹으로 묶는다.

**활성 게이트 (capturing vs recording 2단)**: 적재 게이트는 `recording`이 아니라 `capturing`이다. 두 플래그를 분리한다 — `capturing`(버퍼 적재 여부)과 `recording`(사이드패널 dispatch/전송 여부). `recording` 기본값은 `false`이고 `setSentinel`로 `true`(패널 주입 시), 패널 닫힘(`port.onDisconnect`)·탭 전환(`tab-bindings.ts` `onActivated`에서 직전 활성 탭에 stop)으로 `false`. `capturing` 초기값은 **pre-arm 플래그**다 — 각 레코더가 init에 `readPreArmFlag()`(`recorder-prearm.ts`, sessionStorage `__bugshot_recorder_active__`)로 초기화해, **한 번이라도 armed된 origin(active origin)이면 sentinel 도착 전 document_start부터 버퍼 적재를 시작한다**(로드 초반 로그 캡처). `setSentinel`은 `capturing=true` + `setPreArmFlag()`(이후 same-origin reload에서 재-pre-arm), `stop`은 `recording=false`+`capturing=false`이되 **sessionStorage 플래그는 유지**(reload 시 새 world가 다시 pre-arm). sentinel 전 적재분은 `entry.preArm=true`로 마킹된다 — dispatch는 sentinel 없으면 no-op이라 사이드패널 전송·IndexedDB 저장은 안 되고 메모리 버퍼에만 쌓이며, 다음 arm 시 소급 flush된다. `capturing=false`면 fetch는 `createPatchedFetch`의 `() => capturing` 게이트로 원본 경로(`new Request` 재구성 없음), XHR/sendBeacon/console/action은 push 차단 — pre-arm 아닌(미armed) origin·미활성 탭 트래픽에 일절 간섭하지 않는다. 같은 탭으로 (네비게이션 없이) 복귀해 패널 문서가 살아 있으면 패널 `visibilitychange`(visible)가 재주입을 트리거해 stop과 대칭을 맞춘다.

**페이지 무간섭(예외 격리)**: 세 레코더는 MAIN world에서 페이지와 같은 전역을 공유하므로 wrap이 페이지 동작을 절대 깨뜨리면 안 된다. 불변식 — ① 원본(fetch/XHR/`console.*`/`history.pushState·replaceState`)을 **먼저** 호출해 페이지 동작 보존, ② 기록 로직의 throw는 try/catch로 격리해 페이지 호출자로 전파 금지(`createPatchedFetch` record/settle, XHR `recordXhrSend`, console wrap의 `safeStringify`, action history wrap 모두 격리), ③ 응답 본문 read는 settle을 await하지 않음. 특히 `safeStringify`는 페이지 값의 throwing getter·커스텀 `toString`/`Symbol.toPrimitive`·Proxy trap에도 `[unserializable]`로 흡수해 wrap된 `console.log`(=페이지 코드)가 throw하지 않게 한다. 리팩터 시 이 3원칙을 깨면 페이지 요청·라우팅·콘솔이 깨질 수 있다(과거 fetch `new Request` 재구성이 GitHub 업로드·SigV4를 깬 회귀 전례).

**버퍼 전략**: 활성 구간 동안 적재. 메모리 보호 — Network: 50MB body cap(LRU trim) + 5000 entry FIFO, Console: 2000 entry FIFO, Action: 1000 entry FIFO, WebSocket: 연결당 1000 프레임 FIFO. 요청 phase: send 시 `pending`, 응답 완료 `complete`, reject/abort/error/timeout 시 `error`로 in-place 갱신. 추가 캡처: `sendBeacon`, fetch reject, XHR error/abort/timeout, WebSocket 프레임.

**Body omission**: `string | NetworkBodyOmission` union. kind: `truncated`(3MB 초과), `binary`(image/font 등), `stream`(SSE/multipart), `omitted`(LRU 회수). UI·logs.html 모두 사유 표시.

**WebSocket 프레임**: `window.WebSocket` **생성자만** Proxy(`construct` trap)로 후킹하고 인스턴스 `send`는 직접 wrap(기존 후킹은 직접 치환 — Proxy는 생성 가로채기에만 신규 도입). 연결을 `NetworkRequest` 엔트리 1개(status 101, method `"WS"`, `webSocket: WebSocketMeta`)로 매핑하고 프레임을 `webSocket.frames[]`에 적재 — `direction`(send/receive/open/close)·`ts`·`data`·`size`. **텍스트 프레임만** 캡처(`classifyWsFrameData`가 바이너리 ArrayBuffer/Blob/TypedArray를 null로 드롭하고 `framesTotal`만 증가), 본문은 `BODY_CAP`(3MB) truncate + 기존 `maskBody`로 마스킹. 연결당 프레임 캡(`MAX_WS_FRAMES_PER_CONN`=1000) FIFO 초과 시 `WS_FRAMES_CAPPED` 경고. **전역 50MB MEMORY_CAP eviction에는 미합류**(수용된 한계 — 프레임 수 캡·본문 캡·엔트리 캡으로만 bound). UI는 연결=목록 행 + 상세 Messages 탭(`MessagesPanel` — 방향 필터·`framesTotal`−보유 dropped 배지), `buildHar`는 WS 엔트리를 `_resourceType:"websocket"` + `_webSocketMessages`(send/receive 데이터 프레임만)로 export.

**Console wrap 범위**: `log/info/debug` + `trace/assert/dir/table/group*/count*/time*`는 상시 wrap. **`error/warn`은 arm 구간에 한정해 wrap** — wrap 함수가 콜스택에 끼면 Chrome이 확장 attribution해 `chrome://extensions`에 페이지 라이브러리 경고가 누적되므로 오염 창을 arm 스코프로 좁힌다. arm 트리거는 둘 — `setSentinel`(명시적 arm) 또는 **pre-arm(active origin이면 document_start부터, `installEwWrap`)**. 멱등(`ewState.installed`)이라 중복 설치는 no-op. 복원은 `stop`(`restoreConsoleWrap`) + sentinel 미도착 케이스 보강으로 `pagehide`에서도 원복(멱등이라 중복 안전). 진짜 에러는 `window.addEventListener("error")`/`unhandledrejection`/`console.assert`로 별도 캡처.

**액션 레코더**: click/input/change(input/toggle/select)/keydown(keypress)을 capture-phase에서, `pushState`/`replaceState` 래핑 + `popstate`/`hashchange`로 네비게이션 기록. 클릭은 가까운 interactive 요소로 정규화, accessible name과 implicit role을 **분리 저장** — 자연어 문장 조립은 뷰어(`ActionLogContent`)의 i18n 레이어가 담당. 입력은 같은 selector 연속 dedup. checkbox/radio는 click 대신 change로 toggle 1회만(이중기록 방지), `<select>`는 select kind. keypress는 단축키·특수키 조합만(인쇄 문자·IME 조합 제외). **민감 필드 마스킹**: `shouldMaskField`가 type=password, autocomplete 힌트, 필드명 키워드(`password|secret|card|cvv|ssn|token` 등)로 판별해 `***` 치환. 녹화 bind(`setSentinel`) 시 현재 페이지 진입 `load` 네비게이션을 1회 보충(`entryNavOnBind`, `entryNavEmitted` 가드로 중복 방지) — pre-arm 적용 origin이면 document_start의 load가 `capturing=true`라 이미 적재돼 `entryNavEmitted=true`가 되므로 보충을 스킵하고, 미armed origin이라 load가 버려진 경우에만 1회 합성해 cross-origin 진입 자취 소실을 메운다.

**드래그 캡처(precision-first 2경로)**: drag kind는 신뢰 가능한 신호만 자신 있게 기록한다. **포인터 휴리스틱(source-only)** — `pointerdown`/`pointermove`/`pointerup`(capture)에 `exceedsDragThreshold`(제곱 거리 > `DRAG_THRESHOLD_PX=15`²) 임계, `pointerup`의 `elementFromPoint`는 **가드 전용**(끝 요소가 source와 다른가·자체 UI 아님·텍스트 선택 아님 — 팬·스크롤·슬라이더·텍스트선택 제외)으로만 쓰고 그 노드를 target으로 **기록하지 않는다**(dnd-kit·rbd가 포인터 아래 띄우는 드래그 고스트/portal을 `elementFromPoint`가 맞혀 드롭존을 오인하므로). `recordDrag(source)` 후 `suppressNextClick`으로 드래그가 합성한 click 1회를 삼킨다(매 `pointerdown`에서 리셋해 1제스처 한정). **네이티브 HTML5 DnD(source+target)** — `dragstart`에서 source를 `pendingNativeDrag`로 보류, `drop`의 `e.target`(브라우저가 셋팅한 신뢰 가능 드롭존)을 target으로 `recordDrag(source, target)`, 드롭 없는 `dragend`는 폐기. **중복 방지 핵심**: 네이티브 드래그 시작 시 브라우저가 `pointercancel`을 발화하므로 그 핸들러가 `dragCandidate`를 클리어해 포인터 경로를 무효화 → 네이티브 경로만 살아남는다. 즉 **`dragTarget` 존재 여부 = 신뢰 신호**(있으면 검증된 드롭존, 없으면 source-only)이며, summary/JSON/마커가 일관되게 이 유무로 분기(source-only는 `(drop target unknown)`으로 AI 목적지 환각 차단). endpoint 기술 `describeNode`는 recordClick 인라인 로직을 재사용하되 `closest` interactive 승격은 제외(실제 드래그된/드롭된 원소를 그대로).

**스트리밍 throttle**: 레코더는 버퍼를 모았다 nav 시점에만 보내지 않고, entry 발생 시 `createTrailingThrottle`(레코더는 `content/log-throttle.ts`, `FLUSH_INTERVAL_MS=200`)로 사이드패널에 **연속 stream**한다 — trailing throttle이라 로그 폭주 중에도 flush가 무한정 밀리지 않고 최대 200ms마다 1회 보장. (수신부 IDB 가드는 동일 구현의 복제본 `sidepanel/lib/trailing-throttle.ts`를 쓴다 — 위 "동기 IIFE emit" 제약 때문에 의도적 분리.) `setSentinel`은 `if (buffer.length) throttle.schedule()`로 **pre-arm 초반 버퍼를 bind 직후 소급 flush**한다. 떠나는 페이지의 마지막 꼬리는 `pagehide`/`visibilitychange(hidden)`에서 `flushNow`로 즉시 비운다. 이로써 nav 직전 동기 sync 1회에 의존하던 꼬리 손실을 줄인다(log-tail-reliability). network의 in-place phase 갱신(pending→complete/error)은 schedule을 안 켜도 다음 push·flush가 흡수(id dedup).

**수신부 IDB 가드**: 사이드패널은 store set(메모리)은 매번, IndexedDB write는 `createLogPersistGuard`(`log-persist-guard.ts`, ~1s trailing throttle)로 묶어 "마지막 push payload"만 저장. **save 실패(sync throw·reject·blob-db의 false resolve) 시 `pending`을 비우지 않아** 다음 push/flush에서 재시도(c3d87e5 회귀 수정). 30s replay trim 경로는 `discard()`로 대기 payload를 폐기해 trim 경계 밖 로그의 IDB 부활을 막는다.

**Cross-page 누적**: 네비게이션을 넘어 로그 누적. `mergeLogItems`가 id dedup + 시간 정렬 + maxEntries FIFO trim(topOrigin 주어지면 cross-origin 우선 evict — iframe 커버리지 항목 참조). `onCommitted` 시점에 `shouldClearLogs`로 초기화 판정 — cross-origin 또는 reload 시 리셋, same-origin 내부 이동은 보존. 단 사이드패널 `logClear` 핸들러가 `shouldPreserveBackgroundLogs(phase)`(recording/drafting/previewing/done)로 가드 → **녹화 중 cross-origin 이동도 로그를 유지**(진행 중 캡처가 페이지를 가로지른 한 세션이므로). `isLogFrozen(phase)` = drafting/previewing/done일 때 머지 동결.

**Freeze/Settle**: freeze 전환 직전 `syncAndSettleLogs`가 sync 후 반영 대기(store `endedAt` 증가 감지, 상한 300ms)해 진입 직전 로그를 고정. 30s replay는 settle 후 프레임 버퍼 구간으로 추가 trim.

**Cross-tab 격리**: `usePickerMessages`가 `sender.tab?.id !== myTabId`인 메시지 drop — 동일 origin 다른 탭의 로그가 섞이는 것 방지.

**로그 첨부**: `buildLogsHtml`(async)이 `dist-log-viewer/index.html` 템플릿에 데이터 주입 → self-contained HTML. 용량 최적화로 무거운 데이터(networkLog/consoleLog/actionLog/video/screenshot/report)는 gzip+base64(`gzip-base64.ts`)로 압축해 `__BUGSHOT_DATA__` 태그에, 작은 meta는 평문 `__BUGSHOT_META__` 태그에 분리 주입(제출 후 `injectIssueUrl`은 평문 meta만 함수형 치환 — 압축 blob 미접근). har/console·actionLogJson 등 파생 export는 raw 로그에서 다운로드 시점에 즉석 생성(중복 직렬화 회피, `meta.version` 사용). log-viewer는 Console/Network/Action 외 **Report 탭**(이슈 제목·재현 환경·본문 섹션 프리뷰 + 마크다운/HTML 클립보드 복사)을 추가 제공 — 본문은 `buildReportData`가 inline 이미지를 dataURL로 resolve해 임베드, 표시는 `IssuePreviewView`(PreviewPanel과 공용). AI 초안 `buildActionLogSummary`도 video 한정.

**로그 정책 매트릭스** — 단일 진실: `src/sidepanel/lib/captureLogSupport.ts` (`supportsConsoleNetworkLog`, `supportsActionLog`). UI 카드 표시(PreviewPanel·DraftDetailDialog `LogAttachmentCards`) / DraftDetailDialog blob 로드 / 제출 첨부(`buildCaptureFiles` → logs.html 생성 조건) / Notion 본문 log summary 블록 모두 이 기준.

| 캡처 모드 | console | network | action | 첨부 토글 기본값 |
|---|---|---|---|---|
| element | ❌ | ❌ | ❌ | — |
| screenshot | ✅ | ✅ | ❌ | on (자동) |
| freeform | ✅ | ✅ | ❌ | on (자동) |
| video | ✅ | ✅ | ✅ | on (자동) |

로그 첨부 토글은 network/console/action **3종 분리**(`networkLogAttach`/`consoleLogAttach`/`actionLogAttach` + setter 3개). `initial`은 모두 false지만 캡처 모드 진입 액션(`startCapturing`/`startElementShot`/`startFreeform`/`onRecordingComplete`)이 진입 시 3종을 **일괄 true로 강제** — `...preserveLogs(prev)`로 직전 로그 *데이터*는 승계하되, 그 뒤 명시 `true`가 토글 값을 덮으므로 screenshot·freeform·video 모두 기본 on. 지원되지 않는 로그(screenshot·freeform의 action)는 토글이 true여도 `supportsActionLog` 게이트로 실제 첨부·UI 노출에서 빠진다. element 모드는 로그 미지원이라 토글 자체가 무의미.

**사용자 파일 첨부**: 캡처물과 별개로 사용자가 로컬 파일을 직접 첨부할 수 있다(`AttachmentSection`/`AttachmentList`, captureMode 무관). 메타는 editor-store `attachments: UserAttachmentMeta[]`, 바이트는 blob-db(`saveAttachmentBlob`). 캡(`attachmentLimits.ts`) — 개수 10개·합계 50MB는 **하드캡**: `takeWithinLimits`가 store 단일 출처로 초과분을 드롭하고 사유(`count`/`total`)만 toast로 안내(대용량 다중 첨부의 base64 메모리 폭발 방지). 플랫폼 단건 한도는 **경고만**(차단 아님) — Notion 5MB·GitLab 10MB(`PLATFORM_FILE_SIZE_LIMIT`, 나머지 null), `checkAttachmentLimits`가 초과 항목을 빨간 테두리로 표시. 제출 시 `buildCaptureFiles`가 `userAttachments`를 captureMode와 무관하게 `attachments`로 합류시켜 8개 플랫폼이 모두 업로드(Slack은 스레드 답글에 2-step 업로드). draft 저장/복원의 blob 키 충돌은 `rekeyAttachmentBlobs`(+`whenAttachmentBlobsReady` in-flight 가드)로 재매핑.

**플랫폼별 패키징**:
- **Jira**: `logs.html` 그대로 첨부 → 이슈 생성 **후** `injectIssueUrl`로 뷰어 백링크 주입. 본문 로그 요약 안내의 `logs.html`은 제출 시 첨부 URL을 모르므로 업로드 후 `injectLogsLink`(`background/lib/adf-logs-link`)가 해당 em 노드에 link mark를 주입해 클릭 링크화(매칭 노드 없으면 평문 유지).
- **Linear**: `logs.html` 그대로 첨부 → 이슈 생성 **후** `injectIssueUrl`로 뷰어 백링크 주입. 본문은 업로드 전 빌드돼 `logs.html`이 평문이므로, 업로드로 assetUrl을 안 뒤 `injectLogsMarkdownLink`(`sidepanel/lib/markdown-logs-link`)로 안내 줄의 `logs.html`을 markdown 링크화하고 `linear.updateIssueDescription`(issueUpdate description)으로 본문을 패치(GitLab식 보강, 실패는 격리).
- **GitHub/GitLab**: `logs.html` 그대로 첨부 + 본문 로그 요약 안내에 markdown 링크(빌드 타임에 첨부 href를 알아 `emitLogSummary`가 `{file}`을 링크로 렌더). GitHub은 issueUrl 미주입(빈 값 → 뷰어가 링크 숨김), GitLab은 생성 후 `injectIssueUrl` 재업로드로 백링크 주입.
- **Notion**: **`logs.zip`** (DEFLATE 압축 zip 1파일 래핑, `zipLogsHtml`). Cloudflare WAF가 `POST /v1/file_uploads/{id}/send`에서 평문 HTML/로그 콘텐츠(스택트레이스·URL·SQL스러운 토큰)를 공격 페이로드로 오탐해 403 반환. store-mode zip도 내부가 평문이라 같은 사유로 막힘 → DEFLATE 압축 바이트는 평문 패턴 매칭 회피. 부수효과로 size ~30%로 줄어 무료 워크스페이스 5 MiB 한도 여유. 단계: 페이지 생성 전 업로드 → issueUrl 주입 불가(GitHub과 동일, 빈 값 → 뷰어 자동 숨김).

**영상-로그 동기화**: `LogViewerData.video`에 영상 임베드 → log-viewer가 좌(영상)/우(3탭) 분할, `LogSeekChip`으로 행↔영상 양방향 seek + active 행 하이라이트. 동기화 0점은 `video.startedAt`. props 미공급(라이브 사이드패널 서브탭)이면 칩·active 안 생겨 기존 레이아웃 불변.

**타임라인 마커**: `markers.ts:buildMarkers`가 활성 로그 탭(console/network/action)에 따라 프로그레스 바 위에 핀 마커를 생성. 마커 variant(error/warn/info/pending/navigate/default)별 색 분류. `ProgressBar` 위에 `absolute` 핀으로 렌더, 호버 시 포탈 툴팁(stacking context clipping 방지). 마커 클릭 → `onMarkerClick` → 우측 로그 탭에서 해당 entry로 스크롤(`useScrollToEntry` 훅 — CSS.escape + 필터 리셋 후 재시도 + `scrollIntoView`). `VideoPlayer`는 커스텀 플레이어(재생/일시정지/다운로드 + 이슈 제목·키 오버레이).

**issueUrl 주입**: `buildLogsHtml`이 meta 마지막에 빈 `issueUrl:""` 예약. 이슈 생성 후 `injectIssueUrl`이 해당 자리만 치환(청크 단위 btoa로 ~20MB 블로킹 회피). Jira·Linear는 생성 후 주입, Asana·ClickUp은 create가 upload보다 먼저라 업로드 직전 주입(create-first), GitHub·Notion은 구조상 불가(빈 값 → 뷰어가 링크 숨김).

**startVideoCapture** (`video-capture.ts`): `startTabStream`으로 탭 스트림을 **먼저** 획득(activeTab 시험 — 실패 시 화면공유 폴백) → 3개 레코더(network/console/action) `activate*Recorder` → `clear*Recorder`(`prepareRecorders`) → `beginTabRecording` 순. 스트림 획득과 recorder 시작을 분리해 그 사이에 레코더 준비를 끼운다(첫 await로 activation 보존 + streamId 만료 회피). 녹화 종료(`recording→drafting`) 시 `recordersStopped=true`(`useBackgroundRecorder`)로 drafting 중 재주입 차단.

**영상 캡처 2종 — tab vs screen** (`video-capture.ts` / `video-recorder.ts`): 캡처 모드는 `captureMode:"video"`를 공유하되 `recordingSource:"tab"|"screen"`(`editor-store.ts`)으로 소스만 구분한다(라벨·아이콘 분기용). 스트림 획득 이후 본문(MediaRecorder·청크·onstop·썸네일·viewport·store 전환)은 `beginRecording(stream, tabId, {source, viewportHint?})`로 공통화.
- **탭 녹화**(`startRecording` → tabCapture `getMediaStreamId`+`getUserMedia`, 720p): viewport는 onstop의 `chrome.tabs.get`.
- **화면 녹화**(`startScreenCapture` → `getDisplayMedia({displaySurface:"monitor", ≤1920×1080, 12fps})`): viewport는 track 해상도(`trackViewport`, 없으면 `{0,0}` — 다른 모니터일 수 있어 탭 크기 폴백 금지). 사용자 취소(`NotAllowedError`)는 조용한 no-op. video track `ended`(브라우저 "공유 중지")에 `stopRecording`을 바인딩하고 그 리스너를 `onstop`·`cancelRecording` 양쪽에서 정리. 60초 상한·로그 첨부는 탭 녹화와 공통(현재 탭 로그).

**정리**: `shouldPreserveBackgroundLogs(phase)` = recording/drafting/previewing/done. idle 전환 시 레코더 재주입+새 sentinel. pending IDB는 탭 종료·이슈 저장·고아 정리(`pruneOrphanPendingLogsOncePerSession` — SW 부트 세션당 1회)에서 회수. clear→setSentinel은 sequential await 강제(fire-and-forget 시 Chrome 메시지 큐 순서 미보장으로 race).

## 30s Replay (직전 30초 캡처)

`src/sidepanel/30s-replay/`. 수동 녹화와 별개 경로 — "녹화 버튼을 누르기 전 30초"를 사후에 건지기 위한 look-back 캡처.

**권한**: `captureVisibleTab`은 `activeTab` 또는 광역 host permission 요구. activeTab은 cross-document 네비게이션에서 회수되고 프로그램적 재취득 불가 → `<all_urls>`를 **required host_permission**으로 보유(설치 시 부여)해 cross-origin 캡처가 끊기지 않게 한다. (과거 `optional_host_permissions` 런타임 요청 모델은 폐기 — required 승격.)

**사이드 패널 종료/유지 정책** — `deactivatePanelIfCrossOrigin`가 `tabs.onUpdated` `status:loading`에서 origin 비교. 기준 URL: 에디터 세션 `target.url` 우선 → 활성화 시점 저장 URL → 둘 다 없으면 패널 유지. 판정은 순수 헬퍼 `resolveNavigationAction`(단위 테스트로 고정)으로 분리. `<all_urls>`가 required라 광역 권한은 항상 보유 → 호출부가 `broadGranted=true` 고정, 아래 cross-origin 행은 **새 URL의 커버 여부(http/https vs file:) 기준**.

| 조건 | 동작 |
|---|---|
| **same-origin** | 패널 유지. 비보존+page key 변경 시 stale 세션 제거 |
| **cross-origin + 커버 URL** (http/https 지원 URL) | same-origin과 동일 취급 — 패널 유지, 비보존이면 stale 세션만 제거. deferred 미발생 |
| **cross-origin + 비커버(`file:`) + 비보존** (idle 포함) | 패널 닫기 + 세션 제거 |
| **cross-origin + 비커버(`file:`) + 보존** (drafting/previewing/done/video) | 패널 유지, `activeTabExpiredDeferred` → idle 복귀 시 만료 다이얼로그 |

`<all_urls>`가 required라 광역 권한이 항상 보유 → cross-origin 이동에도 캡처가 끊기지 않으므로 커버 URL(http/https)이면 same-origin처럼 패널을 유지한다. `file:`은 지원 URL이지만 광역 커버 밖(Chrome '파일 URL 액세스' 별도 토글 필요)이라 닫힘/만료 분기를 탄다. (과거 `chrome.permissions.contains` 조회는 제거 — 미보유 분기는 `resolveNavigationAction` 순수함수 테스트의 회귀 자산으로만 남음.)

보존 → idle 사이 "좀비 구간"에서 캡처 시도 시 3중 방어(진입 `classifyTabSupport` / 런타임 `isActiveTabPermissionError` / tabCapture `isTabCaptureUnavailable`)가 즉시 만료 다이얼로그.

**버퍼링**: `use-30s-replay` 훅이 `enabled && phase==="idle" && tab.active`일 때 600ms 간격 `captureVisibleTab`(jpeg q80) → `FrameBuffer`. **개수 cap(60) + 시간 cap(30s) 이중 제한**. `MIN_READY_FRAMES`(10) 이상이면 `isReady`. 진행 표시는 1초 벽시계 타이머(`now − oldestTimestamp`)로 갱신. 페이지 네비게이션과 무관하게 유지(이전·새 페이지 프레임 혼합은 의도).

**캡처 쿼터 직렬화**: `captureVisibleTab`은 윈도우 단위로 Chrome 쿼터(초당 2회 `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`)가 걸린다. 리플레이 폴링(600ms ≈ 1.67회/초)·엘리먼트 스냅샷(`capture.ts`)·스타일 before/after(`StyleEditorPanel`·`useBufferThenSwitch`)가 **동시에** 쏘면 합산이 쿼터를 넘어 스냅샷이 실패한다. 그래서 모든 캡처는 background `captureVisibleTab` 핸들러의 단일 직렬화 큐(`capture-throttle.ts`)를 거친다 — 호출 간 최소 500ms 간격 + rate-limit 에러 한정 백오프 재시도(550/700/900ms). 새 캡처 경로는 반드시 background 핸들러(`sendBg({type:"captureVisibleTab"})`)를 거쳐야 하고, `chrome.tabs.captureVisibleTab`을 직접 부르면 큐를 우회해 쿼터 회귀가 재발한다.

**인코딩**: `capture()` → `frameBuffer.snapshot()` → `encodeToMp4()`(WebCodecs H.264 codec 후보 순차 탐색 + `mp4-muxer`) → 성공 시 `onRecordingComplete(blob, thumbnail, viewport, startedAt, endedAt)` 재사용 (`captureMode: "video"`). `startedAt`=`frames[0].timestamp`(영상-로그 sync 0점), `endedAt`=`captureTime`. capture() 자체도 이 경계로 로그를 1차 trim(`replayLogBounds` guard + `trimByTime`)해 첨부한다.

**트리밍 (Replay Trim)**: capture()는 `onRecordingComplete` **직후** 보존한 프레임 스냅샷으로 `pendingTrim={videoBlob, frames}`를 켠다(`frames.length>=2`만 — 그 미만은 trim 무의미). App이 `pendingTrim`이면 drafting 위로 `ReplayTrimDialog` 오버레이(`absolute inset-0 z-50`, lazy)를 띄운다. 사용자가 in/out 핸들로 보존 구간을 고르고 ✓하면 `applyReplayTrim`(`apply-trim.ts`):
- `secondsToFrameRange`로 초→프레임 인덱스 환산 → `frames.slice` → `isFullRange`면 **no-op**(전체 유지 흡수, 재인코딩 생략).
- 선택 프레임만 `encodeToMp4` 재인코딩.
- **타임베이스 2갈래 분리**(sync 회귀 방지): 영상 메타(`videoStartedAt/EndedAt`)는 **raw 프레임 timestamp**(`sliced[0].timestamp` ~ `마지막+lastFrameDurationMs`). 로그 trim 경계는 **잘라낸 쪽엔 선택 프레임의 정확한 wall-clock**을 쓰고(가드 미적용 — 가드밴드는 최초 캡처 첫 프레임의 폴링 지연 보정용이라 사용자가 고른 interior 프레임 재트림엔 경계 밖 로그를 도로 끌어오는 부작용만 낸다), **안 자른 쪽만 capture 동작 보존**(앞=`inIndex===0`이면 `videoStartedAt − REPLAY_LOG_GUARD_MS`, 끝=`outIndex===last`면 상한 없음 — capture가 captureTime으로 이미 제한). 즉 capture()의 `replayLogBounds`와 달리 apply-trim은 가드를 잘라낸 경계엔 적용하지 않는다.
- capture()와 동일하게 `*Persist.discard()` 선행 후 `trimByTime`로 store 로그 재trim → `set*Log` + `save*Log("pending:${tabId}")`. 단 trim은 save를 `Promise.allSettled`로 await(늦은 IDB write의 경계 밖 로그 부활 차단)한 뒤 `replaceVideo`로 영상 메타 교체.
- **파괴적**: 확정 즉시 원본 프레임 폐기(재편집 없음). ✗(작성 취소)는 캡처 결과 폐기 + IDB pending 로그·attachment 삭제 후 진입 화면.

trim 적용 여부는 `videoTrimmed`(세션 영속 `EditorSnapshot` 키 — `onRecordingComplete`=false, `replaceVideo`=true)로 추적해 제출 분석(`replay_trimmed`)에 싣는다. 초↔프레임 매핑 순수함수(`trim-math.ts`: `frameOffsetsMs`/`secondsToFrameRange`/`isFullRange`)는 `encodeToMp4`와 동일 `MAX_FRAME_DURATION_MS`를 공유해 `<video>` 시각 드리프트를 막고, 에러 마커(`trim-markers.ts` `buildErrorMarkers`)는 log-viewer `buildMarkers`를 재사용해 console error/warn + network 에러만 표시한다.

**상태 공유**: `replay-context.ts`의 `ReplayProvider`가 `isReady`/`isEncoding`/`capture`를 EmptyState에 공급. `pendingTrim`/`resolveTrim`은 App이 훅에서 직접 받아 오버레이를 제어(context 미경유).

## AI 통합 (BYOK LLM · AI Draft · AI Styling)

이슈 작성을 돕는 두 AI 기능 — **AI Draft**(캡처 컨텍스트로 이슈 본문 초안 생성)와 **AI Styling**(자연어로 라이브 요소 스타일 편집) — 이 공용 프로바이더 추상화 위에 올라간다. 모두 **BYOK(Bring Your Own Key)** — 키·엔드포인트는 사용자가 설정하고 호출은 사이드패널에서 직접 나간다. 서버 중계 없음.

**프로바이더 추상화** (`src/sidepanel/lib/ai-provider.ts`): `AIProvider` 인터페이스 = `generate`(단발) + `createSession`(멀티턴 — `messages` 누적). 구현 3종:
- **OpenAI-compatible** (`createOpenAICompatibleProvider`): `/chat/completions`. 프리셋 6종(OpenAI·Gemini·Groq·Together·OpenRouter·Ollama) + 임의 baseUrl. `responseSchema`면 `response_format: json_object`.
- **Anthropic** (`createAnthropicProvider`): `/messages`, `anthropic-dangerous-direct-browser-access` 헤더. JSON 스키마는 system에 인라인. 이미지는 base64 `source`(OpenAI는 `image_url`).
- **Chrome Built-in AI** (`createChromeAIProvider`): 온디바이스 `LanguageModel`(Prompt API). `CHROME_AI_LANG_OPTIONS`로 출력 언어 고정. 이미지·외부 전송 없음.

**프로바이더 선택·폴백** (`useAI`): `settingsUi.llm.modelId`가 있으면 BYOK(baseUrl로 `detectProviderKind` → anthropic/openai), 없으면 Chrome AI로 폴백. Chrome AI는 `availability()`로 가용성 확인 후 status 노출. 둘 다 불가면 AI UI 미노출.

**키·권한·전송**:
- API 키는 `chrome.storage`에 `key-obfuscation.ts`(XOR+base64, `obf:` 접두사)로 난독화 저장 — 암호화 아님, 평문 노출만 차단.
- BYOK는 임의 호스트로 나가므로 연결 시 `requestHostPermission(baseUrl)`가 `chrome.permissions.request`로 해당 origin을 요청하나, required `<all_urls>`에 이미 커버돼 호출이 즉시 grant된다(프롬프트 없음). 함수 자체는 유지.
- 재시도/에러: `fetchWithRetry`가 게이트웨이/오버로드(502·503·504·529)에 1s→2s 백오프 2회. 429→`LlmQuotaError`, 503/529→`LlmOverloadedError`. `LLM_MAX_TOKENS=4096` 공통 상한.

**AI Draft** (`buildAiDraftPrompt.ts`): `buildAiDraftSessionPrompt`가 캡처 모드별 컨텍스트를 조립 — element(diff `current→desired`·디자인 토큰), screenshot(이미지 첨부 분석 지시), video/freeform(network·console 에러 요약 + video는 action 로그). 사용자가 이미 쓴 본문은 `existingDraft`로 "참고 후 개선" 지시(인라인 이미지 ref는 `stripInlineImageRefs`로 제거). enabled 섹션별 JSON 스키마(`buildAiDraftSchema`)로 출력 강제. `parseAiDraftResponse`가 JSON 추출·title 80자 cap·`stepsToReproduce` 번호 제거. 덮어쓸 때 `mergeAiSectionsPreservingImages`(`mergeAiDraftSections.ts`)가 기존 섹션의 inline 이미지를 상단에 보존하고 그 아래 LLM 텍스트를 붙인다.

**AI Styling** (`buildAiStylingPrompt.ts` + `aiStylingPostProcess.ts`): `buildAiStylingSystemPrompt`가 요소 현재 스타일·클래스·디자인 토큰을 컨텍스트로 주고, LLM이 `{ explanation, inlineStyle, classList }` JSON 반환. `parseAiStylingResponse`가 kebab 정규화 + `DENIED_STYLE_PROPS`(content·animation·will-change·counter·`--*`) 필터. 후처리 2단계: ① `mergeAiEdits` — AI가 shorthand를 내면 기존 longhand 제거(diff 행 중복 방지), ② `replaceRawWithTokens` — raw 값을 디자인 토큰 `var()`로 치환하되, 색상은 HSL 거리(임계 `COLOR_FUZZY_THRESHOLD=50`)로 같은 family 토큰에 fuzzy 매칭. 결과는 라이브 picker 편집으로 적용돼 styleEdits 파이프라인에 합류한다.

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

draft 모델: `{ title, sections: Record<string, string>, environment?: EnvironmentRow[] }`. `stepsToReproduce`는 `OrderedListEditor` 전용 UI, 나머지는 Textarea. 본문 섹션과 별개로 **캡처 미디어·로그 첨부·사용자 파일 첨부**(위 "사용자 파일 첨부"·"로그 정책 매트릭스" 참조)가 별도 채널로 들어가며, 자동 메타 위치 규칙에 따라 본문에 삽입되거나 첨부 영역으로 패키징된다.

**재현 환경**: `ReproEnvironmentSection`이 모드별 메타를 readonly 표시 + `draft.environment` 사용자 정의 row 편집. 순수 헬퍼: `filterEnvironmentRows`(빈 row 제거) / `deriveReadonlyEnvRows`(모드별 파생).

**자동 메타 위치**: `POST_MEDIA_SECTION_IDS = {"expectedResult","notes"}` — 첫 해당 섹션 직전에 media/styleChanges emit. 둘 다 disabled면 모든 섹션 끝에 emit. 6종 빌더 + DraftingPanel + DraftDetailDialog에서 동일 룰. PreviewPanel·log-viewer Report 탭 프리뷰는 순수 헬퍼 `composePreviewLayout`로 이 순서를 단일화(`IssuePreviewView` 공용 컴포넌트).

**복수 element 직렬화(styleChanges)**: 한 이슈에 여러 요소의 스타일 변경을 담을 수 있다. `mergeStyleElements`(in `buildIssueMarkdown`)가 버퍼(`bufferedElements`) + 현재 요소를 selector 기준 dedup·재인덱싱해 단일 배열로 만들고, 8개 플랫폼 빌더가 모두 이 배열을 순회해 element별 섹션(selector 소제목 + before/after 스냅샷 + diff 테이블)을 emit한다(Slack은 메시지 앱이라 테이블 대신 `prop: as-is → to-be` 텍스트 줄 + 스냅샷은 스레드 첨부). 이미지 파일명은 배열 인덱스 단일 출처(`before-${i}`/`after-${i}.webp`) — 본문 빌더·`buildCaptureFiles`·Jira `injectSnapshotRows`(ADF 후처리)가 같은 인덱스를 공유해 오귀속을 막는다. 플랫폼별 렌더 차이는 어댑터 패턴대로(Jira는 ADF table에 Snapshot 행 splice, Notion은 Before/After heading 분리, Asana는 As is/To be 섹션). element 모드는 **diff 필수** — 현재 요소에 스타일 변경이 없어도 버퍼에 담긴 요소가 있으면 진행 가능하고, 현재·버퍼 둘 다 비면 drafting 진입을 막고(`hasStyleChange` 게이트 + 버퍼 체크) 요소 캡처(element-screenshot) 모드로 안내한다.

**변경사항 보기 다이얼로그(`StyleChangesDialog`)**: 스타일링 패널의 [변경사항 보기] 트리거가 여는 다이얼로그로 요소별 카드(`buildChangeGroups`로 버퍼+현재 요소를 selector 기준 그룹화)와 행 단위 diff를 보여주고 **3단계 granular 초기화**를 제공한다 — ① 행 초기화(`removeDiffRow` + `picker.applyEditsBySelector`로 해당 prop만 selector 기준 부분 원복), ② 요소 초기화(카드 전체), ③ 전체 초기화(현재 + 버퍼 전부 → `picker.resetAllEdits` → content `restoreAll`, AlertDialog 재확인). 행/요소 초기화 후 버퍼 요소의 after 스냅샷은 `picker.prepareCaptureBySelector`(뷰포트 밖이면 `scrollIntoView` 후 캡처, `handleEndCapture`가 `captureInflight` 가드로 원위치 복원 — 인터리브 캡처 시 first-wins)로 재캡처한다. store는 `patchBufferedElement(selector, patch)`/`removeBufferedElement(selector)`로 버퍼 항목을 부분 갱신·제거(selector 미일치 시 no-op). 마지막 변경 항목이 사라지면 다이얼로그는 reactive하게 자동 닫힌다.

**제출 데이터 라이프사이클 (폐기 vs 보존)**: 이슈 제출 시 store가 두 갈래로 갈린다. 일반 트래커(Jira·GitHub 등 7종)는 `markSubmitted`→`stripSubmitted`로 draft·snapshot·styleEdits·blobKey를 비우고 6종 blob(video/image/network/console/action/attachment)을 즉시 삭제해 회수한다(submitted는 `platform/key/url`만 남김). **Slack은 정반대** — `markSlackShared(id,{key,url})`가 `status:"submitted"`·`platform:"slack"`·`slackPreserved:true`만 패치하고 draft·snapshot·blob 참조를 **그대로 보존**(`delete*Blob` 미호출). Slack은 이슈 트래커가 아니라 메시지 공유라, 나중에 정식 트래커로 **승격**할 수 있게 원본을 남긴다. 신규 작성(`IssueCreateModal.handleSlackSubmit`)·draft 재제출(`DraftDetailDialog.handleSlackSubmit`) 양쪽 Slack 경로가 모두 `markSlackShared`를 탄다. 승격 판정은 순수 헬퍼(`issueListUtils.ts`): `isSlackPreserved`(submitted+slackPreserved) → `promotableTargets`(Slack 제외 연결 플랫폼) → `canPromoteSlack`(보존 이슈 + 트래커 1개 이상). promotable 이슈는 `IssueRow` 카드 우측에 [자세히]·[승격] 버튼을 **동적 노출**(렌더 시점 `accounts` 구독 — 트래커 연결/해제에 반응), 본문 클릭은 기존 permalink 이동 불변. [승격]은 `DraftDetailDialog`를 `autoOpenSubmit`로 열어 제출 다이얼로그까지 스택하되 `submittablePlatforms`로 Slack 탭을 제외하고 `resolveInitialPlatform`으로 초기 탭을 보정한다. 일반 트래커로 승격하면 `markSubmitted`→`stripSubmitted`가 `slackPreserved`까지 폐기(`stripSubmitted`에 `slackPreserved:undefined`)해 일반 submitted로 강등한다. **승격 백링크**(`slackPromotionLink.ts`): 승격 성공 직후 원 Slack 메시지 스레드에 트래커 URL 댓글을 best-effort로 1개 남긴다(`slack.postMessage` threadTs 재사용 — 신규 메시지 타입 없음). channel은 permalink에서 파싱(`parseSlackChannelId`), thread_ts는 원 메시지 ts. `markSubmitted`/`stripSubmitted`가 `issue.url`/`key`를 트래커 값으로 덮고 `slackPreserved`를 비우므로, 원 슬랙 permalink·ts(`slackOrigin`)는 `handleSubmit` 진입 직후 핸들러 분기 **전에** 사전 캡처해야 한다. 모든 실패를 삼켜(`void` fire-and-forget) 승격 흐름을 막지 않는다. **설계 특성**: 보존 blob은 승격·삭제(`removeIssue`, id 기준 6종 정리) 전까지 IndexedDB에 잔존하므로, 정상 제출(strip 즉시 회수)보다 steady-state 저장 사용량이 늘 수 있다(적극적 만료는 비목표).

**마이그레이션**: `issues-store` v5, `settings-store` v10 (v7 gitlab·v8 asana·v9 clickup·v10 slack은 버전 마커만 bump), `settings-ui-store` v6 (v6은 `recordingMode` 추가 — `migrateSettingsUi`에서 `state.recordingMode = state.recordingMode ?? "tab"` 버전 비교 없이 nullish 병합). 각각 순수 헬퍼로 분리해 테스트 (`migrateV2ToV3`, `migrateToV5`, `migrateIssueToV4`, `migrateSettingsUi` 등). 모두 멱등 가드 + sparse 저장. 빈 paragraph는 `(없음)` (`md.noValue`)로 통일. `IssueRecord`의 비파괴 optional 필드 추가(notion 메타·`actionLogBlobKey`·`videoStartedAt`·`bufferedElements`·`slackPreserved` 등)는 버전 bump 없이 `undefined`로 안전히 읽힌다.

**녹화 모드 선택(`recordingMode`)**: 영속 설정 `settings-ui-store.recordingMode`("tab"|"screen")는 "다음 녹화에서 어느 함수를 부를지"의 입력일 뿐이고, 세션 진행 중 녹화의 소스인 `editor-store.recordingSource`와 **직교**한다. SettingsTab 캡처 설정 Tabs가 설정하고, IssueTab 캡처 진입 화면의 단일 녹화 버튼이 라이브 구독해 `startVideoCapture`(tab) / `startScreenCapture`(screen)로 분기(클릭 경로라 user gesture 보존). 진행 중 녹화엔 무관.
