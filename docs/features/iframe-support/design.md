# iframe 내부 요소 편집·캡처 — 기술 설계

## 개요

picker를 로그 레코더와 동일하게 **all_frames로 주입**해 각 프레임(top + 1-depth iframe)마다 독립 picker 인스턴스가 돌게 한다. 각 프레임은 자기 문서 안에서 hover/select/overlay/style-apply를 그대로 수행한다(문서-로컬 selector·CSSOM 캐시는 이미 프레임 독립적). 새로 필요한 것:

1. **프레임 라우팅**: 사이드패널이 `sender.frameId`로 "어느 프레임의 선택인가"를 추적하고, apply/prepare/select 메시지를 그 `frameId`로만 보낸다. `send()`의 frameId는 **required**(누락 호출부를 typecheck로 전수 표면화).
2. **picker registry + blocker 핸드오프 게이팅**: 각 iframe picker가 start 시 부모에 "picker 있음"을 등록한다. top-frame blocker는 hover 대상이 **registry에 등록된 iframe일 때만** `pointerEvents:none`로 넘겨 iframe picker가 이벤트를 받게 하고, **미등록 iframe(sandbox·중첩)은 blocker를 유지**해 기존 `onClickCommit` 거부 경로를 살린다.
3. **좌표 변환(캡처)**: iframe 내부 요소 rect(iframe 뷰포트 기준)를 부모 `<iframe>` 위치와 합산해 top-frame 좌표로 변환. cross-origin은 `iframe.contentWindow === event.source` postMessage 매칭. iframe 캡처 시 **top 프레임 overlay도 숨긴다**(안 그러면 캡처에 찍힘).
4. **프레임 간 teardown**: 어느 프레임에서든 cancel/ESC가 오면 `clearPicker` broadcast로 모든 프레임을 정리(유령 picker 방지).
5. **출처(origin) 표시**: selection·buffered에 프레임 origin을 실어 다중 편집 리뷰 카드에 배지로 노출.

기존 iframe 거부 게이트(`picker.ts:637-645`)는 **registry 미등록 iframe에 한해 유지**(sandbox·중첩), 1-depth 정상 iframe은 핸드오프로 안쪽 선택된다.

## 변경 범위

### `manifest.config.ts`
- content_scripts[0](picker.ts)에 `all_frames: true` 추가. `exclude_matches`(bugshot.gitbook.io) 유지. picker는 index 0 고정(`ensureContentScript`가 `content_scripts[0].js` 참조) — 순서 유지.

### `src/content/picker.ts`
- **주입 멱등 가드**: 현재 `chrome.runtime.onMessage`(picker.ts:129)·`onConnect`(picker.ts:117) 리스너가 모듈 최상위에서 **무가드** 등록된다. recorder-bridge의 `BRIDGE_FLAG`(recorder-bridge.ts:142-146) 선례처럼, **리스너 등록을 포함한 init 전체**를 멱등 플래그(`__bugshotPicker__`)로 감싼다. 정적+programmatic 이중 주입 시 이중 `sendResponse`("message port closed")·이중 `handleClear` 방지(`removeOrphanOverlay`는 overlay만 커버 — 불충분).
- **picker registry 등록(자식 측)**: 자기 프레임이 iframe이면(`window !== window.top`) `handleStart` 시 부모에 `installFrameOffsetResponder`/registry announce를 보낸다(frame-geometry 참조).
- **blocker 핸드오프(top·부모 측)**: `onMouseMove`(picker.ts:619)에서 `elementAtPoint`가 IFRAME을 반환하고 그 iframe이 **registry에 등록됨**이면 `blockerEl.style.pointerEvents="none"`, 아니면(미등록/비-IFRAME) `"auto"`. `elementAtPoint`(picker.ts:604-610)가 매 호출 끝에 blocker를 **무조건 `"auto"` 복원**하므로, 핸드오프 토글은 `elementAtPoint` **호출 이후**에 배치하고 복원과 순서가 꼬이지 않게 한다(깜빡임 완화). 토글은 `target===lastHover` 가드 안으로 넣어 매 픽셀 재토글 억제.
- **iframe 거부(미등록 한정)**: `onClickCommit`의 IFRAME 거부(637-645)는 그대로 두되, registry 등록 iframe은 애초에 핸드오프로 iframe picker가 클릭을 받으므로 top에 도달 안 함. 미등록 iframe만 blocker 유지 상태에서 클릭이 `onClickCommit`에 IFRAME으로 잡혀 거부.
- **캡처 좌표 변환**: `handlePrepareCapture`/`handlePrepareCaptureBySelector`가 inner rect 계산 후 `window !== window.top`이면 `requestFrameOffset()`로 offset·top viewport를 얻어 top 좌표로 변환(async → `return true` + sendResponse). top frame은 기존 경로.
- **iframe 캡처 시 top overlay 숨김**: `beginCapturePrep`(picker.ts:218)는 **자기 프레임 overlay만** 숨긴다. iframe 프레임에서 캡처 준비가 시작되면 top 프레임 overlay/blocker가 `captureVisibleTab`(탭 전체)에 그대로 찍힌다. → iframe의 prepareCapture가 **top 프레임에도 overlay 숨김을 요청**(frame-geometry offset 요청에 편승하거나 별도 `picker.hideOverlayForCapture` broadcast). endCapture 시 top overlay 복원.
- **프레임 teardown**: cancel/ESC(`onKeyDown`)는 자기 프레임만 idle로 만든다. 사이드패널이 cancelled 수신 시 `clearPicker` broadcast로 전 프레임 정리(아래 usePickerMessages).

### `src/content/frame-geometry.ts` (신규)
- **역할**: (a) iframe picker의 존재를 부모에 등록(registry), (b) top-frame 좌표 offset 핸드셰이크, (c) 캡처 시 top overlay 숨김 요청. picker.ts에서 import.
- **자식 측**:
  - `announceFrameToParent()` — start 시 `window.parent.postMessage({__bugshot_frame_present__, token})`. 부모가 `event.source`로 이 프레임의 `<iframe>`을 registry에 등록.
  - `requestFrameOffset(timeoutMs?): Promise<FrameOffset | null>` — 부모에 offset 요청, token 매칭 응답 대기, 타임아웃 폴백 null(기존 `prepareCaptureBySelector` 500ms 폴백 패턴). **자식 측 응답 수신 방어**: `event.source === window.parent` **및** 예상 부모 origin 확인으로 페이지 스크립트의 위조 res를 차단(offset 스푸핑 → 크롭 rect 조작 방지). 요청 payload는 최소 정보만.
- **부모 측(모든 프레임에서 설치)**: `installFrameOffsetResponder()` — `window.addEventListener("message")`:
  - `__bugshot_frame_present__`: `event.source`와 `contentWindow`가 일치하는 자식 `<iframe>`을 찾아 **child-frame registry**(Set/Map)에 등록. 핸드오프 게이팅의 진실 소스.
  - `__bugshot_frameOffset_req__`: 매칭 자식 `<iframe>`의 `getBoundingClientRect()` + `clientLeft/clientTop`(border) offset 계산. **자신이 top이면** `{offset, topViewport}` 응답, **아니면(중첩) 미지원 응답**(1-depth 한정 — 중첩은 offset 해석 포기).
- cross-origin 안전: `contentWindow === event.source` 비교·자식 `<iframe>.getBoundingClientRect()`·`window.parent.postMessage`는 cross-origin에서도 부모가 접근 가능.

### `src/sidepanel/picker-control.ts`
- `send<R>(tabId, msg, frameId)` — **frameId required**. `chrome.tabs.sendMessage(tabId, msg, { frameId })`. `frameId ?? 0` 정규화는 **호출부(소비 지점)**에서 수행(undefined면 top이 아니라 전 프레임 broadcast되는 함정 방지). 참고: `rebroadcastSentinelsToFrame`(picker-control.ts:130-139)의 `{ frameId }` 선례.
- 프레임 라우팅 대상 export 함수 전부에 frameId 인자 추가: `applyClasses`·`applyStyles`·`applyText`·`resetAllEdits`·`collectTokens`·`previewHover`·`previewClear`·`selectByPath`·`applyEditsBySelector`·`prepareCapture`·`prepareCaptureBySelector`·`navigatePicker`·`describeChildren`·`describeInitialTree`.
- `ensureContentScript`를 `target: { tabId, allFrames: true }`로. (레코더의 `ensureRecorderBridge`(picker-control.ts:59-75)가 이 `allFrames:true` 패턴. **`ensureMainWorldRecorders`는 allFrames가 아니라 `world:"MAIN"` 단독**이므로 참고 대상 아님.)
- `picker.start`/`picker.clear`/`picker.startAreaSelect`는 **frameId 미지정 broadcast 유지**(전 프레임 on/off).
- `rebindStylingSession`(picker-control.ts:336-382)·`resumeBufferedElement`(207-219): `selectByPath`·`applyEditsBySelector`를 selection·buffered의 frameId로 라우팅. 버퍼 순회 시 각 항목 frameId 사용. 구버전 스냅샷은 `frameId ?? 0`.

### `src/store/editor-store.ts`
- `EditorSelection`·`BufferedElement`·`ShotSelector`에 **`frameId: number`**(0=top) + **`origin: string`**(프레임 `location.href` origin, 배지 표시용) 추가. optional 선언 + 소비 시점 `frameId ?? 0` / `origin ?? ""` 폴백(기존 `propSources ?? {}` 선례).
- `onElementSelected` 입력에 `frameId`·`origin` 추가. `bufferCurrentElement`가 selection의 frameId·origin을 buffered에 복사.
- **버퍼 술어 복합키화**: `bufferCurrentElement` dedup findIndex(`b.selector === sel.selector` → `+ b.frameId === sel.frameId`), `patchBufferedElement`/`removeBufferedElement` 시그니처(selector → `selector, frameId`), `onElementSelected`의 buffered.find·승격 filter도 복합키.
- **`updateSelectionStyles` stale 가드**(editor-store.ts:568 selector 단독): cross-origin 늦은 보강이 다른 프레임 동일 selector를 오염시키지 않도록 `selector && frameId` 비교로.
- 영속 마이그레이션: 구버전·구 draft 복원 시 `frameId ?? 0`, `origin ?? ""`.

### `src/sidepanel/hooks/usePickerMessages.ts`
- `handler(message, sender)`에서 **`sender.frameId`** 사용(content script 메시지에 표준 제공 — 코드베이스 선례 0이므로 실기기 확인 태스크 포함). `picker.selected`에서 `onElementSelected({..., frameId: sender.frameId, origin: <payload.origin> })`.
- 후속 `collectTokens(tabId, frameId)`·`captureElementSnapshot(tabId, { frameId })`·`captureElementShot`에 frameId 전달. **`captureElementShot`의 `captureElementSnapshot(tabId)`도 `shotSelector.frameId`로 라우팅**(요소 스크린샷 모드 회귀 방지).
- 버퍼 재선택 매칭(`wasBuffered`)을 `selector && frameId` 복합키로.
- `picker.cancelled` 수신 시 `clearPicker(tabId)` **broadcast**로 전 프레임 teardown(유령 picker 방지).
- `picker.iframeUnsupported`는 registry 미등록(중첩·sandbox) 케이스에서만 도착. 처리 유지 + 문구 조정(app.ts).

### `src/sidepanel/capture.ts`
- `captureElementSnapshot(tabId, { frameId, margin })`·`captureElementSnapshotBySelector(tabId, selector, { frameId })` → `prepareCapture(tabId, frameId)` 라우팅. `cropImage`(capture.ts:54)는 그대로(rect·viewport가 top 좌표. `scaleX = naturalWidth / viewport.width`가 top viewport와 정합).

### 다중 편집 리뷰 UI (출처 배지)
- **`src/sidepanel/tabs/styleEditor/styleChangeGroups.ts`**(`buildChangeGroups`): selector 그룹화를 `selector + frameId`로. group에 `frameId`·`origin` 실음.
- **`src/sidepanel/tabs/styleEditor/StyleChangesDialog.tsx`**: `removeBufferedElement`·`patchBufferedElement`·`applyEditsBySelector` 호출을 `(selector, frameId)`로. GroupCard 헤더(`current` 배지 옆, `truncate 라벨 + shrink-0 배지` 레이아웃)에 **origin 배지** 추가(shadcn `Badge`, cross-origin 로그 `OriginFilterBar` 팔레트 컨벤션 재사용). top 프레임(origin === 페이지 origin)은 배지 생략, iframe만 표시.

### `src/i18n/namespaces/app.ts`
- `app.iframeUnsupported.*`를 **중첩/sandbox 한정 문구**로(ko/en 동시). 초안:
  - ko title: "이 iframe은 선택할 수 없습니다"
  - ko body: "중첩된 프레임이거나 보안 정책(sandbox)으로 내부 요소에 접근할 수 없습니다. 다른 요소를 선택하거나 화면 캡처(영역/전체) 모드를 사용해 주세요."
  - en title: "This iframe can't be selected"
  - en body: "Its inner elements are blocked by nesting or a security policy (sandbox). Select another element, or use screen capture (area/full) instead."

## 데이터 흐름

### 선택 (iframe 내부 요소)
```
[iframe frame] onClickCommit → emitSelected
    → postToRuntime({ picker.selected, payload{ ..., origin: location.origin } })
[sidepanel] handler(message, sender)
    → sender.tab.id === myTabId 확인
    → frameId = sender.frameId
    → onElementSelected({ ...payload, frameId, origin })
    → 후속: collectTokens(tabId, frameId), captureElementSnapshot(tabId, { frameId })
```

### blocker 핸드오프 게이팅 (registry)
```
[iframe frame] handleStart → announceFrameToParent()  (postMessage 상위)
[parent frame] installFrameOffsetResponder: __bugshot_frame_present__ 수신
    → contentWindow===event.source 인 <iframe>을 childFrameRegistry에 등록
[parent frame] onMouseMove → elementAtPoint === IFRAME
    → registry.has(iframeEl) ? blocker pointerEvents="none"(핸드오프)
                            : "auto"(유지 → 클릭 시 onClickCommit 거부)
```

### 스타일 적용 (라우팅)
```
[sidepanel] styleHooks set() → applyStyles(tabId, frameId, inlineStyle)
    → chrome.tabs.sendMessage(tabId, {...}, { frameId })   // frameId required
[해당 frame만] handleApplyStyles → 그 프레임 selectedEl에 적용
```

### 캡처 좌표 변환 + top overlay 숨김 (1-depth iframe)
```
[sidepanel] captureElementSnapshot(tabId, { frameId })
    → prepareCapture(tabId, frameId) → sendMessage(..., { frameId })
[iframe frame] handlePrepareCapture
    beginCapturePrep(): 자기 프레임 overlay 숨김
    innerRect = selectedEl.getBoundingClientRect()   (iframe 뷰포트 기준)
    if (window !== window.top):
        { offset, topViewport } = await requestFrameOffset()
            [parent=top] event.source===childIframe.contentWindow
                offset = { x: iframeRect.left + iframe.clientLeft,
                           y: iframeRect.top  + iframe.clientTop }
                + top 프레임 overlay 숨김(picker.hideOverlayForCapture broadcast)
        rect = { x: innerRect.x+offset.x, y: innerRect.y+offset.y, w, h }
        viewport = topViewport            ← 크롭 scale 기준(top 크기)
    else: rect = innerRect; viewport = 자기 뷰포트
    return { rect, viewport }             // async, return true
[sidepanel] captureVisibleTab(top 전체) → cropImage(rect, viewport, margin)
[endCapture] iframe·top 양쪽 overlay 복원
```
**viewport 주의**: `cropImage`의 scaleX/Y는 `img.naturalWidth / viewport.width`. iframe 뷰포트를 쓰면 크롭이 어긋나므로 iframe 케이스의 viewport는 **top 크기**(offset 응답의 `topViewport`).

## 인터페이스 설계

```typescript
// editor-store.ts
export interface EditorSelection {
  // ...기존 필드
  frameId: number;          // 0 = top
  origin: string;           // 프레임 location.origin (배지)
}
export interface BufferedElement { frameId: number; origin: string; /* ... */ }
export interface ShotSelector { selector: string; tagName: string; frameId: number; }

// 버퍼 술어 복합키
patchBufferedElement(selector: string, frameId: number, patch: ...): void;
removeBufferedElement(selector: string, frameId: number): void;

// picker-control.ts
async function send<R = void>(tabId: number, msg: PickerMessage, frameId: number): Promise<R | undefined>;
export async function applyStyles(tabId: number, frameId: number, inlineStyle: Record<string, string>): Promise<void>;
export async function prepareCapture(tabId: number, frameId: number): Promise<PrepareCaptureResponse | null>;
// selectByPath / applyEditsBySelector / collectTokens / previewHover / previewClear /
// describeChildren / describeInitialTree / navigatePicker 동일하게 frameId 추가(required)

// capture.ts
export async function captureElementSnapshot(tabId: number, options?: { margin?: number; frameId?: number }): Promise<string | null>;

// src/content/frame-geometry.ts (신규)
export interface FrameOffset { x: number; y: number; topViewport: { width: number; height: number }; }
export function composeTopRect(inner: ViewportRect, offset: { x: number; y: number }): ViewportRect; // 순수 — 단위 테스트
export function announceFrameToParent(): void;
export function requestFrameOffset(timeoutMs?: number): Promise<FrameOffset | null>;
export function installFrameOffsetResponder(): void; // 모든 프레임 1회
```

## picker.selected payload에 origin 싣기
- selector·stylemeta에 더해 `origin: location.origin`을 `PickerSelectionPayload`에 추가(`src/types/picker.ts`). frameId는 페이로드가 아니라 `sender.frameId`에서 얻는다(위조 방지). origin은 배지 표시용이라 페이로드로 무방(cross-tab 가드가 이미 sender.tab.id로 격리).

## 기존 패턴 준수

- **all_frames 주입 + programmatic 재주입**: `ensureRecorderBridge`(picker-control.ts:59-75)의 `allFrames:true` 패턴. picker도 동일.
- **frameId 라우팅**: `rebroadcastSentinelsToFrame`(picker-control.ts:130-139)의 `{ frameId }` 전송.
- **멱등 가드**: recorder-bridge `BRIDGE_FLAG`(recorder-bridge.ts:142-146).
- **sender 스코프**: `usePickerMessages`의 `sender.tab.id` 격리(72-82)에 `sender.frameId` 추가.
- **CSSOM 캐시 프레임 독립**: `css-source-cache.ts` 모듈-전역이라 프레임마다 자기 문서 sheet만 캐시. cross-origin author 보강은 `css.fetchSheets`(background, SSRF 가드) 유지. 변경 없음.
- **캡처 쿼터 직렬화**: `captureVisibleTab`은 top 1회. prepareCapture는 sendMessage일 뿐 프레임당 캡처 유발 없음 → 쿼터 무관.
- **영속 마이그레이션 폴백**: `frameId ?? 0`, `origin ?? ""`(소비 시점).
- **i18n 동시 갱신**: `app.ts` ko/en(PostToolUse 대칭 검사).

## 대안 검토

### 대안 A: postMessage 프록시(picker는 top frame 유지)
top이 iframe 내부를 못 만지므로 iframe에 얇은 프록시를 두고 명령을 postMessage. **기각**: 결국 iframe에 스크립트 주입 필요(=all_frames) + apply/select/token/capture 전 프로토콜 신설 → 기존 picker 로직 재사용 불가.

### 대안 B: 중첩 N-depth 재귀
offset 요청을 top 도달까지 재귀 forward. **기각(비목표)**: 조상 체인 순회+offset 누적 복잡. 1-depth만 구현하되 부모 측이 "top 아니면 미지원 응답"으로 명확히 거부.

### 대안 C: `chrome.webNavigation.getAllFrames`로 좌표
**기각**: getAllFrames는 URL·parentFrameId만 주고 rect 미제공. 좌표는 `<iframe>` element geometry가 필요 → contentWindow 매칭 postMessage가 유일한 cross-origin 경로.

### 대안 D: 핸드오프 없이 blocker에 iframe 영역 구멍(hole)
top blocker를 iframe rect만큼 clip. **기각**: 단일 blocker div에 동적 다중 hole 관리가 복잡하고 스크롤·리사이즈마다 재계산. registry 게이팅 pointerEvents 토글이 단순·견고.

## 위험 요소

1. **blocker 핸드오프 레이스**: registry 게이팅으로 sandbox·중첩 오통과는 막지만, 등록 iframe 경계에서 blocker=none 짧은 창에 인접 링크 클릭이 페이지로 샐 수 있음(mousemove가 click 선행이라 실무상 드묾). 수동 검증 필수.
2. **top-frame 요소 회귀**: allFrames 재주입 시 top 이중 초기화 → 멱등 플래그(리스너 포함)로 방지. 미방지 시 이중 sendResponse·이중 handleClear.
3. **좌표 변환 오차**: iframe border(`clientLeft/clientTop`)만 보정. transform/zoom된 iframe은 오차(엣지, 비목표 근처). iframe 내부 스크롤은 inner rect가 이미 반영.
4. **viewport 스케일 불일치**: iframe 케이스 크롭 viewport는 반드시 top 크기(offset 응답 `topViewport`). iframe innerWidth 사용 시 크롭 어긋남.
5. **캡처 오염(top overlay)**: iframe 캡처 시 top 프레임 overlay/blocker가 안 숨겨지면 `captureVisibleTab`에 찍힘 → prepareCapture가 top overlay 숨김도 트리거. capturedScroll/captureInflight가 프레임별 독립 전역임을 유의(top scrollIntoView 미보정 케이스는 캡처 대상 밖 처리).
6. **postMessage 스푸핑**: `"*"` broadcast를 부모 MAIN-world 페이지 스크립트가 관측·위조 가능 → 자식 측 `event.source===window.parent`+origin 확인으로 방어. 영향 범위는 자기 탭 캡처 rect 한정(로그 레코더 위조 위험과 동급 수용).
7. **hidden 탭/rAF·응답 미발화**: offset 응답 타임아웃(500ms 폴백, `prepareCaptureBySelector` 선례)으로 매달림 방지.
8. **다중 편집 동일 selector 오적용**: 버퍼 술어·다이얼로그·store find/filter를 `frameId+selector` 복합키로. selector 단독 잔존 시 오적용.
9. **cancel/ESC 유령 picker**: cancelled 수신 시 `clearPicker` broadcast 필수.
10. **다수 iframe 오버헤드**: `picker.start` broadcast로 광고 iframe 수십 개 페이지에서 N개 프레임이 각자 overlay(100vw×100vh blocker)+mousemove 캡처+css observer 생성. active picking 중에만 유지돼 bounded이나, 프레임당 번들 파싱·상주 메모리 비용 존재(정량 측정은 수동 확인).
11. **broadcast 다중 sendResponse**: `picker.start`/`clear` broadcast에 전 프레임이 각자 `sendResponse` → Chrome은 첫 응답만 채택, 나머지 조용한 에러. 기능 영향 없으나 콘솔 노이즈 가능 — 필요 시 broadcast 메시지는 sendResponse 생략.
