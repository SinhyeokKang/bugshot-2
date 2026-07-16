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
| Token Refresh | pre-refresh + 401 retry | hook 주입형, pre-refresh + 401 retry | hook 주입형, pre-refresh + 401 retry | ❌ (토큰 만료 없음) | hook 주입형, pre-refresh + 401 retry | hook 주입형, pre-refresh + 401 retry | ❌ (토큰 만료 없음) | ❌ (토큰 만료 없음) |
| dev/prod 분리 | 단일 App | 2 App (callback URL 1개 제한) | 단일 App (multi redirect) | 단일 App (multi redirect) | 단일 App (multi redirect) | 단일 App (multi redirect) | 단일 App (multi redirect) | 단일 App (multi redirect) |
| Env var | `VITE_ATLASSIAN_CLIENT_ID` | `VITE_GITHUB_CLIENT_ID` (+`_PROD`) | `VITE_LINEAR_CLIENT_ID` | `VITE_NOTION_CLIENT_ID` | `VITE_GITLAB_CLIENT_ID` | `VITE_ASANA_CLIENT_ID` | `VITE_CLICKUP_CLIENT_ID` | `VITE_SLACK_CLIENT_ID` |

공통 env: `VITE_OAUTH_PROXY_URL` — Cloudflare Worker origin (Jira·GitHub·Notion·Asana·ClickUp·Slack 공유). proxy origin fetch는 required `<all_urls>`가 커버하므로 manifest `host_permissions`에 별도 추가하지 않는다.

Slack은 메시지 앱이라 어댑터 공통 패턴에서 갈리는 지점이 있다: OAuth user token은 응답의 **`authed_user.access_token`**에서 추출(최상위 `access_token`=bot 토큰 아님), 에러는 HTTP 200 + **`ok:false`** 패턴이라 `slackFetch`가 status가 아닌 `ok`로 분기(`SlackError`), 전송은 **제목=부모 메시지 / 본문·첨부=스레드 답글**(본문은 `chat.postMessage`의 4000자 한계 때문에 `sidepanel/lib/splitSlackText.ts`가 3800자·라인 경계로 나눠 **답글 N개로 순차 전송** — 코드블럭 안에서 잘리면 앞 조각을 ```로 닫고 다음 조각을 ```lang으로 재개한다. Slack이 알아서 쪼개게 두면 그 경계에서 펜스가 깨져 로그가 평문화되거나 엉뚱한 섹션이 코드블럭에 씌워진 실사용 회귀가 있었다)(`postMessage` thread_ts), 파일은 **2-step 업로드**(`getUploadURLExternal`→POST 바이트 전송→`completeUploadExternal`), 상태가 없어 폴링 없는 정적 "전송됨" 배지.

**왜 proxy가 필요한가**: confidential client는 `client_secret` 요구 — 확장에 비밀키를 번들할 수 없으므로 Worker가 `code↔token`·`refresh↔token` 교환만 중계. Linear·GitLab은 public client(PKCE)라 proxy 불필요. Asana는 native 앱 모드가 OOB redirect만 허용해 custom redirect(`chromiumapp.org`)를 쓰려면 confidential일 수밖에 없어 proxy 경유한다.

**GitLab self-managed**: OAuth는 `gitlab.com` 고정(host 접근은 `<all_urls>` 커버). PAT는 임의 self-managed 인스턴스 URL(`gitlabInstanceUrl.normalizeInstanceUrl` — gitlab.com은 https 강제) 지원하며, 연결 시 `requestHostPermission(baseUrl)` 호출(required `<all_urls>`에 이미 커버돼 즉시 grant — 프롬프트 없음). GitLab은 업로드→이슈생성 순서라 logs.html에 이슈 역링크를 사전 주입 불가 → 생성 후 `injectIssueUrl` 재업로드 + `gitlab.updateIssueDescription`(description PUT)으로 보강(실패는 격리).

**Asana**: REST·authorize는 `app.asana.com` 고정, token 교환은 proxy(`/asana/token`·`/asana/refresh`) 경유. 응답은 `{ data }` 래핑이라 `asanaFetch`가 언랩. html_notes는 인라인 이미지를 지원하므로(`<img data-asana-gid>`) **create → upload → updateTaskNotes** 2-write로 본문에 이미지를 임베드한다(첨부 후 GID 참조라 순서 강제). 캡처 이미지(As is/To be)뿐 아니라 에디터 본문에 붙여넣은 인라인 이미지(`inlineImages`, 본문 src `inline:refId`)도 같은 경로로 업로드·임베드한다. 단 Asana는 webp 인라인을 지원하지 않아 업로드 전 webp→jpeg로 폴백 변환하고, 작게 렌더되지 않도록 `src`(view_url)+`data-src-width/height`+`style`을 채운다. element 비교는 As is/To be 섹션(이미지+속성값)으로 배치(테이블은 `<pre>` 폴백이라 셀 이미지 불가). 영상·로그·메타는 인라인 불가라 task 첨부 영역에만 둔다(본문에 파일 리스트 미표기). logs.html은 createTask가 upload보다 먼저라 업로드 직전 `injectIssueUrl(task.permalinkUrl, task.gid)`로 백링크·key를 주입해 1회 업로드로 끝낸다(GitLab식 재업로드 불필요). refresh_token은 비회전이라 갱신 응답에 없으면 기존 토큰 유지.

**ClickUp**: REST는 `api.clickup.com/api/v2` 고정, authorize는 `app.clickup.com`(host_permission 불필요 — launchWebAuthFlow 처리), token 교환은 proxy(`/clickup/token`, confidential) 경유. **PAT/OAuth 모두 raw token 헤더**(`Authorization: <token>`, Bearer 접두사 없음 — Asana와 다름, `clickupAuthHeader`). **토큰 만료가 없어 refresh hook 자체가 없다**(Notion 유사) — 401은 곧 권한 박탈이라 `clickup.oauthRevoked` 재연결 에러로 직행. 본문은 `markdown_content`를 1급 지원하므로 HTML 변환 없이 markdown을 그대로 전송. 첨부는 **Asana식 create-first 2-write** — task를 먼저 만들고(첨부에 task id가 필요) per-file 격리 업로드한 뒤, 첨부 URL로 본문을 재구성해 `clickup.updateTaskMarkdown`으로 2차 PUT한다(본문이 안 바뀌면 생략, 실패는 try/catch 격리). 대상은 **Workspace → Space → List 3단계 종속**(task는 `list_id` 필수, 다른 플랫폼은 1~2단계) — List는 folderless list + folder 하위 list를 `flattenLists`로 평탄화해 한 콤보박스로 합친다. 완료 상태는 boolean이 없고 List별 커스텀 status라 `setTaskCompleted`가 list statuses에서 done/non-done type을 매핑해 PUT한다.

**Refresh 실패 → 재인증**: refresh token 무효화 시 `OAuthError({ platform })` → BG `onOAuthExpired(platform)` → App.tsx AlertDialog 재인증 안내. GitHub은 OAuth App "Token expiration" OFF면 refresh token 미발급 → 즉시 재인증 안내. **OAuthError 분기**: `{ platform, cancelled }` → BG가 `body.platform`/`oauthCancelled`/`oauthRefreshFailed` 플래그 직렬화. 정규식 매칭 금지 — `isOAuthCancelled`/`getOAuthErrorPlatform` 헬퍼 사용.

## 플랫폼 어댑터 패턴

`PlatformId = "jira" | "github" | "linear" | "notion" | "gitlab" | "asana" | "clickup" | "slack"` union (`src/types/platform.ts`).

- **저장**: `useSettingsStore.accounts` dict(계정마다 **`defaults`** — Connect 탭에서 고른 기본값. **Jira만 계정 루트 평면**[`projectKey`/`issueTypeId`/`assigneeId`/`assigneeName`]이고 나머지는 `defaults` 객체) + `lastSubmitFields: Record<PlatformId, ...>`(직전 제출값) + 전역 `titlePrefix`.

**Connect 기본값 · 필드 prefill 우선순위** — 이슈 필드는 `defaults`(Connect 기본값)와 `lastSubmitFields`(직전 제출값) **두 축**에서 채워지고, 그 우선순위를 `initial*Fields` 순수 헬퍼가 결정한다(플랫폼당 1개 + Jira는 `sidepanel/lib/initialJiraFields.ts`). 규칙 4개:

1. **제출 목적지 필드는 last 우선, defaults는 fallback** (repo/team/project/database/channel). 뒤집으면 기본값이 직전값을 영구히 가린다 — POSTMORTEM 2026-06-27(Slack 기본 채널).
2. **거친 스코프는 예외로 Connect 우선**: Asana·ClickUp의 workspace, Jira의 projectKey. 이들은 "제출 목적지"가 아니라 연동 설정 자체다.
3. **assignee의 defaults fallback 방향이 플랫폼마다 반대다** — 이게 이 서브시스템의 유일한 비대칭이고, 뒤집으면 조용히 엉뚱한 사람이 배정된다.
   - **GitHub·GitLab·Linear**: 상위 스코프(repo/project/team)가 last로 해소되므로, 스코프가 갈리면 `defaults.assignee`는 *다른* repo의 멤버라 **무효(undefined)**. 반면 `last.assignee`는 해소된 스코프와 같은 제출 쌍이라 **유효(유지)**.
   - **Jira·Asana·ClickUp**: 상위 스코프가 Connect 설정으로 해소되므로 해소된 스코프가 곧 defaults의 것 → `defaults.assignee`는 **항상 유효(fallback)**.
4. **id·표시명은 쌍이라 소스를 통째로 고른다**(`assigneeSrc = last?.assigneeId ? last : defaults`). 각각 독립 `??`하면 "id는 last, 이름은 defaults"가 되어 다른 사람 이름이 붙은 id가 나온다.

Connect 폼에서 **상위 값을 바꾸면 하위 assignee·label defaults를 비운다**(다른 repo·project의 멤버라 무효). Jira는 프로젝트 교체 시(`ProjectCombobox`) — 유저 *검색*은 사이트 전역이지만 **assignable은 프로젝트 권한 스코프**라, 안 비우면 제출이 400난다. 그 400의 `errors.assignee`는 `background/jira-api.ts:extractJiraDetail`이 사용자 문구(`jira.error.assigneeNotAssignable`)로 치환한다.

**Jira는 `sidepanel/lib/initialJiraFields.ts`가 단일 출처** — `editor-store.confirmDraft`(캡처→제출)와 `DraftDetailDialog`(드래프트 재제출) **두 경로가 공유**한다. 한쪽만 고치면 기본 담당자가 절반의 경로에서만 붙는다(실제로 그렇게 샜다 — POSTMORTEM 2026-07-14). `projectKey`는 **반환하지 않는다**: 내보내면 `EditorIssueFields`에 없는 키가 `issueFields`로 새어 세션에 영속된다. 순수 헬퍼가 `tabs/`가 아니라 `lib/`에 있는 건 **store가 sidepanel/tabs(컴포넌트 그래프)를 import하지 않기 위함**이다.
- **메시지**: bg `{platform}.*` namespace 분기. `BgRequest` exhaustive switch 누락 검증. 새 타입은 `BG_REQUEST_TYPES` Set에도 등록.
- **API 어댑터**: `{platform}-api.ts`. 401 처리 — Jira: 즉시 refresh, GitHub·Linear·GitLab·Asana: hook 주입형(module side-effect 재등록), Notion·ClickUp·Slack: 즉시 throw(만료 없음 → refresh 없이 재연결). Slack은 status가 아닌 `ok:false`(HTTP 200+실패) 패턴이라 `slackFetch`가 `ok` 필드로 분기해 `SlackError`(`token_revoked`/`invalid_auth` 등)를 던진다.
- **이슈 상태 변경**: `statusBadges/SubmittedBadge` → 플랫폼별 read-only / Popover 상태 변경 분기.
- **본문 빌더**: `buildIssueAdf`(Jira), `buildIssueMarkdown`/`buildIssueHtml`(클립보드), `build{Github|Linear|Notion|Gitlab|Asana|Clickup}IssueBody` · `buildSlackBody`(메시지 앱이라 별도 형태). 모두 `MarkdownContext` 입력 → `NormalizedSubmitResult { key, url }` 통일. (GitLab은 github 빌더 계열 — DOM raw selector·before/after 표. Asana는 markdown 본문을 `markdownToAsanaHtml`로 html_notes subset 변환.)
- **다이얼로그**: `SubmitFieldsDialog`가 IssueCreateModal·DraftDetailDialog 공유. 연결 1개=Tab 숨김, 2개+=Tab 선택. prefill effect deps `[open, issue?.id]`만 — `issue.platform` 추가 시 다이얼로그 닫힘 버그.

**Jira 인라인 미디어 trap**: ADF `mediaSingle > media`는 `type:"file"` + UUID + `collection:""` 필수. `type:"external"`은 인증 실패로 표시 불가. UUID 추출은 `GET /attachment/content/{id}` redirect URL에서 (`probeMediaRedirect` — GET+Range → HEAD 순). **이 probe는 `authedFetch`를 못 쓴다** — 본문이 아니라 리다이렉트된 `res.url`을 봐야 하기 때문. 그래서 토큰 신선화(`ensureFreshAuth`)와 401 재갱신을 `getMediaFileId`가 **직접** 한다. 빠뜨리면 만료 토큰으로 401을 받고도 "리다이렉트 없음"과 구분되지 않아 **조용히 mediaId를 잃고 영상이 본문에서 누락**된다(POSTMORTEM 2026-07-14). 401 재시도는 authedFetch와 같이 1회로 끊는다(변환 지연 백오프 루프에 refresh가 곱해지지 않게). **인라인 재생 실패 시 코덱·해상도 의심 전에 ADF attrs/UUID 추출 경로부터 확인** — 99% 그쪽이 원인.

**Notion 특이사항**: image·video는 본문 inline, log·other는 첨부 섹션 file 블록. element 모드는 Before/After heading_3 분리(표 셀이 image 불가). 페이지 ID 추출은 반드시 `extractNotionPageId()` 사용(slug garbage 방지). 상태 색은 `notionStatusCategory(color)` → new/indeterminate/done 매핑.

## 토큰 체인 resolve 룰

`content/css-resolve.ts`의 `resolveVarChain`은 `var()` 체인을 따라가며 어느 이름에서 멈출지 결정한다. 원칙: **디자인 토큰 이름은 보존, 컴포넌트 내부 alias는 펼침**.

- **공용 토큰** (`--radius-xxl`, `--color-text-semantic` 등): 처음 만나는 이름에서 멈춤. 시맨틱이 원시를 참조해도 시맨틱 이름 노출.
- **private alias** (`--_xxx` 언더스코어 prefix): 리터럴까지 끝까지 펼침.
- fallback `var(--x, var(--y))` — primary 미정의면 fallback 이름으로 resolve, 규칙 동일.

## CSSOM shorthand 한계 우회 (Raw CSS Cache)

shorthand(var 포함) + 같은 shorthand의 longhand override 조합에서 Chrome이 shorthand를 explode하며 **원본 var()를 빈 문자열로 대체**. CSSOM만으로 복구 불가.

**대응**: `src/content/css-source-cache.ts`가 raw CSS를 별도 확보해 룰별 매핑.

수집: `<style>` → `ownerNode.textContent`, `<link>` → `fetch(href)` (same-origin/CORS만), `adoptedStyleSheets` → `cssText` 직렬화. 픽커 활성화 시 `ensureLoaded()` + `MutationObserver`로 변경 감지, 비활성화 시 drop.

매핑: parsed rule list와 `sheet.cssRules`를 순서+selectorText로 1:1 매핑. mismatch 시 CSSOM fallback. `collectRulesForElement`에서 `getRawDeclarationsFor(rule)` 우선, null이면 CSSOM fallback.

비동기 영향: `picker.collectTokens` 등 메시지 핸들러가 `await ensureCssCacheLoaded()`. content script는 `return true` + IIFE 패턴.

**cross-origin 보강 (병렬 경로)**: cross-origin stylesheet는 `cssRules` 접근이 `SecurityError`라 same-origin 정렬 경로에 못 끼운다. content(ISOLATED)는 직접 fetch도 불가(CORS)하므로, **background가 raw CSS를 대신 fetch**한다 — `ensureCrossOriginLoaded()`가 `collectCrossOriginHrefs()`로 타 origin `<link>` href를 모아 `css.fetchSheets` RPC(`background/messages.ts:fetchCssSheets`, `<all_urls>` CORS 우회)로 위임. background는 **SSRF 가드**(`lib/ssrf-guard.ts:isFetchableSheetUrl` — loopback·사설·link-local·IPv6 ULA·IPv4-mapped 차단)를 통과한 공개 http(s) 호스트만 `credentials:omit`·`redirect:manual`·2MB 캡으로 읽는다. 받은 텍스트를 `parseStylesheet`로 파싱 → `indexCrossOriginRules`가 seq 부여 + `:root`/`html`/`*`의 `--*`를 customProps로 분리 → `getMatchingCrossOriginRules(el)`가 `el.matches(selectorText)`로 매칭(throw는 rule별 skip) → `css-resolve.ts:mergeCrossOriginDecls`가 **빈 specified prop만** 채운다(same-origin·inline 우선, source = selectorText). 멱등(`crossLoadPromise`)이고 `invalidate()`에서 함께 초기화. picker는 `ensureCrossOriginLoaded` 완료 후 **2차/3차 `picker.selectionUpdated`**를 비동기 발화하며, payload selector ≠ 현재 선택이면 무시하는 stale 가드(picker `selectedEl !== el` 재확인 + store `updateSelectionStyles` selector 비교)로 늦은 보강이 타 요소를 오염시키지 않게 한다. 여전히 못 잡는 케이스: SSRF 가드 차단·네트워크 실패로 fetch 불가한 sheet(조용히 computed fallback).

## iframe picker/캡처 (1-depth)

picker content script가 `all_frames: true`라 프레임마다 독립 picker 인스턴스가 돈다. **1-depth iframe**(top에 직접 박힌 프레임, cross-origin 포함) 내부 요소를 선택·스타일 편집·캡처할 수 있다. 프레임 간 조율은 `src/content/frame-geometry.ts`의 postMessage 핸드셰이크 + 사이드패널의 frameId 라우팅으로 이뤄진다. 회귀 함정이 많아 아래 불변식을 유지한다.

**frameId 라우팅**: 사이드패널은 어느 프레임의 선택인지를 **`sender.frameId`**로 얻는다(payload 위조 방지). `picker-control.ts:send(tabId, msg, frameId)`는 frameId가 **required** — 생략하면 `chrome.tabs.sendMessage`가 전 프레임 broadcast로 새는 함정이라 타입으로 강제한다(프레임 무관 메시지는 `sendAll`). 요소 동등성은 selector 단독이 아니라 **selector+frameId 복합키**(`@/lib/element-key.ts:sameElementKey`, 구버전 스냅샷 frameId 미지정은 0 정규화) — 다른 프레임의 동일 selector가 dedup에서 뭉개져 변경이 소실되지 않게 store find/filter·버퍼·이슈 머지가 전부 이 키를 쓴다.

**등록 핸드셰이크(위조 차단)**: 자식 picker가 start 시 `announceFrameToParent()`로 부모에 존재를 알리고, top이 `event.source`로 매칭되는 `<iframe>`을 registry에 올린다. top blocker는 hover 대상이 **registry 등록 iframe일 때만** `pointerEvents:none`로 넘겨 안쪽 picker가 클릭을 받게 하고, 미등록(중첩 2-depth+·sandbox)은 blocker를 유지해 `picker.iframeUnsupported` 거부 다이얼로그로 보낸다. 등록은 **`frameToken`**(사이드패널이 `picker.start`에 실어 broadcast — chrome 경로라 페이지가 위조 불가)이 일치할 때만 승인 → 임의 iframe 스크립트의 무인증 postMessage 등록을 차단한다. cross-origin은 별도 렌더러라 자식 announce가 top의 token 설정보다 **선착**할 수 있어, 미일치 announce는 `pendingPresents`에 보류했다가 token 도착 시 재평가한다(도착순서 비보장 대비).

**캡처 좌표 변환**: iframe 내부 요소 캡처는 자식이 자기 뷰포트 기준 rect를 재고, `requestFrameOffset()`로 부모에게 offset을 요청해 `composeTopRect`로 top-frame 좌표로 합성한다. 크롭 scale 기준 viewport도 **top 크기**로 교체한다(iframe 크기를 쓰면 `captureVisibleTab` 스크린샷과 어긋남). offset 응답은 사이드패널이 `picker.armFrameOffset`(chrome 경로)로 연 **1회성 arm(카운터)**을 소비할 때만 나가고 registry 등록 프레임으로 한정 — 임의 iframe의 top overlay 임의 숨김·geometry 유출·arm 선점을 막는다. 응답 수신 측은 부모 origin(`ancestorOrigins`)·offset 숫자(`isValidOffset`)를 검증하고 500ms 타임아웃 폴백(hidden 탭 대비). 합성 rect가 top 뷰포트와 안 겹치면(iframe이 화면 밖 스크롤) 캡처 실패(rect null)로 폴백해 1px 쓰레기 크롭을 막는다. iframe 캡처는 top overlay도 숨겨야(안 그러면 스크린샷에 찍힘) `onChildCapturePrep`이 겸하고, 종료 시 `endCapture`가 캡처 프레임 + frame 0을 좁혀 보내되 top에는 `cleanup` 표시를 실어 미소비 arm이 진행 중인 다른 캡처의 inflight를 조기에 깎지 않게 한다(인터리브 오염 방지).

**한계**: 2-depth 이상 중첩·sandbox 프레임은 미지원(거부 경로). same-URL reload는 chrome이 iframe frameId를 재발급해 옛 frameId send가 조용히 실패한다(결말은 요소 소실과 동일 — sessionExpired/ghost 카드). picking 중 네비게이션된 iframe은 `frameCommitted` 수신 시 `restartPickerInFrame`로 재시작해 stale 핸드오프(클릭 유실)를 복구한다.

## 백그라운드 로그 캡처 (Network / Console / Action)

`src/content/recorders-entry.ts`를 MAIN world `document_start`로 등록해 fetch/XHR/sendBeacon/WebSocket/console/사용자 액션을 자동 wrap. 페이지 스크립트보다 먼저 실행되므로 Sentry 등이 `originalFetch` 캐싱 전에 wrap 설치. **선행 전제 — 동기 IIFE emit**: 이 "먼저 실행"은 recorders-entry 청크가 crxjs에 의해 동기 IIFE로 emit돼야 성립한다(crxjs 조건: 청크의 static import·dynamic import·export가 0인 self-contained). 청크가 외부 import를 끌어들이면 crxjs가 async-import loader로 되돌려 후크가 페이지 인라인 스크립트보다 늦게 깔리고 pre-arm(아래 활성 게이트)이 무력화된다 — 그래서 레코더는 `content/log-throttle.ts`를, 사이드패널 수신부는 복제본 `sidepanel/lib/trailing-throttle.ts`를 쓰도록 의도적으로 분리한다(`log-persist-guard`가 `@/content/log-throttle`을 import하면 공유 청크화). 리팩터 시 청크에 외부 static import 유입 금지(회귀).

**iframe 커버리지**: 세 content_scripts(`picker.ts`·`recorders-entry.ts`·`recorder-bridge.ts`)가 전부 `all_frames: true`라 top + 모든 iframe에 주입된다(picker도 1-depth iframe DOM 선택을 지원 — 아래 "iframe picker/캡처" 섹션). 로그 레코더가 picker와 **별도 content_scripts 2개**로 갈리는 이유는 프레임 스코프 차이가 아니라 world·역할 차이다 — `recorders-entry.ts`(MAIN, 후크 본체)와 `recorder-bridge.ts`(ISOLATED, sentinel 수신·`recorder.*` data를 `chrome.runtime`으로 중계). 각 프레임 레코더는 entry를 자기 프레임의 `pageUrl: location.href`로 스탬프 → cross-origin iframe(Stripe·임베드 위젯 등) 로그도 캡처된다. (sentinel·data가 MAIN world CustomEvent로 오가므로 페이지 스크립트가 자기 탭 로그를 위조 주입할 수는 있다 — 영향 범위는 해당 탭 로그 무결성 한정.) `picker.ts`에 있던 인라인 로그 브리지는 이 파일로 추출됨. `webNavigation.onCommitted`(iframe `frameId !== 0`) 시 `picker-control.ts:rebroadcastSentinelsToFrame`가 그 프레임에만 sentinel을 재발행해 늦게 뜬 iframe도 활성 세션에 합류(setSentinel은 `recording=true`만 켜고 버퍼는 비우지 않아 재수신 안전). origin은 entry `pageUrl`에서 `originOf()`로 런타임 파생(데이터 모델 불변) — ① cap evict 시 `mergeLogItems`의 `topOrigin` 인자로 top-page-origin을 우선 보존(cross-origin = 주로 광고 iframe부터 oldest evict; **console/network만** — action은 광고가 폭증시키지 않아 순수 FIFO 유지로 `topOrigin` 미전달), ② 로그 탭에 출처별 필터(`OriginFilterBar`, console/network/action 공용, origin 2개+ 일 때만 노출). opaque(`data:`/`about:blank` → `originOf`가 `"null"`) 출처는 필터에서 `UNKNOWN_ORIGIN` 한 그룹으로 묶는다.

**활성 게이트 (capturing vs recording 2단)**: 적재 게이트는 `recording`이 아니라 `capturing`이다. 두 플래그를 분리한다 — `capturing`(버퍼 적재 여부)과 `recording`(사이드패널 dispatch/전송 여부). `recording` 기본값은 `false`이고 `setSentinel`로 `true`(패널 주입 시), 패널 닫힘(`port.onDisconnect`)·탭 전환(`tab-bindings.ts` `onActivated`에서 직전 활성 탭에 stop)으로 `false`. `capturing` 초기값은 **pre-arm 플래그**다 — 각 레코더가 init에 `readPreArmFlag()`(`recorder-prearm.ts`, sessionStorage `__bugshot_recorder_active__`)로 초기화해, **한 번이라도 armed된 origin(active origin)이면 sentinel 도착 전 document_start부터 버퍼 적재를 시작한다**(로드 초반 로그 캡처). `setSentinel`은 `capturing=true` + `setPreArmFlag()`(이후 same-origin reload에서 재-pre-arm), `stop`은 `recording=false`+`capturing=false`이되 **sessionStorage 플래그는 유지**(reload 시 새 world가 다시 pre-arm). sentinel 전 적재분은 `entry.preArm=true`로 마킹된다 — dispatch는 sentinel 없으면 no-op이라 사이드패널 전송·IndexedDB 저장은 안 되고 메모리 버퍼에만 쌓이며, 다음 arm 시 소급 flush된다. `capturing=false`면 fetch는 `createPatchedFetch`의 `() => capturing` 게이트로 원본 경로(`new Request` 재구성 없음), XHR/sendBeacon/console/action은 push 차단 — pre-arm 아닌(미armed) origin·미활성 탭 트래픽에 일절 간섭하지 않는다. 같은 탭으로 (네비게이션 없이) 복귀해 패널 문서가 살아 있으면 패널 `visibilitychange`(visible)가 재주입을 트리거해 stop과 대칭을 맞춘다.

**페이지 무간섭(예외 격리)**: 세 레코더는 MAIN world에서 페이지와 같은 전역을 공유하므로 wrap이 페이지 동작을 절대 깨뜨리면 안 된다. 불변식 — ① 원본(fetch/XHR/`console.*`/`history.pushState·replaceState`)을 **먼저** 호출해 페이지 동작 보존, ② 기록 로직의 throw는 try/catch로 격리해 페이지 호출자로 전파 금지(`createPatchedFetch` record/settle, XHR `recordXhrSend`, console wrap의 `safeStringify`, action history wrap 모두 격리), ③ 응답 본문 read는 settle을 await하지 않음. 특히 `safeStringify`는 페이지 값의 throwing getter·커스텀 `toString`/`Symbol.toPrimitive`·Proxy trap에도 `[unserializable]`로 흡수해 wrap된 `console.log`(=페이지 코드)가 throw하지 않게 한다. 리팩터 시 이 3원칙을 깨면 페이지 요청·라우팅·콘솔이 깨질 수 있다(과거 fetch `new Request` 재구성이 GitHub 업로드·SigV4를 깬 회귀 전례).

**버퍼 전략**: 활성 구간 동안 적재. 메모리 보호 — Network: 50MB 합산 body 메모리 캡(`MEMORY_CAP`, body 보유 oldest-first evict / per-body는 3MB `BODY_CAP`) + 5000 entry FIFO, Console: 2000 entry FIFO, Action: 1000 entry FIFO, WebSocket: 연결당 1000 프레임 FIFO. 요청 phase: send 시 `pending`, 응답 완료 `complete`, reject/abort/error/timeout 시 `error`로 in-place 갱신. 추가 캡처: `sendBeacon`, fetch reject, XHR error/abort/timeout, WebSocket 프레임.

**Body omission**: `string | NetworkBodyOmission` union. kind: `truncated`(3MB 초과), `binary`(image/font 등), `stream`(SSE/multipart), `omitted`(합산 캡 초과로 oldest-first 회수). UI·logs.html 모두 사유 표시.

**네트워크 마스킹** (`network-recorder-helpers.ts`): 민감 헤더(`authorization`·`cookie` 등) + `MASKED_QUERY_KEYS` 기반 쿼리스트링 + `maskBody`의 JSON 바디 키(`token`·`password`·`secret` 등) 마스킹. 콘솔 로그는 페이지 출력 원문이라 **마스킹 없음**(액션 로그의 2층 마스킹과 대비 — 아래 액션 레코더 항목).

**WebSocket 프레임**: `window.WebSocket` **생성자만** Proxy(`construct` trap)로 후킹하고 인스턴스 `send`는 직접 wrap(기존 후킹은 직접 치환 — Proxy는 생성 가로채기에만 신규 도입). 연결을 `NetworkRequest` 엔트리 1개(status 101, method `"WS"`, `webSocket: WebSocketMeta`)로 매핑하고 프레임을 `webSocket.frames[]`에 적재 — `direction`(send/receive/open/close)·`ts`·`data`·`size`. **텍스트 프레임만** 캡처(`classifyWsFrameData`가 바이너리 ArrayBuffer/Blob/TypedArray를 null로 드롭하고 `framesTotal`만 증가), 본문은 `BODY_CAP`(3MB) truncate + 기존 `maskBody`로 마스킹. 연결당 프레임 캡(`MAX_WS_FRAMES_PER_CONN`=1000) FIFO 초과 시 `WS_FRAMES_CAPPED` 경고. **전역 50MB MEMORY_CAP eviction에는 미합류**(수용된 한계 — 프레임 수 캡·본문 캡·엔트리 캡으로만 bound). UI는 연결=목록 행 + 상세 Messages 탭(`MessagesPanel` — 방향 필터·`framesTotal`−보유 dropped 배지), `buildHar`는 WS 엔트리를 `_resourceType:"websocket"` + `_webSocketMessages`(send/receive 데이터 프레임만)로 export.

**Console wrap 범위**: `log/info/debug` + `trace/assert/dir/table/group*/count*/time*`는 상시 wrap. **`error/warn`은 arm 구간에 한정해 wrap** — wrap 함수가 콜스택에 끼면 Chrome이 확장 attribution해 `chrome://extensions`에 페이지 라이브러리 경고가 누적되므로 오염 창을 arm 스코프로 좁힌다. arm 트리거는 둘 — `setSentinel`(명시적 arm) 또는 **pre-arm(active origin이면 document_start부터, `installEwWrap`)**. 멱등(`ewState.installed`)이라 중복 설치는 no-op. 복원은 `stop`(`restoreConsoleWrap`) + sentinel 미도착 케이스 보강으로 `pagehide`에서도 원복(멱등이라 중복 안전). 진짜 에러는 `window.addEventListener("error")`/`unhandledrejection`/`console.assert`로 별도 캡처.

**액션 레코더**: click/input/change(input/toggle/select)/keydown(keypress)을 capture-phase에서, `pushState`/`replaceState` 래핑 + `popstate`/`hashchange`로 네비게이션 기록. 클릭은 가까운 interactive 요소로 정규화, accessible name과 implicit role을 **분리 저장** — 자연어 문장 조립은 뷰어(`ActionLogContent`)의 i18n 레이어가 담당. 입력은 같은 selector 연속 dedup. checkbox/radio는 click 대신 change로 toggle 1회만(이중기록 방지), `<select>`는 select kind. keypress는 단축키·특수키 조합만(인쇄 문자·IME 조합 제외). 입력값·select 값은 `VALUE_CAP=500`으로 절단.

**마스킹 2층 방어** (`action-recorder-helpers.ts`) — 값 경로와 이름 경로 **양쪽**에 게이트가 필요하다. 값만 막으면 `accessibleName`이 `textContent`로 폴백해 click/drag/keypress의 `target`으로 같은 텍스트가 도로 나간다.
- **1층 라벨 판정** (`shouldMaskField`): type=password·autocomplete 힌트 + 민감 키워드(`SENSITIVE_NAME_RE`). 판정 소스는 `fieldLabel()`이 라벨로 쓰는 것과 동일해야 한다 — name·id·`aria-label`·`label[for]`·암묵(래핑) 라벨·`aria-labelledby`·placeholder 전부. 영문은 **단어 경계 `\b` + `normalizeName`(camel/snake/kebab 분해)** 로 매칭 — 부분일치면 `pin`⊂ship**pin**g, `auth`⊂**auth**or, `card`⊂dis**card**가 죽는다. 한글은 `\b`가 안 먹어 부분일치 유지(안전 측).
- **2층 값 판정** (`isSensitiveValue`): 라벨이 무의미한 경우(생성된 id `:r3:`, 커스텀 폼, 라벨 없는 입력)를 값 형태로 잡는다 — 이메일 정규식 또는 구분자 제거 후 9자리 이상 순수 숫자열(전화·카드·주민·계좌). **`.`은 구분자에서 제외** — 지우면 소수(`1234.56789`)·IP가 긴 숫자열로 승격돼 재현에 필요한 값이 죽는다.

적용면: `recordInput`·`recordSelect`(값) + `accessibleName`·`fieldLabel`(이름) + keypress는 민감 필드 포커스 중이면 **엔트리 자체를 드롭**(값·이름 게이트와 별개의 세 번째 게이트). **contentEditable은 값을 아예 안 싣는다** — 리치 에디터 본문은 사용자 저작물(메일·문서·메시지)이라 `recordInput`이 raw를 비우고 masked로 넘기며, `rawAccessibleName`도 textContent 폴백을 건너뛴다. `recordToggle`은 값이 `checked`/`unchecked`뿐이라 판정 대상이 아니다. 녹화 bind(`setSentinel`) 시 현재 페이지 진입 `load` 네비게이션을 1회 보충(`entryNavOnBind`, `entryNavEmitted` 가드로 중복 방지) — pre-arm 적용 origin이면 document_start의 load가 `capturing=true`라 이미 적재돼 `entryNavEmitted=true`가 되므로 보충을 스킵하고, 미armed origin이라 load가 버려진 경우에만 1회 합성해 cross-origin 진입 자취 소실을 메운다.

**드래그 캡처(precision-first 2경로)**: drag kind는 신뢰 가능한 신호만 자신 있게 기록한다. **포인터 휴리스틱(source-only)** — `pointerdown`/`pointermove`/`pointerup`(capture)에 `exceedsDragThreshold`(제곱 거리 > `DRAG_THRESHOLD_PX=15`²) 임계, `pointerup`의 `elementFromPoint`는 **가드 전용**(끝 요소가 source와 다른가·자체 UI 아님·텍스트 선택 아님 — 팬·스크롤·슬라이더·텍스트선택 제외)으로만 쓰고 그 노드를 target으로 **기록하지 않는다**(dnd-kit·rbd가 포인터 아래 띄우는 드래그 고스트/portal을 `elementFromPoint`가 맞혀 드롭존을 오인하므로). `recordDrag(source)` 후 `suppressNextClick`으로 드래그가 합성한 click 1회를 삼킨다(매 `pointerdown`에서 리셋해 1제스처 한정). **네이티브 HTML5 DnD(source+target)** — `dragstart`에서 source를 `pendingNativeDrag`로 보류, `drop`의 `e.target`(브라우저가 셋팅한 신뢰 가능 드롭존)을 target으로 `recordDrag(source, target)`, 드롭 없는 `dragend`는 폐기. **중복 방지 핵심**: 네이티브 드래그 시작 시 브라우저가 `pointercancel`을 발화하므로 그 핸들러가 `dragCandidate`를 클리어해 포인터 경로를 무효화 → 네이티브 경로만 살아남는다. 즉 **`dragTarget` 존재 여부 = 신뢰 신호**(있으면 검증된 드롭존, 없으면 source-only)이며, summary/JSON/마커가 일관되게 이 유무로 분기(source-only는 `(drop target unknown)`으로 AI 목적지 환각 차단). endpoint 기술 `describeNode`는 recordClick 인라인 로직을 재사용하되 `closest` interactive 승격은 제외(실제 드래그된/드롭된 원소를 그대로).

**스트리밍 throttle**: 레코더는 버퍼를 모았다 nav 시점에만 보내지 않고, entry 발생 시 `createTrailingThrottle`(레코더는 `content/log-throttle.ts`, `FLUSH_INTERVAL_MS=200`)로 사이드패널에 **연속 stream**한다 — trailing throttle이라 로그 폭주 중에도 flush가 무한정 밀리지 않고 최대 200ms마다 1회 보장. (수신부 IDB 가드는 동일 구현의 복제본 `sidepanel/lib/trailing-throttle.ts`를 쓴다 — 위 "동기 IIFE emit" 제약 때문에 의도적 분리.) `setSentinel`은 `if (buffer.length) throttle.schedule()`로 **pre-arm 초반 버퍼를 bind 직후 소급 flush**한다. 떠나는 페이지의 마지막 꼬리는 `pagehide`/`visibilitychange(hidden)`에서 `flushNow`로 즉시 비운다. 이로써 nav 직전 동기 sync 1회에 의존하던 꼬리 손실을 줄인다(log-tail-reliability). network의 in-place phase 갱신(pending→complete/error)은 schedule을 안 켜도 다음 push·flush가 흡수(id dedup).

**수신부 IDB 가드**: 사이드패널은 store set(메모리)은 매번, IndexedDB write는 `createLogPersistGuard`(`log-persist-guard.ts`, ~1s trailing throttle)로 묶어 "마지막 push payload"만 저장. **save 실패(sync throw·reject·blob-db의 false resolve) 시 `pending`을 비우지 않아** 다음 push/flush에서 재시도(c3d87e5 회귀 수정). 30s replay trim 경로는 `discard()`로 대기 payload를 폐기해 trim 경계 밖 로그의 IDB 부활을 막는다.

**Cross-page 누적**: 네비게이션을 넘어 로그 누적. `mergeLogItems`가 id dedup + 시간 정렬 + maxEntries FIFO trim(topOrigin 주어지면 cross-origin 우선 evict — iframe 커버리지 항목 참조). `onCommitted` 시점에 `shouldClearLogs`로 초기화 판정 — cross-origin 또는 reload 시 리셋, same-origin 내부 이동은 보존. 단 사이드패널 `logClear` 핸들러가 `shouldPreserveBackgroundLogs(phase)`(recording/drafting/previewing/done)로 가드 → **녹화 중 cross-origin 이동도 로그를 유지**(진행 중 캡처가 페이지를 가로지른 한 세션이므로). `isLogFrozen(phase)` = drafting/previewing/done일 때 머지 동결.

**Freeze/Settle**: freeze 전환 직전 `syncAndSettleLogs`가 sync 후 반영 대기(store `endedAt` 증가 감지, 상한 300ms)해 진입 직전 로그를 고정. 30s replay는 settle 후 프레임 버퍼 구간으로 추가 trim.

**Cross-tab 격리**: `usePickerMessages`가 `sender.tab?.id !== myTabId`인 메시지 drop — 동일 origin 다른 탭의 로그가 섞이는 것 방지.

**로그 첨부**: `buildLogsHtml`(async)이 `dist-log-viewer/index.html` 템플릿에 데이터 주입 → self-contained HTML. 용량 최적화로 무거운 데이터(networkLog/consoleLog/actionLog/video/screenshot/report)는 gzip+base64(`gzip-base64.ts`)로 압축해 `__BUGSHOT_DATA__` 태그에, 작은 meta는 평문 `__BUGSHOT_META__` 태그에 분리 주입(제출 후 `injectIssueUrl`은 평문 meta만 함수형 치환 — 압축 blob 미접근). har/console·actionLogJson 등 파생 export는 raw 로그에서 다운로드 시점에 즉석 생성(중복 직렬화 회피, `meta.version` 사용). log-viewer는 Console/Network/Action 외 **Report 탭**(이슈 제목·재현 환경·본문 섹션 프리뷰 + 마크다운/HTML 클립보드 복사)을 추가 제공 — 본문은 `buildReportData`가 inline 이미지를 dataURL로 resolve해 임베드, 표시는 `IssuePreviewView`(PreviewPanel과 공용). **AI 초안의 로그 스코프는 캡처·첨부 매트릭스와 동일하다** — 프롬프트에 로그가 실리는 조건은 `captureLogSupport`의 `supportsConsoleNetworkLog`/`supportsActionLog`(screenshot·freeform·video)이고, `draftRich`/`draftCompact`·호출부(`AiDraftDialog`)·첨부·UI가 **모두 같은 매트릭스**를 쓴다(console/network와 action은 별도 게이트라 매트릭스가 갈라져도 compact/rich가 어긋나지 않는다). 즉 그 모드에서 **캡처된** 로그면 AI 초안 컨텍스트에 실린다. 단 이는 캡처 지원 여부(`supportsX`)만 보고 **per-log 첨부 토글**(`networkLogAttach` 등)은 **의도적으로 안 본다** — 첨부는 이슈 산출물 결정, AI 초안은 작성 보조라 분리한다(사용자가 로그 첨부를 꺼도 초안 근거로는 쓴다). BugShot의 유일한 egress 예외인 LLM 전송이므로, 첨부 토글에 정렬하자는 반론이 성립하나 "capability 기준" 유지가 확정된 설계다. (과거엔 `includesLogContext`가 video·freeform만 열어 screenshot 로그를 AI 근거로 안 썼고 action은 video 전용이라 이슈 첨부와 어긋났다 — v1.5.8 정렬로 제거.)

**로그 정책 매트릭스** — 단일 진실: `src/sidepanel/lib/captureLogSupport.ts` (`supportsConsoleNetworkLog`, `supportsActionLog`). 소비처는 UI 카드 표시(`DraftingPanel`·`PreviewPanel`·`DraftDetailDialog`의 `LogAttachmentCards`) / DraftDetailDialog blob 로드·제출 첨부 / 제출 첨부(`buildCaptureFiles` → logs.html 생성 조건) / 본문 요약 ctx 생성(`buildEditorCapture`의 `actionLogCaptured` — 여기서 게이트를 한 번 통과하면 8개 빌더의 `emitLogSummary*`가 ctx 필드만 보고 요약 줄·logs.html 링크를 낸다). **게이트를 우회해 `captureMode === "video"`를 하드코딩하면 첨부는 되는데 UI·본문이 안 따라오는 비대칭이 생긴다** — 실제로 그렇게 샜다(POSTMORTEM 2026-06-25).

| 캡처 모드 | console | network | action | 첨부 토글 기본값 |
|---|---|---|---|---|
| element | ❌ | ❌ | ❌ | — |
| screenshot | ✅ | ✅ | ✅ | on (자동) |
| freeform | ✅ | ✅ | ✅ | on (자동) |
| video | ✅ | ✅ | ✅ | on (자동) |

**세 로그는 동일 스코프**(element만 미지원) — 재현은 "무엇을 했나"(action)와 "앱이 뭘 했나"(console/network)를 같은 시계 위에서 읽는 일이라, action만 좁은 스코프를 가지면 콘솔 에러 옆에 있어야 할 클릭이 사라진다. `supportsConsoleNetworkLog`와 `supportsActionLog`가 같은 값을 반환하는 건 이 계약의 결과다(과거엔 action이 video 전용이었다).

로그 첨부 토글은 network/console/action **3종 분리**(`networkLogAttach`/`consoleLogAttach`/`actionLogAttach` + setter 3개). `initial`은 모두 false지만 캡처 모드 진입 액션(`startCapturing`/`startElementShot`/`startFreeform`/`onRecordingComplete`)이 진입 시 3종을 **일괄 true로 강제** — `...preserveLogs(prev)`로 직전 로그 *데이터*는 승계하되, 그 뒤 명시 `true`가 토글 값을 덮으므로 screenshot·freeform·video 모두 기본 on. element 모드는 로그 미지원이라 토글 자체가 무의미(`startElementShot`이 true를 세팅해도 게이트에서 전부 걸린다).

**사용자 파일 첨부**: 캡처물과 별개로 사용자가 로컬 파일을 직접 첨부할 수 있다(`AttachmentSection`/`AttachmentList`, captureMode 무관). 메타는 editor-store `attachments: UserAttachmentMeta[]`, 바이트는 blob-db(`saveAttachmentBlob`). 캡(`attachmentLimits.ts`) — 개수 10개·합계 50MB는 **하드캡**: `takeWithinLimits`가 store 단일 출처로 초과분을 드롭하고 사유(`count`/`total`)만 toast로 안내(대용량 다중 첨부의 base64 메모리 폭발 방지). 플랫폼 단건 한도는 **경고만**(차단 아님) — Notion 5MB·GitLab 10MB(`PLATFORM_FILE_SIZE_LIMIT`, 나머지 null), `checkAttachmentLimits`가 초과 항목을 빨간 테두리로 표시. 제출 시 `buildCaptureFiles`가 `userAttachments`를 captureMode와 무관하게 `attachments`로 합류시켜 8개 플랫폼이 모두 업로드(Slack은 스레드 답글에 2-step 업로드). draft 저장/복원의 blob 키 충돌은 `rekeyAttachmentBlobs`(+`whenAttachmentBlobsReady` in-flight 가드)로 재매핑.

**플랫폼별 패키징**:
- **Jira**: `logs.html` 그대로 첨부 → 이슈 생성 **후** `injectIssueUrl`로 뷰어 백링크 주입. 본문 로그 요약 안내의 `logs.html`은 제출 시 첨부 URL을 모르므로 업로드 후 `injectLogsLink`(`background/lib/adf-logs-link`)가 해당 em 노드에 link mark를 주입해 클릭 링크화(매칭 노드 없으면 평문 유지).
- **Linear**: `logs.html` 그대로 첨부 → 이슈 생성 **후** `injectIssueUrl`로 뷰어 백링크 주입. 본문은 업로드 전 빌드돼 `logs.html`이 평문이므로, 업로드로 assetUrl을 안 뒤 `injectLogsMarkdownLink`(`sidepanel/lib/markdown-logs-link`)로 안내 줄의 `logs.html`을 markdown 링크화하고 `linear.updateIssueDescription`(issueUpdate description)으로 본문을 패치(GitLab식 보강, 실패는 격리).
- **GitHub/GitLab**: `logs.html` 그대로 첨부 + 본문 로그 요약 안내에 markdown 링크(빌드 타임에 첨부 href를 알아 `emitLogSummary`가 `{file}`을 링크로 렌더). GitHub은 issueUrl 미주입(빈 값 → 뷰어가 링크 숨김), GitLab은 생성 후 `injectIssueUrl` 재업로드로 백링크 주입.
- **Notion**: **`logs.zip`** (DEFLATE 압축 zip 1파일 래핑, `zipLogsHtml`). Cloudflare WAF가 `POST /v1/file_uploads/{id}/send`에서 평문 HTML/로그 콘텐츠(스택트레이스·URL·SQL스러운 토큰)를 공격 페이로드로 오탐해 403 반환. store-mode zip도 내부가 평문이라 같은 사유로 막힘 → DEFLATE 압축 바이트는 평문 패턴 매칭 회피. 부수효과로 size ~30%로 줄어 무료 워크스페이스 5 MiB 한도 여유. 단계: 페이지 생성 전 업로드 → issueUrl 주입 불가(GitHub과 동일, 빈 값 → 뷰어 자동 숨김). 본문 텍스트는 **rich_text 원소당 2000자 한도**(초과 시 400)라 `richText()`가 2000자 청크 배열로 분할한다(서로게이트 페어 경계 보호) — heading/paragraph/code/list/table/title 전 블록 공통 경로.

**영상-로그 동기화**: `LogViewerData.video`에 영상 임베드 → log-viewer가 좌(영상)/우(3탭) 분할, `LogSeekChip`으로 행↔영상 양방향 seek + active 행 하이라이트. 동기화 0점은 `video.startedAt`. props 미공급(라이브 사이드패널 서브탭)이면 칩·active 안 생겨 기존 레이아웃 불변.

**타임라인 마커**: `markers.ts:buildMarkers`가 활성 로그 탭(console/network/action)에 따라 프로그레스 바 위에 핀 마커를 생성. 마커 variant(error/warn/info/pending/navigate/default)별 색 분류. `ProgressBar` 위에 `absolute` 핀으로 렌더, 호버 시 포탈 툴팁(stacking context clipping 방지). 마커 클릭 → `onMarkerClick` → 우측 로그 탭에서 해당 entry로 스크롤(`useScrollToEntry` 훅 — CSS.escape + 필터 리셋 후 재시도 + `scrollIntoView`). `VideoPlayer`는 커스텀 플레이어(재생/일시정지/다운로드 + 이슈 제목·키 오버레이).

**issueUrl 주입**: `buildLogsHtml`이 meta 마지막에 빈 `issueUrl:""` 예약. 이슈 생성 후 `injectIssueUrl`이 해당 자리만 치환(청크 단위 btoa로 ~20MB 블로킹 회피). Jira·Linear는 생성 후 주입, Asana·ClickUp은 create가 upload보다 먼저라 업로드 직전 주입(create-first), GitHub·Notion은 구조상 불가(빈 값 → 뷰어가 링크 숨김).

**startVideoCapture** (`video-capture.ts`): `startTabStream`으로 탭 스트림을 **먼저** 획득(activeTab 시험 — 실패 시 화면공유 폴백) → 3개 레코더(network/console/action) `activate*Recorder` → `clear*Recorder`(`prepareRecorders`) → `beginTabRecording` 순. 스트림 획득과 recorder 시작을 분리해 그 사이에 레코더 준비를 끼운다(첫 await로 activation 보존 + streamId 만료 회피). 녹화 종료(`recording→drafting`) 시 `recordersStopped=true`(`useBackgroundRecorder`)로 drafting 중 재주입 차단.

**영상 캡처 2종 — tab vs screen** (`video-capture.ts` / `video-recorder.ts`): 캡처 모드는 `captureMode:"video"`를 공유하되 `recordingSource:"tab"|"screen"`(`editor-store.ts`)으로 소스만 구분한다(라벨·아이콘 분기용). 스트림 획득 이후 본문(MediaRecorder·청크·onstop·썸네일·viewport·store 전환)은 `beginRecording(stream, tabId, {source, viewportHint?})`로 공통화.
- **탭 녹화**(`startRecording` → tabCapture `getMediaStreamId`+`getUserMedia`, 720p): viewport는 onstop의 `chrome.tabs.get`.
- **화면 녹화**(`startScreenCapture` → `getDisplayMedia({displaySurface:"monitor", ≤1920×1080, 12fps})`): viewport는 track 해상도(`trackViewport`, 없으면 `{0,0}` — 다른 모니터일 수 있어 탭 크기 폴백 금지). 사용자 취소(`NotAllowedError`)는 조용한 no-op. video track `ended`(브라우저 "공유 중지")에 `stopRecording`을 바인딩하고 그 리스너를 `onstop`·`cancelRecording` 양쪽에서 정리. 60초 상한·로그 첨부는 탭 녹화와 공통(현재 탭 로그).

**녹화 중 그리기 오버레이 (annotation pen)** (`content/annotation.ts` + 그리기 수학은 `content/annotation-draw.ts` + `sidepanel/annotation-control.ts`): 녹화 화면 위에 자유 곡선을 그려 강조하는 순수 시각 효과 — 어디에도 저장·전송하지 않는다. picker 엔트리(`content_scripts[0]`, ISOLATED) **내부 모듈**이라 별도 content_script를 늘리지 않고(3개 카운트 불변) picker의 주입 보장·메시지 라우팅을 재사용한다. **top frame 한정**(`picker.ts`의 `annotation.*` 케이스가 `window!==window.top`이면 무응답 return — 자식 iframe엔 안 그림). 도구는 **펜·사각형·형광펜** 3종 + 색·두께 — 사이드패널 RecordingState 하단 툴바(konva 에디터와 `ToolbarGroups.tsx` 공유)에서 고르면 `overlayStrokeStyle`(`recording-pen.ts`)이 tool·color·thickness를 strokeWidth/opacity로 계산해 `annotation.setTool{tool,color,strokeWidth,opacity}`(off는 `{tool:null}`인 discriminated union)로 보낸다. shadow host(`__bugshot_annotation_host`) + blocker를 마운트하고, 획은 **획당 단일 styled `<path>`**(선택 도구의 색·두께·투명도를 엘리먼트에 박음 — konva 벡터와 동일, 흰 아웃라인 없음; highlight는 두께 4배+opacity 0.4). pointermove마다 **EMA 스무딩**(`PEN_SMOOTHING_ALPHA=0.35`, shapes.ts와 동일 값·드리프트 가드). 페이드는 **requestAnimationFrame 트레일** — 각 점이 그려진 지 ~3초(`POINT_LIFETIME_MS`) 후 만료돼 `dropExpired`가 매 프레임 앞쪽(먼저 그린) 점부터 잘라 획이 **그린 순서대로 꼬리부터** 사라진다(획 전체 타이머 아님; 백그라운드 탭은 rAF가 멈춰 얼었다 복귀 시 정리). 그리기 상태의 **단일 진실 소스는 editor-store `annotationTool: 'pen'|'highlight'|null` + `annotationColor` + `annotationThickness`(모두 비영속)** — `startRecording`의 `...initial`·`onRecordingComplete` 양쪽에서 `annotationTool: null` 리셋. 라이프사이클: 캡처 성공 직후 `showAnnotation(tabId)`(`video-capture.ts`) → 종료/취소 시 `hideAnnotation(localTabId)`(`video-recorder.ts` onstop/cancel, `state=null` 전 캡처본 사용) → **녹화 중 페이지 이동** 시 `useBackgroundRecorder`의 `onTabUpdated`(status=complete) 재주입에 편승해 `showAnnotation` 재전송 + `annotationTool`이 null이 아니면 현재 color·thickness로 `setAnnotationTool` 재적용 → 패널 닫힘(picker port disconnect)의 `handleClear`에서도 `hideAnnotation`. 페이지 **Esc**는 펜 OFF + `postToRuntime({type:"annotation.penOff"})`로 사이드패널 버튼 상태를 역동기화(`usePickerMessages`). **action-recorder 오염 방지**: `isOwnUi`가 picker+annotation host 둘 다 제외(`matchesOwnHost`, MAIN world라 host id 리터럴 동기 복제) — 펜 드래그가 액션 로그에 click/drag로 안 잡히게.

**정리**: `shouldPreserveBackgroundLogs(phase)` = recording/drafting/previewing/done. idle 전환 시 레코더 재주입+새 sentinel. pending IDB는 탭 종료·이슈 저장·고아 정리(`pruneOrphanPendingLogsOncePerSession` — SW 부트 세션당 1회)에서 회수. clear→setSentinel은 sequential await 강제(fire-and-forget 시 Chrome 메시지 큐 순서 미보장으로 race).

## 캡처 3축 (영역 · 화면 · 페이지 전체)

스크린샷 모드는 별개 phase가 아니라 **`capturing` phase 하나 안의 하단 툴바 3버튼**이다(`IssueTab.tsx:CapturingState` — `capture-method-area|viewport|fullpage`). `captureMode`는 셋 다 `"screenshot"`이고 종착점도 전부 `onAreaCaptured(dataUrl, viewport)` — **새 캡처 모드가 아니므로 로그 정책 매트릭스·첨부 토글 규칙이 그대로 적용된다**. `viewport` 인자는 스티치 높이가 아니라 **실제 브라우저 뷰포트**를 넘긴다(리포트 메타 "뷰포트 크기"용).

**화면 캡처 = 드래그 완료 경로 재사용**: `area-select.ts:selectFullViewport`가 `removeListeners → cleanupElements → blocker hide → onSelected` 순서를 드래그(`onMouseUp`)와 **공유**한다 — 오버레이 정리가 캡처 요청보다 먼저 끝나야 dim·선택 사각형이 스크린샷에 안 찍힌다. `picker.ts:handleSelectFullViewport`는 `selectFullViewport` 호출만 하고 `areaSelected` 발화·정리를 **중복 작성하지 않는다**(기존 `onSelected` 콜백이 처리).

**페이지 전체 캡처**: 사이드패널이 오케스트레이터(`sidepanel/scroll-capture.ts:runScrollCapture`), content는 얇은 executor(`content/scroll-capture.ts`). 메시지 3종(`picker.beginScrollCapture` → `scrollCaptureTo{y,hideFixed}` × N → `endScrollCapture`)로 스크롤을 제어하고, 타일마다 background `captureVisibleTab`을 호출해 canvas로 세로 스티칭한다. 순수부는 `sidepanel/lib/scroll-capture-plan.ts`(`planScrollCapture`·`tileDrawRect`·`tilePixelRect`·`stitchGeometry`, 캡 `MAX_SCROLL_TILES=20`·`MAX_CANVAS_HEIGHT_PX=32000`·`MAX_OUTPUT_PIXELS=4M`).

회귀 함정이 많다. 아래 불변식을 유지한다.

- **background 관문 필수**: 타일 캡처도 `sendBg({type:"captureVisibleTab"})`만 경유한다(POSTMORTEM 2026-06-29). 직접 호출하면 초당 2회 쿼터에 즉사 — 이 경로가 `capture-throttle` 큐의 최대 소비자다(타일당 최소 500ms → 20타일 ≈ 10초, 그래서 진행률·취소 UI가 필수).
- **top frame 한정 송신**: `sendPickerTop`(frameId 0). broadcast하면 프레임마다 스크롤이 튄다.
- **탭 소유권 3중 검사**: 타일 루프가 스크롤 전·**캡처 직후** 두 번 `tab.active`를 재확인한다 — ack와 실제 캡처 사이에 캡처 큐 대기(≥500ms)가 있어 그 사이 탭이 바뀌면 남의 탭 화면이 스티치에 섞인다. 사이드패널은 `AbortController`를 소유권 토큰으로 써(`isCurrent()`) 늦게 끝난 run이 새 세션에 유령 drafting을 만들지 못하게 막고, `usePickerMessages:captureAndCrop`도 `phase==="capturing" && target.tabId` 일치를 재확인한다.
- **복원 2중 안전망**: `finally`의 `picker.endScrollCapture`(성공·실패·abort 공통) + content 자가 복원(`handleClear` = picker port disconnect 종착점). 패널이 죽어도 숨긴 고정 요소·스크롤이 잔류하지 않는다. `beginScrollCapture`도 try 안에서 보내고, content가 throw하면 `{ok:false}`(truthy)라 **`metrics` 유무로 판정**한다.
- **고정 요소는 `fixed`만, `sticky`는 보존**: sticky는 문서 흐름 안의 실제 콘텐츠(사이드바·표 헤더)라 숨기면 그 자리가 빈다 — 반복 인쇄 아티팩트보다 콘텐츠 소실이 나쁘다. `display:none`이 아니라 **`visibility:hidden !important`**(레이아웃이 바뀌면 타일 좌표가 어긋난다), 원값·priority 저장 후 복원. 수집은 **첫 스크롤 settle 이후 1회**(스크롤하면 헤더를 fixed로 바꾸는 사이트 대응), `html`·`body` 자신은 제외(iOS 스크롤락 관용구 → 백지 타일). shadow DOM·iframe 내부 fixed는 미탐(한계).
- **blocker 휠 차단**: 평상시 blocker는 wheel/touchmove에서 pointerEvents를 120ms 양보(`yieldToScroll`)하지만, 캡처 중엔 `setBlockerScrollYield(false)`로 양보를 끄고 `passive:false` 리스너가 `preventDefault`까지 건다 — pointerEvents만으론 wheel이 document로 체이닝돼 페이지가 밀리고, 그 타일이 어긋난 오프셋으로 스티칭된다(검출 수단 없음).
- **출력 픽셀 상한의 진짜 이유**: 스티치 결과는 `chrome.storage.session`(10MB 쿼터)에 dataURL로 직렬화된다. 넘치면 lite 스냅샷(`screenshotRaw: null`)으로 조용히 강등돼 **패널 재오픈 시 캡처만 사라진다**.
- **스티칭 반올림**: `tilePixelRect`가 시작·끝 경계를 **각각** 반올림한다(높이를 따로 반올림하면 분수 배율에서 타일마다 ±1px 틈). `stitchGeometry`는 캔버스 높이를 마지막 타일 dest 끝과 **같은 식**으로 산출한다(곱셈 결합 순서가 갈리면 하단에 1px 띠). 캡처 중 타일 폭이 바뀌면(리사이즈·스크롤바) 즉시 throw — 조용히 가로로 늘어나는 것보다 낫다.
- **크롭 배율 단일 구현**: `capture.ts:cropImage`가 영역·인라인·요소 캡처 공용이고 `scale = img.naturalWidth / viewport.width`로 유도한다 — **사이드패널의 `devicePixelRatio`는 페이지 줌을 모른다**(줌 150%면 크롭이 통째로 어긋나던 회귀). `stitchGeometry`의 `srcScale`도 같은 식.

## 스크린샷 주석 에디터 (Konva)

`sidepanel/components/AnnotationOverlay.tsx`(+ `annotation/` 폴더: `AnnotationToolbar`·`ShapeNode`·`ZoomControl`·`shapes.ts`·`viewport.ts`·`presets.ts`·`history.ts`, `__tests__` 포함). **드래프팅 단계의 스크린샷 주석 편집기** — 위 "녹화 중 그리기 오버레이"(content script, SVG, 순수 시각효과)와 **완전히 별개**다(react-konva 캔버스, 결과를 이미지로 flatten해 저장). react-konva/konva가 무거워 `DraftingPanel`이 `lazy`+`Suspense`(풀스크린 스피너)로 분리 마운트하고, 마운트 게이트는 `annotating && screenshotRaw`. 진입 버튼 3종은 미디어 섹션에 조건부 렌더 — `annotation-edit`(연필, `screenshotAnnotated` 유무로 add/edit 라벨 분기), `annotation-remove`(RotateCcw, `screenshotAnnotated`가 있을 때만 → `screenshotAnnotated:null` setState로 raw 복귀), 다운로드는 별개.

- **좌표계 단일화 (natural 좌표 + CSS scale)**: Stage는 이미지 자연 해상도(`natW×natH`)로 두고, 바깥 div가 표시 배율만큼의 크기를 점유, 안쪽 div가 `transform: scale()`로 실제 표시한다. 모든 도형은 natural 좌표라 **resize·줌 시 도형 리커밋 불필요**(CSS scale만 갱신). `stage.getPointerPosition()`이 컨테이너 CSS transform을 역산해 natural 좌표를 돌려주므로 포인터 핸들러는 보정 없이 그대로 쓴다(konva `Stage.js`가 `rect.width / content.clientWidth`로 배율을 역산 — **scale 전용일 때만 성립**). 레이어 2단: 배경 `KonvaImage`(`listening=false`) + 도형/Transformer 레이어. **역으로 화면 기준이어야 하는 값(hit 영역 `SELECT_HIT_WIDTH`, Transformer 앵커·보더)은 배율로 나눠 보정**한다 — 안 하면 400%에서 hit 영역이 4배로 부풀고 축소 시 앵커를 못 잡는다.
- **줌·팬 (`viewport.ts` 순수 함수 + 스크롤 뷰포트)**: 표시 배율은 `fit`(fit-width, 진입 기본) / `fitAll`(전체 조망) / `zoom`(사용자 의도)에서 파생 — `zoom: ZoomLevel = number | "all" | null`로 **숫자가 아니라 의도를 저장**해야 패널 리사이즈 시 fit/fitAll 추종이 끊기지 않는다(`resolveScale`·`normalizeZoom`·`refitZoom`). 배율 범위는 전체~400%, 프리셋은 콤보박스(`ZoomControl`). 뷰포트 크기는 `ResizeObserver`(rAF 스케줄 + `scrollbar-gutter: stable`로 배율 진동 차단) 실측. 배율 변경은 **`setZoom` → DOM 반영 → `centerAnchoredScroll`** 순서여야 한다(스크롤을 먼저 대입하면 브라우저가 옛 콘텐츠 크기로 클램프해 앵커가 깨진다). 팬은 선택 도구로 빈 캔버스 드래그 — **매 move는 React state를 거치지 않고** `viewport.scrollLeft/Top`을 직접 조작한다(move마다 리렌더하면 Stage를 통째로 다시 그린다. 제스처 시작·종료의 `panning` state 2회 리렌더만 허용 — 도형 hover가 `grabbing` 커서를 덮어쓰지 못하게 잠그는 용도). 팬 진입 게이트는 `canPan(el)`(스크롤 여지 없으면 팬 대신 **선택 해제**), 클릭/드래그 판정은 `PAN_CLICK_THRESHOLD=3px` — 그래서 **빈 곳 클릭의 선택 해제가 pointerdown이 아니라 pointerup(`endPan`)으로 밀렸다**(기존 동작 회귀 지점). 진입 도구가 `select`인 이유도 이것(진입 직후부터 세로가 넘친다). **드래그의 진실은 `window`다 — pointer capture를 쓰지 않는다.** Konva Stage는 제스처 **시작(`pointerdown`)에만** 쓰고 `pointermove`/`pointerup`/`pointercancel`은 전부 window 리스너로 받는다(`gestureRef`로 최신 핸들러를 간접 참조, `pointerId` 검증으로 두 번째 포인터가 제스처를 끝내지 못하게 한다). 두 함정을 동시에 피하려는 구조다: (a) **pointer capture 상실은 취소가 아니다** — 포인터 아래에 도형이 있는 상태로 down하면 Chrome이 제스처 도중 캡처를 암묵적으로 놓는데(`lostpointercapture`), 이걸 취소로 해석하면 진짜 `pointerup`이 튕겨나가 draft가 영구히 남아 커서를 따라다닌다. (b) **Konva의 노드 pointer 이벤트도 못 믿는다** — DOM `pointercancel`을 노드 `pointercancel`로 발화하지 않고, 포인터 아래 도형이 있으면 **`pointerup`으로 둔갑시켜** 쏜다(`Stage.js:_pointercancel`) → 취소가 커밋으로 뒤집힌다. window 경로는 Konva가 좌표를 안 실어주므로 `stagePoint()`가 `stage.setPointersPositions(e)`로 이벤트를 Stage에 직접 먹인 뒤 `getPointerPosition()`을 읽어 같은 역보정을 태운다. 이 함정은 **단위 테스트도 Playwright도 못 잡는다**(합성 입력은 암묵 해제를 유발하지 않음) — 실 Chrome에서 도형을 2개 연속(두 번째를 첫 도형 위에서 시작) 그리는 것만이 감지 수단이다(POSTMORTEM 2026-07-14).
- **도구·도형**: `ANNOTATION_TOOLS` 7종(select·pen·arrow·rect·ellipse·text·highlight, `presets.ts`). points 기반(arrow·pen·highlight)과 box 기반(rect·ellipse·text). `createShape`는 0크기로 시작하고 `handlePointerUp`이 `isEmptyShape`(rect/ellipse=면적0, arrow=시작==끝, pen/highlight=점≤2, text=빈문자열)면 커밋 없이 폐기. pen/highlight는 EMA(`PEN_SMOOTHING_ALPHA=0.35`) 입력 스무딩. 색 5종 raw hex(빨강 기본)·두께 S/M/L(2/4/8, 기본 M)·텍스트 크기 S/M/L(16/24/40)·highlight `opacity 0.4`+두께 4배.
- **히스토리**: `history.ts`의 past/present/future **3-스택** 모델(`shapes = history.present`). 모든 도형 변경이 `pushShapes`로 새 엔트리. Cmd/Ctrl+Z / +Shift=redo, Delete로 선택 삭제(editing 중 무시).
- **선택·변형 정규화**: `selectedId` + `Transformer`(rotate 가능, `ignoreStroke`). drag/transform 종료 시 `ShapeNode.commitFrom`이 노드의 imperative scale을 1로 리셋하고 `applyTransform`이 scale/rotation을 **도형 좌표에 베이크**(재변환 누적오차 방지). 단 **text 박스 리사이즈는 wrap 폭만 바꾸고 fontSize는 안 건드림**(크기 버튼 전용), **highlight 두께도 두께 버튼 전용**(transform 무시). stroke-only 도형은 hit 영역을 넓혀(`SELECT_HIT_WIDTH=24` — 화면 기준 px라 표시 배율로 나눠 적용) 경계 클릭도 잡는다. 선택 시 툴바가 그 도형의 색/두께/크기로 동기화되고, 스타일 변경은 선택 도형만 리스타일.
- **텍스트 입력**: Konva 노드가 아니라 화면 좌표로 띄운 **HTML `<textarea>`** 오버레이(Enter=줄바꿈·blur=완료·Esc=취소).
- **flatten·소비**: `handleDone`이 도형 0개면 no-op, 아니면 **Transformer 핸들을 즉시 detach**(effect 타이밍 비의존) + rAF 후 `stage.toDataURL({mimeType:"image/webp", quality:0.92, pixelRatio:1})`로 래스터화 — `pixelRatio:1`이라 **화면 배율과 무관하게 자연 해상도로 출력**. 결과는 `onAnnotated(url)` → editor-store `screenshotAnnotated`. 소비처는 전부 **`screenshotAnnotated ?? screenshotRaw` 폴백**(DraftingPanel·PreviewPanel·`getModeImages`(AI)·`buildEditorCapture`·제출 경로가 이 이미지를 IndexedDB `before` blob으로 저장). `screenshotAnnotated`는 **EditorSnapshot에 포함(세션 영속)**, 제출·리셋 시 raw와 함께 null. **주의**: 재편집이 이미 flatten된 webp 위에 다시 그려 재-flatten하므로 반복 편집 시 webp 재압축이 누적된다(알려진 열화).

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

**트리밍 (Replay Trim)**: capture()는 `onRecordingComplete` **직후** 보존한 프레임 스냅샷으로 `pendingTrim={videoBlob, frames}`를 켠다(`frames.length>=2`만 — 그 미만은 trim 무의미). App이 `pendingTrim`이면 `ReplayTrimDialog` 오버레이(`fixed inset-0 z-50 bg-background`, lazy)를 띄운다. **이때 IssueTab은 DraftingPanel을 마운트하지 않는다**(`ReplayContext.trimming` 가드) — 트림 오버레이(lazy)와 DraftingPanel의 `LazyTiptapEditor`(lazy)가 캡처 직후 동시 첫 마운트되면 두 lazy 청크가 Suspense 경쟁하다 tiptap `editor.storage.markdown` stale 접근으로 흰 화면이 됐던 회귀를 원천 차단(오버레이가 패널을 덮으니 UX 동일). 오버레이는 **아이콘 4탭**(영상/콘솔/네트워크/액션)으로 영상 재생과 인라인 로그(Console/Network/ActionLogContent)를 같은 자리에 두고, in/out 핸들을 끌면 잘려나갈 로그를 `isMuted`로 실시간 흐림 처리한다(미리보기=실제 잘림). ✓(확정)하면 `applyReplayTrim`(`apply-trim.ts`):
- `secondsToFrameRange`로 초→프레임 인덱스 환산 → `frames.slice` → `isFullRange`면 **no-op**(전체 유지 흡수, 재인코딩 생략).
- 선택 프레임만 `encodeToMp4` 재인코딩.
- **타임베이스 2갈래 분리**(sync 회귀 방지): 영상 메타(`videoStartedAt/EndedAt`)는 **raw 프레임 timestamp**(`sliced[0].timestamp` ~ `마지막+lastFrameDurationMs`). 로그 trim 경계는 **잘라낸 쪽엔 선택 프레임의 정확한 wall-clock**을 쓰고(가드 미적용 — 가드밴드는 최초 캡처 첫 프레임의 폴링 지연 보정용이라 사용자가 고른 interior 프레임 재트림엔 경계 밖 로그를 도로 끌어오는 부작용만 낸다), **안 자른 쪽만 capture 동작 보존**(앞=`inIndex===0`이면 `videoStartedAt − REPLAY_LOG_GUARD_MS`, 끝=`outIndex===last`면 상한 없음 — capture가 captureTime으로 이미 제한). 즉 capture()의 `replayLogBounds`와 달리 apply-trim은 가드를 잘라낸 경계엔 적용하지 않는다.
- capture()와 동일하게 `*Persist.discard()` 선행 후 `trimByTime`로 store 로그 재trim → `set*Log` + `save*Log("pending:${tabId}")`. 단 trim은 `set*Log` + `replaceVideo`로 인메모리 영상·로그를 원자적으로 교체한 뒤 save를 `Promise.allSettled`로 await한다(늦은 IDB write의 경계 밖 로그 부활 차단).
- **파괴적**: 확정 즉시 원본 프레임 폐기(재편집 없음). ✗(작성 취소)는 캡처 결과 폐기 + IDB pending 로그·attachment 삭제 후 진입 화면.

trim 적용 여부는 `videoTrimmed`(세션 영속 `EditorSnapshot` 키 — `onRecordingComplete`=false, `replaceVideo`=true)로 추적해 제출 분석(`replay_trimmed`)에 싣는다. 초↔프레임 매핑 순수함수(`trim-math.ts`: `frameOffsetsMs`/`secondsToFrameRange`/`isFullRange`)는 `encodeToMp4`와 동일 `MAX_FRAME_DURATION_MS`를 공유해 `<video>` 시각 드리프트를 막는다. trim-math는 로그 trim 경계 헬퍼(`replayLogTrimBounds`/`previewTrimBounds`/`isTrimmedOut`)도 export해 apply-trim의 실제 잘림과 오버레이 muted 미리보기가 **같은 경계를 공유**한다(흐림=실제잘림 parity). 마커(`trim-markers.ts` `buildErrorMarkers`)는 log-viewer `buildMarkers`를 재사용해 console error/warn + network 에러 + **action 페이지 이동(navigate)**을 표시하고, 클릭하면 해당 로그 탭으로 전환된다.

**상태 공유**: `replay-context.ts`의 `ReplayProvider`가 `isReady`/`isEncoding`/`bufferedSeconds`/`capture`/`trimming`을 공급 — `trimming`(=`pendingTrim != null`)은 IssueTab이 DraftingPanel 마운트를 보류하는 가드 신호라 context를 탄다. `pendingTrim`/`resolveTrim` 자체는 App이 훅에서 직접 받아 오버레이를 제어(context 미경유).

## AI 통합 (BYOK LLM · AI Draft · AI Styling)

이슈 작성을 돕는 두 AI 기능 — **AI Draft**(캡처 컨텍스트로 이슈 본문 초안 생성)와 **AI Styling**(자연어로 라이브 요소 스타일 편집) — 이 공용 프로바이더 추상화 위에 올라간다. 모두 **BYOK(Bring Your Own Key)** — 키·엔드포인트는 사용자가 설정하고 호출은 사이드패널에서 직접 나간다. 서버 중계 없음.

**프로바이더 추상화** (`src/sidepanel/lib/ai-provider.ts`): `AIProvider` 인터페이스 = `generate`(단발) + `createSession`(멀티턴 — `messages` 누적). 구현 3종:
- **OpenAI-compatible** (`createOpenAICompatibleProvider`): `/chat/completions`. 프리셋은 `PROVIDER_PRESETS` **7종**(OpenAI·Anthropic·Gemini·Groq·Together·OpenRouter·Ollama)이 한 배열에 있고 `kind`로 openai/anthropic 라우팅(`detectProviderKind`) + 임의 baseUrl. `responseSchema`면 `response_format: json_object`.
- **Anthropic** (`createAnthropicProvider`): `/messages`, `anthropic-dangerous-direct-browser-access` 헤더. JSON 스키마는 system에 인라인. 이미지는 base64 `source`(OpenAI는 `image_url`).
- **Chrome Built-in AI** (`createChromeAIProvider`): 온디바이스 `LanguageModel`(Prompt API). `CHROME_AI_LANG_OPTIONS`로 출력 언어 고정. 이미지·외부 전송 없음.

**프로바이더 선택·폴백** (`useAI`): `settingsUi.llm.modelId`가 있으면 BYOK(baseUrl로 `detectProviderKind` → anthropic/openai), 없으면 Chrome AI로 폴백. Chrome AI는 `availability()`로 가용성 확인 후 status 노출. 둘 다 불가면 AI UI 미노출.

**프로바이더 능력 3축** (`ProviderCapabilities`): 등급 스칼라가 아니라 독립 축이다 — `promptStyle`(compact/rich) · `supportsImages` · `contextBudgetChars`. 좌표 3종: 나노(`NANO_CAPABILITIES` — compact·이미지 불가·10k), 원격 BYOK(`BYOK_CAPABILITIES` — rich·이미지 가능·무제한), **로컬 BYOK**(`LOCAL_BYOK_CAPABILITIES` — compact·이미지 불가·8k). `byokCapabilities(baseUrl)`가 `isLocalEndpoint`(localhost·`*.localhost`·127.0.0.1·[::1])로 후자를 가른다 — Ollama 프리셋처럼 로컬에서 도는 건 통상 소형 모델이라 rich·스크린샷·무절삭을 밀면 3단 가드가 통째로 우회된다. 무제한은 `Infinity`가 아니라 `MAX_SAFE_INTEGER`(`JSON.stringify(Infinity) === "null"`).

**프롬프트 조립** (`lib/prompts/`): 본문은 `promptStyle`별로 갈린다 — compact(나노·로컬 소형)는 긍정형 지시·JSON 규칙 없음(responseConstraint가 구조 강제)·이미지 언급 0·few-shot 1쌍으로 형태를 잡고, rich는 분석 절차·인용 규칙·denied prop 목록을 문장으로 준다. 분기는 삼항이 아니라 `Record<PromptStyle, ...>` 디스패치 — style이 늘면 컴파일 에러로 잡힌다. 컨텍스트 캡은 `PROMPT_CAPS[style]` 단일 테이블. 프롬프트 줄에 들어가는 페이지 통제 문자열(action log 라벨·콘솔 메시지·디자인 토큰)은 `oneLine`으로 개행을 접어 지시 줄 위조를 막는다.

**컨텍스트 예산 3단 가드** (AI Draft): ① `fitDraftContext`가 `caps.contextBudgetChars` 초과 시 손실이 작은 것부터 버린다(level 1 로그 요약 → 2 기존 초안 → 3 스타일 diff·토큰). 절삭이 걸리면 `aiDraft.contextTrimmed` 토스트로 고지 — 조용한 열화 금지. ② `isPromptOverBudget`가 user turn 직전 `measureContextUsage`로 실측(Chrome 나노 전용 API, BYOK는 통과). ③ 그래도 터지면 `QuotaExceededError`를 `mapQuotaError`가 `AiContextOverflowError`로 승격 → `toastLlmError` 공용 토스트.

**키·권한·전송**:
- API 키는 `chrome.storage`에 `key-obfuscation.ts`(XOR+base64, `obf:` 접두사)로 난독화 저장 — 암호화 아님, 평문 노출만 차단.
- BYOK는 임의 호스트로 나가므로 연결 시 `requestHostPermission(baseUrl)`가 `chrome.permissions.request`로 해당 origin을 요청하나, required `<all_urls>`에 이미 커버돼 호출이 즉시 grant된다(프롬프트 없음). 함수 자체는 유지.
- 재시도/에러: `fetchWithRetry`가 게이트웨이/오버로드에 2회 재시도 — 대상 status는 **프로바이더별로 갈린다**(OpenAI-compatible 502·503·504 / Anthropic 502·504·529). 지연은 응답의 `retry-after` 헤더(`parseRetryAfterMs`)가 있으면 그 값이 우선하고, 없으면 1s→2s(`RETRY_DELAYS_MS`) 폴백. 429→`LlmQuotaError`, 503/529→`LlmOverloadedError`. `LLM_MAX_TOKENS=4096` 공통 상한.

**AI Draft** (`buildAiDraftPrompt.ts` + `prompts/draft{Compact,Rich}.ts`): 캡처 모드별 컨텍스트를 조립 — element(diff `current→desired`·디자인 토큰), screenshot(rich만 이미지 첨부 분석 지시 — compact은 이미지를 못 받으니 언급 자체가 없다), screenshot/video/freeform 공통(network·console 에러 요약 + action 로그). "어느 모드에 로그를 싣나"는 `captureLogSupport`(`supportsConsoleNetworkLog`/`supportsActionLog`) 단일 출처 — 본문 2개·호출부·첨부·UI가 공유(과거 `includesLogContext`를 이 매트릭스로 통합). 사용자가 이미 쓴 본문은 `existingDraft`로 "참고 후 개선" 지시(인라인 이미지 ref는 `stripInlineImageRefs`로 제거)하되, 예산 캡을 넘는 섹션은 `selectDraftSections`가 **통째로** 뺀다(중간 절단 없음). enabled 섹션별 JSON 스키마(`buildAiDraftSchema`)로 출력 강제. `parseAiDraftResponse`가 JSON 추출·title `MAX_TITLE_LENGTH` cap(프롬프트가 광고하는 상한과 같은 상수)·`stepsToReproduce` 번호 제거.

덮어쓸 때 `mergeAiSectionsPreservingImages`(`mergeAiDraftSections.ts`)가 기존 섹션의 inline 이미지를 상단에 보존하고 그 아래 LLM 텍스트를 붙인다. 여기서 `promptedSections`(= `selectDraftSections`의 `includedIds`)가 핵심 가드다 — responseConstraint가 enabled 섹션 **전부**를 required로 강제하므로 모델은 예산 절삭으로 **못 본** 섹션에도 뭔가를 채워 반환한다. 프롬프트에 안 실렸는데 prev에 원문이 있으면 그건 사용자 원문이 절삭된 것이므로, 빈 문자열이든 새로 지어낸 텍스트든 **원문을 대체하지 못한다**(둘 다 "개선 결과"가 아니다). "원문 있음" 판정은 선별과 **같은 기준**(`stripInlineImageRefs` 후 텍스트)이어야 한다 — raw로 재면 이미지 전용 섹션까지 절삭된 원문으로 오인해 AI 본문을 버린다. **title에도 같은 규칙**: `fitted.titleIncluded`가 false면(level ≥2에서 `existingDraft` 통째 폐기 등) 기존 제목을 유지한다.

**재현 과정 자동 채움** (`useReproPrefill.ts` + `generateReproPrefill.ts`): AI Draft 파이프라인을 `stepsToReproduce` **단일 섹션**으로 좁혀 재사용하는 별도 기능. **video 모드**로 drafting에 진입할 때 재현 과정이 비어 있고 AI(나노/BYOK)가 가용하며 `autoReproPrefill`(설정 토글 `재현 과정 채우기`, 기본 on)이 켜져 있고 **본문 설정의 재현 과정 섹션이 켜져 있으면**(`isReproSectionEnabled` — 발화 게이트와 설정 토글 활성이 공유하는 단일 출처. 섹션이 꺼져 있으면 채울 자리가 없으므로 미발화 + 토글은 on/off 값을 유지한 채 비활성), `generateReproStepsWithAI`가 `buildAiDraftSessionPrompt`/`buildAiDraftSchema`를 `enabledSections:[{id:"stepsToReproduce"}]`로 좁혀 액션 로그 요약만으로 재현 과정을 생성한다(title은 스키마상 강제되나 무시하고 steps만 추출, `LlmEmptyResponseError`/provider 에러는 throw→`toastLlmError` 공용 처리, AI 미가용·실패 시 **채우지 않음**). 세션 1회 가드는 **영속** 플래그 `reproPrefillDone`(EditorSnapshot 포함 — 삭제 후 재개 시 부활 방지)이고, 로딩은 **transient** 플래그 `reproPrefillLoading`을 `useAiLoading()`이 `aiDraftLoading`·`aiStylingLoading`과 함께 OR로 묶어 **App.tsx 풀패널 AI 오버레이를 공유**(별도 오버레이 없음, purple). in-flight 취소 방지를 위해 effect deps는 발화 게이트 원시 플래그만 두고 fire-input(draft/actionLog/locale 등)은 ref로 읽는다. 전체 AI Draft(제목+본문 일괄, 사용자 발동)와는 **별개 기능**. 액션 로그가 연결 AI로 나가는 egress라 privacy 고지 대상(docs/privacy). manual `✨ AI 초안 작성`은 위 AI Draft 문단 참조.

**AI Styling** (`buildAiStylingPrompt.ts` + `prompts/styling{Compact,Rich}.ts` + `aiStylingPostProcess.ts`): 요소 현재 스타일·클래스·디자인 토큰(+ rich는 레이아웃 computed 12축·뷰포트 — "가운데 정렬해줘"류를 풀 근거)을 컨텍스트로 주고, LLM이 `{ explanation, inlineStyle, classList }` JSON 반환. `parseAiStylingResponse`가 kebab 정규화 + **키 필터**(`isDeniedStyleProp` — content·animation·will-change·counter·`--*`) + **값 필터**(`isDeniedStyleValue` — `url()`의 http/https/protocol-relative 스킴 드롭. 프롬프트 컨텍스트가 페이지 통제 문자열이라 인젝션 표면이고, 응답은 라이브 페이지에 그대로 적용되므로 값으로 나가는 외부 요청을 막는다. `data:`·상대경로는 허용). 후처리 2단계(실행 순서대로): ① `replaceRawWithTokens` — raw 값을 디자인 토큰 `var()`로 치환하되, 색상은 HSL 거리(임계 `COLOR_FUZZY_THRESHOLD=50`)로 같은 family 토큰에 fuzzy 매칭, ② `mergeAiEdits` — AI가 shorthand를 내면 기존 longhand 제거(diff 행 중복 방지). 멀티턴은 전량 재주입 대신 `buildStyleDeltaBlock`/`buildClassDeltaLine` 변경분만 — 기준선은 `stylesSentInPrompt`(캡 적용 후 실제로 실린 맵). 결과는 라이브 picker 편집으로 적용돼 styleEdits 파이프라인에 합류한다.

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

Jira는 붙여넣기 시 **ProseMirror가 HTML을 해석**하므로 `ClipboardItem`으로 `text/plain`(GFM) + `text/html` 둘 다 쓴다. **캡처 미디어**(스크린샷·영상)는 Jira sanitize 대상이라 클립보드 출력에서 안내 문구로만 emit(base64 미임베드 — `buildIssueMarkdown:emitMedia`). 단 본문 섹션의 **인라인 이미지는 예외** — `resolveSectionImages`가 dataURL로 resolve해 `text/plain`·`text/html` 양쪽에 그대로 실린다(`PreviewPanel.tsx`).

구현: `buildIssueMarkdown()` + `buildIssueHtml()` 페어 (`src/sidepanel/lib/buildIssueMarkdown.ts`).

## 이슈 섹션 구성

사용자 입력 섹션 4종(`DEFAULT_ISSUE_SECTIONS` in `settings-ui-store`). 배열 순서 = 출력 순서.

| id | 기본 enabled | renderAs |
|---|---|---|
| `description` (발생 현상) | ✅ | paragraph |
| `stepsToReproduce` (재현 과정) | ✅ | orderedList |
| `expectedResult` (기대 결과) | ✅ | paragraph |
| `notes` (비고) | ⬜ | paragraph |

draft 모델: `{ title, sections: Record<string, string>, environment?: EnvironmentRow[] }`. `stepsToReproduce`는 `OrderedListEditor` 전용 UI, 나머지는 Textarea. 저장된 draft는 이슈 목록 상세(`DraftDetailDialog`)에서 제목·본문 섹션을 필드별 [수정] → `DraftEditDialog`(라이브 편집 위젯 재사용)로 인라인 편집한다 — 저장 patch는 순수 헬퍼 `applyDraftFieldEdit`가 계산해 `patchIssue`로 반영(리스트·검색 정합 위해 title은 최상위 `title`+`draft.title` 동시 갱신, `updatedAt` 주입, `id` 불변; `patchIssue` 얕은 병합 대응으로 `draft` 전체 스프레드). 편집 게이트는 순수 헬퍼 `canEditDraftFields`(`issueListUtils.ts`) = 미제출 draft **또는** Slack 보존 이슈(`isSlackPreserved`) — Slack 공유 후 트래커 승격 전 문구를 다듬을 수 있게 허용한다. Slack 보존 편집은 로컬 draft만 갱신하며(이미 발송된 Slack 메시지는 불변) 승격 시 `buildCtxForSubmit`이 그 draft를 읽어 트래커 이슈에 반영한다. 본문 섹션과 별개로 **캡처 미디어·로그 첨부·사용자 파일 첨부**(위 "사용자 파일 첨부"·"로그 정책 매트릭스" 참조)가 별도 채널로 들어가며, 자동 메타 위치 규칙에 따라 본문에 삽입되거나 첨부 영역으로 패키징된다.

**로그 1건 본문 삽입(`logToCodeBlock`)**: 캡처된 네트워크·콘솔 로그 중 사용자가 고른 1건을 코드블럭으로 본문에 넣는다(`LogInsertDialog` → `TiptapEditorHandle.insertCodeBlock` → tiptap `codeBlock` → `getMarkdown()` fence → 8개 빌더 공통 경로). 새 영속 상태·store 키·메시지가 없다 — 삽입 결과는 이미 영속되던 `draft.sections[id]` 마크다운 문자열에 녹는다. **제약**: tiptap-markdown이 코드블럭 fence를 **3백틱으로 하드코딩**하고 본문을 escape하지 않아, 로그 본문에 들여쓰기 0~3의 백틱 런이 있으면 fence가 조기 종료돼 **8개 빌더 전부가 동시에 오염된다**(로그가 평문화되고 뒤 섹션이 코드블럭에 씌워짐) — `neutralizeFences`가 그 런을 4칸 들여써 닫힘 fence 조건(들여쓰기 ≤3)을 벗어나게 만든다. 이 전제는 CommonMark 규칙이라 markdown-it 계열(Jira ADF·Notion·Asana)과 GFM(GitHub·GitLab·Linear·ClickUp)엔 통하지만, **Slack의 `markdownToMrkdwn`은 손으로 짠 라인 스캐너**라 같은 규칙(들여쓰기 ≤3)을 명시적으로 따라야 한다.

**재현 환경**: `ReproEnvironmentSection`이 모드별 메타를 readonly 표시 + `draft.environment` 사용자 정의 row 편집. 순수 헬퍼: `filterEnvironmentRows`(빈 row 제거) / `deriveReadonlyEnvRows`(모드별 파생).

**자동 메타 위치**: `POST_MEDIA_SECTION_IDS = {"expectedResult","notes"}` — 첫 해당 섹션 직전에 media/styleChanges emit. 둘 다 disabled면 모든 섹션 끝에 emit. 6종 빌더 + DraftingPanel + DraftDetailDialog에서 동일 룰. PreviewPanel·log-viewer Report 탭 프리뷰는 순수 헬퍼 `composePreviewLayout`로 이 순서를 단일화(`IssuePreviewView` 공용 컴포넌트).

**복수 element 직렬화(styleChanges)**: 한 이슈에 여러 요소의 스타일 변경을 담을 수 있다. `mergeStyleElements`(in `buildIssueMarkdown`)가 버퍼(`bufferedElements`) + 현재 요소를 selector 기준 dedup·재인덱싱해 단일 배열로 만들고, 8개 플랫폼 빌더가 모두 이 배열을 순회해 element별 섹션(selector 소제목 + before/after 스냅샷 + diff 테이블)을 emit한다(Slack은 메시지 앱이라 테이블 대신 `prop: as-is → to-be` 텍스트 줄 + 스냅샷은 스레드 첨부). 이미지 파일명은 배열 인덱스 단일 출처(`before-${i}`/`after-${i}.webp`) — 본문 빌더·`buildCaptureFiles`·Jira `injectSnapshotRows`(ADF 후처리)가 같은 인덱스를 공유해 오귀속을 막는다. 플랫폼별 렌더 차이는 어댑터 패턴대로(Jira는 ADF table에 Snapshot 행 splice, Notion은 Before/After heading 분리, Asana는 As is/To be 섹션). element 모드는 **diff 필수** — 현재 요소에 스타일 변경이 없어도 버퍼에 담긴 요소가 있으면 진행 가능하고, 현재·버퍼 둘 다 비면 drafting 진입을 막고(`hasStyleChange` 게이트 + 버퍼 체크) 요소 캡처(element-screenshot) 모드로 안내한다.

**변경사항 보기 다이얼로그(`StyleChangesDialog`)**: 스타일링 패널의 [변경사항 보기] 트리거가 여는 다이얼로그로 요소별 카드(`buildChangeGroups`로 버퍼+현재 요소를 selector 기준 그룹화)와 행 단위 diff를 보여주고 **2단계 granular 초기화**를 제공한다 — ① 행 초기화(`handleResetRow` — 행별 `ResetButton`, `removeDiffRow` + `picker.applyEditsBySelector`로 해당 prop만 selector 기준 부분 원복. 그 행이 카드의 마지막이면 `removeBufferedElement` 부수효과로 카드도 사라짐 — 별도 '요소 초기화' 버튼은 없다), ② 전체 초기화(`handleResetAll` — 현재 + 버퍼 전부 → `resetAllStyleEdits`+`resetAllEdits` → content `restoreAll`, AlertDialog 재확인). 행 초기화 후 버퍼 요소의 after 스냅샷은 `captureElementSnapshotBySelector` → `picker.prepareCaptureBySelector`(뷰포트 밖이면 `scrollIntoView` 후 캡처)로 재캡처한다. 다이얼로그 자체의 중복 호출 가드는 `busyRef`이고, 인터리브 캡처의 스크롤 원위치 복원(first-wins)은 **content script 쪽 모듈 카운터** `captureInflight`(`content/picker.ts`)가 맡는다 — 둘은 다른 레이어의 가드다. store는 `patchBufferedElement(selector, patch)`/`removeBufferedElement(selector)`로 버퍼 항목을 부분 갱신·제거(selector 미일치 시 no-op). 마지막 변경 항목이 사라지면 다이얼로그는 reactive하게 자동 닫힌다.

**스타일 편집/CSS 뷰(`styleEditorView`)**: `SelectedPanel`은 sticky 헤더(DOM 밴드 아래 `border-t` 분리)의 shadcn Tabs로 **편집/CSS 두 뷰**를 스왑한다(내부 값은 그대로 `"form"|"code"`, `useSettingsUiStore.styleEditorView`, v7 도입, 기본 `"form"`, 탭 라벨 `editor.view.*` = 편집/CSS + 아이콘 Paintbrush/Code2). 편집 뷰는 섹션별 컨트롤. **CSS 뷰(`styleEditor/StyleCssView.tsx` + lazy `CssCodeMirror.tsx`)는 CodeMirror 6 CSS 에디터**로, `serializeCssBlock(selector, {...specifiedStyles, ...inlineStyle})`(`cssBlock.ts`)로 요소의 **specified를 `selector { … }` 블록으로 prefill**해 표시한다. 표시는 `collapseTrbl`로 4면 longhand(padding/margin/inset/border-*/radius)를 shorthand로 **병합**(long→short, 폼의 링크 병합과 동형)하되, 편집 시 `expandTrbl`로 다시 longhand화해 **diff는 longhand 기준**을 유지한다(round-trip 안전 — 삭제=원복·변경 다이얼로그 정합). 편집 결과는 v1과 동일하게 `styleEdits.inlineStyle`(요소별 오버라이드) 단일 출처로 환원 — onChange → `parseCssBlock`→`expandTrbl` → `computeOverrides(parsed, expandTrbl(specified))`(specified와 다르거나 추가된 prop만 오버라이드, **specified에 있다가 지운 prop은 `initial`로 방출 = 삭제=원복**) → 폼과 동일 경로(`setStyleEdits`+`applyStyles`)로 라이브 반영. prefill 값을 안 건드리면 오버라이드 `{}`(phantom diff 없음). `parseCssBlock`/`serializeCssBlock`은 v1 `inlineCssText.ts`의 tolerant `parseInlineStyle`/`serializeInlineStyle`(top-level `;`·개행만 분리, last-wins, `--*` 케이스 보존, `!important`·임의 속성 opaque 왕복)을 재사용한다. **재동기화**는 `lastCommittedRef`에 raw가 아닌 **재구성 문자열**(`serializeCssBlock(...specified,...overrides)`)을 담아 외부 변경(폼 편집·revert·버퍼 복원·cross-origin 늦은 specified 보강)만 doc를 교체하고, **`focusedRef` 포커스 가드**로 에디터 포커스 중엔 교체를 억제(타이핑 커서 점프 방지)·blur 시 `syncFromStore`로 흡수한다. 단 **AI 스타일 적용 종료 시엔 포커스 가드를 뚫고 강행 재동기화**한다 — `docSync.ts:shouldResyncDoc({focused, aiApplied})`가 `aiApplied || !focused`라, `aiStylingLoading` true→false 전이(`StyleCssView.tsx:prevAiLoadingRef`) 시 포커스 중이어도 doc를 갱신한다. 이걸 스킵하면 포커스 상태에서 다음 타이핑이 stale doc 기준으로 AI가 넣은 값을 덮어쓴다. **요소 전환은 `key={elementKey(selection)}` remount**로 selector·specified 기준 doc를 재파생한다. 편집 뷰는 조건부 `hidden`(display:none)으로 스왑해 collapsible 접힘을 보존하고 **CSS 뷰는 `styleEditorView === "code"`에서만 조건부 마운트**(비활성 시 언마운트 — doc는 store에서 재파생하므로 무손실). class·Text 섹션은 **편집 뷰 전용**(CSS 뷰에서 hidden), 변경사항·AI 배너·푸터는 두 뷰 공통(hidden wrapper `[&>section:last-child]:border-b`로 Section `last:border-b-0` 복원). CodeMirror는 사이드패널 전용 lazy 청크(메인 번들 미포함, content script 그래프 유입 금지). 표시는 프리셋 없이(`theme="none"`) 배경·텍스트·캐럿·거터·선택색을 semantic 토큰으로 몰아 **라이트/다크를 동일 구성으로 통일**하고(oneDark 미사용), flex로 패널을 가득 채운다(`.cm-editor` flex-fill + `PageScroll`의 `contentClassName`으로 코드 뷰에서만 내부 컬럼 `min-h-full`). custom `HighlightStyle`(selector 파랑/property 앰버, 다크는 대비 shade), 색상 값/토큰 좌측 인라인 swatch(`var(--x)` 토큰은 `computedFacet`로 주입한 요소 computed의 resolve된 색), **완성된 `var(--토큰)`은 회색 칩 + hover 시 매핑 원시값 툴팁**(편집 탭 ValueHint `rightHintText` 재사용), **값이 `;`로 안 닫혀 lezer가 TagName(선택자)로 오파싱한 잘못된 선언은 앰버+취소선**(syntax-tree decoration, `{` 안쪽 TagName만), `{}`는 표시만 truncate(데이터엔 유지 — 파싱용)한다. **들여쓰기는 직렬화가 아니라 line decoration**이 담당한다 — `serializeCssBlock`은 공백·`}` 들여쓰기를 안 내고(프로포셔널 폰트 px 정렬 + 선택자 줄 제외 목적), 에디터가 body 줄에 `cm-body-indent`를 붙인다(parse는 공백 무시라 왕복 무해). **토큰 자동완성**: `var(--…)` 안에서 편집 탭 `ValueCombobox`와 **동일 제안 로직을 공유**한다 — `tokenSuggest.ts`(LIKE 필터 `filterTokensByQuery`·family/category 우선 `groupTokensByFamily`·`tokenFamilyPrefixes`·`matchRange`)를 양쪽이 재사용해, 커서가 걸친 토큰의 family를 앞세워 노출하고 선택 시 이름 전체를 교체한다(타이핑·클릭·방향키·삭제에 값 컨텍스트 게이트로 열림 — 타이머는 ViewPlugin이 소유해 destroy 시 정리). 콤보박스 스타일은 shadcn Command/TokenItem 톤(Geist Mono 13px·매칭 강조 없음·값 우측 muted). 팝업이 mono인 건 래퍼 `font-mono`가 `fontFamily:"inherit"` 체인으로 내려오기 때문이라 **`tooltips({parent})`를 설정하면 팝업이 에디터 DOM 밖에 렌더돼 상속이 끊긴다**(현재 미설정). 값 끝 `!important`는 content 공통 헬퍼 `applyInlineStyle`(`picker.ts`, `handleApplyStyles`·`handleApplyEditsBySelector` **공유**)이 `/\s*!\s*important\s*$/i`로 분리해 `setProperty(prop, base, "important")` 3-arg로 적용한다(2-arg는 `"red !important"`를 무효값으로 조용히 드롭, base가 빈 문자열이면 skip). baseline(`specifiedStyles`/`computedStyles`)은 수집 단계에서 `!important`를 strip하므로 `!important` 값은 diff에서 항상 changed(phantom diff — 허용). **1행(선택자) 편집 잠금**: doc는 `selector {\n…\n}` 포맷이라 1행에 가려진 `{`가 훼손되면 `parseCssBlock`이 inline fallback으로 깨진다 — `selectorLock.ts`의 `selectorLineProtectedRange` + `EditorState.changeFilter`로 1행을 protected range(`[0, firstLineTo]`)로 돌려 **1행에 걸친 변경만 드롭**한다. 본문 변경은 통과하므로 전체 select-all 삭제 시 선택자는 남고 선언만 비워져 **삭제=원복이 유지**된다(선택·커서 이동·복사도 허용). 행 hover·활성 줄은 `--muted` 저알파 배경으로 강조.

**제출 데이터 라이프사이클 (폐기 vs 보존)**: 이슈 제출 시 store가 두 갈래로 갈린다. 일반 트래커(Jira·GitHub 등 7종)는 `markSubmitted`→`stripSubmitted`로 draft·snapshot·styleEdits·blobKey를 비우고 6종 blob(video/image/network/console/action/attachment)을 즉시 삭제해 회수한다(submitted는 `platform/key/url`만 남김). **Slack은 정반대** — `markSlackShared(id,{key,url})`가 `status:"submitted"`·`platform:"slack"`·`slackPreserved:true`만 패치하고 draft·snapshot·blob 참조를 **그대로 보존**(`delete*Blob` 미호출). Slack은 이슈 트래커가 아니라 메시지 공유라, 나중에 정식 트래커로 **승격**할 수 있게 원본을 남긴다. 신규 작성(`IssueCreateModal.handleSlackSubmit`)·draft 재제출(`DraftDetailDialog.handleSlackSubmit`) 양쪽 Slack 경로가 모두 `markSlackShared`를 탄다. 승격 판정은 순수 헬퍼(`issueListUtils.ts`): `isSlackPreserved`(submitted+slackPreserved) → `promotableTargets`(Slack 제외 연결 플랫폼) → `canPromoteSlack`(보존 이슈 + 트래커 1개 이상). promotable 이슈는 `IssueRow` 카드 우측에 [자세히]·[승격] 버튼을 **동적 노출**(렌더 시점 `accounts` 구독 — 트래커 연결/해제에 반응), 본문 클릭은 기존 permalink 이동 불변. [승격]은 `DraftDetailDialog`를 `autoOpenSubmit`로 열어 제출 다이얼로그까지 스택하되 `submittablePlatforms`로 Slack 탭을 제외하고 `resolveInitialPlatform`으로 초기 탭을 보정한다. 일반 트래커로 승격하면 `markSubmitted`→`stripSubmitted`가 `slackPreserved`까지 폐기(`stripSubmitted`에 `slackPreserved:undefined`)해 일반 submitted로 강등한다. **승격 백링크**(`slackPromotionLink.ts`): 승격 성공 직후 원 Slack 메시지 스레드에 트래커 URL 댓글을 best-effort로 1개 남긴다(`slack.postMessage` threadTs 재사용 — 신규 메시지 타입 없음). channel은 permalink에서 파싱(`parseSlackChannelId`), thread_ts는 원 메시지 ts. `markSubmitted`/`stripSubmitted`가 `issue.url`/`key`를 트래커 값으로 덮고 `slackPreserved`를 비우므로, 원 슬랙 permalink·ts(`slackOrigin`)는 `handleSubmit` 진입 직후 핸들러 분기 **전에** 사전 캡처해야 한다. 모든 실패를 삼켜(`void` fire-and-forget) 승격 흐름을 막지 않는다. **설계 특성**: 보존 blob은 승격·삭제(`removeIssue`, id 기준 6종 정리) 전까지 IndexedDB에 잔존하므로, 정상 제출(strip 즉시 회수)보다 steady-state 저장 사용량이 늘 수 있다(적극적 만료는 비목표).

**마이그레이션**: `issues-store` v5, `settings-store` v10 (v7 gitlab·v8 asana·v9 clickup·v10 slack은 버전 마커만 bump), `settings-ui-store` v8 (v6은 `recordingMode` 추가, v7은 `styleEditorView` 추가, v8은 `autoReproPrefill` 추가 — `migrateSettingsUi`에서 `state.recordingMode = state.recordingMode ?? "tab"`·`state.styleEditorView = state.styleEditorView ?? "form"`·`state.autoReproPrefill = state.autoReproPrefill ?? true` 버전 비교 없이 nullish 병합). 각각 순수 헬퍼로 분리해 테스트 (`migrateV2ToV3`, `migrateToV5`, `migrateIssueToV4`, `migrateSettingsUi` 등). 모두 멱등 가드 + sparse 저장. 빈 paragraph는 `(없음)` (`md.noValue`)로 통일. `IssueRecord`의 비파괴 optional 필드 추가(notion 메타·`actionLogBlobKey`·`videoStartedAt`·`bufferedElements`·`slackPreserved` 등)는 버전 bump 없이 `undefined`로 안전히 읽힌다.

**녹화 모드 선택(`recordingMode`)**: 영속 설정 `settings-ui-store.recordingMode`("tab"|"screen")는 "다음 녹화에서 어느 함수를 부를지"의 입력일 뿐이고, 세션 진행 중 녹화의 소스인 `editor-store.recordingSource`와 **직교**한다. SettingsTab 캡처 설정 Tabs가 설정하고, IssueTab 캡처 진입 화면의 단일 녹화 버튼이 라이브 구독해 `startVideoCapture`(tab) / `startScreenCapture`(screen)로 분기(클릭 경로라 user gesture 보존). 진행 중 녹화엔 무관.
