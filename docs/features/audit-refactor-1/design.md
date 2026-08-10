# audit-refactor-1 — 기술 설계

## 개요

세 갈래의 국소 수정이다. ① **자격증명 egress 게이트** — 이미 존재하는 `isCredentialSafeUrl`을 Jira·GitLab의 fetch 직전 단일 choke point(`jira-api.ts:resolveUrl`, `gitlab-api.ts:gitlabFetch`)에 붙인다. 입력측 폼 가드는 UX용으로 **추가로** 둔다(가드가 둘이 되지만, 하나는 안내이고 하나는 방어선이다). ② **불변식의 예외 제거** — `fetchModels`의 redirect 누락, sentinel 문자열 스니핑, `instanceof` 나열, 인코딩 규율 분열을 각각 단일 출처/컴파일 강제로 닫는다. ③ **위생 수정** — sender 가드 1줄, `.catch` 2곳, 로그 축소, `no-store` 헤더, 근거 주석, 단언 제거.

새 파일은 3개뿐이고 전부 순수 함수 모듈이다: `src/lib/masked-header.ts`, `src/background/platformErrors.ts`, `src/lib/credential-url.ts`(선택 — 아래 A안 참조). 나머지는 기존 파일 내 수정이다.

## 변경 범위

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/lib/masked-header.ts` | 네트워크 로그 마스킹 sentinel의 **단일 출처**. 포맷 상수 + `isMaskedHeaderValue()`. 생산자(content)는 리터럴을 복제하고 대조 테스트로 묶는다(아래 "항목 10" 참조). |
| `src/background/platformErrors.ts` | 8개 플랫폼 API 에러의 `satisfies Record<PlatformId, …>` 테이블 + `serializePlatformError()`. `src/background/index.ts`의 `instanceof` 8분기를 대체. |

### 기존 파일 수정

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/background/jira-api.ts` | Jira REST 클라이언트. `resolveUrl`(:66)이 apiKey면 `normalizeBaseUrl(auth.baseUrl)+path`, oauth면 Atlassian Cloud 고정 URL | 🔴1 — `resolveUrl`의 **apiKey 분기 안**에 `isCredentialSafeUrl` 게이트 추가 |
| `src/background/gitlab-api.ts` | GitLab REST 클라이언트. `gitlabFetch`(:105-107)가 `auth.baseUrl + /api/v4 + path`로 URL 조립 | 🟡3 — `gitlabFetch`의 URL 조립 직전 게이트 추가(stored auth·`testPat` 양쪽 커버) |
| `src/sidepanel/tabs/connect/JiraConnectForm.tsx` | Jira 연결 폼. `ApiKeyDialog`(:278~)가 `baseUrl`을 `trim()`만 하고 `jira.myself`로 전송(:294-310) | 🔴1 입력측 — `handleValidate` 진입 시 URL 파싱 + `isCredentialSafeUrl`. ⚪70 — `trimmed as JiraAuth`(:309) 단언 제거 |
| `src/sidepanel/lib/ai-provider.ts` | BYOK LLM 프로바이더. `fetchModels`(:691-703)만 `redirect:"manual"`·`throwIfRedirected` 누락 | 🟡11 — 나머지 3개 호출(:497,:599,:677)과 동일하게 맞춤 |
| `src/sidepanel/components/NetworkLogContent.tsx` | 네트워크 로그 뷰. `buildCurl`(:129)·`HeadersTable`(:565) 두 곳이 `v.startsWith("***")` 스니핑 | 🟡10 — 두 곳 모두 `isMaskedHeaderValue()`로 교체 |
| `src/content/network-recorder.ts` | MAIN world 네트워크 후크. `maskHeaderValue`(:77-79)가 `***[len:N]` 생산 | 🟡10 — 리터럴은 유지하고 "단일 출처는 `src/lib/masked-header.ts`" 주석 + 대조 테스트 대상화. **import는 추가하지 않는다**(pre-arm 제약) |
| `src/background/index.ts` | SW 엔트리·메시지 라우터. `instanceof` 8분기(:194-249), `void …then()` 2곳(:129,:176) | 🟡5 — 분기를 `serializePlatformError()`로 대체. 🟡41 — `.catch(() => {})` 부착 |
| `src/background/messages.ts` | BG 요청 핸들러. `handleMessage(message, _sender)`(:196-199), Jira 첨부 로그(:880) | 🟡36 — `captureVisibleTab` case에 sender 가드. ⚪63 — `uploadMap` 덤프를 키 목록으로 축소 |
| `src/background/github-oauth.ts` | GitHub OAuth. `refreshGithubToken`(:150-154)이 `isGithubOAuthConfigured()` + 맨 `OAuthError` | 🟡4 — `assertConfigured()` 호출로 교체 |
| `src/background/oauth/config.ts` | OAuth 플랫폼 설정 테이블 | ⚪64 — notion·asana·clickup·slack의 `notConfiguredProxyKey`를 전용 키로 분리 |
| `src/background/clickup-api.ts` | ClickUp REST. 경로 보간 10곳 무인코딩(:107,133,137,181,197,208,239,249,255,264) | 🟡38 — string 보간 전량 `encodeURIComponent` |
| `src/background/asana-api.ts` | Asana REST. :146,162(`workspace=`), :221,231,244(`/tasks/`) | 🟡39 — 동일 |
| `src/background/notion-api.ts` | Notion REST. :260(`/databases/`), :692,704(`/pages/`) | 🟡40 — 동일 |
| `src/background/github-upload.ts` | GitHub 첨부 업로드. `ensureGithubTab`(:13)이 탭 URL 무인코딩 조립 | 🟡37 — `encodeURIComponent` (같은 값이 `messages.ts:311`에선 이미 인코딩됨) |
| `src/store/settings-store.ts` | 플랫폼 계정·토큰 영속화(`chromeLocalStorage`, :265) | ⚪69 — 비대칭 근거 주석만. 코드 변경 없음 |
| `oauth-proxy/worker.ts` | OAuth 토큰 교환 프록시. `relayUpstream`(:434-443) | ⚪65 — 응답에 `Cache-Control: no-store` |
| `src/i18n/namespaces/integrations.ts` | 연동 i18n | 🔴1 — `jira.workspaceUrl.invalid`/`.insecure` 추가. ⚪64 — 4개 플랫폼 proxy 키 추가. **ko/en 동시** |

## 데이터 흐름

### 자격증명 egress 게이트 (🔴1 · 🟡3)

현재는 입력측에만 가드가 있고, 사이드패널을 우회하면 통과한다.

```
[지금]
사용자 입력 ─▶ 폼(trim만)          ─▶ sendBg ─▶ BG 핸들러 ─▶ fetch(Authorization: Basic …)
                  ↑ Jira: 가드 없음                        ↑ 가드 없음      ← 🔴1
사용자 입력 ─▶ 폼(normalizeInstanceUrl) ─▶ sendBg ─▶ BG 핸들러 ─▶ fetch(Bearer PAT)
                  ↑ GitLab: 가드 있음                      ↑ 가드 없음      ← 🟡3

[바뀐 뒤]
사용자 입력 ─▶ 폼(파싱+isCredentialSafeUrl) ─▶ sendBg ─▶ BG(resolveUrl/gitlabFetch)
                  ↑ 안내용(UX)                              ↑ 방어선(egress) ─▶ fetch
```

**두 겹인 게 중복이 아닌 이유**: 폼 가드는 "왜 안 되는지"를 사용자에게 즉시 알려주고(토스트 문구가 이유별로 갈린다), egress 가드는 발신처를 신뢰하지 않는다. GitLab이 이미 이 모양의 절반(입력측)을 갖고 있고, 나머지 절반을 채우는 것이다.

### 마스킹 sentinel (🟡10)

```
[content, MAIN world]                    [sidepanel / log-viewer]
network-recorder.ts                      NetworkLogContent.tsx
  maskHeaderValue() ── "***[len:N]" ──▶    buildCurl()      ─┐
    (리터럴 복제)          (로그 데이터)      HeadersTable()  ─┴─▶ isMaskedHeaderValue()
        │                                                            ↑
        └── 대조 테스트로 묶임 ──────────────────────────── src/lib/masked-header.ts
                                                              (단일 출처)
```

## 인터페이스 설계

### 1. `src/lib/masked-header.ts` (신규)

```ts
// network-recorder가 마스킹 헤더 값에 쓰는 sentinel 포맷의 단일 출처.
// 생산자(src/content/network-recorder.ts)는 이 모듈을 import하지 않고 리터럴을
// 복제한다 — recorders-entry 청크에 src/content 밖 static import가 들어가면
// crxjs가 async loader로 되돌아가 pre-arm이 죽는다(scripts/check-prearm-chunk.mjs).
// 대신 __tests__/masked-header.test.ts가 양쪽 값을 대조해 드리프트를 막는다.
export const MASKED_HEADER_PREFIX = "***";

/** `***[len:12]` 형태의 마스킹 sentinel인지. 헤더 원문과 구분하는 유일한 판정. */
export function isMaskedHeaderValue(value: string): boolean;
```

`buildMaskedHeaderValue(len: number)`를 노출하지 **않는다** — 생산자가 import할 수 없으므로 소비처가 없는 함수가 된다(`oauth.ts:34-35`가 "소비처 없는 reader를 늘리지 말 것"이라 남긴 것과 같은 이유).

### 2. `src/background/platformErrors.ts` (신규)

```ts
import type { PlatformId } from "@/types/platform";

/** 8개 플랫폼 API 에러의 공통 직렬화 표면. */
export interface PlatformApiError {
  message: string;
  status: number;
  body?: unknown;
}

// BG_REQUEST_TYPE_MAP(bgRequestTypes.ts:7)과 같은 컴파일 강제:
// PlatformId union에 9번째가 생기면 이 객체가 타입 에러를 낸다.
export const PLATFORM_ERROR_CTORS = {
  jira: JiraError,
  github: GithubError,
  linear: LinearError,
  notion: NotionError,
  gitlab: GitlabError,
  asana: AsanaError,
  clickup: ClickupError,
  slack: SlackError,
} satisfies Record<PlatformId, abstract new (...args: never[]) => PlatformApiError>;

/** 플랫폼 API 에러면 {status, body} 직렬화, 아니면 null. */
export function serializePlatformError(
  error: unknown,
): { status: number; body?: unknown } | null;
```

`index.ts`의 소비부:

```ts
.catch((error: unknown) => {
  const platform = serializePlatformError(error);
  if (platform) {
    sendResponse({ ok: false, error: (error as Error).message, ...platform });
  } else if (error instanceof OAuthError) {
    const { status, body } = serializeOAuthError(error);
    sendResponse({ ok: false, error: error.message, status, body });
  } else {
    sendResponse({ ok: false, error: friendlyError(error) });
  }
});
```

**순서 유지가 load-bearing이다** — `OAuthError`는 8개 플랫폼 에러의 서브클래스가 아니지만, 분기 순서를 바꾸면 `serializeOAuthError`의 `oauthCancelled`/`oauthNotConfigured` 마커가 사라져 `src/types/messages.ts:300,310`의 판독이 무음 실패한다.

**타입 주석 주의**: `abstract new (...args: never[]) => PlatformApiError`가 8개 클래스를 전부 통과하는지는 구현 시 `pnpm typecheck`로 확정한다(`SlackError`만 시그니처가 다르다 — `code: string` 우선, `status`에 기본값 `200`, `body`가 non-optional). 통과하지 않으면 제약을 `abstract new (...args: any[]) => PlatformApiError`로 완화한다. **컴파일 강제의 본질은 `Record<PlatformId, …>` 쪽이지 ctor 시그니처 쪽이 아니다** — 완화해도 목표는 유지된다.

### 3. Jira egress 게이트 (🔴1)

`src/background/jira-api.ts`:

```ts
function resolveUrl(auth: JiraAuth, path: string): string {
  if (auth.kind === "apiKey") {
    const base = normalizeBaseUrl(auth.baseUrl);
    assertCredentialSafeBase(base, "jira.workspaceUrl");  // ← 신규
    return `${base}${path}`;
  }
  return `https://api.atlassian.com/ex/jira/${auth.cloudId}${path}`;
}
```

**게이트를 apiKey 분기 안에 두는 이유**: oauth 경로는 `baseUrl`을 안 쓰고 상수 host로 간다. 함수 최상단에 두면 oauth 호출까지 불필요한 URL 파싱을 타고, 저장된 oauth auth엔 `baseUrl` 필드 자체가 없다(`src/types/jira.ts:8-16`).

**`normalizeBaseUrl` 뒤에 두는 이유**: `trim()` + trailing slash 제거 후의 값이 실제로 fetch에 들어가는 값이다. 정규화 전 값을 검사하면 검사한 것과 나가는 것이 달라진다.

### 4. GitLab egress 게이트 (🟡3)

`src/background/gitlab-api.ts`:

```ts
export async function gitlabFetch<T = unknown>(auth, path, init = {}) {
  const url = path.startsWith("https://")
    ? path
    : `${assertCredentialSafeBase(auth.baseUrl, "gitlab.instanceUrl")}/api/v4${path}`;
  …
}
```

**`gitlabFetch`에 두는 이유** — `gitlab.testPat`(messages.ts:439)만 막으면 나머지 13개 GitLab 핸들러는 여전히 무방비다. 저장된 auth는 입력측에서 정규화됐지만, 저장 시점 이후 스토리지가 변조되면(다른 확장·devtools) 그대로 나간다. `gitlabFetch`는 **모든 GitLab 요청의 단일 관문**이라 한 곳으로 전부 커버된다.

`path.startsWith("https://")` 분기(:105)는 GitLab이 준 절대 URL(업로드 등)이라 게이트 밖에 둔다 — 이미 https 확정이다.

### 5. 공유 헬퍼 — 두 안 중 선택

**A안(권장): `src/lib/credential-url.ts` 신규**

```ts
import { isCredentialSafeUrl } from "./loopback-host";

/**
 * 자격증명이 실릴 base URL을 검증하고 그대로 돌려준다.
 * 실패 시 throw — background egress 경계에서 fetch 직전에 호출한다.
 * i18nKeyPrefix: "jira.workspaceUrl" | "gitlab.instanceUrl"
 */
export function assertCredentialSafeBase(base: string, i18nKeyPrefix: string): string;
```

**B안: 각 api 파일에 3줄씩 인라인**

A안을 택한다. 같은 판정이 두 파일에 들어가는데 에러 문구 규칙까지 같으므로, 세 번째 플랫폼이 생겼을 때 복붙 대상이 함수 하나로 남는다. `src/lib/`에 두는 이유는 `loopback-host.ts`가 이미 거기 있고 background·sidepanel 양쪽에서 import되기 때문이다.

단 **`t()` 호출은 헬퍼 안에서** 한다(`src/i18n`의 background 초기화는 `initBgLocale()`이 이미 끝낸 상태다 — `index.ts:22`).

### 6. sender 가드 (🟡36)

`src/background/messages.ts`:

```ts
export async function handleMessage(
  message: BgRequest,
  sender: chrome.runtime.MessageSender,   // ← `_sender` 언더스코어 제거
): Promise<unknown> {
  switch (message.type) {
    case "captureVisibleTab": {
      // 확장 페이지(사이드패널)는 sender.tab이 undefined, content script는 값이 있다.
      // 페이로드 tabId로 임의 탭의 화면을 받아가는 경로를 닫는다.
      if (sender.tab) throw new Error("captureVisibleTab: extension pages only");
      …
    }
```

**최소 가드인 이유**: `captureVisibleTab`의 발신처는 전량 사이드패널이다 — `sidepanel/capture.ts:94`, `sidepanel/scroll-capture.ts:43`, `sidepanel/hooks/usePickerMessages.ts:427,450`, `sidepanel/30s-replay/use-30s-replay.ts:76`. content script 발신은 **0건**이라 이 가드로 깨지는 정상 경로가 없다. `externally_connectable`이 없어 웹페이지 직접 발신도 불가능하므로 origin 검증·토큰 발급 같은 추가 레이어는 과잉이다. 나머지 핸들러(플랫폼 API·OAuth)는 자격증명이 BG 스토리지에서 나오고 반환값이 발신처 탭에 종속되지 않아 같은 종류의 위험이 없다.

### 7. i18n 키 (🔴1 · ⚪64)

`src/i18n/namespaces/integrations.ts`에 ko/en 동시 추가. gitlab 선례(:76-79)의 네이밍을 그대로 따른다.

| 키 | ko |
|---|---|
| `jira.workspaceUrl.invalid` | 올바른 워크스페이스 URL을 입력하세요. |
| `jira.workspaceUrl.insecure` | https 주소를 입력하세요. 평문 http로는 API 토큰이 그대로 노출됩니다(localhost는 예외). |
| `notion.oauth.notConfiguredProxy` | (proxy 누락 전용 — 기존 `notion.oauth.notConfigured`는 client 누락용으로 유지) |
| `asana.oauth.notConfiguredProxy` | 〃 |
| `clickup.oauth.notConfiguredProxy` | 〃 |
| `slack.oauth.notConfiguredProxy` | 〃 |

`config.ts`의 4개 플랫폼 `notConfiguredProxyKey`를 새 키로 교체한다. jira·github의 `oauth.error.*` 키는 **건드리지 않는다**(config.ts:38-40의 결정).

## 기존 패턴 준수

- **pre-arm 동기 IIFE 제약** (CLAUDE.md "pre-arm 버퍼링") — 🟡10의 핵심 제약. `src/content/network-recorder.ts`에 `src/content/` 밖 값 import를 넣지 않는다. 선례는 `content/log-throttle.ts` ↔ `sidepanel/lib/trailing-throttle.ts` 복제, 그리고 `network-recorder.ts:12`의 `MAX_REQUEST_ENTRIES = 5000 // log-merge.ts NETWORK_MAX_ENTRIES와 동일 유지 (sidepanel 번들 격리로 값 동기화)` 주석이다. **같은 상황에 같은 해법을 쓴다.**
- **컴파일 강제 테이블** (`bgRequestTypes.ts:3-7`) — 🟡5가 그대로 따른다. 주석까지 같은 톤으로 "누락되면 typecheck가 실패한다 / 과거 asana 회귀를 영구 방지" 형태의 사유를 남긴다.
- **i18n ko/en 동시 갱신** — `.claude/settings.json`의 PostToolUse 훅이 `src/i18n/` 저장 시 `locales.test.ts`를 자동 실행해 대칭·placeholder를 검사한다. 한쪽만 고치면 저장 즉시 차단된다.
- **테스트 우선** (CLAUDE.md 작업 원칙) — 신규 인터페이스 3개(`isMaskedHeaderValue`·`serializePlatformError`·`assertCredentialSafeBase`)는 테스트를 먼저 쓴다.
- **커버리지 로직 스코프** — 신규 3개 파일은 전부 순수 함수라 `scripts/coverage-report.mjs`의 `isBrowserBound()`에 **등록하지 않는다**(등록 대상은 유닛테스트 불가능한 런타임 파일뿐). 반대로 `src/background/index.ts`·`messages.ts`는 이미 제외 목록에 있으므로 거기 남는 수정은 커버리지에 영향이 없다 — 그래서 🟡5의 테이블을 `platformErrors.ts`로 **빼내는 것**이 테스트 가능성을 만든다.
- **외과적 변경** — `gitlab-api.ts`의 무인코딩 보간(:180,195,210,226,257,268,282)은 **건드리지 않는다.** 보간값이 `number` 타입이라 이미 안전하고, 이 배치의 항목이 아니다.

## 대안 검토

### 대안 1 — 자격증명 게이트를 입력측(폼)에만 둔다 (기각)

GitLab이 지금 그 상태고, 그래서 🟡3이 발생했다. 사이드패널 코드를 우회해 `chrome.runtime.sendMessage`를 직접 부르면(다른 확장은 못 하지만, 우리 코드의 향후 호출부가 실수하면) 그대로 통과한다. 폼 가드는 안내로 남기고 **방어선은 fetch 직전**에 둔다.

### 대안 2 — 자격증명 게이트를 `messages.ts` 핸들러에 둔다 (기각)

`gitlab.testPat` 한 케이스만 막힌다. GitLab 핸들러는 14개이고 전부 `gitlabFetch`를 지난다 — 관문은 하나여야 한다. 같은 이유로 Jira도 `messages.ts`가 아니라 `resolveUrl`이다.

### 대안 3 — Jira를 `*.atlassian.net` 화이트리스트로 좁힌다 (기각)

placeholder가 Cloud를 가리키는 건 사실이지만 코드 어디에도 host 제약이 없고(`src/types/jira.ts:3`은 자유 문자열), self-hosted 사용자가 있는지 확인할 방법이 없다. 스킴 가드는 **누구도 잃지 않으면서** 평문 전송만 막는다. 화이트리스트는 기존 사용자를 끊을 수 있으므로 이 배치의 "동작 변경 없음" 원칙 밖이다.

### 대안 4 — 🟡10에서 sentinel을 `src/lib/`에 두고 content가 import (기각)

과제 지시가 이 방향이었으나 **`scripts/check-prearm-chunk.mjs`가 막는다.** `src/lib/masked-header.ts`는 sidepanel·log-viewer와 공유되므로 rollup이 공유 청크로 뽑고, crxjs는 `recorders-entry`를 async loader(`*-loader-*.js`)로 emit한다. 그러면 document_start 후크가 페이지 인라인 스크립트보다 늦게 깔려 **pre-arm 버퍼링이 조용히 죽는다** — 빌드·typecheck·유닛테스트는 전부 통과한 채로. 복제 + 대조 테스트가 이 코드베이스의 확립된 해법이다.

### 대안 5 — 🟡5를 `error.name` 문자열 매칭으로 (기각)

`instanceof` 나열보다 짧아지지만 컴파일 강제가 안 생긴다. 목표 4번("9번째 플랫폼이 컴파일 에러")을 달성하는 건 `satisfies Record<PlatformId, …>`뿐이다.

### 대안 6 — 🟡36에서 sender origin 화이트리스트 + 핸들러별 정책 테이블 (기각)

`externally_connectable`이 없어 웹페이지는 애초에 발신할 수 없고, content script 발신이 필요한 핸들러는 이 코드베이스에 없다. 정책 테이블은 유지 비용만 늘린다. **한 줄 가드가 위험의 100%를 덮는다.**

## 위험 요소

### W1. `encodeURIComponent` 이중 인코딩·경로 구분자 소실 (🟡37~40 — 최대 위험)

인코딩을 넣으면 **이미 인코딩된 값**은 `%2F` → `%252F`가 되고, **`/`를 포함한 값**은 경로가 아니라 세그먼트 일부가 된다. 값별로 출처를 확인하고 넣어야 한다.

| 값 | 출처 | `/` 포함 가능성 | 판정 |
|---|---|---|---|
| clickup `teamId`·`spaceId`·`listId`·`taskId` | 전부 ClickUp API 응답의 `id` 필드(`getTeams`:98, `getSpaces`:109, `flattenLists`:117-120, `createTask` 결과:184) | 없음 | encode 안전 |
| asana `workspaceGid`·`taskGid` | Asana API 응답의 `gid`(`getWorkspaces`:135, `createTask`:173) | 없음 | encode 안전 |
| notion `databaseId`·`pageId` | API 검색 결과 또는 `extractNotionPageId`(`src/lib/notion-page-id.ts`)가 뽑은 32자 hex/UUID | 없음 | encode 안전 |
| github-upload `owner`·`repo` | 사용자가 고른 repo의 분해값. **같은 값이 `messages.ts:311`에서 이미 `encodeURIComponent`를 탄다** | 없음(GitHub 제약) | encode 안전 — 오히려 규율이 맞춰진다 |

**주의**: asana의 `workspace=${workspaceGid}`(:146,162)는 경로가 아니라 **쿼리스트링**이다. `encodeURIComponent`도 맞지만, 같은 파일이 이미 `URLSearchParams`를 쓰는 곳이 있으면 그쪽을 따르는 편이 낫다 — `gitlab-api.ts:159-166`·`notion-api.ts:188`이 `URLSearchParams` 선례다. 구현 시 asana 두 줄은 `URLSearchParams`로 가는 것을 우선 검토한다.

**검증 수단이 유닛으로 부족하다** — 인코딩 자체는 테스트로 고정되지만 "실제 API가 인코딩된 값을 받아주는가"는 실연동이다. R7(수동 스모크)이 유일한 그물이다.

### W2. pre-arm 청크 회귀 (🟡10)

W1보다 **탐지가 어렵다** — 실패해도 빌드·typecheck·유닛테스트가 전부 green이고 pre-arm만 죽는다. `pnpm build` 후 `pnpm check:prearm`이 1차 그물, `e2e/logs-prearm.spec.ts`가 2차다. 이 배치에서 빌드가 필요한 유일한 지점.

### W3. loopback 예외 유실 (🔴1 · 🟡3)

`assertCredentialSafeBase`가 `isCredentialSafeUrl`을 그대로 쓰지 않고 자체 판정을 넣으면 ollama·로컬 GitLab이 죽는다. **판정은 반드시 `isCredentialSafeUrl` 위임**이고 헬퍼는 파싱 + throw만 한다.

### W4. `resolveUrl`이 순수 함수가 아니게 된다 (🔴1)

지금 `resolveUrl`은 문자열 조립만 하는데 throw가 생긴다. 호출부는 `doFetch`(:162) 하나뿐이고 그 위는 전부 async라 예외가 정상적으로 rejection이 된다. 단 **`authedFetch`의 401 재시도 루프**(:107-118)가 이 예외를 삼키지 않는지 확인할 것 — 지금 구조상 `doFetch` 예외는 그대로 전파되므로 문제없지만, 재시도 감싸기를 건드리면 깨진다.

### W5. `OAuthError` 분기 순서 (🟡5)

위 인터페이스 설계 참조. 8개 플랫폼 → `OAuthError` → `friendlyError` 순서가 유지돼야 한다. `src/background/__tests__/oauth.test.ts`가 그물이다.

### W6. github refresh 에러 메시지 변화 (🟡4)

지금은 `oauth.error.notConfiguredProxy`가 무조건 나가는데, `assertConfigured()`는 client 누락이면 `oauth.error.github.notConfiguredClient`를 낸다. **문구가 바뀐다** — 이건 오분류를 고치는 것이므로 의도된 변화다. `github-oauth.test.ts`에 기존 문구를 고정한 단언이 있으면 갱신 대상이다.

### W7. ⚪63의 로그 축소가 디버깅을 못 해칠 것

`uploadMap` 전체 덤프를 키 목록으로 줄이면 실패 원인 추적 정보가 준다. mediaId·URL은 토큰이 아니지만 SW 콘솔에 남을 이유도 없다. **키(파일명) + `size`** 정도는 남긴다 — 어떤 첨부에서 실패했는지가 실제 디버깅 정보고, 그건 파일명으로 충분하다.

### W8. ⚪69는 코드 변경이 아니다

주석만 추가한다. "플랫폼 토큰은 평문, BYOK 키만 난독화"의 사유는 코드에서 읽을 수 없으므로 **구현자가 사용자에게 확인해야 할 수 있다.** 근거가 확인되지 않으면 주석에 "미기록 — 확인 필요"라고 쓰느니 **항목을 스킵하고 tasks.md에 남긴다.** 추측한 사유를 주석으로 박는 것이 지금보다 나쁘다.
