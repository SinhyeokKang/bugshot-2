# e2e 테스트 워크플로우 — 기술 설계

## 개요

`@playwright/test` 정식 러너 기반의 e2e 스위트를 `e2e/`에 커밋하고, `BUGSHOT_E2E_BUILD=1` 빌드 모드로 `dist-e2e/`(manifest에 `<all_urls>` 추가)를 분리 산출한다. 실행 주체는 스킬 2개 — `/e2e-write`(작성 + 실행-수정 루프, 유일하게 빌드가 허용되는 작성 단계)와 `/e2e-run`(실행 + 리포트 전용). `/build`와 `/merge`가 `/e2e-run` 절차를 내장 호출하며, green 커밋 해시 캐시(`e2e/.last-green`)로 중복 실행을 피한다. PoC(style-changes-dialog Task 6)에서 검증된 인프라 트릭을 그대로 승계한다.

## 변경 범위

### 빌드 인프라

#### `manifest.config.ts`
- 현재: `BUGSHOT_STORE_BUILD=1`이면 dev `key` 생략.
- 변경: `const isE2eBuild = process.env.BUGSHOT_E2E_BUILD === "1";` 추가. `host_permissions`에 `...(isE2eBuild ? ["<all_urls>"] : [])` 추가.
  - 근거(PoC): 최신 Chrome의 `captureVisibleTab`은 특정 host permission으로 부족하고 `<all_urls>` 또는 activeTab이 필요한데, 자동화에선 activeTab(액션 클릭 제스처)을 부여할 수 없다.
  - dev `key`는 유지(스토어 빌드 아님).

#### `vite.config.ts`
- 변경: `const isE2eBuild = process.env.BUGSHOT_E2E_BUILD === "1";` → `build: { outDir: isE2eBuild ? "dist-e2e" : "dist" }`.
- `dist-*`는 `.gitignore`에 이미 포함 — 추가 작업 없음.

#### `package.json` scripts
```jsonc
"build:e2e": "pnpm build:log-viewer && BUGSHOT_E2E_BUILD=1 tsc -b && BUGSHOT_E2E_BUILD=1 vite build",
"test:e2e": "playwright test --config e2e/playwright.config.ts"
```
- devDependencies: `@playwright/test` 추가. 브라우저는 `pnpm exec playwright install chromium`(공식 캐시, 버전은 패키지에 고정 — PoC의 임의 CfT 캐시 의존 제거).

#### `.gitignore`
- 추가: `e2e/.last-green`, `test-results`, `playwright-report`.

### e2e 스위트 (신규 디렉터리 `e2e/`)

```
e2e/
├── playwright.config.ts          # testDir=".", workers:1, retries:0, headless:false
├── fixtures/
│   ├── extension.ts              # Playwright fixture — 컨텍스트·확장·헬퍼 일체
│   └── pages/
│       └── basic.html            # PoC fixture.html 승계 (#title, #card.card.box, #filler)
├── smoke.spec.ts                 # 진입 → 선택 → 수정 → drafting 진입
├── style-changes-dialog.spec.ts  # PoC 16개 체크 이식
└── .last-green                   # green 커밋 해시 (gitignore, /e2e-run이 기록)
```

#### `e2e/playwright.config.ts`
- `workers: 1` — 확장 + persistent context는 프로필 단위 상태라 병렬 불가.
- `retries: 0` — flaky를 숨기지 않는다.
- `timeout: 60_000`, `expect.timeout: 10_000`.
- `headless: false` — 1차는 headed(비목표 참조). `reporter: [["list"], ["html", { open: "never" }]]`.

#### `e2e/fixtures/extension.ts`
PoC poc.js의 인프라를 Playwright fixture로 포팅:
- `test.extend<{ ext: ExtContext }>` — worker-scoped fixture:
  1. 로컬 정적 서버 기동(node `http`, `fixtures/pages/` 서빙, 포트 8123).
  2. `chromium.launchPersistentContext(tmpDir, { headless: false, args: ["--disable-extensions-except=<dist-e2e>", "--load-extension=<dist-e2e>", "--lang=ko", "--no-first-run", "--no-default-browser-check"] })`.
     - `dist-e2e/manifest.json` 부재 시 명확한 에러로 즉시 실패("pnpm build:e2e 먼저").
  3. service worker 대기 → extension id 추출.
  4. teardown: context close + 서버 close + tmp 프로필 삭제.
- 노출 헬퍼 (PoC에서 검증된 것):
  - `openPanel(tabId): Promise<Page>` — `chrome-extension://<id>/src/sidepanel/index.html?tabId=N` 직접 진입.
  - `fixtureTabId(): Promise<number>` — SW evaluate로 `chrome.tabs.query`.
  - `pickElement(fixturePage, panelPage, selector)` — bringToFront + bbox 중심 mouse click(blocker 경유).
  - `typeStyleValue(panel, label, value)` / `setQuadLinkedValue(panel, label, value)` — ValueCombobox 팝오버 열기 → fill → `closeAllPopovers()`(Escape 불신뢰 — PoC 비망).
  - `closeAllPopovers(panel)` — Escape → 잔존 시 outside click, 최대 4회.

#### 셀렉터 전략 (`data-testid` 최소 도입)
- PoC의 함정: Radix Popover content도 `role="dialog"`, Dialog 열림 중 배경 `aria-hidden`으로 role 조회 제외, 카드 라벨이 i18n·원본 classList에 결합, Tailwind 클래스(`rounded-xl.border`) 결합.
- 원칙: **e2e가 잡는 지점에만** `data-testid`(kebab-case). CSS prop 라벨(`color`, `padding` — i18n 무관)과 섹션 제목(`Class`, `Text` — 영문 고정)은 기존 셀렉터 유지.
- 1차 부착 지점(spec이 요구하는 전부):

| testid | 위치 | 비고 |
|---|---|---|
| `tab-debug` | `App.tsx` 디버그 TabsTrigger | 진입 |
| `mode-element` | `IssueTab.tsx` 요소 스타일 편집 버튼 | 진입 |
| `repick` | `StyleEditorPanel.tsx` RepickButton | 버퍼 플로우 |
| `class-editor` / `text-editor` | ClassEditor/TextEditor Textarea | 입력 |
| `changes-trigger` | StyleChangesDialog 트리거 버튼 | aria-hidden 우회 |
| `changes-dialog` | DialogContent | Popover role 충돌 해소 |
| `changes-card` (+`data-source`, `data-selector`) | GroupCard Card | 라벨 결합 제거 |
| `changes-row` (+`data-prop`) | diff 행 컨테이너 | |
| `row-reset` / `element-reset` / `reset-all` | 각 리셋 버튼 | |
| `next-step` | [다음] 버튼 | smoke |

#### `smoke.spec.ts`
패널 직접 진입 → 디버그 탭 → element 모드 → `#title` 선택 → color 수정 → [다음] → drafting 패널 표시 확인. 1 test.

#### `style-changes-dialog.spec.ts`
PoC 16개 체크를 `test.describe.serial` 1개로 이식(상태 연속 플로우 — PoC와 동일한 순서). 각 체크 = `test()` 1개, serial이라 선행 실패 시 후행 skip. 독립 셋업 분리는 비목표(추후 과업).

### 스킬 (`.claude/commands/`)

#### `e2e-write.md` (신규)
- 용도: tasks.md "e2e 시나리오" 섹션(또는 사용자 지시)을 spec 코드로 변환하고 green까지 자기완결.
- 절차: 대상 시나리오 확정 → spec 작성/갱신 → `pnpm build:e2e` → `pnpm test:e2e` 실행-수정 루프(최대 8회 — 초과 시 남은 빨강 보고 후 종료) → green 후 동일 spec 1회 재실행(연속 통과 확인) → 보고.
- 수정 허용 범위: `e2e/**` + **src의 `data-testid` 속성 추가만**(로직·구조·스타일 변경 금지). 그 외 src 변경이 필요하면 보고하고 종료(구현 결함은 `/implement` 영역).
- 빌드 허용: `build:e2e`만. `pnpm build`(dist) 금지.

#### `e2e-run.md` (신규)
- 용도: 전체 스위트 실행 + 리포트 전용. fix·spec 수정 금지.
- 절차: `pnpm build:e2e` → `pnpm test:e2e` → 결과 요약(통과 N / 실패 N + 실패별 `spec:체크명 — 1줄 원인`) → **green && 워킹 트리 클린**이면 `git rev-parse HEAD > e2e/.last-green`, dirty면 기록 생략을 보고에 명시.
- exit code와 무관하게 리포트하고 종료. 빨강이어도 수정 시도 금지.

#### `build.md` (수정)
- `pnpm build` 성공 후 `/e2e-run` 절차를 인라인 수행(빌드 실패 시 e2e 생략).
- 보고 통합: 빌드 요약 + e2e 결과 + 수동 체크리스트는 **자동화 안 된 항목만**(captureVisibleTab 이미지 정합·quota·스크롤 복원 + 이번 변경 중 e2e 미커버 영역).

#### `merge.md` (수정)
- 절차 4(푸시)와 5(버전 bump) 사이에 **e2e 게이트** 삽입:
  1. `cat e2e/.last-green` == `git rev-parse HEAD` → "직전 green (해시)" 한 줄로 통과.
  2. 불일치 → `/e2e-run` 절차 수행.
  3. 빨강 → 실패 리포트 후 **중단**(PR 생성 안 함). 사용자가 명시적으로 우회 요청("skip e2e")한 경우에만 게이트 생략하고 보고에 우회 사실 기록.
- bump 전에 두는 이유: bump 커밋은 메타데이터만 바꾸므로 코드 상태 기준 green을 그대로 인정 — bump 후 재실행하면 해시 불일치로 항상 중복 실행된다.

#### `feature.md` (수정)
- tasks.md 템플릿의 "테스트 계획"을 3분할: 단위 테스트 / **e2e 시나리오**(자동화 가능 — "~하면 ~가 된다" 검증 가능 문장, 스크립트 판정 가능해야) / 수동 테스트(자동화 불가 항목만).

#### `implement.md` (수정)
- 보고 포맷에 `e2e 영향: <없음 / 시나리오 추가·갱신 필요 ⚠️ — 대상 spec. /e2e-write로 처리>` 줄 추가(가이드 영향과 동형). 실제 spec 작성은 하지 않는다.

#### `feature-review.md` (수정)
- QA Lead 관점에 "e2e 시나리오가 스크립트로 판정 가능한 문장인가(자동화 가능성·셀렉터 실재성)" 추가.

### 문서

- `CLAUDE.md`: 명령어 표에 `build:e2e`·`test:e2e`, 워크플로우 라인업에 `/e2e-write`·`/e2e-run` + 권장 흐름 갱신(`/implement` → `/e2e-write` → … → `/build`(e2e 포함) → … `/merge`(e2e 게이트)).
- `DIRECTORY.md`: `e2e/` 추가.

## 데이터 흐름

```
/feature        tasks.md에 "e2e 시나리오" 섹션 생성
/implement      구현 + testid 부착 + 보고에 "e2e 영향" 플래그
/e2e-write      시나리오 → spec → build:e2e → 실행-수정 루프 → green
/build          pnpm build → build:e2e → test:e2e → 리포트 → green&클린이면 .last-green 기록
/merge          .last-green == HEAD ? 스킵 : 실행 → 빨강이면 중단 → green이면 bump → PR
```

green 해시 캐시: `e2e/.last-green`(gitignore, 한 줄 — 커밋 해시). 쓰는 쪽은 `/e2e-run` 절차뿐, 읽는 쪽은 `/merge` 게이트뿐.

## 인터페이스 설계

```typescript
// e2e/fixtures/extension.ts
export interface ExtContext {
  context: BrowserContext;          // persistent, dist-e2e 로드
  extensionId: string;
  fixtureUrl: (page: string) => string;        // http://127.0.0.1:8123/<page>
  fixtureTabId: (urlPattern: string) => Promise<number>;
  openPanel: (tabId: number) => Promise<Page>;
}

export const test: TestType<{ ext: ExtContext }>;  // base.extend(...)

// e2e/fixtures/helpers.ts (extension.ts 내 포함 가능 — 파일 분리는 구현 재량)
export function pickElement(fixture: Page, panel: Page, selector: string): Promise<void>;
export function typeStyleValue(panel: Page, label: string, value: string): Promise<void>;
export function setQuadLinkedValue(panel: Page, label: string, value: string): Promise<void>;
export function closeAllPopovers(panel: Page): Promise<void>;
```

## 기존 패턴 준수

- **빌드 게이트웨이**: `pnpm build`는 `/build` 전용 원칙 유지. `/e2e-write`·`/e2e-run`은 `build:e2e`(dist-e2e)만 — `/deploy`의 `build:store`와 같은 "스킬 전용 빌드" 패턴.
- **발견·리포트와 실행·결정 분리**: `/e2e-run`·`/build`의 e2e는 리포트 전용, fix는 사용자 결정. `/merge` 게이트는 차단만 하고 수정하지 않는다.
- **env 분기 패턴**: `BUGSHOT_E2E_BUILD`는 기존 `BUGSHOT_STORE_BUILD`와 동형(manifest.config.ts + vite.config.ts + scripts).
- **컨벤션 비침습**: `data-testid`는 렌더 결과(속성)만 추가 — 로직·스타일 무영향. 주석 최소화 원칙대로 spec에도 WHY만.
- **문서 신선도**: 스킬 라인업·scripts·디렉터리 변경이므로 CLAUDE.md/DIRECTORY.md 갱신이 같은 PR에 포함돼야 한다(`/push` 신선도 트리거).

## 대안 검토

- **e2e 스펙 작성을 `/tdd` e2e 모드로**: 테스트 작성 스킬이라는 정체성은 맞지만, `/tdd`는 빌드·실행 불가라 PoC에서 필수였던 실행-수정 루프(셀렉터·타이밍 함정 6회 수정)가 끊겨 미검증 spec이 산출된다. 기각 — 전용 `/e2e-write`로 분리.
- **단일 `/e2e` 스킬에 write/run 모드**: 가능하지만 `/build`·`/merge`가 내장 호출하는 run과, 사용자가 수동 호출하는 write는 트리거·권한(수정 가능 범위)이 달라 별도 스킬이 더 명확. 사용자 결정으로 2개 분리.
- **PoC식 경량 러너(playwright-core + node 스크립트) 유지**: 의존성은 최소지만 assert·자동 대기·trace·리포트·재시도를 계속 손수 관리. `@playwright/test` 채택(사용자 결정).
- **dist 후처리(manifest 주입) 유지**: PoC 방식. 배포 산출물 오염 위험이 커서 기각 — 빌드 모드 분리.
- **`/merge` 게이트에서 bump 후 실행**: 해시가 bump 커밋으로 바뀌어 캐시가 무력화. bump 전 실행으로 확정.

## 위험 요소

- **레이아웃 변화에 따른 spec 취약성**: testid로 대부분 해소되지만, 팝오버 닫힘(`closeAllPopovers`)·double rAF 등 타이밍 의존은 남는다. PoC에서 3회 연속 green으로 검증된 헬퍼를 그대로 이식하고 retries:0으로 flaky를 즉시 노출시킨다.
- **headed 실행의 환경 의존**: 백그라운드 탭 rAF 스로틀, 화면 잠금 중 실행 등. PoC에서 bringToFront 전략으로 해소했으나 머신 상태에 따른 간헐 실패 가능성은 0이 아니다 — 실패 리포트에 trace 경로를 포함해 진단 가능하게.
- **`<all_urls>` 빌드의 오용**: `dist-e2e/`를 실수로 Chrome에 로드하거나 스토어에 올리는 사고. `dist-*` gitignore + `/deploy`는 `build:store`만 사용하므로 경로상 차단되지만, e2e-run.md에 "dist-e2e는 테스트 전용" 경고 명시.
- **chrome.tabs.captureVisibleTab 동작 변경**: PoC 비망의 `<all_urls>` 요구는 Chrome 버전 의존적 동작 — Chrome 업데이트로 다시 바뀔 수 있다. 실패 시 진단 첫 후보로 비망에 기록돼 있음.
- **실행 시간**: 스모크+회귀 약 1~2분(빌드 포함 2~3분). `/merge` 해시 캐시로 일상 흐름의 중복은 제거되지만, `/build`를 자주 돌리면 누적 체감 — 필요시 `/build`에 "e2e 생략" 명시 요청 옵션을 둘 수 있으나 1차 스코프에선 항상 실행.
- **serial spec의 연쇄 skip**: 선행 체크 실패 시 후행이 모두 skip돼 한 번에 한 원인만 보임. PoC와 동일한 트레이드오프로 수용(독립 셋업 분리는 추후).
