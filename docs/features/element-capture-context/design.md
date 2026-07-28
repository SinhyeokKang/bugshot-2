# Element 캡처 컨텍스트 확장 — 기술 설계

## 개요

캡처 rect를 결정하는 지점(`picker.ts`의 `handlePrepareCapture`)에 **확장 판정 단계**를 끼워 넣는다. 판정은 신뢰할 수 있는 시맨틱 신호로 조상 컨테이너를 찾고, 산술 게이트를 통과할 때만 그 rect를 쓴다. 하나라도 미달하면 현행 요소 bbox를 그대로 반환하므로 **폴백이 곧 현행 동작**이다.

before 캡처가 확장에 성공하면 그 조상의 selector를 사이드패널이 보관하고, after 캡처 시 selector를 되돌려 보내 **같은 조상을 다시 측정·재검증**한다. 재조회한 조상이 현재 요소를 포함하고 포함·면적 게이트를 다시 통과할 때만 사용한다. selector가 DOM 변경 뒤 다른 노드에 재결합하거나 컨테이너가 과확장되면 현행 방식으로 폴백한다.

before 캡처는 비동기 상태(`idle | capturing | ready`)로 관리한다. 요소 선택 직후 `capturing`으로 전환하고, 확장 또는 현행 bbox 폴백 이미지와 기준이 모두 확정되면 `ready`가 된다. 그 전에는 `[다음]`을 비활성화해 before/after가 서로 다른 판정을 쓰는 경쟁을 막는다. 캡처가 실패하면 기존 실패 안내를 유지하고 `ready`로 전환하지 않는다.

판정 로직은 jsdom 테스트가 가능하도록 `picker.ts`에서 별도 파일로 분리한다 — `frame-geometry.ts`·`annotation-draw.ts`와 같은 기존 분리 패턴.

## 변경 범위

### 새 파일

**`src/content/capture-context.ts`** — 확장 판정. DOM 탐색부와 산술 게이트부로 나뉜다.

jsdom은 `getBoundingClientRect()`가 항상 0을 반환하지만 `closest()`·`getComputedStyle()`·`contains()`는 정상 동작한다. 그래서 **rect를 인자로 받는 순수 함수**로 게이트를 설계해야 양쪽 모두 테스트 가능하다. rect 측정 자체는 이 파일에 두지 않고 `picker.ts`의 `viewportRectOf`가 계속 맡는다.

**`src/content/__tests__/capture-context.test.tsx`** — jsdom. `findContextAncestor` DOM 탐색.
**`src/content/__tests__/capture-context.test.ts`** — node. `passesContextGates` 산술.

### 수정 파일

| 파일 | 현재 역할 | 변경 |
|---|---|---|
| `src/types/picker.ts` | picker 메시지·응답 타입 | `PrepareCaptureResponse`에 `contextSelector` 추가, `picker.prepareCapture`에 요청 필드 추가 |
| `src/content/picker.ts` | content script 본체. `handlePrepareCapture`가 rect 결정(`:353`) | 확장 판정 호출 + `contextSelector` 재측정 분기 |
| `src/sidepanel/capture.ts` | `captureVisibleTab` → 크롭(`:13`, `:36`) | 반환 타입에 캡처 컨텍스트 동반, 0×0 폴백 처리 |
| `src/store/editor-store.ts` | 에디터 상태·버퍼(`:142`, `:234`) | `captureContext` 상태 + `BufferedElement` 필드 추가 |
| `src/sidepanel/hooks/usePickerMessages.ts` | before 캡처 호출(`:143`) | 캡처 컨텍스트 저장 |
| `src/sidepanel/tabs/StyleEditorPanel.tsx` | after 캡처 호출(`:156`) | 저장된 컨텍스트 전달 |
| `src/sidepanel/hooks/useBufferThenSwitch.ts` | 버퍼 적재 시 after 캡처(`:22`) | 저장된 컨텍스트 전달 + 버퍼에 동반 저장 |
| `src/sidepanel/tabs/styleEditor/StyleChangesDialog.tsx` | 행 초기화 후 재캡처(`:95`) | 버퍼 항목의 컨텍스트 전달 |

## 데이터 흐름

```
[before 캡처]
usePickerMessages
  └─ captureElementSnapshot(tabId, { frameId })
       └─ prepareCapture(tabId, frameId)               ← contextSelector 없음
            └─ picker.ts handlePrepareCapture()
                 ├─ findContextAncestor(selectedEl)     → 조상 or null
                 ├─ passesContextGates(elRect, ctxRect, viewport)
                 └─ 통과 → { rect: ctxRect, contextSelector: buildSelector(조상) }
                    미달 → { rect: elRect,  contextSelector: null }
       └─ cropImage(dataUrl, rect, viewport, 24)
       └─ store.setCaptureContext({ contextSelector, rect, viewport })
       └─ store.setBeforeCaptureStatus("ready")

[after 캡처]
StyleEditorPanel.handleNext / useBufferThenSwitch
  └─ captureElementSnapshot(tabId, { frameId, context: store.captureContext })
       └─ prepareCapture(tabId, frameId, contextSelector)   ← 저장된 selector 동반
            └─ picker.ts handlePrepareCapture(msg)
                 ├─ contextSelector 있음 → querySelector로 조상 재측정
                 │    ├─ 현재 요소 포함 + passesContextGates 재검증
                 │    └─ 조상 소실·다른 노드 재결합·게이트 실패 → 폴백
                 └─ contextSelector 없음(폴백 경로) → viewportRectOf(selectedEl)
                      └─ rect가 0×0 → 사이드패널이 저장된 before rect로 대체
```

iframe 경로는 기존과 동일하다. `respondWithTopRect`(`picker.ts:325`)가 rect를 top 좌표로 변환하고 `contextSelector`는 그대로 통과시킨다. selector는 iframe 문서 기준이지만 after 요청도 같은 `frameId`로 나가므로 좌표계 불일치가 생기지 않는다.

## 인터페이스 설계

### `src/content/capture-context.ts`

```ts
import type { ViewportRect } from "@/types/picker";

// 확장 rect가 뷰포트 면적에서 차지할 수 있는 초기 상한.
// 대표 fixture와 약 400px 결과 가독성 검증 후 확정한다.
export const CONTEXT_MAX_VIEWPORT_RATIO = 0.4;

// 떠 있는 UI — 시맨틱 속성만으로 확정된다.
const OVERLAY_SELECTOR =
  'dialog,[popover],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';

// 일반 페이지의 강한 구조 단위. 후보여도 산술 게이트와 after 재검증을 거친다.
const STRUCTURE_SELECTOR =
  'tr,li,fieldset,article,figure,' +
  '[role="row"],[role="listitem"],[role="tabpanel"],' +
  '[role="option"],[role="menuitem"],[role="treeitem"],[role="alert"],[role="status"]';

// 컨테이너 후보를 찾는다. 최근접 우선 — 모달 안 테이블 셀이면 다이얼로그가 아니라 <tr>.
// 요소 자신은 후보에서 제외한다(확장 실익 0).
export function findContextAncestor(el: Element): Element | null;

// 확장 허용 여부. 클램프하지 않는다 — 컨테이너가 화면에 온전히 들어오고,
// 요소를 완전히 포함하며, 면적이 상한 이하일 때만 true.
export function passesContextGates(
  elementRect: ViewportRect,
  contextRect: ViewportRect,
  viewport: { width: number; height: number },
): boolean;
```

`findContextAncestor`는 요소 자신을 제외하고
`el.parentElement?.closest(OVERLAY_SELECTOR + "," + STRUCTURE_SELECTOR)`로 가장 가까운
강한 시맨틱 조상만 반환한다. `form`·광범위 landmark·`[role="group"]`와
`position:absolute|fixed + z-index` 휴리스틱은 개인정보 노출 면적과 오탐 위험 때문에
후보에서 제외한다. 시맨틱 없는 커스텀 팝오버는 현행 방식으로 폴백한다.

`passesContextGates`는 **클램프하지 않는다.** 컨테이너가 뷰포트를 벗어나면 그 즉시 폴백이다.

클램프 방식(컨테이너를 뷰포트로 잘라 판정)을 쓰지 않는 이유는 둘이다. ① **잘린 컨테이너는 맥락이 불완전하다** — 1000px 컨테이너의 700px만 찍히면 상단이 날아가 "어느 것인지"를 못 보여주면서 이미지 비용은 다 치른다. ② **스크롤 위치가 판정을 바꾼다** — 클램프된 면적은 어디까지 스크롤했느냐에 따라 달라져서, 같은 요소를 골라도 어떤 때는 확장되고 어떤 때는 폴백된다. 사용자가 원인을 알 수 없고 재현도 안 된다.

"컨테이너 전체를 보여줄 수 있을 때만 컨테이너를 보여준다"로 규칙을 좁히면 둘 다 사라지고, 스크롤 위치와 무관하게 결과가 일관된다.

```ts
// 개념적 구현
const vpArea = viewport.width * viewport.height;
if (vpArea <= 0) return false;
// G1: 컨테이너가 뷰포트 안에 완전히 들어온다 (클램프 없음)
if (!withinViewport(contextRect, viewport)) return false;
// G2: 컨테이너가 요소를 완전히 포함한다
if (!containsRect(contextRect, elementRect)) return false;
// G3: 면적 상한
return contextRect.width * contextRect.height <= vpArea * CONTEXT_MAX_VIEWPORT_RATIO;
```

G1이 들어오면서 확장 대상은 **화면에 온전히 들어오고 화면의 40% 이하인 컨테이너**로 좁혀진다. 뷰포트보다 큰 컨테이너(긴 목록 항목·긴 `article`·모바일 뷰의 세로 긴 다이얼로그)는 면적과 무관하게 전부 폴백이다.

### `src/types/picker.ts`

```ts
export interface PrepareCaptureResponse {
  rect: ViewportRect | null;
  viewport: { width: number; height: number };
  // 확장이 적용됐으면 그 조상의 selector. null이면 폴백(요소 bbox) 경로.
  // 구버전 응답엔 없다 — 소비 시점 ?? null 폴백.
  contextSelector?: string | null;
}

// PickerMessage 유니온
| { type: "picker.prepareCapture"; contextSelector?: string }
| {
    type: "picker.prepareCaptureBySelector";
    selector: string;
    contextSelector?: string;
  }
```

### `src/sidepanel/capture.ts`

```ts
// before에서 확정한 캡처 기준. after가 같은 대상을 다시 측정하는 데 쓴다.
export interface CaptureContext {
  // 확장 성공 시 조상 selector. null이면 폴백 경로.
  contextSelector: string | null;
  // 폴백 경로에서 요소 rect가 0×0이 됐을 때 재사용할 before 시점 rect.
  rect: ViewportRect;
  viewport: { width: number; height: number };
}

export interface CaptureResult {
  image: string;
  context: CaptureContext;
}

export async function captureElementSnapshot(
  tabId: number,
  options?: { margin?: number; frameId?: number; context?: CaptureContext },
): Promise<CaptureResult | null>;

export async function captureElementSnapshotBySelector(
  tabId: number,
  selector: string,
  options?: { margin?: number; frameId?: number; context?: CaptureContext },
): Promise<CaptureResult | null>;
```

반환 타입이 `string | null` → `CaptureResult | null`로 바뀐다. 스코프 밖 호출부(`captureElementShot`)는 `.image`만 꺼내 쓴다.

`captureWithPrep` 안의 0×0 폴백:

```ts
// 폴백 경로에서 요소가 display:none이면 rect가 0 — before rect로 대체한다.
// 확장 경로는 조상이 렌더링되므로 여기 걸리지 않는다.
const usable =
  prep.rect.width > 0 && prep.rect.height > 0
    ? { rect: prep.rect, viewport: prep.viewport }
    : options.context
      ? { rect: options.context.rect, viewport: options.context.viewport }
      : null;
```

`usable`이 null이면 기존 실패 경로(`endCapture` 후 null 반환)를 그대로 탄다.

### `src/store/editor-store.ts`

```ts
interface EditorState {
  // ...
  // 현재 선택 요소의 캡처 기준. before 캡처가 확정하고 after가 재사용한다.
  captureContext: CaptureContext | null;
  // before 캡처 경쟁을 막는 세션 상태. ready 전에는 [다음] 비활성화.
  beforeCaptureStatus: "idle" | "capturing" | "ready";
}

export interface BufferedElement {
  // ...
  // 버퍼 적재 시점의 캡처 기준. StyleChangesDialog 재캡처가 쓴다.
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

`IssueRecord`의 현재 요소와 buffered element에도 `captureContext?`를 추가해 draft 저장·복원
후 재캡처가 같은 기준을 쓸 수 있게 한다. 비파괴 optional 필드이므로 persist 버전 bump는
하지 않으며 레거시 draft는 `undefined`를 현행 폴백으로 읽는다.

## 기존 패턴 준수

- **draft 영속화**: editor-store는 `IssueRecord`로 수동 직렬화한다(`editor-store.ts:855~`). 현재 요소와 buffered element의 `captureContext`를 optional 필드로 명시적으로 직렬화·복원한다. 비파괴 추가이므로 **마이그레이션 버전 bump는 필요 없다** — 레거시 데이터는 `?? null`로 폴백한다.
- **content script 순수 함수 분리**: `frame-geometry.ts`·`annotation-draw.ts`처럼 테스트 가능한 로직을 `picker.ts` 밖으로 뺀다.
- **메시지 비동기 응답**: `handlePrepareCapture`는 top frame에서 동기 응답, iframe에서 `respondWithTopRect` 경유 비동기 응답이다. 기존 구조를 그대로 따르고 `contextSelector`만 통과시킨다.
- **i18n**: UI 문구가 추가되지 않으므로 사전 변경 없음.
- **테스트 2트랙**: DOM 탐색은 `.test.tsx`(jsdom), 산술 게이트는 `.test.ts`(node).

## 대안 검토

**1. before rect를 좌표째 고정하고 after에 그대로 재사용**
before/after 이미지 크기가 항상 같아 나란히 비교가 정확해진다. 그러나 before 후 사용자가 스크롤하면 rect가 엉뚱한 곳을 가리키고, 이를 막으려면 캡처 직전에 강제 스크롤 복원이 필요하다. 강제 스크롤이 사용자 눈에 보이고 iframe은 내부+top 이중 복원이라 복잡도가 크다. **대상(selector)만 고정하고 좌표는 재측정**하는 쪽을 택했다 — 스크롤·리플로우 무관하게 항상 올바른 위치를 찍는다. 리플로우로 컨테이너 크기가 변하면 before/after 이미지 크기가 달라지지만, 그것은 편집의 실제 결과를 반영한 것이다.

**2. 하이라이트 오버레이로 편집 요소 표시**
넓게 찍을수록 어디가 바뀌었는지 알기 어려우므로 크롭 후 canvas에 사각형을 그리는 안. 채택하지 않았다. 대신 면적 게이트(40%)로 과확장 자체를 차단해 요소가 점처럼 작아지는 상황을 만들지 않는다.

**3. 시각 휴리스틱(배경색·border·box-shadow·면적 점프)으로 컨테이너 추론**
`<div class="card">` 같은 시맨틱 없는 컨테이너까지 커버할 수 있다. 채택하지 않았다. 임계값 튜닝이 필요하고 오탐 시 엉뚱한 영역이 찍혀 **리포트 정확도를 직접 해친다**. 강한 시맨틱 태그·role은 더 보수적인 신호지만 제품 맥락 단위를 완전히 보장하지는 않아 동일한 게이트와 사용자 검토가 필요하다.

**4. 점수제(신호별 가중치 합산)로 컨테이너 선택**
여러 신호를 종합해 최적 컨테이너를 고르는 안. 채택하지 않았다. 가중치 튜닝이 끝없고 특정 결과가 왜 나왔는지 디버깅할 수 없다. 순차 캐스케이드가 예측 가능하고 케이스별 테스트가 쉽다.

**5. 요소 단일 캡처(element-shot)에도 확장 적용**
같은 맥락 문제가 있지만, 그 기능은 "이 요소를 찍었다"는 의도가 명확해야 한다. 확장하면 사용자가 지정한 대상과 결과물이 어긋난다. 스코프에서 제외했다.

## 위험 요소

- **`buildSelector` 안정성**: `dom-describe.ts:10`이 만든 selector가 after 시점에도 같은 요소를 가리켜야 한다. 동적 클래스(CSS-in-JS 해시 등)가 리렌더로 바뀌면 `querySelector`가 실패할 수 있다. 실패 시 폴백 경로로 전환되므로 **깨지지 않고 현행 동작으로 돌아간다** — 단, 그 경우 요소가 `display:none`이면 0×0 폴백에 의존하게 된다.
- **시맨틱 후보의 오탐 가능성**: 강한 태그·role도 제품 맥락 단위를 완전히 보장하지는 않는다. 중첩 후보와 반복 row/listitem에서 최근접 선택·현재 요소 포함·면적 게이트를 테스트하고, 작성 화면의 사용자 검토를 마지막 안전망으로 둔다.
- **초기 40% 상한**: 큰 모달은 폴백되고 넓은 컨테이너는 400px 비교표에서 작게 보일 수 있다. 대표 fixture의 식별성과 개인정보 노출 면적을 함께 수동 검증해 출시 전 값을 확정한다.
- **G1(뷰포트 완전 포함)으로 인한 커버리지 축소**: 뷰포트보다 큰 컨테이너가 전부 폴백된다. 세로로 긴 다이얼로그, 항목이 많은 `<li>`, 긴 `<article>`, 작은 창·모바일 에뮬레이션이 여기 해당해 **확장이 실제로 걸리는 빈도가 눈에 띄게 낮아질 수 있다.** 확장이 안 걸려도 현행 동작이라 정확도 위험은 없지만, 기능 체감이 약해질 수 있으므로 대표 fixture에서 발동률을 함께 측정한다.
- **`captureElementSnapshot` 반환 타입 변경**: 호출부 5곳이 모두 영향받는다. 스코프 밖인 `captureElementShot`(`usePickerMessages.ts:90`)도 수정이 필요하며, 여기서 실수하면 요소 단일 캡처가 깨진다.
- **`display:none` + 폴백 + 컨텍스트 없음**: before 캡처가 실패해 `captureContext`가 저장되지 않은 상태에서 요소를 `display:none`으로 만들면 0×0 폴백 대상이 없어 캡처 실패(null)가 된다. 현행도 무의미한 이미지를 만들 뿐이므로 회귀는 아니지만, 이미지가 아예 없는 쪽으로 바뀐다.
- **폴백 rect + 스크롤**: 요소가 `display:none`이면 after 좌표를 재측정할 수 없다. before와 viewport/스크롤 기준이 달라졌으면 stale rect를 쓰지 않고 after 이미지 없음으로 처리한다.
- **selector 생성 지연**: `buildSelector`는 최악 500ms/2,000 path check까지 허용한다. before 상태로 `[다음]`을 막는 시간에 포함되므로 대표 DOM에서 지연을 측정하고 실패 시 path 폴백까지 확인한다.
- **jsdom `getComputedStyle` 한계**: jsdom은 stylesheet 기반 computed style 해석이 제한적이다. `findContextAncestor` 테스트에서 `position`·`z-index`는 **인라인 스타일로 지정**해야 안정적으로 읽힌다.
