# AI 에이전트 사용성 — 기술 설계

## 개요

"탭 모드"(패널 문서를 일반 탭으로 연 상태, `chrome.tabs.getCurrent()`가 Tab을 돌려줌)를 같은 창에서도 캡처·로그 기록 면에서 사이드패널과 동등하게 동작시킨다. **가드레일: 사이드패널(사람) 화면·동작은 바뀌지 않는다** — 예외는 실패 토스트와 접힌 탭 `sr-only`뿐이다(prd 가드레일). 축은 넷이다.

1. **background 레코더 정지 예외**: 탭 전환이 대상 탭 T ↔ T에 바인딩된 자기 패널 탭 사이면 정지하지 않는다. 그 외 전환은 지금 동작 그대로다(새 정지 동작 없음).
2. **panel 대상 탭 hold**: 탭 모드에서 "T가 앞에 있어야 하는 구간"을 **단일 refcount hold** 하나로 소유한다. picking·before 캡처·인라인 영역·캡처 트랜잭션(prepare→capture→end)이 각각 hold를 잡고, count가 0이 되고 T가 여전히 활성일 때만 패널로 복원한다.
3. **대상 탭 선택 + 매뉴얼 안내**: 탭 모드에서만 렌더한다.
4. **캡처 실패 분류 토스트**(사이드패널 공통 — 가드레일 예외)와 **접힌 탭 라벨 `sr-only`화**(화면 변화 0).

판정 로직은 전부 순수 함수(`src/lib/panel-tab-url.ts`, `src/lib/capture-messages.ts`, `src/sidepanel/lib/tab-mode.ts`, `src/sidepanel/lib/capture-error.ts`)로 내리고, chrome API를 부르는 얇은 셸만 browser-bound로 둔다. 셸도 `vi.stubGlobal("chrome")`로 단위 테스트한다(`background/__tests__/tab-bindings.test.ts:285` 선례).

## 변경 범위

### 신규
- **`src/lib/panel-tab-url.ts`** (leaf, 런타임 import 0): 패널 URL ↔ 대상 tabId 파싱·생성, 탭 전환 시 정지 대상 판정. background·sidepanel 양쪽이 쓴다.
  - background가 `@/sidepanel/*`를, sidepanel이 `@/background/*`를 value import하지 않는 경계 규칙 때문에 `src/lib/`에 둔다.
- **`src/lib/capture-messages.ts`** (leaf, 런타임 import 0): 캡처 관문 실패 메시지 상수와 술어(`isCaptureRateLimitError`·`isCaptureInactiveError`). background `capture-throttle.ts`와 sidepanel `scroll-capture.ts`·`capture-error.ts`가 함께 import한다 — 정규식을 복제하고 대조 테스트를 거는 대신 단일 출처로 올린다(`lib/jira-sprint.ts` 선례).
- **`src/sidepanel/lib/tab-mode.ts`** (순수): 활성화·복원 판정, 상태 기반 hold 술어, 대상 탭 후보 정렬.
- **`src/sidepanel/tab-mode.ts`** (browser-bound 셸): `getSelfTab()`, `holdTarget()`, `withTargetHold()`, `focusTab()`. 커버리지 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 등재하되 셸 단위 테스트는 둔다.
- **`src/sidepanel/hooks/useTabModeHold.ts`**: 탭 모드에서 editor-store `phase`·`inlineCaptureTarget`를 구독해 상태 기반 hold("picking"·"inline")를 잡고 놓는다. `App.tsx`에서 1회 마운트한다.
- **`src/sidepanel/components/TabTargetPicker.tsx`**: 대상 탭 선택 화면(전체 화면 대체).
- **`src/sidepanel/components/TabModeAgentHint.tsx`**: 탭 모드 안내 한 줄.

### 변경
- **`src/background/tab-bindings.ts`**: `tabs.onActivated` 리스너(`:319`)가 `resolveTabSwitch` 결과의 `prevTabId`를 곧장 `stopRecorders`하던 것을 바꾼다.
  - prev·next 탭이 BugShot 패널 탭인지와 그 대상 tabId를 `chrome.runtime.getContexts({contextTypes:["TAB"]})` **1회**로 조회한다(`tabId`·`documentUrl` → `parsePanelTabTarget`). `tabs` 권한 없이 자기 확장 컨텍스트를 돌려주고 Chrome 116+라 `minimum_chrome_version`과 맞는다. `tabs.get(...).url`은 `tabs` 권한 없이 확장 페이지 URL을 돌려주는지 미검증이라 쓰지 않는다.
  - `recordersToStopOnSwitch()` 결과만 정지한다. 조회 실패 시 panelTarget=null → 기존 동작(prev 정지)으로 떨어진다.
  - 기존 `SIDEPANEL_PATH` 상수는 `PANEL_PATH` import로 대체해 단일 출처로 만든다.
  - `apply(tabId)` 호출은 그대로 둔다. 패널 탭에 대해선 `setOptions({enabled:false})`가 되지만 무해하다(POSTMORTEM `apply()`=disable 액션 항목 참고).
  - panel port의 `sender.tab`(`background/index.ts:79-81`)은 SW 재시작 시 port가 끊기고 패널이 재연결하지 않아(`App.tsx:254-257`) 단독 출처로 쓰지 않는다.
- **`src/background/capture-throttle.ts`**: inactive 메시지·rate-limit 술어를 `@/lib/capture-messages`에서 import한다(동작 불변).
- **`src/sidepanel/scroll-capture.ts`**: `"tab is not active"` 리터럴(`:74,91`)을 `capture-messages` 상수로 바꾼다. `defaultDeps.captureTab`은 그대로 둔다(타일마다 handoff하지 않는다).
- **`src/sidepanel/capture.ts`**:
  - `captureElementSnapshot`·`captureElementSnapshotBySelector` **본문 전체**(prepare→capture→endCapture)를 `withTargetHold(tabId, ...)`로 감싼다. sendBg 한 줄만 감싸면 prepare(`scrollIntoView` + rAF 2회)가 숨은 T에서 돌아 rAF가 안 뜨고(`content/picker.ts:551-569` → 500ms 뒤 rect=null), `afterPaint`(`content/after-paint.ts:10-12`)가 hidden이라 대기를 건너뛰어 오버레이가 찍힌다(POSTMORTEM 2026-08-01과 같은 형태). 활성화한 뒤 prepare를 돌리면 content의 `afterPaint`가 정상으로 프레임을 기다린다.
  - 실패 발화는 **여기 한 곳**이다: `!prep?.rect` → `onCaptureFailed.fire("element-missing")`, catch → `fireCaptureFailure(err)`. `!usable`(basis downgrade)은 의도된 스킵이라 발화하지 않는다(`StyleChangesTable.tsx:157-165` 주석의 "에러로 오인되지 않게" 의도 유지).
  - `maybeSurfacePermissionExpired` 우선 규칙은 유지한다. 토스트는 그 else 분기에서만, 그리고 deferred 플래그(`activeTabExpiredDeferred`, `usePickerMessages.ts:53-57`)가 꺼져 있을 때만 발화한다.
- **`src/sidepanel/hooks/usePickerMessages.ts`**:
  - **before 캡처 hold — 두지 않는다(B2a 구현 후 정정)**: 처음엔 styling 전이와 before 발사 사이 비동기 구간을 막으려 명시 hold를 두려 했으나, 실제로는 `getTopViewport().then`이 `void`이고 before 발사가 같은 동기 블록 안이라 `captureElementSnapshot` → `withTargetHold`가 동기로 count를 올린다. picking 상태 hold의 release는 `useTabModeHold`에서 비동기라 count가 0을 거치지 않고, 거쳐도 restore의 재확인이 막는다. 명시 hold는 누수 면만 더해 제거했다(순서 테스트 `usePickerMessages.tabModeOrder.test.tsx`가 고정).
  - `captureAndCrop`(`:429`)·`captureAndInsertInline`(`:452`)을 `withTargetHold`로 감싼다. 영역 드래그는 사용자가 이미 T에 가 있어 활성화는 no-op이고, 끝나면 복원된다.
  - element shot null(`:404`)에서는 **발화하지 않는다**(`captureWithPrep`가 이미 발화 — 이중 토스트 방지).
  - stale 결과 폐기(`sameSelection` 불일치)·`controller.signal.aborted`에서는 발화하지 않는다.
- **`src/sidepanel/tabs/IssueTab.tsx`**:
  - 뷰포트 버튼(`:162-173`): 핸들러 진입에서 `holdTarget(tabId, "viewport")`를 잡는다. `selectFullViewport` → content `afterPaint` → `captureAndCrop`가 끝나면(또는 capturing 이탈 시) 놓는다. `!ok → reset()` 무음 실패에 `onCaptureFailed.fire("other")`를 추가한다.
  - 전체 페이지(`:120-160`): `runScrollCapture` 호출을 `withTargetHold(tabId, ...)`로 감싼다. catch에 `fireCaptureFailure`. 취소(`scroll capture aborted`)는 분류에서 null이다.
  - 탭 모드 && phase=capturing && 영역 방식이면 "대상 탭으로 이동해 영역을 드래그하세요" 한 줄(`tab-mode-area-hint`). 사이드패널에선 렌더하지 않는다.
- **`src/sidepanel/tabs/StyleEditorPanel.tsx:180`(after), `useBufferThenSwitch.ts:40`(buffer 전환), `StyleChangesDialog.tsx:98`(재캡처)**: `captureElementSnapshot*`를 거치므로 hold·발화가 자동으로 걸린다. 코드 변경 없음(확인만).
- **`src/sidepanel/picker-control.ts`**: `captureFullViewport`(`:693`)는 `picker.selectFullViewport`만 보낸다. 변경 없음.
- **`src/sidepanel/lib/capture-error.ts`**: `classifyCaptureFailure()`·`CAPTURE_FAILURE_KEYS`·`fireCaptureFailure()`(classify → `onCaptureFailed.fire`, null이면 발화 없음) 추가. 기존 `isActiveTabPermissionError` 재사용. `fireCaptureFailure`를 여기 두는 이유: Phase A(토스트)가 탭 모드 셸(Phase B) 없이 ship되어야 한다.
- **`src/lib/app-events.ts`**: `onCaptureFailed = createEmitter<[kind: CaptureFailureKind]>()` 추가(순수성 테스트 대상 파일. emitter 수 단언 8→9).
- **`src/sidepanel/App.tsx`**:
  - `onCaptureFailed` 구독 → `toast.error(t(CAPTURE_FAILURE_KEYS[kind]))`. 사이드패널·탭 모드 공통(가드레일 예외). 기존 이벤트 8개는 전부 AlertDialog로 이어지므로 이건 새 패턴이다 — DESIGN §14에 "차단성 이벤트는 다이얼로그, 비차단 실패는 이벤트 → 토스트" 한 줄을 남긴다.
  - **early return 단계**(`App.tsx:264-267`, `UnsupportedPage`·self 바인딩 `useEffect`(`:244-262`의 picker/bg port 연결)보다 앞)에서: 정수 `?tabId=`가 있으면 `getSelfTab()`을 기다리지 않고 그대로 진행(사이드패널 정상 경로 무지연 — B2b 리뷰 D1 정정), 쿼리가 없을 때만 `getSelfTab()` 결과가 나올 때까지 null 렌더 + 부작용 훅에 null tabId, 탭 모드 && `parsePanelTabTarget(location.href)===null`이면 `TabTargetPicker`를 전체 화면으로 렌더하고 반환. 잔상("캡처할 수 없습니다")·self port·레코더 주입 부작용을 막는다.
  - 탭 모드면 탭 바 아래에 `TabModeAgentHint`(picker 화면에도 렌더).
  - `useTabModeHold()` 마운트.
- **`src/sidepanel/hooks/useBoundTabId.ts`**: 변경 없음. 대상 선택 판정은 "탭 모드 && 쿼리 없음"으로 App이 한다(`boundTabId === selfTabId` 비교는 폴백이 임의 탭을 돌려줄 수 있어 쓰지 않는다). 선택 결과는 `location.replace(buildPanelUrl(base, id))`로 쿼리를 박는다 — `useBoundTabId`가 약 20곳에서 따로 질의하고 `popstate`를 안 들어서 전체 리로드가 맞다. 정수 판정은 `readQuery`(`Number.isFinite`)와 새 파서(정수만)를 맞춘다.
- **`src/components/ui/collapsing-tabs.tsx`**: `TabLabel`이 접힐 때 `hidden` → `sr-only`, 측정 중엔 `group-data-[measuring]/tabs:not-sr-only`. 보험으로 `whitespace-nowrap`. sr-only는 absolute라 flex gap에서 빠지고 측정은 트리거 단위 `scrollWidth` + `max-content`라 회귀 없음(CDO 확인). 소비처 9곳(log-viewer `App.tsx:163` 포함).
- **`src/sidepanel/tabs/SubmitPlatformTabs*`**: 아이콘을 `aria-hidden`(장식)으로 — simple-icons svg `<title>`·`SlackIcon aria-label`과 sr-only 라벨이 합쳐져 "Slack Slack"처럼 이름이 중복되는 걸 막는다.
- **`src/i18n/namespaces/issue.ts`**: `issue.captureFailed.{inactive,rateLimit,elementMissing,other}`, `issue.tabMode.areaHint` × 5 로케일. ko는 -습니다체(이웃 `issue.capturing.truncated`·429 문구와 일치).
- **`src/i18n/namespaces/app.ts`**: `app.tabMode.agentHint`, `app.tabTarget.{title,description,empty}` × 5 로케일. agentHint는 로케일별 번역 + `#__BUGSHOT_AGENT__` 리터럴 유지. 패널 UI 사전이고 log-viewer 복제 사전 대상 아님.
- **`src/sidepanel/index.html`** 매뉴얼 본문:
  - "Order contract": 같은 창 허용. 대상 ↔ 자기 패널 탭 전환은 기록 유지. 대상에서 곧장 제3 탭으로 가면 정지(기존). 한 대상에 패널 하나.
  - "Panel URL": 쿼리 없으면 대상 선택 화면.
  - "Before you trigger a capture": 같은 창이면 패널이 캡처 동안 대상을 스스로 앞으로 가져온다(에이전트 도구가 이를 사용자 조작으로 오판할 수 있음). 영역 드래그는 직접 대상 탭으로 가서. 별도 창도 여전히 동작한다.
  - 리플레이 탭 모드 한계(패널이 앞이면 프레임 0, T가 앞이면 throttle) — 구현은 별도 "Limits of a panel opened as a tab" 섹션에 리플레이 한계·한 대상에 패널 하나를 모았다.
  - (B3 구현 기준 추가) 선택 화면 동안엔 아무것도 기록되지 않는다(pick → App이 부작용 훅에 null). 패널을 보여 줘도 재무장된다는 약속은 하지 않는다 — 정지됐으면 대상 페이지를 리로드하라고 쓴다(같은 창에선 visibilitychange 재무장이 실제로 일어나지만 결과와 무관하게 참인 문장으로). 후보 testid는 접두사 `tab-target-option-`로 바인딩. 캡처 실패 토스트의 예외 두 개(activeTab 만료 = 다이얼로그, after 좌표 불신 스킵 = 무토스트) 명시. agent hint는 첫 프레임 존재를 주장하지 않는다.
  - 탭 모드 전체 페이지 캡처 중엔 패널의 진행률·취소가 가려진다. 취소하려면 패널 탭으로 돌아간다 — 다음 타일에서 중단되고 실패 토스트가 뜬다(orch.md D7. 캡처 중 Esc 리스너는 없다).
- **`src/sidepanel/__tests__/agentManual.test.ts`**: `:260`의 `"stopRecorders(prevTabId)"` 리터럴 바인딩을 새 판정 함수 호출 바인딩으로 교체(Task 2와 같은 커밋) + 새 주장 바인딩(테스트 계획).
- **e2e**: `e2e/fixtures/extension.ts`(`pickElement`의 `keepFixtureActive`·`bringToFront` 우회 재검토), 우회 사용 spec들, `e2e/GOTCHAS.md` 9·15·16·18·46항, `e2e/MANUAL-SMOKE.md`(사이드패널 정상 경로 수동 잔여 등재).
- **문서**: `docs/ARCHITECTURE.md`(탭 모드 섹션 신설 + 매뉴얼 범위 "도그푸딩" 한정 서술 갱신), `docs/DIRECTORY.md`(신규 파일), `docs/DESIGN.md`(:268 `group-data-[measuring]/tabs:inline` 서술 갱신, §14 토스트 한 줄), `guide/{ko,en}/agent-automation.md` 신규 + `SUMMARY.md` + `guide/AUTHORING.md` IA(26→27페이지, 패널 URL·매뉴얼 id 노출 예외 근거).

## 캡처 진입점 표

| # | 경로 | 위치 | hold | 실패 발화 |
|---|---|---|---|---|
| 1 | 요소 편집 before | `usePickerMessages.ts:121-192` → `captureElementSnapshot` | picking 상태 hold → 트랜잭션(동기로 이어짐) | `captureWithPrep` |
| 2 | 요소 캡처(element shot) | `usePickerMessages.ts:402` → `captureElementSnapshot` | picking + 트랜잭션 | `captureWithPrep`(호출부 `:404`는 발화 안 함) |
| 3 | after(Next) | `StyleEditorPanel.tsx:180` | 트랜잭션 | `captureWithPrep` |
| 4 | buffer 전환 | `useBufferThenSwitch.ts:40` | after 캡처 + `switchAction`(repick 진입)을 한 `withTargetHold`로 묶음(따로 두면 패널 복귀 후 picking이 대상을 다시 끌어와 깜빡임) | `captureWithPrep` |
| 5 | diff 재캡처 | `StyleChangesDialog.tsx:98` → `…BySelector` | 트랜잭션 | `captureWithPrep` |
| 6 | 영역 드래그 | content drag → `captureAndCrop` → `capture.ts:captureTargetTab(tabId,"area")` | "area"(사용자가 이미 T에 — 활성화는 안 하지만 끝나면 패널로 복귀) | catch |
| 7 | 뷰포트 | `viewport-capture.ts:runViewportCapture`(IssueTab에서 추출) → `selectFullViewport` → `captureAndCrop` | "viewport"(버튼~crop 완료 또는 capturing 이탈. ok인데 `areaSelected`가 안 오면 5초 상한으로 해제) | `!ok` + catch |
| 8 | 인라인 영역 | `captureAndInsertInline`(`:452`) | inline 상태 + 트랜잭션 | catch |
| 9 | 전체 페이지 | `IssueTab.tsx:120-160` → `runScrollCapture` | 트랜잭션(바깥 1회) | catch(취소는 null) |
| — | 30s 리플레이 폴링 | `use-30s-replay.ts` | 없음 | 없음(비목표) |

## 데이터 흐름

```
[background] tabs.onActivated({tabId: next, windowId})
   prev = resolveTabSwitch(map, windowId, next)                       (기존)
   ctxs = chrome.runtime.getContexts({contextTypes:["TAB"]})          (실패 시 [])
   prevPanelTarget = parsePanelTabTarget(ctxs.find(c=>c.tabId===prev)?.documentUrl, panelBase)
   nextPanelTarget = parsePanelTabTarget(ctxs.find(c=>c.tabId===next)?.documentUrl, panelBase)
   for id of recordersToStopOnSwitch({prevTabId, nextTabId, prevPanelTarget, nextPanelTarget}):
       stopRecorders(id)
   apply(next)                                                        (기존)

[panel] holdTarget(targetTabId, reason) → release()
   self = getSelfTab()                     // null이면 사이드패널 → no-op release
   count++
   if count 0→1:
      target = chrome.tabs.get(targetTabId); selfNow = chrome.tabs.get(self.id)   // windowId는 매번 조회
      if shouldActivateTarget({ self: selfNow, target }):        // 같은 창 && target 비활성
         returnToPanel = self.active   // 활성화 시점에 패널이 앞이었을 때만 끝나고 패널로 복귀(제3 탭에서 포커스 탈취 금지)
         await chrome.tabs.update(target, {active:true})          // resolve 값의 active 또는 onActivated로 확정 — 폴링 금지
   release():
      count--
      if count===0 && returnToPanel:      // area hold는 활성화 없이도 returnToPanel=true
         returnToPanel = false
         target = chrome.tabs.get(targetTabId)                    // 닫혔으면 복원 안 함
         if shouldRestorePanel({ target }): focusTab(self.id)      // T가 여전히 활성일 때만

[panel] withTargetHold(tabId, run) = hold → try run() finally release()

[panel] useTabModeHold (탭 모드에서만 구독)
   targetHoldFromState({phase, inline}) → { picking: phase==="picking", inline: inline }
   각 reason별로 false→true면 holdTarget, true→false면 release
```

- 활성화는 `captureOwnedTab`의 `tab.active` 재확인(큐 대기 후)을 그대로 거친다. 관문을 우회하지 않는다.
- 활성화 대기는 패널 문서에서 돈다. 활성화 직후 패널은 background 탭이라 setTimeout이 1s 단위로 정렬되므로 `tabs.get` 폴링은 쓰지 않는다. 확정 후 paint 대기는 content의 `afterPaint`가 맡는다(트랜잭션이 prepare까지 감싸므로).
- 셸 상태(`count`·`returnToPanel`)는 직렬 chain으로 갱신되고 restore는 조회 뒤 `count !== 0`을 재확인한다. 상태는 모듈 단일 인스턴스다. phase hold와 캡처 트랜잭션 hold가 같은 count를 공유하므로, 재선택(to-target) 중 늦게 끝난 after 캡처가 패널을 되돌리는 경쟁이 없다.

## 인터페이스 설계

```ts
// src/lib/panel-tab-url.ts
export const PANEL_PATH = "src/sidepanel/index.html";
/** panelBase = chrome.runtime.getURL(PANEL_PATH). 같은 origin·path이고 쿼리 tabId가 정수일 때만 반환. */
export function parsePanelTabTarget(url: string | undefined, panelBase: string): number | null;
export function buildPanelUrl(panelBase: string, targetTabId: number): string;
export interface TabSwitch {
  prevTabId: number | null;
  nextTabId: number;
  /** prev/next가 BugShot 패널 탭이면 그 대상 tabId, 아니면 null */
  prevPanelTarget: number | null;
  nextPanelTarget: number | null;
}
/** 정지할 탭 id 목록. 기존 "prev를 정지"에 자기 패널 예외만 더한다.
 *  prev=T, next=T의 패널 (nextPanelTarget===prev) → []   (자기 패널로 이동: 기록 유지)
 *  prev=T의 패널, next=T (prevPanelTarget===next) → []   (돌아옴: 아직 돌고 있음)
 *  prev=T의 패널, next=X(≠T)                       → [prev] (패널 id라 no-op — T 계속 기록, 현재 동작과 같음)
 *  prev=P(일반), next≠P                            → [P]  (기존 동작)
 *  prev null 또는 prev===next                       → [] */
export function recordersToStopOnSwitch(s: TabSwitch): number[];

// src/lib/capture-messages.ts
export function captureInactiveMessage(tabId: number): string;   // capture-throttle가 throw
export const SCROLL_TAB_INACTIVE_MESSAGE: string;                 // scroll-capture가 throw
export function isCaptureInactiveError(err: unknown): boolean;    // 두 메시지 + "tab has no window"
export function isCaptureRateLimitError(err: unknown): boolean;   // MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND
export const SCROLL_CAPTURE_ABORTED_MESSAGE: string;              // "scroll capture aborted"

// src/sidepanel/lib/tab-mode.ts
export interface TabLike { id?: number; windowId?: number; active?: boolean; url?: string; title?: string }
/** self=null(사이드패널) → false. 다른 창 → false. 같은 창 && target 비활성 → true. */
export function shouldActivateTarget(a: { self: TabLike | null; target: TabLike }): boolean;
/** target 없음(닫힘) → false. target 비활성(사용자가 제3 탭으로 감) → false. */
export function shouldRestorePanel(a: { target: TabLike | null }): boolean;
export type HoldReason = "picking" | "inline" | "area" | "viewport" | "capture";
/** 상태 기반 hold. before/viewport/capture는 호출부가 명시적으로 잡는다. */
export function targetHoldFromState(s: { phase: EditorPhase; inline: boolean }): { picking: boolean; inline: boolean };
/** self 제외, isSupportedUrl 통과, 모든 창, 같은 창 먼저(각 그룹 안에선 원래 순서 유지) */
export function listTargetCandidates(tabs: TabLike[], self: { id: number; windowId: number }): TabLike[];

// src/sidepanel/lib/capture-error.ts
export type { CaptureFailureKind } from "@/lib/app-events";
/** null = 토스트 없음: activeTab 만료(기존 다이얼로그), 사용자 취소, 그 외는 4분류. */
export function classifyCaptureFailure(err: unknown): CaptureFailureKind | null;
export const CAPTURE_FAILURE_KEYS: Record<CaptureFailureKind, TranslationKey>;
export function fireCaptureFailure(err: unknown): void;           // classify → null 아니면 onCaptureFailed.fire

// src/sidepanel/tab-mode.ts (browser-bound)
export function getSelfTab(): Promise<{ id: number } | null>;     // id만 1회 캐시 — windowId는 창 이동 후 stale이라 매번 조회
export function holdTarget(targetTabId: number, reason: HoldReason): Promise<() => Promise<void>>;
export function withTargetHold<T>(targetTabId: number, run: () => Promise<T>): Promise<T>;
export function focusTab(tabId: number): Promise<void>;            // background `activateTab`과 이름 충돌 회피

// src/lib/app-events.ts
export type CaptureFailureKind = "inactive" | "rate-limit" | "element-missing" | "other";
export const onCaptureFailed: AppEvent<[kind: CaptureFailureKind]>;
```

`CaptureFailureKind`는 `app-events.ts`가 `sidepanel/lib`을 import하지 않게 하려고 `src/lib/app-events.ts` 안에 type으로 정의한다(`app-events.test.ts` 순수성 유지 — type은 위반 아님).

`classifyCaptureFailure` 판정(메시지 문자열 기반 — `BgError`는 status 없이 message만 실어 온다, `background/index.ts:203` + `lib/bg-client.ts:25-29`):
- `isActiveTabPermissionError` → null
- message === `SCROLL_CAPTURE_ABORTED_MESSAGE` → null
- `isCaptureInactiveError` → inactive
- `isCaptureRateLimitError` → rate-limit
- 그 외 → other

`element-missing`은 throw가 아니라 `captureWithPrep`의 `!prep?.rect` 분기가 직접 발화한다. stale 결과 폐기는 호출부 가드(`sameSelection`·`signal.aborted`) 안에서 발화하지 않는 것으로 처리한다.

## 기존 패턴 준수

- **가드레일**: 탭 모드 UI는 전부 `getSelfTab() !== null` 게이트 뒤. 사이드패널에서 새로 보이는 건 실패 토스트뿐이다.
- **경계 규칙**: sidepanel ↛ `@/background/*` value import, store ↛ `sidepanel/tabs`. 공유 판정은 `src/lib/` leaf로 승격한다(`lib/jira-sprint.ts` 선례). `panel-tab-url.ts`·`capture-messages.ts`는 런타임 import 0(session-keys describe를 본뜬 소스 스캔으로 고정 — 공용 스캔 헬퍼는 없다).
- **캡처 관문 단일 출처**: `captureVisibleTab`은 background `captureThrottle.run(captureOwnedTab)`만 경유한다. panel 쪽 hold는 그 앞단 탭 활성화일 뿐이고, 관문의 `tab.active` 재확인을 없애지 않는다.
- **`chrome.scripting.executeScript({func})` 미사용.**
- **i18n**: 신규 키를 5개 로케일 전부에 추가한다(훅이 대칭 검사). `TranslationKey` 캐스트 금지. `CAPTURE_FAILURE_KEYS`는 `Record<…, TranslationKey>`로 값 쪽을 조인다.
- **UI**(탭 모드 전용):
  - `TabTargetPicker`: 헤더는 `IssueTab.tsx:308-347` 패턴(원형 아이콘 + 제목 + 설명), 행은 `JiraConnectForm.tsx:282-299` 사이트 선택 버튼(`Button variant="outline" h-auto justify-start` + `min-w-0` 2줄 `truncate` — 제목(없으면 hostname) / URL), 아이콘은 lucide `Globe` 고정(favicon은 제3자 요청·권한·privacy 대조가 따라와 쓰지 않는다), 스크롤은 `PageScroll`, 본문 `mx-auto max-w-[…]`(탭 모드는 폭이 넓다). 빈 상태는 `EmptyShell` 관용형 — `IssueTab.tsx:724`의 비공개 함수라 export로 빼거나 복제한다(구현 시 결정, 사이드패널 렌더 불변).
  - 목록은 `tabs.onCreated`·`onRemoved`·`onUpdated`(url·title) 구독으로 실시간 갱신한다. 새로고침 버튼은 두지 않는다.
  - `TabModeAgentHint`: 탭 바 아래 `shrink-0` + `text-xs text-muted-foreground`(`bg-background` 위라 대비 통과), 라이브 영역 role 없음.
  - `bg-muted` 위 `text-muted-foreground` 금지(대비 테스트).
- **App 이벤트**: `lib/app-events.ts` 패턴을 따른다. 컴포넌트가 직접 toast하지 않고 App에서 구독한다.
- **커버리지**: 신규 browser-bound 셸 `src/sidepanel/tab-mode.ts`, `useTabModeHold.ts`를 `BROWSER_BOUND_EXACT`에 등재한다. 순수 4파일은 로직 스코프 안이다.
- **docs/privacy**: 새 캡처·수집·전송이 없다(탭 활성화와 같은 확장 탭 목록 표시만 추가, favicon 미사용). `runtime.getContexts`는 자기 확장 컨텍스트 조회다. 트리거 대상은 아니지만 `/push` 트라이아지에서 재확인한다.

## 대안 검토

- **"별도 창만 지원"(handoff 없이 안내 토스트)**: 단순하지만, 창 하나에 묶인 에이전트(ego 실측: 탭을 새 창으로 옮기면 태스크 스페이스에서 빠짐)는 계속 못 쓴다. 사용자 결정으로 기각했다.
- **sendBg 한 줄 감싸기(깊이 카운트) + phase 전이표 훅 분리**: 최초 설계. prepare가 숨은 T에서 돌아 재캡처가 항상 실패하고, styling 복귀가 before 캡처와 경쟁하며, 동시 캡처에서 바깥 호출의 finally가 다른 캡처를 inactive로 만든다. 단일 refcount hold로 대체했다.
- **background `captureVisibleTab` 핸들러에서 handoff**: 패널 쪽 교체가 필요 없어 보이지만, 핸들러 시점엔 prepare가 이미 숨은 T에서 끝나 있다. 같은 이유로 기각.
- **타일마다 handoff(scroll capture)**: 타일 수만큼 탭이 깜빡이고, `scroll-capture.ts`의 타일 전후 `isTabActive` 재확인과 경쟁한다. 바깥 1회 감싸기로 대체했다.
- **패널 탭에 레코더 상태를 위임(대상 정지 후 패널이 재무장)**: 재주입은 `useBackgroundRecorder`의 visibility 경로에 걸려 있다. 별도 창에선 패널이 hidden이 안 돼 트리거가 없다(POSTMORTEM 매뉴얼 회고). 그 사이 로그가 빈다. 정지 자체를 안 하는 쪽이 단순하고 무손실이다.
- **패널 → 제3 탭 전환 시 T 정지(사이드패널 계약과 동등화)**: 신규 정지 동작이고, 별도 창 모드에서도 T를 멈추며(창 축 필요), X → T 복귀 시 재무장 경로가 없어 공백이 생긴다. 현재 동작(T 계속 기록) 유지로 기각.
- **`tabs.get(...).url`로 패널 탭 판정**: `tabs` 권한 없이 확장 페이지 URL을 돌려주는지 미검증이고, 빈 값이면 단위 테스트 green인 채 무음 무력화된다(POSTMORTEM 2026-07-27 형태). `runtime.getContexts`로 대체.
- **매뉴얼을 `body`의 `sr-only` 요소로 상시 노출**: 사이드패널 사람 사용자의 스크린리더가 매번 읽는다. 탭 모드 한정 안내로 기각했다.
- **`useBoundTabId` 폴백을 "직전 활성 탭"으로 추론**: Chrome에 탭 활성 이력 API가 없고, `openerTabId`는 에이전트의 `goto`/새 탭 경로에서 비어 있다. 명시적 선택 화면이 확실하다.
- **영역 방식 선택 시 to-target**: `capture-method-area` 버튼에 새 동작이 붙어 사이드패널 UI가 바뀐다(가드레일 위반). 탭 모드 안내 한 줄로 대체.

## 위험 요소

- **e2e 하네스 전제 반전**(최대 위험): e2e는 전부 같은 창 탭 모드다(`openPanel`). hold·자동 활성화가 들어가면 우회(`bringToFront` 52회/20 spec, `el.click()` 5곳/4 spec, 합계 약 62건)가 불필요해지거나 오히려 경쟁한다.
  - 예: product가 패널을 되돌리는 순간 spec이 fixture를 앞에 두려 함. picking 중 T가 앞이면 숨은 패널 탭에서 Playwright 클릭 actionability가 정체된다(GOTCHAS 18 — `api-hosts-env-row.spec.ts:180`, `picker-guard.spec.ts:52-55`의 `picking-cancel`).
  - `pickElement`의 `panel.bringToFront()`(`extension.ts:307`)·`settleBeforeCapture`가 자동 전환과 충돌한다.
  - eval-host 탭이 같은 창의 제3 탭이다. lazy 생성 시 그 탭이 활성화되므로 최초 `fixtureTabId()` 호출 순서가 fixture 상태를 바꾼다.
  - E7(`action-log-nav-type.spec.ts:132-163`)은 정지 의미 변화 영향을 확인한다.
  - POSTMORTEM 2026-07-26 tab.active 관문 항목(`:1416`) 회로를 그대로 밟는다. 착수 전 `grep -rn 'bringToFront\|el.click()\|keepFixtureActive' e2e/`로 우회를 전수하고, 우회마다 이유를 확인한 뒤 제거·유지를 판정한다.
- **사이드패널 정상 경로의 e2e 대표성 상실**: e2e가 전부 탭 모드라 `getSelfTab()=null` 경로가 e2e에서 한 번도 돌지 않는다. `e2e/MANUAL-SMOKE.md` 수동 잔여에 등재한다.
- **활성화 대기 레이스**: `chrome.tabs.update` resolve가 곧 캡처 가능 프레임은 아니다. 트랜잭션이 prepare까지 감싸므로 content `afterPaint`가 프레임을 기다린다. 활성화 확정이 안 되면 run은 진행하고, 관문이 inactive로 거부하면 토스트로 드러난다(무음 실패 금지).
- **에이전트 도구의 제어권 오판**: 제품이 스스로 탭을 바꾸면 ego류 도구가 이를 "사용자 조작"으로 볼 수 있다. 이번 스모크의 오판이 이미 캡처 직후에 몰려 있었다. 가이드·매뉴얼에 "패널이 캡처 동안 대상 탭을 잠깐 앞으로 가져온다"를 명시한다.
- **`onActivated` 비동기화**: `getContexts` 1회가 추가돼 정지가 수 ms 늦어진다. 그 사이 제3 탭으로 빨리 넘어가도 판정은 그 전환 쌍 기준이라 정확하다. 조회 실패면 panelTarget=null → 기존 동작(prev 정지)으로 떨어진다.
- **패널 탭 판정 프로브**: `runtime.getContexts`가 탭 모드 패널의 `tabId`·`documentUrl`(쿼리 포함)을 돌려주는지, 사이드패널에서 `tabs.getCurrent()`가 `undefined`인지를 Task 착수 전 실브라우저로 1회 확인한다. 안 되면 설계를 다시 연다.
- **handoff 부수 비용**:
  - 패널 복원 때마다 `visibilitychange` → `inject()`(ping + executeScript + 센티널 재발행, `useBackgroundRecorder.ts:113-118`)가 돈다. 정지 예외로 레코더는 살아 있어 무해하므로 가드는 추가하지 않는다.
  - 탭 모드 전체 페이지 캡처 중엔 T가 앞이라 패널의 진행률·취소(`IssueTab.tsx:494`)가 가려지고, 숨은 패널 문서는 타이머가 throttle되고 rAF가 멈춰 오케스트레이터가 느려질 수 있다. 소요 시간·취소 수단을 수동으로 실측한다.
  - 숨은 패널 탭이 Memory Saver로 discard되면 port 해제 → `stopRecorders(T)`(`background/index.ts:91-107`)로 이어진다.
- **TabLabel `sr-only` 측정**: jsdom은 CSS를 로드하지 않아 `getByRole({name})`은 수정 전에도 green이다 — 그물은 클래스 단언과 실제 Chrome e2e(`webhook-submit.spec.ts:398-428`의 9개 탭 forceCollapsed)다. 가이드 스크린샷 stale 가능성은 `/guide-shots`로 확인한다.
- **매뉴얼 그물**: `agentManual.test.ts`는 뮤테이션 실측을 요구한다(파일 헤더). 새 케이스마다 구현을 되돌려 red를 눈으로 본다.
