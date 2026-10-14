# AI 에이전트 사용성 — 구현 태스크

## 선행 조건

- 권한·env·의존성 추가 없음. `chrome.tabs.getCurrent`/`update`/`get`은 기존 권한으로 충분하다.
- 착수 전 확인:
  - `grep -rn 'bringToFront\|el.click()\|keepFixtureActive' e2e/`로 우회를 전수한다(design "위험 요소" 1).
  - `docs/POSTMORTEM.md`의 2026-07-26 항목과 매뉴얼 회고(`index.html` 관련)를 읽는다.

## 태스크

### Task 1: 탭 전환 정지 판정 순수 함수
- **변경 대상**: `src/lib/panel-tab-url.ts`(신규), `src/lib/__tests__/panel-tab-url.test.ts`(신규)
- **작업 내용**: `PANEL_PATH`, `parsePanelTabTarget`, `buildPanelUrl`, `recordersToStopOnSwitch`를 design 시그니처대로 구현한다. 런타임 import는 0이다.
- **검증**:
  - [ ] design 표의 다섯 케이스를 전부 단위 테스트로 고정한다.
  - [ ] 쿼리가 없거나 정수가 아니거나, 다른 확장 origin이거나, 다른 path이면 null을 반환하는 케이스를 고정한다.
  - [ ] 소스 스캔으로 import 0을 확인한다(`locale-registry`·`session-keys` 선례의 스캔 헬퍼 재사용).

### Task 2: background `onActivated` 배선
- **변경 대상**: `src/background/tab-bindings.ts`
- **작업 내용**: `prevTabId`를 곧장 `stopRecorders`하지 말고, prev·next URL을 조회해 `recordersToStopOnSwitch` 결과만 정지한다. `panelBase`는 `chrome.runtime.getURL(PANEL_PATH)`이다. 기존 `SIDEPANEL_PATH` 상수는 `PANEL_PATH` import로 대체해 단일 출처로 만든다.
- **검증**:
  - [ ] `pnpm typecheck`
  - [ ] `background/__tests__`의 기존 `resolveTabSwitch` 테스트 green
  - [ ] e2e(Task 10)의 "패널 탭 왕복 후 로그 유지"

### Task 3: 캡처 실패 분류 + 이벤트
- **변경 대상**: `src/lib/app-events.ts`, `src/sidepanel/lib/capture-error.ts`, `src/sidepanel/lib/__tests__/capture-error.test.ts`
- **작업 내용**: `CaptureFailureKind` type과 `onCaptureFailed`를 추가한다. `classifyCaptureFailure`와 `CAPTURE_FAILURE_KEYS`를 추가한다.
- **검증**:
  - [ ] `captureOwnedTab` 실제 메시지 2종, `"tab is not active"`, quota 메시지, activeTab 만료 메시지(→null), 임의 Error(→other), 비 Error 값에 대한 분류를 고정한다.
  - [ ] rate-limit 정규식을 `background/capture-throttle.ts:isCaptureRateLimitError`와 같은 샘플로 대조한다(test 파일에서 양쪽 import — 테스트는 경계 규칙 대상 아님).
  - [ ] `app-events.test.ts` 순수성 green

### Task 4: i18n 키
- **변경 대상**: `src/i18n/namespaces/issue.ts`, `src/i18n/namespaces/app.ts`
- **작업 내용**:
  - `issue.captureFailed.{inactive,rateLimit,offscreen,other}`를 추가한다.
  - `app.tabMode.agentHint`를 추가한다. 문구는 `#__BUGSHOT_AGENT__` 리터럴을 포함한다.
  - `app.tabTarget.{title,description,empty,refresh}`를 추가한다.
  - 각 키를 ko/en/fr/es/de 5개 로케일에 넣는다.
- **검증**:
  - [ ] PostToolUse 훅의 `locales.test.ts` green(대칭·빈 값·placeholder)

### Task 5: 실패 지점 배선 + 토스트
- **변경 대상**: `src/sidepanel/capture.ts`, `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/tabs/IssueTab.tsx`, `src/sidepanel/App.tsx`
- **작업 내용**:
  - design "변경" 항목대로 null·catch 지점에서 `onCaptureFailed`/`fireCaptureFailure`를 발화한다. 대상은 A·B·C·D·E·F·G·H 경로이고, 30s 리플레이 폴링(I)은 제외한다.
  - App이 구독해서 `toast.error`를 띄운다.
  - 기존 동작(idle 리셋·after null·permission 다이얼로그)은 바꾸지 않는다.
- **검증**:
  - [ ] `pnpm test`
  - [ ] e2e: 비활성 탭에서 캡처 시 inactive 토스트가 뜬다(Task 10)

### Task 6: handoff 순수 판정
- **변경 대상**: `src/sidepanel/lib/tab-mode.ts`(신규), `src/sidepanel/lib/__tests__/tab-mode.test.ts`(신규)
- **작업 내용**: `planHandoff`, `handoffForTransition`, `listTargetCandidates`를 구현한다.
- **검증**:
  - [ ] `planHandoff`의 모든 조합(self null / 다른 창 / 같은 창·target 활성 / 같은 창·target 비활성)
  - [ ] `handoffForTransition` 전이표:
    - idle→picking=to-target, picking→styling=to-panel, picking→idle(취소)=to-panel
    - capturing→drafting=to-panel, inline false→true=to-target, true→false=to-panel
    - idle→capturing=null, styling→drafting=null
  - [ ] `listTargetCandidates`: self 제외, 다른 창 제외, `chrome:`/`chrome-extension:`/웹스토어 제외(`isSupportedUrl` 재사용), 순서 유지

### Task 7: browser-bound 셸 + 관문 교체
- **변경 대상**: `src/sidepanel/tab-mode.ts`(신규), `src/sidepanel/hooks/useTabModeHandoff.ts`(신규), `src/sidepanel/capture.ts`, `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/tabs/IssueTab.tsx`, `src/sidepanel/App.tsx`, `scripts/coverage-report.mjs`
- **작업 내용**:
  - `getSelfTab`, `withTargetActive`(재진입 깊이 카운트, 바깥 호출만 복원), `requestTabCapture`, `activateTab`, `fireCaptureFailure`를 구현한다.
  - sendBg 캡처 3곳을 `requestTabCapture`로 교체하고, scroll capture는 바깥에서 `withTargetActive`로 감싼다.
  - `useTabModeHandoff`를 App에 마운트한다.
  - 두 신규 셸을 `BROWSER_BOUND_EXACT`에 등재한다.
- **검증**:
  - [ ] `grep -rn 'type: "captureVisibleTab"' src/sidepanel`의 남은 결과가 `tab-mode.ts`, `use-30s-replay.ts`, `scroll-capture.ts`(deps) 3곳뿐이다.
  - [ ] `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`의 로직 스코프 비회귀
  - [ ] e2e S1·S2(Task 10)

### Task 8: 대상 탭 선택 화면 + 탭 모드 안내
- **변경 대상**: `src/sidepanel/components/TabTargetPicker.tsx`(신규), `src/sidepanel/components/TabModeAgentHint.tsx`(신규), `src/sidepanel/App.tsx`
- **작업 내용**:
  - 탭 모드이고 boundTabId === selfTabId이면 선택 화면을 띄운다. 후보를 클릭하면 `location.replace(buildPanelUrl(...))`.
  - 후보가 0개면 empty 문구와 새로고침 버튼을 보인다.
  - 탭 모드이면 상단에 안내 한 줄을 보인다.
  - testid는 `tab-target-picker`, `tab-target-option-<tabId>`, `tab-mode-agent-hint`.
  - DESIGN.md의 EmptyShell·버튼 사이즈 규칙을 따른다.
- **검증**:
  - [ ] jsdom `TabTargetPicker.test.tsx`: 후보 렌더·클릭 시 URL 생성 호출·empty 상태
  - [ ] 사이드패널 모드(`getSelfTab`=null)에서 두 컴포넌트가 미렌더

### Task 9: 접힌 탭 라벨 접근성
- **변경 대상**: `src/components/ui/collapsing-tabs.tsx`, `src/components/ui/__tests__/collapsing-tabs.test.tsx`, `src/sidepanel/tabs/__tests__/SubmitPlatformTabs.test.tsx`
- **작업 내용**: 접힌 `TabLabel`에 `sr-only`를 쓰고, 측정 중에는 `group-data-[measuring]/tabs:not-sr-only`를 쓴다.
- **검증**:
  - [ ] `getByRole("tab", { name: <PLATFORM_TAB_KEYS 라벨> })`로 9개 플랫폼 탭이 전부 잡힌다. 기존 `hidden` 클래스 단언은 `sr-only`로 갱신한다.
  - [ ] e2e `capture-modes-layout` 등 레이아웃 spec green

### Task 10: e2e
- **변경 대상**: `e2e/ai-usability-tab-mode.spec.ts`(신규), `e2e/fixtures/extension.ts`, 우회 사용 spec, `e2e/GOTCHAS.md`
- **작업 내용**:
  - 아래 시나리오를 spec으로 만든다(`/e2e-write`).
  - 우회 전수 결과에 따라 `bringToFront` 우회를 제거하거나 유지한다. 유지하는 곳엔 이유를 GOTCHAS에 남긴다.
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e` 전체 green

### Task 11: 매뉴얼 갱신 + 그물
- **변경 대상**: `src/sidepanel/index.html`, `src/sidepanel/__tests__/agentManual.test.ts`
- **작업 내용**: design "변경"의 매뉴얼 4개 문단을 갱신한다. 새 주장마다 케이스를 추가한다:
  - "same window"를 말하면 `recordersToStopOnSwitch`가 자기 패널 전환에 [] 반환(실제 함수 호출로 바인딩)
  - "Without that query"는 대상 선택 화면을 말하고, `tab-target-picker` testid가 소스에 실재
  - "a third tab" 정지 주장 유지 + 함수의 [T] 케이스로 바인딩
  - 리플레이 한계 문장을 `use-30s-replay.ts`의 `!tab.active` 스킵에 바인딩
- **검증**:
  - [ ] 케이스마다 구현을 되돌려 red를 실측한다(파일 헤더 규칙)
  - [ ] `pnpm test` green

### Task 12: 문서
- **변경 대상**: `docs/ARCHITECTURE.md`, `docs/DIRECTORY.md`, `CLAUDE.md`(필요 시 게이트웨이 한 줄)
- **작업 내용**:
  - ARCHITECTURE에 "탭 모드(패널을 탭으로 연 경우)" 섹션을 추가한다. 내용은 정지 예외, handoff 관문, 자동 활성화 전이표, 리플레이 한계.
  - DIRECTORY에 신규 파일을 추가한다.
- **검증**:
  - [ ] `/push` 문서 신선도 트라이아지 통과

## 테스트 계획

- **단위 테스트**
  - `panel-tab-url.test.ts`: 파싱 및 정지 판정 5 + 경계 케이스
  - `tab-mode.test.ts`: `planHandoff`, 전이표, 후보 필터
  - `capture-error.test.ts`: 분류 7종 + quota 정규식 대조
  - `TabTargetPicker.test.tsx`, `collapsing-tabs.test.tsx`, `SubmitPlatformTabs.test.tsx`: 접근성 이름
  - `agentManual.test.ts`: 신규 바인딩 4종
- **e2e 시나리오** (`/e2e-write` 입력. 전부 같은 창 탭 모드 = 기존 `openPanel`, spec에서 `bringToFront` 미사용)
  - 패널을 `?tabId=` 없이 열면 `tab-target-picker`가 보이고, fixture 탭 옵션을 누르면 URL에 `tabId=<fixture>`가 붙고 캡처 진입 화면이 된다.
  - 탭 모드에선 `tab-mode-agent-hint`가 보이고, 텍스트에 `#__BUGSHOT_AGENT__`가 들어 있다.
  - fixture에서 console/fetch를 발생시키고 패널 탭을 앞으로 가져온 뒤, 다시 fixture에서 이벤트를 하나 더 발생시킨다. 그 다음 `mode-screenshot` → `capture-method-viewport`를 패널에서 클릭하면 drafting이 되고, 로그 첨부 카드 건수가 두 이벤트를 모두 포함한다.
  - 패널에서 `mode-element`를 누르면 fixture 탭이 활성화된다(`tabs.get(fixture).active === true`). 요소를 클릭하면 styling이 되고 패널 탭이 활성화된다. 값을 바꾸고 Next를 누르면 before·after 이미지가 둘 다 존재한다.
  - 패널 탭에서 제3의 탭(빈 fixture)으로 전환한 뒤 fixture에서 console을 찍는다. 다시 패널로 돌아오면 그 항목은 로그에 없다(레코더 정지 계약).
  - fixture를 수동으로 비활성화한 상태에서 캡처 관문 실패를 유도하면 inactive 문구 토스트가 뜬다. 유도 방법은 handoff를 우회하는 테스트 훅이 아니라, 캡처 큐 대기 중 제3 탭으로 전환하는 것이다.
  - 제출 모달에서 `getByRole("tab", { name: "Custom Webhook" })`이 클릭 가능하다.
- **수동 테스트** (Chrome)
  - 사이드패널 정상 모드: 캡처 5종(요소 편집·요소 캡처·영역·뷰포트·전체 페이지)과 인라인 영역 캡처가 기존과 같다. 탭 깜빡임 없음.
  - 탭 모드 전체 페이지 캡처: 대상 탭이 캡처 내내 앞에 있다가 끝나면 패널로 복귀한다. 타일 누락 없음.
  - 별도 창 탭 모드(기존 매뉴얼 경로)에서 handoff가 일어나지 않고 그대로 동작한다.
  - ego-browser로 S1 재현: 별도 창 없이 제출까지 간다. 제어권 오판 빈도를 기록한다.
  - 접힌 탭 측정: 좁은 패널 폭에서 Debug/Settings 탭의 접힘 전환이 기존과 같은 폭에서 일어난다.

## 구현 순서 권장

1. Task 1 → Task 2 (background, 독립)
2. Task 3 → Task 4 → Task 5 (실패 토스트, 사이드패널에도 즉시 가치 있음 — 1·2와 병렬 가능)
3. Task 9 (독립, 병렬 가능)
4. Task 6 → Task 7 → Task 8 (탭 모드 본체, 1·3·4 선행 필요)
5. Task 11 (매뉴얼, 7·8 이후)
6. Task 10 (e2e, 전부 이후 — 하네스 우회 정리 포함)
7. Task 12 (문서)

## 가이드 영향

- 신규 `agent-automation.md`(ko·en) — "AI 에이전트로 BugShot 쓰기". 소개 섹션 1-3으로 넣는다.
  - 패널 URL과 대상 탭 선택, 같은 창·별도 창 둘 다 가능, 매뉴얼 위치(`#__BUGSHOT_AGENT__`)를 다룬다.
  - 녹화 불가, 리플레이 탭 모드 한계, 캡처 중 대상 탭 자동 전환도 다룬다.
  - `SUMMARY.md`(ko·en)와 `guide/AUTHORING.md` §2 IA(26→27페이지)를 함께 갱신한다.
- `faq.md`(ko·en)에 "AI 에이전트가 BugShot을 쓸 수 있나요?" 문항을 넣어 새 페이지로 링크한다.
- `screenshot/capture.md`(ko·en)에 캡처 실패 토스트(대상 탭이 앞에 있어야 함)를 한 줄 추가한다.
