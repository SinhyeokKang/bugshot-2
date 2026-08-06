# UA 기본값 기준선 — 기술 설계

## 개요

content script가 `about:blank` 숨김 iframe을 **하나** 만들어 두고, 선택 요소의 `tagName`으로 빈 요소를 찍어 `getComputedStyle`을 뜬다. 그 결과가 UA 기본 스타일 기준선이다. 선택 요소의 computed와 값이 **같은** prop 이름만 모아 `uaDefaultProps: string[]`로 페이로드에 실어 보낸다. 사이드패널은 이 집합을 기존 `KNOWN_DEFAULTS`·`isInactiveBorderColor`와 **OR로 합쳐** 기본값을 판정한다.

기준선은 `tagName`별로 캐시한다 — Hoverify는 요소마다 iframe DOM을 만들고 지우는데(`base.js:6031`), 우리는 태그당 1회다. `innerHTML` 복사도 하지 않는다(비용 + 페이지 콘텐츠를 우리 DOM에 복제하는 프라이버시 표면).

판정이 엄격해지면 섹션이 더 많이 접힌다. 접힘은 **정보 소실**이므로(자식이 DOM 언마운트되고 "모두 펼치기"·검색 UI가 없다) `sectionDefaultOpen`을 boolean에서 **count**로 바꿔 접힌 헤더에 배지를 띄운다(PRD G5·S4).

## 변경 범위

### 신규 `src/content/ua-baseline.ts`

역할: 숨김 iframe 수명 관리 + tagName별 기준선 캐시. **브라우저 전용**이라 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 등재한다(CLAUDE.md 규칙).

```ts
/**
 * tagName의 UA 기본 computed 스타일. about:blank iframe에 맨 요소를 찍어 측정한다.
 * 실패(contentDocument null)하면 null — 호출부는 기존 판정으로 폴백한다.
 * 결과는 tagName별로 캐시되며 document 수명 동안 유지된다.
 */
export function getUaBaseline(tagName: string): Readonly<Record<string, string>> | null;

/** 세션 종료 시 iframe 제거. picker의 handleClear가 부른다. 캐시는 유지한다. */
export function disposeUaBaseline(): void;

/** 이전 세션이 비정상 종료해 남은 iframe 정리. 세션 진입 경로에서 무조건 부른다. */
export function removeOrphanBaselineFrame(): void;
```

구현 골자:

```ts
const BASELINE_HOST_ID = "__bugshot_ua_baseline__";
let frame: HTMLIFrameElement | null = null;
let unavailable = false;                       // 한 번 실패하면 재시도하지 않는다
const cache = new Map<string, Record<string, string>>();

function ensureFrame(): Document | null {
  if (unavailable) return null;
  if (frame?.isConnected && frame.contentDocument) return frame.contentDocument;
  frame?.remove();
  frame = document.createElement("iframe");
  frame.id = BASELINE_HOST_ID;
  frame.setAttribute("aria-hidden", "true");
  // display:none 이어도 contentDocument 의 getComputedStyle 은 UA 기본값을 돌려준다.
  // 렌더 박스가 없으므로 captureVisibleTab·스크롤 캡처 스티칭에 잡히지 않는다.
  Object.assign(frame.style, { display: "none", width: "0", height: "0", border: "0" });
  document.documentElement.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { unavailable = true; frame.remove(); frame = null; return null; }
  return doc;
}

export function getUaBaseline(tagName: string) {
  const key = tagName.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const doc = ensureFrame();
  if (!doc?.body) return null;
  let probe: Element;
  try { probe = doc.createElement(key); } catch { return null; }   // 비정상 태그명 방어
  doc.body.appendChild(probe);
  const cs = doc.defaultView!.getComputedStyle(probe);
  const out: Record<string, string> = {};
  for (const p of INTERESTING_PROPS) out[p] = cs.getPropertyValue(p);
  probe.remove();
  cache.set(key, out);
  return out;
}
```

수명 정책 3가지를 명시한다.

- **`unavailable` 래치는 리셋하지 않는다.** `disposeUaBaseline()`이 래치를 되돌리면 실패하는 페이지에서 세션 재진입마다 같은 실패를 반복한다. 래치는 document 수명 동안 유지된다.
- **`disposeUaBaseline()`은 캐시를 비우지 않는다.** UA 기본값은 document 수명 내 불변이고 content script는 문서마다 새로 주입되므로, 세션 재진입 시 캐시를 살려두는 편이 맞다. 지우는 건 iframe뿐이다.
- **모듈 최상위에서 `document`·`INTERESTING_PROPS`를 만지지 않는다.** 아래 "순환 import" 참조.

#### 순환 import 회피 (필수 제약)

`ua-baseline.ts`가 `INTERESTING_PROPS`를 `css-resolve.ts`에서 가져오는데 `css-resolve.ts`가 `getUaBaseline`을 부르므로 **순환**이다. 여기에 두 가지가 겹친다.

1. `picker.ts`가 `css-resolve`를 먼저 들어가므로, `ua-baseline.ts`가 **모듈 최상위에서** `INTERESTING_PROPS`를 쓰면(`new Set([...])` 등) TDZ 예외로 죽는다.
2. `*.test.ts`는 node 환경(`vitest.config.ts`)이라 `ua-baseline.ts`가 최상위에서 `document`를 만지면 `css-resolve.test.ts`(기존 테스트 전량)가 **import 시점에 크래시**한다.

→ **`INTERESTING_PROPS` 접근과 DOM 접근을 전부 함수 본문 안으로 제한한다.** 최상위에는 상수 문자열과 `let` 선언만 둔다.

### `src/content/css-resolve.ts`

1. **순수 비교 함수 추가** (여기 두는 이유: `ua-baseline.ts`는 커버리지 로직 스코프 밖이라 그 안에 두면 테스트가 지표에 안 잡힌다)
   ```ts
   /**
    * computed 값이 UA 기준선과 같은 prop 이름들. baseline이 null이면 빈 배열.
    * 레이아웃 의존 prop(width/height/min-*/max-*)은 used value가 나와 거의 항상
    * 다르므로 비교 대상에서 뺀다 — 넣어도 무해하지만 페이로드만 커진다.
    */
   export function propsMatchingBaseline(
     computed: Record<string, string>,
     baseline: Readonly<Record<string, string>> | null,
   ): string[];
   ```
2. **`collectSelection`** — `uaDefaultProps`를 채우는 위치는 **`normalizePositionOffsets(computedStyles, specifiedStyles)` 호출 이후**다. 그 함수가 `top/right/bottom/left`를 specified에 없으면 `"auto"`로 덮어쓰므로, 그 전에 계산하면 페이지는 used px·기준선은 `auto`가 되어 4개 prop이 영구히 불일치한다. **"computedStyles 채운 직후"가 아니라 "정규화 직후"다.**
3. `INTERESTING_PROPS`는 이미 export돼 있어 `ua-baseline.ts`가 그대로 쓴다(위 순환 제약 준수).

### `src/content/picker.ts`

- `postSelectionUpdate`(:1123)가 `uaDefaultProps`를 함께 싣는다.
- `handleClear`(선언 :614, 삽입 지점은 `inspectorCache = new WeakMap()`이 있는 :642 근처)에서 `disposeUaBaseline()`을 부른다.
- `removeOrphanBaselineFrame()`을 **`removeOrphanOverlay()` 호출 3곳 전부**에 둔다: `:593`(`handleStart`)·`:1217`(`handleSelectByPath`)·`:1252`(`handleStartAreaSelect`). 앞 두 곳은 `if (!overlay)` 가드 **안**이라 오버레이가 살아 있는 재진입에서는 스윕이 안 돈다 — orphan 정리는 가드 **밖**에서 무조건 돌려야 한다(`annotation.ts`의 무조건 스윕이 선례).

### `src/content/dom-describe.ts`

`isRenderable`이 overlay 호스트 id 하나만 제외하고 있어, 새 iframe이 **DOM 트리 네비게이터 목록에 뜨고 사용자가 선택할 수 있다.** 제외 목록에 `BASELINE_HOST_ID`를 추가한다.

### `src/content/scroll-capture.ts`

`display:none`+`position:static`이라 fixed/sticky 후보로 승격되지 않아 **실해는 없다.** 다만 예외 id 목록(`HOST_ID`·`ANNOTATION_HOST_ID`)에 `BASELINE_HOST_ID`를 함께 넣어, 나중에 숨김 방식을 `position:fixed;left:-9999px` 등으로 바꿨을 때의 지뢰를 미리 없앤다.

### `src/types/picker.ts`

```ts
export interface PickerSelectionPayload {
  // …기존 필드…
  /**
   * computed 값이 UA 기본 스타일과 같은 prop 이름들. 기준선을 못 만드는 페이지나
   * 구버전 스냅샷에선 undefined — 그 경우 KNOWN_DEFAULTS 단독 판정으로 폴백한다.
   */
  uaDefaultProps?: string[];
}

export interface PickerSelectionUpdatePayload {
  // …기존 필드…
  uaDefaultProps?: string[];
}
```

**optional인 것이 핵심이다.** 세션 영속 스냅샷(`selectionSnapshot`)에서 복원되면 이 필드가 없고, 그때 동작은 변경 전과 같아야 한다. 마이그레이션 불필요.

### `src/store/editor-store.ts` + `src/sidepanel/hooks/usePickerMessages.ts`

**"변경 없음"이 아니다.** 페이로드가 스토어에 닿으려면 4곳을 배선해야 한다.

| 지점 | 현재 | 필요한 변경 |
|---|---|---|
| `editor-store.ts` `EditorSelection` | `PickerSelectionPayload`에서 파생되지 않은 **독립 인터페이스** | `uaDefaultProps?: string[]` 필드 추가 (없으면 훅에서 타입 에러) |
| `usePickerMessages.ts` `onElementSelected` | 필드를 **하나하나 손으로 나열** | `uaDefaultProps` 추가 — 빠뜨리면 optional이라 **타입 에러도 없이** 조용히 안 닿는다 |
| `editor-store.ts` `updateSelectionStyles` patch 타입 | 3개 맵만 받음 | `uaDefaultProps` 수용 |
| `editor-store.ts` `mergeSelectionStyles` | `specifiedStyles`·`computedStyles`·`propSources` **정확히 3개만 반환** | `uaDefaultProps` 반환 — 안 하면 `{...s.selection, ...merge(...)}`에서 **버려진다** |

즉 `picker.selected` 경로는 spread로 통과하지만 **`selectionUpdated` 경로는 통과하지 못한다.** 스타일 편집 중 갱신이 반영되려면 위 4곳이 전부 필요하다.

### `src/sidepanel/lib/sectionDefaultOpen.ts` → count 반환

접힘의 정보 소실을 메우기 위해 boolean을 count로 바꾼다. 호출부는 `StyleEditorPanel.tsx:150` 하나뿐이다.

```ts
/**
 * 섹션 prop 중 "저자가 손댄 값"의 개수. 0이면 섹션을 접고 배지도 숨긴다.
 * 기존 sectionDefaultOpen(...)의 boolean은 이 값 > 0 과 동치다.
 */
export function sectionActiveCount(
  props: readonly string[],
  specifiedStyles: Record<string, string>,
  computedStyles: Record<string, string>,
  uaDefaultProps?: ReadonlySet<string>,
): number;
```

기존 본문의 **빈값 가드를 잃지 않도록 주의한다** — 실제 코드는 `if (v == null || v === "" || isKnownDefault(p, v)) return false;`이고, `isDefaultValue`로 치환할 때 `v == null || v === ""` 가지가 사라지면 안 된다.

`uaDefaultProps`는 **optional 4번째 인자**로 둔다. 필수로 만들면 기존 테스트가 전부 3-인자 호출이라 Task 4의 "기존 테스트 무수정 통과"가 즉시 깨진다.

### `src/sidepanel/tabs/styleEditor/propMetadata.ts`

**판정 진입점을 하나로 모은다.** 지금 같은 목적의 판정이 콜사이트마다 **서로 다른 식**으로 인라인돼 있어(아래 표) UA 축을 더하면 그 차이가 그대로 굳는다 — POSTMORTEM 2026-06-28이 "같은 판정을 쓰는 3곳을 동시에 맞춰야 한다"고 남긴 함정이다.

```ts
/**
 * 이 prop 값이 "저자가 손대지 않은 기본값"인가. 세 축의 OR:
 *   ① KNOWN_DEFAULTS 테이블 (명세상 초기값)
 *   ② UA 기준선 차분        (about:blank 맨 태그와 동일)
 *   ③ isInactiveBorderColor (cross-prop 종속 — border-color는 style/width에 묶인다)
 * ②③은 !isSpecified 일 때만 본다 — author가 명시한 값은 가드를 우회한다
 * (POSTMORTEM 2026-06-28). ①은 기존 동작 보존을 위해 specified 여부와 무관하게 적용.
 */
export function isDefaultValue(input: {
  prop: string;
  value: string;
  isSpecified: boolean;
  computedStyles: Record<string, string>;
  uaDefaultProps?: ReadonlySet<string>;
}): boolean {
  const { prop, value, isSpecified, computedStyles, uaDefaultProps } = input;
  if (isKnownDefault(prop, value)) return true;
  if (isSpecified) return false;
  if (uaDefaultProps?.has(prop)) return true;
  return isInactiveBorderColor(prop, computedStyles);
}
```

`isKnownDefault`·`isInactiveBorderColor`는 export를 유지한다(기존 테스트가 직접 부른다).

### 콜사이트 — 4곳이 아니라 5곳이고, 판정식이 이미 3종이다

| # | 위치 | 현재 판정식 | 시각 표현 | 통합 후 변화 |
|---|---|---|---|---|
| 1 | `lib/sectionDefaultOpen.ts:14-19` | 빈값 가드 + `isKnownDefault` + `isInactiveBorderColor` (**2축**) | (섹션 펼침) | 없음 — count로 시그니처만 변경 |
| 2 | `styleEditor/ValueCombobox.tsx:92-95` | `!value && (isKnownDefault \|\| (!isSpecified && isInactiveBorderColor))` (**3축**, `isSpecified` 가드 이미 인라인) | `text-muted-foreground/50` | 없음 |
| 3 | `styleEditor/StylePropEditors.tsx:312` | `!value && isKnownDefault(prop, placeholder)` (**1축**) | `text-muted-foreground/50` | **`isInactiveBorderColor` 축이 새로 붙는다** |
| 4 | `styleEditor/StylePropEditors.tsx:515` | 동일 (**1축**) | `text-muted-foreground/50` | **`isInactiveBorderColor` 축이 새로 붙는다** |
| 5 | `styleEditor/StylePropEditors.tsx:362` (`AlignmentProp`) | `!value` **단독** | **`opacity-50`** | 판정식은 그대로, **시각 표현만 통일** |

두 가지가 여기서 갈린다.

- **#3·#4는 드롭인 교체가 아니다.** 두 곳 다 `isSpecified`·`computedStyles`가 스코프에 없고 이 파일은 `isKnownDefault`만 import한다. `useEditorStore` 셀렉터를 추가해야 한다. 특히 #4의 `SideStyleSelect`는 `controlled?.value ?? styleProp.value`로 **부모가 값을 주입**할 수 있어, `prop in specifiedStyles` 조회가 실제 표시 중인 prop과 어긋날 수 있다 — 별도 작업으로 취급한다.
- **#5는 `isDefaultValue` 통합 대상이 아니다.** 판정 축이 "미편집"뿐이라 성격이 다르다. 다만 `opacity-50`은 이 저장소에서 **disabled 신호**이므로(`disabled:opacity-50`이 UI 프리미티브 전반, `aria-disabled:opacity-50`이 사이드패널 ~30곳) `text-muted-foreground/50` 계열로 통일해 "기본값=색 옅음 / 비활성=opacity" 축을 분리한다.

`uaDefaultProps`는 `useEditorStore((s) => s.selection?.uaDefaultProps)`에서 읽어 `Set`으로 감싼다. 매 렌더 새 `Set`을 만들지 않도록 `useMemo`로 고정하고, 컴포넌트들이 각자 만들지 않게 **`styleHooks.ts`에 `useUaDefaultProps()` 훅 하나**를 둔다.

### 접근성 (저비용 2건만)

UA 축은 디밍 대상을 `KNOWN_DEFAULTS` 58개 범위에서 `INTERESTING_PROPS` 전체로 넓힌다. 즉 **디밍 면적이 크게 늘어난다.** 지금 "기본값"은 색 대비 단독으로만 전달되고(대비 ~2:1) `ValueCombobox`에 관련 `aria-*`가 없어 스크린리더 사용자는 기본값/명시값을 구분할 수단이 없다. 어차피 5곳을 손대는 작업이므로 두 건을 포함한다.

1. `ValueCombobox`의 `buildTriggerTitle`(및 `title`)에 "기본값" 표기를 추가 — i18n 키 2개(ko/en), 시각 변화 0.
2. 위 #5의 `opacity-50` → `text-muted-foreground/50` 통일.

색 대비 상향(`/50` → `/70`)은 기존 문제이고 이 기능과 독립이라 **별건으로 분리**한다(PRD 비목표).

## 데이터 흐름

```
picker.selected / picker.selectionUpdated
  │
  ├─ collectSelection(el)
  │     computedStyles = INTERESTING_PROPS × getComputedStyle(el)
  │     normalizePositionOffsets(computedStyles, specifiedStyles)   ← 반드시 먼저
  │     baseline       = getUaBaseline(el.tagName)     ← tagName 캐시 히트 시 DOM 조작 0
  │     uaDefaultProps = propsMatchingBaseline(computedStyles, baseline)
  │
  ▼
usePickerMessages: onElementSelected / updateSelectionStyles   ← 필드 수동 나열 (배선 필요)
  │
  ▼
editor-store.selection.uaDefaultProps: string[] | undefined
  (selectionUpdated 경로는 mergeSelectionStyles가 반환해야 살아남는다)
  │
  ▼
useUaDefaultProps() → ReadonlySet<string>
  │
  ├─ sectionActiveCount()      → 섹션 초기 펼침 + 헤더 count 배지
  └─ isDefaultValue()          → ValueCombobox / StylePropEditors 디밍
```

iframe 수명:

```
picker.start ──► removeOrphanBaselineFrame()  (가드 밖 무조건)
             ──► (lazy) 첫 getUaBaseline 호출에서 생성, tagName별 캐시 누적
picker.clear ──► disposeUaBaseline() ──► iframe.remove()   (캐시·unavailable 래치는 유지)
```

`picker.stop`은 정리 지점이 **아니다** — `handleStop`(:609-611)은 hover 리스너 제거 + 모드 전환뿐이다. 단일 정리 종점은 `handleClear`(:614)이고 포트 disconnect에서도 여기로 온다.

## 인터페이스 설계

```ts
// src/content/ua-baseline.ts               (신규, 브라우저 전용)
export function getUaBaseline(tagName: string): Readonly<Record<string, string>> | null;
export function disposeUaBaseline(): void;
export function removeOrphanBaselineFrame(): void;

// src/content/css-resolve.ts               (순수, 유닛 테스트 대상)
export function propsMatchingBaseline(
  computed: Record<string, string>,
  baseline: Readonly<Record<string, string>> | null,
): string[];

// src/types/picker.ts
interface PickerSelectionPayload       { uaDefaultProps?: string[] }
interface PickerSelectionUpdatePayload { uaDefaultProps?: string[] }

// src/store/editor-store.ts
interface EditorSelection              { uaDefaultProps?: string[] }

// src/sidepanel/lib/sectionDefaultOpen.ts
export function sectionActiveCount(
  props: readonly string[],
  specifiedStyles: Record<string, string>,
  computedStyles: Record<string, string>,
  uaDefaultProps?: ReadonlySet<string>,
): number;

// src/sidepanel/tabs/styleEditor/propMetadata.ts
export function isDefaultValue(input: {
  prop: string; value: string; isSpecified: boolean;
  computedStyles: Record<string, string>;
  uaDefaultProps?: ReadonlySet<string>;
}): boolean;

// src/sidepanel/tabs/styleEditor/styleHooks.ts
export function useUaDefaultProps(): ReadonlySet<string>;
```

## 기존 패턴 준수

- **판정 단일 진입점 (POSTMORTEM 2026-06-28)** — 새 축을 5곳에 복제하지 않고 `isDefaultValue` 하나로 모은다. `apiHostRow.ts`가 "컴포넌트에 두면 누출이 green으로 통과한다"는 이유로 `lib/`에 있는 것과 같은 규율이다.
- **optional 페이로드 = 무손실 폴백** — 구버전 스냅샷 복원 시 `undefined`라 기존 동작. 마이그레이션 코드가 필요 없다.
- **커버리지 로직 스코프 (CLAUDE.md)** — `ua-baseline.ts`를 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 등재. 순수 비교는 `css-resolve.ts`에 두어 지표에 남긴다.
- **content script는 i18n 불가** — content 쪽 신규 문자열은 0개. 사이드패널의 "기본값" 표기만 i18n 키 2개(ko/en 동시 갱신).

## 대안 검토

### A1. 사이드패널이 `uaDefaults` 전체 맵을 받아 직접 비교 — 기각

`uaDefaults: Record<string, string>`를 통째로 보내면 디버깅이 쉽고 사이드패널에서 비교 로직을 유닛 테스트하기도 좋다. 하지만 페이로드가 `computedStyles`만큼(**79 entry**) 커지고, 그 79개 중 실제로 필요한 정보는 "같은가 다른가" 1비트씩이다. **`selectionUpdated`는 스타일 편집 중 120ms 디바운스로 반복 발화**하므로 매 편집마다 이 페이로드가 오간다. `string[]` 쪽이 맞다.

### A2. `KNOWN_DEFAULTS` 테이블 삭제하고 UA 차분으로 전면 대체 — 기각

PRD "왜 대체가 아니라 보강인가" 표 참조. UA 차분은 border-color 케이스를 **못 잡고**(기준선의 글자색과 페이지 요소의 글자색이 달라 "다름"으로 통과), 기준선을 못 만드는 페이지에선 아예 없다. 테이블을 지우면 그 두 상황에서 오늘보다 나빠진다. POSTMORTEM 원칙 "잘못된 확정이 uncertain보다 해롭다"의 변주다.

### A3. `getComputedStyle`을 detached element로 대체 — 기각

iframe 없이 `document.createElement(tag)`를 문서에 안 붙이고 `getComputedStyle`을 부르면 빈 값이 나온다. 문서에 붙이면 페이지 CSS가 적용돼 기준선이 아니게 된다. `about:blank` 문서 컨텍스트가 필요한 이유다.

### A4. 하드코딩 UA 스타일시트 테이블 내장 — 기각

Chrome의 `html.css`를 코드에 박는 방식. 브라우저 버전·플랫폼에 따라 달라지고 유지보수가 `KNOWN_DEFAULTS`와 같은 수동 테이블 문제로 회귀한다. 런타임 실측이 이 문제를 푸는 이유 자체다.

### A5. overlay shadow root 안의 probe + `all: initial` — 기각

iframe 대신 이미 있는 overlay shadow root(`overlay.ts`의 `attachShadow({mode:"open"})`)에 `all: initial` 컨테이너를 두고 빈 요소를 찍는 방식. 문서 author 스타일은 shadow 경계를 넘지 않고 UA 스타일시트는 넘으므로 원리상 성립하며, 상속분은 `all: initial`이 리셋한다. 이 방식은 CSP·`about:blank` 로그 오염·DOM 트리 노출·페이지의 기준선 오염 위험을 **전부 소거한다.**

그럼에도 기각하는 이유는 **기준선의 정확성이 `all` 키워드의 예외 목록에 걸리기 때문**이다. `all`은 `direction`·`unicode-bidi`·custom property를 리셋하지 않아 그것들을 손으로 지정해야 하고, 손으로 지정하는 순간 "런타임 실측으로 수동 테이블을 없앤다"는 이 기능의 전제 자체가 약해진다(A4를 기각한 것과 같은 이유의 축소판). 게다가 shadow 경계를 넘는 UA 룰의 적용 범위는 브라우저 구현 세부에 더 가깝고, `about:blank` 문서 컨텍스트만큼 "페이지 CSS가 0"이 자명하지 않다.

기각의 대가는 위 4개 위험을 각각 대응 항목으로 떠안는 것이고, 그건 아래 위험 요소 1·4·6·7에 명시했다. 이 대안은 위험 4·6·7이 구현 중 실제로 문제가 되면 재검토할 1순위다.

## 위험 요소

1. **기준선 확보 실패** — `contentDocument`가 `null`이면 `unavailable` 래치로 즉시 폴백하고 재시도하지 않는다. **원인을 CSP로 단정하지 않는다**: `src` 없는 iframe의 초기 빈 문서는 네비게이션이 아니므로 CSP `frame-src`가 적용되지 않는 것이 스펙 동작이고, 따라서 실제 발생률은 낮고 e2e로 트리거할 방법도 마땅치 않다. 래치는 방어로만 유지하고, **폴백 경로 검증은 `uaDefaultProps`를 `undefined`로 만드는 쪽(스냅샷 복원)으로 대체한다.**
2. **페이지 DOM 오염** — `documentElement`에 노드 1개가 붙는다. overlay 호스트가 이미 같은 일을 하므로 새 위험 축은 아니지만, **`handleClear`에서 제거를 빠뜨리면 페이지에 우리 iframe이 영구히 남는다.** 세션 종료 후 iframe 부재 단언을 e2e 필수 항목으로 두되, **top 문서만 세면 안 된다** — 자식 프레임 요소를 선택하면 기준선 iframe이 자식 문서에 생긴다(PRD E6).
3. **`display:none` iframe의 computed 신뢰성** — 레이아웃이 없는 문서라 used-value 의존 prop은 무의미한 값이 나온다. `LAYOUT_DEPENDENT` 제외 목록으로 대응하지만, **그 목록이 맞다는 근거가 현재 없다.** 상수를 상수로 검증하는 테스트는 목록이 틀렸을 때 아무것도 못 잡는다 — `INTERESTING_PROPS` 79개 전체의 기준선 값을 실제 Chrome에서 덤프해 실요소와 대조하는 것이 유일한 실측 근거다(tasks.md 수동 테스트). 레이아웃 박스가 없으면 resolved value가 used가 아니라 computed로 떨어지므로 `width`가 `0px`가 아니라 `auto`로 나올 수 있고, 그러면 제외 목록의 근거 자체가 달라진다.
4. **DOM 트리 네비게이터 노출** — `dom-describe.ts`의 `isRenderable`이 overlay 호스트 id 하나만 제외하므로 새 iframe이 `<html>`의 자식으로 목록에 뜨고 **사용자가 선택할 수 있다.** 기존 `dom-tree-nav` e2e는 자식 개수를 단언하지 않아 CI로도 안 잡힌다. 제외 목록 추가 + e2e 단언으로 대응한다.
5. **`isSpecified` 전달 누락** — 저자가 UA 기본값과 같은 값을 명시한 경우(`margin: 0`) `isSpecified` 가드가 UA 축을 막아야 한다. **콜사이트에서 전달을 빠뜨리면 이 케이스가 조용히 디밍된다.** #3·#4는 현재 `isSpecified` 접근 수단이 없어 배선이 필요하므로 특히 위험하다.
6. **새 browsing context의 부수효과** — 둘 다 정적으로 확정 불가라 **실측 필요**.
   - `chrome.scripting.executeScript({allFrames:true})`(`picker-control.ts`)는 `match_about_blank`와 무관하게 살아 있는 프레임을 열거하므로 기준선 iframe에 picker/recorder-bridge가 주입될 수 있다. (정적 `content_scripts`는 `match_about_blank`가 manifest에 없어 안전하다.)
   - `webNavigation.onCommitted`가 이 프레임에 대해 발화하면 `restartPickerInFrame`이 200ms × 10회 재시도를 돈다 — picking 중 클릭마다 2초짜리 헛 메시징이 생긴다.
   - 로그 origin으로 새더라도 `originOf()`가 `"null"`을 돌려 `UNKNOWN_ORIGIN`으로 표시되므로 필터 라벨은 `about:blank`가 아니라 `__unknown__`이다 — e2e 단언은 그쪽을 봐야 한다.
7. **페이지가 기준선을 오염시킬 수 있다** — `about:blank` 자식 프레임은 부모 페이지의 origin을 상속하므로, 페이지 스크립트가 `document.getElementById("__bugshot_ua_baseline__").contentDocument`에 `<style>`을 꽂아 기준선을 조작할 수 있다. 권한 상승은 없고 UI 판정만 틀어지는 수준이라 **수용한다.** (A5는 이 위험도 소거한다.)
8. **섹션 강제 재접힘** — `Section.tsx`의 `useEffect(() => setUncontrolledOpen(defaultOpen), [defaultOpen])`는 `defaultOpen`을 초기값이 아니라 **지속 강제**로 취급한다. `selectionUpdated`가 120ms 디바운스로 반복 발화하고 거기에 `uaDefaultProps`를 새로 실으므로, **사용자가 방금 편 섹션이 편집 도중 다시 닫힐** 경로가 하나 늘어난다. 특히 cross-origin CSS 늦은 보강 구간에서는 specified를 아직 못 읽어 저자 값이 UA 축으로 걸러졌다가 보강 도착 후 되살아나 화면이 저절로 움직일 수 있다. 근본 수정(수동 토글 우선)은 이 기능 범위 밖이므로 **검증 항목으로 고정**한다.
9. **디밍 면적 확대** — 디밍 대상이 `KNOWN_DEFAULTS` 58개 범위에서 `INTERESTING_PROPS` 전체로 넓어진다. 디밍된 컨트롤은 전부 실제로 편집 가능하지만(`disabled`/`aria-disabled` 미부착), "편집 불가로 오해" 위험이 소수 필드에서 한 화면의 다수 필드로 커진다. 위 "접근성" 2건이 최소 대응이다.
10. **커스텀 엘리먼트 이름** — `doc.createElement(tagName)`이 비정상 이름에서 throw할 수 있다(대괄호·공백 포함). try/catch로 감싸고 `null` 반환.
