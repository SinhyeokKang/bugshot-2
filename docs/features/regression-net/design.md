# 회귀 검출 그물 — 기술 설계

## 개요

네 개의 독립 Phase다. 공통 원칙은 **"코드를 읽어서 알 수 없는 것을 실행으로 알아낸다"** — 정적 리뷰가 원리적으로 못 잡는 세 계열(`복제본`·`미검증단언`·`라이브러리전제`)에 각각 다른 오라클을 붙인다.

| Phase | 계열 | 오라클 | 게이트 |
|---|---|---|---|
| 1. 쌍 레지스트리 | `복제본` 29% | 파일 시스템 스캔 | `pnpm test` (→ CI `verify`) |
| 2. 전제 큐 | `라이브러리전제` 35% | 사람/에이전트 판단 | 없음(큐) |
| 3. dev 불변식 | `미검증단언` 33% + `fail-open` 6% | 런타임 자기 진단 | 배너 + e2e 승격 |
| 4. 경계별 오라클 | `라이브러리전제` 35% | 브라우저·실제 응답 | `pnpm test:e2e` |

Phase 1·2·3은 상호 독립이라 병렬 착수 가능. Phase 4는 Phase 2가 만든 큐를 입력으로 쓰면 대상 선정이 쉬워지지만 의존은 아니다.

---

## Phase 1 — 쌍 레지스트리

### 왜 마커인가

중앙 매니페스트(`src/test/duplicate-pairs.ts`)는 **발견성이 없다** — 새 복제본을 만드는 사람이 그 파일의 존재를 알아야만 등록된다. 2026-07-16의 "승격했다고 커밋했는데 복제본이 남아 있었다"가 정확히 그 실패 모드다. 마커는 복제본 파일 자신에 있으므로 그 파일을 여는 사람이 반드시 본다.

### 마커 형식

이름은 `@duplicate-of`가 아니라 **`@paired-with`** 로 한다. 대상이 둘이다:

- **복제본**: 내용이 거의 같은 두 파일 (`log-throttle` ↔ `trailing-throttle`)
- **계약 분할**: 내용은 다르지만 **함께 움직여야** 하는 두 파일 (`css-resolve.TRANSPARENT_GROUP_RULES` ↔ `css-source-cache`의 조건 평가 목록)

```ts
// @paired-with: src/content/log-throttle.ts
// @paired-checker: src/sidepanel/lib/__tests__/trailing-throttle.test.ts
// @paired-reason: recorders-entry 청크가 self-contained여야 crxjs가 동기 IIFE로 emit한다(pre-arm).
```

- 파일 상단 주석 블록 안 어디든 (첫 20줄 이내). 마크다운·CSS 파일은 `/* */` / `<!-- -->` 안에 같은 3줄.
- 3줄 전부 필수. 하나라도 빠지면 실패.
- 경로는 repo 루트 기준.

### 스캐너

**별도 스크립트가 아니라 vitest 테스트**로 만든다. `verify` job이 이미 `pnpm test`를 돌리므로 CI 워크플로 수정이 불필요하고(→ `docs/CI.md` 갱신도 불필요), `scripts/*.mjs` 계열을 하나 더 늘리지 않는다.

- `src/test/paired-files.ts` — 순수 함수 (스캔·파싱·검증 규칙)
- `src/test/__tests__/paired-files.test.ts` — 저장소를 실제로 훑어 단언

검사 4종:

| # | 검사 | 실패 사례 |
|---|---|---|
| C1 | `@paired-with` 경로가 실존 | 파일 이동 후 마커 미갱신 |
| C2 | **쌍방향** — 상대 파일도 이쪽을 가리키는 마커를 가짐 | 편도 마커(한쪽만 등록) |
| C3 | `@paired-checker` 경로가 실존하고, 그 파일 본문이 **양쪽 경로를 모두 언급** | 죽은 checker, 한쪽만 테스트 |
| C4 | `@paired-reason`이 비어 있지 않음 | 이유 없이 복제본 증식 |

C3의 "양쪽 경로를 모두 언급"은 import 문이든 문자열 리터럴이든 상관없다 — `trailing-throttle.test.ts`는 `@/content/log-throttle`을 import하고 `"content/log-throttle"` 문자열로 테이블에 넣으므로 둘 다 만족한다.

### 미등록 복제본 탐지 (C5)

마커만으로는 **아직 등록 안 된** 복제본을 못 잡는다. 유사도 스캔을 하나 더 둔다:

- `src/**/*.{ts,tsx}` 중 200바이트 이상인 파일 쌍에 대해, 주석·공백을 제거한 정규화 본문의 **줄 단위 Jaccard 유사도**가 0.75 이상이면 마커를 요구한다.
- 전수 비교는 O(n²)이지만 파일 수가 수백 단위고 정규화 본문을 한 번만 만들면 로컬 수 초. 느려지면 파일 크기 버킷으로 후보를 줄인다.
- 오탐(생성된 어댑터 보일러플레이트 등)은 `src/test/paired-files.ts`의 `SIMILARITY_EXEMPT` 배열에 경로 쌍으로 면제하고 **면제 사유를 주석으로 적는다**.

C5는 임계값 튜닝이 필요하므로 Task를 분리하고, 오탐이 5쌍을 넘으면 임계값을 올리기 전에 면제 목록을 먼저 검토한다.

### 초기 등록 대상

| 쌍 | 종류 | 기존 checker |
|---|---|---|
| `src/content/log-throttle.ts` ↔ `src/sidepanel/lib/trailing-throttle.ts` | 복제본 | `src/sidepanel/lib/__tests__/trailing-throttle.test.ts` (양쪽 import — 그대로) |
| `src/i18n/namespaces/{logs,editor}.ts` ↔ `src/log-viewer/i18n.ts` | 복제본 | `src/log-viewer/__tests__/i18n.test.ts` |
| `src/styles/globals.css` ↔ `src/log-viewer/styles.css` | 복제본(토큰 표) | `src/styles/__tests__/tokens.test.ts` |
| `src/content/css-resolve.ts` (`TRANSPARENT_GROUP_RULES`) ↔ `src/content/css-source-cache.ts` (조건 평가 대상) | 계약 분할 | **신규 필요** |
| `src/sidepanel/lib/prompts/draftRich.ts` ↔ `draftCompact.ts` | 계약 분할(지시문 의미) | **신규 필요** |
| `src/sidepanel/lib/prompts/stylingRich.ts` ↔ `stylingCompact.ts` | 계약 분할 | **신규 필요** |
| `src/content/capture-context.ts` ↔ `src/sidepanel/lib/capture-basis.ts` | 계약 분할(게이트 3개 판정) | **신규 필요** |

신규 checker 4개는 Task 1-3에서 작성한다. 계약 분할의 checker는 "값이 같다"가 아니라 **"두 목록이 같은 집합이다"** / **"두 프롬프트가 같은 지시를 인쇄한다"** 를 단언한다.

---

## Phase 2 — 전제 큐

### `docs/ASSUMPTIONS.md`

POSTMORTEM과 반대 방향의 파일이다. POSTMORTEM은 **쌓이기만** 하고(과거 기록), ASSUMPTIONS는 **비워지는** 큐다(미래 작업).

```markdown
## <경계> — <전제 한 줄>

- **경계**: `CSSOM` | `chrome-api` | `어댑터` | `렌더링라이브러리` | `MV3`
- **의존 코드**: `src/content/css-resolve.ts:matchedSpecificity`
- **전제**: el.matches()가 `:has()`를 포함한 셀렉터에서 throw하지 않는다
- **검증**: `미검증`
- **틀렸을 때 증상**: throw가 catch돼 specificity가 null이 되고, 판정이 조용히 computed 폴백으로 떨어진다
```

- 최신순 추가. `검증`이 `e2e:<spec 경로>` 또는 `unit:<test 경로>`로 채워지고 그 테스트가 green이면 **항목을 삭제**한다(POSTMORTEM에 남기고 싶으면 그건 별개 회로).
- 형식 검사·집계 스크립트는 만들지 않는다. 큐가 짧게 유지되는 게 목적이지 세는 게 목적이 아니다.

### 스킬 변경

`.claude/commands/audit.md`·`.claude/commands/code-review.md` 둘 다:

1. **에이전트 지침에 항목 추가** — 각 전문 에이전트가 담당 차원에서 "이 코드가 참이라고 믿는 외부 동작"을 열거하고, 각각이 무엇으로 검증됐는지 답한다. 검증 수단이 없으면 `미검증`.
2. **리포트에 섹션 추가** — 시급도 목록 뒤에 `## 미검증 외부 전제`.
3. **큐 반영은 사용자 승인 후** — 메인 세션이 기존 `docs/ASSUMPTIONS.md`와 대조해 중복이면 스킵, 신규면 추가. 두 스킬 모두 "리포트 전용(fix·커밋 안 함)"이므로 **파일 쓰기는 사용자가 요청할 때만** 한다. 이 예외를 스킬 본문에 명시한다.

`.claude/commands/e2e-write.md`에는 착수 시 `docs/ASSUMPTIONS.md`를 읽어 대상 후보로 삼고, green이 된 항목을 제거하라는 단계를 추가한다. **이게 큐를 비우는 유일한 경로다** — 쓰기만 하고 읽는 회로가 없으면 죽은 로그가 된다(POSTMORTEM이 `/postmortem` 쓰기 + `/implement`·`/refactor`·`/code-review` 읽기로 루프를 닫은 것과 같은 구조).

세 스킬 파일 편집 시 PostToolUse 훅이 `pnpm sync:agents`를 자동 실행해 Codex 미러가 따라간다.

---

## Phase 3 — dev 불변식

### 빌드 게이트

`vite.config.ts`의 `define`에 추가:

```ts
define: {
  // ...기존
  __DEV_CHECKS__: JSON.stringify(!isStoreBuild),
},
```

`dev`·일반 `build`·`build:e2e`에서 true, `build:store`에서만 false. `import.meta.env.DEV`를 안 쓰는 이유: `pnpm build`(dist)로 만든 산출물이 도그푸딩 대상인데 그건 DEV=false다. store만 빼는 게 요구에 맞다.

전역 타입은 `src/types/globals.d.ts`(신규)에 `declare const __DEV_CHECKS__: boolean;`.

### `src/lib/invariant.ts` (신규)

```ts
export type InvariantScope = "capture" | "picker" | "ai" | "logs" | "style";

export interface InvariantViolation {
  scope: InvariantScope;
  message: string;
  detail?: string;
  at: number;
  context: "sidepanel" | "content" | "background";
}

/** 조건이 거짓이면 위반을 기록한다. store 빌드에서는 호출 자체가 죽은 코드가 된다. */
export function invariant(
  cond: unknown,
  scope: InvariantScope,
  message: string,
  detail?: () => string,
): void;

/** 현재 컨텍스트에 누적된 위반 (최대 50건, FIFO). */
export function getViolations(): InvariantViolation[];

/** e2e·배너가 확인 후 비운다. */
export function clearViolations(): void;
```

- `if (!__DEV_CHECKS__) return;`을 함수 첫 줄에 두면 Vite/Rollup이 store 빌드에서 본문을 제거한다. **호출부 인자 평가는 남으므로** 비싼 detail은 `detail?: () => string`(지연 평가)으로 받는다.
- 기록: `console.error("[invariant]", ...)` + 모듈 전역 배열(cap 50) + `globalThis.__bugshotInvariants__`에 같은 배열을 노출(e2e 수집용).
- `context`는 런타임 판별: `chrome.sidePanel`/`chrome.tabs` 유무가 아니라 각 엔트리에서 `setInvariantContext("content")`를 한 번 호출해 명시한다(판별 로직이 또 하나의 미검증 전제가 되는 걸 피한다).

### 컨텍스트 간 전달

content·background 위반은 사이드패널에서 안 보인다. 기존 메시지 채널로 올린다.

`src/types/messages.ts`에 1건 추가:

```ts
| { type: "dev.invariant"; violation: InvariantViolation }
```

- content → `chrome.runtime.sendMessage` (fire-and-forget)
- background → 열려 있는 사이드패널로 브로드캐스트 (기존 패턴 사용)
- 사이드패널 수신부에서 로컬 배열에 병합

store 빌드에서는 `invariant()` 본문이 죽으므로 이 메시지가 발화하지 않는다. 타입만 남는다(런타임 비용 0).

### 배너 UI

`src/sidepanel/components/DevInvariantBanner.tsx` (신규)

- `__DEV_CHECKS__ === false`면 `null` 반환 — 최상단에서 즉시 끊어 트리 전체가 store 빌드에서 제거되게 한다.
- 위치: 사이드패널 최상단, 탭 바 위. `App.tsx`에 마운트.
- 스타일: `destructive-outline` 계열 (DESIGN.md 토큰 — `bg-destructive`는 배경용이므로 글자색으로 쓰지 않는다. 2026-07-16 회고).
- 접힌 상태는 `⚠ invariant(scope): message` 한 줄 + 건수 배지. 클릭하면 전체 목록 + 복사 버튼 + 비우기 버튼.
- **i18n 대상 아님** — dev 전용이라 사전에 키를 추가하지 않는다(사전 두 벌 동기화 비용 회피). 하드코딩 영문.

### 초기 불변식 4개

POSTMORTEM 반복 함정 상위에서 골랐다.

| # | scope | 불변식 | 근거 회고 |
|---|---|---|---|
| I1 | `capture` | before 캡처와 after 캡처의 basis(element vs container)가 같다 | 2026-07-26 basis 불변식 |
| I2 | `capture` | 셔터가 열리는 시점에 hover-shield 이유 집합이 비어 있지 않다 | 2026-08-03 hover 누출 |
| I3 | `ai` | 도착한 응답의 session id가 현재 활성 run의 것과 같다 | AI × 취소래치 6건 |
| I4 | `logs` | `element` 캡처 모드에서 draft.environment에 API Hosts 행이 없다 | API Hosts 게이트 |

I1·I4는 이미 순수 함수(`sameCaptureBasis`, `stripApiHostsRows`)가 있어 호출부에 `invariant()`만 얹으면 된다.

### e2e 승격

`e2e/fixtures/extension.ts`의 `test` fixture를 확장한다:

```ts
// 각 테스트 종료 시 세 컨텍스트의 위반을 수집해 남아 있으면 실패시킨다.
// 의도적으로 위반을 유발하는 spec은 test.use({ allowInvariants: ["capture"] })로 면제.
```

- 사이드패널·eval-host 페이지는 `page.evaluate(() => globalThis.__bugshotInvariants__)`
- content script는 ISOLATED world라 `page.evaluate`로 못 읽는다 → content가 위반 발생 시 background로 보내둔 것을 `ext.evalInExt`로 읽는다(위 메시지 채널 재사용).
- **주의**: 이 fixture는 모든 spec에 걸리므로 초기 도입 시 기존 67 spec이 무더기로 red가 될 수 있다. Task를 "수집만 하고 경고 출력" → "실패 승격" 2단계로 나눈다.

---

## Phase 4 — 경계별 오라클

### 4-1. CSSOM 차등 e2e

**핵심 문제**: 확장의 specified 판정을 얻으려면 사이드패널에서 요소를 픽해야 하는데, 요소 수십 개를 픽하는 건 e2e로 너무 느리고 `tab.active`·큐 함정(GOTCHAS)에 전부 걸린다.

**해결**: 확장을 부팅하지 않고 `css-resolve` 모듈만 페이지에 주입한다. `e2eEvalHostPlugin` 선례와 같은 방식으로 `vite.config.ts`가 e2e 빌드에서만 프로브 엔트리를 emit한다.

```
dist-e2e/e2e-cascade-probe.js   ← css-resolve의 collectSpecifiedStylesWithSources를 window에 노출
```

- Playwright `projects`에 3번째 project `cascade` 추가 (`logview`와 같이 확장 미로드).
- 픽스처: `e2e/fixtures/pages/cascade/` — `tailwind.min.css`·`bootstrap.min.css`를 vendoring한 정적 파일 + 조합 페이지 3장:
  - `frameworks.html` — Tailwind/Bootstrap 유틸리티 클래스 밀도 높은 마크업 (escape 클래스 `2xl:*` 포함)
  - `at-rules.html` — `@layer`·`@scope`·`@container`·`@supports`·조건부 `@import` 조합
  - `tokens.html` — custom property 체인·private alias(`--_x`)·`:root` 대비 지역 정의

  vendoring은 npm 의존성이 아니라 **정적 파일 커밋**이다 — `minimumReleaseAge` 정책과 무관하고, 버전을 고정해 재현성을 얻는다. 파일 상단 주석에 출처 URL과 버전을 적는다.

**오라클 — 적용 왕복 검사**:

```
for each 요소 e, prop p:
  specified = probe.collect(e)[p]
  if specified.source === "computed" → 폴백이므로 스킵(카운트만)
  before = getComputedStyle(e)[p]
  e.style.setProperty(p, specified.value)
  after  = getComputedStyle(e)[p]
  expect(after).toBe(before)          // 승자를 맞게 골랐으면 재적용해도 안 변한다
  e.style.removeProperty(p)
```

이 오라클이 GOTCHAS의 두 함정을 동시에 우회한다:
- **색 리터럴 정규화** — 값의 문자열 형태를 안 보고 computed 동등성만 본다.
- **specified ≠ computed(rem vs px)** — 재적용 후 computed를 비교하므로 단위 차이가 문제되지 않는다.

**제약**:
- shorthand는 longhand 전개가 얽히므로 판정 대상에서 제외하고 longhand만 본다.
- `all`·`transition`·애니메이션 관련 prop은 재적용 부작용이 있어 제외 목록으로.
- 요소 표본은 페이지당 최대 40개(문서 순서 균등 샘플링). 전수는 CI 시간을 먹는다. **캡을 `log()`로 출력해 "전부 훑었다"는 오해를 막는다.**
- 폴백률(스킵 비율)을 리포트에 출력한다. 이 수치가 갑자기 오르면 판정이 죽은 신호다.

**뮤턴트 검증**: `matchedSpecificity` 비교 제거 / `skipEscape` 종결자 소비 제거 / opaque 화이트리스트 반전 — 각각 red가 되어야 한다. GOTCHAS의 "mutation 후 `build:e2e` 출력에 `built in`이 있는지 확인" 절차를 따른다.

### 4-2. 시각 diff (표면 3개)

| 표면 | 방식 | 이유 |
|---|---|---|
| 캡처 산출물의 오버레이 누출 | **스크린샷 비교 아님** — 캡처된 이미지를 canvas로 읽어 오버레이 고유색(픽커 아웃라인 색) 픽셀이 0인지 단언 | 결정적. 베이스라인 불필요. 렌더 차이에 면역 |
| 어노테이션 캔버스 | `toHaveScreenshot` (`maxDiffPixelRatio: 0.01`) | Konva 렌더는 픽셀 외 오라클이 없다 |
| 다크모드 사이드패널 상단 | `toHaveScreenshot` | 토큰 오용(2026-07-16 `--destructive`)은 대비 계산만으론 안 잡히는 조합이 있다 |

- 베이스라인은 **CI(리눅스/xvfb)에서 생성해 커밋**하고, 로컬 실행 시 이 spec들은 `test.skip(!process.env.CI)`로 건너뛴다. macOS 로컬 렌더와 xvfb 렌더가 달라 로컬 baseline은 의미가 없다.
- 첫 표면(오버레이 누출)은 baseline이 없으므로 로컬에서도 돈다 — 셋 중 가장 값싸고 가장 큰 회귀를 막는다. **이것부터 넣는다.**

### 4-3. 어댑터 record-replay (3개)

대상은 POSTMORTEM 어댑터 회귀 이력이 있는 Jira·Slack·GitHub.

- 픽스처: `src/lib/adapters/__tests__/fixtures/<platform>/<case>.json`
- 수집: 실제 계정으로 1회 요청하고 응답을 저장하는 **일회성 수동 절차**. 자동 수집 스크립트를 만들지 않는다(실계정 자격증명을 코드에 붙일 이유가 없다).
- **스크러빙 체크리스트**(픽스처 커밋 전 필수):
  - `Authorization`·`token`·`access_token`·`refresh_token`·쿠키 헤더 전부 제거
  - 이메일·실명·워크스페이스 URL·조직 ID → 고정 더미값
  - 이슈 본문에서 실제 업무 내용 제거
  - 커밋 전 `grep -riE 'bearer |ghp_|xox[baprs]-|@[a-z0-9.-]+\.(com|net|org)'`로 재확인
- 픽스처 파일 상단에 `수집일 / 대상 엔드포인트 / 스크러빙 수행자` 주석.
- 테스트는 어댑터의 응답 파싱·에러 분류·필드 매핑만 대상. 전송 자체는 기존 유닛 테스트 그대로.

---

## 데이터 흐름

```
[Phase 1]  소스 파일 마커 ──scan──> paired-files.ts ──assert──> pnpm test ──> CI verify

[Phase 2]  /audit·/code-review ──"미검증 전제" 섹션──> (사용자 승인) ──> docs/ASSUMPTIONS.md
                                                                            │
                                                              /e2e-write ───┘ (읽고 → spec 작성 → 항목 삭제)

[Phase 3]  invariant() ──기록──> 컨텍스트별 배열 + globalThis.__bugshotInvariants__
              │                            │
              ├─ content/background ──"dev.invariant" 메시지──> 사이드패널 병합 ──> DevInvariantBanner
              └─ e2e fixture ──afterEach 수집──> spec 실패 승격

[Phase 4]  cascade project ──probe 주입──> 프레임워크 코퍼스 페이지 ──적용 왕복──> getComputedStyle(오라클)
```

---

## 인터페이스 설계

### `src/test/paired-files.ts`

```ts
export interface PairMarker {
  file: string;          // repo 루트 기준 경로
  pairedWith: string;
  checker: string;
  reason: string;
}

export interface PairViolation {
  kind: "missing-target" | "one-way" | "dead-checker" | "checker-incomplete"
      | "empty-reason" | "unregistered-duplicate";
  file: string;
  detail: string;
}

/** 파일 본문 상단(첫 20줄)에서 마커 3줄을 파싱한다. 없으면 null. */
export function parsePairMarker(source: string, file: string): PairMarker | null;

/** 마커 집합 + 파일 읽기 함수를 받아 C1~C4 위반을 낸다. */
export function verifyPairs(
  markers: PairMarker[],
  read: (p: string) => string | null,
): PairViolation[];

/** 주석·공백 제거 후 줄 단위 Jaccard 유사도. */
export function similarity(a: string, b: string): number;

/** 유사도 임계 초과인데 마커가 없는 쌍(C5). */
export function findUnregisteredDuplicates(
  files: { path: string; source: string }[],
  markers: PairMarker[],
  opts?: { threshold?: number; exempt?: [string, string][] },
): PairViolation[];

export const SIMILARITY_THRESHOLD = 0.75;
export const SIMILARITY_EXEMPT: [string, string][];
```

순수 함수로 두고(파일 IO는 테스트가 담당) 유닛 테스트가 각 위반 종류를 픽스처 문자열로 고정할 수 있게 한다.

### `src/lib/invariant.ts`

위 Phase 3 참조.

### `src/types/messages.ts` 추가

```ts
| { type: "dev.invariant"; violation: InvariantViolation }
```

### `e2e/fixtures/extension.ts` 추가

```ts
/** 이 spec에서 허용할 위반 scope. 지정하면 그 scope는 실패로 승격하지 않는다. */
export const test = base.extend<{ allowInvariants: InvariantScope[] }, { ext: ExtContext }>({
  allowInvariants: [[], { option: true }],
});
```

---

## 기존 패턴 준수

- **테스트 우선** (CLAUDE.md 작업 원칙): `paired-files.ts`·`invariant.ts`는 신규 인터페이스이므로 `/tdd interface`로 테스트를 먼저 박는다.
- **2트랙 테스트**: `paired-files.test.ts`는 node(`.test.ts`), `DevInvariantBanner.test.tsx`는 jsdom(`.test.tsx`).
- **store는 `sidepanel/tabs`를 import하지 않는다**: `invariant.ts`는 `src/lib/`에 두어 store·content·background·sidepanel 어디서든 안전하게 import된다.
- **pre-arm 청크 제약**: `recorders-entry` 의존 트리에 `invariant.ts`를 **넣지 않는다**. 레코더 내부 불변식이 필요하면 그건 별도 판단 — 지금 4개 중 레코더 것은 없다. `pnpm check:prearm`이 게이트다.
- **DESIGN.md 색상 토큰**: 배너는 `bg-destructive`를 글자색으로 쓰지 않는다.
- **i18n 두 벌**: 배너는 dev 전용이라 사전에 키를 추가하지 않는다 — 추가하면 `src/log-viewer/i18n.ts` 복제 사전까지 따라와야 한다.
- **Codex 미러**: `.claude/commands/*.md` 편집 시 PostToolUse 훅이 `pnpm sync:agents` 실행. `/push`의 `sync:agents:check`가 최종 게이트.

---

## 대안 검토

### A1. 중앙 매니페스트 (`src/test/duplicate-pairs.ts`) — 미채택

전체 목록이 한 눈에 보이는 장점이 있으나 **발견성이 없다**. 새 복제본을 만드는 사람이 그 파일의 존재를 모르면 등록되지 않고, 그게 정확히 2026-07-16의 실패 모드다. C5(유사도 스캔)가 미등록을 잡긴 하지만, 마커 쪽이 "왜 복제했나"를 코드 옆에 남긴다는 추가 이득이 있다.

### A2. `import.meta.env.DEV` 게이트 — 미채택

`pnpm build`로 만든 dist가 도그푸딩 대상인데 거기서 DEV=false다. 도그푸딩에서 안 보이면 불변식의 목적이 사라진다. `__DEV_CHECKS__ = !isStoreBuild`가 요구에 맞다.

### A3. 불변식을 throw로 — 미채택

가장 시끄럽지만 도그푸딩 중 작업이 끊긴다. 더 나쁜 건 **불변식 자체가 틀렸을 때 정상 동작을 막는 버그를 만든다**는 점 — 그물이 제품을 부수면 그물을 꺼버리게 된다.

### A4. CSSOM 차등을 사이드패널 픽 왕복으로 — 미채택

요소 40개를 픽하면 spec 하나가 수 분이고, GOTCHAS의 `tab.active`·캡처 큐·repick 재arm 레이스에 전부 노출된다. 프로브 주입은 확장 부팅이 없어 이 함정 전체를 우회한다. 대신 **사이드패널까지의 경로는 검증하지 않는다** — 그건 기존 `style-*.spec.ts`가 담당한다.

### A5. 실제 사이트 HTML 스냅샷 — 미채택

현실성은 최고지만 용량·저작권·스냅샷 stale 문제가 붙고, 사이트가 바뀌면 재수집해야 한다. 프레임워크 코퍼스가 같은 CSS 기능(escape 클래스·`@layer`·custom property 체인)을 결정적으로 재현한다.

### A6. 시각 diff를 사이드패널 전반에 — 미채택

베이스라인 유지비와 xvfb flaky가 커버리지 이득을 넘어선다. GOTCHAS에 이미 렌더 비결정성 함정이 여럿 쌓여 있다.

---

## 위험 요소

1. **C5 유사도 스캔 오탐** — 어댑터 8개는 구조가 비슷해 임계값 0.75에 걸릴 수 있다. 면제 목록이 길어지면 그 자체가 "복제본이 많다"는 신호이므로, 면제하기 전에 **정말 복제본이 아닌지** 먼저 판단한다. Task를 분리해 임계값을 실측으로 정한다.
2. **e2e 불변식 승격이 기존 67 spec을 무더기로 red로 만들 수 있다** — 2단계(수집·경고 → 실패 승격)로 나누고, 1단계에서 나온 위반이 진짜 버그인지 불변식 오류인지 먼저 판정한다.
3. **`__DEV_CHECKS__` 죽은 코드 제거가 기대대로 안 될 수 있다** — 함수 호출이 남으면 store 빌드에 문자열이 실린다. 성공 기준에 `grep`으로 확인하는 항목을 뒀다.
4. **배너가 사이드패널 레이아웃을 밀어낸다** — 상단 고정이라 탭 바 위치가 바뀐다. e2e가 좌표 기반 클릭을 쓰는 곳이 있으면 깨질 수 있다. 배너는 위반이 0건이면 렌더하지 않으므로 정상 경로에서는 영향 없다.
5. **cascade project가 CI 시간을 늘린다** — 4샤드에 새 project가 붙으면 샤드 배분이 바뀐다. 페이지 3장 × 요소 40개 캡으로 시작하고, 시간을 실측해 `docs/CI.md`의 스위트 카운트를 갱신한다.
6. **record-replay 픽스처에 자격증명이 섞일 위험** — 스크러빙 체크리스트를 tasks에 명시적 검증 항목으로 뒀다. 한 번이라도 새면 git 히스토리에 영구히 남는다.
7. **전제 큐가 방치되면 죽은 로그가 된다** — POSTMORTEM이 쓰기/읽기 양방향 회로로 살아난 것처럼, `/e2e-write`의 읽기 단계가 반드시 함께 들어가야 한다. Phase 2에서 스킬 3개를 같이 고치는 이유.

## 가이드 영향

없음 — 사용자 노출 기능이 아니다. dev 불변식 배너는 store 빌드에 존재하지 않는다.
