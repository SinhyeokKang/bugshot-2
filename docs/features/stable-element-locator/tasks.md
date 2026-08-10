# 안정적 요소 식별 정보 — 구현 태스크

## 선행 조건

- 착수 전 `docs/POSTMORTEM.md`를 `selector`, `bufferedElements`, `styleElements`,
  `frameId`, `saveDraft`, `contextSelector`, `골든`으로 grep한다. 특히 2026-07-26
  optional 필드 조건부 스프레드 부활, 2026-07-27 복수 요소 AI 컨텍스트 누락,
  2026-08-03 Chrome CSSOM 직렬화, 2026-08-06 필드 소비처 누락·골든 diff,
  2026-08-07 `sendResponse` 필드 유실 회귀를 확인한다.
- 신규 권한·env·OAuth·외부 API·의존성 없음. `@medv/finder` 4.0.2를 유지한다.
- 구현은 TDD 순서로 진행하고 빌드는 실행하지 않는다.

## 태스크

### Task 0: jsdom `CSS.escape` 폴리필 (선행)

- **변경 대상**: `src/test/setup-dom.ts`
- **작업 내용**: finder가 `CSS.escape`를 무조건 호출하는데 jsdom 29에는 `window.CSS`
  전역 자체가 없다. Task 2 이후의 모든 jsdom 테스트가 이 폴리필 없이는 첫 finder
  호출에서 `ReferenceError`로 죽는다. 기존 테스트가 `dom-describe.ts`를 한 번도 태우지
  않아 아직 드러나지 않은 결손이다.
- **검증**:
  - [ ] 폴리필 추가 후 jsdom에서 `finder(el)`가 예외 없이 문자열을 반환
  - [ ] 기존 `*.test.tsx` 전부 green (폴리필이 다른 테스트를 깨지 않음)
  - [ ] 폴리필은 Chrome 실동작과 다르다는 주석을 남기고, 특수문자 escaping의 최종 그물은
    e2e·수동임을 명시

### Task 1: 안정성 분류와 후보 비교 순수 함수 (TDD)

- **변경 대상**: `src/content/__tests__/element-locator.test.ts` →
  `src/content/element-locator.ts`(신규)
- **작업 내용**: test attribute allowlist, 동적 ID/class/attribute 거부, selector의 위치
  토큰 판정, `(positional, stage, length)` 비교를 테스트 먼저 작성한 뒤 구현한다.
- **검증**:
  - [ ] `data-testid`, `data-test-id`, `data-test`, `data-e2e`, `data-cy`, `data-qa`,
    `data-automation-id`, `data-pw`만 test contract로 분류
  - [ ] 그중 `data-e2e`·`data-cy`·`data-qa`·`data-pw`·`data-test-id`·`data-automation-id`
    6개는 finder 기본 `wordLike` 게이트에 막히므로 stable 단계 `attr` 훅이 명시적으로
    통과시켜야 후보가 생김을 단언
  - [ ] 임의 `data-user-id`, `data-index`, `data-selected`는 test contract로 승격되지 않음
  - [ ] UUID·긴 숫자·hex/hash·React useId·framework 생성 ID/class 거부
  - [ ] `className` 훅이 선택 요소가 가진 class 이름을 **전역 거부**하고, 조상이 같은
    이름을 써도 함께 배제된다는 한계를 테스트로 고정
  - [ ] 비교가 위치토큰 유무 → 단계(stable 0 / compat 1) → 길이 순
  - [ ] 위치 없는 compat 후보가 위치 있는 stable 후보를 이긴다

### Task 2: 2단계 후보 생성과 fallback (TDD)

- **변경 대상**: `src/content/__tests__/element-locator.test.tsx` →
  `src/content/element-locator.ts`, `src/content/dom-describe.ts`
- **작업 내용**: jsdom DOM에서 stable/compat 2단계 finder 후보를 만들고 최적 후보를
  선택한다. 공유 500ms deadline, path check 1000/1000, 조상 12단계 상한, 요소 참조
  WeakMap 메모이즈를 구현한다. `pathSelector`를 `element-locator.ts`로 옮기고
  `dom-describe.ts`가 역import하되 DOM Tree의 `buildSelector`는 기존 단일 finder 경량
  경로를 유지한다. finder 호출은 주입 가능한 seam으로 두어 fake clock/mock으로 검증한다.
- **검증**:
  - [ ] 예시 DOM에서 `[data-e2e="enrollment-card"] span`이 채택되고, 선택 요소 자신의
    class(`.text-semantic-…`)와 `nth-of-type` 후보를 이긴다
  - [ ] 반복 `data-e2e`만으로 비유일한 후보는 finder가 애초에 반환하지 않음
  - [ ] 반복 카드의 동일 descendant는 위치 fallback으로 현재 target 하나만 선택
  - [ ] 동적 ID와 해시 class보다 안정 attribute/class 후보 우선
  - [ ] **단계별 개별 try/catch**: stable 단계가 `Error("Timeout: …")`를 던져도 compat
    단계가 실행된다
  - [ ] `unique()`의 `Error("Can't select any node with this selector")`도 같은 경로로 흡수
  - [ ] 모든 후보가 실패하면 `pathSelector` 반환
  - [ ] **결정성**: 예산이 중간에 끊기면 부분 결과를 채택하지 않고 항상 `pathSelector`로
    수렴한다. 같은 요소·같은 DOM에 대해 fake clock 값을 바꿔도 결과가 동일
  - [ ] 남은 예산이 0 이하이면 finder를 **호출하지 않는다**(`timeoutMs: 0`을 넘기지 않음)
  - [ ] mock finder에 전달된 timeout은 공용 500ms deadline의 남은 값이고 path check 합계는
    1000+1000=2000
  - [ ] 같은 요소 참조로 재호출하면 finder가 다시 호출되지 않음(메모이즈)
  - [ ] 특수문자 ID/class/attribute가 `CSS.escape` 후 query 가능 — **jsdom 폴리필 기준**
    (Chrome 실동작은 e2e·수동으로 확인)
  - [ ] `html`, body 직계 자식, SVG element 방어
  - [ ] disconnected element는 유일성 계약을 가장하지 않고, 호출 전 `isConnected` 확인과
    예외 매핑으로 기존 selection-detached 세션 만료 경로가 처리
  - [ ] DOM Tree 초기/자식 확장은 안정 locator 탐색을 호출하지 않아 기존 비용 계약 유지
    (`buildSelector` 호출 경로에 mock spy)

> `buildInitialTree`·`buildChildrenResponse`의 기존 selector 소비 테스트는 **존재하지
> 않는다**(`dom-describe.ts` 커버리지 0/119). 이 축의 회귀 확인은 e2e
> `dom-tree-nav.spec.ts`와 아래 수동 테스트가 담당한다.

### Task 3: picker payload와 live store에 locator 전달

- **변경 대상**: `src/types/picker.ts`, `src/content/css-resolve.ts`,
  `src/content/picker.ts`, `src/sidepanel/hooks/usePickerMessages.ts`,
  `src/store/editor-store.ts` 및 인접 테스트
- **작업 내용**: `ElementLocator` 타입과 `PickerSelectionPayload.locator`를 추가한다.
  selection 수집 시 locator를 만들고 `selector === locator.selector`를 유지한다.
  **`emitSelected`(pick/navigate/rebind)와 `postSelectionUpdate`(`picker.ts:1129`) 둘 다
  같은 메모이즈된 locator를 쓴다.** sidepanel에서 `sender.frameId`·`sender.origin`을
  보강하고 buffer 승격/재선택 때 locator를 보존한다.
- **검증**:
  - [ ] picker payload의 selector와 locator.selector 동일
  - [ ] `postSelectionUpdate`가 만드는 selector가 `emitSelected`와 동일 문자열이라
    `updateSelectionStyles`(`editor-store.ts:697`)의 `sameElementKey` stale 가드를 통과한다
    — cross-origin 스타일 보강이 드랍되지 않음
  - [ ] `picker.selectionUpdated`가 locator를 덮어쓰거나 다른 요소에 적용하지 않음
  - [ ] payload 조립이 **필드를 골라 담지 않고 스프레드**로 펼쳐 `contextSelector` 등
    기존 필드가 유실되지 않음 (`grep -n "sendResponse({ " src/content/*.ts`로 전수 확인)
  - [ ] top frame은 origin 미설정, iframe은 sender.origin 사용(payload 위조값 없음)
  - [ ] bufferCurrentElement·기존 버퍼 재선택·patch 경로가 locator 보존
  - [ ] **선택 요소 class 삭제·교체 뒤에도** 현재 편집·버퍼 승격·재선택·패널 재오픈
    rebind·캡처가 같은 요소를 유지한다. compat fallback이 불가피하게 그 class를 쓴
    경우만 예외이고 기존 세션 만료 경로로 처리됨을 단언
  - [ ] `sameElementKey`는 selector+frameId 그대로이며 locator/번호를 키로 사용하지 않음

> styling session rebind·`applyEditsBySelector`·`prepareCaptureBySelector`의 기존 테스트도
> **존재하지 않는다**(`picker.ts` 커버리지 0/828, 해당 심볼 언급 테스트 0건). 이 축은 e2e
> `buffered-reselect-edit.spec.ts`와 수동 테스트로 확인한다.

### Task 4: 저장 초안 locator 영속화와 하위호환 (TDD)

- **변경 대상**: `src/store/issues-store.ts`, `src/store/editor-store.ts`,
  `src/sidepanel/lib/resolveDraftStyleElements.ts`, 각 `__tests__/`
- **작업 내용**: `IssueRecord.locator?`, `IssueRecord.origin?`,
  `IssueBufferedElement.locator?`를 저장·복원한다. current와 buffered 양쪽을 빠짐없이
  직렬화하고 구버전 optional 누락을 허용한다.
- **검증**:
  - [ ] 단일 현재 요소 locator 저장·복원
  - [ ] 복수 buffer locator와 iframe origin 저장·복원
  - [ ] iframe의 단일 current draft가 `IssueRecord.origin?`을 거쳐 저장·재열기 후 host를 복원
  - [ ] **`saveDraft` 병합에서 조건부 스프레드를 쓰지 않는다** — `locator: locator ?? undefined`
    형태를 단언하고, locator 있는 요소 → 없는 요소로 갈아탄 뒤 재확정하면 이전 locator가
    사라지는지 확인
  - [ ] locator 없는 구버전 IssueRecord가 tagName/selector fallback으로 렌더 가능
  - [ ] 버퍼를 모두 지운 뒤 재확정해도 locator/버퍼가 되살아나지 않음
  - [ ] 초안 삭제·blob 정리 동작 불변, 스키마 마이그레이션 불필요

### Task 5: 공용 표시 model (TDD)

- **변경 대상**: `src/sidepanel/lib/__tests__/elementLocatorFormat.test.ts` →
  `src/sidepanel/lib/elementLocatorFormat.ts`(신규),
  `src/sidepanel/lib/buildIssueMarkdown.ts`
- **작업 내용**: `StyleElementContext[]`에서 `ElementLocatorDisplay[]`를 만드는 순수
  formatter를 구현한다. `mergeStyleElements`가 locator/origin을 보존하고, 요소가 2개
  이상일 때만 최종 배열 순서로 연속 번호를 부여한다. DOM 전용 structured row 모델을
  제공한다.
- **검증**:
  - [ ] 단일 요소는 `number`가 `undefined`이고 앵커 요약만 나온다
  - [ ] 복수 요소가 최종 merge 순서대로 1..N
  - [ ] dedup·삭제 뒤 번호에 공백이 없음
  - [ ] anchor 있음 → `anchor › tag`, 없음 → `tag › selector 마지막 compound`
  - [ ] text·accessible name·class 전체 목록이 summary에 포함되지 않음
  - [ ] non-top frame만 origin host 표시, 같은 selector의 다른 frame은 별도 항목
  - [ ] opaque/빈 origin은 localized unknown
  - [ ] 구버전 locator/tag 누락 fallback이 throw하지 않음
  - [ ] `bugshot-meta-for-ai`의 기존 top-level selector와 elements[].selector 보존
  - [ ] `mergeStyleElements` 파리티 선언 3파일(`styleChangeGroups.ts:67`,
    `diffAnnotation.ts:23`, `prompts/draftStyleElements.ts:87`)의 판정이 여전히 일치
    (`styleChangeGroups.test.ts:146` green)

### Task 6: Markdown/HTML 계열 본문 (TDD)

- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`,
  `buildMarkdownIssueBody.ts`, `buildLinearIssueBody.ts`, `buildAsanaIssueBody.ts`,
  `buildClickupIssueBody.ts`, `buildSlackBody.ts`, `src/sidepanel/lib/submitToAsana.ts`,
  AI 프롬프트(`prompts/draftRich.ts`, `prompts/draftCompact.ts`), 관련 테스트
- **작업 내용**: DOM selector 쉼표 나열을 목록으로 교체하고 각 Style changes 제목을
  `Element N · anchor › tag`(단일이면 `anchor › tag`)로 바꾼 뒤 바로 아래 Selector 행을
  추가한다. before/after 파일명을 `element-${i+1}-before.webp` 형태로 바꾸고 alt에 요소
  번호를 넣는다. GitHub/GitLab 공용 builder와 Linear/Asana/ClickUp/Slack wrapper가 같은
  표시 모델을 쓰게 한다.
- **검증**:
  - [ ] DOM 목록에는 compact summary만 있고 전체 selector/text 없음
  - [ ] 각 Style changes에 같은 요소 참조와 전체 selector가 정확히 한 번 있음
  - [ ] 전체 selector는 heading에서 제거되고 앵커 요약은 heading에 남음
  - [ ] 단일 요소는 어디에도 `Element 1`이 없음
  - [ ] `joinStyleSelectors`·`styleDomLabel`·`styleSelectorList`의 **`styleElements` 빈
    분기(= `ShotSelector` 폴백)는 변경되지 않음** — screenshot 요소 캡처 DOM 행 불변
  - [ ] 파일명 index와 본문 요소 번호가 일치하고, `submitToAsana.ts:105`의 webp→jpeg
    rename 뒤에도 대응이 유지됨
  - [ ] AI 프롬프트(`draftRich.ts:118`·`draftCompact.ts:70`)의 요소 번호가 본문
    `Element N`과 같은 배열에서 파생됨을 교차 단언
  - [ ] 단일/복수, buffer-only+현재 no-diff, 같은 selector+다른 frame 케이스 green
  - [ ] Markdown·HTML escape(`[]`, quotes, backticks, `<>&`) 안전

### Task 7: Jira ADF·Notion 구조화 본문 (TDD)

Task 6 완료 후 **순차** 진행한다. 두 태스크가 같은 골든 스냅샷 파일을 무효화하고,
Task 7 대상이 Task 5/6이 바꾸는 `styleSelectorList`(`buildIssueMarkdown.ts:207`)에 직접
의존하기 때문이다.

- **변경 대상**: `src/sidepanel/lib/buildIssueAdf.ts`,
  `buildNotionIssueBody.ts`, 관련 테스트와 제출 후처리 테스트
- **작업 내용**: DOM을 각 포맷의 list item으로 렌더하고 summary·selector를 code
  mark/annotation으로 구분한다. Style changes heading과 Selector paragraph를 같은 요소
  참조로 연결한다.
- **검증**:
  - [ ] Jira ADF 유효 노드 구조, 빈 text node 없음
  - [ ] Notion block/rich text 제한 내 출력
  - [ ] Jira snapshot splice가 i번째 style table을 계속 정확히 찾음. Selector paragraph 추가로
    table index 탐색이 어긋나지 않음
  - [ ] Notion before/after attachment placeholder와 요소 번호 대응 유지
  - [ ] 특수문자 selector가 평문으로 보존되고 markup 구조를 깨지 않음

### Task 8: UI 렌더 — 미리보기·작성·초안 상세·리포트

- **변경 대상**: `src/sidepanel/lib/environmentRows.ts`,
  `src/sidepanel/lib/buildReportData.ts`,
  `src/sidepanel/components/IssuePreviewView.tsx`,
  `src/sidepanel/tabs/DraftingPanel.tsx`, `PreviewPanel.tsx`, `DraftDetailDialog.tsx`
- **작업 내용**: DOM 행 생산자 4곳과 공용 렌더러 1곳이 structured row를 쓰게 한다.
  DraftingPanel은 readonly `<Input>` 행 폼 안에 있으므로 라벨 열 폭(`w-24`)과 비활성 삭제
  버튼 자리를 유지한 채 목록 블록을 끼운다.
- **검증**:
  - [ ] Drafting/Preview/DraftDetail/logs.html DOM 표기가 제출 본문과 동일
  - [ ] 네 화면이 공용 렌더러(`IssuePreviewView`의 env-row 계열)를 쓰고 Style changes key는
    selector+frameId
  - [ ] 목록은 `list-none pl-0` — `1. Element 1` 이중 번호가 나오지 않음
  - [ ] Selector는 `font-mono text-mono break-all`로 13px mono이며 잘리지 않고 텍스트 선택 가능
  - [ ] iframe origin은 Badge가 아니라 인라인 muted 텍스트
  - [ ] **320px**(`globals.css:78`의 `min-width`)에서 가로 스크롤·잘림 없음
  - [ ] logs.html 리포트의 `envRows` 직렬화가 깨지지 않고 log-viewer에서 렌더됨
  - [ ] `IssuePreviewView`에 새 i18n 키를 넣었다면 `src/log-viewer/i18n.ts` 복제 사전도 갱신

### Task 9: 골든 스냅샷 일괄 갱신

Task 6·7·8이 모두 닫힌 뒤 **단일 단계**로 수행한다.

- **변경 대상**: `src/sidepanel/lib/__tests__/__snapshots__/bodyOutputGolden.test.ts.snap`
- **작업 내용**: `vitest -u`로 골든 58장을 한 번에 갱신하고 diff를 검토한다.
- **검증**:
  - [ ] 골든 diff를 줄 단위로 집계해 **의도한 변경만** 있는지 확인(DOM 행 형태, Style
    changes 제목, Selector 행, 파일명). 의도 밖 줄이 있으면 원인 규명 전까지 커밋하지 않음
  - [ ] 갱신 후 `pnpm test --run src/sidepanel/lib/__tests__/bodyOutputGolden.test.ts` green

### Task 10: i18n 대칭과 문서 갱신

- **변경 대상**: `src/i18n/namespaces/issue.ts`(UI 라벨),
  필요 시 `src/log-viewer/i18n.ts`,
  `docs/ARCHITECTURE.md`, `docs/DIRECTORY.md`, `docs/privacy.ko.md`·
  `docs/privacy.en.md`, `guide/ko/element/issue.md`, `guide/en/element/issue.md`
- **작업 내용**: UI 표면의 Element/Selector 라벨을 ko/en에 추가한다. **이슈 본문 출력의
  `Element`·`Selector`는 형제 라벨(`DOM`·`Page`·`As is`·`To be`)과 같이 하드코딩 영문**이라
  본문용 i18n 키는 만들지 않는다. 아키텍처·디렉터리 문서를 실제 구현에 맞춰 갱신한다.
  **privacy 양쪽은 iframe origin host가 이슈 본문·제출 페이로드에 신규 노출된다는 점을
  ko/en 본문에 명시하고 시행일을 함께 수정한다** — 조상 test attribute 값은 오늘도
  selector에 실려 나가고 `privacy.ko.md` L42가 이미 공개하므로 근거가 아니다.
  가이드는 `guide/AUTHORING.md` 규칙에 따라 ko 원본·en 번역을 같은 변경에서 갱신한다.
- **검증**:
  - [ ] `pnpm test --run src/i18n/__tests__/locales.test.ts src/log-viewer/__tests__/i18n.test.ts`
  - [ ] ko 로케일에서도 이슈 본문의 `Element 1`·`Selector`가 영문 그대로
  - [ ] guide ko/en 섹션 구조·사실 대칭
  - [ ] privacy ko/en 본문과 시행일 동시 갱신
  - [ ] `pnpm sync:agents:check` 통과(원본 CLAUDE/command 미수정 확인)

### Task 11: 전체 회귀 검증

- **변경 대상**: 테스트만; 프로덕션 추가 변경 없음
- **작업 내용**: selector 생성, store, 초안, 8개 플랫폼, logs.html, AI meta 테스트를 전수
  확인하고 typecheck를 실행한다. 빌드는 실행하지 않는다.
- **검증**:
  - [ ] `pnpm test` 통과
  - [ ] `pnpm typecheck` 통과
  - [ ] git diff에서 manifest/권한/env/외부 fetch 변경 없음
  - [ ] 신규 locator에 text/accessibility name/임의 속성 snapshot 없음

## 테스트 계획

### 단위 테스트

- `element-locator.test.ts`: attribute/class/id 안정성 분류, 2필드 비교.
- `element-locator.test.tsx`: 실제 jsdom DOM에서 단일·반복 앵커, 동적 token, escaping,
  detached/SVG, 단계별 try/catch, 예산 소진 결정성, 메모이즈.
- `elementLocatorFormat.test.ts`: 단일(번호 없음)·복수 번호, iframe origin, 구버전
  fallback, text 제외.
- `editor-store.test.ts`·`issues-store.test.ts`·`resolveDraftStyleElements.test.ts`: live buffer와
  저장 초안 optional locator 왕복, 조건부 스프레드 부재.
- 각 build 테스트: Markdown/HTML/Jira/Notion/GitHub/GitLab/Linear/Asana/ClickUp/Slack에서
  DOM 목록 ↔ Style changes ↔ selector ↔ 첨부 파일명 대응.
- `buildIssueMarkdown.test.ts`: AI meta 기존 selector 보존과 locator 추가, AI 프롬프트
  번호 교차 단언.

### e2e 시나리오

`/e2e-write` 입력 후보. **게이트는 전용 marker prop으로 걸고 selector 문자열은 단언에만
쓴다** — `e2e/GOTCHAS.md:35`가 "`@medv/finder`는 최단 유니크를 고르므로 selector 줄을
게이트로 쓰지 말라"를 이미 못박았다. selector를 대기 조건으로 쓰면 실패가 assertion이
아니라 timeout으로 나온다.

1. "서로 다른 카드 두 개에 같은 스타일 class가 있고 첫 카드 조상에 고유 `data-e2e`가
   있을 때, 첫 카드의 자식을 선택해 스타일을 변경하면 미리보기 DOM에 `data-e2e` 앵커가
   표시되고 Style changes의 Selector에 `nth-of-type`이 아니라 해당 앵커가 쓰인다."
2. "두 요소를 담아 다음으로 이동하면 DOM에 Element 1·2가 표시되고 각 Style changes
   제목의 번호·before/after 이미지가 같은 순서이며 selector는 각 섹션에 한 번만 있다."
3. "요소를 하나만 담으면 DOM·Style changes 어디에도 `Element` 번호가 없고 앵커 요약만
   표시된다."
4. "iframe과 top frame에서 같은 selector의 요소를 각각 담으면 DOM 목록에 두 항목이
   남고 iframe 항목만 origin host가 표시된다."
5. "복수 요소 초안을 저장해 다시 열면 번호·앵커·Selector가 저장 전과 같다."

**추가할 `data-testid` 최소 계약** (기존 `env-row`/`data-env-label="DOM"` 재사용 여부를
구현 시 확정):

| testid / 속성 | 대상 |
|---|---|
| `dom-element-item` | DOM 목록의 항목 하나 |
| `dom-element-anchor` | 항목의 앵커 compound |
| `dom-element-origin` | 항목의 iframe origin host |
| `style-changes-selector` | Style changes 아래 Selector 행 |
| `data-element-number` (속성) | 요소 번호. 텍스트 파싱 대신 속성으로 판정 |

fixture에는 고유/반복 `data-e2e`, top/iframe 동일 selector, 선택 요소 class 삭제 케이스를
둔다. 저장 시나리오는 저장 → 이슈 목록 → 상세 재열기 경로로 판정한다.

실제 picker/content script·iframe 메시지와 미리보기 렌더를 검증하므로 구현 보고에서
e2e 영향 `있음`으로 표시하고 `/e2e-write`로 반영한다.

### 수동 테스트

- [ ] 고정 픽스처(대형 상용 페이지 1개)에서 DOM Tree 열기 3회 중앙값이 변경 전 대비
  **+20% 이내**이고, 선택 locator 생성이 500ms 안에 끝난다
- [ ] Chrome DevTools console에서 각 Selector를 해당 frame document에 실행하면 현재
  캡처 시점 target 하나만 매치 (jsdom 폴리필이 아닌 실제 `CSS.escape` 경로 확인 —
  특수문자 class·ID가 있는 요소 포함)
- [ ] 선택 요소의 class를 편집기로 지운 뒤 재선택·버퍼 승격·before/after 재캡처가 같은
  요소를 유지
- [ ] selector가 매우 긴 요소 5개를 담아도 DOM 목록은 한 요소 한 줄이고 Style changes
  제목이 과밀하지 않음
- [ ] CSS CodeMirror selector 1행·DOM Tree 이동·버퍼 재선택 정상
- [ ] logs.html 리포트를 열어 DOM 행이 이슈 본문과 같은 표기로 렌더됨

## 구현 순서

Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 순차. **Task 6·7은 병렬 불가**(같은 골든 파일
무효화 + `styleSelectorList` 의존). 골든 갱신은 Task 9로 분리하고 Task 10(문서·i18n),
Task 11(회귀)은 마지막이다. 각 TDD 태스크는 대상 테스트 red 확인 → 최소 구현 → 대상
테스트 green 순서로 닫는다.

## 가이드 영향

- `guide/ko/element/issue.md`·`guide/en/element/issue.md` — 재현 환경의 복수 요소 번호
  목록과 각 Style changes 아래 Selector 표기를 설명한다.
- 구현 후 `/guide`로 ko 원본·en 번역을 동기화한다. 새 화면이나 조작은 없어 이미지 교체는
  실제 미리보기 캡처에서 DOM/Style changes 표기가 달라질 때만 수행한다(`/guide-shots`).
