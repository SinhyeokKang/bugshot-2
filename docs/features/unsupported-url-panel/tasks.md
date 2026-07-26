# 미지원 URL에서 사이드 패널 열기 + 미지원 안내 — 구현 태스크

> 코드 인용은 모두 **HEAD `3655e7e` / v1.6.18** 기준. 줄번호가 어긋나면 심볼명으로 대조할 것.
> Phase 1(Task 1~7)과 Phase 2(Task P·8~10)는 **별도 커밋**으로 나눈다. 분리 이유는 design.md 위험 요소 6 참조.
> **Phase 경계가 초기안과 다르다** — `apply()` 수정이 Phase 1로 올라왔다(Task 3). 안 그러면 패널이 열린 직후 다음 탭 전환에 다시 닫혀 Phase 1이 목표 1을 달성하지 못한다(design.md "Phase 경계").

## 선행 조건

- 새 권한 **없음**. `manifest.config.ts` 변경 없음. (`tabs` 권한 추가는 기각 — design.md 대안 J.)
- 새 env·의존성 **없음**.
- **새 i18n 키 2개** — `app.captureUnsupported.title`/`app.captureUnsupported.body`를 ko/en 양쪽에 추가한다. 기존 `app.unsupported.*` 재사용은 기각(문구가 목표 2를 부정 + `app.ts:47-48`의 "맥락 다르면 분리" 컨벤션 위반 — design.md 참조). `Globe` 아이콘은 `App.tsx:486`에서 이미 lucide-react로 사용 중.
- `chrome.storage` 스키마 변경 없음 → **마이그레이션 불필요**.
- 착수 전 `docs/POSTMORTEM.md`에서 `activeTab`·`service worker`·`sidePanel`을 grep해 과거 함정 소환(CLAUDE.md 원칙). 특히 `:400-405`(사이드패널은 activeTab 재취득 불가, `<all_urls>`가 `tabCapture`를 커버하지 못함), `:301-305`(Playwright가 module SW 컨텍스트를 못 잡음), `:373-378`(캡처 스로틀 전역 큐 결합).

---

## Phase 1 — 미지원 페이지에서 패널이 열리고 유지된다

### Task 1: `activateTab` 단위 테스트 선행 작성 (TDD red)

- **변경 대상**: `src/background/__tests__/tab-bindings.test.ts`
- **작업 내용**: `activateTab`의 테스트를 **먼저** 작성한다. 현재 이 함수의 단위 테스트는 **0개**이고 e2e 그물도 없다(design.md 위험 요소 2) — 이 테스트가 유일한 안전망이 된다.

  **스텁 표면을 반드시 아래대로 만든다.** 이 파일은 현재 순수 함수 전용이라(import가 `{ describe, it, expect }` + 순수 함수뿐, `vi`도 `chrome`도 `beforeEach`도 없다) 이 테스트가 파일 최초의 chrome 스텁을 도입한다. 스텁이 얕으면 **red의 이유가 가드가 아니라 스텁이 되어 판정이 오염된다**:
  - `chrome.sidePanel.setOptions` → **thenable 반환**(변경 후 `.catch`가 붙는다)
  - `chrome.sidePanel.open` → **thenable 반환**(`:218-220`에 이미 `.catch`가 붙어 있어 `vi.fn()`(undefined)이면 `TypeError`로 죽는다)
  - `chrome.storage.session.get` → Promise 반환 (`setActivated:222` → `getActivatedSet:16`이 호출)
  - `chrome.storage.session.set` → Promise 반환 (`:224`)

  케이스:
  - 미지원 URL(`https://chromewebstore.google.com/detail/x`, `chrome://version`)에서 `setOptions({enabled:true})`와 `open({tabId})`가 **둘 다 호출**된다
  - 두 호출이 **동기적으로** 이뤄진다 — user gesture 보존 단언. **호출과 `expect` 사이에 `await`를 하나도 넣지 않는다**(테스트 함수가 `async`인 것은 무방하나 그 구간엔 금지). 이 조건이 깨지면 단언이 무력화된다
  - `expect(activateTab(tab)).toBeUndefined()` — `async` 승격(= Promise 반환)을 시그니처 변경 없이 런타임에서 즉시 잡는 값싼 가드
  - `setOptions`가 `open`보다 먼저 호출된다(호출 순서)
  - `tab.id == null`이면 아무것도 호출되지 않는다
  - 지원 URL에서도 동일하게 호출된다(회귀 방지)
- **검증**:
  - [ ] `pnpm test` 실행 시 미지원 URL 케이스가 **실패**한다(아직 가드가 살아 있으므로 — red 확인)
  - [ ] 실패 메시지가 "호출 안 됨"이지 `TypeError`가 아니다(스텁 오염 배제)
  - [ ] `tab.id == null` 케이스와 지원 URL 케이스는 통과한다

### Task 2: `activateTab`의 미지원 가드 삭제 (green)

- **변경 대상**: `src/background/tab-bindings.ts:210`
- **작업 내용**: `if (!isSupportedUrl(tab.url)) return;` 한 줄을 **삭제**한다. 주석 처리가 아니라 삭제. 아래 `setOptions`→`open`의 **동기 호출 순서를 절대 바꾸지 않는다** — `await`를 하나라도 넣으면 gesture가 소실되어 조용히 실패한다(`docs/ARCHITECTURE.md:15-36`).
  - `setOptions`(`:213-217`)에 `.catch((err) => console.error("[bugshot] sidePanel.setOptions", err))`를 붙인다. 바로 아래 `open()`·`apply()`(`:45-53` try/catch)와 대칭이 맞고, 위험 요소 1의 오진을 줄인다.
  - `isSupportedUrl` import는 유지 — `isBroadCoveredUrl:137`이 계속 쓴다.
- **검증**:
  - [ ] Task 1의 테스트가 전부 통과(green)
  - [ ] `pnpm typecheck` 통과 (`isSupportedUrl` 미사용 오류가 나지 않음)

### Task 3: `apply()`에서 `supported` 제거 — 패널 지속성 확보

- **변경 대상**: `src/background/tab-bindings.ts:38, 44, 61`
- **작업 내용**: `apply()`의 enable(`:44`)·disable(`:61`) 조건에서 `supported`를 제거해 `activated`만 보게 한다. `supported` 지역 변수(`:38`)가 미사용이 되면 함께 제거.
  - **불변식**: 패널 표시 여부는 activation을 따르고, 지원 여부는 패널이 무엇을 그리는지만 결정한다.
  - 안 고치면 `onActivated`(`:255`)·`onUpdated`(`info.url` / `status==="complete"`) 세 경로가 방금 열린 패널을 `setOptions({enabled:false})`로 닫는다. `:59`의 `shouldPreserveSession` 조기 반환은 idle 세션에선 보호막이 안 된다.
- **검증**:
  - [ ] `pnpm test` 전체 통과 (`apply` 관련 기존 테스트가 있으면 함께 확인)
  - [ ] `pnpm typecheck` 통과
  - [ ] 수동: 미지원 페이지에서 패널 열기 → 다른 탭 전환 → 복귀 시 **패널이 유지된다** (이 태스크의 유일한 행동 검증 수단 — 단위·e2e로 잡히지 않는다)

### Task 4: `useTabSupport` 훅 신규 작성

- **변경 대상**: `src/sidepanel/hooks/useTabSupport.ts` (신규), `src/sidepanel/hooks/__tests__/useTabSupport.test.tsx` (신규 — **확장자 `.tsx`**)
- **작업 내용**: `classifyTabSupport`(`src/lib/url-support.ts:42-51`) 기반으로 바인딩 탭의 미지원 여부를 boolean으로 반환. 테스트를 먼저 작성한다.
  - 마운트 시 `chrome.tabs.get(tabId)` → `classifyTabSupport({ url: tab.url })`
  - `chrome.tabs.onUpdated` 구독. **`info.url`에만 의존하지 않는다** — `tabs` 권한이 없어 `https → chrome://` 전이에서 `changeInfo.url`이 redact된다. `info.status` 전이에서 `chrome.tabs.get(tabId)`로 재조회해 재판정한다. 선례는 `useBackgroundRecorder.ts:45-46`(`status==="complete"`에서 `tabs.get` + `isSupportedUrl`)
  - **반환 규약**: `classifyTabSupport`가 `"unsupported"`일 때만 `true`. **빈/`undefined` `tab.url`은 `"unsupported"`이므로 `true`다** — `chrome://` 감지가 이것에 달려 있다(design.md 설계 결정 1). `"permission-expired"`와 판정 진행 중은 `false`(= 기존 UI 유지, design.md 설계 결정 3)
  - `tabIdRef` 패턴을 쓸 경우 실제 선례는 `useRecorderSyncInterval.ts:11-12`·`DebugTab.tsx:34-35`·`use-30s-replay.ts:43-44`
  - cleanup에서 `removeListener`
  - **`.tsx`여야 한다** — `vitest.config.ts`의 `environmentMatchGlobs`는 `[["**/*.test.tsx","jsdom"]]` 단 하나이고 `.test.ts`는 node라 `renderHook`이 `document is not defined`로 죽는다. 선례: `useAiLoadingStep.test.tsx`, `useReproPrefill.test.tsx`. (현재 저장소의 어떤 `.test.tsx`도 `chrome`을 스텁하지 않는다 — 16개 `vi.stubGlobal("chrome", …)`는 전부 node `.test.ts`. 기법은 동일하지만 이 훅이 첫 사례다.)
- **검증**:
  - [ ] `https://example.com`으로 마운트 → `false`
  - [ ] `tab.url`이 빈 문자열/`undefined`(= `chrome://` 실제 형태)로 마운트 → **`true`**
  - [ ] `tab.url = "chrome://version"`(테스트 편의상 명시 가능한 형태)으로 마운트 → `true`
  - [ ] 미지원으로 마운트 후 `onUpdated`에 `info.url = "https://example.com"` → `false`로 전이
  - [ ] 지원으로 마운트 후 `onUpdated`에 **`info.url` 없이 `info.status = "complete"`**만 오고 `chrome.tabs.get`이 빈 url을 주면 → `true`로 전이 **(프로덕션의 실제 미지원 전이 형태 — 이 케이스가 핵심)**
  - [ ] 다른 `tabId`의 `onUpdated`는 무시
  - [ ] `tabId`가 `null`/`undefined`면 `false`이고 `chrome.tabs.get`을 호출하지 않음
  - [ ] `chrome.tabs.get`이 reject하면(탭 종료) `false`로 접히고 unhandled rejection이 없음
  - [ ] 같은 tabId로 `onUpdated`가 여러 번(loading → complete) 와도 재판정이 idempotent
  - [ ] 언마운트 시 `removeListener` 호출

### Task 5: `sidepanel_opened`에 `page_supported` property 추가

- **변경 대상**: `src/background/analytics.ts:30`, `src/background/index.ts:89`, `src/background/__tests__/` (해당 테스트)
- **작업 내용**:
  1. `PROPERTY_ALLOWLIST`의 `sidepanel_opened: []`를 `["page_supported"]`로 확장. 목록 밖 property는 런타임에 제거되므로(`analytics.ts:22-31`) 이 줄이 없으면 계측이 **조용히** 무효화된다
  2. `captureEvent("sidepanel_opened", {})`에 `page_supported: boolean`을 실는다. 값은 `bgPort` 연결 시점 sender 탭 URL로 `isSupportedUrl` 평가
  3. 신규 이벤트는 만들지 않는다
- **검증**:
  - [ ] `page_supported`가 sanitize를 통과해 payload에 남는다 (단위 — 허용목록 필터를 직접 호출)
  - [ ] 허용목록에 없는 임의 property는 여전히 제거된다(회귀 방지)
  - [ ] 지원/미지원 양쪽에서 값이 각각 `true`/`false`로 실린다

### Task 6: `EmptyState` 미지원 분기 (제자리 교체) + i18n 신규 키

- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`, `src/i18n/namespaces/app.ts`, `src/sidepanel/tabs/__tests__/IssueTab.test.tsx` (신규)
- **작업 내용**:
  1. **i18n 신규 키 2개**를 ko/en 양쪽에 추가(문안은 design.md 표 그대로). `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행한다
  2. `EmptyState`를 **export**한다(`:277`). 지금은 비-export라 테스트가 `<IssueTab/>` 풀 렌더를 강요하고, 그러면 `DraftingPanel`·`PreviewPanel`·`StyleEditorPanel`(tiptap·sonner 포함 100+ transitive import)이 EmptyState 경로에서도 평가된다
  3. 시그니처에 `unsupported: boolean` 추가
  4. `:288`의 래퍼 div(아이콘+제목+**버튼 5개**, `:288-327`)를 `unsupported`일 때 `EmptyShell`로 교체하는 삼항. **새 컴포넌트 트리를 만들지 않는다.** `EmptyShell`(`:682-701`) 구성:
     - `icon={<Globe className="h-6 w-6 text-muted-foreground" />}`
     - `title={t("app.captureUnsupported.title")}`
     - children: `<p className="mt-1 text-sm text-muted-foreground">{t("app.captureUnsupported.body")}</p>` — **`mt-1` 필수**. `EmptyShell`의 `mb-3`은 아이콘↔제목 간격이고 `mt-4`는 `action` 슬롯 전용이라 **제목↔본문 간격이 없다**(`:695-700`). 기존 동형 빈 상태도 전부 명시적 간격을 준다
     - **`action` 슬롯 미사용** (자동 감지되므로 새로고침 불필요 — design.md 대안 H·I)
  5. `:328-330`의 `IntegrationsCta`와 `:331-345`의 `PageFooter`는 **분기 밖에 그대로 둔다**
  6. `PageFooter` 안 `[이슈 작성]`(`:340`, `data-testid="mode-freeform"`)을 `unsupported`일 때 **렌더하지 않는다**. `aria-disabled`를 쓰지 않는 근거는 design.md "기존 패턴 준수"(저장소 전수 30+곳이 전부 transient busy이고 영속 제약 선례 0곳, 대안 E 기각 근거와 자기모순). `[가이드]`(`:333-339`)만 남으므로 `:332`의 `flex items-center justify-between` 정렬을 1줄 조정
  7. `EmptyState` 호출부(`:241-252`)에서 `useTabSupport(tabId)` 결과를 `unsupported`로 전달
- **검증** (`IssueTab.test.tsx` — jsdom 트랙, export된 `EmptyState`에 props 직접 주입):
  - [ ] `unsupported=false`: `mode-element`·`mode-element-shot`·`mode-screenshot`·`mode-record`·**`replay-button`**이 보이고 `app.captureUnsupported.title`은 없음
  - [ ] `unsupported=true`: 위 **5개**가 모두 없고 `app.captureUnsupported.title`·`.body` 텍스트가 보임
  - [ ] `unsupported=true`에서도 `[가이드]` 버튼이 보이고 클릭 가능
  - [ ] `unsupported=true`에서 `mode-freeform`이 **DOM에 없음** (`onStartFreeform`이 호출될 경로가 없음)
  - [ ] `unsupported=false`에서 `mode-freeform` 클릭 시 `onStartFreeform`이 호출됨
  - [ ] 연동 0개 + `unsupported=true`에서 `IntegrationsCta`가 보임
  - [ ] 연동 1개 이상 + `unsupported=true`에서 `IntegrationsCta`가 없음

### Task 7: `DebugTab` 서브탭 잠금 + 서브탭 복귀 + sync 폴링 스킵 + 30s Replay 게이트

- **변경 대상**: `src/sidepanel/tabs/DebugTab.tsx`, `src/sidepanel/30s-replay/use-30s-replay.ts`, 해당 `__tests__/`
- **작업 내용**:
  1. `useTabSupport(tabId)`로 판정을 얻어(`DebugTab:19`에 이미 `useBoundTabId()`가 있다) `logTabsLocked`(`:32`)에 OR로 합친다: 녹화 중 **또는** 미지원이면 console/network `TabsTrigger`(`:70,77`)가 `disabled`. Radix 트리거이므로 기존 `disabled` 패턴 유지
  2. **미지원으로 전이할 때 `setSub("issue")`를 강제한다**(`sub`는 `:18`의 로컬 state이고 리셋 로직이 없다). 안 하면:
     - `TabsContent value="console"`이 계속 렌더돼 이전 페이지 로그가 현재 로그처럼 보인다
     - **안내는 issue 서브탭 안에 있어서 사용자가 안내를 아예 못 본다**
     - `ConsoleSubTab.tsx:41-43`·`NetworkSubTab.tsx:38-40`의 `[이슈 작성]`(testid 없음)이 완전히 활성인 채 남아 `ensureSupportedTab`에 막혀 `onPickerUnavailable` 다이얼로그가 뜬다 — 없애려던 "눌렀는데 에러 모달"이 뒷문으로 돌아온다
     - 포커스가 그 트리거에 있었으면 body로 날아간다
  3. 레코더 sync 폴링 effect(`:37-49`)에 미지원이면 조기 반환. 현재 `.catch(() => {})`라 미지원 페이지에서 1.5초마다 조용히 영구 실패한다
  4. `use-30s-replay.ts:88`의 600ms 폴링을 미지원이면 시작하지 않는다. `:85` 주석의 전제("`<all_urls>` required라 권한 확인 없이 폴링 시작")가 이 변경으로 깨진다. **웹스토어는 https라 캡처가 실제로 성공**해서 "사용할 수 없습니다"라고 써놓고 계속 찍는 상태가 되고, `chrome://`에서도 실패 호출이 `capture-throttle.ts`의 전역 큐(`CAPTURE_MIN_GAP_MS=500`)를 점유해 다른 창의 캡처에 지연을 부과한다(`docs/POSTMORTEM.md:373-378`)
  5. **테스트 가능성**: `logTabsLocked` 유도와 sync 스킵 조건을 순수 술어(`(phase, unsupported) => boolean` 형태)로 뽑아 node `.test.ts`로 고정한다. `<DebugTab/>` 풀 렌더는 `:92`에서 `<IssueTab/>`을 무조건 렌더해 Task 6의 import 그래프를 그대로 상속하고 거기에 sync 3종 스텁 + fake timer가 붙으므로, 실렌더 단언(서브탭 `disabled`)은 e2e에 맡긴다
- **sync 경로 주의**: 경로가 두 개다. `DebugTab:37-49` 인라인 effect와 `hooks/useRecorderSyncInterval.ts`(`ConsoleSubTab.tsx:17`·`NetworkSubTab.tsx:17`). **후자는 `disabled`와 무관하다** — deps가 `[active]`뿐이고(`useRecorderSyncInterval.ts:22-24`) `active`는 `sub === "console"`(`DebugTab.tsx:99,106`)이다. 작업 2의 `setSub("issue")`가 `active`를 `false`로 만들어 후자를 함께 멎게 한다. (초기안의 "후자는 도달하지 않으므로 전자만 고치면 된다"는 틀렸다.)
- **검증**:
  - [ ] 순수 술어: `unsupported=true` → 잠금 `true` / `phase==="recording"` → 잠금 `true`(회귀) / 둘 다 아니면 `false`
  - [ ] 순수 술어: `unsupported=true` → sync 스킵 `true`
  - [ ] `sub`가 `"console"`인 상태에서 미지원 전이 → `sub`가 `"issue"`로 복귀 (jsdom 또는 상태 전이 훅 단위)
  - [ ] `unsupported=true`에서 30s Replay 폴링이 시작되지 않음 (스텁 + fake timer로 `captureVisibleTab` 미호출 확인)
  - [ ] `unsupported=false`에서는 기존 sync·폴링이 정상 호출됨(회귀 방지)

### Task 8: `e2e/unsupported-url.spec.ts` 재작성

- **변경 대상**: `e2e/unsupported-url.spec.ts`, `src/sidepanel/tabs/IssueTab.tsx`(testid 부착만)
- **작업 내용**: 현재 시나리오(`:31` `mode-element` 클릭 → 다이얼로그 → `:37` `mode-element` 다시 보임)는 캡처 버튼이 사라지므로 성립하지 않는다. 새 시나리오로 전면 재작성:
  - `chrome://version` 탭에서 패널을 열면 미지원 안내가 보이고 캡처 버튼 5개가 없다
  - console/network 서브탭이 비활성이다
  - `[이슈 작성]`(`mode-freeform`)이 DOM에 없다
  - `[가이드]` 버튼은 존재한다
  - 같은 탭을 fixture 페이지(`ext.fixtureUrl("basic.html")`)로 이동시키면 **조작 없이** `mode-element`가 나타난다 ← 자동 감지 검증, 이 spec의 핵심
  - 기존 픽스처 활용: `ext.openPanel(tabId)`, `enterDebug(panel)`, 신규 탭 id를 `chrome.tabs.query` diff로 찾는 기존 방식(`:11-26`) 유지
- **`data-testid` 부착이 필수다** (e2e를 위한 `src` 수정은 testid 추가만 허용):
  - 안내 블록 — 렌더되는 문자열은 로케일 의존이라 텍스트 매칭 불가
  - `[가이드]` 버튼(`IssueTab.tsx:333-339`) — 현재 testid가 **없고** 라벨은 `t("settings.guide")`로 로케일 의존
- **주의**: `ext.openPanel`은 `activateTab`을 우회한다. 즉 이 spec은 패널 내부 UI만 검증하며 `activateTab`의 가드 삭제(Task 2)와 `apply()` 변경(Task 3)은 커버하지 않는다(Task 1 + 수동 검증이 담당). 이 spec이 깨지는 원인도 background 변경이 아니라 **Task 6의 UI 변경**이다.
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e -- unsupported-url` green
  - [ ] 재실행 1회 더 green (flaky 아님 확인)
  - [ ] first-paint 플래시(design.md 위험 요소 4) 때문에 안내 단언에 `waitFor`가 필요한지 확인 — 필요하면 명시적으로 붙인다

---

## Phase 2 — 동일 탭 네비게이션에서 지원 → 미지원 시 패널 유지 / 별도 커밋

### Task P: `webNavigation.onCommitted` 프로브 (착수 게이트 — 코드 커밋 없음)

- **작업 내용**: Phase 2의 라우팅이 `chrome://`에서 발화하려면 background가 새 URL을 **읽을 수 있어야** 한다. 현재 호출부는 `deactivatePanelIfCrossOrigin(tabId, info.url ?? tab.url)`(`:277`)이고 `chrome://`에서는 둘 다 `undefined`다 → `newUrlReadable === false` → `deactivate` → **Phase 2가 주 타겟에서 무효**.
  - `chrome.webNavigation.onCommitted` 리스너를 임시로 달고 `pnpm build` → 확장 리로드 → `https://example.com`에서 `chrome://settings`로 이동해 **서비스워커 콘솔에 `details.url`이 실제로 도착하는지** 확인한다. `webNavigation` 권한은 이미 보유 중이다.
  - 프로브는 확인 후 **원복**한다(작업 트리 클린 확인).
- **분기**:
  - **도착함** → Task 9~10 진행. `onCommitted`를 판정 입력원으로 추가하고 `newUrlReadable`을 그 값에서 파생
  - **도착하지 않음** → **Phase 2를 별도 feature로 분리하고 이번 스코프를 Phase 1로 확정한다.** 패널 내부 신호를 background로 올리는 역방향 배관이 필요해져 설계 규모가 달라지므로 여기서 이어붙이지 않는다
- **검증**:
  - [ ] `chrome://settings` 이동 시 `details.url` 도착 여부를 콘솔 로그로 기록
  - [ ] `file:///…` 이동 시에도 확인(파일 접근 토글 on/off 양쪽)
  - [ ] 프로브 원복 후 `git status` 클린

### Task 9: `resolveNavigationAction` 테이블 테스트 확장 (TDD red)

- **변경 대상**: `src/background/__tests__/tab-bindings.test.ts` (케이스 배열 `:83-162`)
- **작업 내용**: 기존 테이블 드리븐 케이스에 `newUrlReadable`·`newUrlSupported` 두 축을 추가하고 행을 보강한다. `:78`이 `type Input = Parameters<typeof resolveNavigationAction>[0]`이므로 필드 추가 시 **13행 전부 컴파일 에러**가 난다 — 채우는 값이 중요하다.
  - **`expected: "deactivate"`인 기존 행은 3개다** — `:105-107`(비보존+cross-origin), `:116-118`(미보유+비보존+커버 URL), `:139-141`(광역+비커버 `file:`). 세 행 모두 **`newUrlReadable: true, newUrlSupported: true`**로 채워야 기대값이 유지된다. 무심코 `newUrlSupported: false`로 채우면 새 라우팅에서 `clearSession`이 되어 깨진다
  - 신규 행: `newUrlReadable: true` + `newUrlSupported: false`(= 판독된 `chrome://`·웹스토어) + 비보존 + cross-origin → **`clearSession`**
  - 신규 행: `newUrlReadable: false`(판독 불가) + 비보존 + cross-origin → **`deactivate`** (기존 동작 보존 — `file:` + 파일 접근 토글 off가 여기 해당)
  - 신규 행: `newUrlReadable: true` + `newUrlSupported: false` + **보존** → `notifyDeferredExpiry` (기존 동작 유지)
  - 도달 가능/불가 구분을 유지한다. 관련 주석의 실제 위치는 **`e2e/activetab-broad-permission.spec.ts:6`**("미보유 닫힘·deferred 분기는 프로덕션 도달 불가 — 순수함수 회귀 자산")이고 단위 테스트 파일의 대응 주석은 `tab-bindings.test.ts:81-82`다
  - `file:` 불변식에 주석을 남긴다: 이 테이블이 지키는 "`file:` → `deactivate`"는 **파일 접근 토글 on일 때만** `newUrlSupported` 경로로 성립하고, off일 때는 `newUrlReadable: false` 경로로 성립한다 — 두 경로 모두 `deactivate`라는 것이 설계 의도다
- **검증**:
  - [ ] 신규 `clearSession` 행이 **실패**한다(아직 구현 전 — red)
  - [ ] `deactivate` 3개 행 + 판독 불가 행은 여전히 통과

### Task 10: `resolveNavigationAction` + 호출부 변경 (green)

- **변경 대상**: `src/background/tab-bindings.ts`
- **작업 내용**:
  1. `resolveNavigationAction`(`:116-122`) 입력에 `newUrlReadable: boolean`·`newUrlSupported: boolean` 추가
  2. 마지막 라우팅(`:129`) 변경. 새 `NavigationAction` variant는 만들지 않는다(`:107-111` 그대로, `:200-201`의 `satisfies never` 소진 체크 유지):
     ```ts
     return input.preserved
       ? "notifyDeferredExpiry"
       : input.newUrlReadable && !input.newUrlSupported
         ? "clearSession"    // 판독된 미지원 URL → 패널 유지, 패널이 안내를 그린다
         : "deactivate";     // 판독 불가 또는 지원 스킴(file: 등) → 기존 동작
     ```
  3. 호출부(`deactivatePanelIfCrossOrigin:176-182`)에 두 값 전달. `newUrlReadable`은 Task P에서 확인한 URL 소스(`onCommitted`의 `details.url`)에서 파생하고, `isSupportedUrl(undefined) === false`(`url-support.ts:26`)를 "미지원"으로 오해하지 않도록 **판독 여부를 먼저 판정**한다
  4. `newUrlBroadCovered`(`isBroadCoveredUrl:137`) 입력은 그대로 유지 — 광역 권한 축은 지원 여부 축과 독립이다
  - `apply()`는 Task 3에서 이미 고쳤으므로 추가 변경 없음
- **검증**:
  - [ ] Task 9 테이블 전부 green
  - [ ] `pnpm typecheck` 통과
  - [ ] `pnpm test` 전체 통과

### Task 11: `e2e/activetab-broad-permission.spec.ts` 단언 반전

- **변경 대상**: `e2e/activetab-broad-permission.spec.ts:94-106` (단언 `:103`)
- **작업 내용**: `"광역 권한 보유라도 비커버 URL(chrome://) 이동 → 패널 종료(deactivate)"` 테스트를 반전한다. 새 기대치: **activated set 보존 + 세션만 정리**.
  - 이 spec은 e2e 패널이 실제 side panel이 아니라 일반 Page라 `setOptions(enabled:false)`로 닫히지 않는다는 점을 이미 알고 있고(`:8-13` 주석, `e2e/GOTCHAS.md:36`), 그래서 **activated set / 세션 키를 SW storage로 읽어** 판정한다. 그 관찰 방식을 그대로 쓴다(`isActivated`·`hasSession`·`seedActivatedSession` 헬퍼가 `:17-52`에 **spec-local**로 있다 — `:89`가 사용)
  - 테스트 제목과 주석(`:100`)도 새 동작에 맞게 갱신
  - 같은 파일의 다른 두 테스트(커버 URL 이동 시 패널 유지 `:74-92`, cross-origin 후 `captureVisibleTab` 성공 `:108-`)는 **건드리지 않는다**
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e -- activetab-broad-permission` green (3개 테스트 전부)
  - [ ] `file:`로 이동하는 케이스가 있으면 여전히 `deactivate`임을 확인 (없으면 Task 9 단위 테이블로 충분)

---

## 테스트 계획

### 단위 테스트

| 대상 | 파일 | 케이스 |
|---|---|---|
| `activateTab` (신규 커버리지) | `src/background/__tests__/tab-bindings.test.ts` | 미지원 URL에서 `setOptions`+`open` **동기** 호출 / 호출 순서 / 반환값 `undefined` / `tab.id == null` no-op / 지원 URL 회귀 |
| `resolveNavigationAction` | 동일 파일 케이스 배열 `:83-162` | `newUrlReadable`·`newUrlSupported` 두 축 추가. 기존 `deactivate` 3행은 `true/true`, 판독된 미지원 → `clearSession`, 판독 불가 → `deactivate`, 보존 → `notifyDeferredExpiry` |
| analytics property 허용목록 | `src/background/__tests__/` | `page_supported` 통과 / 미허용 property 제거(회귀) |
| `useTabSupport` | `src/sidepanel/hooks/__tests__/useTabSupport.test.tsx` | 초기 판정(지원/빈 url) / `info.status`+`tabs.get` 전이 / `info.url` 전이 / 타 tabId 무시 / `tabId` null / `tabs.get` reject / 중복 발화 idempotent / cleanup |
| `EmptyState` 렌더 분기 | `src/sidepanel/tabs/__tests__/IssueTab.test.tsx` | export된 `EmptyState`에 props 직접 주입. `unsupported` true/false로 버튼 5개·안내·footer·CTA 노출 |
| `DebugTab` 잠금 술어 | `src/sidepanel/tabs/__tests__/` | 순수 술어로 추출한 `logTabsLocked`·sync 스킵 조건 / `recording` 기존 잠금 회귀 / `sub` 복귀 |
| 30s Replay 게이트 | `src/sidepanel/30s-replay/__tests__/` | `unsupported=true`에서 폴링 미시작 (fake timer) |

`*.test.ts`는 node 환경, `*.test.tsx`는 jsdom + @testing-library/react(`vitest.config.ts`의 `environmentMatchGlobs`가 확장자로 자동 분기 — **`.tsx`만 jsdom**).

**커버리지 노트**: `useTabSupport.ts`는 `scripts/coverage-report.mjs`의 `isBrowserBound()` **등록 대상이 아니다**(규칙은 `.tsx` / `src/types/` / `src/background/*-oauth.ts` / `BROWSER_BOUND_EXACT` 정확 경로뿐이고 `src/sidepanel/hooks/` 접두 규칙은 없다 — 기존 hooks 16개가 이미 로직 분모에 있다). 단 **신규 파일은 baseline 항목이 없어 래칫 회귀 경고가 뜨지 않으므로**(`:161 if (!prev) continue;`) 테스트를 빼먹어도 `/coverage`가 침묵한다.

### e2e 시나리오

`/e2e-write`의 입력이 되는 판정 가능한 문장:

1. `chrome://version` 탭에서 패널을 열면 미지원 안내(신규 testid)가 보이고 `mode-element`가 존재하지 않는다.
2. 같은 상태에서 `mode-element-shot`·`mode-screenshot`·`mode-record`·`replay-button`도 존재하지 않는다.
3. 같은 상태에서 `subtab-console`과 `subtab-network`가 disabled다.
4. 같은 상태에서 `mode-freeform`이 DOM에 존재하지 않는다.
5. 같은 상태에서 `[가이드]` 버튼(신규 testid)이 존재한다.
6. 같은 탭을 fixture 페이지로 이동시키면, 추가 조작 없이 `mode-element`가 나타난다. **(자동 감지 — Phase 1의 핵심 단언)**
7. (Phase 2) `activetab-broad-permission.spec.ts` 안에서, seed된 activated 탭이 `chrome://version`으로 이동한 뒤 **activated set이 보존된다**.

> **Phase 2 시나리오의 관찰 한계**: e2e 패널은 실제 side panel이 아니라 일반 Page라 `setOptions(enabled:false)`로 닫히지 않는다(`e2e/GOTCHAS.md:36`). 따라서 "패널 유지"는 e2e로 직접 단언할 수 없고 **activated set 보존만이 의미 있는 신호**다. 시나리오 7을 `activetab-broad-permission.spec.ts` 안에 두는 이유도 그 spec에 `seedActivatedSession`·`isActivated` 헬퍼가 이미 있기 때문이다(`ext.openPanel`은 `activateTab`을 우회해 activated set을 쓰지 않으므로, seed 없이는 `deactivatePanelIfCrossOrigin:156`의 미활성 조기 반환에 걸려 **판정 대상 로직에 도달조차 하지 않는다**). "다시 지원 페이지로 돌아오면 `mode-element`가 나타난다"는 문장은 시나리오 6과 중복이라 별도로 두지 않는다.

기존 spec 조치: `unsupported-url.spec.ts` 전면 재작성(Task 8), `activetab-broad-permission.spec.ts:94-106` 단언 반전(Task 11).

> **설계 결정 3에 걸린 조건부**: "깨지는 e2e 2개"는 판정 중을 `false`로 접는다는 전제하에서만 참이다. 3-상태로 뒤집으면 `capture-modes-layout.spec.ts:32-46`, `onboarding.spec.ts:45,135`, `session.spec.ts:30,54`, `style-changes-dialog.spec.ts:224`, 서브탭 `data-state="active"`를 단언하는 16개 spec이 즉시 flaky해진다.

### 수동 테스트 (자동화 불가)

`activateTab`·`apply()`는 e2e 그물이 없고(Playwright가 확장 액션 아이콘을 클릭할 수 없음) 서비스워커도 Playwright로 구동할 수 없다(`docs/POSTMORTEM.md:301-305`). **아래는 반드시 실물 Chrome에서 확인한다. `pnpm build` 선행 필수 — dist가 stale이면 헛테스트다.**

- [ ] `pnpm build` → `chrome://extensions`에서 확장 리로드
- [ ] `https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig`에서 툴바 아이콘 클릭 → **패널이 열리고 미지원 안내가 보인다**
- [ ] `chrome://settings`에서 아이콘 클릭 → 동일하게 열린다
- [ ] **미지원 페이지에서 패널을 연 뒤 다른 탭으로 전환 → 복귀 시 패널이 유지된다** (Task 3의 유일한 행동 검증)
- [ ] 같은 상태에서 미지원 페이지 → 다른 미지원 페이지로 이동해도 패널이 유지된다
- [ ] 서비스워커 콘솔(`chrome://extensions` → "Service worker")에 `sidePanel.open`/`sidePanel.setOptions` 에러가 없다
- [ ] 미지원 페이지에서 Integrations 탭으로 이동 → **트래커 1개를 실제로 연결 완주**한다 (OAuth 창이 뜨고 콜백까지, 그 왕복 중 패널이 사라지지 않는지 확인)
- [ ] 미지원 페이지에서 Settings → LLM 연동 다이얼로그를 열어 **BYOK 키 저장·연결 테스트가 동작**한다
- [ ] **미지원 탭을 닫은 뒤** `onRemoved` 정리 확인 — activated set과 `sidePanel:url:{tabId}` 세션 키가 남지 않는다 (Phase 1이 미지원 탭도 set에 넣기 시작하므로)
- [ ] 그 상태에서 요소 스타일 편집이 정상 동작한다(정방향 회귀)
- [ ] 라이트/다크 양쪽에서 안내 화면의 아이콘·텍스트 대비가 기존 빈 상태와 일관되고, **안내 블록이 세로 중앙에 온다** (`EmptyShell` + `PageFooter` + `IntegrationsCta` 조합은 저장소 최초 — design.md 참조)
- [ ] 좁은 패널 폭에서 안내 텍스트가 잘리지 않는다
- [ ] **ko/en 로케일을 각각 1회 전환**해 안내 문구 실물 확인 — jsdom 테스트는 `useT`를 키 반환으로 목킹하는 게 관례라 실제 문구가 어느 자동 트랙에서도 검증되지 않는다
- [ ] 캡처 버튼이 1~3프레임 번쩍이는 정도가 수용 가능한지 눈으로 확인 (design.md 위험 요소 4 — 심하면 3-상태 전환 재검토)
- [ ] (Phase 2) 지원 페이지에서 패널을 연 뒤 `chrome://settings`로 이동 → **패널이 닫히지 않고** 안내로 바뀐다
- [ ] (Phase 2) 작성 중 세션(요소 편집 후 drafting)이 있는 상태로 `chrome://settings`로 이동 → 기존 `notifyDeferredExpiry` 동작 유지(세션 보존)
- [ ] (Phase 2) `element` + `styling` 세션이 있는 상태로 이동 → `SessionExpiredDialog`가 안내 앞에 한 단계 낀다(prd.md S4 — 의도된 동작 확인)
- [ ] (Phase 2) **요소 캡처 `picking`/`capturing` 중** `chrome://`로 이동 → 갇힌 화면이 남지 않는다 (design.md 위험 요소 7의 구멍)

> **자동화로 옮긴 항목**: "주소창으로 `https://` 이동 → 조작 없이 캡처 진입 화면"은 e2e 시나리오 6, "Issue list 탭 정상 렌더"·"`[가이드]` 클릭 → 탭 열림"도 e2e 사정권이라 수동 목록에서 제외했다.

## 구현 순서 권장

```
Phase 1 (커밋 1)
  Task 1 (red)  →  Task 2 (green)  →  Task 3 (apply)   ... background, 독립
  Task 4 (훅)                                           ... Task 1~3과 병렬 가능
  Task 5 (analytics)                                    ... 완전 독립
  Task 6 (EmptyState + i18n)  ←  Task 4 필요
  Task 7 (DebugTab + replay)  ←  Task 4 필요            ... Task 6과 병렬 가능
  Task 8 (e2e 재작성)         ←  Task 6·7 필요
  → 수동 테스트 → 커밋

Phase 2 (커밋 2)
  Task P (프로브 — 게이트)
    └ 도착 안 하면 여기서 중단, 별도 feature로 분리
  Task 9 (red)  →  Task 10 (green)  →  Task 11 (e2e)
  → 수동 테스트 → 커밋
```

- Task 1·2·3은 background 단독이라 UI 작업과 완전히 독립적이다. Task 3 없이 Task 2만 커밋하면 목표 1이 성립하지 않으므로 셋을 붙여 진행한다.
- Task 4가 Task 6·7의 선행 조건이다.
- Task 5는 어느 것과도 독립이다.
- Task 6과 Task 7은 서로 독립(다른 파일).
- **Phase 2는 Phase 1이 green으로 커밋되고 Task P가 통과한 뒤 시작한다.** 한 커밋에 묶으면 회귀 시 이등분이 불가능하다(design.md 위험 요소 6).

## 가이드 영향

**있음.** 미지원 페이지에서의 동작이 사용자 노출 UX로 바뀐다(기존: 아무 일도 안 일어남 → 변경: 패널이 열리고 안내). 작성 전 `guide/AUTHORING.md`를 먼저 읽고 그 규칙대로 한다. 구현 후 `/guide`로 처리.

- `guide/ko/faq.md` · `guide/en/faq.md` — "아이콘을 눌렀는데 아무 일도 없어요" 류 항목이 있으면 갱신, 없으면 "어떤 페이지에서 사용할 수 있나요" 항목에 미지원 페이지에서 보이는 안내를 반영. `guide/ko/faq.md:53`의 기존 설명이 신규 i18n 문안의 출처이므로 톤을 맞춘다
- `guide/ko/quick-start.md` · `guide/en/quick-start.md` — 첫 실행 단계 설명이 "지원되는 웹 페이지에서 아이콘을 누르라"는 전제를 담고 있는지 확인. 설치 직후 스토어 페이지에 서 있는 상태를 언급할 가치가 있다

> `guide/ko`·`guide/en`은 **항상 같은 내용**을 담아야 하므로 양쪽을 같은 커밋에서 함께 갱신한다.

## 문서 영향

전부 `/push` 신선도 검사 대상이므로 구현 커밋과 함께 처리한다.

- **`CLAUDE.md`** — "게이트웨이" 섹션의 "그 외 페이지에서는 side panel을 enable하지 않고…"가 **사실과 어긋나게 된다** → `docs(CLAUDE)` 갱신 필요.
- **`docs/ARCHITECTURE.md:29`** — `if (tab.id == null || !isSupportedUrl(tab.url)) return;`를 코드 그대로 인용하고 있어 **직접 거짓이 된다**. Side Panel 탭 스코프 관련 서술도 함께 대조.
- **`docs/PERMISSION.md`** — 세 곳이 거짓이 된다: `:92-96`(3중 방어 흐름도 — optional-host 시대 기준), `:255-285`(`apply()` 동작표와 "URL 판별 불가 → cross-origin·비커버로 간주 → 닫기/deferred 분기"), `:324-325`(activated set·`ACTIVATION_URL_PREFIX` 서술 — 이제 미지원 탭도 들어온다).
- **`e2e/COVERAGE.md`** — `:9`(deactivate 분기 기술), `:62`(unsupported-url spec 설명), `:79`, `:91` 대조.
- **`docs/privacy.{ko,en}.md`**: 새 권한·새 수집·새 전송이 없으므로 **갱신 불필요**. `page_supported`는 boolean 하나이고 캡처 데이터가 아니며 기존 익명 집계 이벤트에 붙는다. 30s Replay 게이트 추가는 오히려 캡처를 **줄인다**. (`/push` 신선도 검사에서 판단 근거를 물으면 이 근거를 댈 것.)
- 구현 완료 후 회귀·함정이 드러나면 `/postmortem`으로 `docs/POSTMORTEM.md`에 항목 추가.
