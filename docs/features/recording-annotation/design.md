# 녹화 중 어노테이션 (그리기) — 기술 설계

## 개요

새 ISOLATED 콘텐츠 스크립트 `src/content/annotation.ts`를 추가한다. 이 스크립트는 `overlay.ts`의 shadow DOM + `:host { all: initial }` 격리 패턴과 `area-select.ts`의 드래그 이벤트 패턴을 재사용해, 페이지 위에 SVG 획 레이어와 포인터 blocker만 마운트한다(**온-페이지 툴바 없음**). 그리기 켜고 끄기는 **사이드패널 녹화 컨트롤의 펜 토글 버튼**이 담당하며, `chrome.tabs.sendMessage`로 `annotation.setPen`을 보내 blocker의 pointer-events를 전환한다. 녹화 시작/정지 진입점(`video-capture.ts` / `video-recorder.ts`)은 `annotation.show`/`annotation.hide`로 오버레이를 마운트·해제한다. 그림은 순수 시각 효과로 어디에도 저장하지 않으며, 각 획은 완성 시점에 3초 타이머를 걸어 CSS opacity 트랜지션으로 페이드 후 DOM에서 제거한다. tabCapture·getDisplayMedia는 페이지 전체를 캡처하므로 shadow DOM 오버레이가 별도 합성 없이 녹화에 포함된다.

## 변경 범위

### 새 파일

- **`src/content/annotation.ts`** (ISOLATED content script, top frame)
  - 역할: 어노테이션 오버레이의 전체 라이프사이클. `chrome.runtime.onMessage`로 `annotation.show` / `annotation.hide` / `annotation.setPen` / `annotation.ping` 수신. show 시 shadow host 생성·SVG 레이어·blocker 마운트(펜 OFF·pass-through 기본), `setPen`으로 blocker pointer-events 전환, 드래그 그리기·획별 페이드 처리. hide 시 전부 정리. **온-페이지 툴바 없음.**
  - 멱등 가드: `window.__bugshotAnnotation__` 플래그(recorder-bridge의 `BRIDGE_FLAG` 패턴)로 재주입 시 리스너 중복 등록 방지.
  - self-contained 제약 **없음**(MAIN world 아님) — `@/` import 자유. 단, MAIN world action-recorder와 host id 리터럴만 동기화 필요(아래).

- **`src/content/annotation-draw.ts`** (선택 분리 — 순수 함수 테스트 대상)
  - 역할: 좌표 → SVG path `d` 문자열 변환 등 순수 로직. `annotation.ts` 본체에서 DOM·이벤트를 다루고, 순수 계산은 이 파일로 분리해 단위 테스트한다. (규모가 작으면 `annotation.ts` 내부에 두고 named export만 테스트해도 됨 — 구현 시 판단.)

- **`src/sidepanel/annotation-control.ts`**
  - 역할: 사이드패널 → 콘텐츠 스크립트 제어. `ensureAnnotationScript(tabId)`(picker-control `ensureContentScript` 패턴: ping 실패 시 `chrome.scripting.executeScript`로 재주입), `showAnnotation(tabId)`, `hideAnnotation(tabId)`, `setAnnotationPen(tabId, on)`.

### 변경 파일

- **`manifest.config.ts`** (content_scripts 배열)
  - `src/content/annotation.ts`를 **배열 끝에 append** (index ≥ 3). **index 0은 picker.ts 고정** — `content_scripts[0]`를 programmatic 주입에 쓰므로 순서 훼손 금지.
  - 설정: `matches: ["<all_urls>"]`, `exclude_matches: ["https://bugshot.gitbook.io/*"]`, `run_at: "document_idle"`, `all_frames` 미지정(top frame 한정). ISOLATED(기본 world).

- **`src/sidepanel/video-capture.ts`**
  - `startVideoCapture`(tab): `startRecording(...,"tab")` 성공 직후 `ensureAnnotationScript(tabId)` → `showAnnotation(tabId)`.
  - `startScreenCapture`(screen): `startRecording(...,"screen")` 성공 직후 동일.

- **`src/sidepanel/video-recorder.ts`**
  - `onstop`(video-recorder.ts:47) 및 `cancelRecording`(video-recorder.ts:186): 녹화 종료·취소 시 `hideAnnotation(state.tabId)` 호출. (60초 자동 종료·화면공유 중지·수동 정지 모두 `recorder.stop()`→`onstop`을 지나므로 단일 choke point에서 처리.)

- **`src/sidepanel/tabs/IssueTab.tsx`** (녹화 컨트롤 UI)
  - 녹화 중 정지 버튼·경과시간이 렌더되는 지점(IssueTab.tsx:100 `onStop`, :327-332 경과 폴링)에 **펜 토글 버튼**을 추가. shadcn 버튼(아이콘: lucide `Pen`/`PenLine`), active 상태 시각 표시(variant/색상).
  - 펜 ON/OFF 상태는 이 컴포넌트의 로컬 `useState`(예: `penOn`)로 관리 — 별도 스토어 불필요. 토글 시 `setAnnotationPen(recordingTabId, next)` 호출.
  - 녹화 phase를 벗어나면 버튼이 언마운트되며 상태가 자연 소멸. 녹화 시작 시 기본 OFF.
  - 툴팁/aria-label을 넣는다면 `src/i18n/`에 ko/en 동시 추가.

- **`src/content/action-recorder.ts`** (회귀 방지 핵심)
  - `HOST_ID`(action-recorder.ts:22, `"__bugshot_picker_host"` 리터럴) 옆에 `ANNOTATION_HOST_ID = "__bugshot_annotation_host"` 리터럴 추가.
  - `isOwnUi`(action-recorder.ts:93): path 루프·`el.closest` 검사에 annotation host id도 포함. 이걸 안 하면 펜 드래그의 pointerdown/move/up이 action-recorder의 포인터 드래그 휴리스틱에 잡혀 액션 로그가 오염된다(action-recorder는 capture phase로 window에서 먼저 잡으므로, 콘텐츠 스크립트 측 `stopPropagation`으로는 못 막고 이 제외가 유일한 해법).

- **`src/background/messages.ts`** 또는 관련 메시지 타입 정의부
  - `AnnotationMessage` 타입 추가(아래 인터페이스). 기존 `PickerMessage` 정의 위치·컨벤션에 맞춰 배치.

### 내비게이션 재표시 (엣지)

녹화 중 페이지 이동 시 새 페이지에 오버레이를 다시 마운트하고, 펜이 ON 상태였다면 복원한다. 기존에 로그 레코더 sentinel을 커밋된 프레임에 재발행하는 지점(`webNavigation.onCommitted` 기반 — `src/background/tab-bindings.ts` / picker-control `tabSentinels`)과 **동일한 신호**를 활용:
- 녹화 활성 탭의 main-frame `onCommitted`에서 `ensureAnnotationScript(tabId)` + `showAnnotation(tabId)` 재전송, 그리고 IssueTab의 현재 `penOn`이 true면 `setAnnotationPen(tabId, true)`도 재전송(새 페이지의 오버레이는 기본 OFF로 마운트되므로).
- "녹화 활성" 판정은 사이드패널 컨텍스트(`videoRecorder.isRecording()` + `state.tabId`)가 가지므로, 재표시 트리거는 이미 sentinel 재발행을 사이드패널이 수신·처리하는 경로에 얹는다. (구현 시 정확한 훅 위치는 tab-bindings/usePickerMessages 중 sentinel 재발행 담당부를 따른다.)

## 데이터 흐름

```
[사이드패널] 녹화 시작 (video-capture.startVideoCapture/startScreenCapture)
   └ startRecording(...) → editor-store phase="recording"
   └ ensureAnnotationScript(tabId)                 // ping 실패 시 executeScript 재주입
   └ showAnnotation(tabId)  ──tabs.sendMessage──▶  [content annotation.ts] onMessage "annotation.show"
                                                        └ shadow host 마운트 + SVG 레이어 + blocker(펜 OFF, pass-through)

[사이드패널] IssueTab 펜 토글 버튼 클릭 (penOn useState)
   └ setAnnotationPen(tabId, on) ──tabs.sendMessage──▶ [content] onMessage "annotation.setPen"
        on  → blocker pointer-events:auto (crosshair)
        off → blocker pointer-events:none (페이지 조작 복귀), 기존 획 타이머는 유지

[content] 펜 ON 상태에서 페이지 드래그
   pointerdown → 새 SVG <path> 시작, 포인트 누적
   pointermove → path d 갱신 (annotation-draw.pointsToPath)
   pointerup   → 획 확정 → setTimeout(3000) → .fading 클래스(opacity 0, ~400ms transition) → transitionend에서 remove

[사이드패널] 녹화 종료 (video-recorder.onstop / cancelRecording)
   └ hideAnnotation(state.tabId) ──tabs.sendMessage──▶ [content] onMessage "annotation.hide"
                                                        └ 리스너 제거 + 모든 타이머 clear + host remove
   └ IssueTab 펜 버튼 언마운트 (penOn 상태 소멸)
```

- **저장소·스토어 변경 없음**: 어노테이션은 IndexedDB(blob-db)·editor-store·issues-store 어디에도 기록하지 않는다. 펜 ON/OFF는 IssueTab 로컬 `useState`. 순수 DOM 시각 효과.
- **메시지 방향**: 제어는 사이드패널 → content (`chrome.tabs.sendMessage`), 단방향. content → 사이드패널 업스트림 없음(그림 데이터를 올릴 필요가 없음).

## 인터페이스 설계

```typescript
// 메시지 (messages.ts 또는 PickerMessage 정의부 인접)
export type AnnotationMessage =
  | { type: "annotation.show" }
  | { type: "annotation.hide" }
  | { type: "annotation.setPen"; on: boolean }
  | { type: "annotation.ping" }; // ensureAnnotationScript 생존 확인용

// src/sidepanel/annotation-control.ts
export function ensureAnnotationScript(tabId: number): Promise<void>;
export function showAnnotation(tabId: number): Promise<void>;
export function hideAnnotation(tabId: number): Promise<void>;
export function setAnnotationPen(tabId: number, on: boolean): Promise<void>;

// src/content/annotation.ts (내부 핸들)
interface AnnotationHandle {
  hostEl: HTMLDivElement;     // id = ANNOTATION_HOST_ID
  shadow: ShadowRoot;
  svgEl: SVGSVGElement;       // 획 레이어 (position:fixed; inset:0; pointer-events:none)
  blockerEl: HTMLDivElement;  // 펜 ON일 때만 pointer-events:auto, crosshair (온-페이지 툴바 없음)
  penOn: boolean;             // setPen 메시지로 전환
  activeStroke: { pathEl: SVGPathElement; points: Array<[number, number]> } | null;
  fadeTimers: Set<ReturnType<typeof setTimeout>>;
}

// src/content/annotation-draw.ts (순수 함수 — 단위 테스트 대상)
export function pointsToPath(points: Array<[number, number]>): string; // SVG path "d"
```

- 상수: `ANNOTATION_HOST_ID = "__bugshot_annotation_host"`, `STROKE_COLOR = "#ef4444"`(고정 빨강), `STROKE_WIDTH = 3`, `FADE_DELAY_MS = 3000`, `FADE_DURATION_MS = 400`.
- action-recorder.ts는 MAIN world라 import 불가 → `ANNOTATION_HOST_ID` 리터럴을 그쪽에도 동기 복제(기존 `HOST_ID` 주석 규칙과 동일).

## 기존 패턴 준수

- **Shadow DOM 격리**: `attachShadow({mode:"open"})` + `:host { all: initial }` + shadow 내 `<style>` 문자열 주입 (`overlay.ts:28,196`). z-index는 picker 오버레이(2147483647)와 겹치지 않게 동급 최상단 사용, 단 picker는 녹화 중 비활성이라 실질 충돌 없음.
- **드래그 이벤트**: blocker에 `pointerdown`, 이후 `window`에 `pointermove`/`pointerup`을 capture(`true`)로 등록·정리 (`area-select.ts:156-166`).
- **멱등 가드 플래그**: `recorder-bridge.ts`의 `BRIDGE_FLAG` 패턴.
- **programmatic 재주입**: `picker-control.ts:ensureContentScript`(ping → executeScript files) 패턴을 `ensureAnnotationScript`에 복제.
- **MAIN/ISOLATED 리터럴 동기화**: action-recorder의 `HOST_ID` 리터럴 복제 규칙(action-recorder.ts:21-22)을 `ANNOTATION_HOST_ID`에도 적용.
- **테스트 우선**: `pointsToPath` 등 순수 함수는 `src/content/__tests__/annotation-draw.test.ts`에 먼저 작성.
- **i18n**: 사이드패널 펜 버튼에 텍스트 라벨을 두지 않고 아이콘만 쓰면 i18n 불필요. 툴팁·aria-label을 넣는다면 `src/i18n/`에 ko/en 동시 추가.
- **UI 컨벤션**: 펜 버튼은 shadcn 버튼 재사용(직접 스타일링 금지). 녹화 컨트롤의 기존 버튼(정지 등) 사이즈·배치에 맞춘다 — DESIGN.md 및 기존 IssueTab 녹화 UI 참고.

## 대안 검토

1. **Canvas(`<canvas>` 2D) vs SVG 획 레이어** — 채택: SVG.
   - SVG는 획별로 개별 `<path>` 엘리먼트라 획 단위 페이드(요소별 opacity 트랜지션 + 개별 remove)가 자명하다. Canvas는 전체 비트맵이라 획별 페이드를 하려면 매 프레임 재렌더(rAF 루프 + 남은 획 alpha 계산)해야 해 복잡도가 오른다. 획 수가 적고(수동 드로잉) 페이드가 "요소 사라짐"이므로 SVG가 단순.

2. **정적 등록 없이 on-demand 주입만** — 부분 채택.
   - 콘텐츠 스크립트를 매 페이지에 상주시키지 않고 녹화 시작 때만 `executeScript`로 주입하는 방법. 다만 crxjs가 빌드 산출 경로를 안정적으로 주려면 content_scripts 엔트리 등록이 가장 확실하다(picker와 동일 이중 모델). 그래서 **엔트리 등록 + `ensureAnnotationScript` 재주입 폴백** 조합을 택하되, dormant 비용은 `chrome.runtime.onMessage` 리스너 1개로 최소화(recorder-bridge와 동급).

3. **사이드패널 `AnnotationOverlay.tsx`(react-konva) 재사용** — 기각.
   - 그건 사이드패널 문서 안에서 정적 스크린샷 위에 주석하는 컴포넌트라 페이지/녹화 스트림에 못 얹는다. 배치 컨텍스트가 다르다.

4. **Loom식 코멧 트레일(그리는 동안 꼬리부터 연속 페이드)** — 기각.
   - 사용자가 "획 단위 3초 후 페이드"를 택함. 연속 트레일은 rAF 루프·포인트별 타임스탬프가 필요해 더 복잡. 획 완성 후 일괄 3초 타이머가 요구를 충족하고 더 단순.

## 위험 요소

- **온-페이지 UI 없음의 이점**: 펜 컨트롤이 사이드패널에 있으므로 녹화 영상에 툴바 같은 확장 UI가 찍히지 않는다(그린 획만 남는다). 이전 안(페이지 플로팅 툴바)의 "툴바가 영상에 찍힘" 문제는 제거됨.
- **펜 상태 ↔ 페이지 동기화**: 펜 ON/OFF의 진실은 사이드패널(IssueTab `penOn`)에 있고 실제 blocker는 페이지에 있다. 내비게이션·재주입으로 페이지 오버레이가 새로 뜨면 기본 OFF이므로, `penOn`이 true면 `setAnnotationPen(...,true)`를 반드시 재전송해야 상태가 어긋나지 않는다.
- **action-recorder 오염**: `isOwnUi`에 annotation host를 빠뜨리면 펜 드래그가 액션 로그에 잡힌다. capture phase 특성상 콘텐츠 측 `stopPropagation`으로 못 막으니 반드시 host 제외로 처리(실 탭 회귀 확인 필수).
- **내비게이션 후 그리기 불능**: 녹화가 페이지 이동을 넘어 이어질 때 재표시 훅을 빠뜨리면 새 페이지에서 오버레이가 없어 펜을 못 쓴다. sentinel 재발행 경로에 재-show(+펜 복원)를 얹어야 한다.
- **타이머·리스너 리크**: hide 시 `window` capture 리스너·`fadeTimers`를 전부 정리하지 않으면 페이지에 잔존. 멱등 가드 플래그도 리셋.
- **화면 녹화 대상 불일치**: getDisplayMedia로 대상 탭이 아닌 창/모니터를 공유하면 오버레이가 영상에 안 잡힌다. 정상 동작이나 사용자 혼동 여지 — 가이드에 한 줄 명시 권장.
- **content_scripts 인덱스**: 새 엔트리를 배열 앞에 끼우면 `content_scripts[0]=picker` 가정이 깨진다. 반드시 끝에 append.
- **crxjs 빌드 경로**: `ensureAnnotationScript`가 참조할 빌드 산출 js 경로를 매니페스트 엔트리에서 안정적으로 얻어야 한다(picker의 `getManifest().content_scripts[0].js` 방식 참고, 인덱스는 annotation 엔트리 위치).
