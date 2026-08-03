# 안정적 요소 식별 정보 — 구현 태스크

## 선행 조건

- 착수 전 `docs/POSTMORTEM.md`를 `selector`, `bufferedElements`, `styleElements`,
  `frameId`, `saveDraft`로 grep한다. 특히 2026-07-27 복수 요소 AI 컨텍스트 누락과
  optional 필드 재확정 부활 회귀를 확인한다.
- 신규 권한·env·OAuth·외부 API·의존성 없음. `@medv/finder` 4.0.2를 유지한다.
- 구현은 TDD 순서로 진행하고 빌드는 실행하지 않는다.

## 태스크

### Task 1: 안정성 분류와 selector score 순수 함수 (TDD)

- **변경 대상**: `src/content/__tests__/element-locator.test.ts` →
  `src/content/element-locator.ts`(신규)
- **작업 내용**: test attribute allowlist, 동적 ID/class/attribute 거부, selector token
  분류, `SelectorScore` 사전식 비교를 테스트 먼저 작성한 뒤 구현한다.
- **검증**:
  - [ ] `data-testid`, `data-test-id`, `data-test`, `data-e2e`, `data-cy`, `data-qa`,
    `data-automation-id`, `data-pw`만 test contract tier로 분류
  - [ ] 임의 `data-user-id`, `data-index`, `data-selected`는 최고 tier로 승격되지 않음
  - [ ] UUID·긴 숫자·hex/hash·React useId·framework 생성 ID/class 거부
  - [ ] BEM/semantic class는 안정 class로 남음
  - [ ] score가 안정·비위치 후보 → 안정+위치 후보 → 불안정 후보 → path fallback 순이며,
    같은 risk에서는 위치 수 → base 안정성 → 불안정 token → compound 수 → 길이로 비교

### Task 2: 유일 selector 후보 생성과 fallback (TDD)

- **변경 대상**: `src/content/__tests__/element-locator.test.tsx` →
  `src/content/element-locator.ts`, `src/content/dom-describe.ts`
- **작업 내용**: jsdom DOM에서 finder 단계별 후보를 만들고 document 유일성+target identity
  hard gate 후 최적 후보를 선택한다. 전체 500ms/2000 path check 예산, 조상 12단계,
  후보 4개 상한을 구현한다. 기존 `pathSelector` fallback과 `buildSelector` wrapper를 연결한다.
- **검증**:
  - [ ] 예시 DOM에서 유일하면 `[data-e2e="enrollment-card"]` 포함 후보가 nth/class 후보보다 우선
  - [ ] 반복 `data-e2e`만으로 비유일한 후보는 채택하지 않음
  - [ ] 반복 카드의 동일 descendant는 추가 구분자 또는 위치 fallback으로 현재 target 하나만 선택
  - [ ] 동적 ID와 해시 class보다 안정 attribute/class 후보 우선
  - [ ] 모든 후보가 실패하거나 finder가 throw/timeout이면 path fallback 반환
  - [ ] 특수문자 ID/class/attribute가 `CSS.escape` 후 query 가능
  - [ ] `html`, body 직계 자식, SVG element 방어
  - [ ] disconnected element는 유일성 계약을 가장하지 않고 명시적 에러; picker의 기존
    selection-detached 경로가 이를 세션 만료로 처리
  - [ ] 기존 `buildInitialTree`·`buildChildrenResponse` selector 소비 테스트 green

### Task 3: picker payload와 live store에 locator 전달

- **변경 대상**: `src/types/picker.ts`, `src/content/css-resolve.ts`,
  `src/content/picker.ts`, `src/sidepanel/hooks/usePickerMessages.ts`,
  `src/store/editor-store.ts` 및 인접 테스트
- **작업 내용**: `ElementLocator` 타입과 `PickerSelectionPayload.locator`를 추가한다.
  selection 수집 시 locator를 한 번만 만들고 `selector === locator.selector`를 유지한다.
  sidepanel에서 `sender.frameId`·`sender.origin`을 보강하고 buffer 승격/재선택 때 locator를
  보존한다.
- **검증**:
  - [ ] picker payload의 selector와 locator.selector 동일
  - [ ] `picker.selectionUpdated`가 locator를 덮어쓰거나 다른 요소에 적용하지 않음
  - [ ] top frame은 frameOrigin 미설정, iframe은 sender.origin 사용(payload 위조값 없음)
  - [ ] bufferCurrentElement·기존 버퍼 재선택·patch 경로가 locator 보존
  - [ ] `sameElementKey`는 selector+frameId 그대로이며 locator/번호를 키로 사용하지 않음
  - [ ] styling session rebind·applyEditsBySelector·prepareCaptureBySelector 기존 테스트 green

### Task 4: 저장 초안 locator 영속화와 하위호환 (TDD)

- **변경 대상**: `src/store/issues-store.ts`, `src/store/editor-store.ts`,
  `src/sidepanel/lib/resolveDraftStyleElements.ts`, 각 `__tests__/`
- **작업 내용**: `IssueRecord.locator?`, `IssueBufferedElement.locator?`를 저장·복원한다.
  current와 buffered 양쪽을 빠짐없이 직렬화하고 구버전 optional 누락을 허용한다.
- **검증**:
  - [ ] 단일 현재 요소 locator 저장·복원
  - [ ] 복수 buffer locator와 iframe origin 저장·복원
  - [ ] locator 없는 구버전 IssueRecord가 tagName/selector fallback으로 렌더 가능
  - [ ] 버퍼를 모두 지운 뒤 재확정해도 locator/버퍼가 되살아나지 않음
  - [ ] 초안 삭제·blob 정리 동작 불변, 스키마 마이그레이션 불필요

### Task 5: 공용 복수 요소 display model (TDD)

- **변경 대상**: `src/sidepanel/lib/__tests__/elementLocatorFormat.test.ts` →
  `src/sidepanel/lib/elementLocatorFormat.ts`(신규),
  `src/sidepanel/lib/buildIssueMarkdown.ts`
- **작업 내용**: `StyleElementContext[]`에서 `ElementLocatorDisplay[]`를 만드는 순수 formatter를
  구현한다. `mergeStyleElements`가 locator/origin을 보존하고 최종 배열 순서로 연속 번호를
  부여한다.
- **검증**:
  - [ ] 단일 요소가 Element 1
  - [ ] 복수 요소가 최종 merge 순서대로 Element 1..N
  - [ ] dedup·삭제 뒤 번호에 공백이 없음
  - [ ] anchor 있음 → `anchor › tag`, 없음 → tag만
  - [ ] text·accessible name·class 전체 목록이 summary에 포함되지 않음
  - [ ] non-top frame만 origin 표시, 같은 selector의 다른 frame은 별도 항목
  - [ ] 구버전 locator/tag 누락 fallback이 throw하지 않음
  - [ ] `bugshot-meta-for-ai`의 기존 top-level selector와 elements[].selector 보존

### Task 6: Markdown/HTML 계열 본문과 미리보기 적용 (TDD)

- **변경 대상**: `src/sidepanel/lib/buildIssueMarkdown.ts`,
  `buildMarkdownIssueBody.ts`, `buildLinearIssueBody.ts`, `buildAsanaIssueBody.ts`,
  `buildClickupIssueBody.ts`, `buildSlackBody.ts`, 관련 테스트,
  `src/sidepanel/tabs/DraftingPanel.tsx`, `PreviewPanel.tsx`, `DraftDetailDialog.tsx`
- **작업 내용**: DOM selector 쉼표 나열을 번호 목록으로 교체하고 각 Style changes 제목을
  Element 번호로 바꾼 뒤 바로 아래 Selector 행을 추가한다. GitHub/GitLab 공용 builder와
  Linear/Asana/ClickUp/Slack wrapper가 같은 display model을 사용하도록 한다.
- **검증**:
  - [ ] DOM 목록에는 compact summary만 있고 전체 selector/text 없음
  - [ ] 각 Style changes에 같은 Element N과 전체 selector가 정확히 한 번 있음
  - [ ] selector는 heading에서 제거됨
  - [ ] before/after 파일 index와 Element 번호가 동일 배열 index를 사용
  - [ ] 단일/복수, buffer-only+현재 no-diff, 같은 selector+다른 frame 케이스 green
  - [ ] Markdown·HTML escape(`[]`, quotes, backticks, `<>&`) 안전
  - [ ] Drafting/Preview/DraftDetail DOM 표기가 제출 본문과 동일
  - [ ] screenshot 요소 캡처의 기존 단일 `ShotSelector` DOM 행은 불변

### Task 7: Jira ADF·Notion 구조화 본문 적용 (TDD)

- **변경 대상**: `src/sidepanel/lib/buildIssueAdf.ts`,
  `buildNotionIssueBody.ts`, 관련 테스트와 제출 후처리 테스트
- **작업 내용**: DOM을 각 포맷의 중첩/개별 list item으로 렌더하고 summary·selector를 code
  mark/annotation으로 구분한다. Style changes heading과 Selector paragraph를 Element 번호로
  연결한다.
- **검증**:
  - [ ] Jira ADF 유효 노드 구조, 빈 text node 없음
  - [ ] Notion block/rich text 제한 내 출력
  - [ ] Jira snapshot splice가 i번째 style table을 계속 정확히 찾음. Selector paragraph 추가로
    table index 탐색이 어긋나지 않음
  - [ ] Notion before/after attachment placeholder와 Element 번호 대응 유지
  - [ ] 특수문자 selector가 평문으로 보존되고 markup 구조를 깨지 않음

### Task 8: i18n 대칭과 문서 갱신

- **변경 대상**: `src/i18n/namespaces/logs.ts`, `src/log-viewer/i18n.ts`,
  `docs/ARCHITECTURE.md`, `docs/DIRECTORY.md`, 조건부 `docs/privacy.ko.md`·
  `docs/privacy.en.md`, `guide/ko/element/issue.md`, `guide/en/element/issue.md`
- **작업 내용**: Element/Selector 라벨을 ko/en에 추가하고 복제 사전을 맞춘다. 아키텍처와
  디렉터리 문서를 실제 구현에 맞춰 갱신한다. privacy 양쪽은 기존 selector 설명이 조상
  test attribute 요약 제출을 포괄하는지 대조해 부족할 때만 시행일과 본문을 함께 수정한다.
  가이드는 `guide/AUTHORING.md` 규칙에 따라 ko 원본·en 번역을 같은 변경에서 갱신한다.
- **검증**:
  - [ ] `pnpm test --run src/i18n/__tests__/locales.test.ts src/log-viewer/__tests__/i18n.test.ts`
  - [ ] guide ko/en 섹션 구조·사실 대칭
  - [ ] privacy 수정 시 ko/en 본문과 시행일 동시 갱신
  - [ ] `pnpm sync:agents:check` 통과(원본 CLAUDE/command 미수정 확인)

### Task 9: 전체 회귀 검증

- **변경 대상**: 테스트만; 프로덕션 추가 변경 없음
- **작업 내용**: selector 생성, store, 초안, 8개 플랫폼, AI meta 테스트를 전수 확인하고
  typecheck를 실행한다. 빌드는 실행하지 않는다.
- **검증**:
  - [ ] `pnpm test` 통과
  - [ ] `pnpm typecheck` 통과
  - [ ] git diff에서 manifest/권한/env/외부 fetch 변경 없음
  - [ ] 신규 locator에 text/accessibility name/임의 속성 snapshot 없음
  - [ ] finder 전체 예산이 500ms/2000 path check를 넘지 않음

## 테스트 계획

### 단위 테스트

- `element-locator.test.ts`: attribute/class/id 안정성 분류, score, budget/fallback.
- `element-locator.test.tsx`: 실제 jsdom DOM에서 단일·반복 앵커, 동적 token, escaping,
  detached/SVG, 유일성 검증.
- `elementLocatorFormat.test.ts`: 단일·복수 번호, iframe origin, 구버전 fallback, text 제외.
- `editor-store.test.ts`·`issues-store.test.ts`·`resolveDraftStyleElements.test.ts`: live buffer와
  저장 초안 optional locator 왕복.
- 각 build 테스트: Markdown/HTML/Jira/Notion/GitHub/GitLab/Linear/Asana/ClickUp/Slack에서
  DOM 목록 ↔ Style changes 번호 ↔ selector 대응.
- `buildIssueMarkdown.test.ts`: AI meta 기존 selector 보존과 locator 추가.

### e2e 시나리오

`/e2e-write` 입력 후보:

1. “서로 다른 카드 두 개에 같은 스타일 class가 있고 첫 카드 조상에 고유
   `data-e2e`가 있을 때, 첫 카드의 자식을 선택해 스타일을 변경하면 미리보기 DOM에
   `data-e2e` 앵커가 표시되고 Style changes의 Selector에 `nth-of-type`보다 해당 앵커가
   우선 표시된다.”
2. “두 요소를 담아 다음으로 이동하면 DOM에 Element 1·2가 표시되고 각 Style changes
   섹션의 번호·before/after 이미지가 같은 순서이며 selector는 각 섹션에 한 번만 있다.”
3. “iframe과 top frame에서 같은 selector의 요소를 각각 담으면 DOM 목록에 두 항목이
   남고 iframe 항목만 origin이 표시된다.”
4. “복수 요소 초안을 저장해 다시 열면 Element 번호·앵커·Selector가 저장 전과 같다.”

실제 picker/content script·iframe 메시지와 미리보기 렌더를 검증하므로 구현 보고에서
e2e 영향 `있음`으로 표시하고 `/e2e-write`로 반영한다.

### 수동 테스트

- [ ] 큰 상용 페이지에서 요소 hover→선택 반응이 기존 대비 체감 지연되지 않음
- [ ] 카드 순서를 바꾼 뒤 저장된 selector를 참고했을 때 test anchor가 개발자에게 유용한
  컴포넌트 검색 단서로 남음(장기 동일성 보증 테스트가 아니라 사람 판독 확인)
- [ ] selector가 매우 긴 요소 5개를 담아도 DOM 목록은 한 요소 한 줄이고 Style changes
  제목이 과밀하지 않음
- [ ] Chrome DevTools console에서 각 Selector를 해당 frame document에 실행하면 현재
  캡처 시점 target 하나만 매치
- [ ] CSS CodeMirror selector 1행·DOM Tree 이동·버퍼 재선택·before/after 재캡처 정상

## 구현 순서 권장

Task 1 → 2 → 3 → 4 → 5 순차. Task 5의 display model 확정 후 Task 6과 7은 병렬 가능하다.
Task 8은 출력 계약이 확정된 뒤, Task 9는 마지막에 수행한다. 각 TDD 태스크는 대상 테스트
red 확인 → 최소 구현 → 대상 테스트 green 순서로 닫는다.

## 가이드 영향

- `guide/ko/element/issue.md`·`guide/en/element/issue.md` — 재현 환경의 복수 요소 번호
  목록과 각 Style changes 아래 Selector 표기를 설명한다.
- 구현 후 `/guide`로 ko 원본·en 번역을 동기화한다. 새 화면이나 조작은 없어 이미지 교체는
  실제 미리보기 캡처에서 DOM/Style changes 표기가 달라질 때만 수행한다.
