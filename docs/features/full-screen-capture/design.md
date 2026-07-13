# 전체 화면 캡처 — 기술 설계

## 개요

캡처 방식 3축(영역 / 뷰포트 / 스크롤)을 **하나의 종착점**으로 모은다: 어떤 방식이든 마지막은 기존 `useEditorStore.onAreaCaptured(dataUrl, viewport)` 호출이고, phase 전이·첨부·어노테이션은 전부 기존 코드가 담당한다.

- **뷰포트 캡처**: 새 캡처 코드를 만들지 않는다. `area-select.ts`의 드래그 완료 경로를 **뷰포트 전체 rect로 재사용**한다. 드래그 완료(`onMouseUp`, L164-185)가 이미 `removeListeners → cleanupElements → onBlockerRequest("hide") → deps.onSelected(rect, viewport)` 순서로 동작하고, `picker.ts`의 `onSelected` 콜백(L940-949)이 `picker.areaSelected`를 사이드패널로 보내면 `captureAndCrop`이 captureVisibleTab → 크롭 → drafting까지 처리한다. **오버레이 정리가 캡처 요청보다 먼저 끝나는 순서 보장을 드래그 경로와 공유**하는 게 핵심 이점(오버레이가 스크린샷에 찍히는 사고를 구조적으로 차단).
- **스크롤 캡처**: 신규 경로. 사이드패널이 오케스트레이터가 되어 `scrollTo → captureVisibleTab → 다음 타일` 루프를 돌고 canvas로 세로 스티칭한다. content script는 스크롤·고정 요소 숨김·복원만 담당하는 얇은 executor다. 진행 중 **선택 오버레이(dim·rect·라벨)는 걷되 투명 blocker는 유지**해 페이지 클릭을 차단한다(blocker는 투명이라 캡처 무오염). **[취소]로 중단 가능**(abort → 원복 → idle).

여기에 브라우저 줌 대응으로 크롭 rect 클램프 가드를 추가한다(area/inline 크롭 경로 공통 — element-shot의 별도 `capture.ts:cropImage`는 스코프 외).

### 캡처 이미지 vs 메타 viewport

`onAreaCaptured(dataUrl, viewport)`의 `viewport`는 **리포트 메타("뷰포트 크기")**로만 쓰인다(`buildEditorCapture.ts:100`, `PreviewPanel.tsx:342`). 스티치 이미지가 뷰포트보다 세로로 길어도 **viewport에는 실제 브라우저 뷰포트를 그대로 넘긴다**(스티치 높이를 넣지 않는다). 어노테이션 오버레이는 이미지 natural 크기 기준이라 영향 없다.

## 변경 범위

### 1. `src/types/picker.ts` — 메시지 타입 추가

`picker.cancelAreaSelect`(L98) 아래에 추가.

```ts
| { type: "picker.selectFullViewport" }              // 뷰포트 캡처
| { type: "picker.beginScrollCapture" }              // 스크롤 캡처 준비 → { metrics: PageMetrics } 응답
| { type: "picker.scrollCaptureTo"; y: number; hideFixed: boolean }  // 타일 스크롤 → ScrollAck 응답
| { type: "picker.endScrollCapture" }                // 스크롤·고정 요소·blocker 복원
```

응답 타입도 같은 파일에 둔다.

```ts
export interface PageMetrics {
  scrollHeight: number;        // document.scrollingElement.scrollHeight (CSS px)
  viewport: { width: number; height: number };  // innerWidth/innerHeight
  devicePixelRatio: number;    // 캔버스 높이 한계 검사용 — plan은 첫 캡처 전이라 이미지에서 scale을 얻을 수 없다
}
export interface ScrollAck {
  y: number;                   // 실제 도달한 scrollY (문서 끝에서 클램프될 수 있음)
}
```

### 2. `src/content/area-select.ts` — 전체 뷰포트 선택 함수 추가

`cancelAreaSelect`(L81-85) 옆에 대칭 함수를 추가. 정리 3단계는 `cancelAreaSelect`와 동일하고, `onCancelled` 대신 뷰포트 전체 rect로 `onSelected`를 부른다.

```ts
export function selectFullViewport(handle: AreaSelectHandle): void {
  removeListeners(handle);
  cleanupElements(handle);
  handle._deps.onBlockerRequest("hide");
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  handle._deps.onSelected({ x: 0, y: 0, ...viewport }, viewport);
}
```

### 3. `src/content/scroll-capture.ts` — **신규 파일**, 스크롤 캡처 executor

DOM 조작 전담(순수 함수 아님). picker.ts가 얇게 위임한다.

```ts
export interface ScrollCaptureSession {
  originalScroll: { x: number; y: number };
  // 첫 hideFixed 호출에서 1회 수집·캐시 — 타일마다 querySelectorAll("*") 전수 순회를 반복하지 않는다(강제 리플로우 비용)
  hiddenFixed: Array<{ el: HTMLElement; prevValue: string; prevPriority: string }> | null;
}

export function beginScrollCapture(): { session: ScrollCaptureSession; metrics: PageMetrics };
export function scrollCaptureTo(session, y: number, hideFixed: boolean): Promise<ScrollAck>;
export function endScrollCapture(session): void;
```

- `beginScrollCapture`: 현재 스크롤 저장 + `scrollHeight`/`innerWidth`/`innerHeight`/`devicePixelRatio` 측정. `document.scrollingElement`가 null(quirks mode)이면 `document.documentElement` 폴백.
- `scrollCaptureTo`: `hideFixed=true`이고 캐시가 없으면 고정 요소를 1회 수집·숨김 → `window.scrollTo({ top: y, behavior: "instant" })`(**반드시 옵션 객체** — 2-arg 호출은 페이지 CSS `scroll-behavior: smooth`에 밀려 애니메이션이 남는다; 옵션 객체의 `instant`는 표준상 override 보장) → **rAF 2회 + `setTimeout` 폴백(500ms)** 후 실제 `window.scrollY`를 응답. rAF 폴백은 `handlePrepareCaptureBySelector`(`picker.ts:340-382` — 그쪽은 `scrollIntoView`지만 rAF×2 + 폴백 구조가 동일)의 기존 패턴을 따른다(hidden 탭 rAF 미발화 대비).
- 고정 요소 수집·숨김: `document.body.querySelectorAll("*")`를 순회하며 `getComputedStyle(el).position`이 **`fixed`인 요소만** 수집(picker·annotation host 제외). **sticky는 제외** — 문서 흐름 안의 실제 콘텐츠(사이드바·표 헤더)라 숨기면 그 자리가 빈다(반복 인쇄 아티팩트보다 콘텐츠 소실이 나쁘다 — PRD의 fallback 채택). 수집은 **scrollTo settle 이후**에 1회 — "스크롤하면 헤더를 fixed로 바꾸는" 사이트를 스크롤 전에 훑으면 못 잡는다. open shadow root 내부 fixed는 미탐(한계). 숨김은 `el.style.visibility = "hidden"` 직접 대입이 아니라 **기존 picker 스타일 조작 패턴(picker.ts L489-503, L596-615)대로 prev 값·priority 저장 + `setProperty("visibility", "hidden", "important")`** — 페이지의 `visibility: visible !important`에 지지 않고 복원 시 인라인 원값을 정확히 되살린다. **`display:none`이 아니라 `visibility`** — 레이아웃이 바뀌면 스티치 타일이 어긋난다. `transition: visibility`가 걸린 요소는 잔상이 남을 수 있다(수동 테스트 항목).
- `endScrollCapture`: 고정 요소 원복 + `window.scrollTo({ ...originalScroll, behavior: "instant" })`.

### 4. `src/content/picker.ts` — 메시지 핸들러

switch(L253-258)에 case 4개 추가 + 핸들러.

```ts
function handleSelectFullViewport(): void {
  if (!areaHandle) return;          // 드래그 완료/취소 직후 레이스 → no-op
  selectFullViewport(areaHandle);   // onSelected 콜백이 areaHandle=null·postToRuntime·handleClear 처리
}
```

`handleStartAreaSelect`가 등록한 `onSelected` 콜백(L940-949)이 그대로 실행되므로 `areaHandle = null`, `postToRuntime`, `mode = "idle"`, `handleClear()`를 **중복 작성하지 않는다**. (콜백에는 `restoreAfter` 분기가 있으나 CapturingState 경로는 `restoreAfter` 미사용 — 비복원 분기를 탄다.)

스크롤 캡처는 오버레이를 직접 걷되 **blocker는 재표시**한다(클릭 차단 유지, PRD 결정).

```ts
let scrollSession: ScrollCaptureSession | null = null;

function handleBeginScrollCapture(): { metrics: PageMetrics } {
  if (areaHandle) { cancelAreaSelect(areaHandle); areaHandle = null; }  // dim·rect·라벨·리스너 제거(blocker도 hide됨)
  if (overlay) setBlockerVisible(overlay, true);   // blocker 재표시 — 투명·기본 커서(crosshair 아님)로 클릭 차단. 캡처엔 안 찍힘
  mode = "idle";
  const { session, metrics } = beginScrollCapture();
  scrollSession = session;
  return { metrics };
}
// picker.scrollCaptureTo → scrollCaptureTo(scrollSession, y, hideFixed)
//   세션 없으면(네비게이션·재주입) **무응답** — ack를 주면 사이드패널이 스크롤 안 된 화면을
//   남은 타일 수만큼 찍어 깨진 이미지를 "성공"으로 넘긴다. 무응답 → send undefined → 중단.
// picker.endScrollCapture → endScrollCaptureAndClear()
function endScrollCaptureAndClear(): void {
  if (!scrollSession) return;
  endScrollCapture(scrollSession);
  scrollSession = null;
  if (overlay) setBlockerVisible(overlay, false);
  handleClear();
}
```

**content 자가 복원(안전망)**: `finally`의 `picker.endScrollCapture`는 사이드패널이 살아 있을 때만 나간다. 패널 닫힘·탭 전환으로 오케스트레이터가 죽으면 페이지에 숨긴 고정 요소 + 엉뚱한 스크롤이 영구 잔류하므로, **`handleClear()`(picker.ts:432-463)와 picker port disconnect 정리 경로에 `scrollSession` 존재 시 `endScrollCapture` 호출을 배선**한다(멱등 — 이미 정리됐으면 no-op). 페이지 네비게이션으로 content script 자체가 소멸하는 경우는 새 문서 로드가 자연 복원.

**async 응답 계약**: `picker.scrollCaptureTo`는 rAF 대기가 있는 **비동기 sendResponse**다. 기존 관례(`collectTokens`, picker.ts L199-210)대로 `void (async () => { ...; sendResponse(...) })(); return true;` 패턴을 쓰고, switch 하단의 공통 `sendResponse({ ok: true })` fallthrough(L278)로 흘러 **이중 응답이 나지 않도록** case에서 정확히 return한다. `beginScrollCapture`/`endScrollCapture`는 동기 응답.

### 5. `src/sidepanel/lib/scroll-capture-plan.ts` — **신규 파일**, 순수 함수

스크롤 계획과 스티치 좌표를 계산한다. DOM·canvas를 만지지 않아 단위 테스트가 쉽다.

```ts
export const MAX_SCROLL_TILES = 20;
export const MAX_CANVAS_HEIGHT_PX = 32000;   // 브라우저 캔버스 한계(≈32767) 아래 여유

export interface TilePlan { index: number; scrollY: number }
export interface ScrollPlan {
  tiles: TilePlan[];
  totalHeight: number;   // 실제로 담기는 CSS px 높이 (상한에 걸리면 잘린 높이)
  truncated: boolean;    // 타일 상한 또는 캔버스 높이 한계로 잘렸는가
}

export function planScrollCapture(metrics: PageMetrics, maxTiles = MAX_SCROLL_TILES): ScrollPlan;

// 타일 i의 캡처 이미지에서 어느 부분을 잘라 캔버스 어디에 붙일지 (겹침 보정 포함)
export interface TileDraw { srcY: number; srcHeight: number; destY: number }
export function tileDrawRect(plan: ScrollPlan, index: number, actualY: number): TileDraw;
// CSS px → 픽셀 변환(절대 경계 반올림). destScale은 출력 다운스케일이 걸리면 srcScale과 갈린다.
export function tilePixelRect(plan, index, actualY, srcScale, destScale?): TilePixelRect;
```

- 타일 스크롤 y는 `0, vh, 2vh, ...`이고 마지막 타일은 문서 끝에서 클램프되어 직전 타일과 **겹친다** → `tileDrawRect`가 `actualY`(content script가 응답한 실제 scrollY)를 받아 겹친 만큼 `srcY`를 밀어 잘라낸다. 이 겹침 보정을 빼면 마지막 화면이 중복 출력된다.
- **캔버스 높이 한계 검사**: `totalHeight × metrics.devicePixelRatio`가 `MAX_CANVAS_HEIGHT_PX`를 넘으면 타일 수를 추가로 줄인다(예: vh 1000 × DPR 2 × 20타일 = 40000px 초과). DPR은 `PageMetrics`로 받는다 — plan은 첫 캡처 **전**이라 이미지에서 scale을 얻을 수 없다.
- `truncated`면 `totalHeight = 잘린 타일 수 × vh`.
- 방어: `vh ≤ 0` 또는 `scrollHeight ≤ 0`이면 타일 1개(0, vh는 최소 1) 계획으로 강등 — 타일 y 루프가 무한 루프 좌표를 만들지 않게 한다.

### 6. `src/sidepanel/lib/crop-rect.ts` — **신규 파일**, 순수 함수

크롭 rect를 캡처 이미지 경계 안으로 클램프. 브라우저 줌 ≠ 100%일 때 `viewport CSS px × DPR`이 실제 캡처 이미지 크기와 어긋나 크롭이 경계를 넘고 가장자리에 투명 픽셀이 생기는 것을 막는다.

```ts
export interface CropRect { x: number; y: number; width: number; height: number }
export function clampCropRect(rect: CropRect, imgWidth: number, imgHeight: number): CropRect;
```

- `x`/`y`를 `[0, imgWidth/imgHeight]`로 클램프, `width`/`height`를 남은 영역 안으로 자르고 최소 1px 보장, 이미지 크기가 0 이하면 rect를 그대로 반환(방어).

### 7. `src/sidepanel/hooks/usePickerMessages.ts` — 크롭 가드

로컬 `cropImage`(L373-395) 안에서 이미지 로드 직후 `clampCropRect`를 적용한다. `captureAndCrop`(L352-371)·`captureAndInsertInline`(L397-430) 둘 다 `cropImage`를 경유하므로 **한 곳만 고치면 두 경로가 함께 보호**된다. DPR 곱셈(L357)·webp 0.92 인코딩은 그대로.

### 8. `src/sidepanel/scroll-capture.ts` — **신규 파일**, 오케스트레이터

```ts
export interface ScrollStitcher { add(tile: TileShot): Promise<void>; finish(): Promise<string> }
export interface ScrollCaptureDeps {
  send; captureTab; isTabActive; createStitcher;   // 전부 chrome/canvas 의존 → 단위 테스트용 DI
}
export async function runScrollCapture(
  tabId: number,
  opts: { onProgress: (done: number, total: number) => void; signal: AbortSignal; deps?: ScrollCaptureDeps },
): Promise<{ dataUrl: string; viewport: { width: number; height: number }; truncated: boolean }>;
```

절차:
1. `send(tabId, { type: "picker.beginScrollCapture" }, 0)` → `PageMetrics`. **응답이 `undefined`면(주입 소실·네비게이션 — `send`는 실패 시 throw가 아니라 `undefined` 반환) 즉시 중단.**
2. `planScrollCapture(metrics)` → 타일 목록.
3. 타일 루프(직렬), 각 타일마다:
   - `signal.aborted`면 중단(사용자 [취소]).
   - `chrome.tabs.get(tabId)` → `!tab.active`면 중단(**탭 전환 오염 방지** — 30s replay tick과 같은 가드).
   - `send(tabId, { type: "picker.scrollCaptureTo", y, hideFixed: index > 0 }, 0)` → `ScrollAck`. `undefined`면 중단.
   - `sendBg<string>({ type: "captureVisibleTab", tabId })` → dataUrl (**background 관문 경유 — 직접 호출 금지**, POSTMORTEM 2026-06-29)
   - `onProgress(index + 1, tiles.length)`
4. `finally`로 **반드시** `send(tabId, { type: "picker.endScrollCapture" }, 0)` — 성공·실패·취소 모두 스크롤·고정 요소·blocker 복원. (사이드패널 자체가 죽는 경로는 content 자가 복원이 커버 — §4.)
5. 스티칭(**스트리밍**): 타일을 받는 즉시 캔버스에 그리고 버린다(`ScrollStitcher.add/finish`) — 20장을 모아뒀다 한 번에 디코드하면 고DPR 대형 뷰포트에서 수백 MB 비트맵이 동시에 살아 패널이 죽는다. 배율은 첫 타일 이미지의 `naturalWidth / metrics.viewport.width`(DPR × 줌을 한 번에 흡수, `capture.ts:58-93` 패턴). 좌표는 순수 함수 `tilePixelRect(plan, index, actualY, srcScale, destScale)`가 **시작·끝 경계를 각각 반올림**해 돌려준다 — 높이를 따로 반올림하면 분수 배율에서 타일 경계마다 ±1px 틈이 생긴다. 출력이 `MAX_OUTPUT_PIXELS`(8M)를 넘으면 `destScale`을 낮춰 다운스케일(스티치 결과는 `chrome.storage.session` 10MB 쿼터에 dataURL로 직렬화되고, 넘치면 lite 스냅샷으로 강등돼 캡처가 조용히 사라진다). 인코딩은 `toDataURL("image/webp", 0.92)`.
6. 반환값의 `viewport`는 **실제 뷰포트**(스티치 높이 아님).

호출부(`IssueTab`):
- 완료 시 **`useEditorStore.getState().phase === "capturing"` 재확인 후** `onAreaCaptured(dataUrl, viewport)` — 진행 중 기존 reset 분기 3곳(`useEditorSessionSync.ts:210-218`(세션 키 삭제)·`:252-261`(탭 URL 변경)·`App.tsx:152-157`(picker port 단절))이 발화했으면 결과 폐기(유령 drafting 진입 차단).
- 취소: [취소] 클릭 → `AbortController.abort()` → 루프 중단 → `finally` 원복 → `reset()`.
- 실패: `maybeSurfacePermissionExpired` → `reset()` (기존 `captureAndCrop` 에러 처리와 동일한 형태).

**30s Replay 폴링**: 별도 pause 불필요 — `use-30s-replay.ts:63`의 tick 가드가 `phase !== "idle"`이면 이미 skip하므로 capturing phase 동안 폴링은 자동 정지 상태다. (수동 테스트로 검증만 한다.)

### 9. `src/sidepanel/picker-control.ts` — 송신 함수

`cancelAreaCapture`(L622) 옆에 추가. area-select·스크롤 캡처 모두 top frame 한정이므로 `frameId: 0`.

```ts
export async function captureFullViewport(tabId: number): Promise<void> {
  await send(tabId, { type: "picker.selectFullViewport" }, 0);
}
```

store를 직접 만지지 않는다 — phase 전이는 `picker.areaSelected` 수신부가 담당(기존 드래그와 동일).

### 10. `src/sidepanel/tabs/IssueTab.tsx` — UI

- `CapturingState`를 `RecordingState`(L377-423)처럼 **본문 + 하단 footer** 구조로 확장: 본문은 기존 `EmptyShell`([취소] 버튼 유지), 하단에 캡처 방식 툴바 footer.
- footer는 기존 녹화 footer의 **자리와 컨테이너 클래스(`border-t border-border bg-background p-4`)만 공유**한다 — 기존 녹화 footer는 ButtonGroup이 아니라 그룹 컴포넌트 3개를 `justify-between`으로 나열하는 구조라 "마크업 그대로"가 아니다. 여기는 버튼 3개 단일 그룹이므로 `justify-center` + `ButtonGroup`(shadcn, `src/components/ui/button-group.tsx` — IssueTab에서 기사용)을 새로 채택한다. **세그먼트 융합 룩(버튼이 붙는)은 의도** — 캡처 방식 선택기임을 시각적으로 묶는다.

```tsx
<div className="flex shrink-0 items-center justify-center gap-2 border-t border-border bg-background p-4">
  <ButtonGroup className="flex-nowrap">
    {/* 영역 선택 / 뷰포트 캡처 / 스크롤 캡처 — h-8 w-8, variant="outline", 활성 시 bg-muted */}
  </ButtonGroup>
</div>
```

- 버튼 3개는 `ToolbarGroups.tsx`의 `ToolButton` **클래스 규칙만 복제**(`size="icon"` + `h-8 w-8 shrink-0` + `variant="outline"` + 활성 `bg-muted` + `title`/`aria-label` i18n). 컴포넌트 자체는 재사용하지 않는다 — 그쪽은 어노테이션 툴 프리셋(`presets.ts`)에 묶여 있어 타입이 다르다.
- 아이콘(lucide): 영역 선택 `Crop`, 뷰포트 캡처 `Fullscreen`(`Monitor`는 SettingsTab 테마 system 옵션에 기사용 + 화면 녹화 `MonitorPlay`와 거의 동일해 오독 위험 — 기각), 스크롤 캡처 `ScrollText`.
- **활성 상태**: `capturing` 진입 시 [영역 선택]이 `bg-muted` 활성(페이지에 오버레이가 깔린 그 모드), 클릭은 **no-op**. `aria-pressed`는 **영역 선택 버튼에만** 붙인다 — 뷰포트/스크롤은 토글이 아니라 즉시 실행 액션이라 pressed 시맨틱이 어긋난다. 뷰포트/스크롤 버튼의 `title`에 "클릭 즉시 캡처됩니다" 뉘앙스를 라벨로 전달.
- **로딩(스크롤 캡처)**: 로컬 state `scrollProgress: { done, total } | null`. 진행 중에는
  - 툴바 버튼 3개 `disabled`, 스크롤 캡처 버튼 아이콘을 `Loader2 animate-spin`으로 교체(`ReplayButton`의 `isEncoding` 패턴, L282-288).
  - `EmptyShell` title을 `issue.capturing.scrolling`("페이지를 캡처하는 중…")으로 교체하고 진행 표시를 붙인다. **`EmptyShell`(L475-491)은 `{icon, title, action?}`만 받아 진행 노드를 끼울 슬롯이 없다** → `children`(title 아래 렌더) 슬롯을 추가한다. 진행 표시는 `n / N` 텍스트 + 녹화 진행 바 마크업(L390-395 — 바 자체만 있고 텍스트는 별도) 재사용.
  - **[취소]는 enabled 유지** — 클릭 시 `AbortController.abort()`(§8). Esc는 스크롤 캡처 중 무반응(비목표).
- `truncated`면 drafting 진입 후 **`toast.info`**(정보성 안내 관례 — AiDraftDialog contextTrimmed·ReplayTrimDialog 선례)로 "페이지가 길어 일부만 캡처했습니다". 정상 완주 시 toast 없음(성공 toast는 draft.saved 1건뿐인 관례 유지).
- `data-testid`: `capture-method-area` / `capture-method-viewport` / `capture-method-fullpage`, 취소 `capturing-cancel`(현재 없음 — 신규).

### 11. `src/i18n/namespaces/issue.ts` — 라벨

| 키 | ko | en |
|---|---|---|
| `issue.capturing.method.area` | 영역 선택 | Select area |
| `issue.capturing.method.viewport` | 뷰포트 캡처 | Capture viewport |
| `issue.capturing.method.fullPage` | 스크롤 캡처 | Capture full page |
| `issue.capturing.scrolling` | 페이지를 캡처하는 중… | Capturing page… |
| `issue.capturing.progress` | `{percent}%` | `{percent}%` |
| `issue.capturing.truncated` | 페이지가 길어 일부만 캡처했습니다 | Page was too long — captured part of it |

ko/en 동시 추가(PostToolUse 훅이 `locales.test.ts`로 대칭 검사).

## 데이터 흐름

### 뷰포트 캡처

```
[사이드패널] 툴바 [뷰포트 캡처] 클릭 → captureFullViewport(tabId)
  → sendMessage(tabId, {type:"picker.selectFullViewport"}, {frameId:0})
[content/picker.ts] handleSelectFullViewport() → areaHandle 없으면 no-op / 있으면 selectFullViewport(areaHandle)
[content/area-select.ts] removeListeners → cleanupElements → onBlockerRequest("hide")   ← 오버레이가 여기서 걷힘
  → deps.onSelected({x:0,y:0,width:innerWidth,height:innerHeight}, viewport)
[content/picker.ts] 기존 onSelected 콜백 → postToRuntime("picker.areaSelected") + mode="idle" + handleClear()
[사이드패널] usePickerMessages L166 → captureAndCrop → sendBg("captureVisibleTab") → cropImage(+clampCropRect)
  → onAreaCaptured → phase: "drafting"
```

**오버레이 정리가 `postToRuntime`보다 먼저 끝난다**는 게 캡처 오염을 막는 유일한 장치다. 드래그 경로에서 검증된 순서를 그대로 공유한다.

### 스크롤 캡처

```
[사이드패널] 툴바 [스크롤 캡처] 클릭 → runScrollCapture(tabId, {onProgress, signal})
  ① picker.beginScrollCapture ──▶ [content] area-select 취소(dim·rect·라벨 제거) + blocker 재표시(투명, 클릭 차단)
                                    + 스크롤 저장 + 메트릭 측정
                              ◀── PageMetrics { scrollHeight, viewport, devicePixelRatio }
  ② planScrollCapture(metrics) → tiles[0..N-1] (N ≤ 20, 캔버스 한계 추가 축소, 초과 시 truncated)
  ③ for each tile:  (signal.aborted → 중단 / tab.active 아님 → 중단 / send 응답 undefined → 중단)
       picker.scrollCaptureTo { y, hideFixed: i>0 } ──▶ [content] (첫 hideFixed에서 fixed/sticky 1회 수집·캐시,
                                                        setProperty("visibility","hidden","important"))
                                                        scrollTo({top:y, behavior:"instant"}) → rAF×2 (+500ms 폴백)
                                                   ◀── ScrollAck { y: 실제 scrollY }
       sendBg("captureVisibleTab") → background messages.ts → captureThrottle(500ms 직렬 큐) → chrome.tabs.captureVisibleTab
       onProgress(i+1, N)  → 사이드패널 로딩 n/N 갱신
  ④ finally: picker.endScrollCapture ──▶ [content] fixed 원복 + 원래 스크롤 복원 + blocker hide + scrollSession=null
       (패널 사망 시: content의 handleClear/port disconnect가 scrollSession 자가 복원)
  ⑤ 스티칭: canvas(vw·totalHeight × dprScale) ← tileDrawRect(겹침 보정) drawImage → webp 0.92
  ⑥ phase==="capturing" 재확인 → onAreaCaptured(stitched, 실제 viewport) → "drafting" (+truncated면 toast.info)
       (재확인 실패 = 진행 중 reset 발화 → 결과 폐기)
```

## 인터페이스 설계

```ts
// src/types/picker.ts (PickerMessage union + 응답 타입)
| { type: "picker.selectFullViewport" }
| { type: "picker.beginScrollCapture" }
| { type: "picker.scrollCaptureTo"; y: number; hideFixed: boolean }
| { type: "picker.endScrollCapture" }
export interface PageMetrics { scrollHeight: number; viewport: { width: number; height: number }; devicePixelRatio: number }
export interface ScrollAck { y: number }

// src/content/area-select.ts
export function selectFullViewport(handle: AreaSelectHandle): void;

// src/content/scroll-capture.ts (신규)
export function beginScrollCapture(): { session: ScrollCaptureSession; metrics: PageMetrics };
export function scrollCaptureTo(session: ScrollCaptureSession, y: number, hideFixed: boolean): Promise<ScrollAck>;
export function endScrollCapture(session: ScrollCaptureSession): void;

// src/sidepanel/picker-control.ts
export async function captureFullViewport(tabId: number): Promise<boolean>;  // false = content가 area-select 상태 아님 → reset()
export async function sendPickerTop<R>(tabId: number, msg: PickerMessage): Promise<R | undefined>;  // frameId 0 고정

// src/sidepanel/scroll-capture.ts (신규)
export interface ScrollStitcher { add(tile: TileShot): Promise<void>; finish(): Promise<string> }
export interface ScrollCaptureDeps {
  send; captureTab; isTabActive; createStitcher;   // 전부 chrome/canvas 의존 → 단위 테스트용 DI
}
export async function runScrollCapture(
  tabId: number,
  opts: { onProgress: (done: number, total: number) => void; signal: AbortSignal; deps?: ScrollCaptureDeps },
): Promise<{ dataUrl: string; viewport: { width: number; height: number }; truncated: boolean }>;

// src/sidepanel/lib/scroll-capture-plan.ts (신규, 순수)
export const MAX_SCROLL_TILES = 20;
export function planScrollCapture(metrics: PageMetrics, maxTiles?: number): ScrollPlan;
export function tileDrawRect(plan: ScrollPlan, index: number, actualY: number): TileDraw;

// src/sidepanel/lib/crop-rect.ts (신규, 순수)
export function clampCropRect(rect: CropRect, imgWidth: number, imgHeight: number): CropRect;

// src/sidepanel/tabs/IssueTab.tsx (내부 컴포넌트 시그니처 변경)
function CapturingState(props: {
  onCancel: () => void;              // 대기 중: cancelAreaCapture / 스크롤 진행 중: abort()
  onViewport: () => void;
  onFullPage: () => void;
  progress: { done: number; total: number } | null;
}): JSX.Element;
// EmptyShell에 children 슬롯 추가 (title 아래 렌더 — 진행 표시용)
```

## 기존 패턴 준수

- **captureVisibleTab 단일 관문**: 캡처 API 직접 호출을 추가하지 않는다. `sendBg({type:"captureVisibleTab"})` → background `messages.ts` → `capture-throttle` 경유(POSTMORTEM 2026-06-29 — 호출처가 큐를 우회하면 쿼터 초과 재발). 스크롤 캡처의 타일 N개도 이 직렬 큐를 그대로 탄다(타일당 최소 500ms → 20타일 ≈ 10초, 로딩 UI가 필수인 이유).
- **30s Replay와의 경합 없음**: `use-30s-replay.ts:63`의 phase 게이트(`phase !== "idle"`이면 skip)가 capturing 중 폴링을 이미 정지시킨다 — 별도 pause 배선 불필요.
- **스크롤 복원·rAF 대기**: `handlePrepareCaptureBySelector`/`handleEndCapture`의 스크롤 저장 + rAF×2 + 500ms 폴백 패턴을 따른다(그쪽은 `scrollIntoView`, 여기는 `scrollTo` — 구조만 공유).
- **스타일 조작**: picker의 prev 저장 + `setProperty(..., "important")` + 정확 복원 패턴(picker.ts L489-503, L596-615)을 고정 요소 숨김에 재사용.
- **top frame 한정**: `picker-control.ts:545` 주석대로 broadcast하지 않고 `frameId: 0`으로만 보낸다. 스크롤 캡처 메시지도 동일.
- **비동기 sendResponse**: `collectTokens`(picker.ts L199-210)의 IIFE + `return true` 패턴. switch 공통 fallthrough와의 이중 응답 주의.
- **i18n ko/en 동시 갱신**: `src/i18n/` Edit 시 PostToolUse 훅이 `locales.test.ts`를 자동 실행해 키 비대칭을 차단한다.
- **UI는 shadcn `Button` + `ButtonGroup`**: 직접 스타일링 금지. 아이콘 버튼 `size="icon"` + `h-8 w-8` + `variant="outline"`, 활성 `bg-muted`(DESIGN.md·`ToolbarGroups.tsx`).
- **테스트 우선**: 신규 순수 함수(`clampCropRect`, `planScrollCapture`, `tileDrawRect`)는 테스트를 먼저 쓴다(CLAUDE.md 작업 원칙).
- **세션 영속화**: `capturing` phase는 기존대로 `onAreaCaptured`에서만 벗어나되, 장시간 체류로 기존 reset 분기 3곳과 경합할 수 있어 phase 재확인 가드 + content 자가 복원으로 방어한다(§8 호출부·§4).

## 대안 검토

1. **툴바를 [취소] 옆 인라인 버튼으로** — 최소 변경. 기각: 방식이 3개라 텍스트 버튼 3개가 좁은 패널에서 줄바꿈된다. 하단 아이콘 툴바는 녹화 중 어노테이션 툴바와 **자리가 일치**해 학습 비용이 낮다.
2. **스크롤 캡처를 content script에서 자체 수행(html2canvas류 렌더링)** — 캡처 API를 안 씀. 기각: 실제 렌더 결과와 다르고(폰트·이미지·shadow DOM), 번들이 커지며, 기존 캡처 파이프라인(webp 0.92·첨부)과 갈라진다.
3. **크롭 없이 captureVisibleTab 원본을 그대로 사용(뷰포트 캡처)** — "뷰포트 전체니까 자를 필요 없다". 기각: (a) 사이드패널이 캡처 시점을 직접 잡게 되어 오버레이 정리 순서 보장이 깨진다, (b) captureVisibleTab 기본 출력이 PNG라 기존 webp 0.92 재인코딩 경로와 갈라져 첨부 용량·포맷이 모드별로 달라진다.
4. **빈 클릭(드래그 10px 미만) = 뷰포트 캡처** — `area-select.ts:172`가 현재 no-op이라 공짜. 기각: 발견성 0, 무심코 클릭 시 원치 않는 캡처.
5. **idle 화면에 캡처 모드 버튼 2개 추가** — 가장 단순. 기각: 진입 화면 버튼 증식을 피하는 것이 이 기능의 전제다.
6. **스크롤 캡처 중 blocker까지 걷기** — 구현 최소. 기각(PRD 결정): 캡처 중 클릭 → 모달·네비게이션이 열리는 경로를 blocker 유지로 차단한다. blocker는 투명이라 캡처 무오염, 휠 스크롤만 통과(허용 리스크).

## 위험 요소

- **오버레이가 스크린샷에 박힘**: 뷰포트 캡처는 `selectFullViewport`의 정리→`onSelected` 순서, 스크롤 캡처는 `handleBeginScrollCapture`에서 dim·rect·라벨을 먼저 걷는 순서가 장치다. blocker는 투명이라 남아도 안 찍힌다.
- **고정 요소 오탐**: `position: sticky`인 레이아웃 컨테이너를 숨기면 **본문 콘텐츠가 통째로 사라진다**. `visibility`이므로 레이아웃은 유지되지만 내용이 빈다. 수동 테스트에서 sticky를 쓰는 실제 사이트(GitHub·Notion·뉴스 사이트)를 반드시 확인. 위험하면 "fixed만 숨기고 sticky는 남긴다"로 축소하는 fallback을 열어둔다(채택 시 PRD 성공 기준도 fixed 한정으로 조정).
- **타일 오염(허용 리스크)**: `scrollCaptureTo` ack와 실제 captureVisibleTab 실행 사이에 캡처 큐 대기(최소 500ms)가 있다. 이 창에서 휠 스크롤이 개입하면 해당 타일이 어긋난 위치에서 찍힌다 — 상태 오염은 없고 결과물 손상뿐이라 허용(재캡처로 해소). 탭 전환은 타일 전 `tab.active` 확인으로 abort.
- **lazy-load / 무한 스크롤**: 스크롤 후 이미지가 아직 안 뜬 상태로 캡처될 수 있다. rAF×2만으로 부족할 수 있으나, captureVisibleTab 큐의 500ms 간격이 사실상 추가 대기를 준다. 무한 스크롤은 20타일 상한으로 자른다.
- **복원 실패 잔류**: 사이드패널 사망 시 `finally`가 실행되지 않는 문제는 content 자가 복원(handleClear·port disconnect 배선)으로 닫는다. `transition: visibility` 잔상은 수동 테스트로 확인.
- **거대 DOM 수집 비용**: `querySelectorAll("*")` + `getComputedStyle` 전수 순회는 코드베이스 전례가 없는 동기 리플로우 비용 — **세션당 1회 수집·캐시**로 제한하고 거대 DOM 사이트 1개를 수동 테스트에 포함.
- **captureVisibleTab rate-limit**: 실패 시 기존 동작대로 `reset()` → 사용자가 재시도(30s Replay 폴링은 phase 게이트로 이미 정지 상태).
- **스크롤바**: `window.innerWidth`는 스크롤바 폭을 포함한다. 캡처 이미지에 스크롤바가 함께 담길 수 있다 — 드래그로 전체를 그렸을 때와 동일한 결과이므로 허용하되 수동 확인 항목에 둔다.
- **`clampCropRect` 회귀 범위**: `cropImage`는 인라인 캡처(`captureAndInsertInline`)도 함께 쓴다. 클램프는 "경계를 넘는 rect만 자르는" 동작이라 정상 범위 rect에는 무영향이어야 한다 — 단위 테스트로 항등성(경계 내부 rect는 그대로)을 고정한다.
- **레이스**: ① 드래그 완료 → `areaSelected` 발화 → drafting 전이 사이에 툴바 버튼이 클릭되면 content의 `areaHandle`이 이미 null이라 no-op. ② 인라인 캡처(drafting 중) 동안 `areaHandle`이 살아 있으므로 지연 도착한 `picker.selectFullViewport`가 `areaSelected`를 쏘면 `inlineCaptureTarget` 분기(usePickerMessages.ts:166-173)로 전체 뷰포트가 인라인 이미지로 삽입될 수 있다 — 창이 극히 좁고(캡처 UI가 분리돼 있어 동시 조작 불가에 가깝다) 결과도 사용자가 지울 수 있는 인라인 이미지라 허용, 문서화만.
