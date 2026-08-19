# 커버리지 래칫 회복 — 기술 설계

## 개요

프로덕션 코드를 건드리지 않고 **기존 테스트 하네스를 확장**해 미커버 구멍 네 갈래를 닫는다. 새로 만드는 것은 테스트 파일과 공용 fetch 목 헬퍼 하나뿐이고, 프로덕션 쪽 변경은 `scripts/coverage-report.mjs`의 제외 목록 1줄(+판정 기준 주석)이다. 배치는 서로 독립이라 순서를 바꿔도 되지만, **분모 교정(Task 8)은 마지막**에 둬 그 효과를 나머지와 섞지 않는다.

## 변경 범위

### 신규 파일

| 경로 | 역할 |
|---|---|
| `src/test/fetch-mock.ts` | 라우트·큐 기반 `fetch` 목 공용 헬퍼. `src/test/**`는 `vitest.config.ts`의 `coverage.exclude`에 이미 있어 **분모에 안 들어온다.** |
| `src/store/__tests__/blob-db-logs.test.ts` | video·network·console·action 로그 패밀리 왕복 (node env + `fake-indexeddb/auto`) |
| `src/store/__tests__/blob-db-datauri.test.tsx` | `blobToDataUrl` (FileReader). **`.test.tsx`인 이유는 아래 "환경 분기"** |
| `src/background/__tests__/notion-expand-block.test.ts` | `expandBlock` 15타입 전수 테이블 |
| `src/sidepanel/lib/__tests__/bodyOutputEdgeAxes.test.ts` | 빈 orderedList · 로그 에러 0건 두 축 (골든 파일과 분리) |

### 기존 파일 확장 (테스트만)

| 경로 | 추가 내용 |
|---|---|
| `src/background/__tests__/{notion,linear,clickup,slack,gitlab,github,asana,jira}-api.test.ts` | never-called fetch 래퍼의 URL·쿼리·body·응답 배선 |
| `src/store/__tests__/settings-store.test.ts` | `migrateV1ToV2` · `isV3Shape` · `patch*Config` ×8 |
| `src/sidepanel/components/annotation/__tests__/` (기존 presets 테스트 파일) | `isStrokeTool` 5도형 true / 나머지 false |
| `src/sidepanel/lib/__tests__/submitToAsana.test.ts` | `renameStyleElementFilenames` 분기 + `userAttachments` 매핑 |
| `src/sidepanel/lib/__tests__/submitToClickup.test.ts` | 2차 `updateTaskMarkdown` 실패 시 graceful (task·첨부 보존) |

### 프로덕션 파일 변경 (1건)

| 경로 | 변경 |
|---|---|
| `scripts/coverage-report.mjs` | `BROWSER_BOUND_EXACT`에 `"src/sidepanel/hooks/usePickerMessages.ts"` 추가 + 등재 판정 기준 주석 |

## 데이터 흐름

이 기획엔 런타임 데이터 흐름이 없다. 대신 **측정 흐름**이 산출물의 판정 경로다.

```
pnpm test:coverage                     (vitest v8)
  → coverage/report/coverage-summary.json
pnpm coverage:report                   (scripts/coverage-report.mjs)
  → isBrowserBound(rel)로 분모 파티션
  → coverage/baseline.json 대비 파일 단위 델타 → 래칫 경고
pnpm coverage:update                   (--update)
  → coverage/baseline.json 갱신 (git-tracked)
```

미커버 라인을 함수로 되짚는 경로는 리포트에 없다(요약만 남는다). 이 기획의 조사에 쓴 방법을 남긴다 — **재조사가 필요하면 이걸 다시 돌린다**:

```
npx vitest run --coverage --coverage.reporter=json \
  --coverage.reportsDirectory=<tmp>/cov
# → <tmp>/cov/coverage-final.json 의 fnMap/statementMap/s/f 를 읽어
#   never-called(f[id]===0) 함수와 미커버 statement 라인을 함수 범위에 매핑
```

## 인터페이스 설계

### `src/test/fetch-mock.ts`

기존 8벌 로컬 `mockFetch`의 갈림은 네 축이다: 응답 봉투(raw / `{data}` / GraphQL `{data:{...}}`), 큐 유무, URL 라우팅 유무, `text()` 제공 유무. 공용 헬퍼는 그 합집합을 최소 API로 덮는다.

```ts
export interface MockResponse {
  body?: unknown;
  ok?: boolean;          // 기본 true
  status?: number;       // 기본 ok ? 200 : 400
  headers?: Record<string, string>;
  /** 리다이렉트 프로브(jira probeMediaRedirect)용 */
  url?: string;
}

export interface MockRoute {
  /** URL 부분 문자열 또는 정규식. 먼저 매칭된 라우트가 이긴다. */
  match: string | RegExp;
  /** 배열이면 호출마다 앞에서 하나씩 소비(마지막 값은 고갈 후 반복). */
  respond: MockResponse | MockResponse[];
}

export interface MockFetch {
  fn: ReturnType<typeof vi.fn>;
  /** 호출 n번째의 (url, init) — url은 string으로 정규화 */
  callAt(n: number): { url: string; init?: RequestInit };
  /** init.body를 JSON.parse (FormData면 throw — formDataAt을 쓸 것) */
  jsonBodyAt(n: number): unknown;
  /** multipart 경로 검증용 */
  formDataAt(n: number): FormData;
  restore(): void;
}

/** 단일 응답(또는 큐)을 모든 URL에 반환 */
export function mockFetchOnce(res?: MockResponse | MockResponse[]): MockFetch;
/** URL별 라우팅. 매칭 실패 시 명시적으로 throw (무음 통과 금지) */
export function mockFetchRoutes(routes: MockRoute[]): MockFetch;
```

**매칭 실패를 throw로 두는 게 설계 의도다.** 기존 로컬 목 일부가 매칭 실패 시 `undefined`를 흘려 어댑터가 다른 이유로 죽는데, 그러면 "URL이 틀렸다"가 "응답 파싱이 틀렸다"로 오진된다.

`restore()`는 `vi.unstubAllGlobals()`를 감싼다(기존 파일들이 쓰는 방식과 동일 — `globalThis.fetch` 직접 대입 방식인 `github-api.test.ts`는 그대로 둔다).

### `expandBlock` 전수 테이블 — 타입 수준 래칫

```ts
import type { NotionBlock } from "@/types/notion";

// Record<NotionBlock["type"], …> 라서 union에 블록 타입이 추가되면 컴파일이 깨진다.
const CASES: Record<NotionBlock["type"], { input: NotionBlock; expect: (out: NotionBlockObject) => void }> = { … };
```

CLAUDE.md의 i18n 규칙("키 축의 게이트는 타입 — `TranslationKey`가 닫힌 union이라 미정의 키가 불가능하다")과 같은 층위의 장치다. 커버리지 %는 지금 한 번 오르지만, **타입 강제가 없으면 다음 블록 타입에서 다시 새는** 자리라 이쪽이 본질이다.

### 골든 두 축을 스냅샷으로 두지 않는 이유

`bodyOutputGolden.test.ts.snap`은 이미 189KB / 58장이고, `DROPPED.md`(2026-08-16)가 *"골든 스냅샷을 일괄 무효화한다"*를 리팩터 기각 사유로 쓴 자산이다. 두 축 × 8빌더를 스냅샷으로 추가하면 장수가 2.5배가 되고, 그 스냅샷은 **"이 문장이 나와야 한다"를 말하지 않는다.** 새 파일에서 명시적으로 assert한다:

```ts
// 빈 orderedList → md.noValue 가 한 번만 나오고, 항목 마커(1.)가 없어야 한다
expect(out).toContain(NO_VALUE);
expect(out).not.toMatch(/^1\. /m);

// 에러 0건 → lineNoError 계열이고 errors= 파라미터가 실리지 않아야 한다
expect(out).toContain("logSummary.network.lineNoError");
expect(out).not.toContain("logSummary.network.line ");
```

`t()`를 키 그대로 돌려주게 목하는 방식은 `slack-api.test.ts`가 이미 쓰는 패턴이다.

## 기존 패턴 준수

- **테스트 2트랙** (CLAUDE.md): 순수 함수·헬퍼는 `*.test.ts`(node), 실제 DOM이 필요한 비컴포넌트 검증은 `*.test.tsx`(jsdom). `blobToDataUrl`은 `FileReader`가 필요해 후자다 — `environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]]`가 확장자로만 분기하므로 **파일명을 `.test.tsx`로 두는 게 유일한 방법**이다(컴포넌트가 아니어도 그렇다).
- **`fake-indexeddb/auto`**: `blob-db-attachments.test.ts`·`blob-db-inline-origins.test.ts`가 이미 쓰는 방식. 전역 오염이라 `beforeEach`에서 해당 패밀리를 `clear*`로 비운다(기존 두 파일과 같은 형태).
- **i18n 목**: `t()`를 키+파라미터 문자열로 돌려주는 `vi.mock("@/i18n", …)`. `slack-api.test.ts`의 형태를 그대로 쓴다.
- **번들 경계**: 테스트만 추가하므로 `store/__tests__/bundleBoundary.test.ts`의 화이트리스트를 건드릴 일이 없다. **단 `src/test/fetch-mock.ts`를 프로덕션 코드가 import하면 안 된다** — 테스트 전용 leaf다.
- **디렉터리 상대경로 규칙**: `background/__tests__/`·`store/__tests__/`는 `import-convention.test.ts`가 잠근 4개 디렉터리에 속하므로 같은 최상위 디렉터리 안은 상대경로(`../notion-api`)를 쓴다. `src/test/fetch-mock.ts`는 디렉터리를 건너므로 `@/test/fetch-mock`.
- **커버리지 제외 단일 출처**: 브라우저 바운드 판정은 `scripts/coverage-report.mjs`의 `isBrowserBound()`만 고친다(`vitest.config.ts`의 `coverage.exclude`는 테스트 인프라 제외 전용이라 건드리지 않는다).

## 대안 검토

**대안 1 — 어댑터 fetch 래퍼를 테스트하지 않고 `BROWSER_BOUND_EXACT`에 넣는다.** 8파일 1267줄이 분모에서 빠져 다이얼이 즉시 +5pp가 되고 테스트를 한 줄도 안 쓴다. **기각**: 이 함수들은 브라우저 API를 부르지 않는다 — `fetch`는 node에도 있고 목으로 완전히 고정된다. `coverage-report.mjs`가 이미 *"브라우저 API를 부른다와 유닛으로 못 고정한다는 다르다"*를 명문화했고(30s-replay `mp4-encoder.ts` 판정 사례), 이 대안은 그 원칙을 정면으로 어긴다. 등재를 이렇게 쓰면 다이얼이 그물이 아니라 **장부**가 된다.

**대안 2 — 골든 스냅샷 매트릭스에 두 축을 곱한다.** 구현이 가장 짧다(`VARIANTS` 배열에 2개 추가). **기각**: 스냅샷 58→~150장, 189KB→~500KB이고, 스냅샷은 "빈 재현과정이면 `md.noValue`가 정확히 한 번"을 주장하지 않는다. 회귀가 나도 diff를 사람이 읽어 판정해야 한다.

**대안 3 — `mockFetch`를 새로 만들지 않고 각 테스트 파일의 로컬 목을 그대로 쓴다.** 신규 파일 0. **기각**: 8벌 중 어느 것도 라우팅+큐+FormData를 다 갖추지 않아 `upload*`(multipart)와 다단 호출(`createIssue` → `uploadAttachment` → `updateIssueDescription`)을 못 덮는다. 각 파일에서 로컬 목을 확장하면 **9~16벌**이 되는데, `복제본` 계열은 회고 23건(29%)으로 실증된 반복 함정이다. 다만 **기존 8벌을 통합하지는 않는다** — 그건 외과적 범위 밖이고, 통합 시 `github-api.test.ts`의 `globalThis.fetch` 직접 대입 방식까지 바꿔야 한다.

**대안 4 — `usePlatformFields`(116줄, 1.8%)도 이번에 renderHook으로 덮는다.** **기각**: `useAiRun.test.tsx`·`useTabSupport.test.tsx`에 선례가 있어 원리상 가능하지만, 8플랫폼 필드 로더의 async 상태기계라 배치 성격(기존 하네스 확장)과 비용이 다르다. 다음 기획으로 남긴다.

## 위험 요소

1. **어댑터 테스트가 "구현 재진술"로 타락하는 것** — 이 기획의 최대 위험이다. `expect(url).toBe("https://api.clickup.com/api/v2/team/9001/space?archived=false")`처럼 구현의 URL을 복사해 붙이면 커버리지는 오르고 **회귀는 하나도 안 잡힌다**(리팩터 시 양쪽을 같이 고치면 green 유지). 검증 축을 다음으로 한정한다:
   - **인코딩**: 특수문자·공백·`#`이 든 id가 `encodeURIComponent`를 타는가(`clickup`의 기존 테스트가 이 형태 — 이중 인코딩 금지까지 함께 본다).
   - **필수 쿼리 파라미터의 존재와 값**: `archived=false`, 페이지네이션 `limit`/`cursor`/`per_page`, `fields` 축소 등 빠지면 조용히 오답이 되는 것.
   - **요청 body가 이미 테스트된 매퍼의 출력과 일치**: `mapCreateIssueBody`의 결과가 그대로 실려 나가는지(래퍼가 필드를 흘리지 않는지).
   - **응답 → normalizer 배선**: 응답 봉투에서 꺼내는 경로(`data.` / `res.spaces` / GraphQL `data.issueCreate.issue`)와 빈 응답·`null` 처리.
   - **에러 전파**: `!ok`일 때 `messageFor*Status`/`extract*Detail`을 타는지(각 어댑터에서 이미 테스트된 함수와의 배선).
2. **분모 교정 남용.** `BROWSER_BOUND_EXACT` 등재는 다이얼을 즉시 올리는 가장 싼 수단이라, 판정 기준 없이 쓰면 다이얼이 장부가 된다. `coverage-report.mjs`에 등재 조건을 주석으로 박는다: **(a) 브라우저 전역/DOM/미디어/`chrome.*`를 직접 만지거나 그런 모듈만 오케스트레이션하고, (b) 그 파일의 순수 판정이 이미 별도 모듈로 떼어져 각각 테스트돼 있을 때만.** `usePickerMessages`는 (a) `picker-control`·`capture` 오케스트레이션 + (b) `log-persist-guard`·`log-prearm-filter`·`tab-scope`·`log-merge` 4개 분리·테스트로 둘 다 만족한다. `usePlatformFields`는 (a)를 만족하지 않아 등재하지 않는다.
3. **`fake-indexeddb` 전역 오염.** `import "fake-indexeddb/auto"`는 프로세스 전역을 갈아치운다. 같은 워커에서 다른 테스트와 섞이면 상호 오염이 가능하다. 기존 2파일이 이미 이 방식이고 사고가 없었으므로 같은 형태를 유지하되, **새 파일도 `beforeEach`에서 자기 패밀리를 `clear*`로 비운다**(파일 간 실행 순서에 기대지 않는다).
4. **`blobToDataUrl`을 `.test.tsx`에 두는 어색함.** 컴포넌트가 아닌데 확장자가 `.tsx`다. CLAUDE.md가 이 용법("실제 DOM이 필요한 비컴포넌트 검증")을 명시하고 있으므로 컨벤션 위반은 아니지만, 파일 첫 줄에 *왜* tsx인지 주석을 남긴다(다음 사람이 `.ts`로 옮기면 `FileReader` 미정의로 죽는다).
5. **`dataUrlToBlob` 두 판본의 갈림.** 통합하지 않고 각각 테스트하는데, 두 테스트가 **같은 이름의 다른 계약**을 주장하게 된다. 각 테스트에 상대 판본을 가리키는 주석을 달고, notion 판본 테스트에 *"비-base64(percent-encoded) data URL은 blob-db 판본이면 throw한다"*를 명시적으로 남긴다 — 나중에 누가 통합하려 할 때 그게 동작 변경이라는 걸 테스트가 말해준다.
6. **red가 실제 버그일 가능성.** never-called 함수 ~1500줄에 처음 테스트를 붙이면 일부는 red로 뜰 확률이 높다(특히 페이지네이션·에러 전파·multipart). 그건 이 기획의 **성과**이지 사고가 아니다. 다만 그 순간 스코프가 "테스트 추가"에서 "버그 수정"으로 넘어가므로, 프로덕션 수정은 별도 커밋 + `/postmortem` 회고로 분리한다.
7. **배치 도중의 래칫 경고 요동.** 파일 단위 델타는 배치가 부분 완료된 상태에서 오히려 늘 수 있다. 래칫 판정은 **전 배치 완료 후 1회**만 하고, 중간엔 `pnpm test` green만 게이트로 쓴다.
8. **`getMyself` 계열의 저가치.** 8어댑터 전부에 있고 합계 ~70줄인데 대부분 "GET 후 필드 3개 뽑기"다. URL과 응답 배선만 1테스트로 덮고 지나간다 — 여기에 시간을 쓰면 배치가 늘어지는데 잡히는 회귀가 없다.
