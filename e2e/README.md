# e2e 스위트 (Playwright)

Chrome 확장을 실제 브라우저에서 구동해 사용자 플로우를 검증하는 e2e 스위트. **무엇을 커버하는지·무엇이 빠졌는지·어떤 함정이 있는지의 단일 출처**다. 시나리오가 늘면 이 문서를 함께 갱신해 "어디에 뭐가 있나"를 재조사하지 않게 한다.

- **작성 절차·금지·실행-수정 루프는 `/e2e-write` 스킬**(`.claude/commands/e2e-write.md`)이 단일 출처 — 여기서 중복하지 않는다. 이 문서는 **커버리지 맵 · 수동 잔여 · 함정 · 헬퍼 참조**만 담는다.
- 빌드/실행: `pnpm build:e2e` → `pnpm test:e2e` (단일 spec: `pnpm test:e2e -- <이름 일부>`). dist-e2e는 **테스트 전용**(`<all_urls>` 포함, 수동 로드·스토어 업로드 금지).

## 커버리지 맵

| spec | 시나리오 | 형태 |
|---|---|---|
| `style-edit-flow.spec.ts` | 요소 선택 → 스타일 수정 → [다음] → drafting 진입 (next-step 경로 유일 커버) | 1 test |
| `style-changes-dialog.spec.ts` | 변경사항 다이얼로그 — 트리거 badge·요소별 카드·행/요소/전체 초기화·세션 폐기 (design.md 16 체크 1:1) | serial 16 |
| `capture.spec.ts` | screenshot 영역 드래그 캡처 / element-shot → drafting | 2 tests |
| `log-capture.spec.ts` | console·network 로그 수집 → 항목 표시 → clear | serial 2 |
| `picker-guard.spec.ts` | iframe 박스 선택 → 미지원 안내 다이얼로그 → picker idle 복귀 | 1 test |
| `session.spec.ts` | 패널 닫기/재열기 세션 폐기 · 두 탭 독립 세션 (dialog spec test14/16 비중복분) | 2 tests |

## 수동 잔여 (자동화 못 한 것 — 이유 포함)

스크립트로 판정 불가하거나 e2e 환경 제약으로 빠진 항목. 새로 자동화하면 위 맵으로 옮긴다.

- **picker unsupported URL**(webstore 등) — 실제 webstore 접근이 필요해 fixture 서버로 재현 불가.
- **캡처 video 모드** — `getUserMedia`+`tabCapture` 의존이라 headed 자동화에서 fake media 없이는 불안정.
- **action 로그** — 별도 서브탭 없이 video 모드 drafting/preview 카드로만 노출 → video 종속.
- **로그 origin 필터** — cross-origin 2개 이상 origin이 섞여야 노출되는데 fixture가 단일 서버 origin이라 재현 불가(인프라 확장 전까지).
- **afterImage·캡처 썸네일 시각 정합** — 픽셀 비교라 스크립트 판정 불가. 행 수·색상 등으로 간접 단언만.

## 함정 (gotchas — 실전에서 밟은 것 누적)

새 spec 쓰기 전에 훑어 같은 함정을 반복하지 않는다.

- **spec 간 탭 누수**: worker fixture(persistent context)를 모든 spec이 공유한다. `beforeAll`로 연 탭/패널은 **반드시 `afterAll`로 닫는다**. 안 닫으면 후행 spec의 `fixtureTabId()`가 잔여 탭을 잡아 **실행 순서에 따라 실패**한다(파일명 알파벳 순 실행 — rename으로 순서가 바뀌면 드러난다).
- **`fixtureTabId` 모호성**: fixture 탭이 여러 개 열려 있으면 url 패턴을 명시한다 — `fixtureTabId("http://127.0.0.1/basic.html")`. 기본 패턴(`http://127.0.0.1/*`)은 첫 매칭 탭을 잡는다(chrome match pattern은 포트 무시).
- **`aria-disabled` 가드 버튼**: `next-step` 등은 `disabled`가 아니라 `aria-disabled`+클릭 가드다. Playwright actionability가 안 막으므로 클릭 전 `expect(btn).not.toHaveAttribute("aria-disabled","true")` 단언 필수 — 없으면 조용한 no-op.
- **Radix 팝오버·cmdk**: Escape가 중첩 팝오버에서 간헐 무시된다 → `closeAllPopovers`(Escape + outside-click 폴백)를 쓴다.
- **picker hover 타이밍**: hover 반영 전 클릭하면 빗나간다 → `pickElement`가 double rAF 후 클릭(내장).
- **repick 후 재선택**: repick 클릭 직후 바로 pick하지 말 것. 버퍼 스냅샷 캡처 완료(=`repick` 버튼 소실)를 기다린 뒤 pick한다.
- **로그 sync 타이밍**: 패널 마운트 시 레코더가 자동 활성화되지만 완료 신호가 없다. 로그 발생 + sync 주기(1500ms) 대기를 `expect(...).toPass()` polling으로 반복해 첫 캡처를 기다린다. **로그 탭은 `recording`/`drafting`/`previewing` phase(`logTabsLocked`)에서 비활성** — 로그 테스트는 idle에서.
- **fresh 프로필 integrations 자동 전환**: 연동 0개면 integrations 탭으로 자동 전환되는 effect와 race가 난다. `enterDebug`가 `tab-debug` active 폴링으로 흡수한다 — 디버그 탭 진입은 이 헬퍼를 거친다.
- **셀렉터**: `data-testid` 우선. 섹션 제목 등 i18n 텍스트 의존 금지. CSS prop 라벨(`color`/`padding`)만 하드코딩 허용. testid가 없으면 src에 **속성 추가만**(로직·구조 변경 금지) 후 `build:e2e` 재빌드.

## 헬퍼 · fixture 빠른 참조

전부 `fixtures/extension.ts`. 새 헬퍼를 추가하면 여기와 `DIRECTORY.md`에 반영한다.

- `ext` worker fixture — `fixtureUrl(page)` / `fixtureTabId(urlPattern?)` / `openPanel(tabId)` / `context`.
- `enterDebug(panel)` — 디버그 탭 진입(active 폴링).
- `enterDebugAndPick(fixture, panel, selector)` — 디버그 → element 모드 → 요소 선택 → `repick` 확인까지.
- `pickElement(fixture, panel, selector)` — bbox 중심 클릭(double rAF hover).
- `typeStyleValue(panel, label, value)` — ValueCombobox 팝오버 입력.
- `setQuadLinkedValue(panel, label, value)` — QuadProp(margin/padding) LinkToggle 4면 동일값.
- `closeAllPopovers(panel)` — Escape + outside-click 폴백.

fixture 페이지(`fixtures/pages/`):

- `basic.html` — `#title`(color·padding 명시), `#card.card.box`, `#filler`(2000px).
- `second.html` — cross-page 세션 폐기 검증용(pageKey 상이).
- `iframe.html` — top frame + `#frame` iframe (picker iframe 가드용).
