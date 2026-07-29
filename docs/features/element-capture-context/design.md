# Element 캡처 컨텍스트 확장 — 기술 설계

## 개요

캡처 rect를 결정하는 지점(`picker.ts`의 `handlePrepareCapture`)에 **확장 판정 단계**를 끼워 넣는다. 판정은 신뢰할 수 있는 시맨틱 신호로 조상 컨테이너를 찾고, 산술 게이트를 통과할 때만 그 rect를 쓴다. 하나라도 미달하면 현행 요소 bbox를 그대로 반환하므로 **폴백이 곧 현행 동작**이다.

**확장은 명시적 opt-in이다.** `captureElementSnapshot`의 `expandContext` 옵션이 기본 `false`이고, element mode의 before/after 경로만 이를 켠다. 요소 단일 캡처(`captureElementShot`)와 앞으로 추가될 호출부는 별도 조치 없이 현행 동작을 유지한다.

before 캡처가 확장에 성공하면 그 조상의 selector를 사이드패널이 보관하고, after 캡처 시 selector를 되돌려 보내 **같은 조상을 다시 측정·재검증**한다. 재조회한 조상이 현재 요소를 포함하고 게이트를 다시 통과할 때만 사용한다. 실패하면 ① 저장된 before rect 재사용(scroll·viewport가 모두 동일할 때만) ② 요소 bbox 폴백 순으로 강등한다.

before 캡처가 날아가는 동안에는 `[다음]`을 잠가 before/after가 서로 다른 판정을 쓰는 경쟁을 막는다. **캡처를 발행하지 않는 경로**(버퍼 재선택·`beforeImage` 존재·세션 rebind)는 이 잠금에 진입하지 않고, **캡처가 실패한 경우**에는 캡처 기준을 비우고 잠금을 해제해 before 없이 진행하는 현행 동작을 유지한다.

판정 로직은 jsdom 테스트가 가능하도록 `picker.ts`에서 별도 파일로 분리한다 — `frame-geometry.ts`·`annotation-draw.ts`와 같은 기존 분리 패턴. **after 재검증도 순수 함수로 뽑는다** — `picker.ts`는 유닛테스트 불가 파일(`scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT` 등재)이므로, DOM 조회·rect 측정만 남기고 판정은 전부 순수 함수로 넘겨야 테스트로 고정된다.

**적용 범위 제외 3곳** — 전부 P1(불확실하면 확장하지 않는다)에서 파생된다.

- **iframe 내부 요소**: 게이트가 iframe 자신의 `innerWidth/innerHeight` 기준이라 top 뷰포트에서의 완전 포함(G1)을 보장할 수 없다. `respondWithTopRect` 이후 남는 검사는 `rectIntersectsViewport`(교차만 요구)뿐이고 `clampCropRect`가 `Math.max(1, …)`로 잘린 조각도 유효 이미지로 만들므로, 확장 rect가 top에서 조용히 잘린 채 저장된다. G3(면적)도 마찬가지로 iframe 뷰포트 기준이라 세로로 긴 iframe에서는 무의미해진다.
- **`handlePrepareCaptureBySelector`(`StyleChangesDialog` 재캡처)**: 이 경로는 **live element 참조가 없다** — 요소도 selector로 재조회하므로, 행이 삽입·삭제돼 요소와 조상의 selector가 함께 밀리면 `contains()`가 통과하며 엉뚱한 행을 캡처한다. 게다가 `scrollIntoView({block:"center"})`가 요소만 화면 중앙에 두므로 조상은 G1을 거의 못 넘는다.
- **요소 단일 캡처(element-shot)**: opt-in 플래그를 켜지 않는다.

## 변경 범위

### 새 파일

**`src/content/capture-context.ts`** — 확장 판정. DOM 탐색부와 순수 판정부로 나뉜다.

jsdom은 `getBoundingClientRect()`가 항상 0을 반환하지만 `closest()`·`contains()`는 정상 동작한다. 그래서 **rect를 인자로 받는 순수 함수**로 게이트를 설계해야 양쪽 모두 테스트 가능하다. rect 측정 자체는 이 파일에 두지 않고 `picker.ts`의 `viewportRectOf`가 계속 맡는다.

**`src/content/__tests__/capture-context.test.tsx`** — jsdom. `findContextAncestor` DOM 탐색 + `resolveContextRect` 재검증.
**`src/content/__tests__/capture-context.test.ts`** — node. `passesContextGates` 산술.

### 수정 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/types/picker.ts` | picker 메시지·응답 타입 | `CaptureContext` 타입 정의, `PrepareCaptureResponse`에 `contextSelector` 추가, `picker.prepareCapture`에 요청 필드 추가 |
| `src/content/picker.ts` | content script 본체. `handlePrepareCapture`가 rect 결정(`:353`) | 확장 판정 호출 + `contextSelector` 재측정 분기. top frame 한정 |
| `src/sidepanel/capture.ts` | `captureVisibleTab` → 크롭(`:13`, `:36`) | `expandContext` 옵션, 반환 타입에 캡처 컨텍스트 동반, 0×0 폴백 처리 |
| `src/sidepanel/picker-control.ts` | `prepareCapture`(`:492`)·`prepareCaptureBySelector`(`:505`) 메시지 발신, `rebindStylingSession`(`:478`) | 시그니처에 `contextSelector`·`expandContext` 추가. rebind의 `bufferCurrentElement` 호출에 캡처 기준 동반 |
| `src/store/editor-store.ts` | 에디터 상태·버퍼(`:132~`, `:234`) | `captureContext` 상태 + `BufferedElement` 필드 + `patchBufferedElement` 화이트리스트 확장 + `EditorSnapshot` Pick 목록 |
| `src/store/issues-store.ts` | `IssueRecord`(`:180`)·`IssueBufferedElement`(`:166~`) 타입 정의처 | draft 영속화용 optional 필드 추가 |
| `src/sidepanel/hooks/useEditorSessionSync.ts` | 세션 스냅샷 저장·복원(`snapshotFromState()` `:67~`) | 스냅샷 필드 나열에 `captureContext` 추가 |
| `src/sidepanel/hooks/usePickerMessages.ts` | before 캡처 호출(`:143`), element-shot(`:329`) | 캡처 컨텍스트 저장 + in-flight 잠금. element-shot은 `.image` 언랩만 |
| `src/sidepanel/tabs/StyleEditorPanel.tsx` | after 캡처 호출(`:156`), `[다음]` 버튼 | 저장된 컨텍스트 전달 + 잠금 반영(스피너) |
| `src/sidepanel/hooks/useBufferThenSwitch.ts` | 버퍼 적재 시 after 캡처(`:22`) | 저장된 컨텍스트 전달 + 버퍼에 동반 저장 |
| `src/sidepanel/lib/styleChangeGroups.ts` | `ChangeGroup`(`:15~26`) 조립 | `captureContext` 필드 통과 |
| `src/sidepanel/tabs/styleEditor/StyleChangesDialog.tsx` | 행 초기화 후 재캡처(`:95`) | `expandContext`를 켜지 않는다(현행 유지). 반환 타입 변경만 흡수 |

**타입이 안 잡아주는 지점 4곳** — optional 필드·1-arg 호출이라 컴파일은 통과하고 런타임에서 조용히 기준이 사라진다. 반드시 명시적으로 손본다.

1. `picker-control.ts:478`의 `bufferCurrentElement(state.afterImage)` — 2번째 인자가 optional이라 그대로 통과한다. 세션 rebind마다 캡처 기준이 사라져 **before는 확장, after는 요소 bbox**로 갈린다.
2. `EditorSnapshot` Pick 목록(`editor-store.ts:269~302`)과 `snapshotFromState()`(`useEditorSessionSync.ts:67~102`) — `hydrate`가 `set(snapshot)` 한 줄이라 **없는 키는 조용히 초기값**이 된다.
3. `patchBufferedElement`(`editor-store.ts:238`)의 patch 타입이 `Partial<Pick<BufferedElement,"styleEdits"|"afterImage">>` 화이트리스트다.
4. `bufferCurrentElement` 재편집 병합(`editor-store.ts:~675`)이 `beforeImage`만 기존 값으로 유지한다. `captureContext`는 before와 짝이므로 **함께** 유지해야 한다.

## 데이터 흐름

```
[before 캡처]  ※ expandContext: true
usePickerMessages
  └─ (캡처를 실제로 발행할 때만) beforeCapturePending = true
  └─ captureElementSnapshot(tabId, { frameId, expandContext: true })
       └─ prepareCapture(tabId, frameId, { expandContext })   ← contextSelector 없음
            └─ picker.ts handlePrepareCapture()
                 ├─ iframe이면 확장 판정 생략 → { rect: elRect, contextSelector: null }
                 ├─ findContextAncestor(selectedEl)     → 조상 or null
                 ├─ passesContextGates(elRect, ctxRect, viewport)
                 └─ 통과 → { rect: ctxRect, contextSelector: buildSelector(조상) }
                    미달 → { rect: elRect,  contextSelector: null }
       └─ cropImage(dataUrl, rect, viewport, 24)
       └─ store.setCaptureContext({ contextSelector, rect, viewport, scrollX, scrollY })
  └─ finally: beforeCapturePending = false
     (실패 시 setCaptureContext(null) — 잠금은 똑같이 풀린다)

[after 캡처]  ※ expandContext: true
StyleEditorPanel.handleNext / useBufferThenSwitch
  └─ const ctx = getState().captureContext            ← await 전에 떠 둔다
  └─ captureElementSnapshot(tabId, { frameId, expandContext: true, context: ctx })
       └─ prepareCapture(tabId, frameId, { contextSelector: ctx.contextSelector ?? undefined })
            └─ picker.ts handlePrepareCapture(msg)
                 ├─ found = msg.contextSelector ? document.querySelector(...) : null
                 └─ resolveContextRect({ saved, found, target, ctxRect, elRect, viewport })
                      ├─ found가 target을 DOM 포함 + 게이트 통과 → 조상 rect
                      └─ 아니면 → 요소 rect + contextSelector: null
       └─ rect가 0×0 → scroll·viewport가 전부 동일할 때만 context.rect로 대체
                       (viewport는 항상 현재 prep.viewport를 쓴다 — 배율)

[element-shot / StyleChangesDialog 재캡처]  ※ expandContext 생략(false)
  └─ 확장 판정 자체가 돌지 않는다. 현행 경로 그대로.
```

## 인터페이스 설계

### `src/content/capture-context.ts`

```ts
import type { ViewportRect } from "@/types/picker";

// 확장 rect가 뷰포트 면적에서 차지할 수 있는 상한.
export const CONTEXT_MAX_VIEWPORT_RATIO = 0.4;

// 떠 있는 UI — 시맨틱 속성만으로 확정된다.
const OVERLAY_SELECTOR =
  'dialog,[popover],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';

// 일반 페이지의 강한 구조 단위. 후보여도 산술 게이트와 after 재검증을 거친다.
const STRUCTURE_SELECTOR =
  'tr,li,article,figure,' +
  '[role="row"],[role="listitem"],[role="tabpanel"],' +
  '[role="option"],[role="menuitem"],[role="treeitem"],[role="alert"],[role="status"]';

// 컨테이너 후보를 찾는다. 최근접 우선 — 모달 안 테이블 셀이면 다이얼로그가 아니라 <tr>.
// 요소 자신은 후보에서 제외한다(확장 실익 0).
export function findContextAncestor(el: Element): Element | null;

// 확장 허용 여부. 클램프하지 않는다.
export function passesContextGates(
  elementRect: ViewportRect,
  contextRect: ViewportRect,
  viewport: { width: number; height: number },
): boolean;

// after 재검증. DOM 조회·rect 측정은 호출부(picker.ts)가 하고 판정만 여기서 한다.
export function resolveContextRect(args: {
  saved: string | null;          // before에서 확정한 selector
  found: Element | null;         // document.querySelector(saved) 결과
  target: Element;               // 현재 선택 요소 (live 참조)
  contextRect: ViewportRect | null;  // found의 측정 rect
  elementRect: ViewportRect;
  viewport: { width: number; height: number };
}): { rect: ViewportRect; contextSelector: string | null };
```

`findContextAncestor`는 요소 자신을 제외하고
`el.parentElement?.closest(OVERLAY_SELECTOR + "," + STRUCTURE_SELECTOR)`로 가장 가까운
강한 시맨틱 조상만 반환한다. `form`·`fieldset`·광범위 landmark·`[role="group"]`와
`position:absolute|fixed + z-index` 휴리스틱은 개인정보 노출 면적과 오탐 위험 때문에
후보에서 제외한다. **computed style을 읽지 않는다** — 셀렉터 목록에 없는 태그·role은
그 자체로 후보가 아니다.

> `fieldset`은 초안에서 후보에 있었으나 구현 리뷰에서 뺐다. `form`을 제외한 근거가
> "개인정보 노출 면적"인데 `fieldset`은 **form의 한 섹션 통째**라 결제 카드번호·주소
> 입력 묶음을 그대로 캡처에 끌어들인다 — 같은 사유가 같은 강도로 적용된다. 전형적인
> 결제 fieldset(600×300 등)은 40% 면적 게이트를 여유롭게 통과해 게이트가 제동을 못 건다.
> 커버리지 손실은 P1이 명시한 수용 비용이다.

`resolveContextRect`는 `found`가 없거나 `found.contains(target)`이 false거나
`passesContextGates`가 false면 `{ rect: elementRect, contextSelector: null }`을 반환한다.
호출부가 `contains`를 못 쓰는 경우(by-selector 경로)는 아예 이 함수를 부르지 않는다.

`passesContextGates`는 **클램프하지 않는다.** 컨테이너가 뷰포트를 벗어나면 그 즉시 폴백이다.

클램프 방식(컨테이너를 뷰포트로 잘라 판정)을 쓰지 않는 이유는 둘이다. ① **잘린 컨테이너는 맥락이 불완전하다** — 1000px 컨테이너의 700px만 찍히면 상단이 날아가 "어느 것인지"를 못 보여주면서 이미지 비용은 다 치른다. ② **캡처 면적이 스크롤 픽셀마다 달라져 설명할 수 없다** — 같은 요소를 골라도 결과 크기가 연속적으로 흔들린다.

"컨테이너 전체를 보여줄 수 있을 때만 컨테이너를 보여준다"로 규칙을 좁히면 판정이 **확장/폴백 두 값**으로 떨어지고, 사용자가 눈으로 확인할 수 있는 규칙이 된다.

```ts
// 개념적 구현
const vpArea = viewport.width * viewport.height;
if (vpArea <= 0) return false;
// G1: 컨테이너가 뷰포트 안에 완전히 들어온다 (클램프 없음)
if (!withinViewport(contextRect, viewport)) return false;
// G2: 컨테이너가 요소를 완전히 포함한다.
//     요소 rect가 0×0(display:none·detach)이면 기하 포함 검사가 무의미하므로 생략하고,
//     호출부가 ancestor.contains(el)로 대체 검증한다.
const elHidden = elementRect.width === 0 && elementRect.height === 0;
if (!elHidden && !containsRect(contextRect, elementRect)) return false;
// G3: 면적 상한
return contextRect.width * contextRect.height <= vpArea * CONTEXT_MAX_VIEWPORT_RATIO;
```

G1이 들어오면서 확장 대상은 **화면에 온전히 들어오고 화면의 40% 이하인 컨테이너**로 좁혀진다. 뷰포트보다 큰 컨테이너(긴 목록 항목·긴 `article`·모바일 뷰의 세로 긴 다이얼로그)는 면적과 무관하게 전부 폴백이다.

### `src/types/picker.ts`

`CaptureContext`는 content 응답·sidepanel·editor-store·issues-store 4개 레이어가 공유하는 **영속 데이터 모델**이므로 `ViewportRect`가 이미 있는 이 파일에 둔다(`store/`가 `sidepanel/`에서 영속 모델을 가져오는 선례가 없다).

```ts
// before에서 확정한 캡처 기준. after가 같은 대상을 다시 측정하는 데 쓴다.
export interface CaptureContext {
  // 확장 성공 시 조상 selector. null이면 폴백 경로.
  contextSelector: string | null;
  // 폴백 경로에서 요소 rect가 0×0이 됐을 때 재사용할 before 시점 rect.
  rect: ViewportRect;
  viewport: { width: number; height: number };
  // before 시점의 스크롤. 0×0 폴백에서 좌표 신뢰 여부를 판정한다.
  scrollX: number;
  scrollY: number;
}

export interface PrepareCaptureResponse {
  rect: ViewportRect | null;
  viewport: { width: number; height: number };
  scrollX: number;
  scrollY: number;
  // 확장이 적용됐으면 그 조상의 selector. null이면 폴백(요소 bbox) 경로.
  // 구버전 응답엔 없다 — 소비 시점 ?? null 폴백.
  contextSelector?: string | null;
}

// PickerMessage 유니온 — 이 유니온에 `| null` 필드 선례가 없으므로
// 호출부에서 `ctx.contextSelector ?? undefined`로 변환해 싣는다.
| { type: "picker.prepareCapture"; expandContext?: boolean; contextSelector?: string }
| {
    type: "picker.prepareCaptureBySelector";
    selector: string;
    // 이 경로는 확장을 적용하지 않으므로 확장 관련 필드가 없다.
  }
```

`respondWithTopRect`(`picker.ts:325~346`)의 반환 4경로 중 **pass-through는 `!prep.rect` 하나뿐이고 나머지 3개(확장 성공 경로 `:345` 포함)는 `{rect, viewport}` 객체를 새로 조립한다**(spread 없음). iframe에서 확장을 끄더라도 `scrollX/scrollY`는 실어야 하므로 이 조립 지점들을 명시적으로 손봐야 한다.

### `src/sidepanel/capture.ts`

```ts
export interface CaptureResult {
  image: string;
  context: CaptureContext;
}

export async function captureElementSnapshot(
  tabId: number,
  options?: {
    margin?: number;
    frameId?: number;
    // 확장 판정 opt-in. 기본 false — element mode before/after만 켠다.
    expandContext?: boolean;
    context?: CaptureContext;
  },
): Promise<CaptureResult | null>;

export async function captureElementSnapshotBySelector(
  tabId: number,
  selector: string,
  options?: { margin?: number; frameId?: number },
): Promise<CaptureResult | null>;
```

반환 타입이 `string | null` → `CaptureResult | null`로 바뀐다. 호출부는 5곳(4개 파일)이고 스코프 밖인 `captureElementShot`은 `.image`만 꺼내 쓴다.

`captureWithPrep` 안의 0×0 폴백:

```ts
// 폴백 경로에서 요소가 display:none이면 rect가 0 — before rect로 대체한다.
// 단 scroll·viewport가 전부 같을 때만. 하나라도 다르면 좌표를 신뢰할 수 없으므로
// 잘못된 영역을 찍는 대신 이미지 없음으로 간다.
const ctx = options.context;
const trustable =
  ctx != null &&
  ctx.viewport.width === prep.viewport.width &&
  ctx.viewport.height === prep.viewport.height &&
  ctx.scrollX === prep.scrollX &&
  ctx.scrollY === prep.scrollY;

const usable =
  prep.rect.width > 0 && prep.rect.height > 0
    ? prep.rect
    : trustable
      ? ctx.rect
      : null;
```

**viewport는 항상 현재 `prep.viewport`를 쓴다.** `cropImage`의 `scale = img.naturalWidth / viewport.width`에서 `img`는 지금 찍은 캡처이므로, 배율은 반드시 현재 뷰포트로 유도해야 한다. `ctx.viewport`를 쓰면 그 차이만큼 배율이 어긋난다. (`cropImage`는 `devicePixelRatio`를 쓰지 않는다 — `capture.ts:60~61` 주석 참조.)

`usable`이 null이면 기존 실패 경로(`endCapture` 후 null 반환)를 그대로 탄다.

### `src/store/editor-store.ts`

```ts
interface EditorState {
  // ...
  // 현재 선택 요소의 캡처 기준. before 캡처가 확정하고 after가 재사용한다.
  captureContext: CaptureContext | null;
}

export interface BufferedElement {
  // ...
  // 버퍼 적재 시점의 캡처 기준.
  // 구버전 스냅샷엔 없다 — 소비 시점 ?? null 폴백.
  captureContext?: CaptureContext;
}

// 액션
setCaptureContext: (context: CaptureContext | null) => void;
// 기존 bufferCurrentElement(afterImage) 시그니처 확장
bufferCurrentElement: (afterImage: string | null, context?: CaptureContext) => void;
```

`captureContext`는 새 요소 선택·전체 reset에서 초기화한다. `backToStyling`은 before 이미지를
유지하므로 context도 유지한다. 버퍼 승격 경로에서는 `beforeImage`·`afterImage`와 함께
복원한다. 버퍼에는 after 재측정 결과가 아니라 **before에서 확정한 context**를 저장한다.

**`EditorSnapshot` Pick 목록과 `snapshotFromState()`에 반드시 추가한다.** 빠뜨리면 패널을 닫았다 여는 순간 기준이 사라지는데, `hydrate`가 `set(snapshot)` 한 줄이라 타입 에러도 런타임 에러도 나지 않는다. `toLiteSnapshot`은 스프레드 기반이라 자동 보존된다 — 이미지가 날아간 lite 스냅샷에서도 기준은 살아남는 것이 의도다.

`IssueRecord`(`issues-store.ts:180`)의 현재 요소와 `IssueBufferedElement`(`:166~`)에도 `captureContext?`를 추가해 draft 저장·복원 후 재캡처가 같은 기준을 쓸 수 있게 한다. 비파괴 optional 필드이므로 persist 버전 bump는 하지 않으며 레거시 draft는 `undefined`를 현행 폴백으로 읽는다(`issues-store.ts:212~217`의 `logsAttached?`·`attachments?` 선례와 동일).

### `[다음]` 잠금

별도 상태 머신을 만들지 않는다. **before 캡처가 실제로 날아가는 동안만 true인 in-flight 플래그** 하나로 충분하다 — 필요한 불변식은 "before 캡처 중에 after를 찍지 않는다"뿐이고, 캡처를 발행하지 않는 경로는 애초에 플래그를 세우지 않으므로 자동으로 통과한다. 기존 `StyleEditorPanel`의 `proceeding`, `useBufferThenSwitch.ts:7`의 모듈 전역 `switchBusy`와 같은 성격의 가드다.

전이는 `usePickerMessages`의 캡처 호출 `.finally` 안에서만 일어난다. 캡처 실패 시에도 플래그를 내리고 `captureContext`를 `null`로 둔다 — before 없이 진행하는 현행 동작을 그대로 유지한다.

**시각 피드백**은 `docs/DESIGN.md:293` 규정대로 `common.next` 라벨을 유지한 채 `Loader2 animate-spin`을 붙이고 `aria-disabled:opacity-50`을 제외한다. 신규 i18n 키가 0개라 사전 변경이 없다. 현행 `proceeding` 경로도 피드백이 전무하므로 같은 처리로 묶는다.

## 기존 패턴 준수

- **draft 영속화**: editor-store는 `IssueRecord`로 수동 직렬화한다(`editor-store.ts:852~`, buffered element 매핑은 `:888~911`). 현재 요소와 buffered element의 `captureContext`를 optional 필드로 명시적으로 직렬화·복원한다. 비파괴 추가이므로 **마이그레이션 버전 bump는 필요 없다** — 레거시 데이터는 `?? null`로 폴백한다.
- **세션 영속화**: `EditorSnapshot`(`editor-store.ts:269~302`)과 `snapshotFromState()`(`useEditorSessionSync.ts:67~102`)는 필드를 명시적으로 나열하는 구조다. 새 상태를 추가하면 두 곳 모두 손봐야 한다.
- **content script 순수 함수 분리**: `frame-geometry.ts`·`annotation-draw.ts`처럼 테스트 가능한 로직을 `picker.ts` 밖으로 뺀다. `picker.ts`는 coverage 로직 스코프에서 제외된 파일이라, 판정이 그 안에 남으면 테스트로 고정할 수 없다.
- **메시지 비동기 응답**: `handlePrepareCapture`는 top frame에서 동기 응답, iframe에서 `respondWithTopRect` 경유 비동기 응답이다. 기존 구조를 따르되, `respondWithTopRect`가 응답 객체를 새로 조립하므로 새 필드는 각 분기에 명시적으로 넣는다.
- **i18n**: UI 문구가 추가되지 않으므로 사전 변경 없음(라벨 유지 + 스피너).
- **테스트 2트랙**: DOM 탐색·재검증은 `.test.tsx`(jsdom), 산술 게이트는 `.test.ts`(node). 동일 basename 공존은 `scroll-capture.test.ts`/`.tsx` 선례가 있고 `vitest.config.ts:17`의 `environmentMatchGlobs`가 확장자로 분기한다.

## 대안 검토

**1. before rect를 좌표째 고정하고 after에 그대로 재사용**
before/after 이미지 크기가 항상 같아 나란히 비교가 정확해진다. 그러나 before 후 사용자가 스크롤하면 rect가 엉뚱한 곳을 가리키고, 이를 막으려면 캡처 직전에 강제 스크롤 복원이 필요하다. 강제 스크롤이 사용자 눈에 보이고 iframe은 내부+top 이중 복원이라 복잡도가 크다. **대상(selector)만 고정하고 좌표는 재측정**하는 쪽을 택했다 — 스크롤·리플로우 무관하게 항상 올바른 위치를 찍는다. 리플로우로 컨테이너 크기가 변하면 before/after 이미지 크기가 달라지지만, 그것은 편집의 실제 결과를 반영한 것이다. 크기 대칭 미보장은 비목표로 명시했다.

**2. 하이라이트 오버레이로 편집 요소 표시**
넓게 찍을수록 어디가 바뀌었는지 알기 어려우므로 크롭 후 canvas에 사각형을 그리는 안. 채택하지 않았다. 대신 면적 게이트(40%)로 과확장 자체를 차단해 요소가 점처럼 작아지는 상황을 만들지 않는다.

**3. 시각 휴리스틱(배경색·border·box-shadow·면적 점프)으로 컨테이너 추론**
`<div class="card">` 같은 시맨틱 없는 컨테이너까지 커버할 수 있다. 채택하지 않았다. 임계값 튜닝이 필요하고 오탐 시 엉뚱한 영역이 찍혀 **리포트 정확도를 직접 해친다**. 강한 시맨틱 태그·role은 더 보수적인 신호지만 제품 맥락 단위를 완전히 보장하지는 않아 동일한 게이트와 사용자 검토가 필요하다.

**4. 점수제(신호별 가중치 합산)로 컨테이너 선택**
여러 신호를 종합해 최적 컨테이너를 고르는 안. 채택하지 않았다. 가중치 튜닝이 끝없고 특정 결과가 왜 나왔는지 디버깅할 수 없다. 순차 캐스케이드가 예측 가능하고 케이스별 테스트가 쉽다.

**5. iframe에서 top 좌표로 게이트 재평가**
`handlePrepareCapture`가 후보 rect를 반환하고 `respondWithTopRect`가 top 좌표로 `passesContextGates`를 다시 돌리는 안. 커버리지는 유지되지만 iframe 응답 경로에 요소 rect까지 함께 실어야 하고 분기가 늘어난다. iframe 안 요소 편집이 element mode의 주 사용 패턴이 아니고 폴백이 곧 현행 동작이므로, P1대로 **확장을 끄는 쪽**을 택했다.

**6. `beforeCaptureStatus` 3-state(`idle|capturing|ready`)**
상태를 명시적으로 표현하는 안. 채택하지 않았다. 이 코드베이스에는 before 캡처를 **발행하지 않는 경로가 3개**(버퍼 재선택 — `usePickerMessages.ts:142`의 `if (!wasBuffered && !beforeImage)` 가드 / `beforeImage` 이미 존재 / `rebindStylingSession` 왕복) 있어서, "선택 직후 capturing"으로 진입시키면 `ready`로 올려줄 주체가 없어 `[다음]`이 영구 비활성이 된다. `backToStyling`과 캡처 실패까지 더하면 데드락 경로가 5개다. in-flight 플래그는 이 경로들을 전부 자동으로 통과시킨다.

**7. 요소 단일 캡처(element-shot)·`StyleChangesDialog` 재캡처에도 확장 적용**
같은 맥락 문제가 있지만, element-shot은 "이 요소를 찍었다"는 의도가 명확해야 하고, by-selector 재캡처는 live 참조가 없어 핵심 가드(현재 요소 포함 재검증)가 성립하지 않는다. 둘 다 스코프에서 제외했다.

## 위험 요소

- **`buildSelector` 안정성**: `src/content/dom-describe.ts:10`이 만든 selector가 after 시점에도 같은 요소를 가리켜야 한다. 동적 클래스(CSS-in-JS 해시 등)가 리렌더로 바뀌면 `querySelector`가 실패할 수 있다. 실패 시 폴백 경로로 전환되므로 **깨지지 않고 현행 동작으로 돌아간다** — 단, 그 경우 요소가 `display:none`이면 0×0 폴백에 의존하게 된다.
- **`buildSelector` 비용은 페이지 메인스레드 동기 블로킹이다**: `finder({timeoutMs:500, maxNumberOfPathChecks:2000})`가 최악 500ms를 소비하는데, 이건 사이드패널 대기가 아니라 **사용자 페이지가 멈추는 시간**이다. 호출이 sync 메시지 핸들러(`picker.ts:246`) 안에 있고, 그 시점엔 `beginCapturePrep`이 이미 오버레이를 숨긴 상태라 미선택 화면 노출 구간이 그만큼 길어진다. 대표 DOM에서 실측하고, 페이지 멈춤이 체감되면 `emitSelected`(`picker.ts:884`)가 이미 selector를 1회 계산한다는 점을 이용한 `WeakMap<Element,string>` 캐시를 후속 과제로 등록한다.
- **시맨틱 후보의 오탐 가능성**: 강한 태그·role도 제품 맥락 단위를 완전히 보장하지는 않는다. 중첩 후보와 반복 row/listitem에서 최근접 선택·현재 요소 포함·면적 게이트를 테스트하고, 작성 화면의 사용자 검토를 안전망으로 둔다.
- **40% 상한**: 큰 모달은 폴백되고 넓은 컨테이너는 400px 비교표에서 작게 보일 수 있다. 대표 fixture의 식별성과 개인정보 노출 면적을 함께 수동 검증한다. 조정 방향은 조이는 쪽만 검토한다(P1·P2).
> **낮은 발동률은 위험 요소가 아니다.** 뷰포트보다 큰 컨테이너(세로로 긴 다이얼로그, 항목 많은 `<li>`, 긴 `<article>`, 작은 창)와 iframe·by-selector 경로가 전부 폴백돼 확장이 걸리는 빈도가 낮아지는 것은 **P1이 의도한 결과**다. 폴백은 현행 동작이므로 정확도 손실이 없다. 출시 전 실사이트 표본 관찰의 목적은 "게이트가 설계대로 동작하는지 확인"이지 "낮으니 완화하자"가 아니다.
- **`captureElementSnapshot` 반환 타입 변경**: 호출부 5곳(4개 파일)이 모두 영향받는다. 스코프 밖인 `captureElementShot`(정의부 `usePickerMessages.ts:321`, `.image` 언랩 지점 `:329`)도 수정이 필요하며, 여기서 실수하면 요소 단일 캡처가 깨진다.
- **`display:none` + 폴백 + 컨텍스트 없음**: before 캡처가 실패해 `captureContext`가 저장되지 않은 상태에서 요소를 `display:none`으로 만들면 0×0 폴백 대상이 없어 캡처 실패(null)가 된다. 현행도 무의미한 이미지를 만들 뿐이므로 회귀는 아니지만, 이미지가 아예 없는 쪽으로 바뀐다.
- **"이미지 없음"의 표면**: after가 null이면 before/after 표의 해당 칸이 비고 이슈 본문에도 파일이 안 붙는다. 수신자에게 "변화 없음"으로 읽힐 수 있으나, 잘못된 이미지를 넣는 것보다 낫다는 판단(P1)이다. 사유 표기는 i18n 키가 필요해 이번 스코프 밖이다.
- **`respondWithTopRect` 응답 조립**: 4경로 중 3개가 응답 객체를 새로 만든다. 새 필드(`scrollX`·`scrollY`·`contextSelector`)를 각 분기에 명시적으로 넣지 않으면 조용히 유실된다.
- **행 초기화 재캡처의 before/after 기준 desync**: `StyleChangesDialog`가 확장을 켜지 않으므로(대안 7), 확장된 `beforeImage`를 가진 버퍼 항목의 행을 초기화하면 **after만 요소 bbox로 강등**돼 두 이미지의 기준이 갈린다. 대안 7이 by-selector 확장을 배제한 필연적 귀결이라 코드로는 못 고친다 — live 참조가 없어 "현재 요소 포함" 재검증이 성립하지 않기 때문. 잘못된 확장보다 기준이 다른 두 이미지가 낫다는 P1 판단을 유지하고, 수동 검증 항목으로 남긴다.
- **잠금이 `[다음]`에만 걸린다**: `useBufferThenSwitch`(repick·DOM 트리 이동)는 두 번째 after 캡처 진입점인데 `beforeCapturePending`을 보지 않는다. before 캡처 중 편집 후 전환하면 그 버퍼 항목은 (before 없음 + 비확장 after)가 되는데, 이는 **이 기능 이전의 before-image 경쟁과 동일한 결과**라 회귀가 아니다. `shouldExpandAfter`가 `null` context에서 false를 반환해 기준 불일치가 아니라 균일한 폴백으로 떨어지는 것이 안전판이다.
