# 커버리지 래칫 회복 — 기술 설계

## 개요

기존 테스트 하네스를 확장해 미커버 구멍 네 갈래를 닫고, 검수가 발굴한 프로덕션 결함 3건을 고친다. 새로 만드는 것은 테스트 파일과 공용 fetch 목 헬퍼 하나이고, `src/` 프로덕션 변경은 **(a) 결함 픽스 3건 (b) 테스트 진입을 위한 `export` 추가** 둘로 한정된다. 초안에 있던 분모 교정(`usePickerMessages` 등재)은 기각됐다 — 사유는 prd.md 비목표.

**이 설계의 중심 제약은 커버리지 수치가 합격 판정이 아니라는 것이다.** 회고 계열 1위가 `미검증단언`(56건/46%)이고 그물 1위가 `unit`(57건/47%)인 저장소에서, "미커버 N줄 이하"만 게이트로 두면 구현을 복사해 붙인 테스트가 전부 통과한다. 그래서 모든 태스크가 mutation 항목을 갖는다.

## 변경 범위

### 신규 파일

| 경로 | 역할 |
|---|---|
| `src/test/fetch-mock.ts` | 라우트·큐 기반 `fetch` 목 공용 헬퍼. `vitest.config.ts:32`의 `coverage.exclude`에 `src/test/**`가 있어 분모에 안 들어온다 |
| `src/test/__tests__/fetch-mock.test.ts` | 헬퍼 자체 검증(선례: `src/test/__tests__/locale-parity.test.ts`) |
| `src/store/__tests__/blob-db-logs.test.ts` | video·network·console·action 패밀리 20함수 |
| `src/store/__tests__/blob-db-datauri.test.tsx` | `blobToDataUrl`(FileReader) |
| `src/background/__tests__/notion-expand-block.test.ts` | `expandBlock` 15타입 전수 테이블 |
| `src/sidepanel/lib/__tests__/bodyOutputEdgeAxes.test.ts` | 빈 orderedList · 로그 에러 0건 두 축 |

### 기존 파일 확장 (테스트만)

| 경로 | 추가 내용 |
|---|---|
| `src/background/__tests__/{notion,linear,clickup,slack,gitlab,github,asana,jira}-api.test.ts` | never-called fetch 래퍼 5축 검증 |
| `src/store/__tests__/settings-store.test.ts` | `migrateV1ToV2` · `isV3Shape` · `update*Account` ×8 |
| `src/store/__tests__/blob-db.test.ts` | notion 판본과의 계약 갈림 케이스(기존 `dataUrlToBlob` 3케이스 확장) |
| `src/sidepanel/components/annotation/__tests__/presets.test.ts` | `isStrokeTool` — `Record<AnnotationTool, boolean>` |
| `src/sidepanel/lib/__tests__/submitToAsana.test.ts` | `renameStyleElementFilenames` 잔여 분기 + `userAttachments` 매핑 + 파일명 충돌 재현 |
| `src/sidepanel/lib/__tests__/submitTo{Clickup,Asana,Linear,Gitlab,Jira}.test.ts` | 2차 본문 갱신 실패 시 graceful degradation 전수 표(5플랫폼 — 2차 write 경로를 가진 전부) |
| `src/sidepanel/lib/__tests__/buildEditorCapture.test.ts` | 생산자 축 짝 케이스(에러 0건 세션이 `errorCount: 0`을 만드는가) |

### 프로덕션 변경

**(a) 결함 픽스 3건**

| 경로 | 변경 |
|---|---|
| `src/sidepanel/lib/submitToAsana.ts` | 사용자 첨부와 캡처 파일명이 충돌할 때 캡처가 본문에서 누락되지 않게(`:138` `userAttachmentNames` 가드) |
| `src/background/messages.ts` (jira 제출 경로 `:859` 부근) | 이슈 생성 후 2차 본문 갱신 실패를 다른 4플랫폼처럼 격리 |
| `src/i18n/namespaces/logs.ts` | `logSummary.console.lineNoError` 문면 ko `:125` / en `:266` → 경고 축까지 반영 |

**(b) `export` 추가 (동작 변경 0)**

테스트가 import할 수 없는 비공개 심볼 때문에 Task 4·5-1·5-3·6이 착수 불가다. `settings-store.test.ts`가 이미 import하는 `migrateV2ToV3`·`migrateToV5`·`migrateToV11`이 전부 export돼 있어 선례가 명확하다.

| 심볼 | 위치 |
|---|---|
| `migrateV1ToV2` | `store/settings-store.ts:104` — zustand `migrate` 콜백(`:268-275`) 안에서만 불려 **간접 경로가 없다** |
| `isV3Shape` | `store/settings-store.ts:183` |
| `notionFetch` | `background/notion-api.ts:53` |
| `dataUrlToBlob` | `background/notion-api.ts:294` |
| `isCompletedStatus` | `background/clickup-api.ts:222` |

`NotionBlockObject`(`notion-api.ts:400`)는 **export하지 않는다** — module-local `interface`이고 필드가 `type: string`이라 export해도 전수성이 0이다. 테스트는 반환 타입을 인라인 구조 타입이나 `unknown` + 좁히기로 쓴다.

## 데이터 흐름

런타임 데이터 흐름이 없다. 측정 흐름이 판정 경로다.

```
pnpm test:coverage                     (vitest v8)
  → coverage/report/coverage-summary.json      ← 정본
pnpm coverage:report
  → isBrowserBound(rel)로 로직 분모 파티션
  → coverage/baseline.json 대비 파일 델타 → 래칫 경고
     판정식: curPct < prevPct − 0.05, browserBound 제외, 베이스라인에 없는 신규 파일은 skip
  → 출력은 요약 % + 하락 목록 + 미커버 상위 15 파일뿐 (파일 수는 출력하지 않는다)
pnpm coverage:update → coverage/baseline.json (git-tracked)
```

**주의 2건.** ① `coverage/coverage-summary.json`(2026-07-25 구파일, 143KB)이 루트에 남아 있다 — 스크립트가 읽는 정본은 `coverage/report/` 아래다. 재조사 시 루트 파일을 잡으면 다른 숫자를 본다. ② 미커버 상위 15는 asana-api(93줄)에서 끊긴다. **Task 2·6·7의 대상 파일은 리포트에 안 나오므로 `coverage/report/coverage-summary.json`을 직접 읽어야 한다.**

라인→함수 매핑(never-called 식별)은 리포트에 없다. 재조사 절차:

```
npx vitest run --coverage --coverage.reporter=json \
  --coverage.reportsDirectory=<tmp>/cov
# → <tmp>/cov/coverage-final.json 의 fnMap/statementMap/s/f 를 읽어
#   never-called(f[id]===0) 함수와 미커버 statement 라인을 함수 범위에 매핑
```

tasks.md의 라인 번호는 곧 stale이 된다. **의심되면 이 절차로 다시 센다** — 다른 문서에 인쇄된 숫자를 옮기는 것이 이 저장소 회고 1위 계열(`미검증단언` 46%)의 정의다.

## 인터페이스 설계

### `src/test/fetch-mock.ts`

기존 로컬 목의 갈림은 네 축이다: 응답 봉투(raw / `{data}` / GraphQL) · 큐 유무 · URL 라우팅 유무 · `text()` 제공 유무. 필드는 **실제 소비처가 있는 것만** 둔다.

```ts
export interface MockResponse {
  body?: unknown;
  ok?: boolean;          // 기본 true
  status?: number;       // 기본 ok ? 200 : 400
  statusText?: string;   // linear-api.ts:398 이 메시지에 싣는다
  url?: string;          // jira probeMediaRedirect(:504-539)가 res.url을 본다
}

export interface MockRoute {
  /** URL 부분 문자열 또는 정규식. 먼저 선언한 라우트가 이긴다. */
  match: string | RegExp;
  /** 배열이면 호출마다 앞에서 소비(고갈 후 마지막 값 반복). */
  respond: MockResponse | MockResponse[];
}

export interface MockFetch {
  fn: ReturnType<typeof vi.fn>;
  callAt(n: number): { url: string; init?: RequestInit };
  /** init.body를 JSON.parse. FormData면 안내와 함께 throw */
  jsonBodyAt(n: number): unknown;
  formDataAt(n: number): FormData;
  /** afterEach 전용 — vi.unstubAllGlobals()를 부르므로 it() 안에서 쓰면 안 된다 */
  restore(): void;
}

export function mockFetchOnce(res?: MockResponse | MockResponse[]): MockFetch;
/** 매칭 실패 시 throw — 무음 통과 금지 */
export function mockFetchRoutes(routes: MockRoute[]): MockFetch;
```

각 결정의 근거:

- **`match: RegExp` 필수.** jira 로컬 목의 27개 match 중 13개가 이미 정규식이고 2개는 substring으로 표현 불가다(`/\/rest\/api\/3\/issue$/`의 `$` 앵커가 load-bearing — `/issue/createmeta`와 prefix 충돌).
- **큐 필수.** 독립 요구 3건 — github 기존 테스트의 큐 / slack `listChannels`의 `do…while(cursor)` / notion 3단 업로드.
- **`formDataAt` 필수.** 어댑터 6곳이 `new FormData`를 보내고(`jira:549`·`gitlab:225`·`asana:187`·`clickup:193`·`notion:325`·`slack:219`) 4곳은 래퍼 안에 `if (init.body && !(init.body instanceof FormData))` 분기가 있는데, **저장소 전체 테스트에서 FormData 참조가 0건**이다.
- **매칭 실패 throw.** jira 로컬 목은 미매칭을 `404 + {}`로 흘려 "URL이 틀렸다"가 "응답 파싱이 틀렸다"로 오진된다.
- **`headers`는 넣지 않는다.** 어댑터 8파일에 `.headers.get(` **0건**이다. `X-Atlassian-Token` 같은 건 *요청* 헤더라 `callAt().init.headers`로 본다. CLAUDE.md "요청하지 않은 유연성 추가 금지".
- **`text()` 파생 규칙**: `typeof body === "string" ? body : JSON.stringify(body)`. 어댑터 5개가 `lib/readErrorBody.ts`를 통해 `res.text()`를 타고 그 함수는 `JSON.parse` 실패 시 원문 반환 분기를 갖는다 — 무조건 `JSON.stringify`면 `body: "<html>500</html>"`이 파싱 성공해 **catch 분기가 영구 미커버**다. `readErrorBody`의 바깥 catch(read 자체 실패)를 덮으려면 `text()`가 reject하는 표현도 필요하다.
- **`restore()` 사정거리 주의.** `vi.unstubAllGlobals()`는 fetch만 되돌리지 않는다. `jira-api.test.ts:585-587`이 `it()` 안에서 `vi.stubGlobal("chrome", …)`를 세우는데 Task 5-8은 `ensureFreshAuth`/`refreshOnce`(=`chrome.storage`) 경로를 타므로 실재하는 함정이다. `afterEach` 전용임을 시그니처 주석에 박는다.
- **`uploadFileToLinear`는 raw `Blob`을 body로 보낸다**(`linear-api.ts:395`) — `jsonBodyAt`/`formDataAt` 어느 쪽도 못 본다. `callAt().init.body` 직접 접근으로 쓴다.

### `expandBlock` 전수 테이블 — 타입 수준 래칫

`src/types/notion.ts:98-113`의 `NotionBlock`은 리터럴 `type` 판별자를 가진 **15멤버 닫힌 union**이고 인덱스 시그니처가 없어 컴파일러 전수 강제가 실제로 작동한다(`tsconfig.app.json`의 `include: ["src"]`가 `__tests__`를 포함하고 `typecheck`는 `tsc -b --noEmit`).

```ts
import type { NotionBlock } from "@/types/notion";

// Record<NotionBlock["type"], …> 라서 union에 타입이 추가되면 컴파일이 깨진다.
const CASES: Record<NotionBlock["type"], { input: NotionBlock; expectBlock: unknown }> = { … };
```

**세 가지 함정**: ① 입력 `type` ≠ 출력 `type`이다(`rich_paragraph`→`"paragraph"`, `rich_quote`→`"quote"`, `mention_paragraph`→`"paragraph"`) ② `image`/`video`/`table`은 `null`을 반환할 수 있다(`attachmentMap`에 placeholder가 없을 때) ③ `default: return null`(`:557-558`)은 닫힌 union으로는 **도달 불가**라 테이블 밖에 `expandBlock({ type: "bogus" } as never, map)` 케이스가 따로 필요하다.

CLAUDE.md의 i18n 규칙("키 축의 게이트는 타입")과 같은 층위다. 커버리지 %는 한 번 오르지만 **타입 강제가 없으면 다음 블록 타입에서 다시 새는** 자리라 이쪽이 본질이다.

### 테이블 순회 4곳의 공통 규칙 — 기대값 리터럴

이 기획은 테이블 순회를 4곳에 쓴다(blob-db 4패밀리 / `update*Account` 8 / `expandBlock` 15 / `AnnotationTool` 7). `docs/POSTMORTEM.md:430`(2026-08-06, 계열 `미검증단언`)이 **정확히 이 형태로 그물이 항진명제가 된 사고**를 기록했다:

> `테스트 중복을 지우다 기대값을 SUT가 계산하게 만들어, 그물이 항진명제가 됐다` … (1) **테스트 기대값은 리터럴로 박는다.** (2) **테스트를 간결하게 만드는 리팩터는 코드 리팩터보다 위험하다 — 코드는 테스트가 지키지만 테스트를 지키는 건 뮤테이션뿐이다.**

구체적 금지형: `isStrokeTool` 테스트가 `STROKE_TOOLS`를 import해 대조하면 `STROKE_TOOLS.has(t) === STROKE_TOOLS.has(t)`가 된다. `update*Account` 순회에서 기대 병합 결과를 스프레드로 계산해도 같다. **각 케이스의 기대값은 손으로 쓴 리터럴이고, 태스크마다 mutation으로 red를 실측한다.**

### 골든 두 축을 스냅샷으로 두지 않는 이유 + 이 그물의 사정거리

`bodyOutputGolden.test.ts.snap`은 62장 / 8888줄 / 189,662B이고, `DROPPED.md:117`(2026-08-10 `stable-element-locator`)이 *"골든 스냅샷을 일괄 무효화한다"*를 리팩터 기각 사유로 쓴 자산이다. 두 축 × 10출력을 스냅샷으로 추가하면 장수가 배로 늘고, 무엇보다 스냅샷은 **"이 문장이 정확히 한 번 나온다"를 주장하지 않는다.** `POSTMORTEM:461`이 같은 골든에 대해 *"골든은 「올바른 출력」이 아니라 「현재 출력」을 고정한다 — 버그가 있는 채로 스냅샷을 뜨면 버그가 계약이 된다"*를 이미 실증했다.

**그러나 명시적 assertion으로 바꿔도 이 그물은 소비자(빌더)까지만 닿는다.** `POSTMORTEM` 2026-08-14가 바로 이 골든을 *"생산자를 호출하지 않는다 — `buildEditorMarkdownContext()`를 거치지 않고 ctx 리터럴을 손으로 조립해 빌더에 직접 먹인다"*로 "공허한 그물"로 판정했고, 그 항목의 결정타가 *"설계 문서가 그 공허한 그물을 처방으로 적어 두어 구현자가 문서를 그대로 따르면 반드시 밟는 형태였다"*다. 그래서 이 설계는 사정거리를 명시한다:

- **소비자 축(이 파일)**: ctx 리터럴을 먹여 "빈 orderedList → `md.noValue` 정확히 한 번" / "에러 0건 → `lineNoError`"를 잠근다.
- **생산자 축(별도)**: "에러 0건 세션이 실제로 `errorCount: 0`을 만드는가"는 `buildEditorCapture.test.ts`에 짝 케이스로 넣는다. 이걸 빼면 두 축은 여전히 무검증이다.

assertion 형태도 목 포맷 의존을 줄인다. `t()` 목은 params가 있으면 `key k=v`를 에코하고 빌더는 with-error에만 `errors=`/`warns=`를 싣는다. 따라서 `not.toContain("logSummary.network.line ")`(뒤 공백)은 **지금은** 판별되지만, 누가 목을 `t: (k) => k`로 단순화하면 버그 출력에서도 통과한다:

```ts
expect(out).toContain("logSummary.network.lineNoError");
expect(out).not.toMatch(/logSummary\.network\.line(?!NoError)/);
expect(out).not.toContain("errors=");
```

### 축 B의 실제 게이트 — `errors`가 아니라 `errorCount`

`buildLogSummary.ts:64`가 `networkErrorCount(net) = net.errorCount ?? net.errors.length`다. **`errors: []`만 비워도 `errorCount: 3`이 남으면 with-error 분기를 그대로 탄다** — 픽스처는 둘 다 0이어야 한다. 부수적으로 이 `??` 자체가 봉인할 값이 있는 계약이다(`errorCount: 0` + `errors: [1건]`에서 무엇이 정답인지). `POSTMORTEM:461`이 골든의 `errorCount: 3` + `errors: [1개]` 비대칭을 **의도된 load-bearing 픽스처**로 명시했으니("정리"하지 말 것) 신규 파일에서 이 축을 별도로 단언하는 게 값이 있다.

## 기존 패턴 준수

- **i18n 목의 정본은 `bodyOutputGolden.test.ts:11-27`이다.** `slack-api.test.ts`의 목은 `t`·`dateBcp47`만 내보내고 **`withLocale`이 없다** — 8빌더 진입점이 전부 `withLocale(ctx.bodyLocale, () => …Inner(…))`로 감싸져 있어(`builderLocaleWrap.test.ts`의 `WRAPPED` 9개가 전수) 첫 호출에서 `TypeError: withLocale is not a function`으로 죽는다. 골든 파일이 이미 주석으로 경고한다. `formatTimestamp` 목(`:11-13`)도 함께 복사한다 — 모든 빌더가 캡처 시각 행을 내고 그게 `dateBcp47()`를 타서 TZ 의존이 붙는다(`POSTMORTEM` 2026-07-16).
- **테스트 2트랙**: 순수 함수는 `*.test.ts`(node), 실제 DOM이 필요한 비컴포넌트 검증은 `*.test.tsx`(jsdom). `blobToDataUrl`은 `FileReader`가 필요해 후자다. `environmentMatchGlobs`가 확장자로 분기하는 게 주된 이유지만 **유일한 방법은 아니다** — `// @vitest-environment jsdom` docblock 선례가 2건 있다(`annotation/__tests__/deferredExport.test.ts:1`, `content/__tests__/style-overlay.test.ts:1`). `.test.tsx`를 고르는 건 비컴포넌트 DOM 테스트 선례가 8건 이상이라 관례상 다수이기 때문이고, 파일 첫 줄 주석에 docblock 대안도 함께 적는다.
- **`fake-indexeddb/auto`**: 기존 2파일의 방식. 파일 간 오염은 **원리적으로 불가능**하다 — vitest ^2.1.9의 기본 pool이 `forks` + `isolate: true`이고 `vitest.config.ts`에 오버라이드가 없어 파일마다 전역과 `blob-db.ts:18 let dbPromise`가 새로 만들어진다. 그래도 `beforeEach` clear를 두는 건 파일 **내부** 격리용이고 나중에 `isolate: false`로 바뀌어도 살아남게 하려는 것이다. 함정 2개: ① `import "fake-indexeddb/auto"`가 `../blob-db` import보다 **먼저** 와야 한다(`dbPromise`가 이전 백엔드를 캐시) ② `indexedDB.deleteDatabase("bugshot-video")`를 정리로 쓰면 안 된다(`dbPromise`가 삭제된 DB 연결을 들고 살아남고 reset 훅이 없다).
- **번들 경계**: 소스 스캔 그물 3개(`bundleBoundary.test.ts`·`import-convention.test.ts`·`builderLocaleWrap.test.ts`)는 `src/test/sourceFiles.ts:11`의 `__tests__` prune을 타므로 테스트 파일 추가로 red가 안 난다. **`src/test/fetch-mock.ts`는 `__tests__` 밖이라 src 전수 스캔에 잡히지만** 그 판정들은 `escapeHtml` 정의·`MarkdownIt({` 생성·`chrome.i18n` 키·첨부 문구만 찾아 걸릴 여지가 없다.
- **디렉터리 상대경로**: `background/__tests__`·`store/__tests__`는 `import-convention.test.ts`가 잠근 4개 디렉터리라 같은 디렉터리 안은 상대경로(`../notion-api`). `src/test/fetch-mock.ts`는 디렉터리를 건너므로 `@/test/fetch-mock`(호출부 15곳 만장일치 표기, background 테스트 선례는 `bodyLocaleBackground.test.ts:15`).
- **pre-arm 청크 그래프**: 신규 테스트가 물 33개 진입점에서 recorder 그래프 10모듈로의 도달이 BFS 전수 0건이다. `scripts/check-prearm-chunk.mjs`는 `dist/manifest.json`만 읽는 사후 검사라 무관하다.

## 대안 검토

**대안 1 — 어댑터 fetch 래퍼를 테스트하지 않고 `BROWSER_BOUND_EXACT`에 넣는다.** 8파일 1267줄이 분모에서 빠져 즉시 +5pp. **기각**: 이 함수들은 브라우저 API를 부르지 않는다 — 8어댑터에 `chrome.*` **0건**이고, `setTimeout`은 jira `sleep`(`:483`) 하나인데 그마저 `retryResolve`/`getMediaFileId`가 `sleepFn`을 주입 파라미터로 노출한다(`:489`, `:506`). `FormData`/`Blob`/`atob`는 Node 전역이다. 토큰 체인이 `chrome.storage`를 타는 건 jira 하나(`readStoredAuth`, `:23`)이고 기존 테스트가 이미 `vi.stubGlobal("chrome", …)`으로 덮는다(`:585`). `coverage-report.mjs:59-64`가 명문화한 *"「브라우저 API를 부른다」와 「유닛으로 못 고정한다」는 다르다"*를 정면으로 어기는 안이다. 등재를 이렇게 쓰면 다이얼이 그물이 아니라 **장부**가 된다. **같은 칼이 초안의 분모 교정(Task 8)에도 들어가 그쪽을 기각했다**(prd.md 비목표).

**대안 2 — 골든 스냅샷 매트릭스에 두 축을 곱한다.** 가장 짧다(`VARIANTS`에 2개 추가). **기각**: 62→~130장이고 스냅샷은 "정확히 한 번"을 주장하지 못한다. `POSTMORTEM:461`의 "버그가 계약이 된다"가 같은 파일에서 실증됐다.

**대안 3 — `fetch-mock`을 새로 만들지 않고 로컬 목을 그대로 쓴다.** **기각**: 명명 헬퍼 8벌 + 무명 인라인 3벌 + `jira-media-id.test.ts:77-90 stubFetch`까지 11~12곳인데, 라우팅+큐+`text()`+FormData를 **동시에** 갖춘 게 하나도 없다. notion·slack 3단 업로드가 라우팅과 시퀀싱을 동시에 요구한다. 로컬에서 확장하면 사본이 더 늘고, `복제본` 계열은 회고 34건/28%(3위)의 반복 함정이다.

**대안 3-b — `jira-api.test.ts:265`의 `mockFetchByUrl`·`urls()`와 `linear-api.test.ts:180`의 `sentInput()`을 `src/test/`로 이동시켜 출처를 삼는다.** 검수가 제안한 안이고 사본이 9벌 대신 6벌로 준다. **부분 채택**: API 설계는 이 셋의 일반화로 맞추되(위 시그니처가 그 결과다) **파일 이동은 하지 않는다** — jira 로컬 목은 미매칭 시 404를 반환하고 신규는 throw라 실패 모드가 달라, 이동하면 jira의 기존 27개 라우트 테스트가 함께 흔들린다. 대신 **마이그레이션 조건을 `DROPPED.md`에 등재**한다.

**대안 4 — `usePlatformFields`(116줄)도 renderHook으로 덮는다.** **기각**: 선례는 있으나(`useAiRun.test.tsx`·`useTabSupport.test.tsx`) 8플랫폼 async 상태기계라 비용이 다르다. 다음 기획.

## 위험 요소

1. **어댑터 테스트가 "구현 재진술"로 타락하는 것 — 이 기획의 최대 위험.** `expect(url).toBe("<구현에서 복사한 URL>")`은 커버리지를 올리고 회귀를 하나도 안 잡는다(리팩터 시 양쪽을 같이 고치면 green 유지). 검증 축을 다음 5개로 한정하고 **각 서브태스크가 mutation으로 red를 실측한다**:
   - **인코딩**: 특수문자·공백·`#`이 든 id가 `encodeURIComponent`를 타는가(이중 인코딩 금지 포함).
   - **필수 쿼리 파라미터**: `archived=false`, 페이지네이션 `limit`/`cursor`/`per_page`, `fields` 축소 — 빠지면 조용히 오답이 되는 것.
   - **요청 body ↔ 이미 테스트된 매퍼 출력 일치**: 래퍼가 필드를 흘리지 않는지.
   - **응답 봉투 경로**: `data.` / `res.spaces` / GraphQL `data.issueCreate.issue`, 빈 응답·`null`·키 부재.
   - **에러 전파**: `!ok`(slack은 200+`{ok:false}`)일 때 `messageFor*Status`/`extract*Detail`을 타는지.
2. **테이블 순회의 항진명제화.** 위 "기대값 리터럴" 규칙이 처방이다. `POSTMORTEM:440`이 *"뮤테이션은 커밋 단위가 아니라 그물 단위다"*를 남겼다.
3. **Task 2가 생산자를 안 부른다.** 위 "사정거리" 절이 처방이다. 이걸 문서에 안 쓰면 2026-08-14 항목의 재발이다.
4. **`dataUrlToBlob` 3판본의 계약 갈림.** 통합하지 않고 각각 테스트하므로 **같은 이름의 다른 계약**이 두 테스트에 공존한다. 각 테스트에 상대 판본을 가리키는 주석을 달고 갈림 케이스(`data:;base64,QUJD` / 빈 payload / `charset` 섞인 mime)를 명시한다. 부수 사실: notion 판본의 `contentType` 반환값은 **소비되지 않고**(`:323`이 `{ blob }`만 구조분해, `:324`는 `declaredContentType` 우선) `:297`의 `|| "application/octet-stream"` 폴백은 `[^;,]+` 때문에 도달 불가 dead code다. 3번째 판본(`github-upload.ts:61-66`)은 MAIN world 문자열화라 **영구 통합 불가**임을 남겨 다음 사람이 "3곳 통합"을 시도하지 않게 한다.
5. **`blob-db` 순회가 비대칭을 덮어버리는 것.** `get*`이 실제로 갈리고(video만 `instanceof Blob` 가드) 키 스코프도 2네임스페이스다. **순수 동형 순회로 쓰면 이 갈림이 테스트에서 사라지고**, 나중에 공용 헬퍼로 묶을 때 한쪽 동작이 조용히 바뀐다. 패밀리별 값 팩토리를 파라미터로 받는 형태 + 비대칭 2건을 별도 케이스로.
6. **github 파일의 두 목 방식 교차.** `github-api.test.ts:239-250`은 `globalThis.fetch` 직접 대입 + `afterEach`에서 원본 복원인데, 신규 헬퍼의 `restore()`는 `vi.unstubAllGlobals()`(stub 시점 캡처값 복원)다. 교차하면 `unstubAllGlobals()`가 "진짜 fetch"가 아니라 "github의 목"을 복원하는 상태가 생긴다. 별도 `describe` + `afterEach` 분리 필수. jira는 `vi.stubGlobal`이라 안전하지만 **한 파일에 실패 모드가 둘(404 vs throw)** 이라는 주석은 남긴다.
7. **red가 실제 버그일 가능성 — 그리고 상한.** never-called 1500줄에 처음 테스트를 붙이면 red가 여러 건 날 확률이 높다(특히 페이지네이션·에러 전파·multipart). 그건 성과지만 스코프가 "테스트 추가"에서 "버그 수정"으로 넘어간다. **계획된 픽스 3건(Task 8) 외에 4번째가 나오면 배치를 세우고 이월한다.** 프로덕션 수정은 별도 커밋 + `/postmortem`.
8. **배치 도중의 래칫 요동.** 판정은 전 배치 완료 후 1회. 중간엔 `pnpm test` green만 게이트.
9. **`getMyself` 계열의 저가치.** 8어댑터 합계 ~70줄인데 대부분 "GET 후 필드 3개 뽑기"다. URL·응답 배선 1테스트로 지나간다.
10. **`src/test/fetch-mock.ts`를 프로덕션이 import하는 걸 막는 장치가 없다.** ESLint 부재 · `tsconfig.app.json:24`의 `include: ["src"]`가 `src/test/`까지 컴파일 · `bundleBoundary.test.ts`의 POLICED와 `import-convention.test.ts`의 SCOPES 어디에도 `test`가 없다 → 프로덕션이 `@/test/*`를 import해도 **typecheck·테스트 전부 green**이다. 현재 위반 0건은 규율이지 그물이 아니고, `fetch-mock`이 8어댑터 테스트에서 널리 쓰이면 유혹이 커진다(CLAUDE.md의 `log-throttle` 사례와 같은 계열). **Task 1에 스캔 1개를 포함**한다: `walkSources(src) − src/test`에서 `@/test/` 참조 0건.
