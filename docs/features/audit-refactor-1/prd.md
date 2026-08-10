# audit-refactor-1 — 요청 경계·자격증명 가드

> 제품 기능이 아니라 코드베이스 감사(2026-08-11 `/audit`) 후속 정리다. 사용자 노출 동작 변경은 없다.

**단, 예외 3건은 사용자에게 보인다** — 위 문장의 "없음"에서 명시적으로 뺀다.

| 항목 | 사용자에게 보이는 변화 |
|---|---|
| 🔴1 | Jira API Token 연결 시 `http://` 주소를 넣으면 **거부 + 안내 문구**. 지금은 그냥 연결이 시도된다(그리고 자격증명이 평문으로 나간다). |
| 🟡11 | BYOK 연결에서 endpoint가 리다이렉트하면 "리다이렉트" 전용 안내(`llm.error.redirect`)가 뜬다. 지금은 일반 `llm.error.fetch`로 뭉개진다. |
| ⚪64 | notion·asana·clickup·slack의 OAuth 설정 누락 안내가 client/proxy로 갈린다(신규 i18n 키). |

나머지 항목은 전부 내부 가드·상수 공유·타입 강제라 화면에 나타나지 않는다.

## 배치 지도

이 감사는 6개 배치로 쪼개 순차 처리한다. 배치 간 파일 충돌이 없도록 계열별로 묶었다.

| 배치 | 주제 | 항목 | 규모 |
|---|---|---|---|
| **audit-refactor-1** | **요청 경계·자격증명 가드** | **🔴1 · 🟡3~5,10,11,36~41 · ⚪63~65,69,70** | **소** |
| audit-refactor-2 | 콤보박스 race·lazy-load 단일 출처 이행 | 🔴2 · 🟡42 | 중 |
| audit-refactor-3 | 레코더 게이트·무결성 | 🟡6~9,15,16,31,35 · ⚪66,67,77 | 중 |
| audit-refactor-4 | 세션·데이터 정합 | 🟡12~14,17,18 · ⚪71,73~76 | 중 |
| audit-refactor-5 | UI 접근성·디자인 토큰·i18n 정합 | 🟡19~30,32~34,60 · ⚪72,78~92 | 중 |
| audit-refactor-6 | 중복 제거·데드 코드 | 🟡43~59,61,62 · ⚪68,93~114 | 대 |

## 배경

이 배치는 **"밖으로 나가는 요청"과 "안으로 들어오는 메시지"의 경계 검증**을 한 계열로 묶은 것이다. 코드베이스에는 이미 이 계열의 가드가 셋 있다 — `src/lib/loopback-host.ts`의 `isCredentialSafeUrl`(자격증명 평문 전송 차단), `src/lib/ssrf-guard.ts`의 `isFetchableSheetUrl`(내부망 fetch 차단), `src/sidepanel/lib/ai-provider.ts:184-186`이 못박은 redirect 불변식. 문제는 **셋 다 구멍이 있다는 것**이고, 구멍의 성격이 전부 같다: 가드가 있는 경로를 보고 만든 다음 경로가 가드를 안 가져갔다.

구체적으로:

- `isCredentialSafeUrl`은 GitLab(`src/sidepanel/tabs/connect/gitlabInstanceUrl.ts:34`)과 BYOK(`src/sidepanel/tabs/settings/LlmConnectDialog.tsx:161`)에만 걸려 있다. **Jira API Token 인증은 같은 모양의 자유 입력 `baseUrl`을 받는데 가드가 없다** — `src/background/jira-api.ts:66` `resolveUrl`이 그 값을 그대로 fetch URL로 만들고, `authHeader`(:59)가 `Basic base64(email:apiToken)`을 붙인다. `http://` 인스턴스면 Jira 계정 자격증명이 평문으로 나간다.
- GitLab은 입력측 가드(`normalizeInstanceUrl`)만 있고 **egress 경계인 background에는 없다.** `src/background/messages.ts:439` `gitlab.testPat`은 `message.baseUrl`을 재검증 없이 `gitlabGetMyself`로 넘기고, 그게 `gitlab-api.ts:107`에서 fetch URL이 된다.
- redirect 불변식은 `callChatCompletions`(:503)·`callMessages`(:610)·`pingAnthropic`(:684)에 붙어 있는데 **`fetchModels`(:697)만 빠졌다.** 같은 파일이 "x-api-key는 cross-origin 리다이렉트에서 스펙상 제거되지 않는다"고 못박아 둔 그 함수가 유일한 예외다.

여기에 같은 성격의 국소 결함을 더 붙였다 — 마스킹 sentinel 문자열 스니핑(🟡10), 플랫폼 에러 직렬화의 `instanceof` 나열(🟡5), URL 경로 보간 인코딩 규율 분열(🟡37~40), SW unhandled rejection(🟡41), 메시지 sender 미검증(🟡36), OAuth 설정 누락 오분류(🟡4·⚪64). 전부 **국소 가드 추가·상수 공유·1줄 수정** 수준이라 서로 안 엉키고 한 PR로 리뷰된다.

### 감사 리포트와 실제 코드가 어긋난 3곳 (기획 중 확인)

문서를 쓰며 전 항목을 Read로 대조했고, 다음 셋은 감사 원문을 그대로 따르면 안 된다.

1. **경로 오류 2건** — `src/sidepanel/lib/gitlabInstanceUrl.ts`는 실제로 `src/sidepanel/tabs/connect/gitlabInstanceUrl.ts`, `src/sidepanel/tabs/connect/LlmConnectDialog.tsx`는 실제로 `src/sidepanel/tabs/settings/LlmConnectDialog.tsx`다.
2. **항목 38의 근거가 틀렸다** — "jira/github/gitlab-api는 전부 encode"는 절반만 맞다. `src/background/gitlab-api.ts`에는 `encodeURIComponent`가 **0개**다(`grep -c` 확인). 대신 보간되는 `projectId`·`iid`가 전부 `number` 타입이라 구조적으로 안전하다. 즉 선례는 "무조건 encode"가 아니라 **"string은 encode, number는 타입으로 보장"** 이다. 37~40의 설계는 이 진짜 선례를 따른다.
3. **항목 10의 지시(`src/lib/`에 sentinel 상수)를 그대로 못 쓴다** — 생산자인 `src/content/network-recorder.ts`는 `recorders-entry` 청크에 들어가고, 그 청크는 `src/content/` **밖 static import가 0이어야** 동기 IIFE로 emit돼 pre-arm이 산다(`scripts/check-prearm-chunk.mjs`가 게이트). 소비자(sidepanel/log-viewer)만 `src/lib/`을 쓰고 생산자는 값을 복제하되 **대조 테스트로 묶는** 설계로 간다. 상세는 design.md.

## 목표

1. **자격증명이 실린 요청은 https이거나 loopback일 때만 나간다** — Jira apiKey(🔴1)·GitLab PAT(🟡3) 두 경로에 `isCredentialSafeUrl` 게이트가 **egress 경계(background)** 에 선다. 입력측 안내는 UX용으로 별도로 둔다.
2. **BYOK 호출 4개 전부가 리다이렉트 차단 불변식을 만족한다** — `fetchModels`(🟡11)가 `redirect:"manual"` + `throwIfRedirected`를 갖는다. `ai-provider.ts:184-186`의 주석이 예외 없는 사실이 된다.
3. **마스킹 sentinel이 단일 출처를 갖는다**(🟡10) — 포맷을 바꾸면 소비처가 컴파일 또는 테스트로 깨진다. curl 스니펫에 `authorization`/`cookie` 원문이 실리는 경로가 사라진다.
4. **9번째 플랫폼을 추가하면 에러 직렬화 누락이 컴파일 에러로 잡힌다**(🟡5) — `BG_REQUEST_TYPE_MAP`이 메시지 타입에 하는 것과 같은 `satisfies Record<PlatformId, …>` 강제.
5. **API 경로 보간의 인코딩 규율이 한 규칙으로 수렴한다**(🟡37~40) — string은 `encodeURIComponent`, number는 타입으로 보장. 예외는 주석으로 사유를 남긴다.
6. **`captureVisibleTab`이 content script 출처 메시지로는 실행되지 않는다**(🟡36) — 최소 가드 1줄.
7. **SW에 unhandled rejection이 남지 않는다**(🟡41) — `src/background/index.ts`의 storage 접근 `.catch` 부착 규율이 예외 없이 적용된다.
8. **OAuth 설정 누락이 `oauthRefreshFailed`로 오분류되지 않는다**(🟡4) — github refresh가 나머지 4개 플랫폼과 같은 `assertConfigured()`를 쓴다. 원인 구분 불가한 안내 문구도 갈린다(⚪64).
9. **⚪ 4건이 정리된다** — 로그 페이로드 축소(63), `Cache-Control: no-store`(65), 토큰 저장 비대칭의 근거 주석(69), 불필요 단언 제거(70).

## 비목표 (Non-goals)

- **Jira를 Atlassian Cloud 전용으로 좁히지 않는다.** `JiraApiKeyAuth.baseUrl`(`src/types/jira.ts:3`)은 자유 문자열이고 placeholder(`https://your-workspace.atlassian.net`)는 예시일 뿐 코드 어디에도 host 제약이 없다. 이번 가드는 **스킴만** 본다(GitLab이 self-managed를 허용하면서 평문만 막는 것과 같은 모양). host 화이트리스트는 별개 결정이고 이 배치 밖이다.
- **`normalizeInstanceUrl`을 background로 옮기지 않는다.** 그건 UX용 정규화(빈 값→gitlab.com, 스킴 부착, trailing slash 제거)라 egress 가드와 목적이 다르다. background는 판정만 한다.
- **`isCredentialSafeUrl`과 `isFetchableSheetUrl`을 통합하지 않는다.** `loopback-host.ts:4-6`이 "목적이 달라 판정을 공유하지 않는다"고 이미 못박았다 — 한쪽은 loopback을 허용하고 다른 쪽은 차단한다.
- **메시지 sender 검증을 일반화하지 않는다**(🟡36). 핸들러 전체에 sender 정책 레이어를 얹는 건 과잉이다. 실제 위험이 있는 `captureVisibleTab` 한 케이스만 막는다.
- **플랫폼 토큰 저장을 난독화로 바꾸지 않는다**(⚪69). 이번엔 비대칭의 **근거를 기록**만 한다. 저장 포맷 변경은 마이그레이션을 부르므로 별도 결정 사항이다.
- **`oauth-proxy/` 배포는 하지 않는다**(⚪65). 코드만 고치고 배포 시점은 사용자가 정한다.
- **jira/github의 `oauth.error.*` i18n 키를 리네임하지 않는다.** `src/background/oauth/config.ts:38-40`이 "리네임은 i18n ko/en 동시 갱신 churn만 낳는다"고 결정을 남겼다. ⚪64는 키를 **추가**할 뿐 기존 키를 건드리지 않는다.

## 회귀 감시 지점

`/feature` 템플릿의 "사용자 시나리오"를 이 성격에 맞게 대체한다. **고치다가 깨질 수 있는 기존 동작과 그 확인법**이다.

### R1. 로컬 GitLab·로컬 LLM이 계속 붙는다 (🔴1·🟡3 리스크)

`isCredentialSafeUrl`은 loopback http를 **허용**한다. egress 게이트를 추가하며 이 예외를 빠뜨리면 ollama(`http://localhost:11434/v1`)와 로컬 GitLab(`http://localhost:8929`)이 죽는다.

- 확인: `src/lib/__tests__/loopback-host.test.ts:39-40,62`가 이미 이 케이스를 고정하고 있다. 새 게이트에도 같은 케이스를 추가한다.

### R2. gitlab.com 강제 https 정규화가 유지된다 (🟡3 리스크)

`normalizeInstanceUrl`은 `http://gitlab.com` 입력을 `https://gitlab.com`으로 **승격**시킨다(gitlabInstanceUrl.ts:30). egress 게이트를 넣으며 이 승격 경로를 건드리면 gitlab.com 사용자가 통째로 막힌다.

- 확인: `src/sidepanel/tabs/connect/__tests__/gitlabInstanceUrl.test.ts:44-45`. 이 파일은 **수정하지 않는다**(egress 게이트는 별도 테스트).

### R3. Jira OAuth 경로는 영향을 안 받는다 (🔴1 리스크)

`resolveUrl`(jira-api.ts:66)은 `auth.kind === "apiKey"`일 때만 `baseUrl`을 쓰고, oauth는 `https://api.atlassian.com/ex/jira/${cloudId}`로 간다. 게이트를 `resolveUrl` 최상단에 두면 oauth 경로까지 URL 파싱을 타게 되니 **apiKey 분기 안**에만 둔다.

- 확인: `src/background/__tests__/jira-api.test.ts`에 oauth auth로 호출하는 케이스가 이미 있다(`jira-media-id.test.ts:55` 참조). 기존 테스트 green 유지.

### R4. curl 복사·헤더 표시가 마스킹된 헤더를 계속 가린다 (🟡10 리스크)

`NetworkLogContent.tsx`의 **두 곳**(:133 curl, :565 헤더 테이블)이 같은 스니핑을 쓴다. 한쪽만 고치면 표시는 가려지는데 curl엔 실리거나 그 반대가 된다.

- 확인: 두 곳 모두 새 헬퍼를 쓰는지 grep. `src/sidepanel/components/__tests__/NetworkLogContent.test.tsx`에 마스킹 표시 케이스 추가.

### R5. log-viewer가 계속 빌드된다 (🟡10 리스크)

`src/log-viewer/App.tsx:4`가 `NetworkLogContent`를 `@/`로 재사용한다. 새 헬퍼가 sidepanel 전용 경로에 있으면 log-viewer 번들이 깨진다 → `src/lib/`에 둔다.

- 확인: `pnpm build:log-viewer`. (`pnpm test`의 pre-훅이 이미 돌린다.)

### R6. pre-arm 청크가 동기 IIFE로 남는다 (🟡10 최대 리스크)

`src/content/network-recorder.ts`에 `@/lib/...` **값 import**를 넣으면 rollup이 공유 청크를 뽑고 crxjs가 async loader로 되돌아간다. 빌드·typecheck·유닛테스트가 전부 통과한 채 pre-arm만 조용히 죽는다(`scripts/check-prearm-chunk.mjs:4-8`).

- 확인: `pnpm build` 후 `pnpm check:prearm`. 이 배치에서 **유일하게 빌드 확인이 필요한 항목**이다.

### R7. 이미 인코딩된 값·`/` 포함 값이 깨지지 않는다 (🟡37~40 리스크)

`encodeURIComponent`를 넣으면 이중 인코딩(`%2F` → `%252F`)과 경로 구분자 소실이 생길 수 있다. 각 보간값이 **API 응답에서 온 원문 식별자**인지 확인하고 넣는다.

- 확인: design.md "위험 요소"의 값별 대조표. 실제 연동 스모크(수동)로 clickup·asana·notion 각 1건 제출.

### R8. 캡처가 사이드패널에서 계속 동작한다 (🟡36 리스크)

`captureVisibleTab` 발신처는 전량 사이드패널이다(`sidepanel/capture.ts:94`, `scroll-capture.ts:43`, `usePickerMessages.ts:427,450`, `30s-replay/use-30s-replay.ts:76`). 확장 페이지는 `sender.tab`이 `undefined`고 content script는 값이 있다. 조건 방향을 뒤집으면 캡처 전량이 죽는다.

- 확인: 실 브라우저에서 영역/화면/페이지 전체 캡처 3축 + 30s Replay 각 1회.

### R9. OAuth 취소·만료 판독이 안 깨진다 (🟡5·🟡4 리스크)

`serializeOAuthError`(`src/background/oauth.ts:36-53`)와 `isOAuthCancelled`/`getOAuthErrorPlatform`(`src/types/messages.ts:300,310`)이 짝을 이룬다. `instanceof` 나열을 테이블로 바꾸며 `OAuthError` 분기가 **8개 플랫폼 에러보다 뒤에** 남아야 순서 의미가 유지된다.

- 확인: `src/background/__tests__/oauth.test.ts` green 유지. github refresh 변경은 `github-oauth.test.ts`.

## 성공 기준

- `pnpm typecheck` + `pnpm test` green.
- **9번째 플랫폼 시뮬레이션이 컴파일 에러를 낸다** — `PlatformId`에 더미 값을 임시로 추가하면 에러 직렬화 테이블이 typecheck를 깬다(확인 후 되돌린다). `BG_REQUEST_TYPE_MAP`과 같은 성질.
- **자격증명 게이트가 egress에 있다** — 사이드패널을 우회해 background 핸들러를 직접 호출해도(`gitlab.testPat`에 `http://evil.example` 주입) 요청이 나가지 않는 단위 테스트가 있다.
- **sentinel 포맷을 한쪽만 바꾸면 테스트가 깨진다** — `network-recorder.ts`의 복제 리터럴과 `src/lib/`의 단일 출처가 대조 테스트로 묶여 있다.
- `pnpm build` 후 `pnpm check:prearm` 통과.
- `pnpm coverage:report`에서 로직 스코프 라인 %가 베이스라인 대비 하락하지 않는다(신규 순수 모듈 3개가 전부 테스트를 동반하므로 상승이 기대값).
- 위 회귀 감시 R1~R9 중 자동화 가능한 R1·R2·R3·R4·R5·R6·R9는 green, 수동 대상 R7·R8은 체크리스트 완료.

## 가이드 영향

없음 — 사용자 노출 UX 변화 3건(위 표)은 전부 **에러 안내 문구**이고, `guide/`에 오류 문구를 나열하는 페이지가 없다.
