# audit-refactor-1 — 구현 태스크

## 선행 조건

- **권한·env·의존성 변경 없음.** manifest·`package.json`·`pnpm-workspace.yaml`을 건드리지 않는다. 새 npm 패키지도 없다.
- **`docs/POSTMORTEM.md` 소환** — 착수 전 다음 키워드로 grep: `prearm` / `pre-arm` / `network-recorder` / `encodeURIComponent` / `OAuthError` / `captureVisibleTab` / `baseUrl`. `/implement`·`/refactor` 착수 규약이다.
- **`docs/privacy.{ko,en}.md` 트리거 대조** — 이 배치의 diff에 신규 외부 `fetch`·신규 `chrome.storage` write·신규 캡처 동작이 **없음을 확인**하고 넘어간다. 🟡36은 캡처를 *좁히는* 방향이고 ⚪63은 로그를 *줄이는* 방향이라 privacy 본문이 서술하는 동작을 넓히지 않는다. (확인만 하고 갱신하지 않는다.)
- **⚪69 판단 보류 상태 확인** — 플랫폼 토큰 평문 저장 vs BYOK 난독화의 비대칭이 의도였는지 근거가 코드에 없다. 사용자에게 확인되기 전에는 Task 14를 건너뛴다(design.md W8).

## 태스크

### Task 1: 자격증명 base URL egress 헬퍼 (테스트 먼저)

- **변경 대상**: `src/lib/credential-url.ts`(신규), `src/lib/__tests__/credential-url.test.ts`(신규), `src/i18n/namespaces/integrations.ts`
- **작업 내용**:
  - `assertCredentialSafeBase(base: string, i18nKeyPrefix: string): string` — `new URL()` 파싱 실패 시 `{prefix}.invalid`, `isCredentialSafeUrl` 실패 시 `{prefix}.insecure` 문구로 throw. 통과하면 입력을 그대로 반환.
  - 판정은 `@/lib/loopback-host`의 `isCredentialSafeUrl`에 **위임만** 한다(자체 판정 금지 — design.md W3).
  - i18n에 `jira.workspaceUrl.invalid` / `jira.workspaceUrl.insecure` 를 **ko/en 동시** 추가. gitlab 선례(`integrations.ts:78-79`)의 문구 톤을 따른다.
- **검증**:
  - [x] `https://x.atlassian.net` 통과, 입력 문자열 그대로 반환
  - [x] `http://x.atlassian.net` throw, 메시지가 `.insecure` 문구
  - [x] `http://localhost:8929` 통과 (loopback 예외 — 회귀 감시 R1)
  - [x] `http://127.0.0.1:11434` 통과
  - [x] `not-a-url` throw, 메시지가 `.invalid` 문구
  - [x] `ftp://localhost` throw (`isCredentialSafeUrl`이 스킴으로 거부)
  - [x] i18n 훅(`locales.test.ts`)이 저장 즉시 green

### Task 2: Jira apiKey egress 게이트 (🔴1)

- **변경 대상**: `src/background/jira-api.ts`, `src/background/__tests__/jira-api.test.ts`
- **작업 내용**: `resolveUrl`(:66)의 **`auth.kind === "apiKey"` 분기 안**에서 `normalizeBaseUrl` 직후 `assertCredentialSafeBase(base, "jira.workspaceUrl")` 호출. oauth 분기는 손대지 않는다.
- **검증**:
  - [x] apiKey auth + `http://jira.corp` → `jiraFetch`가 reject, `fetch` mock이 **호출되지 않음**
  - [x] apiKey auth + `https://x.atlassian.net` → 기존과 동일하게 fetch 호출
  - [x] apiKey auth + `http://localhost:8080` → 통과 (R1)
  - [x] oauth auth → `baseUrl` 없이도 `https://api.atlassian.com/ex/jira/…`로 정상 호출 (회귀 감시 R3)
  - [x] 기존 `jira-api.test.ts`·`jira-media-id.test.ts` green

### Task 3: GitLab egress 게이트 (🟡3)

- **변경 대상**: `src/background/gitlab-api.ts`, `src/background/__tests__/gitlab-api.test.ts`
- **작업 내용**: `gitlabFetch`(:100-107)의 상대 경로 분기에서 URL 조립 전 `assertCredentialSafeBase(auth.baseUrl, "gitlab.instanceUrl")`. `path.startsWith("https://")` 절대 URL 분기는 게이트 밖에 둔다.
- **검증**:
  - [x] `baseUrl: "http://gitlab.corp"` + `getMyself` → reject, fetch 미호출
  - [x] `gitlab.testPat` 경로 시뮬레이션(pat + `http://evil.example`) → reject (**성공 기준: egress가 사이드패널 우회를 막는다**)
  - [x] `http://localhost:8929` 통과 (R1)
  - [x] 절대 URL 경로(`https://…/uploads` 형태) 통과
  - [x] 기존 `gitlab-api.test.ts` green, `gitlabInstanceUrl.test.ts` **무수정** green (R2)

### Task 4: Jira 연결 폼 입력측 가드 + 단언 제거 (🔴1 · ⚪70)

- **변경 대상**: `src/sidepanel/tabs/connect/JiraConnectForm.tsx`
- **작업 내용**:
  - `ApiKeyDialog.handleValidate`(:303) 진입부에서 `new URL(trimmed.baseUrl)` 파싱 + `isCredentialSafeUrl` 검사. 실패 시 `toast.error(t("jira.workspaceUrl.invalid"|".insecure"))` 후 return. `LlmConnectDialog.tsx:152-164`와 같은 모양.
  - `config: trimmed as JiraAuth`(:309) → `config: trimmed`. `JiraApiKeyAuth`는 `JiraAuth` 유니온의 멤버라 단언이 불필요하다.
- **검증**:
  - [x] `pnpm typecheck` — 단언 제거 후에도 통과
  - [ ] (수동) `http://` 입력 시 토스트가 뜨고 `sendBg`가 호출되지 않음

### Task 5: `fetchModels` 리다이렉트 차단 (🟡11)

- **변경 대상**: `src/sidepanel/lib/ai-provider.ts`, `src/sidepanel/lib/__tests__/ai-provider.test.ts`
- **작업 내용**: `fetchModels`(:697)의 `fetch`에 `redirect: "manual"` 추가, 직후 `throwIfRedirected(res)` 호출. `pingAnthropic`(:677,:684)과 동일한 배치.
- **검증**:
  - [x] `fetch` mock이 `{ type: "opaqueredirect" }` 반환 → `LlmRedirectError` throw
  - [x] `status: 0` 반환 → `LlmRedirectError` throw
  - [x] 정상 200 응답 → 기존대로 모델 목록 정렬 반환
  - [x] `fetch` 호출 인자에 `redirect: "manual"` 포함
  - [x] `LlmConnectDialog`의 catch(:195)가 `llm.error.redirect`로 분기 — 기존 코드라 변경 불필요, grep으로 확인만

### Task 6: 마스킹 sentinel 단일 출처 (🟡10, 테스트 먼저)

- **변경 대상**: `src/lib/masked-header.ts`(신규), `src/lib/__tests__/masked-header.test.ts`(신규), `src/sidepanel/components/NetworkLogContent.tsx`, `src/content/network-recorder.ts`(주석만)
- **작업 내용**:
  - `MASKED_HEADER_PREFIX` + `isMaskedHeaderValue(value: string): boolean` 신설. `***[len:N]` 형태를 판정한다.
  - `NetworkLogContent.tsx`의 **두 곳**(`buildCurl`:133, `HeadersTable`:565)을 새 헬퍼로 교체 (회귀 감시 R4).
  - `network-recorder.ts:77-79`에 "단일 출처는 `src/lib/masked-header.ts` — pre-arm 제약으로 import 불가, 대조 테스트로 묶임" 주석 추가. **import는 추가하지 않는다.**
  - 대조 테스트: `network-recorder.ts` 소스를 `readFileSync`로 읽어 `***[len:` 리터럴이 존재하는지 확인 (log-viewer `i18n.test.ts:141`이 파일 경로를 읽어 대조하는 것과 같은 기법).
- **검증**:
  - [x] `isMaskedHeaderValue("***[len:12]")` true
  - [x] `isMaskedHeaderValue("Bearer ***abc")` false (앞이 `***`가 아님)
  - [x] `isMaskedHeaderValue("***stars in a real header value")` — 판정 결과를 테스트로 **명시적으로 고정**한다(현행 `startsWith("***")`는 true였다. 새 판정이 더 엄격해지면 그 변화가 의도임을 테스트가 증언한다)
  - [x] `network-recorder.ts`가 sentinel 리터럴을 여전히 갖는다 (대조 테스트)
  - [x] `NetworkLogContent.tsx`에 `startsWith("***")`가 **0건** (grep)
  - [x] `pnpm build:log-viewer` 성공 (R5)
  - [x] `pnpm build && pnpm check:prearm` 통과 (**R6 — 이 배치 유일의 빌드 필수 지점**)

### Task 7: 플랫폼 에러 직렬화 컴파일 강제 (🟡5, 테스트 먼저)

- **변경 대상**: `src/background/platformErrors.ts`(신규), `src/background/__tests__/platformErrors.test.ts`(신규), `src/background/index.ts`
- **작업 내용**:
  - `PLATFORM_ERROR_CTORS`를 `satisfies Record<PlatformId, …>`로 정의하고 `serializePlatformError(error): {status, body} | null` 노출.
  - `index.ts:194-249`의 `instanceof` 8분기를 호출 1개로 교체. **`OAuthError` 분기는 그 뒤에 그대로 유지**(design.md W5).
  - `bgRequestTypes.ts:3-6` 톤의 사유 주석을 남긴다.
- **검증**:
  - [x] 8개 에러 각각에 대해 `{status, body}` 반환
  - [x] `SlackError`(시그니처가 다름)도 `status`·`body` 반환
  - [x] 무관한 `Error` → `null`
  - [x] `OAuthError` → `null` (플랫폼 테이블에 없으므로 다음 분기로 넘어가야 한다)
  - [x] `src/background/__tests__/oauth.test.ts` green (R9)
  - [x] **컴파일 강제 확인**: `PlatformId`에 더미 멤버를 임시 추가하면 `pnpm typecheck` 실패. 확인 후 되돌린다

### Task 8: URL 경로 보간 인코딩 (🟡37~40)

- **변경 대상**: `src/background/clickup-api.ts`, `src/background/asana-api.ts`, `src/background/notion-api.ts`, `src/background/github-upload.ts` + 각 `__tests__`
- **작업 내용**:
  - clickup 10곳(:107,133,137,181,197,208,239,249,255,264) — string 보간 전량 `encodeURIComponent`.
  - asana — 경로 보간(:221,231,244)은 `encodeURIComponent`. **쿼리(`workspace=`, :146,162)는 `URLSearchParams` 사용을 우선 검토**(`gitlab-api.ts:159-166`·`notion-api.ts:188` 선례). 어느 쪽이든 `opt_fields`·`limit`도 같은 방식으로 묶는다.
  - notion 3곳(:260,692,704) — `encodeURIComponent`.
  - github-upload `ensureGithubTab`(:13) — `owner`·`repo` 각각 `encodeURIComponent`. 같은 값이 `messages.ts:311`에서 이미 인코딩된다.
  - `gitlab-api.ts`는 **건드리지 않는다** — 보간값이 전부 `number`라 타입으로 안전하다(design.md "기존 패턴 준수").
- **검증**:
  - [x] 각 api 파일의 fetch mock이 받는 URL에 인코딩이 반영됨 (id에 `#`·공백을 넣은 케이스)
  - [x] 정상 id(영숫자)에서는 URL 문자열이 **변경 전과 동일** — 이중 인코딩 없음 (design.md W1)
  - [x] `github-upload.ts`는 로직 스코프 제외라 유닛 테스트 없음 → grep으로 인코딩 적용 확인
  - [ ] (수동, R7) clickup·asana·notion 각 1건 실제 이슈 제출 성공

### Task 9: `captureVisibleTab` sender 가드 (🟡36)

- **변경 대상**: `src/background/messages.ts`
- **작업 내용**: `handleMessage`의 `_sender` → `sender`, `captureVisibleTab` case(:204) 최상단에 `if (sender.tab) throw new Error(...)`. 다른 핸들러는 손대지 않는다.
- **검증**:
  - [x] `pnpm typecheck`
  - [ ] (수동, R8) 영역/화면/페이지 전체 캡처 + 30s Replay 각 1회 정상 동작
  - [ ] `messages.ts`는 로직 스코프 제외 — 유닛 테스트 대신 e2e `capture.spec.ts`·`capture-methods.spec.ts` green으로 확인

### Task 10: SW unhandled rejection 방지 (🟡41)

- **변경 대상**: `src/background/index.ts`
- **작업 내용**: `:129`(`onBeforeNavigate`의 `chrome.storage.session.get`)와 `:176`(`onCommitted`의 `Promise.all`) 체인 끝에 `.catch(() => {})` 부착. 같은 파일 `:101-111`·`:148-161`이 이미 그 형태다.
- **검증**:
  - [x] `pnpm typecheck`
  - [x] `index.ts`에서 `void `로 시작하면서 `.catch`가 없는 promise 체인이 **0건** (grep)

### Task 11: github refresh 설정 누락 분류 (🟡4)

- **변경 대상**: `src/background/github-oauth.ts`, `src/background/__tests__/github-oauth.test.ts`
- **작업 내용**: `refreshGithubToken`(:150-154)의 `if (!isGithubOAuthConfigured()) throw new OAuthError(...)` 를 `assertConfigured()` 호출로 교체. 나머지 4개 플랫폼 refresh(`oauth.ts:245`, `linear-oauth.ts:154`, `gitlab-oauth.ts:155`, `asana-oauth.ts:128`)와 같아진다.
- **검증**:
  - [x] clientId 누락 시 `notConfigured: true` + `reason: "config_missing"`
  - [x] proxyUrl 누락 시 동일
  - [x] `serializeOAuthError`가 status **400** + `oauthNotConfigured` 반환 (기존은 401 + `oauthRefreshFailed`)
  - [x] `src/background/__tests__/connect-reason-coverage.test.ts` green
  - [x] 기존 문구를 고정한 단언이 있으면 갱신 (design.md W6)

### Task 12: OAuth 설정 누락 문구 분리 (⚪64)

- **변경 대상**: `src/background/oauth/config.ts`, `src/i18n/namespaces/integrations.ts`
- **작업 내용**: notion(:78)·asana(:101)·clickup(:114)·slack(:127)의 `notConfiguredProxyKey`를 각 플랫폼의 신규 `*.oauth.notConfiguredProxy` 키로 교체. ko/en 동시 추가. jira·github의 `oauth.error.*`는 **건드리지 않는다**(config.ts:38-40의 결정).
- **검증**:
  - [x] i18n 훅(`locales.test.ts`) green — ko/en 대칭
  - [x] `src/background/__tests__/oauth-client-id.test.ts` green
  - [x] `t()` 미해결 키가 없음 (`TranslationKey` 타입이 컴파일로 강제)

### Task 13: 로그 페이로드 축소 (⚪63)

- **변경 대상**: `src/background/messages.ts`
- **작업 내용**: `:880`의 `JSON.stringify([...uploadMap.entries()])`를 `[...uploadMap.keys()]`(파일명 목록)로 축소. 실패한 첨부 식별에는 파일명으로 충분하고 mediaId·URL은 SW 콘솔에 남을 이유가 없다.
- **검증**:
  - [x] grep으로 `uploadMap.entries()` 로깅 0건
  - [x] `pnpm typecheck`

### Task 14: 토큰 저장 비대칭 근거 주석 (⚪69) — **조건부**

- **변경 대상**: `src/store/settings-store.ts`
- **작업 내용**: `:265` 위에 플랫폼 토큰 평문 저장 vs BYOK 난독화(`settings-ui-store.ts:251`) 비대칭의 근거를 한 줄 주석으로.
- **검증**:
  - [x] **선행**: 사용자가 근거를 확인해줬는가? 아니면 이 태스크를 스킵하고 그대로 남긴다 (design.md W8 — 추측한 사유를 주석으로 박지 않는다)

### Task 15: OAuth 프록시 캐시 금지 헤더 (⚪65)

- **변경 대상**: `oauth-proxy/worker.ts`
- **작업 내용**: `relayUpstream`(:434-443) 응답 헤더에 `"Cache-Control": "no-store"` 추가.
- **검증**:
  - [x] `oauth-proxy/` 테스트가 있으면 green, 없으면 `pnpm typecheck` 범위 확인
  - [x] **배포는 하지 않는다** — 코드만 반영, 배포 시점은 사용자가 정한다

## 테스트 계획

CLAUDE.md 2트랙을 따른다. 이 배치는 **전량 node 트랙(`*.test.ts`)** 이다 — 컴포넌트 렌더가 상태 전이를 좌우하는 항목이 없다.

### 단위 테스트 (`*.test.ts`, node) — 신규 인터페이스는 **테스트 먼저**

| 파일 | 대상 | 케이스 |
|---|---|---|
| `src/lib/__tests__/credential-url.test.ts` (신규) | `assertCredentialSafeBase` | https 통과 / http 거부 / loopback 예외 2종 / 파싱 실패 / 비-http 스킴 / 반환값 동일성 |
| `src/lib/__tests__/masked-header.test.ts` (신규) | `isMaskedHeaderValue` + 생산자 리터럴 대조 | sentinel 양성 / 유사 문자열 음성 / 빈 문자열 / `network-recorder.ts` 소스에 리터럴 존재 |
| `src/background/__tests__/platformErrors.test.ts` (신규) | `serializePlatformError` | 8개 플랫폼 각각 / `OAuthError` → null / 일반 Error → null |
| `src/background/__tests__/jira-api.test.ts` (갱신) | `resolveUrl` 게이트 | apiKey http 거부(fetch 미호출) / https 통과 / loopback 통과 / oauth 무영향 |
| `src/background/__tests__/gitlab-api.test.ts` (갱신) | `gitlabFetch` 게이트 | http 거부 / testPat 우회 시나리오 거부 / loopback 통과 / 절대 URL 통과 |
| `src/sidepanel/lib/__tests__/ai-provider.test.ts` (갱신) | `fetchModels` | opaqueredirect → `LlmRedirectError` / status 0 → 동일 / 정상 200 / `redirect:"manual"` 인자 |
| `src/background/__tests__/clickup-api.test.ts` 외 2 (갱신) | 인코딩 | 특수문자 id 인코딩 / 정상 id는 URL 불변 |
| `src/background/__tests__/github-oauth.test.ts` (갱신) | refresh 설정 누락 | client 누락 / proxy 누락 → `notConfigured` + `config_missing` |

**`*.test.tsx`(jsdom) 신규 없음** — Task 4(JiraConnectForm)는 폼 인터랙션이지만 판정 로직 전량이 Task 1의 순수 함수에 있고, 컴포넌트 쪽은 토스트 호출뿐이라 렌더 테스트의 가치가 낮다. `NetworkLogContent.test.tsx`는 **기존 파일이 green으로 유지되는지만** 확인한다(Task 6이 판정을 순수 함수로 뺐으므로 새 케이스는 `masked-header.test.ts`에 둔다).

### e2e 시나리오

**신규 spec 없음.** 이 배치의 항목은 전부 국소 가드이고, 기존 spec이 회귀 그물로 충분하다. 다음이 green이어야 한다.

- `e2e/logs-prearm.spec.ts` — Task 6이 pre-arm을 깨지 않았다 (R6 2차 그물)
- `e2e/capture.spec.ts` · `e2e/capture-methods.spec.ts` — Task 9의 sender 가드가 정상 캡처를 막지 않는다 (R8)
- `e2e/log-capture.spec.ts` · `e2e/network-body-search.spec.ts` — Task 6이 네트워크 로그 표시를 깨지 않았다

### 수동 테스트 (Chrome, `pnpm build` 선행 필수)

- [x] **R6** `pnpm build && pnpm check:prearm` — 동기 IIFE 유지 확인 (**최우선**)
- [ ] **R7** ClickUp·Asana·Notion 각 1건 실제 이슈 제출 성공 (인코딩 회귀 — 유닛으로 못 잡는다)
- [ ] **R8** 영역/화면/페이지 전체 캡처 3축 + 30s Replay 각 1회
- [ ] 🔴1 Jira API Token 연결에 `http://` 입력 → 토스트, `https://` 입력 → 정상 연결
- [ ] 🟡3 GitLab PAT 연결(gitlab.com·self-managed https) 정상
- [ ] 🟡10 네트워크 로그에서 `authorization` 헤더가 있는 요청의 **curl 복사** → 스니펫에 원문 없음, `# -H '…: [masked by BugShot]'` 주석 존재
- [ ] 🟡11 BYOK 커스텀 endpoint 연결 정상(리다이렉트 없는 정상 엔드포인트가 계속 붙는지)

## 구현 순서 권장

```
Task 1 (헬퍼+i18n) ──┬─▶ Task 2 (jira egress)
                     ├─▶ Task 3 (gitlab egress)
                     └─▶ Task 4 (jira 폼 + ⚪70)

Task 6 (sentinel) ──▶ [빌드 검증 R6]        ← 가장 위험. 단독으로 먼저 끝내고 검증
Task 7 (에러 테이블) ──▶ 독립
Task 8 (인코딩) ──▶ 독립  (파일 4개 병렬 가능)
Task 5, 9, 10, 11→12, 13, 15 ──▶ 전부 독립
Task 14 ──▶ 조건부(사용자 확인 대기)
```

- **1순위: Task 6** — 유일하게 빌드 검증이 필요하고 실패가 무음이다. 먼저 끝내고 `pnpm build && pnpm check:prearm`으로 확정한 뒤 나머지로 넘어간다.
- **2순위: Task 1 → 2·3·4** — Task 1이 나머지 셋의 선행. 2·3·4는 서로 독립이라 병렬.
- **3순위: Task 11 → 12** — 12가 11이 쓰는 키 테이블을 건드리므로 순서 고정.
- **병렬 가능**: Task 5 / 7 / 8 / 9 / 10 / 13 / 15는 서로 파일이 겹치지 않는다. 단 Task 9·13은 둘 다 `messages.ts`라 순차로.
- **마지막**: `pnpm typecheck` → `pnpm test` → `pnpm build && pnpm check:prearm` → `pnpm coverage:report`.

## 가이드 영향

없음 — 사용자 노출 변화 3건(prd.md 상단 표)은 전부 에러 안내 문구이고, `guide/ko`·`guide/en`에 오류 문구를 나열하는 페이지가 없다.
