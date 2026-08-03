# 안정적 요소 식별 정보 — 기술 설계

## 개요

현재 `@medv/finder`를 폐기하지 않고 후보 생성기로 유지한다. 새
`content/element-locator.ts`가 finder를 안정성 단계별 필터 구성으로 제한 실행해 소수의
유일 selector 후보를 만들고, 위치 표현 수·안정성 등급·경로 길이를 사전식으로 비교한다.
모든 후보는 현재 frame document에서 `querySelectorAll(candidate).length === 1`이고 그
한 요소가 입력 요소와 동일할 때만 채택한다. 실패하면 현재 `pathSelector` fallback을 쓴다.

실행 selector는 재선택·스타일 적용·캡처·dedup에 계속 쓰므로 비유일한 “설명용 selector”로
대체하지 않는다. 대신 선택 시점에 `ElementLocator`를 함께 만들고 optional 필드로
EditorSelection → BufferedElement/IssueRecord → StyleElementContext까지 전달한다. 본문
빌더는 최종 `styleElements` 배열 인덱스에서 `Element N`을 파생해 DOM 요약과 스타일 변경
섹션을 같은 번호로 렌더한다. 번호는 영속 식별자가 아니다.

## 변경 범위

### `src/content/element-locator.ts` (신규)

- test attribute·ID·class/attribute 값의 안정성 판정 순수 함수와 단계별 finder 후보 생성.
- 후보 검증·사전식 비교·`ElementLocator`의 `anchor`/`target` 파생.
- DOM 접근은 선택 요소와 조상 체인(최대 12단계), 후보 selector 검증(최대 4개)으로 제한.
- `@medv/finder` 외 신규 의존성 없음.

### `src/content/dom-describe.ts` (수정)

- `buildSelector(el)`을 `buildElementLocator(el).selector`의 얇은 호환 wrapper로 변경.
- 기존 `pathSelector`는 `element-locator.ts`의 최후 fallback으로 이동하거나 export 없이
  위임한다.
- DOM Tree의 `TreeNode.selector` 계약은 유지한다.

### `src/content/css-resolve.ts`·`src/content/picker.ts` (수정)

- `collectSelection`이 같은 요소에 대해 selector를 중복 생성하지 않도록
  `ElementLocator`를 입력받거나 locator builder를 한 번만 호출하도록 시그니처를 조정한다.
- `picker.selected` payload에 locator를 포함한다. `picker.selectionUpdated`는 스타일 보강
  메시지라 locator를 다시 보내지 않는다.

### `src/types/picker.ts` (수정)

- `ElementLocator`·`ElementLocatorAnchor` 타입 추가.
- `PickerSelectionPayload.locator` 추가. 새 라이브 메시지라 required로 두되 저장 타입은
  하위호환을 위해 optional로 둔다.

### `src/store/editor-store.ts`·`src/store/issues-store.ts` (수정)

- `EditorSelection.locator`, `BufferedElement.locator` 전달.
- `IssueRecord.locator?`, `IssueBufferedElement.locator?` optional 영속화.
- `confirmDraft`가 현재 요소와 버퍼 요소 locator를 저장한다. `saveDraft` 병합에서 빈 버퍼가
  되살아나는 기존 함정을 피하도록 `bufferedElements` 키를 현행처럼 명시적으로 쓴다.
- locator는 문자열·작은 enum뿐이며 blob 저장소를 사용하지 않는다. 스키마 버전 bump 없이
  optional 필드로 추가한다.

### `src/sidepanel/lib/buildIssueMarkdown.ts` (수정)

- `MergeCurrentSelection`·`StyleElementContext`에 optional locator/origin 전달.
- `mergeStyleElements`가 버퍼와 현재 요소의 locator를 보존한다. dedup 키는 계속
  `selector+frameId`; locator나 표시 번호를 동등성 키로 사용하지 않는다.
- 기존 `joinStyleSelectors`·`styleDomLabel`·`styleSelectorList`를 구조화 locator 기반 공용
  formatter로 교체한다.
- Markdown/HTML 메타의 `elements[]`에도 locator를 넣되, top-level 레거시 selector 필드는
  유지한다.

### `src/sidepanel/lib/elementLocatorFormat.ts` (신규)

- 최종 `StyleElementContext[]`를 입력으로 DOM 요약 항목과 Style changes 제목/selector 행을
  만드는 순수 함수.
- index는 호출 시점 배열 순서에서 `index + 1`로만 계산한다.
- 구버전 locator 없음 → `tagName`, tag도 없음 → `selector`의 마지막 compound를 제한적으로
  사용하고, 파싱 실패 시 `element`로 폴백한다.

### 플랫폼 본문 빌더 (수정)

- Markdown 계열 단일 출처: `buildIssueMarkdown.ts`, `buildMarkdownIssueBody.ts`를 통해
  GitHub·GitLab·Linear·Asana·ClickUp·Slack과 클립보드 Markdown/HTML에 반영.
- 구조화 포맷: `buildIssueAdf.ts`(Jira), `buildNotionIssueBody.ts`(Notion)는 각 플랫폼의
  list/rich-text 노드로 같은 DOM 항목을 렌더.
- 각 Style changes heading은 `Style changes — Element N`, 다음 paragraph/list item은
  `Selector: <code>…</code>`로 렌더한다. selector는 제목에서 제거해 긴 제목을 방지한다.

### 미리보기·저장 초안 UI (수정)

- `src/sidepanel/tabs/DraftingPanel.tsx`, `PreviewPanel.tsx`, `DraftDetailDialog.tsx`가 공용
  formatter 결과를 사용한다.
- `src/sidepanel/lib/resolveDraftStyleElements.ts`가 저장 locator/origin을 라이브
  `StyleElementContext`로 복원한다.

### i18n (수정)

- `src/i18n/namespaces/logs.ts`에 `md.element`, `md.selector` ko/en 키 추가.
- log-viewer가 같은 namespace 값을 복제해 쓰는 구조이므로 `src/log-viewer/i18n.ts`의
  `koDict`/`enDict`도 함께 갱신한다.
- Codex 런타임에서는 i18n 훅이 없으므로 구현 시 두 대칭 테스트를 직접 실행한다.

### 문서 (구현 후 수정)

- `docs/ARCHITECTURE.md`: selector 생성 우선순위, 실행 selector/표시 locator 역할 분리,
  복수 요소 번호 파생, iframe scope를 기록.
- `docs/DIRECTORY.md`: 신규 `element-locator.ts`·`elementLocatorFormat.ts` 역할 추가.
- `docs/privacy.ko.md`·`docs/privacy.en.md`: 새 text 수집은 없고 기존 “요소 selector” 범주
  안이지만, 조상 test attribute가 사람이 읽는 DOM 요약으로 제출된다는 점을 양쪽에서
  대조한다. 기존 설명이 이를 포괄하지 않으면 ko 원본·en 번역과 시행일을 함께 갱신한다.
- `guide/ko/element/issue.md`·`guide/en/element/issue.md`: 복수 요소 DOM 번호 목록과 각
  Style changes의 selector 위치를 설명한다.

## 데이터 흐름

```text
사용자 요소 선택 (해당 frame document)
  → buildElementLocator(element)
      ├─ 단계별 finder 후보 최대 4개
      ├─ document 유일성 + target 동일성 검증
      └─ 실패 시 pathSelector fallback
  → picker.selected { payload.locator, selector=locator.selector }
  → EditorSelection.locator
      ├─ 현재 요소 → IssueRecord.locator?
      └─ bufferCurrentElement → BufferedElement.locator
                              → IssueBufferedElement.locator?
  → mergeStyleElements(buffered, current)
  → StyleElementContext[]                  // 최종 순서 단일 출처
  → formatElementLocator(el, index + 1)
      ├─ DOM: Element N · anchor › tag [· frame origin]
      └─ Style changes — Element N
          Selector: full unique CSS selector
  → 미리보기 / 클립보드 / 8개 플랫폼 / 저장 초안 상세
```

`selector`는 DOM 작업과 `sameElementKey(selector, frameId)`에 계속 사용한다. `anchor`는
사람이 컴포넌트를 찾는 단서이며 유일성 키가 아니다. 반복 `data-e2e`도 anchor가 될 수
있지만 완성 selector 후보는 전체 document에서 유일성 검증을 통과해야 한다.

## 인터페이스 설계

```typescript
export type ElementAnchorKind = "test-attribute" | "id";

export interface ElementLocatorAnchor {
  kind: ElementAnchorKind;
  // CSS.escape 적용 완료한 한 compound. 예: [data-e2e="enrollment-card"] 또는 #checkout
  selector: string;
}

export interface ElementLocator {
  // 현재 frame document에서 target 하나만 가리키는 실행용 CSS selector.
  selector: string;
  // 사람이 grep할 단서. 반복 가능하며 그 자체의 유일성을 보장하지 않는다.
  anchor?: ElementLocatorAnchor;
  // 선택 요소 tagName lowercase. text와 accessible name은 넣지 않는다.
  targetTag: string;
  // iframe일 때만 sender.origin에서 사이드패널이 보강. payload 값은 신뢰하지 않는다.
  frameOrigin?: string;
  // 위치 fallback 포함 여부. 표시하지 않고 테스트·메타 진단에 사용.
  usesPosition: boolean;
}

export interface PickerSelectionPayload {
  selector: string; // locator.selector와 동일 — 기존 소비처 호환
  locator: Omit<ElementLocator, "frameOrigin">;
  // ...기존 필드
}

export interface ElementLocatorDisplay {
  number: number;
  label: string;       // Element N
  summaryParts: string[]; // anchor?, targetTag, frame origin?
  selector: string;
}

export function buildElementLocator(el: Element): ElementLocator;

export function formatElementLocators(
  elements: readonly Pick<
    StyleElementContext,
    "selector" | "tagName" | "locator" | "frameId" | "origin"
  >[],
): ElementLocatorDisplay[];
```

`frameOrigin`은 content payload에서 받지 않는다. 기존 보안 경계대로
`usePickerMessages`가 `sender.frameId`·`sender.origin`에서 얻어 locator에 합친다.
`frameId === 0`이면 표시하지 않고, iframe에서 origin이 비거나 opaque면 기존 origin
표기 관례와 같은 localized fallback을 사용한다.

## selector 후보 및 스코어링

### 후보 단계

동일한 finder를 다음 allow 함수 조합으로 최대 4회 실행한다. wall-clock deadline은 호출
시작부터 500ms 하나를 공유하고, 단계별 `maxNumberOfPathChecks`는 400/500/500/600으로
나눠 합계가 현행 2000을 넘지 않게 한다. finder는 실제 소비 check 수를 노출하지 않으므로
“남은 check”를 추정하지 않는다. 각 단계 `timeoutMs`에는 deadline까지 남은 시간을 넣고,
0이 되면 탐색을 중단한다. 단계마다 500ms를 새로 부여해 최악 시간을 4배로 늘리지 않는다.

1. **test contract**: tag + 신뢰 test attribute만 허용. ID·class·기타 attribute 제외.
2. **stable identity**: 1단계 + 안정성 휴리스틱을 통과한 ID + `name`, `for`,
   `aria-label`, `role` 같은 finder 기존 semantic attribute.
3. **stable class**: 2단계 + 안정성 휴리스틱을 통과한 class.
4. **compatibility fallback**: finder 현행 기본 필터. 기존 사이트 호환과 후보 부재 방어.

각 단계 출력과 `pathSelector`를 후보 목록에 넣되 중복 문자열은 제거한다. finder가 timeout
때 내부 `nth-child` fallback을 반환해도 후보로 받을 수 있다.

### 신뢰 test attribute

다음 exact name만 `test-attribute`로 분류한다.

```text
data-testid, data-test-id, data-test, data-e2e,
data-cy, data-qa, data-automation-id, data-pw
```

값은 비어 있지 않고 100자 이하여야 하며 제어문자를 포함하지 않고 아래 동적 값 거부
휴리스틱도 통과해야 한다. `data-testid="user-550e8400-e29b-41d4-a716-446655440000"`처럼
이름만 test contract이고 값은 런타임 식별자인 후보를 최고 tier로 올리지 않는다. 속성명
패턴을 넓혀 모든 `data-*`를 승격하지 않는다. 임의 `data-*`는 4단계 finder 호환 후보에는
남을 수 있지만 안정 anchor 요약에는 사용하지 않는다.

### 동적 값 거부 휴리스틱

test attribute를 포함한 ID·class·attribute 값에 다음 중 하나가 맞으면 안정 단계에서
제외한다. 4단계 호환 fallback 사용은 허용한다.

- UUID 전체 형태, 10자리 이상 숫자열, epoch-like 숫자
- 8자 이상 연속 hex 또는 base64-like 무구분 문자열
- `:r<number>:` 등 React `useId`, `__id_<number>`, `ember<number>`, `mui-<number>` 형태
- `data-reactid` 등 프레임워크 내부 attribute name
- `data-index`, `data-row-index`, `data-position`, 상태를 나타내는 `data-selected`,
  `data-expanded`, `data-loading`
- class 끝의 6자 이상 hash suffix(`Component_ab12cd34` 등). 단 사람이 명시한 BEM/semantic
  class를 과도하게 배제하지 않도록 전체 class가 일반 단어·하이픈 조합이면 허용한다.

휴리스틱은 안정성을 증명하지 않는다. false positive보다 false negative를 택한다. 즉
의심 후보를 안정 단계에서 빼더라도 4단계와 위치 fallback으로 실행 가능성은 보존한다.

### 사전식 비교

유일성 검증을 통과한 후보만 다음 tuple로 오름차순 비교한다.

```typescript
type SelectorScore = readonly [
  riskTier: 0 | 1 | 2 | 3 | 4 | 5,
  positionalCount: number,
  baseStabilityTier: 0 | 1 | 2 | 3,
  unstableTokenCount: number,
  compoundCount: number,
  length: number,
];
```

- base tier 0: 신뢰 test attribute 포함
- base tier 1: 안정 ID/semantic attribute 포함
- base tier 2: 안정 class만으로 구성
- base tier 3: 안정 token 없는 호환 fallback
- risk tier 0~2: 위치 표현·불안정 token 없는 base tier를 그대로 사용
- risk tier 3: 안정 token으로 만들었지만 위치 표현이 필요한 후보
- risk tier 4: 동적/임의 attribute 등 불안정 token이 든 호환 후보
- risk tier 5: `pathSelector` 최후 fallback
- `:nth-child(`와 `:nth-of-type(` 각각 positionalCount 1 증가
- 동적 거부 패턴과 임의 `data-*`는 unstableTokenCount 증가
- 같은 risk 안에서 위치 표현 수 → base 안정성 → 불안정 token 수 → compound 수 → 문자열
  길이로 비교한다. 따라서 안정적이고 비위치적인 후보를 모두 소진한 뒤 `nth-*`를 쓰며,
  생성값으로 의심되는 ID 하나가 짧다는 이유로 안정 앵커+위치 후보를 이기지 못한다.

유일성은 score 항목이 아니라 선행 hard gate다. 절대 매치 개수/DOM 비율 임계값은 쓰지
않는다. 완성 후보는 1개가 아니면 탈락한다. 앵커 자체의 전역 match count는 반복을
허용하므로 점수로 selector를 탈락시키지 않고 `anchor` 설명 정보로만 쓴다.

표시 `anchor`는 target을 포함한 조상 12단계에서 별도로 고른다. 동적 값 휴리스틱을
통과한 test attribute가 있으면 target과 가장 가까운 것을, 없으면 안정 ID 중 가장 가까운
것을 쓴다. 따라서 반복 test attribute도 컴포넌트 grep 단서로 남을 수 있지만 selector
유일성에는 영향을 주지 않는다. class·semantic/임의 attribute는 compact DOM 요약의
anchor로 승격하지 않는다.

### 비용 상한

- 조상 탐색 최대 12단계. 초과 조상은 selector 생성 finder가 필요할 때 탐색할 수 있지만
  표시 anchor 탐색에서는 제외한다.
- selector 후보 최대 4개 + 최종 path fallback 1개.
- 후보마다 `document.querySelectorAll` 1회, 결과 length가 1일 때 identity 비교.
- class별 `querySelectorAll` 반복이나 DOM 전체 대비 비율 계산은 하지 않는다.
- 전체 finder 예산은 기존 500ms/2000 path check를 넘기지 않는다. 예산 소진 즉시
  `pathSelector`로 끝낸다.

## 본문 출력 계약

복수 요소 N개를 한 줄에 쉼표로 잇지 않고 `DOM` key 아래 중첩 목록/개행으로 출력한다.
플랫폼이 중첩 목록을 지원하지 않으면 한 bullet 안에서 `<br>` 또는 개별 bullet로
동등하게 표현한다.

```markdown
- **DOM**:
  1. **Element 1** · `[data-e2e="enrollment-card"]` › `span`
  2. **Element 2** · `#checkout` › `button` · `pay.example`

## Style changes — Element 1

- **Selector**: `[data-e2e="enrollment-card"] span.text-semantic-informative-primary-low`

| Property | As is | To be |
```

- text/accessibility name은 출력하지 않는다.
- anchor가 없으면 tag만 출력한다.
- iframe origin은 non-top element에만 마지막 part로 출력한다.
- 전체 selector는 각 Style changes 섹션에 정확히 한 번만 출력한다.
- selector를 heading에 넣지 않는다. 긴 selector로 Jira/Notion heading이 비대해지는 것을
  막고 Element 번호를 before/after 이미지·변경 표의 공통 참조로 쓴다.
- screenshot의 요소 캡처(`ShotSelector`)는 복수 Style changes가 없으므로 기존 단일 DOM
  selector 표시를 유지한다. 이번 compact 목록은 `styleElements`가 있는 element 스타일
  편집 모드에만 적용한다.

## 기존 패턴 준수

- 신규 판정은 `element-locator.ts` 순수 helper + jsdom 통합 테스트로 분리한다.
- `picker.ts`는 coverage 로직 스코프 제외이므로 후보 분류·score·format 판정을 그 안에
  두지 않는다.
- 복수 요소 출력은 `mergeStyleElements` 결과를 단일 출처로 사용한다. POSTMORTEM
  2026-07-27의 “최종 본문과 AI 경로가 다른 모델을 소비”한 회귀를 반복하지 않도록 AI
  meta도 같은 `StyleElementContext[]`에서 만든다.
- frame 동등성은 `sameElementKey(selector, frameId)`를 유지한다. origin과 표시 번호를
  dedup 키로 쓰지 않는다.
- 새 i18n 키는 ko/en 및 log-viewer 복제 사전을 함께 수정하고 직접 대칭 테스트를 실행한다.
- 가이드는 `guide/AUTHORING.md`를 따르고 ko 원본·en 번역을 함께 수정한다.
- 새 권한·스토리지 종류·외부 fetch·서버가 없다. 기존 클라이언트 온리 경계를 유지한다.

## 대안 검토

1. **finder를 `unique-selector`·`optimal-select`·DevTools DOMPath로 교체** — 기각. 모두
   현재 DOM 유일성/경로 최적화가 주목적이며 BugShot이 필요한 “test contract 우선,
   사람용 compact 요약, 복수 요소 번호 연결”을 해결하지 않는다. 이미 설치된 finder의
   allow hook을 단계별로 활용하는 변경이 작다.
2. **모든 `data-*`를 ID보다 우선** — 기각. 상태, 인덱스, React 내부값, 사용자/세션
   식별자가 섞인다. exact test attribute만 최고 신뢰로 분류한다.
3. **전역 match count가 적은 class에 연속 가중치 부여** — 기각. 현재 희소성은 재빌드
   안정성과 무관하고, 큰 DOM에서 비율은 희석된다. 완성 selector의 유일성만 hard gate로
   쓰고 안정성은 token 의미/형태로 판정한다.
4. **설명용 비유일 selector로 기존 `selector` 교체** — 기각. 현재 필드는 DOM Tree 이동,
   재바인딩, 편집 적용, 캡처, 버퍼 dedup의 실행 키다. 별도 locator metadata가 필요하다.
5. **조상 체인·속성 snapshot·text를 전부 본문에 표시** — 기각. 복수 요소에서 과밀하고
   text/임의 속성은 개인정보·동적 값 위험이 있다. 사용자 결정대로 앵커+태그만 요약하고
   전체 selector는 해당 Style changes 아래에 둔다.
6. **Element 번호를 UUID로 영속화** — 기각. 번호는 최종 출력 순서를 설명하는 UI 참조다.
   삭제·dedup 후 재번호가 자연스럽고 별도 ID 마이그레이션이 불필요하다.

## 위험 요소

- **안정성 오판**: 단일 DOM snapshot으로 장기 안정성을 증명할 수 없다. 의심 token은
  안정 단계에서 제외하되 호환 fallback으로 실행 가능성을 유지한다.
- **반복 test hook**: `data-e2e="enrollment-card"`가 모든 카드에 반복될 수 있다. anchor는
  설명 정보일 뿐이며 완성 selector 유일성 gate를 절대 생략하지 않는다.
- **finder 다회 실행 비용**: 단계별 호출마다 기존 timeout을 새로 주면 picker가 최대 2초
  멈춘다. 전체 500ms/2000 check 예산을 공유하고 후보 수를 제한한다.
- **유일성 scope 오류**: iframe selector를 top document에서 검사하면 항상 실패하거나
  같은 selector를 잘못 합친다. content script가 실행 중인 자기 document에서 검증하고
  sidepanel은 sender frame 정보를 보강한다.
- **escaping**: ID/class/attribute name/value는 반드시 `CSS.escape`를 거친다. 사람이 읽는
  anchor도 실행 가능한 compound를 그대로 재사용해 별도 escaping 경로를 만들지 않는다.
- **저장 초안 누락**: locator를 라이브 타입에만 추가하면 저장 후 selector 나열로 회귀한다.
  current·buffered 양쪽 IssueRecord 경로와 `resolveDraftStyleElements` 테스트가 필요하다.
- **복수 소비처 드리프트**: Markdown만 고치면 Jira ADF·Notion·Slack·초안 상세이 갈린다.
  공용 display model을 만들고 플랫폼 테스트를 전수 갱신한다.
- **AI meta 회귀**: 사람이 보는 heading에서 selector를 빼도 `bugshot-meta-for-ai`의 기존
  selector와 elements[]를 삭제하면 안 된다. locator는 추가 정보이고 레거시 필드는 유지한다.
- **개인정보**: 임의 속성·text를 별도 snapshot으로 저장하지 않는다. test attribute 값도
  사용자/세션 식별자가 될 수 있으므로 100자 cap과 동적값 거부를 적용하고 privacy 문구를
  구현 시 재검토한다.
- **CSS 편집기 표시**: CSS CodeMirror 1행은 `selection.selector`를 사용한다. selector
  생성 결과가 바뀌어도 selector lock·parse 왕복 계약이 깨지지 않는지 확인한다.
