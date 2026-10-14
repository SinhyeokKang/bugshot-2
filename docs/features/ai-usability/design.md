# AI 에이전트 사용성 — 기술 설계

## 개요

"탭 모드"(패널 문서를 일반 탭으로 연 상태, `chrome.tabs.getCurrent()`가 Tab을 돌려줌)를 같은 창에서도 사이드패널과 동등하게 동작시킨다. 축은 넷이다.

1. **background 레코더 정지 예외**: 탭 전환 판정에, 대상 탭 T ↔ T에 바인딩된 자기 패널 탭 사이의 전환이면 정지하지 않는다는 규칙을 추가한다.
2. **panel 캡처 handoff**: 모든 `captureVisibleTab` 요청을 단일 관문 `requestTabCapture`로 모은다. 탭 모드 + 같은 창이면 T를 잠시 활성화하고 캡처한 뒤 패널 탭으로 되돌린다. 페이지 조작이 필요한 phase(picking, inline area capture)는 진입할 때 T를 앞으로, 이탈할 때 패널을 앞으로 가져온다.
3. **대상 탭 선택 + 매뉴얼 안내**: 탭 모드에서만 렌더한다.
4. **공통 개선**: 캡처 실패 분류 토스트와 접힌 탭 라벨의 `sr-only`화는 사이드패널·탭 모드 공통이다.

판정 로직은 전부 순수 함수(`src/lib/panel-tab-url.ts`, `src/sidepanel/lib/tab-mode.ts`, `src/sidepanel/lib/capture-error.ts`)로 내리고, chrome API를 부르는 얇은 셸만 browser-bound로 둔다.

## 변경 범위

### 신규
- **`src/lib/panel-tab-url.ts`** (leaf, 런타임 import 0): 패널 URL ↔ 대상 tabId 파싱·생성, 탭 전환 시 정지 대상 판정. background·sidepanel 양쪽이 쓴다.
  - background가 `@/sidepanel/*`를, sidepanel이 `@/background/*`를 value import하지 않는 경계 규칙 때문에 `src/lib/`에 둔다.
- **`src/sidepanel/lib/tab-mode.ts`** (순수): handoff 계획, phase 전이에 따른 활성화 방향, 대상 탭 후보 필터.
- **`src/sidepanel/tab-mode.ts`** (browser-bound 셸): `getSelfTab()`(getCurrent 캐시), `withTargetActive()`, `requestTabCapture()`, `activateTab()`. 커버리지 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 등재한다.
- **`src/sidepanel/hooks/useTabModeHandoff.ts`**: 탭 모드에서 editor-store phase·`inlineCaptureTarget` 구독 → 방향 판정 → `activateTab`. `App.tsx`에서 1회 마운트한다.
- **`src/sidepanel/components/TabTargetPicker.tsx`**: 대상 탭 선택 화면. shadcn `Button`과 기존 `EmptyShell` 패턴(`IssueTab.tsx:298`)을 따른다.
- **`src/sidepanel/components/TabModeAgentHint.tsx`**: 탭 모드 안내 한 줄. 화면에 보이는 작은 텍스트라 접근성 트리에 나온다.

### 변경
- **`src/background/tab-bindings.ts`**: `tabs.onActivated` 리스너(`:319`)가 `resolveTabSwitch` 결과의 `prevTabId`를 곧장 `stopRecorders`하던 것을 바꾼다.
  - prev·next 탭 URL을 조회해 `recordersToStopOnSwitch()` 결과만 정지한다.
  - `apply(tabId)` 호출은 그대로 둔다. 패널 탭에 대해선 `setOptions({enabled:false})`가 되지만 무해하다(POSTMORTEM `apply()`=disable 액션 항목 참고).
- **`src/sidepanel/capture.ts`**:
  - `captureWithPrep`의 `sendBg({type:"captureVisibleTab"})`(`:94`) → `requestTabCapture(tabId)`.
  - null 반환 3갈래 중 `!prep?.rect`·`!usable`은 `onCaptureFailed.fire("offscreen")`, catch는 `fireCaptureFailure(err)`.
  - `maybeSurfacePermissionExpired` 우선 규칙은 유지한다.
- **`src/sidepanel/hooks/usePickerMessages.ts`**: `captureAndCrop`(`:429`)·`captureAndInsertInline`(`:452`)의 sendBg → `requestTabCapture`. catch에서 `fireCaptureFailure(err)`. element shot null(`:404`)에서도 `onCaptureFailed`.
- **`src/sidepanel/scroll-capture.ts`**: `defaultDeps.captureTab`은 그대로 둔다(타일마다 handoff하지 않는다). 대신 `IssueTab.tsx:120-160`의 `runScrollCapture` 호출을 `withTargetActive(tabId, () => runScrollCapture(...))`로 감싼다. catch에 `fireCaptureFailure`.
- **`src/sidepanel/picker-control.ts`**: `captureFullViewport`(`:693`)는 `picker.selectFullViewport`만 보내고 캡처는 content 응답 → `captureAndCrop`에서 일어난다. 따라서 위 관문이 커버한다. 변경 없음.
- **`src/sidepanel/lib/capture-error.ts`**: `classifyCaptureFailure()` 추가(기존 `isActiveTabPermissionError` 재사용).
- **`src/lib/app-events.ts`**: `onCaptureFailed = createEmitter<[kind: CaptureFailureKind]>()` 추가(순수성 테스트 대상 파일).
- **`src/sidepanel/App.tsx`**:
  - `onCaptureFailed` 구독 → `toast.error(t(CAPTURE_FAILURE_KEYS[kind]))`.
  - 탭 모드 && boundTabId === selfTabId면 `TabTargetPicker` 렌더.
  - 탭 모드면 상단에 `TabModeAgentHint`.
  - `useTabModeHandoff()` 마운트.
- **`src/sidepanel/hooks/useBoundTabId.ts`**: 변경 없음(폴백이 자기 탭을 돌려주는 사실을 App이 selfTabId와 비교해 판정한다). 선택 결과는 `location.replace(buildPanelUrl(base, id))`로 쿼리를 박는다. 새로고침해도 유지된다.
- **`src/components/ui/collapsing-tabs.tsx`**: `TabLabel`이 접힐 때 `hidden` → `sr-only`, 측정 중엔 `group-data-[measuring]/tabs:not-sr-only`.
- **`src/i18n/namespaces/issue.ts`**: `issue.captureFailed.{inactive,rateLimit,offscreen,other}` × 5 로케일.
- **`src/i18n/namespaces/app.ts`**: `app.tabMode.agentHint`, `app.tabTarget.{title,description,empty,refresh}` × 5 로케일. 패널 UI 사전이고 log-viewer 복제 사전 대상 아님.
- **`src/sidepanel/index.html`** 매뉴얼 본문:
  - "Order contract": 같은 창 허용 + 자기 패널 탭 ↔ 대상 전환은 기록 유지, 제3 탭은 정지.
  - "Panel URL": 쿼리 없으면 대상 선택 화면.
  - "Before you trigger a capture": 같은 창이면 패널이 대상을 스스로 앞으로 가져온다. 별도 창도 여전히 동작한다.
  - 리플레이 탭 모드 한계 한 줄.
- **`src/sidepanel/__tests__/agentManual.test.ts`**: 위 새 주장을 소스에 바인딩한다(아래 테스트 계획).
- **e2e**:
  - `e2e/fixtures/extension.ts`(`pickElement`의 `keepFixtureActive`·`bringToFront` 우회 재검토).
  - 우회를 쓰는 spec들(capture-methods·capture·capture-context·diff-image-annotation·annotation-zoom 등).
  - `e2e/GOTCHAS.md` 9·15·16·46항.
- **문서**: `docs/ARCHITECTURE.md`(탭 모드 섹션 신설), `docs/DIRECTORY.md`(신규 6파일), `guide/{ko,en}/agent-automation.md` 신규 + `SUMMARY.md` + `guide/AUTHORING.md` IA(26→27페이지).

## 데이터 흐름

```
[background] tabs.onActivated({tabId: next, windowId})
   prev = resolveTabSwitch(map, windowId, next)            (기존)
   prevUrl, nextUrl = chrome.tabs.get(...).url              (실패 시 undefined)
   for id of recordersToStopOnSwitch({prev, prevUrl, next, nextUrl, panelBase}):
       stopRecorders(id)
   apply(next)                                              (기존)

[panel] requestTabCapture(targetTabId)
   withTargetActive(targetTabId, () => sendBg({type:"captureVisibleTab", tabId}))
     self = getSelfTab()                         // null이면 사이드패널 → 그냥 run
     target = chrome.tabs.get(targetTabId)
     plan = planHandoff({ self, target })        // "none" | "activate-target"
     if plan === "activate-target":
        depth++ (재진입 시 바깥 호출만 복원 책임)
        chrome.tabs.update(target, {active:true}); await waitActive(target)
     try   run()
     finally if 바깥 호출 && plan==="activate-target": chrome.tabs.update(self.id, {active:true})

[panel] useTabModeHandoff (탭 모드에서만 구독)
   phase/inlineCaptureTarget 전이 → handoffForTransition(prev, next) → "to-target" | "to-panel" | null
   picking 진입, inlineCaptureTarget set            → to-target
   picking → styling/drafting/idle,
   capturing → drafting, inlineCaptureTarget clear → to-panel
```

`withTargetActive`는 handoff 중에도 `captureOwnedTab`의 `tab.active` 재확인(큐 대기 후)을 그대로 거친다. 관문을 우회하지 않는다.

## 인터페이스 설계

```ts
// src/lib/panel-tab-url.ts
export const PANEL_PATH = "src/sidepanel/index.html";
/** panelBase = chrome.runtime.getURL(PANEL_PATH). 쿼리 tabId가 정수일 때만 반환. */
export function parsePanelTabTarget(url: string | undefined, panelBase: string): number | null;
export function buildPanelUrl(panelBase: string, targetTabId: number): string;
export interface TabSwitch {
  prevTabId: number | null; prevUrl: string | undefined;
  nextTabId: number; nextUrl: string | undefined;
  panelBase: string;
}
/** 정지할 탭 id 목록.
 *  prev=T, next=T의 패널 → []          (자기 패널로 이동: 기록 유지)
 *  prev=T의 패널, next=T → []          (돌아옴: 아직 돌고 있음)
 *  prev=T의 패널, next=X(≠T) → [T]     (패널에서 제3 탭으로: 기존 계약대로 정지)
 *  prev=P(일반), next≠P → [P]          (기존 동작)
 *  prev null 또는 prev===next → [] */
export function recordersToStopOnSwitch(s: TabSwitch): number[];

// src/sidepanel/lib/tab-mode.ts
export interface TabLike { id?: number; windowId?: number; active?: boolean; url?: string }
export type HandoffPlan = "none" | "activate-target";
/** self=null(사이드패널) → none. 다른 창 → none. 같은 창 && target 비활성 → activate-target. */
export function planHandoff(a: { self: TabLike | null; target: TabLike }): HandoffPlan;
export type HandoffDirection = "to-target" | "to-panel" | null;
export function handoffForTransition(
  prev: { phase: EditorPhase; inline: boolean },
  next: { phase: EditorPhase; inline: boolean },
): HandoffDirection;
/** 같은 창, self 제외, isSupportedUrl 통과, 원래 순서 유지 */
export function listTargetCandidates(tabs: TabLike[], selfTabId: number): TabLike[];

// src/sidepanel/lib/capture-error.ts
export type CaptureFailureKind = "inactive" | "rate-limit" | "offscreen" | "other";
/** "permission"이면 null — 기존 다이얼로그가 처리하므로 토스트를 겹치지 않는다. */
export function classifyCaptureFailure(err: unknown): CaptureFailureKind | null;
export const CAPTURE_FAILURE_KEYS: Record<CaptureFailureKind, TranslationKey>;

// src/sidepanel/tab-mode.ts (browser-bound)
export function getSelfTab(): Promise<chrome.tabs.Tab | null>;   // 1회 캐시
export function withTargetActive<T>(targetTabId: number, run: () => Promise<T>): Promise<T>;
export function requestTabCapture(targetTabId: number): Promise<string>;
export function activateTab(tabId: number): Promise<void>;
export function fireCaptureFailure(err: unknown): void;           // classify → onCaptureFailed.fire

// src/lib/app-events.ts
export const onCaptureFailed: AppEvent<[kind: CaptureFailureKind]>;
```

`CaptureFailureKind`는 `app-events.ts`가 `sidepanel/lib`을 import하지 않게 하려고 `src/lib/app-events.ts` 안에 type으로 정의한다. `capture-error.ts`가 그걸 import한다(`app-events.test.ts` 순수성 유지).

`classifyCaptureFailure` 판정(메시지 문자열 기반 — `BgError`는 status 없이 message만 실어 온다, `background/index.ts:18-23`):
- `isActiveTabPermissionError` → null
- `/no longer the active tab|tab is not active|tab has no window/i` → inactive
- `isCaptureRateLimitError`와 같은 정규식(`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`) → rate-limit. background 함수를 import하지 않고 정규식을 복제한다. 동기화는 단위 테스트가 두 정규식에 같은 샘플을 먹여 대조한다.
- 그 외 → other

## 기존 패턴 준수

- **경계 규칙**: sidepanel ↛ `@/background/*` value import, store ↛ `sidepanel/tabs`. 공유 판정은 `src/lib/` leaf로 승격한다(`lib/jira-sprint.ts` 선례). `panel-tab-url.ts`는 런타임 import 0.
- **캡처 관문 단일 출처**: `captureVisibleTab`은 background `captureThrottle.run(captureOwnedTab)`만 경유한다. panel 쪽 `requestTabCapture`는 그 앞단 handoff일 뿐이고, 관문의 `tab.active` 재확인을 없애지 않는다.
- **`chrome.scripting.executeScript({func})` 미사용.**
- **i18n**: 신규 키를 5개 로케일 전부에 추가한다(훅이 대칭 검사). `TranslationKey` 캐스트 금지. `CAPTURE_FAILURE_KEYS`는 `Record<…, TranslationKey>`로 값 쪽을 조인다.
- **UI**: shadcn 우선. `bg-muted` 위 `text-muted-foreground` 금지(대비 테스트). 안내 문구는 DESIGN.md의 옅은 `--foreground` 관용구를 쓴다.
- **App 이벤트**: `lib/app-events.ts` 패턴(`onPickerPermissionExpired` 등)을 따른다. 컴포넌트가 직접 toast하지 않고 App에서 구독한다.
- **커버리지**: 신규 browser-bound 셸 `src/sidepanel/tab-mode.ts`, `useTabModeHandoff.ts`를 `BROWSER_BOUND_EXACT`에 등재한다. 순수 3파일은 로직 스코프 안이다.
- **docs/privacy**: 새 캡처·수집·전송이 없다(탭 활성화만 추가). 트리거 대상은 아니지만 `/push` 트라이아지에서 재확인한다.

## 대안 검토

- **"별도 창만 지원"(handoff 없이 안내 토스트)**: 단순하지만, 창 하나에 묶인 에이전트(ego 실측: 탭을 새 창으로 옮기면 태스크 스페이스에서 빠짐)는 계속 못 쓴다. 사용자 결정으로 기각했다.
- **타일마다 handoff(scroll capture)**: 타일 수만큼 탭이 깜빡이고, `scroll-capture.ts`의 타일 전후 `isTabActive` 재확인과 경쟁한다. 바깥 1회 감싸기로 대체했다.
- **패널 탭에 레코더 상태를 위임(대상 정지 후 패널이 재무장)**: 재주입은 `useBackgroundRecorder`의 visibility 경로에 걸려 있다. 별도 창에선 패널이 hidden이 안 돼 트리거가 없다(POSTMORTEM 매뉴얼 회고). 그 사이 로그가 빈다. 정지 자체를 안 하는 쪽이 단순하고 무손실이다.
- **매뉴얼을 `body`의 `sr-only` 요소로 상시 노출**: 사이드패널 사람 사용자의 스크린리더가 매번 읽는다. 탭 모드 한정 안내로 기각했다.
- **`useBoundTabId` 폴백을 "직전 활성 탭"으로 추론**: Chrome에 탭 활성 이력 API가 없고, `openerTabId`는 에이전트의 `goto`/새 탭 경로에서 비어 있다. 명시적 선택 화면이 확실하다.

## 위험 요소

- **e2e 하네스 전제 반전**(최대 위험): e2e는 전부 같은 창 탭 모드다(`openPanel`). handoff·자동 활성화가 들어가면 `bringToFront` + `evaluate(el.click())` 우회가 불필요해지거나 오히려 경쟁한다.
  - 예: product가 패널을 되돌리는 순간 spec이 fixture를 앞에 두려 함.
  - POSTMORTEM 2026-07-26(관문 승격 시 우회 전수 확인) 회로를 그대로 밟는다. 착수 전 `grep -rn 'bringToFront\|el.click()' e2e/`로 우회를 전수하고, 우회마다 이유를 확인한 뒤 제거·유지를 판정한다. GOTCHAS 9·15·16·46항을 함께 고친다.
- **활성화 대기 레이스**: `chrome.tabs.update` resolve가 곧 `active=true` 반영은 아니다. `waitActive`는 `tabs.onActivated` 1회 또는 `tabs.get` 폴링(상한 1s)으로 확정한 뒤 캡처한다. 상한 초과 시 run은 진행하고, 관문이 inactive로 거부하면 토스트로 드러난다(무음 실패 금지).
- **에이전트 도구의 제어권 오판**: 제품이 스스로 탭을 바꾸면 ego류 도구가 이를 "사용자 조작"으로 볼 수 있다. 이번 스모크의 오판이 이미 캡처 직후에 몰려 있었다. 가이드·매뉴얼에 "패널이 캡처 동안 대상 탭을 잠깐 앞으로 가져온다"를 명시한다.
- **`onActivated` 비동기화**: URL 조회 2회가 추가돼 정지가 수 ms 늦어진다. 그 사이 제3 탭으로 빨리 넘어가는 경우에도 판정은 그 전환 쌍 기준이라 정확하다. `tabs.get` 실패(닫힘)면 URL undefined → 기존 동작(prev 정지)으로 떨어진다.
- **TabLabel `sr-only` 측정**: `group-data-[measuring]/tabs:not-sr-only`가 `hidden` 대체와 같은 측정값을 내야 한다. 소비처 8곳 중 `forceCollapsed`는 1곳이라 jsdom 테스트로는 측정을 못 본다. e2e `capture-modes-layout`·스크린샷 비교로 보고, 가이드 스크린샷 stale 가능성은 `/guide-shots`로 확인한다.
- **매뉴얼 그물**: `agentManual.test.ts`는 뮤테이션 실측을 요구한다(파일 헤더). 새 케이스마다 구현을 되돌려 red를 눈으로 본다.
