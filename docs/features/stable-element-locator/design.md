# 안정적 요소 식별 정보 — 기술 설계

## 개요

현재 `@medv/finder`를 폐기하지 않고 후보 생성기로 유지한다. finder는 후보를 **누적
penalty 오름차순으로 yield하고 유일한 첫 후보를 반환**하므로 주어진 훅 구성에서 이미
"가장 싼 유일 selector"를 준다. 사람이 다시 정렬할 이유는 하나뿐이다 — penalty가
하드코딩(id 0 / class 1 / attr 2 / tag 5 / `nth-of-type` 10 / `nth-child` 50)이라 test
attribute가 흔한 스타일 class에 진다는 것. 그래서 새 `content/element-locator.ts`는
finder를 **2회** 실행하고 **2필드**로 비교한다.

1. **stable**: 안정성 필터 훅(신뢰 test attribute + semantic attribute / 동적 거부 ID /
   동적·해시·타깃 소유 class 거부)
2. **compat**: 현행 `buildSelector`와 동일한 finder 기본 필터

비교 tuple은 `(positional: 0|1, stage: 0|1, length)` 오름차순이다. 두 후보 모두 실패하면
`pathSelector` fallback을 쓴다.

실행 selector는 재선택·스타일 적용·캡처·dedup에 계속 쓰므로 비유일한 "설명용 selector"로
대체하지 않는다. 대신 선택 시점에 `ElementLocator`를 함께 만들고 optional 필드로
EditorSelection → BufferedElement/IssueRecord → StyleElementContext까지 전달한다. 본문
빌더는 최종 `styleElements` 배열에서 표시 모델을 파생해 DOM 요약과 스타일 변경 섹션을
같은 참조로 렌더한다. 요소가 둘 이상일 때만 `Element N` 번호를 붙인다. 번호는 영속
식별자가 아니다.

## 변경 범위

### `src/content/element-locator.ts` (신규)

- test attribute·ID·class/attribute 값의 안정성 판정 순수 함수와 2단계 finder 후보 생성.
- 후보 비교·`ElementLocator`의 `anchor`/`targetTag` 파생.
- 선택 요소당 결과 메모이즈(WeakMap 키 = 요소 참조). 같은 요소에 대한 재호출은 finder를
  다시 돌리지 않는다.
- DOM 접근은 선택 요소와 조상 체인(최대 12단계), `pathSelector` fallback 검증 1회로 제한.
- `@medv/finder` 외 신규 의존성 없음.

### `src/content/dom-describe.ts` (수정)

- DOM Tree의 `buildSelector(el)`은 기존 단일 finder 경량 경로를 유지한다. ancestor와 lazy
  child마다 안정 locator 탐색을 반복하지 않는다.
- **`pathSelector`는 현재 모듈 private다**(`dom-describe.ts:119`). `element-locator.ts`가
  재사용하려면 export가 필요하다. 이번 변경에서는 `pathSelector`를 `element-locator.ts`로
  옮기고 `dom-describe.ts`가 역import한다 — 순수 함수라 커버리지 로직 스코프에 포함되는
  쪽이 맞다(`dom-describe.ts`는 `BROWSER_BOUND_EXACT` 등록으로 분모 제외 상태다).
- DOM Tree의 `TreeNode.selector` 계약은 유지한다.

### `src/content/css-resolve.ts`·`src/content/picker.ts` (수정)

- `collectSelection`이 locator builder를 받도록 시그니처를 조정한다.
- **`emitSelected`(pick/navigate/rebind 3소스)와 `postSelectionUpdate`(cross-origin 스타일
  보강, 선택당 최대 2회 추가 발화, `picker.ts:1129`)가 같은 요소에 대해 같은 selector를
  내야 한다.** 사이드패널 `updateSelectionStyles`(`editor-store.ts:697`)가
  `sameElementKey`로 stale 가드를 걸기 때문에, 두 경로의 selector가 갈리면 보강이 무음
  드랍된다. 요소 참조 기준 메모이즈로 양쪽을 같은 값에 묶고 finder 재실행도 막는다.
- `picker.selected` payload에 locator를 포함한다. `picker.selectionUpdated`는 스타일 보강
  메시지라 locator를 다시 보내지 않는다.
- payload 조립은 **필드를 골라 담지 않고 스프레드로 펼친 뒤 바꿀 것만 덮어쓴다**
  (POSTMORTEM 2026-08-07 `contextSelector` 유실 재발 방지).

### `src/types/picker.ts` (수정)

- `ElementLocator`·`ElementLocatorAnchor` 타입 추가.
- `PickerSelectionPayload.locator` 추가. 새 라이브 메시지라 required로 두되 저장 타입은
  하위호환을 위해 optional로 둔다.

### `src/store/editor-store.ts`·`src/store/issues-store.ts` (수정)

- `EditorSelection.locator`, `BufferedElement.locator` 전달.
- `IssueRecord.locator?`, `IssueRecord.origin?`, `IssueBufferedElement.locator?` optional 영속화.
  (`origin`은 현재 `IssueBufferedElement`에만 있고 current 요소는 `frameId?`만 저장한다 —
  본문에 origin을 노출하기로 했으므로 대칭 보정이 필요하다.)
- `confirmDraft`가 현재 요소와 버퍼 요소 locator를 저장한다. `saveDraft`가 병합
  (`{...existing, ...record}`)이므로 **조건부 스프레드(`...(locator ? { locator } : {})`)를
  쓰지 않고 `locator: locator ?? undefined`로 키를 항상 명시**한다. 조건부로 쓰면 locator
  없는 요소로 갈아탄 뒤 재확정할 때 이전 locator가 살아남는다(POSTMORTEM 2026-07-26 A-11과
  동형). `bufferedElements` 키도 현행처럼 명시적으로 쓴다.
- locator는 문자열·작은 enum뿐이며 blob 저장소를 사용하지 않는다. 스키마 버전 bump 없이
  optional 필드로 추가한다.

### `src/sidepanel/lib/buildIssueMarkdown.ts` (수정)

- `MergeCurrentSelection`·`StyleElementContext`에 optional locator/origin 전달.
- `mergeStyleElements`가 버퍼와 현재 요소의 locator를 보존한다. dedup 키는 계속
  `selector+frameId`; locator나 표시 번호를 동등성 키로 사용하지 않는다.
- 기존 `joinStyleSelectors`·`styleDomLabel`·`styleSelectorList`(`buildIssueMarkdown.ts:207` 외)는
  **통째로 교체하지 않는다.** 세 함수는 `styleElements`가 비었을 때 `ctx.selector`로
  폴백하고 그 폴백이 곧 screenshot 요소 캡처(`ShotSelector`)의 DOM 행이다. `styleElements`가
  있는 분기만 새 표시 모델로 바꾸고 빈 분기는 그대로 둔다. 소비처 8곳
  (`buildMarkdownIssueBody:87`, `buildLinearIssueBody:70`, `buildSlackBody:49`,
  `buildAsanaIssueBody:53`, `buildClickupIssueBody:71`, `buildIssueMarkdown:250,345`,
  `buildIssueAdf:65`, `buildNotionIssueBody:128`)을 전수 갱신한다.
- before/after 업로드 파일명을 `before-${i}.webp`/`after-${i}.webp`(0-index,
  `buildIssueMarkdown.ts:157`)에서 `element-${i + 1}-before.webp` 형태로 바꿔 표시 번호와
  맞춘다. `submitToAsana.ts:105` webp→jpeg rename 경로도 함께 확인한다.
- Markdown/HTML 메타의 `elements[]`에도 locator를 넣되, top-level 레거시 selector 필드는
  유지한다.

### `src/sidepanel/lib/elementLocatorFormat.ts` (신규)

- 최종 `StyleElementContext[]`를 입력으로 DOM 요약 항목과 Style changes 제목/selector 행을
  만드는 순수 함수.
- 요소가 2개 이상일 때만 `number`를 채우고 1개면 `undefined`로 둔다.
- index는 호출 시점 배열 순서에서 `index + 1`로만 계산한다.
- anchor가 없으면 selector의 **마지막 compound 1~2개**를 보조 단서로 노출한다
  (`div › .card-body:nth-of-type(3)`). 구버전 locator 없음 → `tagName`, tag도 없음 →
  `selector`의 마지막 compound, 파싱 실패 시 `element`로 폴백한다.

### 플랫폼 본문 빌더 (수정)

- Markdown 계열 단일 출처: `buildIssueMarkdown.ts`, `buildMarkdownIssueBody.ts`를 통해
  GitHub·GitLab·Linear·Asana·ClickUp·Slack과 클립보드 Markdown/HTML에 반영.
- 구조화 포맷: `buildIssueAdf.ts`(Jira), `buildNotionIssueBody.ts`(Notion)는 각 플랫폼의
  list/rich-text 노드로 같은 DOM 항목을 렌더.
- 각 Style changes heading은 `Style changes — Element N · <anchor> › <tag>`
  (단일이면 `Style changes — <anchor> › <tag>`), 다음 paragraph/list item은
  `Selector: <code>…</code>`로 렌더한다. **전체 selector는 제목에서 제거하되 앵커 요약은
  제목에 남긴다** — 제목만 읽고 어느 요소인지 알 수 있어야 하고, 앵커는 짧아서 긴 제목을
  만들지 않는다.
- AI 프롬프트(`prompts/draftRich.ts:118`, `draftCompact.ts:70`)가 이미 `${index + 1}. <tag>
  at ${selector}`를 독립적으로 찍고 있다. 같은 `StyleElementContext[]`에서 파생하도록 묶어
  본문 번호와 갈리지 않게 한다(POSTMORTEM 2026-07-27 재발 방지).

### 미리보기·저장 초안·리포트 UI (수정)

DOM 행 생산자는 4곳, 실제 렌더러는 1곳이다. 넷 다 새 표시 모델을 쓴다.

| 위치 | 역할 |
|---|---|
| `sidepanel/lib/environmentRows.ts:34` `deriveReadonlyEnvRows()` | DraftingPanel의 DOM 행 단일 출처 |
| `sidepanel/tabs/PreviewPanel.tsx:142` | 미리보기 DOM 행 |
| `sidepanel/tabs/DraftDetailDialog.tsx:1221` | 저장 초안 상세 DOM 행 |
| `sidepanel/lib/buildReportData.ts:18` | logs.html 리포트의 `envRows` |
| `sidepanel/components/IssuePreviewView.tsx:113` (`data-testid="env-row"`) | 위 행들의 공용 렌더러 |

- `IssuePreviewView`는 `log-viewer/App.tsx:196`이 재사용하고
  `log-viewer/__tests__/i18n.test.ts:144`가 그 파일의 키를 두 사전과 대조하므로, 여기에
  새 i18n 키를 넣으면 복제 사전까지 파급된다(아래 i18n 절).
- 기존 `{label, value: string}` 행에 개행 문자열을 밀어 넣지 않고 DOM 전용 structured row를
  만든다. 목록은 `list-decimal`을 쓰지 않는다 — `Element N` 라벨 자체가 번호 역할을 하므로
  `list-none pl-0`으로 두어 이중 번호(`1. Element 1`)와 `pl-5` 들여쓰기 낭비를 없앤다.
  단일 요소면 라벨 없이 앵커 요약 한 줄만 낸다.
- Selector 행은 `className="font-mono text-mono break-all"`로 렌더한다. `--mono-size`(13px)는
  `.doc-section-body code`처럼 스코프된 CSS에서만 적용되므로 맨 `<code>`는 14px을 상속해
  DESIGN.md §4의 mono 13px 불변식을 깬다. `overflow-wrap: anywhere`는 저장소 사용처가
  0건이고 기계 문자열의 정착 패턴은 `break-all`(11곳)이다. 별도 복사 버튼은 추가하지 않는다.
- iframe origin은 Badge가 아니라 **인라인 muted 텍스트**(`· pay.example`)로 낸다. 유일
  선례인 `StyleChangesDialog.tsx:249`의 `<Badge title={origin}>`은 `<span>` 렌더라 포커스
  불가여서 키보드로 전체 origin에 도달할 수 없고, PreviewPanel·DraftDetailDialog에는 Badge
  import 자체가 없다. host는 대개 짧아 truncate·tooltip이 필요 없다. opaque/빈 origin은
  localized unknown을 쓴다.
- Style changes React key는 공용 `selector+frameId` element key를 사용한다.
- 폭 하한은 400px이 아니라 **320px**(`globals.css:78`의 `html, body { min-width: 320px }`)로
  검증한다.
- `src/sidepanel/lib/resolveDraftStyleElements.ts`가 저장 locator/origin을 라이브
  `StyleElementContext`로 복원한다.
- `mergeStyleElements`와 "동일 판정" 파리티를 선언한 3파일(`styleChangeGroups.ts:67`,
  `diffAnnotation.ts:23`, `prompts/draftStyleElements.ts:87`)을 함께 확인한다.

### i18n (수정)

- 이슈 본문 라벨(`md.*`)은 `src/i18n/namespaces/logs.ts`(ko L95, en L225 부근)에 있고
  UI 계열 라벨은 `issue.ts` 네임스페이스에 있다. `Element`/`Selector` 라벨은 본문·UI 양쪽에
  나오므로 각각 해당 네임스페이스에 추가한다.
- 현재 `DOM`·`Page`·`Browser`·`As is`·`To be` 같은 형제 라벨은 하드코딩 영문 리터럴이다
  (`buildIssueMarkdown.ts:244`, `environmentRows.ts:34`). 본문 출력의 `Element`/`Selector`도
  같은 규칙으로 하드코딩 영문을 쓰고, **로케일 키는 UI 표면(`issue.ts`)에만 추가**한다.
  ko 로케일에서도 이슈 본문의 `Element 1`은 영문 그대로다.
- `src/log-viewer/i18n.ts` 복제 사전은 **`IssuePreviewView`가 새 키를 실제로 참조하게 될
  때만** 갱신한다. 현재 그 파일은 i18n을 쓰지 않고 복제 사전에 `md.*` 키가 0건이며,
  `log-viewer/__tests__/i18n.test.ts`는 번들 import 그래프에서 `t("key")`로 참조된 키만
  요구하는 부분집합 검사다.

### 테스트 인프라 (수정)

- **`src/test/setup-dom.ts`에 `CSS.escape` 폴리필을 추가한다.** finder는 `CSS.escape`를
  무조건 호출하는데 jsdom 29에는 `window.CSS` 전역 자체가 없어, 폴리필 없이는
  `element-locator.test.tsx`가 첫 finder 호출에서 `ReferenceError`로 죽는다. 기존 테스트가
  `dom-describe.ts`를 한 번도 태우지 않아 아직 아무도 밟지 않은 지뢰다.
- 폴리필은 Chrome 실동작과 다르므로(POSTMORTEM 2026-08-03의 CSSOM 직렬화 사고와 같은
  성질) 특수문자 escaping 검증은 "jsdom 폴리필 기준"임을 명시하고 실제 escaping은
  e2e·수동으로 확인한다.

### 문서 (구현 후 수정)

- `docs/ARCHITECTURE.md`: selector 생성 우선순위, 실행 selector/표시 locator 역할 분리,
  복수 요소 번호 파생, iframe scope를 기록.
- `docs/DIRECTORY.md`: 신규 `element-locator.ts`·`elementLocatorFormat.ts` 역할 추가.
- `docs/privacy.ko.md`·`docs/privacy.en.md`: **새로 나가는 건 iframe origin host다.**
  조상 test attribute 값은 finder 기본 `data-*` 허용으로 오늘도 selector에 실려 나가고
  `privacy.ko.md` L42가 "요소를 고른 경우 그 요소의 CSS selector"로 이미 공개하고 있다.
  반면 origin은 지금까지 `IssueBufferedElement.origin?`에 저장만 되고 인앱 Badge에만
  쓰였을 뿐 이슈 본문·제출 페이로드에 실린 적이 없다. ko 원본·en 번역 본문과 시행일을
  반드시 함께 갱신한다.
- `guide/ko/element/issue.md`·`guide/en/element/issue.md`: 복수 요소 DOM 번호 목록과 각
  Style changes의 selector 위치를 설명한다.

## 데이터 흐름

```text
사용자 요소 선택 (해당 frame document)
  → collectSelection에서 buildElementLocator(element)
      ├─ WeakMap 캐시 hit이면 즉시 반환 (postSelectionUpdate 재호출 경로)
      ├─ stage 1 stable / stage 2 compat, 각각 try/catch
      ├─ (positional, stage, length) 비교
      └─ 예산 소진·전부 실패 시 pathSelector fallback
  → picker.selected { payload.locator, selector=locator.selector }
  → EditorSelection.locator
      ├─ 현재 요소 → IssueRecord.locator? + IssueRecord.origin?
      └─ bufferCurrentElement → BufferedElement.locator
                              → IssueBufferedElement.locator?
  → mergeStyleElements(buffered, current)
  → StyleElementContext[]                  // 최종 순서 단일 출처
  → formatElementLocators(elements)        // N>1일 때만 번호 부여
      ├─ DOM: [Element N ·] anchor › tag [· frame origin host]
      └─ Style changes — [Element N ·] anchor › tag
          Selector: full unique CSS selector
  → 미리보기 / 클립보드 / 8개 플랫폼 / 저장 초안 상세 / logs.html / AI 프롬프트
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
}

export interface PickerSelectionPayload {
  selector: string; // locator.selector와 동일 — 기존 소비처 호환
  locator: ElementLocator;
  // ...기존 필드
}

export interface ElementLocatorDisplay {
  // 요소가 1개면 undefined. 2개 이상일 때만 1..N.
  number?: number;
  summaryParts: string[]; // anchor? | 마지막 compound?, targetTag, frame origin host?
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

`usesPosition`은 영속 타입에 넣지 않는다 — 표시하지 않고 테스트 진단에만 쓰는 값이라
`buildElementLocator` 내부 비교용 로컬로 충분하다. `ElementLocatorDisplay.label`도
`number`에서 파생 가능해 두지 않는다.

origin은 content payload에서 받지 않는다. 기존 보안 경계대로 `usePickerMessages`가
`sender.frameId`·`sender.origin`에서 얻어 `EditorSelection.origin`에 합치고, 저장 시
`IssueRecord.origin?`과 `IssueBufferedElement.origin?`에 대칭으로 보존한다. `frameId === 0`이면
표시하지 않는다.

## selector 후보 및 비교

### 2단계 실행

동일한 finder를 두 가지 훅 구성으로 실행한다. wall-clock deadline은 호출 시작부터 500ms
하나를 공유하고, `maxNumberOfPathChecks`는 1000/1000으로 나눠 합계가 현행 2000을 넘지
않게 한다. 각 단계 `timeoutMs`에는 deadline까지 남은 시간을 넣는다. **남은 시간이 0
이하이면 finder를 아예 호출하지 않는다** — `timeoutMs: 0`을 넘기면 finder는 중단이 아니라
첫 후보에서 곧장 위치 체인 fallback을 반환하기 때문이다.

1. **stable**: `attr`은 신뢰 test attribute allowlist(아래) + finder 기본 semantic
   (`role`, `name`, `aria-label`, `rel`, `href`)에 `for`를 더한 목록만 허용.
   `idName`은 동적 값 거부 휴리스틱 통과분만. `className`은 동적·해시 거부 + **선택
   요소가 가진 class 이름 전역 거부**.
2. **compat**: finder 현행 기본 필터. 기존 사이트 호환과 후보 부재 방어.

> **finder 훅의 한계**: `className: (name: string) => boolean`, `attr: (name, value) => boolean`
> 시그니처에 **element 인자가 없다.** `tie()`가 조상과 타깃을 순회하며 같은 술어를
> 호출하므로 훅 안에서 "이 class가 타깃 것인가"를 알 방법이 없다. 따라서 "조상 class는
> 허용, 선택 요소 class만 제외"는 구현 불가이고, 호출 전 `new Set(el.classList)`를
> 클로저에 잡아 **이름 기준으로 전역 거부**하는 근사만 가능하다. 조상이 같은 이름의
> class를 쓰면 함께 배제되며(디자인 시스템에서 흔하다), 그 손실은 compat 단계가 보전한다.

각 단계는 **개별 try/catch**로 감싼다. finder는 예산 초과 시 `fallback()`(순수
`nth-of-type` 체인)을 시도하고 그것도 유일하지 않으면 `Error("Timeout: …")`를 던진다.
`maxNumberOfPathChecks` 초과도 같은 분기·같은 메시지다. 별도로 `unique()`는
`querySelectorAll(...).length === 0`이면 `Error("Can't select any node with this selector")`를
던진다(detached/shadow). stable 단계의 throw가 compat 단계를 낙태시키면 안 된다.

### 신뢰 test attribute

다음 exact name만 `test-attribute`로 분류한다. 이 중 `data-e2e`·`data-cy`·`data-qa`·
`data-pw`·`data-test-id`·`data-automation-id` 6개는 finder 기본 `wordLike` 게이트에
막혀 있어, **stable 단계의 `attr` 훅이 이 allowlist를 명시적으로 통과시켜야 후보로
생성된다**.

```text
data-testid, data-test-id, data-test, data-e2e,
data-cy, data-qa, data-automation-id, data-pw
```

값은 비어 있지 않고 100자 이하여야 하며 제어문자를 포함하지 않고 아래 동적 값 거부
휴리스틱도 통과해야 한다. `data-testid="user-550e8400-e29b-41d4-a716-446655440000"`처럼
이름만 test contract이고 값은 런타임 식별자인 후보를 승격하지 않는다. 속성명 패턴을
넓혀 모든 `data-*`를 승격하지 않는다. 임의 `data-*`는 compat 단계 후보에는 남을 수
있지만 안정 anchor 요약에는 사용하지 않는다.

### 동적 값 거부 휴리스틱

test attribute를 포함한 ID·class·attribute 값에 다음 중 하나가 맞으면 stable 단계에서
제외한다. compat 단계 사용은 허용한다.

- UUID 전체 형태, 10자리 이상 숫자열, epoch-like 숫자
- 8자 이상 연속 hex 또는 base64-like 무구분 문자열
- `:r<number>:` 등 React `useId`, `__id_<number>`, `ember<number>`, `mui-<number>` 형태
- `data-reactid` 등 프레임워크 내부 attribute name
- `data-index`, `data-row-index`, `data-position`, 상태를 나타내는 `data-selected`,
  `data-expanded`, `data-loading`
- class 끝의 6자 이상 hash suffix(`Component_ab12cd34` 등). 단 사람이 명시한 BEM/semantic
  class를 과도하게 배제하지 않도록 전체 class가 일반 단어·하이픈 조합이면 허용한다.

휴리스틱은 안정성을 증명하지 않는다. false positive보다 false negative를 택한다. 즉
의심 후보를 stable 단계에서 빼더라도 compat과 위치 fallback으로 실행 가능성은 보존한다.

### 후보 비교

두 단계 출력과 `pathSelector`를 후보 목록에 넣되 중복 문자열은 제거하고, 다음 tuple로
오름차순 비교한다.

```typescript
type SelectorScore = readonly [
  positional: 0 | 1,   // :nth-child( 또는 :nth-of-type( 포함 여부
  stage: 0 | 1,        // 0 = stable, 1 = compat
  length: number,
];
```

`nth-child`는 훅과 무관하게 finder가 항상 push하므로 stable 단계도 위치 후보를 낼 수
있다. 위치 사용 여부를 첫 키로 두면 "안정적이고 비위치적인 후보를 모두 소진한 뒤
`nth-*`를 쓴다"가 자연히 성립한다. 그 밖의 정렬은 finder가 이미 누적 penalty
오름차순으로 처리한다 — 사람이 risk tier·base tier·unstable token count를 다시 매길 필요가
없다.

PRD 예시 DOM 검증: `.text-semantic-informative-primary-low`는 타깃 자신의 class라 stable
단계에서 거부되고, `[data-e2e="enrollment-card"] span`(penalty 2+5=7)이
`article:nth-of-type(1) span`(10+5=15)을 이긴다. 정렬은 finder가 한다.

**유일성 hard gate는 `pathSelector` 후보에만 적용한다.** finder는 반환 전에 이미
`unique()`로 `querySelectorAll(...).length === 1`을 통과시키고 `optimize()`가 추가로
`querySelector(...) === input`까지 본다. 동기 코드라 그 사이 DOM 변이도 없다. finder
출력을 다시 `querySelectorAll`로 검증하는 건 큰 DOM에서 무시할 수 없는 순수 낭비다.
절대 매치 개수·DOM 비율 임계값은 쓰지 않고, 앵커 자체의 전역 match count는 반복을
허용하므로 selector 탈락 사유가 아니라 `anchor` 설명 정보로만 쓴다.

### 결정성

selector 문자열은 `sameElementKey(selector, frameId)`의 동등성 키다. 시간 예산 소진 여부에
따라 결과가 달라지면 같은 요소가 버퍼에 두 번 쌓이고 이전 편집이 소실된다. 그래서:

- 중간 단계에서 예산이 끊기면 **부분 결과를 채택하지 않고 항상 `pathSelector`로
  수렴**한다. `pathSelector`는 시간 예산과 무관한 순수 경로 계산이라 결정적이다.
- 같은 요소에 대한 반복 호출은 WeakMap 메모이즈로 첫 결과를 재사용한다.

### 표시 anchor 선정

표시 `anchor`는 target을 포함한 조상 12단계에서 별도로 고른다. 동적 값 휴리스틱을
통과한 test attribute가 있으면 target과 가장 가까운 것을, 없으면 안정 ID 중 가장 가까운
것을 쓴다. 따라서 반복 test attribute도 컴포넌트 grep 단서로 남을 수 있지만 selector
유일성에는 영향을 주지 않는다. class·semantic/임의 attribute는 compact DOM 요약의
anchor로 승격하지 않는다. anchor가 하나도 없으면 selector의 마지막 compound를 보조
단서로 쓴다.

### 비용 상한

- 조상 탐색 최대 12단계. 초과 조상은 selector 생성 finder가 필요할 때 탐색할 수 있지만
  표시 anchor 탐색에서는 제외한다.
- selector 후보 최대 2개 + 최종 path fallback 1개.
- `document.querySelectorAll` 추가 호출은 `pathSelector` 후보 검증 1회뿐.
- class별 `querySelectorAll` 반복이나 DOM 전체 대비 비율 계산은 하지 않는다.
- 전체 finder 예산은 기존 500ms/2000 path check를 넘기지 않는 것을 목표로 하되,
  **정밀 보증이 아니라 상한 근사**다. `optimize()` 단계의 쿼리는 `maxNumberOfPathChecks`
  카운터에 잡히지 않고 `timeoutMs`로만 묶이며, 시간은 후보 사이에서만 샘플링되므로 느린
  단일 쿼리 하나가 예산을 초과할 수 있다. 검증 가능한 계약은 **"예산 소진이 감지되면
  후속 단계를 호출하지 않는다"**이고 성공 기준·태스크 검증도 그 문장을 쓴다.
- 이 예산은 `collectSelection`의 선택 요소 1개, 선택 1회당 한 번만 적용한다.
  `postSelectionUpdate` 보강은 메모이즈를 재사용한다. DOM Tree의 ancestor·형제·lazy child
  selector는 기존 단일 finder 경량 경로를 유지한다.

## 본문 출력 계약

복수 요소 N개를 한 줄에 쉼표로 잇지 않고 `DOM` key 아래 중첩 목록/개행으로 출력한다.
플랫폼이 중첩 목록을 지원하지 않으면 한 bullet 안에서 `<br>` 또는 개별 bullet로
동등하게 표현한다.

**복수 요소**

```markdown
- **DOM**:
  - **Element 1** · `[data-e2e="enrollment-card"]` › `span`
  - **Element 2** · `#checkout` › `button` · `pay.example`

## Style changes — Element 1 · `[data-e2e="enrollment-card"]` › `span`

- **Selector**: `[data-e2e="enrollment-card"] span`

| Property | As is | To be |
```

**단일 요소** — 번호를 붙이지 않는다.

```markdown
- **DOM**: `[data-e2e="enrollment-card"]` › `span`

## Style changes — `[data-e2e="enrollment-card"]` › `span`

- **Selector**: `[data-e2e="enrollment-card"] span`
```

- text/accessibility name은 출력하지 않는다.
- anchor가 없으면 tag + selector 마지막 compound를 쓴다.
- iframe origin host는 non-top element의 DOM 항목에만 출력한다. Style changes 제목에는
  origin을 반복하지 않는다 — 번호(복수) 또는 앵커 요약(단일)이 DOM 목록으로 연결하기
  때문이며, 이 규칙은 요소 카드마다 origin Badge를 다는 styling 단계
  `StyleChangesDialog`와 의도적으로 다르다.
- 전체 selector는 각 Style changes 섹션에 정확히 한 번만 출력한다.
- 전체 selector를 heading에 넣지 않는다(Jira/Notion heading 비대 방지). 대신 짧은 앵커
  요약은 heading에 남겨 제목의 자기완결성을 유지한다.
- before/after 첨부 파일명은 `element-1-before.webp` 형태로 표시 번호와 맞추고, alt
  텍스트에도 요소 번호를 넣는다(요소 3개 이슈에서 동일 alt 6개가 연속되는 문제 해소).
- screenshot의 요소 캡처(`ShotSelector`)는 복수 Style changes가 없으므로 기존 단일 DOM
  selector 표시를 유지한다. 이번 목록은 `styleElements`가 있는 element 스타일 편집
  모드에만 적용한다.

## 기존 패턴 준수

- 신규 판정은 `element-locator.ts` 순수 helper + jsdom 통합 테스트로 분리한다.
  jsdom 실행에는 `CSS.escape` 폴리필이 선행 조건이다.
- `picker.ts`는 coverage 로직 스코프 제외이므로 후보 분류·비교·format 판정을 그 안에
  두지 않는다.
- 복수 요소 출력은 `mergeStyleElements` 결과를 단일 출처로 사용한다. POSTMORTEM
  2026-07-27의 "최종 본문과 AI 경로가 다른 모델을 소비"한 회귀를 반복하지 않도록 AI
  meta와 AI 프롬프트도 같은 `StyleElementContext[]`에서 만든다.
- frame 동등성은 `sameElementKey(selector, frameId)`를 유지한다. origin과 표시 번호를
  dedup 키로 쓰지 않는다.
- 새 i18n 키는 ko/en을 함께 수정하고 직접 대칭 테스트를 실행한다. log-viewer 복제 사전은
  `IssuePreviewView`가 그 키를 참조하게 될 때만 갱신한다.
- 가이드는 `guide/AUTHORING.md`를 따르고 ko 원본·en 번역을 함께 수정한다.
- 새 권한·스토리지 종류·외부 fetch·서버가 없다. 기존 클라이언트 온리 경계를 유지한다.

## 대안 검토

1. **finder를 `unique-selector`·`optimal-select`·DevTools DOMPath로 교체** — 기각. 모두
   현재 DOM 유일성/경로 최적화가 주목적이며 BugShot이 필요한 "test contract 우선,
   사람용 compact 요약, 복수 요소 번호 연결"을 해결하지 않는다. 이미 설치된 finder의
   allow hook을 활용하는 변경이 작다.
2. **4단계 실행 + 6요소 `SelectorScore` 사전식 비교** — 기각(초안에서 철회). risk tier가
   이미 base 안정성과 위치 사용 여부를 인코딩해 6필드 중 3개가 자기 파티션 안에서 상수가
   되고, 단계 인덱스가 곧 risk tier였다. 무엇보다 finder가 누적 penalty 오름차순으로
   유일한 첫 후보를 반환하므로 사람이 다시 정렬할 이유는 "test attribute(2)가 class(1)에
   진다" 하나뿐이다. 그건 훅 필터 한 겹과 2필드 비교로 해결된다.
3. **`attr` predicate만 열고 1회 실행** — 부분 채택. 실제로 헤드라인 예시는 이것만으로
   풀린다. 다만 동적 ID·해시 class 거부와 타깃 class 배제가 빠져 PRD 목표 2를 만족하지
   못하고, 필터가 후보를 0개로 만드는 사이트에서 방어가 없다. 그래서 stable 1단계 +
   compat 1단계 구성으로 최소 확장한다.
4. **모든 `data-*`를 ID보다 우선** — 기각. 상태, 인덱스, React 내부값, 사용자/세션
   식별자가 섞인다. exact test attribute만 최고 신뢰로 분류한다.
5. **전역 match count가 적은 class에 연속 가중치 부여** — 기각. 현재 희소성은 재빌드
   안정성과 무관하고, 큰 DOM에서 비율은 희석된다. 완성 selector의 유일성만 hard gate로
   쓰고 안정성은 token 의미/형태로 판정한다.
6. **설명용 비유일 selector로 기존 `selector` 교체** — 기각. 현재 필드는 DOM Tree 이동,
   재바인딩, 편집 적용, 캡처, 버퍼 dedup의 실행 키다. 별도 locator metadata가 필요하다.
7. **조상 체인·속성 snapshot·text를 전부 본문에 표시** — 기각. 복수 요소에서 과밀하고
   text/임의 속성은 개인정보·동적 값 위험이 있다. 사용자 결정대로 앵커+태그만 요약하고
   전체 selector는 해당 Style changes 아래에 둔다.
8. **Element 번호를 UUID로 영속화** — 기각. 번호는 최종 출력 순서를 설명하는 UI 참조다.
   삭제·dedup 후 재번호가 자연스럽고 별도 ID 마이그레이션이 불필요하다.
9. **단일 요소에도 `Element 1`을 붙여 규칙을 단순화** — 기각. 단일 요소가 압도적 다수인데
   번호가 정보를 늘리지 않고, 제목이 `Style changes — Element 1`이 되면 현행
   `Style changes (selector)`보다 식별 정보가 오히려 줄어든다.

## 위험 요소

- **안정성 오판**: 단일 DOM snapshot으로 장기 안정성을 증명할 수 없다. 의심 token은
  stable 단계에서 제외하되 compat fallback으로 실행 가능성을 유지한다.
- **selector 비결정성**: 예산 소진 여부로 결과가 갈리면 `sameElementKey` 동등성이 깨져
  버퍼 중복·편집 소실이 생긴다. 예산 소진 시 항상 `pathSelector`로 수렴하고 요소별
  메모이즈로 반복 호출을 고정한다.
- **`postSelectionUpdate` 무음 드랍**: `emitSelected`만 새 빌더로 바꾸면 cross-origin 스타일
  보강이 stale 가드에 걸려 100% 드랍된다. 반대로 양쪽 다 재계산하면 선택 1회당 finder가
  최대 3회 돈다. 메모이즈로 둘 다 막는다.
- **finder 훅의 소유자 구분 불가**: 타깃 class 제외가 이름 기준 전역 거부로만 가능해
  조상의 동명 class도 함께 빠진다. compat 단계가 보전한다.
- **반복 test hook**: `data-e2e="enrollment-card"`가 모든 카드에 반복될 수 있다. anchor는
  설명 정보일 뿐이며 완성 selector 유일성 gate를 절대 생략하지 않는다.
- **finder throw**: 예산 초과·detached는 중단이 아니라 예외다. 단계별 개별 try/catch가
  없으면 stable 단계의 throw가 compat 단계를 낙태시킨다.
- **jsdom `CSS.escape` 부재**: 폴리필 없이는 finder를 쓰는 테스트가 전부 죽는다. 폴리필은
  Chrome 실동작과 다르므로 escaping 검증의 최종 그물은 e2e·수동이다.
- **유일성 scope 오류**: iframe selector를 top document에서 검사하면 항상 실패하거나
  같은 selector를 잘못 합친다. content script가 실행 중인 자기 document에서 검증하고
  sidepanel은 sender frame 정보를 보강한다.
- **escaping**: ID/class/attribute name/value는 반드시 `CSS.escape`를 거친다. 사람이 읽는
  anchor도 실행 가능한 compound를 그대로 재사용해 별도 escaping 경로를 만들지 않는다.
- **저장 초안 누락**: locator를 라이브 타입에만 추가하면 저장 후 selector 나열로 회귀한다.
  current·buffered 양쪽 IssueRecord 경로와 `resolveDraftStyleElements` 테스트가 필요하다.
  current iframe origin은 `IssueRecord.origin?`에서 복원한다.
- **조건부 스프레드**: `saveDraft` 병합에서 optional 키를 조건부로 넣으면 "키 없음 = 기존
  값 유지"로 뒤집혀 지운 값이 되살아난다(POSTMORTEM 2026-07-26 A-11). 항상 키를 쓰고
  `?? undefined`로 명시한다.
- **복수 소비처 드리프트**: Markdown만 고치면 Jira ADF·Notion·Slack·초안 상세·logs.html이
  갈린다. 공용 display model을 만들고 소비처 8곳 + 생산자 4곳 + 렌더러 1곳을 전수 갱신한다.
- **골든 스냅샷**: `bodyOutputGolden.test.ts.snap`(189KB / 58장)이 Markdown과 ADF를 같은
  파일에서 스냅샷한다. 본문 빌더 태스크를 병렬로 돌리면 `-u`가 서로를 덮는다. 갱신은
  단일 단계로 분리하고 diff를 줄 단위로 집계해 확인한다(POSTMORTEM 2026-08-06).
- **AI meta·프롬프트 회귀**: 사람이 보는 heading에서 전체 selector를 빼도
  `bugshot-meta-for-ai`의 기존 selector와 elements[]를 삭제하면 안 된다. 프롬프트가 독립
  파생하는 번호도 본문과 같은 배열에 묶는다.
- **개인정보**: 임의 속성·text를 별도 snapshot으로 저장하지 않는다. 새로 본문에 실리는
  건 iframe origin host이며 privacy ko/en에 수집·저장·전송을 명시한다.
- **편집으로 인한 selector 무효화**: 선택 요소가 가진 class 이름은 stable 후보에서
  제외한다. compat fallback에서 불가피하게 그 class를 쓴 경우만 기존 best-effort 세션
  만료로 남기고, class 삭제·교체 뒤 재바인딩·버퍼·캡처 경로를 회귀 테스트한다.
- **DOM 교체 race**: locator 생성 직전 `isConnected`를 확인하고 실패를 기존
  `selection-detached` 세션 만료 경로로 변환해 uncaught rejection을 막는다.
- **CSS 편집기 표시**: CSS CodeMirror 1행은 `selection.selector`를 사용한다. selector
  생성 결과가 바뀌어도 selector lock·parse 왕복 계약이 깨지지 않는지 확인한다.
