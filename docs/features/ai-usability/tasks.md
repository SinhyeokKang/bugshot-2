# AI 에이전트 사용성 — 구현 태스크

## 선행 조건

- 권한·env·의존성 추가 없음. `chrome.tabs.getCurrent`/`update`/`get`/`query`·`chrome.runtime.getContexts`는 기존 권한으로 충분하다(프로브로 확정).
- **가드레일**: 사이드패널(사람) 화면·동작 변경 0. 예외는 실패 토스트(Phase A)와 접힌 탭 `sr-only`(화면 변화 0)뿐이다. 각 Task 완료 시 "사이드패널에서 새로 렌더되는 게 있는가"를 확인한다.
- 착수 전 확인:
  - `docs/POSTMORTEM.md`의 tab.active 관문 항목(2026-07-26, `:1416`)과 afterPaint 오버레이 항목(2026-08-01, `:1196`), 매뉴얼 회고(`index.html` 관련)를 읽는다.
  - Phase B 착수 전: `grep -rn 'bringToFront\|el.click()\|keepFixtureActive' e2e/`로 우회를 전수한다(design "위험 요소" 1).

## Phase A — 실패 토스트 + 접근성 (탭 모드와 독립, 먼저 ship 가능)

### Task 1: 캡처 메시지 leaf + 실패 분류 + 이벤트
- **변경 대상**: `src/lib/capture-messages.ts`(신규), `src/lib/__tests__/capture-messages.test.ts`(신규), `src/background/capture-throttle.ts`, `src/sidepanel/scroll-capture.ts`, `src/lib/app-events.ts`, `src/lib/__tests__/app-events.test.ts`, `src/sidepanel/lib/capture-error.ts`, `src/sidepanel/lib/__tests__/capture-error.test.ts`
- **작업 내용**:
  - `capture-messages.ts`에 inactive·aborted 메시지 상수와 `isCaptureInactiveError`·`isCaptureRateLimitError`를 둔다. `capture-throttle.ts`·`scroll-capture.ts`가 리터럴 대신 이걸 import한다(동작 불변).
  - `CaptureFailureKind` type과 `onCaptureFailed`를 `app-events.ts`에 추가한다.
  - `classifyCaptureFailure`·`CAPTURE_FAILURE_KEYS`·`fireCaptureFailure`를 `capture-error.ts`에 추가한다.
- **검증**:
  - [ ] 분류 고정: `captureOwnedTab` 메시지(`captureInactiveMessage(n)`), scroll `"tab is not active"`, `"tab has no window"` → inactive / quota 메시지 → rate-limit / activeTab 만료 메시지 → null / `scroll capture aborted` → null / 임의 Error → other / 비 Error 값 → other.
  - [ ] `fireCaptureFailure`: emitter spy로 null 분류 시 미발화, 그 외 1회 발화.
  - [ ] `capture-messages.ts` 런타임 import 0 소스 스캔(session-keys describe를 본떠 블록 추가 — 공용 헬퍼 없음).
  - [ ] `app-events.test.ts`의 emitter 수 단언 8→9 갱신 + 순수성 green.
  - [ ] 기존 `capture-throttle`·`scroll-capture` 테스트 green, `pnpm test`.

### Task 2: i18n 키 (Phase A분)
- **변경 대상**: `src/i18n/namespaces/issue.ts`
- **작업 내용**: `issue.captureFailed.{inactive,rateLimit,elementMissing,other}`를 ko/en/fr/es/de 5개 로케일에 넣는다. ko는 -습니다체.
- **검증**:
  - [ ] PostToolUse 훅의 `locales.test.ts` green(대칭·빈 값·placeholder)

### Task 3: 실패 지점 배선 + 토스트
- **변경 대상**: `src/sidepanel/capture.ts`, `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/tabs/IssueTab.tsx`, `src/sidepanel/App.tsx`
- **작업 내용**:
  - design "캡처 진입점 표"의 실패 발화 열대로 배선한다. 발화 지점은 경로당 하나: `captureWithPrep`(1–5), `captureAndCrop`/`captureAndInsertInline` catch(6·8), 뷰포트 `!ok`(7), 전체 페이지 catch(9).
  - element shot 호출부(`:404`)는 발화하지 않는다(이중 토스트 방지). basis downgrade(`!usable`)는 발화하지 않는다.
  - 권한 만료: `maybeSurfacePermissionExpired` else 분기에서만, deferred 플래그가 꺼져 있을 때만 발화.
  - stale 결과(`sameSelection` 불일치)·`signal.aborted` 가드 안에서는 발화하지 않는다.
  - App이 구독해서 `toast.error`를 띄운다. 기존 동작(idle 리셋·after null·permission 다이얼로그)은 바꾸지 않는다.
- **검증**:
  - [ ] `pnpm test`
  - [ ] 경로별 1회 발화를 확인할 수 있는 곳(`captureWithPrep`는 `capture.ts` 단위, 나머지는 훅 테스트 선례가 있으면)에 단언. 없는 경로는 e2e/수동 항목으로 넘긴다.
  - [ ] e2e: 비활성 탭에서 캡처 시 inactive 토스트(Task 13)

### Task 4: 접힌 탭 라벨 접근성
- **변경 대상**: `src/components/ui/collapsing-tabs.tsx`, `src/components/ui/__tests__/collapsing-tabs.test.tsx`, `src/sidepanel/tabs/SubmitPlatformTabs*`, `src/sidepanel/tabs/__tests__/SubmitPlatformTabs.test.tsx`, `docs/DESIGN.md`
- **작업 내용**: 접힌 `TabLabel`에 `sr-only` + `whitespace-nowrap`, 측정 중에는 `group-data-[measuring]/tabs:not-sr-only`. `SubmitPlatformTabs` 아이콘을 `aria-hidden`으로. DESIGN.md:268 측정 서술 갱신.
- **검증**:
  - [x] jsdom 클래스 단언: 접힘 시 `sr-only` 존재·`hidden` 부재(`collapsing-tabs.test.tsx:32-33`, `SubmitPlatformTabs.test.tsx:67` 갱신). `getByRole({name})`은 CSS 미로드로 red가 될 수 없으니 그물로 세지 않는다.
  - [x] 아이콘 `aria-hidden`으로 이름이 라벨 하나만 남는다(jsdom `getByRole("tab",{name:/^Slack$/})` 류 — 중복 방지 단언은 jsdom에서도 유효).
  - [x] (e2e분) 소비처 9곳(log-viewer `App.tsx:163` 포함) 육안 확인 + e2e `webhook-submit.spec.ts:398-428` green
  - [ ] 수동(런타임 검증 이월 — 측정 등가성은 `e2e/tab-label-measure.spec.ts`가 상대 비교로 고정): 좁은 패널 폭에서 Debug/Settings 탭 접힘 전환이 기존과 같은 폭에서 일어난다.

## Phase B — 탭 모드 본체

### Task 5: 프로브 (착수 게이트)
- **작업 내용**: 실브라우저(로컬 dev 빌드 또는 `dist-e2e`)에서 확인한다.
  - background에서 `chrome.runtime.getContexts({contextTypes:["TAB"]})`가 탭 모드 패널의 `tabId`·`documentUrl`(쿼리 포함)을 돌려준다.
  - 사이드패널 문서에서 `chrome.tabs.getCurrent()`가 `undefined`, 탭 모드에서 Tab이다.
- **검증**:
  - [x] 두 결과를 기록. 하나라도 어긋나면 Task 7 설계를 다시 연다. → `orch.md` D2: getContexts로 패널 tabId·쿼리 포함 documentUrl 확보(설계 유지), `tabs.get(panel).url` 가려짐 확인. 사이드패널 `getCurrent()` undefined는 런타임 검증으로 이월.

### Task 6: 패널 URL·정지 판정 순수 함수
- **변경 대상**: `src/lib/panel-tab-url.ts`(신규), `src/lib/__tests__/panel-tab-url.test.ts`(신규)
- **작업 내용**: `PANEL_PATH`, `parsePanelTabTarget`, `buildPanelUrl`, `recordersToStopOnSwitch`를 design 시그니처대로 구현한다. 런타임 import는 0이다.
- **검증**:
  - [x] design 표의 다섯 케이스를 전부 단위 테스트로 고정한다(패널→X는 `[prev]` = 패널 id).
  - [x] 쿼리가 없거나 정수가 아니거나, 다른 확장 origin이거나, 다른 path이면 null.
  - [x] 런타임 import 0 소스 스캔(Task 1과 같은 방식).

### Task 7: background `onActivated` 배선
- **변경 대상**: `src/background/tab-bindings.ts`, `src/background/__tests__/tab-bindings.test.ts`, `src/sidepanel/__tests__/agentManual.test.ts`
- **작업 내용**: `getContexts` 1회로 prev/next panelTarget을 구해 `recordersToStopOnSwitch` 결과만 정지한다. `SIDEPANEL_PATH` → `PANEL_PATH` import.
- **검증**:
  - [x] `vi.stubGlobal("chrome")` 배선 테스트: onActivated(T→T의 패널)에서 `stopRecorders` 미호출, (P→Q)에서 P 정지, `getContexts` reject 시 prev 정지.
  - [x] 기존 `resolveTabSwitch` 테스트 green
  - [x] `agentManual.test.ts:260`의 `"stopRecorders(prevTabId)"` 리터럴 바인딩을 같은 커밋에서 새 판정 함수 호출 바인딩으로 교체 + 뮤테이션 실측
  - [x] `pnpm typecheck`, `pnpm test`
  - [ ] (B2a로 이관 + SW getContexts 실측 e2e 포함) e2e "패널 탭 왕복 후 로그 유지"(Task 13) — **변경 전 코드에서 red를 먼저 실측**한다. 지금도 패널 `visibilitychange`가 재무장해 green일 수 있다. red가 안 나면 위 배선 테스트를 그물로 삼고 e2e는 회귀 확인용으로만 둔다.

### Task 8: 탭 모드 순수 판정
- **변경 대상**: `src/sidepanel/lib/tab-mode.ts`(신규), `src/sidepanel/lib/__tests__/tab-mode.test.ts`(신규)
- **작업 내용**: `shouldActivateTarget`, `shouldRestorePanel`, `targetHoldFromState`, `listTargetCandidates`를 구현한다.
- **검증**:
  - [ ] `shouldActivateTarget`: self null / 다른 창 / 같은 창·target 활성 / 같은 창·target 비활성
  - [ ] `shouldRestorePanel`: target null(닫힘) / 비활성(제3 탭으로 감) / 활성
  - [ ] `targetHoldFromState` 표: idle·picking·styling·drafting·capturing × inline true/false. 특히 picking=hold, capturing=no hold(영역은 수동), styling=no hold(before는 명시 hold가 담당).
  - [ ] `listTargetCandidates`: self 제외, `chrome:`/`chrome-extension:`/웹스토어 제외(`isSupportedUrl` 재사용), 다른 창 포함, 같은 창 먼저 + 그룹 내 순서 유지

### Task 9: 셸 + hold 배선
- **변경 대상**: `src/sidepanel/tab-mode.ts`(신규), `src/sidepanel/__tests__/tab-mode.test.ts`(신규), `src/sidepanel/hooks/useTabModeHold.ts`(신규), `src/sidepanel/capture.ts`, `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/tabs/IssueTab.tsx`, `src/sidepanel/App.tsx`, `scripts/coverage-report.mjs`
- **작업 내용**:
  - `getSelfTab`(id만 캐시), `holdTarget`(refcount·`activatedByUs`), `withTargetHold`, `focusTab`을 구현한다. 활성화 확정은 `tabs.update` 반환값의 `active` 또는 `tabs.onActivated` — 폴링 금지.
  - design "캡처 진입점 표"의 hold 열대로 배선한다: `captureElementSnapshot*` 본문 전체, before 명시 hold(요소 선택 메시지 수신 직후 ~ before 완료/생략), `captureAndCrop`·`captureAndInsertInline`, 뷰포트 버튼 hold(버튼 ~ crop 완료 또는 capturing 이탈), `runScrollCapture` 바깥.
  - `useTabModeHold`(picking·inline 상태 hold)를 App에 마운트한다.
  - 두 신규 셸을 `BROWSER_BOUND_EXACT`에 등재한다.
- **검증**:
  - [ ] 셸 단위(`vi.stubGlobal("chrome")`): 사이드패널(getCurrent undefined) no-op / 같은 창 비활성 T → 1회 활성화 + release 후 1회 복원 / 중첩·병렬 hold 2개 → 활성화 1회, 마지막 release에서만 복원 / release 시점에 T 비활성(제3 탭) → 복원 안 함 / T 닫힘 → 복원 안 함 / 다른 창 → 활성화·복원 없음.
  - [ ] 순서 단언: 요소 선택 → phase styling 전이 → before 캡처 완료 전까지 복원 호출 없음(훅 또는 셸 레벨 테스트).
  - [ ] `grep -rn 'type: "captureVisibleTab"' src/sidepanel --exclude-dir=__tests__`의 결과가 `capture.ts`(트랜잭션 내부), `use-30s-replay.ts`, `scroll-capture.ts`(deps)뿐이다.
  - [ ] `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`의 로직 스코프 비회귀
  - [ ] e2e S1·S2(Task 13)

### Task 10: 대상 탭 선택 화면 + 탭 모드 안내
- **변경 대상**: `src/sidepanel/components/TabTargetPicker.tsx`(신규), `src/sidepanel/components/TabModeAgentHint.tsx`(신규), `src/sidepanel/components/__tests__/TabTargetPicker.test.tsx`(신규), `src/sidepanel/App.tsx`, `src/sidepanel/tabs/IssueTab.tsx`, `src/i18n/namespaces/app.ts`, `src/i18n/namespaces/issue.ts`
- **작업 내용**:
  - App early return 단계: `getSelfTab()` 대기 중 null, 탭 모드 && `parsePanelTabTarget(location.href)===null`이면 `TabTargetPicker` 전체 화면. 후보 클릭 → `location.replace(buildPanelUrl(...))`.
  - 목록은 `tabs.onCreated/Removed/Updated` 구독으로 실시간 갱신. 후보 0개면 empty 문구.
  - 탭 바 아래 `TabModeAgentHint`(picker 화면에도). 탭 모드 capturing 영역 방식이면 `tab-mode-area-hint`.
  - i18n: `app.tabMode.agentHint`(로케일별 번역 + `#__BUGSHOT_AGENT__` 리터럴), `app.tabTarget.{title,description,empty}`, `issue.tabMode.areaHint` × 5 로케일.
  - testid: `tab-target-picker`, `tab-target-option-<tabId>`, `tab-mode-agent-hint`, `tab-mode-area-hint`.
  - design "기존 패턴 준수 > UI"의 구성을 따른다.
- **검증**:
  - [ ] jsdom `TabTargetPicker.test.tsx`: 후보 렌더(같은 창 먼저)·클릭 시 URL 생성 호출·empty 상태·onCreated 이벤트 후 목록 갱신
  - [ ] 사이드패널 모드(`getSelfTab`=null)에서 picker·안내·영역 안내가 미렌더(가드레일)
  - [ ] 쿼리 없이 열 때 picker 이전에 Debug "캡처할 수 없습니다"가 렌더되지 않는다
  - [ ] `locales.test.ts` green

### Task 11: 매뉴얼 갱신 + 그물
- **변경 대상**: `src/sidepanel/index.html`, `src/sidepanel/__tests__/agentManual.test.ts`
- **작업 내용**: design "변경"의 매뉴얼 문단을 갱신한다. 새 주장마다 케이스를 추가한다:
  - "same window" 기록 유지 → `recordersToStopOnSwitch`가 자기 패널 전환에 [] 반환(실제 함수 호출로 바인딩)
  - "a third tab" 정지 → 함수의 prev=P(일반) 케이스 [P]로 바인딩(패널→X는 주장하지 않는다)
  - "Without that query"는 대상 선택 화면 → `tab-target-picker` testid가 소스에 실재
  - 영역 드래그는 직접 대상 탭으로 → `tab-mode-area-hint` testid 실재 + `targetHoldFromState`의 capturing=no hold
  - 리플레이 한계 문장 → `use-30s-replay.ts`의 `!tab.active` 스킵
  - "한 대상에 패널 하나" → port 해제 시 `stopRecorders` 경로(`background/index.ts:91-107`)
- **검증**:
  - [ ] 케이스마다 구현을 되돌려 red를 실측한다(파일 헤더 규칙)
  - [ ] `pnpm test` green

### Task 12: 문서
- **변경 대상**: `docs/ARCHITECTURE.md`, `docs/DIRECTORY.md`, `docs/DESIGN.md`, `e2e/MANUAL-SMOKE.md`, `CLAUDE.md`(필요 시 게이트웨이 한 줄)
- **작업 내용**:
  - ARCHITECTURE에 "탭 모드(패널을 탭으로 연 경우)" 섹션: 정지 예외, `getContexts` 판정, 단일 refcount hold(진입점 표), 리플레이 한계, 다중 패널 비목표. 매뉴얼 범위 "도그푸딩 리포팅 경로" 서술을 내부+외부 에이전트로 갱신.
  - DIRECTORY에 신규 파일.
  - DESIGN §14에 "차단성 이벤트는 다이얼로그, 비차단 실패는 이벤트 → 토스트" 한 줄.
  - MANUAL-SMOKE에 사이드패널 정상 모드 캡처 경로 수동 잔여 등재(e2e가 전부 탭 모드라 `getSelfTab()=null` 경로를 안 돈다).
- **검증**:
  - [ ] `/push` 문서 신선도 트라이아지 통과

### Task 13: e2e
- **변경 대상**: `e2e/ai-usability-tab-mode.spec.ts`(신규), `e2e/fixtures/extension.ts`, 우회 사용 spec, `e2e/GOTCHAS.md`
- **작업 내용**:
  - 아래 시나리오를 spec으로 만든다(`/e2e-write`).
  - 우회 전수 결과에 따라 우회를 제거하거나 유지한다. 유지하는 곳엔 이유를 GOTCHAS에 남긴다. 착수 목록:
    - GOTCHAS 9·15·16·18·46항
    - `pickElement`의 `panel.bringToFront()`(`extension.ts:307`)·`settleBeforeCapture`
    - picking 중 숨은 패널 클릭 정체: `api-hosts-env-row.spec.ts:180`, `picker-guard.spec.ts:52-55`
    - eval-host가 같은 창 제3 탭 — `fixtureTabId()`를 `openPanel` 전에 호출해 순서 고정
    - E7 `action-log-nav-type.spec.ts:132-163`
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e` 전체 green

## Phase C — 가이드

### Task 14: 사용자 가이드
- **변경 대상**: `guide/{ko,en}/agent-automation.md`(신규), `guide/{ko,en}/SUMMARY.md`, `guide/AUTHORING.md`, `guide/{ko,en}/faq.md`, `guide/{ko,en}/screenshot/capture.md`
- **작업 내용**: "가이드 영향" 참조. `/guide`로 작성한다.
- **검증**:
  - [ ] AUTHORING.md 검증 규칙 통과, ko/en 대칭

## 테스트 계획

- **단위 테스트**
  - `capture-messages.test.ts`: 술어·메시지 상수, import 0 스캔
  - `capture-error.test.ts`: 분류 8종(inactive 3·rate-limit·permission null·aborted null·other 2) + `fireCaptureFailure` 발화/미발화
  - `app-events.test.ts`: emitter 9개 + 순수성
  - `panel-tab-url.test.ts`: 파싱 + 정지 판정 5 + 경계 케이스, import 0 스캔
  - `tab-bindings.test.ts`: onActivated 배선 3종
  - `tab-mode.test.ts`(lib): 활성화·복원 판정, hold 상태표, 후보 정렬
  - `tab-mode.test.ts`(셸): refcount·복원 조건·사이드패널 no-op·before 순서
  - `TabTargetPicker.test.tsx`, `collapsing-tabs.test.tsx`, `SubmitPlatformTabs.test.tsx`: 클래스 단언·이름 중복 방지·후보 UI
  - `agentManual.test.ts`: 교체 1 + 신규 바인딩 6종
- **e2e 시나리오** (`/e2e-write` 입력. 전부 같은 창 탭 모드 = 기존 `openPanel`. spec은 **캡처 트리거용** `bringToFront`·`evaluate(el.click())` 우회를 쓰지 않는다 — 패널/제3 탭으로의 이동 자체엔 `bringToFront`를 쓴다. `fixtureTabId()`는 `openPanel` 전에 호출한다)
  - 패널을 `?tabId=` 없이 열면 `tab-target-picker`가 보이고, `tab-target-option-<fixture>`를 누르면 URL에 `tabId=<fixture>`가 붙고 캡처 진입 화면(`mode-screenshot`)이 된다.
  - 탭 모드에선 `tab-mode-agent-hint`가 보이고, 텍스트에 `#__BUGSHOT_AGENT__`가 들어 있다.
  - fixture에서 console 마커 A를 찍고 패널 탭을 앞으로 가져온 뒤, 다시 fixture에서 마커 B를 찍는다. 패널에서 `mode-screenshot` → `capture-method-viewport`를 클릭하면 drafting이 되고, `log-preview-dialog`의 `[data-entry-id]` 항목에 A·B가 모두 있다(`action-log-scope.spec.ts:58-73` 대조 방식). 뷰포트 이미지 크기가 fixture 뷰포트와 같다.
  - 패널에서 `mode-element`를 누르면 `ext.evalInExt`로 본 `tabs.get(fixture).active === true`다. 요소를 클릭하면 styling이 되고, before 캡처가 끝난 뒤 패널 탭이 활성화된다. 값을 바꾸고 Next를 누르면 before·after 이미지가 둘 다 존재하고 픽셀이 fixture 요소 색과 일치한다(패널 화면 오캡처 배제).
  - 탭 모드 diff 재캡처가 성공한다(`StyleChangesDialog` 재캡처 후 "No snapshot"이 아님).
  - 패널 탭에서 제3의 탭(빈 fixture)으로 전환한 뒤 fixture에서 console 마커 C를 찍는다. 다시 패널로 돌아와 캡처하면 C가 로그에 **있다**(패널→X는 정지하지 않음).
  - fixture → 제3 탭으로 직접 전환 후 fixture에서 마커 D를 찍으면 D는 로그에 없다(기존 정지 계약).
  - 긴 fixture 페이지에서 전체 페이지 캡처를 시작하고 첫 `onProgress` 뒤 제3 탭으로 전환하면 inactive 문구 토스트가 뜬다(`scroll-capture.ts`의 inactive 메시지 경로 — 결정적).
  - 별도 창 탭 모드: `evalInExt(() => chrome.windows.create({tabId: panel}))`로 패널을 다른 창에 두고 뷰포트 캡처가 성공하며 fixture 창의 활성 탭이 바뀌지 않는다.
  - 제출 모달에서 로케일 en 고정, `getByRole("tab", { name: "Custom Webhook" })`이 클릭 가능하다(`webhook-submit.spec.ts:398-428` 셋업 재사용).
- **수동 테스트** (Chrome)
  - 사이드패널 정상 모드: 캡처 5종(요소 편집·요소 캡처·영역·뷰포트·전체 페이지)과 인라인 영역 캡처가 기존과 같다. 탭 깜빡임 없음. 탭 모드 UI 미노출(MANUAL-SMOKE 등재).
  - 탭 모드 전체 페이지 캡처: 대상 탭이 캡처 내내 앞에 있다가 끝나면 패널로 복귀한다. 타일 누락 없음. 소요 시간을 사이드패널과 비교하고 취소 수단(Esc)을 확인한다.
  - 탭 모드 영역 드래그: 안내 한 줄을 보고 대상 탭으로 가서 드래그하면 캡처 후 패널로 복귀한다.
  - handoff 중 제3 탭으로 이동: 캡처 후 패널로 끌려오지 않는다.
  - 숨은 패널 탭 discard(Memory Saver) 시 동작 기록.
  - **인수**: ego-browser로 S1 재현 — 별도 창 없이 제출까지 간다. 제어권 오판 빈도를 기록한다.

## 구현 순서 권장

1. **Phase A**: Task 1 → Task 2 → Task 3, Task 4는 병렬. Phase A만으로 `/ship` 가능(탭 모드 무관).
2. **Phase B**: Task 5(프로브 게이트) → Task 6 → Task 7 (background) / Task 8 → Task 9 → Task 10 (panel) → Task 11 → Task 12 → Task 13(e2e, 하네스 우회 정리 포함)
3. **Phase C**: Task 14 (Phase B 이후)

## 가이드 영향

- 신규 `agent-automation.md`(ko·en) — "AI 에이전트로 BugShot 쓰기". **사람 독자용 최소 페이지**, 소개 섹션 1-3으로 넣는다.
  - "에이전트에게 패널 URL을 주고 페이지 소스의 매뉴얼을 읽게 하세요" 수준. 조작 세부(testid·순서 계약)는 쓰지 않는다 — 그물이 있는 매뉴얼 한 곳에 둔다.
  - 한계: 녹화 불가, 리플레이 탭 모드 한계, 캡처 중 대상 탭 자동 전환, 영역 드래그는 직접 대상 탭으로.
  - 패널 URL·매뉴얼 id(`#__BUGSHOT_AGENT__`) 노출은 `guide/AUTHORING.md:213`("영문 식별자 그대로 쓰지 않기")의 예외다 — AUTHORING.md에 근거를 남긴다.
  - `SUMMARY.md`(ko·en)와 `guide/AUTHORING.md` §2 IA(26→27페이지)를 함께 갱신한다.
- `faq.md`(ko·en)에 "AI 에이전트가 BugShot을 쓸 수 있나요?" 문항을 넣어 새 페이지로 링크한다.
- `screenshot/capture.md`(ko·en)에 캡처 실패 토스트(이유 표시)를 한 줄 추가한다(Phase A와 함께 갱신 가능).
