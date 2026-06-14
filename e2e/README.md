# e2e 스위트 (Playwright)

Chrome 확장을 실제 브라우저에서 구동해 사용자 플로우를 검증하는 e2e 스위트. **무엇을 커버하는지·무엇이 빠졌는지·어떤 함정이 있는지의 단일 출처**다. 시나리오가 늘면 이 문서를 함께 갱신해 "어디에 뭐가 있나"를 재조사하지 않게 한다.

- **작성 절차·금지·실행-수정 루프는 `/e2e-write` 스킬**(`.claude/commands/e2e-write.md`)이 단일 출처 — 여기서 중복하지 않는다. 이 문서는 **커버리지 맵 · 수동 잔여 · 함정 · 헬퍼 참조**만 담는다.
- 빌드/실행: `pnpm build:e2e` → `pnpm test:e2e` (단일 spec: `pnpm test:e2e -- <이름 일부>`). dist-e2e는 **테스트 전용**(`<all_urls>` 포함, 수동 로드·스토어 업로드 금지).
- **창 깜빡임**: 확장 SW가 headless에선 안 깨어나 headed로만 돈다. 대신 브라우저 창을 화면 밖으로 보내 기본적으로 안 보인다. 디버깅으로 창을 직접 보려면 `E2E_SHOW=1 pnpm test:e2e`.

## 커버리지 맵

| spec | 시나리오 | 형태 |
|---|---|---|
| `activetab-broad-permission.spec.ts` | 광역 host 권한 보유 시 cross-origin 커버 URL 이동 → 패널 유지(세션만 정리·activated 보존) / 비커버 URL(chrome://) → deactivate. bg storage(activated set·세션 키)를 SW로 판정 | 2 tests |
| `style-edit-flow.spec.ts` | 요소 선택 → 스타일 수정 → [다음] → drafting 진입 (next-step 경로 유일 커버) | 1 test |
| `style-changes-dialog.spec.ts` | 변경사항 다이얼로그 — 트리거 badge·요소별 카드·행/전체 초기화·세션 폐기 (16 체크 serial) | serial 16 |
| `style-changes-stacked.spec.ts` | 전 에디터 타입 스타일 누적 + shorthand collapse + class 편집 후 as-is baseline 보존 | serial 6 |
| `buffered-reselect-edit.spec.ts` | 버퍼 요소 재선택 → 편집 복원 → 추가 편집 후 재버퍼에 이전 편집 유지 | serial 2 |
| `dom-tree-nav.spec.ts` | DOM 트리 다이얼로그로 이동 시 현재 요소 편집이 버퍼에 유지 (회귀 — DomTree도 useBufferThenSwitch 경유) | 1 test |
| `capture.spec.ts` | screenshot 영역 드래그 캡처 / element-shot → drafting / element-shot previewing env DOM 행 (회귀) | 3 tests |
| `draft-resume.spec.ts` | to-preview(confirmDraft) 초안 저장 → 패널 재열기 → 이슈 목록 → DraftDetailDialog 내용 복원 | 1 test |
| `freeform-draft.spec.ts` | freeform 진입 → 제목·섹션 입력 → preview 렌더 → 마크다운 복사 페이로드(clipboard stub) | 1 test |
| `log-capture.spec.ts` | console·network 로그 수집 → 항목 표시 → network 상세 status → clear(양쪽) | serial 2 |
| `logs-cross-page.spec.ts` | same-origin 이동 후 로그 보존·누적(webNavigation 꼬리 sync) / reload 시 클리어 | serial 2 |
| `logs-iframe.spec.ts` | same-origin iframe 내부 console 로그 캡처 (all_frames + sentinel 경로) | 1 test |
| `logs-origin-filter.spec.ts` | 127.0.0.1 top + localhost iframe cross-origin 로그 → OriginFilterBar 노출·필터링·해제 | 1 test |
| `onboarding.spec.ts` | 연동 0개 → integrations 탭 자동 진입 | 1 test |
| `picker-guard.spec.ts` | iframe 박스 선택 → 미지원 안내 다이얼로그 → picker idle 복귀 | 1 test |
| `session.spec.ts` | 패널 닫기/재열기 세션 폐기 · 두 탭 독립 세션 (dialog spec test14/16 비중복분) | 2 tests |
| `settings-sections.spec.ts` | 이슈 섹션 토글(notes ON·expectedResult OFF) → drafting·preview 본문 반영 (finally로 기본값 복원) | 1 test |
| `unsupported-url.spec.ts` | chrome:// 탭에서 mode 진입 → pickerUnavailable 다이얼로그 → idle 복귀 | 1 test |

## 수동 잔여 (자동화 못 한 것 — 이유 포함)

스크립트로 판정 불가하거나 e2e 환경 제약으로 빠진 항목. 새로 자동화하면 위 맵으로 옮긴다.

- **picker unsupported URL 중 webstore 차단 호스트** — 실제 webstore 접근이 필요해 fixture 서버로 재현 불가 (미지원 *스킴* 가드는 `unsupported-url.spec.ts`가 chrome://로 커버).
- **캡처 video 모드** — `getUserMedia`+`tabCapture` 의존이라 headed 자동화에서 fake media 없이는 불안정.
- **action 로그** — 별도 서브탭 없이 video 모드 drafting/preview 카드로만 노출 → video 종속.
- **단축키 4종**(`_execute_action`·capture-*) — Playwright는 확장 manifest commands를 발화할 수 없다(CDP 미지원).
- **permission-expired 다이얼로그** — activeTab 권한 만료 상태를 자동화로 재현하기 어렵다 (unsupported 분기만 커버).
- **광역 권한 보유 시 drafting cross-origin → deferred 만료 다이얼로그 부재** — 보존 세션 cross-origin은 keep(메시지 미발신)이라 "다이얼로그가 안 뜸"이라는 *부재* 단언이고, 가짜 패널 + deferred 메시지 broadcast는 SW로 관찰 불가. 분기 자체는 `resolveNavigationAction` 표 테스트(보존+커버→keep)와 `activetab-broad-permission.spec`의 비보존 keep 경로로 커버, 다이얼로그 부재는 tasks.md 수동 테스트로 검증.
- **광역 *미보유* 경로(닫힘·deferred)** — e2e 빌드는 `host_permissions: <all_urls>`라 `permissions.contains`가 항상 true → 미보유 분기 재현 불가. dev 빌드 + Replay 미승인 프로필로 수동 검증(tasks.md).
- **afterImage·캡처 썸네일 시각 정합** — 픽셀 비교라 스크립트 판정 불가. 행 수·색상 등으로 간접 단언만.
- **CC 멘션 필드** — CC 콤보박스는 제출 다이얼로그(`SubmitFieldsDialog`/`IssueCreateModal`)의 플랫폼 `IssueFields` 안에만 존재하고, 그 다이얼로그는 플랫폼 OAuth 연결 account 전제라 e2e에서 진입 불가(플랫폼 필드 UI 전체가 동일 사유로 미커버). 멤버 목록도 실제 플랫폼 API 의존이라 fixture 서버로 재현 불가. 순수 로직(`cc @이름` 조립·이스케이프·Asana sentinel 치환)은 `ccMention.test.ts` 단위 테스트로 커버.

## 함정 (gotchas — 실전에서 밟은 것 누적)

새 spec 쓰기 전에 훑어 같은 함정을 반복하지 않는다.

- **spec 간 탭 누수**: worker fixture(persistent context)를 모든 spec이 공유한다. `beforeAll`로 연 탭/패널은 **반드시 `afterAll`로 닫는다**. 안 닫으면 후행 spec의 `fixtureTabId()`가 잔여 탭을 잡아 **실행 순서에 따라 실패**한다(파일명 알파벳 순 실행 — rename으로 순서가 바뀌면 드러난다).
- **`fixtureTabId` 모호성**: fixture 탭이 여러 개 열려 있으면 url 패턴을 명시한다 — `fixtureTabId("http://127.0.0.1/basic.html")`. 기본 패턴(`http://127.0.0.1/*`)은 첫 매칭 탭을 잡는다(chrome match pattern은 포트 무시).
- **`aria-disabled` 가드 버튼**: `next-step` 등은 `disabled`가 아니라 `aria-disabled`+클릭 가드다. Playwright actionability가 안 막으므로 클릭 전 `expect(btn).not.toHaveAttribute("aria-disabled","true")` 단언 필수 — 없으면 조용한 no-op.
- **Radix 팝오버·cmdk**: Escape가 중첩 팝오버에서 간헐 무시된다 → `closeAllPopovers`(Escape + outside-click 폴백)를 쓴다.
- **picker hover 타이밍**: hover 반영 전 클릭하면 빗나간다 → `pickElement`가 double rAF 후 클릭(내장).
- **repick 후 재선택**: repick 클릭 직후 바로 pick하지 말 것. 버퍼 스냅샷 캡처 완료(=`repick` 버튼 소실)를 기다린 뒤 pick한다.
- **로그 sync 타이밍**: 패널 마운트 시 레코더가 자동 활성화되지만 완료 신호가 없다. 로그 발생 + sync 주기(1500ms) 대기를 `expect(...).toPass()` polling으로 반복해 첫 캡처를 기다린다. **로그 탭은 `recording`/`drafting`/`previewing` phase(`logTabsLocked`)에서 비활성** — 로그 테스트는 idle에서.
- **fresh 프로필 integrations 자동 전환**: 연동 0개면 integrations 탭으로 자동 전환되는 effect와 race가 난다. `enterDebug`가 `tab-debug` active 폴링으로 흡수한다 — 디버그 탭 진입은 이 헬퍼를 거친다. **다른 메인 탭(settings 등) 진입도 동일하게 클릭+active 폴링** 필요(settings-sections.spec의 `setSectionEnabled` 참고).
- **설정 영속 오염**: settings-ui-store는 chrome.storage에 영속돼 worker run 내 후행 spec까지 새어간다. 설정을 바꾸는 spec은 **`finally`로 기본값 복원**한다.
- **셀렉터**: `data-testid` 우선. 섹션 제목 등 i18n 텍스트 의존 금지. CSS prop 라벨(`color`/`padding`)만 하드코딩 허용. testid가 없으면 src에 **속성 추가만**(로직·구조 변경 금지) 후 `build:e2e` 재빌드.
- **bg 패널 종료/유지(deactivatePanelIfCrossOrigin) 판정**: e2e 패널은 실제 side panel이 아니라 일반 Page라 `setOptions(enabled:false)`로 닫히지 않는다 → `waitForEvent("close")`로 판정 불가. 대신 bg가 유지하는 `sidePanel:activated`(number[]) / `editor:${tabId}` 세션 키를 SW `chrome.storage.session`으로 읽어 deactivate/keep을 판정한다(`activetab-broad-permission.spec`). 또한 이 분기는 **activated 탭에서만** 동작하는데(미활성 early-return), activated set은 액션 아이콘 클릭(activateTab)으로만 채워지고 Playwright는 확장 액션을 클릭할 수 없다 → SW로 직접 seed해 전제를 만든다. 탭 닫힘 시 `onRemoved`가 seed 키를 자동 정리하므로 후행 spec 누수 없음.

## 헬퍼 · fixture 빠른 참조

전부 `fixtures/extension.ts`. 새 헬퍼를 추가하면 여기와 `DIRECTORY.md`에 반영한다.

- `ext` worker fixture — `fixtureUrl(page)` / `fixtureTabId(urlPattern?)` / `openPanel(tabId)` / `context`.
- `enterDebug(panel)` — 디버그 탭 진입(active 폴링).
- `enterDebugAndPick(fixture, panel, selector)` — 디버그 → element 모드 → 요소 선택 → `repick` 확인까지.
- `pickElement(fixture, panel, selector)` — bbox 중심 클릭(double rAF hover).
- `typeStyleValue(panel, label, value)` — ValueCombobox 팝오버 입력.
- `setQuadLinkedValue(panel, label, value)` — QuadProp(margin/padding) LinkToggle 4면 동일값.
- `setQuadSideValue(panel, label, sideIndex, value)` — QuadProp 개별 면(top/right/bottom/left) 입력.
- `selectStyleValue(panel, label, option)` — SelectProp(display/overflow 등) 옵션 텍스트 선택.
- `setAlignment(panel, label, idx)` — AlignmentProp(text-align) 탭 선택 (left0 center1 right2 justify3).
- `closeAllPopovers(panel)` — Escape + outside-click 폴백.

fixture 페이지(`fixtures/pages/`):

- `basic.html` — `#title`(color·padding 명시), `#card.card.box`, `#el1`–`#el3`(`.swatch` — 다요소 버퍼·재선택용), `#filler`(2000px).
- `second.html` — cross-page 세션 폐기 검증용(pageKey 상이).
- `iframe.html` — top frame + `#frame` iframe(src=basic.html, picker iframe 가드·iframe 로그 캡처용).
- `cross-origin.html` — `http://localhost:<port>/basic.html` iframe을 JS로 주입(동적 포트). 서버는 전 인터페이스 바인딩이라 localhost로도 접속돼 127.0.0.1 top과 origin이 갈라진다 — origin 필터용.

DOM 트리 다이얼로그: 요소 이름 헤더(`dom-tree-trigger`)로 열고, 트리 노드(`dom-tree-node` + `data-selector`)를 클릭해 이동.
