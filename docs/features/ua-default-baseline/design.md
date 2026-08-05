# UA 기본값 기준선 — 기술 설계

## 개요

content script가 `about:blank` 숨김 iframe을 **하나** 만들어 두고, 선택 요소의 `tagName`으로 빈 요소를 찍어 `getComputedStyle`을 뜬다. 그 결과가 UA 기본 스타일 기준선이다. 선택 요소의 computed와 값이 **같은** prop 이름만 모아 `uaDefaultProps: string[]`로 페이로드에 실어 보낸다. 사이드패널은 이 집합을 기존 `KNOWN_DEFAULTS`·`isInactiveBorderColor`와 **OR로 합쳐** 기본값을 판정한다.

기준선은 `tagName`별로 캐시한다 — Hoverify는 요소마다 iframe DOM을 만들고 지우는데(`base.js:6031`), 우리는 태그당 1회다. `innerHTML` 복사도 하지 않는다(비용 + 페이지 콘텐츠를 우리 DOM에 복제하는 프라이버시 표면).

## 변경 범위

### 신규 `src/content/ua-baseline.ts`

역할: 숨김 iframe 수명 관리 + tagName별 기준선 캐시. **브라우저 전용**이라 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 등재한다(CLAUDE.md 규칙).

```ts
/**
 * tagName의 UA 기본 computed 스타일. about:blank iframe에 맨 요소를 찍어 측정한다.
 * 실패(CSP·contentDocument null)하면 null — 호출부는 기존 판정으로 폴백한다.
 * 결과는 tagName별로 캐시되며 세션 동안 유지된다.
 */
export function getUaBaseline(tagName: string): Readonly<Record<string, string>> | null;

/** 세션 종료 시 iframe 제거 + 캐시 비움. picker의 handleClear가 부른다. */
export function disposeUaBaseline(): void;
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

`unavailable` 래치가 중요하다 — CSP로 막힌 페이지에서 요소를 고를 때마다 iframe 생성을 재시도하면 콘솔이 CSP 위반으로 도배된다.

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
2. **`collectSelection`(:223)** — `computedStyles` 채운 직후 `uaDefaultProps`를 계산해 페이로드에 싣는다.
3. `INTERESTING_PROPS`는 이미 export돼 있어 `ua-baseline.ts`가 그대로 쓴다.

### `src/content/picker.ts`

- `postSelectionUpdate`(:1123)가 `uaDefaultProps`를 함께 싣는다.
- `handleClear`(:640 부근)에서 `disposeUaBaseline()`을 부른다. `inspectorCache = new WeakMap()` 옆이 자리다.
- `removeOrphanOverlay`와 같은 자리에 `removeOrphanBaselineFrame()`을 둔다 — 이전 세션이 비정상 종료해 iframe이 남았을 때 정리. (`document.getElementById(BASELINE_HOST_ID)?.remove()`)

### `src/types/picker.ts`

```ts
export interface PickerSelectionPayload {
  // …기존 필드…
  /**
   * computed 값이 UA 기본 스타일과 같은 prop 이름들. 기준선을 못 만드는 페이지(CSP)나
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

### `src/sidepanel/tabs/styleEditor/propMetadata.ts`

**판정 진입점을 하나로 모은다.** 지금 `isKnownDefault` + `isInactiveBorderColor` 조합이 4개 콜사이트에 각각 인라인돼 있어(`sectionDefaultOpen`, `ValueCombobox:94`, `StylePropEditors:312`, `:515`) UA 축을 더하면 4곳을 손으로 맞춰야 한다 — POSTMORTEM 2026-06-28이 "같은 판정을 쓰는 3곳을 동시에 맞춰야 한다"고 남긴 바로 그 함정이다.

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

### 콜사이트 4곳

| 파일 | 현재 | 변경 후 |
|---|---|---|
| `sidepanel/lib/sectionDefaultOpen.ts:17-18` | `isKnownDefault(p,v) \|\| isInactiveBorderColor(...)` | `isDefaultValue({prop:p, value:v, isSpecified:false, …})` — `p in specifiedStyles`는 앞줄에서 이미 early-return |
| `styleEditor/ValueCombobox.tsx:94-95` | 두 함수 인라인 조합 | `isDefaultValue({…, isSpecified})` |
| `styleEditor/StylePropEditors.tsx:312` | `!value && isKnownDefault(prop, placeholder)` | `!value && isDefaultValue({…})` |
| `styleEditor/StylePropEditors.tsx:515` | 동일 | 동일 |

`uaDefaultProps`는 `useEditorStore((s) => s.selection?.uaDefaultProps)`에서 읽어 `Set`으로 감싼다. 매 렌더 새 `Set`을 만들지 않도록 `useMemo`로 고정하고, 세 컴포넌트가 각자 만들지 않게 **`styleHooks.ts`에 `useUaDefaultProps()` 훅 하나**를 둔다.

### 변경 없음

`src/store/editor-store.ts`(선택 병합이 spread라 새 필드가 자동 통과), background, manifest, i18n.

## 데이터 흐름

```
picker.selected / picker.selectionUpdated
  │
  ├─ collectSelection(el)
  │     computedStyles = INTERESTING_PROPS × getComputedStyle(el)
  │     baseline       = getUaBaseline(el.tagName)     ← tagName 캐시 히트 시 DOM 조작 0
  │     uaDefaultProps = propsMatchingBaseline(computedStyles, baseline)
  │
  ▼
editor-store.selection.uaDefaultProps: string[] | undefined
  │
  ▼
useUaDefaultProps() → ReadonlySet<string>
  │
  ├─ sectionDefaultOpen()      → 섹션 초기 펼침
  └─ isDefaultValue()          → ValueCombobox 디밍 / StylePropEditors 디밍
```

iframe 수명:

```
picker.start ─────────────────────────────────► (lazy) 첫 getUaBaseline 호출에서 생성
                                                 tagName별 캐시 누적
picker.clear / picker.stop ──► disposeUaBaseline() ──► iframe.remove() + cache.clear()
비정상 종료 후 재진입 ────────► removeOrphanBaselineFrame()
```

## 인터페이스 설계

위 절에 인라인. 요약:

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
interface PickerSelectionPayload      { uaDefaultProps?: string[] }
interface PickerSelectionUpdatePayload { uaDefaultProps?: string[] }

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

- **판정 단일 진입점 (POSTMORTEM 2026-06-28)** — 새 축을 4곳에 복제하지 않고 `isDefaultValue` 하나로 모은다. `apiHostRow.ts`가 "컴포넌트에 두면 누출이 green으로 통과한다"는 이유로 `lib/`에 있는 것과 같은 규율이다.
- **optional 페이로드 = 무손실 폴백** — 구버전 스냅샷 복원 시 `undefined`라 기존 동작. 마이그레이션 코드가 필요 없다.
- **커버리지 로직 스코프 (CLAUDE.md)** — `ua-baseline.ts`를 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 등재. 순수 비교는 `css-resolve.ts`에 두어 지표에 남긴다.
- **content script는 i18n 불가** — 이 기능은 사용자 노출 문자열이 0개라 해당 없음.

## 대안 검토

### A1. 사이드패널이 `uaDefaults` 전체 맵을 받아 직접 비교 — 기각

`uaDefaults: Record<string, string>`를 통째로 보내면 디버깅이 쉽고 사이드패널에서 비교 로직을 유닛 테스트하기도 좋다. 하지만 페이로드가 `computedStyles`만큼(약 90 entry) 커지고, 그 90개 중 실제로 필요한 정보는 "같은가 다른가" 1비트씩이다. **`selectionUpdated`는 스타일 편집 중 120ms 디바운스로 반복 발화**하므로(`scheduleSelectionUpdate`) 매 편집마다 이 페이로드가 오간다. `string[]` 쪽이 맞다.

### A2. `KNOWN_DEFAULTS` 테이블 삭제하고 UA 차분으로 전면 대체 — 기각

PRD "왜 대체가 아니라 보강인가" 표 참조. UA 차분은 border-color 케이스를 **못 잡고**(기준선의 글자색과 페이지 요소의 글자색이 달라 "다름"으로 통과), CSP 페이지에선 아예 없다. 테이블을 지우면 그 두 상황에서 오늘보다 나빠진다. POSTMORTEM 원칙 "잘못된 확정이 uncertain보다 해롭다"의 변주다.

### A3. `getComputedStyle`을 detached element로 대체 — 기각

iframe 없이 `document.createElement(tag)`를 문서에 안 붙이고 `getComputedStyle`을 부르면 빈 값이 나온다. 문서에 붙이면 페이지 CSS가 적용돼 기준선이 아니게 된다. `about:blank` 문서 컨텍스트가 필요한 이유다.

### A4. 하드코딩 UA 스타일시트 테이블 내장 — 기각

Chrome의 `html.css`를 코드에 박는 방식. 브라우저 버전·플랫폼에 따라 달라지고 유지보수가 `KNOWN_DEFAULTS`와 같은 수동 테이블 문제로 회귀한다. 런타임 실측이 이 문제를 푸는 이유 자체다.

## 위험 요소

1. **CSP `frame-src`** — `about:blank` iframe은 대개 허용되지만 `frame-src 'none'`에서 Chrome이 차단하는 사례가 있다. `contentDocument`가 `null`이면 `unavailable` 래치로 즉시 폴백하고 **재시도하지 않는다**. 폴백 경로를 e2e로 고정한다.
2. **페이지 DOM 오염** — `documentElement`에 노드 1개가 붙는다. overlay 호스트가 이미 같은 일을 하므로 새 위험 축은 아니지만, **`handleClear`에서 제거를 빠뜨리면 페이지에 우리 iframe이 영구히 남는다.** 세션 종료 후 iframe 개수 단언을 e2e 필수 항목으로 둔다.
3. **`display:none` iframe의 computed 신뢰성** — 레이아웃이 없는 문서라 used-value 의존 prop(`width`·`height`)은 무의미한 값이 나온다. 이 prop들은 `propsMatchingBaseline` 비교 대상에서 제외하므로 실해는 없지만, **비교 제외 목록을 잘못 좁히면 실제 크기가 기본값으로 판정돼 Size 섹션이 접힌다.** 제외 목록을 상수로 못 박고 테스트한다.
4. **저자가 UA 기본값과 같은 값을 명시한 경우** — `margin: 0`을 저자가 썼는데 UA 기본도 `0px`면 차분에서 걸러진다. 다만 그 prop은 `specifiedStyles`에 있으므로 `isSpecified` 가드가 먼저 걸러 `isDefaultValue`가 UA 축까지 안 간다. **`isSpecified` 전달을 콜사이트에서 빠뜨리면 이 케이스가 조용히 디밍된다** — 4곳 전부 전달을 확인한다.
5. **커스텀 엘리먼트 이름** — `doc.createElement(tagName)`이 비정상 이름에서 throw할 수 있다(대괄호·공백 포함). try/catch로 감싸고 `null` 반환.
6. **로그 레코더 오염 가능성** — `about:blank`에 `all_frames: true` content script가 주입되어 빈 프레임 origin이 로그 origin 필터(`OriginFilterBar`)에 나타날 수 있다. 실측으로 확인하고, 나타나면 origin 파생에서 `about:blank`를 제외한다. e2e 검증 항목으로 둔다.
