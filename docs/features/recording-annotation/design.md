# 녹화 중 어노테이션 (그리기) — 기술 설계

## 개요

어노테이션 오버레이를 **picker 콘텐츠 스크립트 엔트리의 내부 모듈**(`src/content/annotation.ts`, area-select와 동일한 배치)로 추가한다. `overlay.ts`의 shadow DOM + `:host { all: initial }` 격리 패턴과 blocker 패턴을 재사용해, 페이지 위에 SVG 획 레이어와 포인터 blocker만 마운트한다(**온-페이지 툴바 없음**). 그리기 켜고 끄기는 **사이드패널 녹화 컨트롤(IssueTab RecordingState)의 펜 토글 버튼**이 담당하고, 진실 소스는 **editor-store의 `annotationPenOn` 필드**다(로컬 useState 금지 — 탭 전환·재표시 훅 접근 문제). 제어는 기존 `PickerMessage` union에 `annotation.*` 멤버를 추가해 `chrome.tabs.sendMessage`로 내리고, 페이지에서 Esc로 펜을 끄면 `postToRuntime` 업스트림으로 스토어를 동기화한다. 획은 완성 시점에 3초 타이머 → CSS opacity 페이드 후 DOM 제거. 저장은 없다(순수 시각 효과). tabCapture·getDisplayMedia는 페이지 전체를 캡처하므로 shadow DOM 오버레이가 별도 합성 없이 녹화에 포함된다.

## 변경 범위

### 새 파일

- **`src/content/annotation.ts`** — picker 엔트리 내부 모듈 (area-select.ts와 동일 지위. **manifest 엔트리 추가 없음**)
  - 역할: 어노테이션 오버레이 라이프사이클. picker.ts의 메시지 핸들러에서 `annotation.show`/`annotation.hide`/`annotation.setPen`을 위임받아 처리. show 시 shadow host(`id = ANNOTATION_HOST_ID`) 생성 → `attachShadow({ mode: "open" })`(e2e path 판정이 open에 의존) → SVG 레이어 + blocker 마운트(기본 펜 OFF·pass-through). `setPen`으로 blocker pointer-events 전환. 드래그 그리기·획별 페이드. hide 시 전부 정리.
  - **Esc 끄기**: 펜 ON 동안 window capture `keydown`으로 Esc 수신 → 펜 OFF(blocker 해제) + `postToRuntime({ type: "annotation.penOff" })` 업스트림 (picker.ts:655-666 Esc 취소 + `picker.cancelled` 업스트림 선례와 동일 패턴).
  - **스크롤 양보**: picker blocker의 `yieldToScroll` 패턴(overlay.ts:208-215 — wheel/touchmove 감지 시 120ms간 pointer-events를 none으로 내려 스크롤 통과)을 재사용해 펜 ON 중에도 페이지 스크롤 가능.
  - **그리는 도중 인터럽트**: `setPen(false)`·`hide`·Esc 어느 경로든 activeStroke가 있으면 **즉시 확정(pointerup 상당 처리) 후 window capture 리스너 제거**. 특히 hide는 그리는 도중 녹화가 끝나는 경우(60초 자동·공유 중지)에 온다.
  - picker 엔트리(ISOLATED)에 번들되므로 self-contained 제약 없음. 단 MAIN world action-recorder와 `ANNOTATION_HOST_ID` 리터럴만 동기화(아래).

- **`src/content/annotation-draw.ts`** (순수 함수 — 단위 테스트 대상)
  - `pointsToPath(points)`: 좌표 배열 → SVG path `d` 문자열. `annotation.ts`가 DOM·이벤트를 다루고 순수 계산은 여기 분리.

- **`src/sidepanel/annotation-control.ts`** (recorder-control.ts와 동일 지위의 얇은 send 래퍼)
  - `showAnnotation(tabId)` / `hideAnnotation(tabId)` / `setAnnotationPen(tabId, on)` — `chrome.tabs.sendMessage`. 주입 보장은 **기존 `picker-control.ts:ensureContentScript` 재사용**(annotation이 picker 엔트리에 번들되므로 별도 ensure 불필요 — 비export면 export 추가).

### 변경 파일

- **`src/types/picker.ts`** (`PickerMessage` union — :68)
  - `annotation.*` 멤버 추가 (recorder 메시지가 union에 흡수된 기존 컨벤션 그대로. 별도 AnnotationMessage 타입을 만들지 않는다):
    - down: `{ type: "annotation.show" }` / `{ type: "annotation.hide" }` / `{ type: "annotation.setPen"; on: boolean }`
    - up: `{ type: "annotation.penOff" }` (Esc 끄기 → 사이드패널 동기화)
  - 별도 ping 불필요 — picker 엔트리의 기존 `ping`(picker-control.ts:24)이 생존 확인을 겸한다.

- **`src/content/picker.ts`**
  - 메시지 핸들러에 `annotation.*` 분기 추가 → `annotation.ts` 모듈에 위임. (area-select 통합 방식과 동일 — picker 엔트리 비대화가 트레이드오프이나 manifest·ensure·멱등 가드 신설 전부 회피.)

- **`src/store/editor-store.ts`**
  - `annotationPenOn: boolean` 필드(초기 false) + `setAnnotationPen(on: boolean)` 액션 추가. `startRecording`은 `...initial` 리셋이라 녹화 시작 시 자동 false. **펜 상태의 단일 진실 소스** — IssueTab 렌더·재표시 훅·업스트림 동기화가 전부 이 필드를 본다. (이 기능 유일의 스토어 변경.)

- **`src/sidepanel/tabs/IssueTab.tsx`** (녹화 컨트롤 UI — RecordingState, 정지 버튼 :361, 경과 폴링 :329-335)
  - RecordingState 버튼 행에 **펜 토글 버튼** 추가: shadcn Button `variant="outline"` 고정 + active 시 `bg-muted` + `data-active` + `aria-pressed` (**AnnotationToolbar 기존 토글 패턴** — DESIGN.md §버튼: variant 전환·색 변경이 아니라 배경·테두리로 표현). 아이콘 lucide `Pen`류, `h-9 w-9`(기존 텍스트 버튼과 높이 정렬).
  - **`aria-label` + `title` 필수**(아이콘 전용 버튼 — DESIGN.md 규정) → `src/i18n/` ko/en 동시 추가.
  - 클릭 → `useEditorStore.getState().setAnnotationPen(next)` + `setAnnotationPen(tabId, next)` 메시지. tabId는 `useBoundTabId()`(IssueTab.tsx:68)에서.
  - 펜 ON 인지 수단은 crosshair 커서 + 이 버튼의 active 표시로 충분하다고 결정(별도 안내 텍스트 없음).

- **`src/sidepanel/video-capture.ts`**
  - `startVideoCapture`: `beginTabRecording` 성공 직후(:60 부근) `showAnnotation(tabId)`(실패는 warn no-op). `startScreenCapture`: `startScreenRecording` 성공 직후(:99 부근) 동일. (주의: editor-store 액션 `startRecording`과 video-recorder 함수명 혼동 금지 — 훅 지점은 video-capture의 성공 경로다.)

- **`src/sidepanel/video-recorder.ts`**
  - `onstop`(:47): **`state`는 :66에서 null 처리되므로 `state.tabId` 직접 참조 금지** — 이미 캡처된 `localTabId`(:63)를 사용해 `hideAnnotation(localTabId)`를 **fire-and-forget + try/catch로 격리**(실패가 `onRecordingComplete` 흐름을 죽여 녹화 결과물을 유실시키면 안 됨).
  - `cancelRecording`(:186): `state = null`(:198) **이전에** tabId를 지역 변수로 캡처한 뒤 `hideAnnotation` 호출.

- **`src/content/action-recorder.ts`** (회귀 방지 핵심)
  - `HOST_ID`(:21-22) 옆에 `ANNOTATION_HOST_ID = "__bugshot_annotation_host"` 리터럴 추가(MAIN world라 import 불가 — 동기 복제 주석 규칙).
  - `isOwnUi`(:93)의 id 매칭 로직을 **순수 함수로 추출**해 `action-recorder-helpers.ts`로 이동(예: `matchesOwnHost(elementIds, hostIds)` — helpers는 이미 action-recorder가 import하는 같은 청크 내 모듈이라 pre-arm 제약과 무충돌). picker host + annotation host 둘 다 제외. 이걸 안 하면 펜 드래그의 pointerdown/move/up이 action-recorder 드래그 휴리스틱에 잡혀 액션 로그가 오염된다(capture phase라 콘텐츠 측 `stopPropagation`으로 못 막음 — host 제외가 유일 해법).

- **`src/sidepanel/hooks/usePickerMessages.ts`**
  - `annotation.penOff` 업스트림 수신 → `useEditorStore.getState().setAnnotationPen(false)` (Esc 끄기 동기화. `picker.cancelled` 수신 패턴과 동일).

- **`src/sidepanel/hooks/useBackgroundRecorder.ts`** (내비게이션 재표시)
  - **main-frame 내비게이션 재주입의 실제 경로는 이 훅의 `tabs.onUpdated` 핸들러(:70-94, pageKey 변경 + status complete → 로그 레코더 재주입)다.** `webNavigation.onCommitted` 기반 `frameCommitted`는 iframe 전용(`frameId !== 0`)이라 main-frame에선 발화하지 않는다 — 초안의 "sentinel 재발행 경로에 얹기"는 성립하지 않아 폐기.
  - 이 핸들러에서 녹화 활성(`videoRecorder.isRecording()`)이면 `showAnnotation(tabId)` 재전송 + `useEditorStore.getState().annotationPenOn`이 true면 `setAnnotationPen(tabId, true)`도 재전송(새 페이지의 오버레이는 기본 OFF로 마운트되므로).

## 데이터 흐름

```
[사이드패널] 녹화 시작 (video-capture: beginTabRecording/startScreenRecording 성공 직후)
   └ editor-store phase="recording" (...initial 리셋 → annotationPenOn=false)
   └ showAnnotation(tabId) ──tabs.sendMessage──▶ [content picker.ts → annotation.ts] "annotation.show"
                                                    └ shadow host + SVG 레이어 + blocker(펜 OFF, pass-through)

[사이드패널] IssueTab 펜 토글 (editor-store.annotationPenOn 구독)
   └ setAnnotationPen(store) + setAnnotationPen(tabId, on) ──▶ [content] "annotation.setPen"
        on  → blocker pointer-events:auto (crosshair, wheel은 yieldToScroll로 양보)
        off → blocker pointer-events:none (activeStroke 있으면 즉시 확정)

[content] 펜 ON 상태에서 페이지 드래그
   pointerdown → 새 획 시작 (흰 테두리 + 빨강 본선 2겹 path, 동일 d 공유)
   pointermove → pointsToPath로 d 갱신 (window capture)
   pointerup   → 획 확정 → setTimeout(3000) → .fading(opacity 0, 400ms) → transitionend → remove

[content] Esc (펜 ON 중, window capture keydown)
   └ 펜 OFF + activeStroke 확정 + postToRuntime({type:"annotation.penOff"})
        ──runtime.sendMessage──▶ [사이드패널 usePickerMessages] → editor-store.setAnnotationPen(false)

[사이드패널] 녹화 중 페이지 이동 (useBackgroundRecorder tabs.onUpdated :70-94)
   └ 로그 레코더 재주입 시점에 showAnnotation(tabId) 재전송
   └ annotationPenOn === true면 setAnnotationPen(tabId, true) 재전송

[사이드패널] 녹화 종료 (video-recorder onstop[localTabId 캡처] / cancelRecording[null 전 캡처])
   └ hideAnnotation(tabId) — try/catch 격리 ──▶ [content] "annotation.hide"
        └ activeStroke 확정 + 리스너 제거 + 타이머 전부 clear + host remove
```

- **스토어 변경은 editor-store `annotationPenOn` 하나뿐**: IndexedDB(blob-db)·issues-store 등 영속 저장 없음. 그림 데이터도 어디에도 안 올림.
- **메시지**: down 3개(show/hide/setPen) + up 1개(penOff, Esc 동기화용). 모두 `PickerMessage` union 멤버.

## 인터페이스 설계

```typescript
// src/types/picker.ts — PickerMessage union에 멤버 추가
  | { type: "annotation.show" }
  | { type: "annotation.hide" }
  | { type: "annotation.setPen"; on: boolean }
  | { type: "annotation.penOff" }   // content → 사이드패널 (Esc)

// src/store/editor-store.ts
annotationPenOn: boolean;                    // 초기 false, startRecording 리셋에 편승
setAnnotationPen: (on: boolean) => void;

// src/sidepanel/annotation-control.ts (recorder-control.ts 패턴의 얇은 send 래퍼)
export function showAnnotation(tabId: number): Promise<void>;
export function hideAnnotation(tabId: number): Promise<void>;
export function setAnnotationPen(tabId: number, on: boolean): Promise<void>;

// src/content/annotation.ts (내부 핸들)
interface AnnotationHandle {
  hostEl: HTMLDivElement;     // id = ANNOTATION_HOST_ID
  shadow: ShadowRoot;         // mode: "open" — e2e path-count 판정 의존
  svgEl: SVGSVGElement;       // 획 레이어 (position:fixed; inset:0; pointer-events:none, viewBox 미지정 — CSS px 좌표)
  blockerEl: HTMLDivElement;  // 펜 ON일 때만 pointer-events:auto + crosshair, yieldToScroll 적용
  penOn: boolean;
  activeStroke: { groupEl: SVGGElement; points: Array<[number, number]> } | null;
  fadeTimers: Set<ReturnType<typeof setTimeout>>;
}

// src/content/annotation-draw.ts (순수 함수 — 단위 테스트 대상)
export function pointsToPath(points: Array<[number, number]>): string;

// src/content/action-recorder-helpers.ts (isOwnUi 로직 추출 — 순수 함수, node 테스트 가능)
export function matchesOwnHost(elementIds: readonly string[], hostIds: readonly string[]): boolean;
```

- 상수: `ANNOTATION_HOST_ID = "__bugshot_annotation_host"`, `STROKE_COLOR = "#ef4444"`, `STROKE_OUTLINE = "#ffffff"`, `STROKE_WIDTH = 3`, `OUTLINE_WIDTH = 6`, `FADE_DELAY_MS = 3000`, `FADE_DURATION_MS = 400`.
- **획 = `<g>` 안에 동일 `d`를 공유하는 path 2겹**(흰 6px 아래 + 빨강 3px 위) — 빨간 배경·에러 UI 위에서도 시인. 페이드·remove는 `<g>` 단위.
- action-recorder.ts는 MAIN world라 import 불가 → `ANNOTATION_HOST_ID` 리터럴을 그쪽에도 동기 복제(기존 `HOST_ID` 주석 규칙과 동일).

## 기존 패턴 준수

- **picker 엔트리 내부 모듈**: area-select.ts와 동일 배치 — manifest 무변경, `content_scripts[0] = picker` 규칙에 영향 없음, 기존 `ensureContentScript` 주입 보장 재사용.
- **메시지 단일 union**: recorder 메시지가 `PickerMessage`에 흡수된 컨벤션 그대로 `annotation.*` 멤버 추가.
- **Shadow DOM 격리**: `attachShadow({mode:"open"})` + `:host { all: initial }` + shadow 내 `<style>` (overlay.ts:28,196).
- **blocker + yieldToScroll**: picker blocker의 스크롤 양보 패턴(overlay.ts:208-215) 재사용.
- **Esc + 업스트림 동기화**: picker.ts:655-666의 Esc 취소 → `postToRuntime({type:"picker.cancelled"})` → usePickerMessages 수신 패턴과 동일 구조.
- **드래그 이벤트**: area-select.ts:156-166 참고 — 단 그쪽은 **mouse 이벤트**(mousedown/move/up)고, annotation은 터치·펜 입력까지 커버하는 **pointer 이벤트를 새로 채택**한다(패턴 구조만 재사용: blocker에서 down, window capture로 move/up, 종료 시 리스너 제거). action-recorder의 pointer 후킹 경로에 `isOwnUi` 제외가 적용되는지 구현 시 실 탭 확인.
- **토글 버튼**: AnnotationToolbar 패턴(`variant="outline"` 고정 + active 시 `bg-muted` + `data-active` + `aria-pressed`). 아이콘 전용이므로 `aria-label`+`title` 필수(DESIGN.md) → i18n ko/en 동시.
- **테스트 우선**: `pointsToPath`·`matchesOwnHost` 순수 함수 테스트를 먼저 작성.

## 대안 검토

1. **별도 content_scripts 엔트리 신설** — 기각(리뷰 반영).
   - 초안은 4번째 엔트리 + `ensureAnnotationScript` 복제 + 멱등 가드 신설이었다. picker 엔트리 내부 모듈로 얹으면(area-select 선례) 이 보일러플레이트가 전부 불필요하고 메시지 라우팅·주입 보장을 그대로 재사용한다. 트레이드오프는 picker 엔트리 비대화뿐 — dormant 시 비용 차이는 무의미.

2. **Canvas(`<canvas>` 2D) vs SVG 획 레이어** — 채택: SVG.
   - SVG는 획별 개별 엘리먼트라 획 단위 페이드(요소별 opacity 트랜지션 + 개별 remove)가 자명. Canvas는 전체 비트맵이라 매 프레임 재렌더(rAF + 남은 획 alpha 계산)가 필요해 복잡도가 오른다.

3. **펜 상태를 IssueTab 로컬 useState로** — 기각(리뷰 반영).
   - 재표시 훅(useBackgroundRecorder)이 컴포넌트 로컬 state에 접근 불가 + 사이드패널 탭 전환으로 IssueTab이 언마운트되면 state 소실 → 페이지 blocker만 ON 잔존(클릭 계속 막힘). editor-store 필드로 승격하면 두 문제가 모두 해소되고 `startRecording`의 `...initial` 리셋에 자동 편승.

4. **Loom식 코멧 트레일(그리는 동안 꼬리부터 연속 페이드)** — 기각.
   - 사용자가 "획 단위 3초 후 페이드"를 택함. 연속 트레일은 rAF 루프·포인트별 타임스탬프가 필요해 더 복잡.

## 위험 요소

- **온-페이지 UI 없음의 이점**: 펜 컨트롤이 사이드패널에 있으므로 녹화 영상에 확장 UI가 찍히지 않는다(그린 획만 남는다).
- **획-콘텐츠 어긋남 (알려진 제약)**: SVG가 `position:fixed` 뷰포트 좌표라, 획이 살아있는 3초 안에 스크롤하면 획이 콘텐츠와 분리된 채 화면에 남는다. 획 수명이 짧아 실해가 작다고 판단 — 수용. yieldToScroll로 펜 ON 중 스크롤을 허용하는 결정과 한 쌍.
- **onstop 격리**: `hideAnnotation` 호출이 throw하면 `onRecordingComplete`가 죽어 녹화 결과물이 유실된다. 반드시 `localTabId` + try/catch(또는 `.catch()`) 격리. `cancelRecording`도 `state = null` 전에 tabId 캡처.
- **action-recorder 오염**: `matchesOwnHost`에 annotation host를 빠뜨리면 펜 드래그가 액션 로그에 잡힌다. 실 탭 회귀 확인 필수.
- **펜 상태 ↔ 페이지 동기화**: 진실은 editor-store, 실제 blocker는 페이지. (a) 내비게이션·재주입으로 오버레이가 기본 OFF로 새로 뜨는 경우 → `annotationPenOn`이 true면 재전송, (b) Esc로 페이지 쪽이 먼저 꺼지는 경우 → `annotation.penOff` 업스트림. 두 방향 모두 배선해야 어긋나지 않는다.
- **성능은 실질 문제 아님**: pointermove당 `d` 재조립은 획당 수백 포인트 규모라 저비용, 획 수는 3초 페이드로 자연 상한. pointermove에 rAF 스로틀 한 줄만 권장(필수 아님) — 과최적화 금지.
- **picker와의 동거**: picker 오버레이(`__bugshot_picker_host`)와 annotation host는 별개 엘리먼트로 공존 가능. 녹화 중엔 picker가 비활성이라 실질 충돌 없음 — 단 `picker.ts:612`·`dom-describe.ts:104`의 자기-UI 검사가 annotation host 위 요소를 선택 대상으로 잡지 않도록, 녹화 중 picker 진입이 실제로 차단되는지 구현 시 확인(차단 안 되면 그쪽에도 host 제외 추가).
