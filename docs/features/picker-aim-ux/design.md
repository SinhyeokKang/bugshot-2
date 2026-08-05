# 피커 조준 UX — 기술 설계

## 개요

세 가지가 서로 독립이고 전부 `src/content/picker.ts` + `src/content/overlay.ts` 안에서 끝난다.

1. **키보드 탐색 + freeze** — `onKeyDown`을 확장하고 `frozen` 모듈 상태를 하나 추가한다. `onMouseMove`가 frozen이면 조기 반환하고, `onClickCommit`이 frozen이면 커서 대신 `lastHover`를 커밋한다. 탐색 로직은 순수 함수로 뽑아 유닛 테스트한다.
2. **실렌더 폰트** — `document.fonts.check()` + canvas `measureText` 폭 비교를 판정 주입점으로 두고, 스택에서 실제로 렌더되는 첫 family를 고르는 **순수 함수**를 만든다.
3. **오버레이 자가치유** — `documentElement`에 `childList` MutationObserver를 걸고 호스트가 사라지면 재생성 + 리스너 재바인딩 + 재렌더.

## 변경 범위

### `src/content/picker.ts`

#### (1) 키보드 탐색 + freeze

새 모듈 상태:
```ts
// hover 대상을 마우스 추적에서 분리한다. 화살표 탐색은 자동으로 켜고, Space가 수동 토글.
let frozen = false;
```

`onKeyDown`(`:1108`) 재작성 — **처리하는 키만 삼킨다**:
```ts
const NAV_KEYS: Record<string, NavDirection> = {
  ArrowUp: "parent", ArrowDown: "child",
  ArrowLeft: "prev",  ArrowRight: "next",
};

function onKeyDown(e: KeyboardEvent): void {
  if (mode !== "hover") return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;        // 페이지·브라우저 단축키 보존
  if (isTextEntryTarget(e.target)) return;               // E3

  if (e.key === "Escape") { /* 기존 취소 경로 그대로 */ return; }

  const dir = NAV_KEYS[e.key];
  if (dir) {
    e.preventDefault(); e.stopPropagation();
    navigateHover(dir);
    return;
  }
  if (e.key === " " || e.code === "Space") {
    e.preventDefault(); e.stopPropagation();
    setFrozen(!frozen);
    return;
  }
  if (e.key === "Enter") {
    if (!frozen || !lastHover) return;                   // frozen 아닐 땐 페이지로 흘린다
    e.preventDefault(); e.stopPropagation();
    commitHover(lastHover);
    return;
  }
  // 나머지 키는 건드리지 않는다 — Hoverify는 keydown/keyup을 무조건
  // stopImmediatePropagation 해서 페이지 단축키를 통째로 죽인다(base.js:22883). 안 베낀다.
}
```

`navigateHover`:
```ts
function navigateHover(dir: NavDirection): void {
  const from = lastHover;
  if (!from?.isConnected) return;
  const next = stepFrom(from, dir, (el) => isOwnUi(el));   // 순수 함수 — 아래 인터페이스 절
  if (!next) return;
  setFrozen(true);            // 탐색은 언제나 freeze를 켠다 — 안 그러면 다음 mousemove가 되돌린다
  lastHover = next;
  render();
}
```

`setFrozen`:
```ts
function setFrozen(on: boolean): void {
  if (frozen === on) return;
  frozen = on;
  if (overlay) setOutlineFrozen(overlay, on);   // 시각 구분 (아래 overlay.ts)
}
```

`onMouseMove`(`:1035`) — 첫 줄 다음에 `if (frozen) return;`. **`cancelBlockerScrollYield` 앞에 둔다** — frozen 중에도 스크롤 양보 회수는 하지 않는 것이 맞다(대상이 고정돼 있으니 스크롤로 hover가 무효화되지 않는다).

`onClickCommit`(`:1070`) — frozen이면 커서 히트테스트 대신 `lastHover`를 쓴다:
```ts
const target = frozen ? lastHover : elementAtPoint(e.clientX, e.clientY);
```
나머지 경로(iframe 거부·`isOwnUi` 가드)는 그대로 탄다. 커밋 본체는 `commitHover(target)`으로 추출해 클릭·Enter 두 진입점이 공유한다.

`setMode`(`:909`) / `handleClear`(`:640`) — `frozen = false`로 초기화. mode가 hover를 벗어나면 freeze는 의미가 없다.

`onMouseOut`(`:1063`) — frozen이면 잔상 정리를 하지 않는다(`if (frozen) return;`). 커서를 사이드패널로 옮겨도 대상이 유지돼야 한다.

#### (2) 오버레이 자가치유

```ts
let hostObserver: MutationObserver | null = null;
let healCount = 0;
const MAX_HEAL = 3;          // E6 — 페이지가 계속 지우면 포기한다

function startHostObserver(): void {
  if (hostObserver) return;
  hostObserver = new MutationObserver(() => {
    if (!overlay || mode === "idle") return;
    if (document.documentElement.contains(overlay.hostEl)) return;
    healOverlay();
  });
  hostObserver.observe(document.documentElement, { childList: true });
}

function healOverlay(): void {
  if (healCount >= MAX_HEAL) {
    // 복구를 포기하고 세션을 정리한다 — 조용히 죽는 것보다 낫다.
    handleClear();
    if (activePickerSessionId) {
      postToRuntime({ type: "picker.cancelled", sessionId: activePickerSessionId });
    }
    return;
  }
  healCount++;
  const wasMode = mode;
  if (wasMode === "hover") removeHoverListeners();   // 옛 blockerEl에 붙은 리스너 회수
  destroyOverlay(overlay!);
  removeOrphanOverlay();
  overlay = createOverlay();
  if (wasMode === "hover") addHoverListeners();
  setMode(wasMode);                                  // 배너·blocker 가시성 재적용 + render()
}
```

- `MutationObserver` 콜백은 `documentElement.contains()` 한 번뿐이라 SPA의 잦은 childList 변경에도 싸다. Hoverify(`base.js:22879`)와 같은 방식이고, **`childList`만 본다** — CSS 은폐나 attribute 조작은 이 관측 범위 밖이다(Hoverify도 못 막는 영역이고 이번 범위 아님).
- `healCount`는 `handleStart`에서 0으로 초기화한다.
- `startHostObserver`는 `handleStart`에서, `stopHostObserver`(disconnect)는 `handleClear`에서 부른다. **`handleClear`가 의도적으로 호스트를 제거하므로 observer disconnect가 remove보다 먼저여야 한다** — 순서가 뒤집히면 정상 종료를 탬퍼로 오인해 오버레이를 되살린다.

#### (3) 정리 경로

`handleClear`에 `frozen = false`, `stopHostObserver()`, `healCount = 0` 추가.

### `src/content/overlay.ts`

#### (1) freeze 시각 표시

```ts
/** frozen이면 테두리를 amber로 바꾸고 배너에 표시를 단다. content script라 i18n을 못 쓰므로 기호만 쓴다. */
export function setOutlineFrozen(h: OverlayHandle, on: boolean): void;
```
- `borderEl`의 `stroke`를 `#2563eb`(기존) ↔ `#f59e0b`로 전환.
- `bannerEl` 텍스트 앞에 `⏸ `를 붙인다. `updateBanner`(`:437`)가 배너를 다시 쓰므로 frozen 상태를 모듈에 들고 있다가 함께 반영한다.

색 값은 `.picker-label[data-mode="inspector"]`가 `globals.css` 실값을 복제하는 것과 같은 사정이다 — content script라 토큰을 import할 수 없다. amber는 이미 오버레이에서 `previewEl`(`#f97316`)이 쓰는 계열과 구분되도록 `#f59e0b`를 쓴다.

#### (2) 실렌더 폰트

`buildInspectorHtml`(`:685`)의 `fontParts`가 `info.fontFamily` 대신 새 표기를 쓴다:
```ts
// 선언 첫 family와 실제 렌더 family가 다르면 화살표로 함께 보여준다.
// content script라 i18n이 없으므로 단어 대신 기호를 쓴다.
const familyLabel = info.fontFallback
  ? `${info.fontFamily} → ${info.fontRendered}`
  : info.fontFamily;
```

### `src/content/css-resolve.ts`

`InspectorInfo`(:473)에 2개 필드 추가:
```ts
export interface InspectorInfo {
  // …기존…
  /** 스택에서 실제로 렌더되는 family. 판정 불가면 fontFamily와 같다. */
  fontRendered: string;
  /** 선언 첫 family와 렌더 family가 다른가. 판정 불가면 false. */
  fontFallback: boolean;
}
```

`collectInspectorInfo`(:490)가 `resolveRenderedFamily`를 호출해 채운다. 판정 주입점(`isRendered`)은 브라우저 API를 쓰므로 별도 헬퍼로 분리한다:

```ts
/** font-family 선언 문자열을 family 목록으로 분해. 따옴표·이스케이프 인식. */
export function parseFontStack(declared: string): string[];

/**
 * 스택에서 실제로 렌더되는 첫 family. 순수 — 판정은 isRendered로 주입한다.
 * 전부 실패하면 목록의 마지막(대개 generic)을 돌려주고 fallback=true.
 * 스택이 비면 { family: "", fallback: false }.
 */
export function resolveRenderedFamily(
  stack: string[],
  isRendered: (family: string) => boolean,
): { family: string; fallback: boolean };
```

브라우저 측 판정기(`css-resolve.ts` 내부, export 안 함):
```ts
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy",
  "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "math", "emoji", "fangsong",
]);
const PROBE_TEXT = "MMMMMWWWWWiiiii0123";
const BOGUS_FAMILY = "__bugshot_no_such_font__";

function makeFontProbe(): ((family: string) => boolean) | null {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx || typeof document.fonts === "undefined") return null;
  const width = (family: string): number => {
    ctx.font = `100px ${family}`;
    return ctx.measureText(PROBE_TEXT).width;
  };
  // 존재하지 않는 이름 → 브라우저 기본 폴백 폭. 후보가 이 폭과 같으면 폴백된 것이다.
  const fallbackWidth = width(`"${BOGUS_FAMILY}"`);
  return (family) => {
    if (GENERIC_FAMILIES.has(family.toLowerCase())) return true;
    // check()만으론 부족하다 — 시스템에 없는 이름에 true를 주는 경우가 있다.
    let declared = false;
    try { declared = document.fonts.check(`100px "${family}"`); } catch { declared = false; }
    if (!declared) return false;
    return width(`"${family}", ${BOGUS_FAMILY}`) !== fallbackWidth;
  };
}
```

프로브는 요소마다 새로 만들지 않고 **모듈 스코프에 lazy 캐시**한다(canvas 1개 재사용). `fontFallback` 판정 자체는 `collectInspectorInfo` 안에서만 쓰이고 그 결과는 `inspectorCache`에 함께 담긴다.

### `src/sidepanel/tabs/IssueTab.tsx` + `src/i18n/namespaces/issue.ts`

`PickingState`(`IssueTab.tsx:451`)의 `EmptyShell`에 조작 힌트를 `children`으로 넣는다. `capture-unsupported` 분기(`:299-306`)와 **같은 패턴·같은 간격 규칙**을 따른다 — 그 자리에 이미 `{/* EmptyShell은 제목↔본문 간격을 주지 않는다 */}` 주석이 있다.

```
issue.picking.hint.navigate  ko: "화살표 키로 상위·하위·형제 요소로 이동합니다"
                             en: "Arrow keys move to parent, child, or sibling elements"
issue.picking.hint.freeze    ko: "Space로 마우스 추적을 멈추거나 다시 시작합니다"
                             en: "Space pauses or resumes mouse tracking"
```

키 표기는 `src/components/ui/kbd.tsx`를 쓴다. **POSTMORTEM 2026-07-18·07-20 주의** — `Kbd`는 `inline-flex`라 `truncate`가 안 먹고 `justify-center`가 양끝을 자른다. 짧은 라벨(`↑` `Space`)만 쓰고 폭 제약을 걸지 않는다.

ko/en 동시 갱신 필수 — `src/i18n/` 편집 시 PostToolUse 훅이 `locales.test.ts`(키 대칭·placeholder 일치)를 자동 실행해 차단한다(CLAUDE.md).

### 변경 없음

background, manifest, 권한, `src/types/picker.ts`(메시지 추가 없음 — 전부 content script 내부 상태다), 스토어.

## 데이터 흐름

```
[키보드]
 keydown (window capture, hover 모드) ─► onKeyDown
      ├─ Escape          → 기존 취소 경로
      ├─ Arrow×4         → navigateHover(dir)
      │                        stepFrom(lastHover, dir, isOwnUi)   [순수]
      │                        setFrozen(true) → setOutlineFrozen  [시각]
      │                        lastHover = next; render()
      ├─ Space           → setFrozen(!frozen)
      ├─ Enter (frozen)  → commitHover(lastHover)
      └─ 그 외           → 건드리지 않음 (페이지로 흐름)

[마우스]
 mousemove ─► onMouseMove ─► if (frozen) return;   ← 새 게이트
 click     ─► onClickCommit ─► target = frozen ? lastHover : elementAtPoint(...)

[자가치유]
 MutationObserver(documentElement, {childList}) 
      └─ !contains(hostEl) → healOverlay()
             removeHoverListeners → destroyOverlay → createOverlay
             → addHoverListeners → setMode(wasMode) → render()
             (healCount ≥ 3이면 handleClear + picker.cancelled)

[폰트]
 collectInspectorInfo(el)
      parseFontStack(cs.fontFamily)          [순수]
      → resolveRenderedFamily(stack, probe)  [순수 + 주입]
      → InspectorInfo.fontRendered / fontFallback
      → buildInspectorHtml → "Pretendard → sans-serif"
```

## 인터페이스 설계

```ts
// src/content/picker.ts (내부)
type NavDirection = "parent" | "child" | "prev" | "next";

// src/content/dom-nav.ts (신규 — 순수, 로직 스코프에 남긴다)
/**
 * from에서 dir 방향의 다음 요소. skip이 true인 요소(우리 UI)는 건너뛴다.
 * 대상이 없으면 null. document/window에 접근하지 않는다 — el의 프로퍼티만 읽는다.
 */
export function stepFrom(
  from: Element,
  dir: NavDirection,
  skip: (el: Element) => boolean,
): Element | null;

/** 화살표·Space를 페이지에 양보해야 하는 입력 대상인가. */
export function isTextEntryTarget(target: EventTarget | null): boolean;
```

```ts
// src/content/css-resolve.ts
export function parseFontStack(declared: string): string[];
export function resolveRenderedFamily(
  stack: string[],
  isRendered: (family: string) => boolean,
): { family: string; fallback: boolean };

export interface InspectorInfo {
  // …기존…
  fontRendered: string;
  fontFallback: boolean;
}
```

```ts
// src/content/overlay.ts
export function setOutlineFrozen(h: OverlayHandle, on: boolean): void;
```

`stepFrom` 형제 방향 처리에서 `skip` 요소를 만나면 **그 방향으로 계속 진행**한다(건너뛰기이지 중단이 아니다). `child` 방향은 `firstElementChild`부터 시작해 `skip`이면 `nextElementSibling`으로 이어간다.

## 기존 패턴 준수

- **순수 로직은 content script 밖으로** — `picker.ts`·`overlay.ts`는 `scripts/coverage-report.mjs`의 `BROWSER_BOUND_EXACT`에 있어 커버리지 로직 스코프 밖이다. `stepFrom`/`isTextEntryTarget`은 신규 `dom-nav.ts`에, 폰트 순수 함수는 `css-resolve.ts`에 둔다 — **둘 다 로직 스코프에 남아 유닛 테스트가 지표에 반영된다.** (`css-resolve.ts`·`frame-geometry.ts`가 이미 같은 이유로 content 디렉터리에 있으면서 로직 스코프에 남아 있다.)
- **i18n 두 벌 (CLAUDE.md)** — 새 키는 `src/i18n/namespaces/issue.ts` ko/en 동시 갱신. log-viewer 복제 사전(`src/log-viewer/i18n.ts`)은 picking UI를 재사용하지 않으므로 **해당 없음**.
- **UI 패턴 확인** — `PickingState` 수정 전 같은 파일의 `capture-unsupported` 분기(`:299-306`)를 읽고 간격·타이포 규칙을 그대로 따른다.
- **content script 문구는 기호로** — `overlay.ts`에는 i18n이 없다. 배너의 freeze 표시는 단어가 아니라 `⏸`, 폰트 폴백은 `→`를 쓴다.
- **`e.preventDefault()` 남용 금지** — `addHoverListeners`(`:958-962`)의 기존 주석이 "preventDefault는 안 붙인다"는 판단 근거를 남기고 있다. 키보드는 사정이 다르지만(화살표는 스크롤을 유발한다) **우리가 처리하는 키에만** 붙인다.

## 대안 검토

### A1. Hoverify처럼 keydown/keyup을 전면 차단 — 기각

Hoverify는 인스펙터가 켜진 동안 document·body에서 `stopImmediatePropagation()`을 무조건 부른다(`base.js:22883-22893`). 구현은 단순하지만 **picking 중 페이지 단축키가 전부 죽는다**. BugShot은 버그 리포팅 도구라 사용자가 picking 중에도 페이지를 조작해야 하는 경우가 있고(예: 모달을 열어둔 채 요소 고르기), 페이지 상태를 우리가 바꾸는 건 before/after 스냅샷의 신뢰를 깎는다.

### A2. freeze를 <kbd>Shift</kbd> 홀드로 — 기각

토글 상태 관리가 없어 단순하지만, 얼린 채로 화살표를 여러 번 누르는 조작이 불가능하다(Shift+Arrow는 대개 선택 확장이다). 토글이 맞다.

### A3. 화살표 탐색을 sidepanel 메시지로 왕복 — 기각

`picker.navigate` 메시지가 이미 있으니 재사용하는 방향. 하지만 hover 대상은 **content script만 아는 상태**(`lastHover`)라 왕복할 이유가 없고, 라운드트립이 끼면 연타 시 순서가 꼬인다. 로컬에서 끝낸다.

### A4. 폰트 판정을 `document.fonts.check()`만으로 — 기각

`check()`는 시스템에 설치되지 않은 이름에도 `true`를 주는 경우가 있어(구현 편차) 폴백을 놓친다. Hoverify가 canvas 폭 비교를 함께 쓰는 이유(`base.js:8582-8601`)가 그것이고 이 부분은 베낀다. 다만 Hoverify는 arial과 비교하는데, arial이 없는 환경에서 오판하므로 **존재하지 않는 이름의 폴백 폭**을 기준으로 삼는다.

### A5. 자가치유를 폴링(setInterval)으로 — 기각

MutationObserver가 이벤트 기반이라 더 싸고 빠르다. 폴링은 간격만큼 죽어 있는 시간이 생긴다.

## 위험 요소

1. **`healOverlay`의 리스너 이중 등록** — `addHoverListeners`는 `overlay.blockerEl`에 리스너를 붙인다. 옛 오버레이를 파괴하기 전에 `removeHoverListeners`를 부르지 않으면 window 리스너(`mousemove`·`keydown`)가 중복 등록돼 이벤트가 두 번 처리된다. **순서가 계약이다.**
2. **정상 종료를 탬퍼로 오인** — `handleClear`가 호스트를 제거하는데 observer가 살아 있으면 즉시 재생성한다. `stopHostObserver()`가 `destroyOverlay`보다 먼저여야 한다. e2e로 "세션 종료 후 오버레이가 되살아나지 않는다"를 고정한다.
3. **frozen 중 요소 detach (E4)** — `navigateHover`·`render`가 `isConnected`를 확인한다. 놓치면 사라진 요소에 하이라이트가 남는다.
4. **Space가 페이지 스크롤을 유발** — `preventDefault()`가 필수다. 다만 picking 중엔 blocker가 hit target이라 대개 스크롤이 안 먹는다 — **blocker가 스크롤을 양보한 창(`yieldToScroll`, 120ms)에서는 먹는다.** 이 창에서 Space가 새면 페이지가 밀리므로 preventDefault를 반드시 건다.
5. **canvas 폰트 프로브 비용** — `measureText`는 싸지만 요소마다 부르면 누적된다. 프로브 자체를 모듈 캐시하고, 결과는 `inspectorCache`에 담겨 요소당 1회다. `scheduleInspectorRefresh`가 캐시를 비우면 재계산되지만 hover 대상 1개뿐이라 무해하다.
6. **폰트 폴백 오탐** — 두 폰트의 메트릭이 우연히 같으면 오판한다. 실해는 카드 표기가 한 줄 달라지는 것뿐이고, 리포트 본문·캡처·스타일 값에는 영향이 없다. 수용한다.
7. **iframe 프레임 경계 (E5)** — 화살표·freeze는 keydown을 받은 프레임의 `lastHover`에만 작용한다. 부모에서 화살표를 눌러 자식 iframe 내부로 들어가지 않는다(의도된 제약). 자식 프레임에 포커스가 있으면 자식 picker가 자기 키를 처리한다.
