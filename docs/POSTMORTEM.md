# 회고 (Postmortems)

회귀·버그를 잡아 고칠 때마다 "왜 틀렸나 → 다음에 어떻게 막나"를 한 항목으로 남긴다. e2e 8회 루프 같은 자동 복구는 **그 자리에서** 문제를 메우지만, 같은 함정을 다음에 또 밟지 않으려면 사후분석이 코드 옆에 남아 있어야 한다. git에 커밋되는 이 파일이 그 정본이다.

작성은 `/postmortem` 스킬이 직전 픽스 컨텍스트로 자동 추가한다. 손으로 쓸 때도 아래 형식을 따른다.

## 작성 형식

각 항목은 최신순(위가 최신)으로 추가한다.

```
## YYYY-MM-DD — <한 줄 제목>

- **증상**: 사용자가 관측한 잘못된 동작.
- **근본 원인**: 코드상의 진짜 원인(표면 증상 말고).
- **재발 방지**: 다음에 같은 류를 막는 구체적 체크(grep 패턴·전수 대상·테스트).
- **관련**: 손댄 파일·핵심 함수.
```

자명한 것(git diff만 봐도 아는 것)은 빼고, **코드만 읽어선 안 보이는 구조적 함정·재발 패턴**만 남긴다.

---

## 2026-06-30 — Slack 승격 미디어 가드를 7개 트래커로 확장 (업로드 모델이 달라 균일 복제 불가 — 가능한 곳만 가드, 불가한 곳은 명시)

- **증상**: GitHub 단독 픽스(아래 항목)의 `requireMediaUpload` 가드가 **GitHub 핸들러에만** 있었다. Slack 보존 이슈를 GitHub *외* 트래커로 승격하면 동일한 미디어 업로드 부분 실패에서 여전히 `markSubmitted`가 원본을 비가역 파괴한다(아래 항목 재발방지 (3)이 경고했던 미수정 갭).
- **근본 원인**: 7개 어댑터의 업로드 모델이 제각각이라 GitHub 패턴을 그대로 복제할 수 없다. **업로드→생성 + soft-fail(href/url:null)** 인 GitHub·GitLab만 "생성 전 누락 감지 후 throw" 가드가 성립한다. 나머지는 (a) **Linear**: 미디어를 생성 전 업로드하되 실패 시 **throw**(soft-fail 맵 없음) → 가드 효과가 이미 내재, (b) **Notion**: 이미지·비디오는 생성 전 strict throw라 안전하고 **사용자 첨부(category `other`)만 soft-fail** 갭, (c) **ClickUp·Asana**: **생성→업로드 역순**(첨부에 task id/parent gid 필요)이라 업로드 실패를 안 시점엔 task가 이미 존재 → 사전 throw 가드 **구조적 불가**, (d) **Jira**: 업로드+생성이 **단일 atomic 호출**이라 프론트가 첨부 부분 실패를 신호받지 못함. "전 플랫폼에 같은 한 줄"이라는 직관이 어긋나는 지점.
- **재발 방지**: (1) **가능한 곳만 가드, 불가한 곳은 코드 주석 + 이 문서로 명시**한다(은폐 금지). 추가분: **GitLab** = GitHub 가드 직접 복제(`someUploadMissing` 재사용, `href`→`url`), **Notion** = 승격 시 `other` 첨부도 strict throw(`requireMediaUpload && category==="other"`). (2) **소실 위험이 남은 트래커**: ClickUp·Asana(생성→업로드)·Jira(atomic). 보호하려면 *사전 upload-probe* 또는 *생성 task 롤백* 또는 *background 핸들러가 첨부 실패를 반환*하도록 프로토콜 변경이 필요 — 단순 가드로 안 됨. 새 작업 전 `grep -n "승격 가드" src/sidepanel/tabs/DraftDetailDialog.tsx`로 현 상태 확인. (3) **새 트래커 어댑터를 추가할 때** 그 업로드 모델이 위 (a)~(d) 중 무엇인지 먼저 분류하고, 승격 가드 가능 여부를 `markSubmitted` 옆 주석에 박는다. (4) 단위 `submitToGitlab.test.ts`/`submitToNotion.test.ts > requireMediaUpload`(미디어/첨부 실패 → submit 0회, 로그 실패는 best-effort).
- **관련**: `src/sidepanel/lib/submitToGitlab.ts`·`submitToNotion.ts`(가드 추가), `src/sidepanel/lib/submitToGithub.ts:someUploadMissing`(재사용), 소비처 `src/sidepanel/tabs/DraftDetailDialog.tsx`(handleGitlab/Notion 가드 + Jira/Linear/Asana/ClickUp 주석), i18n `gitlab.error.mediaUploadFailed`.

---

## 2026-06-30 — Slack 이슈 GitHub 승격 실패 시 원본까지 소실 (업로드 soft-fail이 실패로 안 잡혀 비가역 파괴 진행)

- **증상**: Slack으로 제출한 이슈를 GitHub로 승격 시도 → GitHub 인증 문제로 실패했는데, 실패 후 원본 **Slack 보존 이슈까지 목록에서 사라짐**(복구 불가).
- **근본 원인**: 승격이 **원자적이지 않다**. `submitToGithub`은 2단계(`github.uploadFiles`→`github.submitIssue`)이고, 성공 resolve 시 `markSubmitted`→`stripSubmitted`가 `slackPreserved`·draft·snapshot·blob을 **전부 파괴**한다(되돌릴 수 없음). 그런데 파일 업로드 `uploadGithubFiles`는 **모든 실패 경로**(github.com 쿠키 세션 401·403, S3 에러, 탭 없음, injection 실패)를 throw가 아니라 `href: null`로 **soft-fail 반환**하고, `submitToGithub`은 `logsDropped`만 계산하고 그대로 `submitIssue`로 진행했다. 그래서 **OAuth 토큰은 살아있고(=submitIssue 성공) github.com 쿠키 세션만 죽은** 부분 실패에서, 깨진 이미지 링크의 GitHub 이슈가 생성되며 `markSubmitted`가 돌아 원본을 폐기했다. 표면("실패 후 소실")과 원인("업로드 soft-fail이 실패로 취급 안 됨 + 비가역 파괴가 업로드 성공과 무관")이 다른 레이어. 역설적으로 **OAuth 토큰 자체가 죽으면** `loadGithubAuth`가 업로드 *전에* throw해 오히려 안전 — 쿠키 세션만 죽는 부분 실패가 유일한 소실 경로라 재현이 까다로웠다.
- **재발 방지**: (1) **원본을 비가역 파괴하는 흐름(markSubmitted의 slackPreserved 폐기·blob 삭제)은 미디어 업로드 성공을 확인한 뒤에만** 진행한다 — `submitToGithub({requireMediaUpload})`가 미디어(로그 제외) href 누락 시 `submitIssue` 전에 throw해 markSubmitted 미도달·원본 보존. 승격(`isSlackPreserved`)일 때만 엄격, 일반 제출은 best-effort 유지. (2) **`uploadGithubFiles`는 절대 throw하지 않는 계약**임을 기억 — `grep -n "href: null" src/background/github-upload.ts`로 모든 실패가 soft-fail임을 확인. 호출부가 null href를 실패로 *해석*해야 하며, sendBg가 throw해 주리라 가정하면 안 된다. (3) 새 플랫폼 승격/비가역 제출을 추가할 때 `await submitToXxx` 다음 줄에서 `markSubmitted`를 부르기 전에, 그 submit이 **업로드 부분 실패를 어떻게 신호하는지**(throw인지 silent인지) 확인 — `grep -rn "markSubmitted" src/sidepanel/tabs/DraftDetailDialog.tsx`. (4) e2e `slack-promote-media-guard.spec`(미디어 업로드 실패 → submitIssue 0회·원본 불변) + 단위 `submitToGithub.test.ts > requireMediaUpload`.
- **관련**: `src/sidepanel/lib/submitToGithub.ts`(`someUploadMissing`·`requireMediaUpload` 가드), 절대 throw 안 하는 `src/background/github-upload.ts:uploadGithubFiles`, 소비처 `src/sidepanel/tabs/DraftDetailDialog.tsx:handleGithubSubmit`, 비가역 파괴 `src/store/issues-store.ts:stripSubmitted`/`markSubmitted`.

---

## 2026-06-30 — Slack 채널·멘션 직전값 미기억 (7개 어댑터 중 Slack만 prefill 우선순위 역전)

- **증상**: Slack 이슈를 제출할 때 직전에 고른 채널·멘션이 기본값으로 안 떴다. 통합 설정에 "기본 채널"을 지정해 둔 경우 그 기본 채널만 뜨고, 직전에 쓴 채널과 멘션은 매번 사라짐.
- **근본 원인**: `initialSlackFields`가 `defaults?.channelId ?? last?.channelId`로 **사용자 지정 기본 채널을 직전 제출 채널보다 우선**했다. 기본 채널이 한 번 설정되면 직전 채널이 영구히 가려지고, 멘션 복원이 `sameChannel`(last.channelId === 해석된 channelId) 게이트에 묶여 있어 기본 채널 ≠ 직전 채널이면 **멘션까지 드롭**된다. GitHub·Linear·Notion·GitLab은 동일 위상 필드(repo/team/database/project = 제출 목적지)에서 전부 **last 우선**(`last?.x ?? defaults` 또는 `last?.x ? last : defaults`)인데 Slack의 channel만 역전돼 있었다. 7개 플랫폼의 `initial*Fields`가 "제출 목적지 필드는 last 우선"이라는 같은 규칙을 공유해야 하는데 하나만 어긋난 케이스. (Asana/ClickUp이 `defaults` 우선인 건 그게 **workspace = 가장 거친 스코프**라 의도적이고, 하위 project/assignee는 `sameWs ? last : defaults`로 여전히 last를 반영 — Slack의 channel은 거친 스코프가 아니라 제출 목적지 자체라 repo/team에 대응.)
- **재발 방지**: (1) **새 플랫폼 IssueFields의 `initial*Fields`는 주 제출 목적지 필드를 last 우선**으로 박는다(`defaults`는 last가 없을 때 fallback). `grep -rn "defaults?\." src/sidepanel/tabs/*Fields/*.tsx` 또는 `grep -rln "initial.*Fields" src`로 7개 어댑터의 우선순위 일관성을 전수 대조 — `defaults?.x ?? last` 패턴이 **제출 목적지 필드**에 보이면 역전 의심. (2) Asana/ClickUp의 `defaults` 우선은 **workspace(거친 스코프) 한정** 예외임을 기억 — channel/repo/team/project/database 같은 목적지 필드는 last 우선이 규칙. (3) 단위 `SlackIssueFields.test.ts`(기본≠직전일 때 last 우선·멘션 복원) + e2e `slack-submit-gating.spec`(채널/멘션 복원).
- **관련**: `src/sidepanel/tabs/slackFields/SlackIssueFields.tsx:initialSlackFields`, 대조군(last 우선) `GithubIssueFields`/`LinearIssueFields`/`NotionIssueFields`/`GitlabIssueFields`, 소비 `src/sidepanel/hooks/usePlatformFields.ts`.

---

## 2026-06-29 — captureVisibleTab 쿼터 초과로 스냅샷 실패 (캡처 호출처 N개가 직렬화 큐 없이 경쟁)

- **증상**: 30s 리플레이가 켜진 상태에서 엘리먼트 스냅샷·스타일 before/after를 찍으면 `BgError: This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.` → 콘솔에 `[bugshot] snapshot failed`, 스냅샷 null 반환.
- **근본 원인**: Chrome `chrome.tabs.captureVisibleTab`는 **윈도우 단위로 초당 2회**(`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`) 제한인데, 캡처를 쏘는 경로가 4개(30s 리플레이 폴링 600ms·`use-30s-replay.ts`, 엘리먼트 스냅샷·`capture.ts`, 스타일 next after·`StyleEditorPanel`, element 전환 buffer·`useBufferThenSwitch`)고 전부 background `captureVisibleTab` 핸들러를 **직렬화·간격 제어 없이** 그대로 호출했다. 리플레이 폴링 단독으로도 한계 근처(~1.67회/초)라, 사용자 액션 캡처가 같은 1초 창에 끼면 초과. 표면("스냅샷 1건 실패")과 원인(**전역 캡처 호출 빈도가 쿼터를 넘음** — 한 호출처가 아니라 경합)이 다른 레이어. 리플레이 tick은 에러를 `catch {}`로 삼켜 증상이 사용자 액션 경로에서만 드러났다.
- **재발 방지**: (1) **captureVisibleTab은 반드시 한 큐로 직렬화 + 최소 간격**을 거친다 — background 핸들러가 `captureThrottle.run()` 경유(`src/background/capture-throttle.ts`). 새 캡처 경로를 추가할 때 background 핸들러를 우회해 `chrome.tabs.captureVisibleTab`을 직접 부르면 다시 깨진다. `grep -rn "captureVisibleTab" src/` 결과는 **호출처(sendBg type 발신)만** 늘어야 하고 실제 API 호출은 `messages.ts` 1곳·`capture-throttle` 경유로 유지. (2) **rate-limit은 정상 동작 — 재시도로 흡수**한다(`isCaptureRateLimitError` 매칭 시만 백오프, 그 외 에러는 즉시 throw해 탭 닫힘 등을 무한 재시도하지 않음). (3) 단위 테스트(`capture-throttle.test.ts`)로 직렬화·최소 간격·재시도·실패 격리 고정.
- **관련**: `src/background/capture-throttle.ts`(`createCaptureThrottle`·`captureThrottle`·`isCaptureRateLimitError`), 소비처 `src/background/messages.ts:captureVisibleTab` 핸들러, 테스트 `src/background/__tests__/capture-throttle.test.ts`.

---

## 2026-06-29 — 스타일 패널 Transition 섹션이 트랜지션 없어도 항상 펼침 (computed longhand 유령 기본값)

- **증상**: 스타일 에디터에서 섹션 초기 펼침 조건을 손본 뒤, Transition 섹션만 어떤 요소를 골라도 **항상 펼쳐진** 상태로 떴다. 실제로 transition이 걸린 요소가 아닌데도 "값 있음"으로 취급.
- **근본 원인**: `sectionDefaultOpen`은 specified에 키가 없으면 computed 값이 `isKnownDefault`인지로 펼침을 판단한다. 그런데 `getComputedStyle`은 **트랜지션이 전혀 없는 요소에도 transition-* longhand 4개를 항상 채워** 돌려준다(`transition-property: all`, `transition-duration: 0s`, `transition-timing-function: ease`, `transition-delay: 0s`). 이 4개가 `KNOWN_DEFAULTS`(propMetadata.ts)에 빠져 있어 `isKnownDefault`가 `false`(테이블에 prop 없음 → 기본값 아님) → 늘 "값 있음" → 항상 펼침. 표면("섹션 펼침 로직 버그")과 원인(특정 longhand 그룹의 computed 기본값 미등록)이 다른 레이어다. **getComputedStyle이 longhand로 항상 채우는 단축 프롭(transition·animation·background·font·grid 등)은 전부 같은 함정** — shorthand 섹션을 추가할 때마다 재발한다.
- **재발 방지**: (1) **새 스타일 섹션을 `SECTION_PROPS`에 추가하면 그 prop들의 computed 기본값을 `KNOWN_DEFAULTS`에 동시 등록**한다 — 안 하면 그 섹션은 무조건 펼침. `grep -n "transition\|animation\|background-\|grid-" src/sidepanel/tabs/styleEditor/propMetadata.ts`로 longhand 그룹 커버리지 확인. (2) **전수 체크**: `SECTION_PROPS`(StyleEditorPanel.tsx)의 모든 prop이 `KNOWN_DEFAULTS` 또는 `isInactiveBorderColor` 같은 별도 가드로 "기본값 판정"이 가능한지 — getComputedStyle은 거의 모든 prop을 빈값 아닌 resolve값으로 돌려주므로, KNOWN_DEFAULTS에 없으면 그 prop은 항상 활성으로 샌다. (3) 단위 테스트(`propMetadata.test.ts`)로 computed 기본값 → `isKnownDefault` true, 실제 값 → false를 섹션별로 고정.
- **관련**: `src/sidepanel/tabs/styleEditor/propMetadata.ts:KNOWN_DEFAULTS`(transition longhand 4개 추가), 판정 `isKnownDefault`, 소비처 `src/sidepanel/lib/sectionDefaultOpen.ts:sectionDefaultOpen`(StyleEditorPanel.tsx `sectionOpen`이 호출), 테스트 `styleEditor/__tests__/propMetadata.test.ts`.

---

## 2026-06-28 — 내보낸 로그 뷰어 라벨이 i18n 키 raw 노출 + 검색 placeholder stale (복제 dict 미동기화)

- **증상**: 다운로드한 `logs.html`(로그 뷰어)에서 액션 로그 필터가 번역 대신 `actionLog.filter.keypress`처럼 **키 문자열 그대로** 노출. 네트워크 탭 검색 placeholder도 "URL 검색…"이라 본문(body)까지 검색되는 걸 안내 못 함.
- **근본 원인**: log-viewer는 사이드패널과 **별도 standalone 번들**(`dist-log-viewer`, 빌드 시 사이드패널에 inline)이라 메인 React i18n 시스템을 import 못 하고 `src/log-viewer/i18n.ts`에 ko/en dict를 **수작업 복제**한다. 메인 테이블(`src/i18n/namespaces/logs.ts`)에 키가 추가(`actionLog.filter.keypress/toggle/select`)되거나 문구가 갱신(`networkLog.search`에 "·본문" 추가)될 때 복제본이 안 따라온 게 근본. 두 실패 모드가 다른 얼굴을 한다: (1) **누락** = 복제 dict에 키 자체가 없어 `t()`가 키 문자열로 폴백 → raw 노출. (2) **drift** = 키는 있는데 값이 옛 문구 → 조용히 stale. 기존 log-viewer 테스트의 ko/en 대칭 검사는 **양쪽 dict에 동시에 빠지면** 대칭이 유지돼 누락을 못 걸렀다(대칭 ≠ 완전성).
- **재발 방지**: (1) **복제 dict의 회귀는 ko/en 대칭으론 안 잡힌다 — 메인 테이블을 source of truth로 대조**해야 한다. 추가한 두 검사(`log-viewer/__tests__/i18n.test.ts`): 코드가 `t("리터럴")`로 참조하는 키 전부가 dict에 존재(누락 차단) + 메인과 공통 키는 값도 일치(drift 차단). (2) **메인 i18n 키·문구를 바꾸면 log-viewer dict도 본다** — `grep -nE '"(actionLog|networkLog|consoleLog|debug)\.' src/log-viewer/i18n.ts`로 복제 범위 확인. (3) **이미 내보낸 `logs.html`은 빌드 시점 i18n이 박혀 소급 수정 안 됨** — `pnpm build:log-viewer` 후 재내보내기 필요(고쳐도 옛 파일은 그대로). (4) 같은 "standalone 번들이 메인 모듈을 복제" 함정 류: recorder pre-arm 청크(외부 static import 0 제약, `content/log-throttle.ts` vs `sidepanel/lib/trailing-throttle.ts` 복제)도 동일 구조 — **복제본은 늘 대조 테스트로 묶는다.**
- **관련**: `src/log-viewer/i18n.ts`(복제 dict — `koDict`/`enDict`), 정본 `src/i18n/namespaces/logs.ts:logs`, 회귀 검사 `src/log-viewer/__tests__/i18n.test.ts`(`referencedKeys` 코드 스캔 + 메인 테이블 drift 대조).

---

## 2026-06-28 — 사이드패널 탭 녹화가 cross-origin 이동 후 권한 에러 (activeTab은 패널에선 재취득 불가)

- **증상**: A origin에서 사이드패널을 연 뒤 B origin으로 이동하고 탭 녹화를 누르면 `getMediaStreamId`가 "extension has not been invoked"로 거부됐다. `host_permissions: <all_urls>`를 required로 갖고 있는데도 막혀서 "광역 권한 있는데 왜?"
- **근본 원인**: 두 겹의 비자명 함정. (1) **`<all_urls>`는 `tabCapture`를 커버하지 못한다** — `captureVisibleTab`은 `<all_urls> OR activeTab`이라 30s Replay가 광역 권한으로 우회됐지만, `tabCapture.getMediaStreamId`는 host permission으로 대체 불가하고 **"현재 페이지에서 확장이 invoke됨"(activeTab) 상태가 필수**다(Chrome이 `<all_urls`로 tabCapture 허용하는 옵션을 의도적으로 거부). (2) **사이드패널 열기는 activeTab을 부여하지 않는다** — Chrome 공식 입장("패널 열기는 충분한 user intent가 아님", 변경 계획 없음). 그래서 패널을 연 invoke(아이콘 클릭/단축키)의 activeTab은 그 origin에만 유효하고, cross-origin 이동 시 회수된다. 패널 내부 버튼 클릭은 invoke가 아니라 activeTab을 새로 주지 못한다. Jam이 같은 증상을 안 겪는 건 **popup 기반**이라 매 녹화가 아이콘 클릭(=invoke)에서 시작해 현재 탭에 activeTab을 fresh하게 받기 때문 — 아키텍처 차이지 우회 트릭이 아니다.
- **재발 방지**: (1) **`chrome.permissions.request(['activeTab'])`로 activeTab을 "재취득"하려는 시도는 무효다** — activeTab은 optional permission처럼 request로 부여되지 않고 오직 사용자 invoke(action click·command 단축키·contextMenu)로만 생긴다. Jam popup이 이걸 부르는 건 popup이 이미 아이콘클릭 activeTab을 가진 상태의 보강일 뿐, 사이드패널에선 효과 없다(첫 패치가 이걸로 실패함). (2) **사이드패널에서 tabCapture가 막히면 정공법은 getDisplayMedia 폴백** — 단 user activation 보존이 관건이다. 스트림 획득(`getMediaStreamId`)을 핸들러의 **첫 await**로 빼야, 실패 시점에 activation이 살아있어 곧장 getDisplayMedia picker를 띄울 수 있다. `getMediaStreamId`는 미디어 캡처 API가 아니라 실패해도 activation을 소비하지 않는다. (3) **스트림 획득과 recorder 시작을 분리**(`startTabStream`/`beginTabRecording`)해 그 사이에 `prepareRecorders`(로그 레코더 준비)를 끼운다 — 붙여두면 폴백 위해 분리할 때 streamId 만료(수초) 위험. 로그가 녹화 시작 시점부터 잡히도록 recorder.start는 prepareRecorders 뒤. (4) 새 캡처 진입점을 추가할 때 `grep -rn 'getMediaStreamId\|getDisplayMedia\|captureVisibleTab' src`로 권한 모델(activeTab 요구 vs 광역 허용)을 분기별로 확인 — 셋이 권한 요구가 다 다르다.
- **관련**: `src/sidepanel/video-capture.ts:startVideoCapture`(첫 await로 스트림 시험 + 실패 시 `startScreenCapture(tabId,{preferTab:true})` 자동 폴백), `startScreenCapture`(폴백은 `displaySurface:"browser"`로 탭 우선, 일반은 `"monitor"`), `src/sidepanel/video-recorder.ts:startTabStream`/`beginTabRecording`(스트림 획득/recorder 시작 분리). 판정은 `isTabCaptureUnavailable`(video-capture.ts) / `isActiveTabPermissionError`(capture-error.ts).

---

## 2026-06-28 — 하드코딩 색(placeholder)·입력중·diff에서 색 swatch 누락 (value 분기만 칠함)

- **증상**: 요소 색이 `#444444`처럼 하드코딩이면 스타일 편집기 필드에 색 미리보기 사각형(swatch)이 안 떴다. 같은 hex를 사용자가 combobox로 직접 입력하면 swatch가 떴다. "prefill인데 왜 색 칩만 없나?"
- **근본 원인**: swatch가 **렌더 분기마다 따로 인라인**돼 있고 각 분기가 독립적으로 swatch 여부를 결정했다. `ValueCombobox`는 `value`(사용자 입력 = `inlineStyle[prop]`) 분기에만 swatch를 그렸고, 페이지 하드코딩 색은 `value`가 아니라 `placeholder`(`specifiedStyles`/`computedStyles`)로 들어온다. placeholder 분기는 토큰 참조(`var(...)`)만 칠하고 일반 색 리터럴은 텍스트만 표시 → 누락. 같은 누락이 manual-input 드롭다운 항목·diff 비교 뷰(`DiffValue`)에도 독립적으로 존재했다. "색이 있으면 swatch"라는 불변식이 한 곳이 아니라 **N개 렌더 분기에 흩어져** 있어, 한 분기(value)만 충족하고 나머지는 조용히 빠진 게 핵심.
- **재발 방지**: (1) **swatch는 분기마다 인라인하지 말고 단일 컴포넌트(`ColorSwatch`)를 거치게** 한다 — 색 표시 지점이 늘 때 swatch를 빠뜨릴 구조적 여지를 없앤다. 색을 텍스트로 그리는 새 지점을 추가하면 `isRenderableColorLiteral(v)`면 `ColorSwatch`도 같이. (2) **전수 점검 grep**: `grep -rn 'backgroundColor\|isRenderableColorLiteral\|ColorSwatch' src/sidepanel`로 색 렌더 지점을 모아 swatch 동반 여부 확인 — value/placeholder/manual-input/diff처럼 분기가 갈리면 각각 본다. (3) swatch 스타일도 분기·content script마다 제각각이었다(필드 10px/12px·radius 4px vs picker 툴팁 12px/3px) — `ColorSwatch`로 필드를 picker `.pl-swatch`에 통일. content script(`overlay.ts`)는 raw HTML이라 컴포넌트 공유 불가, 시각만 맞춤(리팩터 시 양쪽 동기 주의). (4) `isRenderableColorLiteral=false`(`currentColor`·`inherit`·`calc()`)는 미리보기 불가라 의도적 텍스트-only — computed는 이미 `rgb()`로 resolve돼 통과.
- **관련**: `src/sidepanel/components/ColorSwatch.tsx`(신규 — 공용 swatch, picker `.pl-swatch` 스타일 정본), `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx`(placeholder·manual-input 분기 swatch 추가), `src/sidepanel/tabs/styleEditor/TokenChip.tsx`(`TokenChip`·`TokenItem` swatch 교체), `src/sidepanel/components/StyleChangesTable.tsx:DiffValue`(diff 색값 swatch), 판정은 `colorLiteral.ts:isRenderableColorLiteral`. 같은 element 색 resolve 가족 버그는 아래 항목들 참조.

---

## 2026-06-28 — 테두리 없는 요소에 유령 border-color(글자색)가 실제 값처럼 노출

- **증상**: `course-chatbot-nine.vercel.app`의 form(`.welcome-form form`)은 DevTools Styles에 border/border-color 선언이 **전혀 없는데** BugShot 스타일 편집기가 `rgb(45, 49, 54)`를 border-color로 뿌렸다(= 그 요소의 글자색). border 섹션도 자동으로 펼쳐졌다. "DevTools엔 없는 색이 왜 뜨나?"
- **근본 원인**: 증상(border-color 값)과 원인(다른 레이어)이 어긋났다. `getComputedStyle`은 테두리가 없어도(`border-style:none`/`border-width:0`) `border-{side}-color`를 **항상 `currentColor`의 resolve값**(= `color`, 여기선 `rgb(45,49,54)`)으로 돌려준다. `propMetadata.ts`의 `KNOWN_DEFAULTS`엔 `"border-*-color": ["rgb(0, 0, 0)", "currentcolor"]`로 기본값을 박아뒀지만 **`"currentcolor"` 엔트리는 dead** — `getComputedStyle`은 그 키워드를 절대 리터럴로 안 돌려주고 이미 concrete rgb로 해석해 준다. 그래서 `isKnownDefault`가 매칭에 실패 → 유령색이 non-default로 판정 → `sectionDefaultOpen`이 섹션을 펼치고 `ValueCombobox`가 값을 실값처럼 표시. **border-color는 단독으로 의미가 없고 같은 side의 style/width에 종속**인데 그 cross-prop 가드가 없었던 게 핵심.
- **재발 방지**: (1) **dead keyword default 패턴** — `KNOWN_DEFAULTS`에 `currentcolor`/`auto`/`medium`처럼 *getComputedStyle이 concrete로 resolve해 버리는 키워드*를 적는 건 무효다. `getComputedStyle`이 그 키워드를 그대로 돌려주는지 콘솔로 먼저 확인하고 박을 것. 같은 함정이 `width/height: ["auto"]`에도 잠재(이번엔 실해 없어 미수정 — `auto`→used px라 Size 섹션이 늘 펼쳐지지만 진짜 크기라 무해). (2) **cross-prop 종속 값** — 한 prop의 의미가 다른 prop에 묶이면(border-color↔style/width) 단일 `isKnownDefault(prop, value)`로는 못 거른다. computedStyles 전체를 받는 가드(`isInactiveBorderColor`)가 필요. 비활성 = `style===none OR width===0px`(가시 조건 `style!=none AND width>0`의 드모르간). (3) 같은 판정을 쓰는 **3곳을 동시에** 맞춰야 한다 — `grep -rn 'isInactiveBorderColor\|isKnownDefault' src/sidepanel`로 `sectionDefaultOpen`(섹션 펼침)·`ValueCombobox`(값 디밍) 누락 점검. author가 명시한 값은 가드를 우회해야(`specifiedStyles` 존중) 두 경로가 일관. 순수 함수는 `propMetadata.test.ts`·`sectionDefaultOpen.test.ts`로 고정.
- **관련**: `src/sidepanel/tabs/styleEditor/propMetadata.ts:isInactiveBorderColor`(신규 — cross-prop 가드), `src/sidepanel/lib/sectionDefaultOpen.ts`(섹션 펼침 가드), `src/sidepanel/tabs/styleEditor/ValueCombobox.tsx`(`isDefault` 디밍 + specified 우회). 색 resolve의 같은 cross-origin 가족 버그는 아래 06-28 항목들 참조.

---

## 2026-06-28 — cross-origin 전용 custom prop 토큰은 이름만 뜨고 swatch/hex hint 누락

- **증상**: naver(`#account > div > a`)에서 `--color-primary-background-default` 같은 변수가 스타일 편집기에 **이름은 잘 뜨는데** 옆의 색 swatch·hex 미리보기가 안 떴다. 값(`var(--…)`)도 정상 표시. "이름은 찾았는데 왜 색 칩만 없나?"
- **근본 원인**: **변수 이름과 swatch가 서로 다른 데이터 경로**에서 나온다. 이름은 속성 값 문자열을 `extractTokenRefs`가 정규식으로 뽑아 항상 표시되지만, swatch는 `findTokenValue(tokens, name)`로 store `tokens` 배열에서 그 변수를 찾아야 칠해진다. 그 배열을 만드는 `collectTokens`(`css-resolve.ts`)는 same-origin `cssRules`(cross-origin이면 `sheet.cssRules`가 throw→`catch{}`로 skip)와 inline만 모아서, cross-origin 시트에 정의된 변수는 `tokens`에 안 들어가 `findTokenValue`가 undefined → swatch 누락. 값 경로(`mergeCrossOriginDecls`)는 이미 cross-origin 보강을 소비하는데 토큰 수집 경로만 비대칭으로 빠져 있었다(2026-06-28 위 항목·06-27 항목과 **같은 "same-origin/cross-origin 경로 비대칭" 가족**).
- **1차 fix가 불충분했던 이유 (핵심 교훈)**: 처음엔 `collectTokens`가 `getCrossOriginCustomProps()`를 merge하도록 고쳤다(변수 **정의** 수집). 그런데 그게 잡는 건 cross-origin **`:root`/`html`/`*` 전역 셀렉터** 정의뿐(`GLOBAL_CUSTOM_PROP_SELECTORS` 필터). naver는 토큰을 **스코프 셀렉터**(테마 클래스/`[data-theme]`)에 정의해서 그 필터를 빠져나가 여전히 누락. **정의 수집은 fetch 성공 + 전역 스코프 두 전제에 의존**한다. 진짜 해법은 정의가 아니라 **참조**를 모으는 것: 요소의 specified 값에 남아있는 `var(--x)` 참조 이름만 `seen`에 넣고(`collectReferencedTokenNames`), 값은 `getComputedStyle(el).getPropertyValue('--x')`가 채우게 한다 — `getComputedStyle`은 **출처·스코프·fetch 여부 무관**하게 적용된 custom prop을 concrete 값으로 해석(콘솔에서 `--color-primary-background-default` → `#03A94D` 확인). 즉 cross-origin enrichment 자체에 매달리지 말고, **브라우저가 이미 해석해 둔 computed 값을 쓰라**.
- **재발 방지**: (1) cross-origin custom prop을 다룰 땐 **"정의를 어디서 읽나"가 아니라 "computed로 이미 해석되나"**를 먼저 본다 — `getComputedStyle(el).getPropertyValue('--x')`가 값을 주면 정의 출처/스코프를 추적할 필요가 없다. 정의 수집(`getCrossOriginCustomProps`)은 전역 스코프 + fetch 성공에만 동작하는 **부분해**임을 기억(드롭다운 보조용으로는 유지). (2) cross-origin author 스타일 소비 경로가 여럿(값 resolve=`mergeCrossOriginDecls`, 토큰 수집=`collectTokens`, 역참조=`buildTokenLookup`)이라 한 곳만 고치면 조용히 빠진다 — `grep -n 'getCrossOriginCustomProps\|getMatchingCrossOriginRules' src/content/css-resolve.ts`로 점검. (3) 순수 헬퍼는 `css-resolve.test.ts > collectReferencedTokenNames`·`mergeCrossOriginTokens`로 고정. loopback e2e는 SSRF 가드로 보강 fetch가 막혀 inert지만 **참조 수집 경로는 fetch 무관**이라 same-origin var 페이지로는 e2e 가능(추후). 양성 검증은 공개 CDN·naver 수동.
- **관련**: `src/content/css-resolve.ts:collectReferencedTokenNames`(신규 — 참조 var 이름 수집, 실해법), `collectTokens`(specified 값에서 참조 수집 + `mergeCrossOriginTokens` 전역 정의 보조), `mergeCrossOriginTokens`(1차 부분해 — 전역 정의 gap-fill), `src/content/picker.ts`(`picker.collectTokens`에 `ensureCrossOriginLoaded()` await — specified에 cross-origin 룰이 잡히게), `src/content/__tests__/css-resolve.test.ts`. swatch 렌더는 `ValueCombobox.tsx`의 `findTokenValue`. 같은 element의 다른 레이어는 아래 항목들 참조.

---

## 2026-06-28 — cross-origin author 스타일에서 var() 토큰이 일부 prop만 computed로 강등

- **증상**: naver 로그인 버튼(`#account > div > a`)에서 `background-color`는 토큰(`var(--…)`)으로 잡히는데 `color`·`border-color`는 computed 리터럴로 표시. DevTools Styles엔 셋 다 `var()` 존재. "왜 일부 prop만 토큰?"
- **근본 원인**: `mergeCrossOriginDecls`(`css-resolve.ts`)가 cross-origin 매칭 룰을 seq 오름차순 **무조건 last-wins**로 병합했다. same-origin 경로(`collectRulesForElement`의 decl 루프)엔 있던 var 보존 가드(`out[name]?.includes("var(") && !val.includes("var(")` → skip)가 cross-origin 병합엔 빠져 있었다(8c949b4가 shorthand-claim 가드만 추가하며 누락). `<a>`처럼 한 prop이 여러 룰에서 재선언되면(테마 `color: var(--fg)` → 일반 `a { color:#333 }` 리셋) 이른 토큰을 나중 리터럴이 덮어 강등. `background-color`는 `<a>`에 단일 선언이라 안 덮여서 토큰 유지 → "일부 prop만 토큰" 비대칭. `styleHooks`의 `placeholder = specified || computed`라 specified가 비어서가 아니라 **리터럴로 채워져** computed처럼 보였다(빈 폴백 아님 — 강등).
- **두 번째 메커니즘 (같은 증상, 다른 원인)**: border는 naver가 `border: 1px solid var(--color-neutral-stroke-subtle-2)` **shorthand**로 선언. `border`는 width|style|color 혼합이라 `SHORTHAND_MAP`(동질 longhand 리스트/TRBL split 전제)에 없어 `expandShorthands`가 border-*-color로 전개하지 못했다 → color 토큰이 specified에 안 잡혀 computed로 폴백. 토큰 클로버(첫 메커니즘)와 별개로, **shorthand 미전개**가 원인. `parseBorderShorthand`(토큰을 width/style/color로 분류, 모호한 var는 color로)로 분해해 `border`/`border-{side}`를 변별 longhand에 fill-if-absent 전개.
- **재발 방지**: (1) specified 수집의 same-origin·cross-origin 두 경로는 **동일 시맨틱**(var 보존·shorthand claim)이어야 한다 — 가드를 한쪽에만 넣지 말 것. `grep -n 'includes("var(")' src/content/css-resolve.ts`로 대칭 점검. (2) 새 CSS shorthand를 패널에 노출할 땐 `SHORTHAND_MAP`/`TRBL_SHORTHANDS`/`BORDER_SHORTHAND_SIDES` 전개 경로에 등록됐는지 확인 — 등록 안 된 shorthand는 longhand가 통째로 빈다(border가 그 사각지대였다). 한 prop이 여러 규칙에서 재선언되는 케이스(`<a>` color + 리셋)와 shorthand-only 선언(`border: … var()`)을 회귀 테스트로 고정. 토큰 우선은 specificity 무시하는 **의도된 근사**(same-origin도 동일) — 정확한 computed는 별도 표시되므로 수용.
- **관련**: `src/content/css-resolve.ts:mergeCrossOriginDecls`(var 가드), `expandShorthands`+`parseBorderShorthand`(border 전개), `collectRulesForElement`(미러 원본), `src/content/__tests__/css-resolve.test.ts`. 같은 element(`#account > div > a`)의 다른 레이어 버그는 아래 2026-06-27 항목(섹션 펼침) 참조.

---

## 2026-06-27 — cross-origin stylesheet면 스타일 섹션이 전부 접혀 "값 있는데 안 보임"

- **증상**: naver.com 로그인 버튼(`#account > div > a`)을 picker로 선택하면 BugShot 스타일 편집기에 클래스명만 보이고 스타일 섹션이 전부 비어 보였다. 개발자도구 Styles 패널에선 정상으로 보였다.
- **근본 원인**: 두 레이어가 겹쳤다. (1) 스타일 수집의 specified(author rule) 채널은 `sheet.cssRules` 접근 시 cross-origin이면 SecurityError, fetch도 cross-origin이면 skip(`css-source-cache.ts:fetchSheetText`) → naver는 CSS가 `pstatic.net`(페이지는 `naver.com`)이라 specified가 통째로 빈다. (2) `StyleEditorPanel.tsx`의 섹션 `defaultOpen`이 specified 채널에만 묶여 있어(`props.some(p => p in specifiedStyles)`), specified가 비면 **모든 섹션이 접힌 채 시작**. computed 값(getComputedStyle, cross-origin 무관)은 살아있어 수동으로 펼치면 보였다 — 그래서 "값은 있는데 안 보임". 표면 증상은 "스타일 수집 실패"인데 사용자 체감 원인은 UI 펼침 상태였다.
- **재발 방지**: cross-origin이면 비는 채널(specifiedStyles·propSources·var() 토큰 전개)에 UI 가시성/상태를 **단독으로** 묶지 말 것 — computed fallback을 함께 본다. `grep "specifiedStyles\|propSources"`로 그 채널에 의존하는 UI 분기를 점검. 단순 `specified || computed` OR는 금물(computed는 `INTERESTING_PROPS` 전부 항상 채워서 모든 섹션이 늘 펼쳐짐) → "specified 전무일 때만 computed fallback" 분기. e2e는 `127.0.0.1` 페이지 + `localhost` stylesheet로 cross-origin 재현(`style-cross-origin-section.spec.ts`, fixture 서버 `.css`는 `text/css`로 — text/html이면 strict MIME 거부).
- **관련**: `src/sidepanel/lib/sectionDefaultOpen.ts`(신규 순수함수), `src/sidepanel/tabs/StyleEditorPanel.tsx`(`sectionOpen`), `src/content/css-source-cache.ts:fetchSheetText`(cross-origin skip 지점), `e2e/style-cross-origin-section.spec.ts`.

---

## 2026-06-25 — video + action-only일 때 logs.html이 본문에서 누락

- **증상**: 녹화(video) 모드에서 콘솔/네트워크 로그 없이 **액션 로그만** 있을 때, logs.html이 이슈에 첨부되지 않는 것처럼 보였다.
- **근본 원인**: `MarkdownContext`에 액션 로그 요약 필드가 아예 없었다. 이슈 본문 빌더 8개(`emitLogSummary*`)가 전부 `if (!net && !con) return`으로 로그 요약 섹션을 게이트해, 액션만 있으면 섹션을 통째로 스킵했다. `buildCaptureFiles`는 logs.html을 정상 생성·업로드했지만 본문이 참조(href/링크 노드)를 안 넣어 첨부가 고아가 됐다(GitLab/GitHub는 링크 누락, Jira ADF는 `injectLogsLink`가 붙을 노드 자체가 없음).
- **재발 방지**: 로그/미디어 종류를 본문에 노출·변경할 땐 `grep "emitLogSummary"`로 **8개 빌더**(buildIssueMarkdown md/html · buildIssueAdf · linear/github/gitlab/asana/notion)와 ctx 생성 **4곳**(buildMarkdownContext 헬퍼 · buildEditorMarkdownContext · PreviewPanel · DraftDetailDialog)을 전수 확인한다. 빌더 한 곳만 고치면 나머지 7곳이 조용히 빠진다. 빌더별 회귀 테스트 필수.
- **관련**: `src/sidepanel/lib/buildIssueMarkdown.ts`(`MarkdownContext.actionLogCaptured`), `buildMarkdownContext.ts`, `buildEditorCapture.ts`, 6개 플랫폼 body 빌더, `src/i18n/namespaces/logs.ts`(`logSummary.action.line`).
