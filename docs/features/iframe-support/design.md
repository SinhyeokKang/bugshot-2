# iframe 내부 요소 편집·캡처 — 기술 설계

## 개요

picker를 로그 레코더와 동일하게 **all_frames로 주입**해 각 프레임(top + 1-depth iframe)마다 독립 picker 인스턴스가 돌게 한다. 각 프레임은 자기 문서 안에서 hover/select/overlay/style-apply를 그대로 수행한다(문서-로컬 selector·CSSOM 캐시는 이미 프레임 독립적). 새로 필요한 것은 세 가지뿐:

1. **프레임 라우팅**: 사이드패널이 "어느 프레임의 선택인가"(`frameId`)를 추적하고, apply/prepare/select 메시지를 해당 `frameId`로만 보낸다.
2. **blocker 핸드오프**: top-frame의 전체 뷰포트 blocker가 iframe 영역 위 포인터 이벤트를 삼키지 않도록, hover 대상이 iframe이면 blocker를 통과시켜 iframe 자체 picker가 이벤트를 받게 한다.
3. **좌표 변환(캡처)**: iframe 내부 요소의 rect(iframe 뷰포트 기준)를 부모의 `<iframe>` 위치와 합산해 top-frame 뷰포트 좌표로 변환 → 기존 `captureVisibleTab` 크롭 재사용.

기존 iframe 거부 게이트(`picker.ts:637-645`)는 **1-depth iframe에 한해 제거**하고, 여전히 선택 불가한 경우(중첩·sandbox)만 거부 경로로 남긴다.

## 변경 범위

### `manifest.config.ts`
- **현재**: content_scripts[0](picker.ts)에 `all_frames` 없음 → top frame 전용.
- **변경**: content_scripts[0]에 `all_frames: true` 추가. `exclude_matches`(bugshot.gitbook.io)는 유지.
- 주의: picker는 index 0 고정(`ensureContentScript`가 `content_scripts[0].js` 참조) — 순서 유지.

### `src/sidepanel/picker-control.ts`
- **현재**: `ensureContentScript`가 `executeScript({ target: { tabId }, files })` — top frame만 재주입. `send()`가 frameId 미지정.
- **변경**:
  - `ensureContentScript`를 `target: { tabId, allFrames: true }`로 변경(레코더의 `ensureRecorderBridge`와 동일 패턴). ping은 top frame으로만 하되, 주입은 all frames.
  - `send<R>(tabId, msg, frameId?)`에 선택적 `frameId` 인자 추가 → `chrome.tabs.sendMessage(tabId, msg, frameId != null ? { frameId } : undefined)`. 참고: `rebroadcastSentinelsToFrame`(picker-control.ts:130)가 이미 `{ frameId }` 전송 패턴을 씀.
  - 프레임-라우팅이 필요한 export 함수에 `frameId` 인자 추가(기본 top=0 아님, **선택 시 받은 frameId를 넘김**): `applyClasses`, `applyStyles`, `applyText`, `resetAllEdits`, `collectTokens`, `previewHover`, `previewClear`, `selectByPath`, `applyEditsBySelector`, `prepareCapture`, `prepareCaptureBySelector`, `navigatePicker`, `describeChildren`, `describeInitialTree`.
  - `picker.start`/`picker.clear`/`picker.startAreaSelect`는 **frameId 미지정으로 broadcast 유지**(모든 프레임이 picker를 켜고/끄게).

### `src/store/editor-store.ts`
- **현재**: `EditorSelection`·`BufferedElement`가 `selector`만 가짐. `EditorTarget`에 `frameUrl?` 존재.
- **변경**:
  - `EditorSelection`에 `frameId: number` 추가(0 = top).
  - `BufferedElement`에 `frameId: number` 추가.
  - `ShotSelector`에 `frameId: number` 추가.
  - `onElementSelected` 입력에 `frameId` 추가, selection에 저장.
  - `bufferCurrentElement`가 현재 selection의 frameId를 buffered에 복사.
  - 영속 마이그레이션: 구버전 스냅샷·IssueRecord 복원 시 `frameId` 부재 → `?? 0`(top)으로 폴백(`propSources ?? {}` 폴백과 동일 패턴).

### `src/sidepanel/hooks/usePickerMessages.ts`
- **현재**: `handler(message, sender)`에서 `sender.tab?.id`만 사용. 후속 apply/capture는 top frame으로.
- **변경**:
  - `picker.selected`/`picker.selectionUpdated`/`picker.areaSelected`/`picker.cancelled` 처리 시 **`sender.frameId`**를 읽어 store selection·후속 라우팅에 사용.
  - `picker.selected`에서 `onElementSelected({..., frameId: sender.frameId })`.
  - `collectTokens(tabId, frameId)`, `captureElementSnapshot(tabId, { frameId })` 등 후속 호출에 frameId 전달.
  - 버퍼 재선택 매칭을 `selector` 단독 → `selector && frameId` 복합으로(`bufferedElements.some(b => b.selector === sel && b.frameId === fid)`).
  - `picker.iframeUnsupported`는 **중첩·sandbox 케이스에서만** 도착(1-depth iframe은 이제 정상 선택). 처리 로직 자체는 유지.

### `src/sidepanel/capture.ts`
- **현재**: `captureElementSnapshot(tabId, options)` → `prepareCapture(tabId)` → 크롭. 좌표 변환 없음.
- **변경**:
  - `captureElementSnapshot(tabId, { frameId, margin })` — `prepareCapture(tabId, frameId)`로 라우팅.
  - `prepareCapture`가 반환하는 rect는 이미 top-frame 뷰포트 좌표(변환은 content script에서 완료 — 아래 데이터 흐름). `cropImage`는 top 뷰포트 크기 기준이므로 그대로 재사용.
  - `captureElementSnapshotBySelector`도 frameId 인자 추가.

### `src/content/picker.ts`
- **현재**: 전 함수가 `document`(자기 문서) 스코프. iframe 거부는 `onClickCommit`. 캡처 rect는 자기 뷰포트 기준.
- **변경**:
  - `onClickCommit`의 IFRAME 차단(637-645)을 **조건부**로: 클릭 대상이 IFRAME이고 그 내부에 picker가 없으면(=중첩/sandbox) 기존 거부. 1-depth iframe은 애초에 top blocker 핸드오프로 iframe 자체 picker가 클릭을 받으므로 top의 `onClickCommit`에는 IFRAME이 안 잡힘 → 실제로는 **핸드오프가 정상일 때 이 분기 도달 안 함**. 도달 시(핸드오프 실패·중첩)만 거부.
  - **blocker 핸드오프**: `onMouseMove`에서 `elementAtPoint`가 IFRAME을 반환하면 `overlay.blockerEl.style.pointerEvents = "none"`로 전환(iframe이 이벤트를 받도록). 대상이 IFRAME이 아니면 `"auto"`로 복귀. iframe 위에서는 부모가 포인터 이벤트를 못 받으므로 자동으로 iframe picker가 hover/click을 처리한다.
  - **캡처 좌표 변환**: `handlePrepareCapture`/`handlePrepareCaptureBySelector`가 자기 문서의 inner rect를 계산한 뒤, **자신이 iframe이면**(`window !== window.top`) 부모에게 offset을 요청(postMessage handshake, 아래)해 top-frame 좌표로 변환한 rect를 응답. top frame이면 기존과 동일.
  - `pageUrl` 응답은 `location.href`(각 프레임 자기 URL) — 라우팅·매칭에 활용 가능.

### 신규 파일: `src/content/frame-geometry.ts`
- **역할**: iframe picker가 top-frame 좌표 offset을 얻기 위한 postMessage 핸드셰이크. picker.ts에서 import.
- **부모 측**(모든 프레임에서 리스너 등록): `window.addEventListener("message")`에서 `__bugshot_frameOffset_req__`를 받으면 `event.source`와 `contentWindow`가 일치하는 자식 `<iframe>`을 찾아 `getBoundingClientRect()` + `clientLeft/clientTop`(border) offset을 계산. 자신이 top이면 응답(`event.source.postMessage(__bugshot_frameOffset_res__, "*")`), 아니면(중첩) 미지원 응답.
- **자식 측**: `requestFrameOffset(): Promise<{x,y} | null>` — 부모에 요청 후 token 매칭으로 응답 대기(타임아웃 폴백 null).
- cross-origin 안전: `iframe.contentWindow === event.source` 비교와 `<iframe>` element의 `getBoundingClientRect()`는 cross-origin에서도 부모가 접근 가능.

### `src/types/picker.ts`
- `PrepareCaptureResponse`는 그대로(rect는 이제 이미 top-frame 좌표로 해석됨).
- `picker.prepareCapture`/`picker.prepareCaptureBySelector` 메시지 자체는 변경 없음(frameId는 `chrome.tabs.sendMessage`의 옵션으로 전달, 페이로드 아님).
- 필요 시 `picker.selected` 페이로드에 프레임 힌트를 넣지 않는다 — **frameId는 `sender.frameId`에서 얻는다**(페이로드 오염 방지).

### `src/i18n/namespaces/app.ts`
- `app.iframeUnsupported.*` 문구를 **중첩/sandbox 한정 메시지**로 조정(ko/en 동시). 예: "이 iframe 안쪽 요소는 선택할 수 없습니다(중첩 프레임 또는 보안 정책)." — 1-depth는 이제 지원되므로 기존 광범위 문구는 오해 소지.

## 데이터 흐름

### 선택 (iframe 내부 요소)
```
[iframe frame] onClickCommit → emitSelected
    → postToRuntime({ picker.selected, payload })   (chrome.runtime.sendMessage)
[sidepanel] handler(message, sender)
    → sender.tab.id === myTabId 확인
    → frameId = sender.frameId              ← 프레임 식별
    → onElementSelected({ ...payload, frameId })
    → 후속: collectTokens(tabId, frameId), captureElementSnapshot(tabId, { frameId })
```

### 스타일 적용 (라우팅)
```
[sidepanel] styleHooks set() → applyStyles(tabId, frameId, inlineStyle)
    → chrome.tabs.sendMessage(tabId, { picker.applyStyles, inlineStyle }, { frameId })
[해당 frame만] handleApplyStyles → selectedEl(그 프레임의 선택)에 적용
```
frameId 라우팅이 없으면 top frame이 자기 selectedEl(없거나 다른 요소)에 적용하려다 no-op/오적용.

### 캡처 좌표 변환 (1-depth iframe)
```
[sidepanel] captureElementSnapshot(tabId, { frameId })
    → prepareCapture(tabId, frameId) → sendMessage(..., { frameId })
[iframe frame] handlePrepareCapture
    innerRect = selectedEl.getBoundingClientRect()   (iframe 뷰포트 기준)
    if (window !== window.top):
        offset = await requestFrameOffset()          (postMessage → 부모)
        [top frame] message 리스너: event.source===childIframe.contentWindow
            offset = { x: iframeRect.left + iframe.clientLeft,
                       y: iframeRect.top  + iframe.clientTop }
            event.source.postMessage(res, "*")
        rect = { x: innerRect.x + offset.x, y: innerRect.y + offset.y, w, h }
    else: rect = innerRect
    viewport = top frame의 innerWidth/Height ← 크롭 스케일 기준과 일치해야 함(주의)
    return { rect, viewport }
[sidepanel] captureVisibleTab(top 전체) → cropImage(rect, viewport, margin)
```
**viewport 주의**: `cropImage`의 scaleX/Y는 `img.naturalWidth / viewport.width`. iframe frame의 `window.innerWidth`는 iframe 크기라 top 스크린샷과 불일치. 따라서 iframe 케이스의 `viewport`는 **top frame 크기**여야 한다 → offset 요청 응답에 top의 `innerWidth/innerHeight`를 함께 실어 보낸다.

## 인터페이스 설계

```typescript
// editor-store.ts
export interface EditorSelection {
  // ...기존 필드
  frameId: number;          // 0 = top frame
}
export interface BufferedElement {
  frameId: number;
  // ...기존 필드
}
export interface ShotSelector {
  selector: string;
  tagName: string;
  frameId: number;
}

// picker-control.ts
async function send<R = void>(
  tabId: number, msg: PickerMessage, frameId?: number,
): Promise<R | undefined>;

export async function applyStyles(
  tabId: number, frameId: number, inlineStyle: Record<string, string>,
): Promise<void>;
export async function prepareCapture(
  tabId: number, frameId: number,
): Promise<PrepareCaptureResponse | null>;
// selectByPath / applyEditsBySelector / collectTokens / previewHover 등 동일하게 frameId 추가

// capture.ts
export async function captureElementSnapshot(
  tabId: number, options?: { margin?: number; frameId?: number },
): Promise<string | null>;

// src/content/frame-geometry.ts (신규)
export interface FrameOffset { x: number; y: number; topViewport: { width: number; height: number }; }
export function requestFrameOffset(timeoutMs?: number): Promise<FrameOffset | null>;
export function installFrameOffsetResponder(): void; // 모든 프레임에서 1회 설치
```

## 기존 패턴 준수

- **all_frames 주입 + programmatic 재주입**: 레코더의 `ensureRecorderBridge`/`ensureMainWorldRecorders`(picker-control.ts:59-93)와 동일 구조. picker도 `allFrames: true` 재주입.
- **frameId 라우팅**: `rebroadcastSentinelsToFrame`(picker-control.ts:130-139)이 이미 `chrome.tabs.sendMessage(tabId, msg, { frameId })`를 씀 — 동일 API.
- **sender 기반 탭 스코프**: `usePickerMessages`가 이미 `sender.tab.id`로 다른 탭 메시지를 거른다(72-82) — `sender.frameId` 추가는 자연스러운 확장.
- **CSSOM 캐시 프레임 독립**: `css-source-cache.ts`는 모듈-전역 상태라 각 프레임의 picker 인스턴스가 자기 문서 sheet만 캐시. cross-origin author 보강은 `css.fetchSheets`(background, SSRF 가드) 그대로. **변경 없음**.
- **영속 마이그레이션 폴백**: `frameId ?? 0`으로 구버전 스냅샷 복원(`propSources ?? {}` 선례).
- **i18n 동시 갱신**: `app.ts` ko/en 함께 수정(PostToolUse 훅 대칭 검사).

## 대안 검토

### 대안 A: postMessage 프록시(picker는 top frame 유지, iframe DOM을 프록시로 조작)
top frame picker가 iframe 내부를 직접 못 만지므로, iframe에 얇은 프록시 스크립트를 두고 top이 postMessage로 "이 selector에 스타일 적용" 명령을 보내는 방식. **기각**: 결국 iframe에 스크립트를 주입해야 하고(=all_frames와 동일), 명령 프로토콜을 apply/select/token/capture 전부에 대해 새로 만들어야 함 → all_frames + frameId 라우팅보다 훨씬 복잡. 기존 picker 로직 재사용 불가.

### 대안 B: 중첩 iframe까지 N-depth 재귀 지원
frame-geometry의 offset 요청을 top 도달까지 재귀 forward. **기각(비목표)**: 프레임 조상 체인 순회 + offset 누적으로 복잡도·회귀 위험 증가. 실사용 대부분 1-depth. 프로토콜은 top 도달 여부만 판별해 미지원 응답하도록 열어두되(추후 확장 여지), 이번엔 1-depth만 구현.

### 대안 C: `chrome.webNavigation.getAllFrames`로 프레임 트리·offset 계산
background가 프레임 관계를 안다. **기각**: getAllFrames는 프레임 URL·parentFrameId만 주고 **화면상 위치(rect)를 안 줌**. 좌표는 결국 `<iframe>` element geometry가 필요 → contentWindow 매칭 postMessage가 유일하게 cross-origin에서 동작.

## 위험 요소

1. **blocker 핸드오프 레이스** (최대 위험): top blocker `pointerEvents` 토글이 mousemove에 의존. blocker=none인 짧은 창에 iframe 경계 밖 클릭이 페이지로 새면 원치 않는 네비게이션. mousemove가 click을 선행하므로 실무상 드묾. 회귀 테스트: 링크 인접 iframe에서 hover in/out 반복 후 클릭. **수동 검증 필수**(captureVisibleTab·실제 iframe 필요).
2. **top-frame 요소 선택 회귀**: `ensureContentScript`를 allFrames로 바꾸면 top frame 동작이 바뀌면 안 됨. all_frames 정적 주입 + programmatic allFrames 재주입 시 top frame picker 이중 초기화 → overlay 중복. `HOST_ID` orphan 제거(`removeOrphanOverlay`)와 멱등 가드로 방지(레코더 BRIDGE_FLAG 선례). picker에 **주입 멱등 플래그** 추가 검토.
3. **좌표 변환 오차**: iframe border/padding, `box-sizing`, 스크롤. `clientLeft/clientTop`(border)만 보정하고 padding은 iframe content가 padding 안쪽이라 무관. transform/zoom된 iframe은 오차 가능(엣지, 비목표 근처).
4. **viewport 스케일 불일치**: 캡처 크롭 scale은 top 뷰포트 기준이어야 함(위 데이터 흐름 주의). iframe innerWidth를 쓰면 크롭이 어긋남 → 반드시 top viewport를 offset 응답에 실어 사용.
5. **hidden 탭/rAF 미발화**: 좌표 postMessage 응답 타임아웃(기존 `prepareCaptureBySelector`의 500ms 폴백과 동일 패턴)으로 매달림 방지.
6. **sandbox iframe**: 스크립트 차단 프레임엔 picker 미주입 → top이 IFRAME으로 인식, 핸드오프 후 iframe이 무응답 → click이 top `onClickCommit`에 IFRAME으로 잡힘 → 거부 경로. graceful.
7. **다중 편집 매칭**: 서로 다른 프레임에 동일 selector가 존재할 수 있음 → 버퍼 매칭·재바인딩을 `frameId + selector` 복합키로. selector 단독 매칭 잔존 시 오적용.
8. **rebind/resume 경로**: `rebindStylingSession`·`resumeBufferedElement`(picker-control.ts:207-382)가 `selectByPath(tabId, selector)`를 top으로만 보냄 → **frameId 라우팅 추가 필요**. 누락 시 패널 재오픈 후 iframe 요소 편집 복원 실패.
