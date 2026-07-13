# 전체 화면 캡처 — 구현 태스크

## 선행 조건

- 새 권한·env·외부 API **없음**. manifest 변경 없음(`captureVisibleTab`은 이미 `<all_urls>`로 커버).
- 새 의존성 없음. lucide `Crop` / `Fullscreen` / `ScrollText` / `Loader2`는 기존 `lucide-react`에서 가져온다.
- 착수 전 `docs/POSTMORTEM.md`에서 `captureVisibleTab` 항목(2026-06-29) 확인 — 캡처 API 직접 호출 금지, background `capture-throttle` 경유 유지.

## 태스크

### Task 1: `clampCropRect` 순수 함수 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/crop-rect.ts` (신규), `src/sidepanel/lib/__tests__/crop-rect.test.ts` (신규)
- **작업 내용**: 크롭 rect를 캡처 이미지 경계 안으로 클램프하는 순수 함수. 테스트 먼저(red) 후 구현.
  ```ts
  export function clampCropRect(rect: CropRect, imgWidth: number, imgHeight: number): CropRect
  ```
  - x/y를 `[0, imgWidth/imgHeight]`로 클램프, width/height를 남은 영역으로 자르고 최소 1px 보장, 이미지 크기 0 이하면 rect 그대로.
- **검증**:
  - [x] 경계 내부 rect는 입력과 동일하게 반환(항등성 — 기존 드래그 크롭 무영향)
  - [x] width가 이미지 우측을 넘으면 `imgWidth - x`로 잘림 / x 음수면 0 보정
  - [x] rect가 이미지 완전 바깥이면 최소 1×1 반환(canvas 0 크기 방지)
  - [x] `imgWidth <= 0`이면 rect 그대로
  - [x] `pnpm test` 통과

### Task 2: 크롭 가드 적용
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts` (로컬 `cropImage`, L373-395)
- **작업 내용**: `loadImage` 직후 `clampCropRect(rect, img.naturalWidth, img.naturalHeight)` 결과로 canvas 크기·`drawImage` 인자를 대체. DPR 곱셈(L357)·webp 0.92 인코딩은 그대로. element-shot의 별도 `capture.ts:cropImage`는 건드리지 않는다(비목표).
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] 기존 드래그 영역 캡처가 동일하게 동작(Task 9 e2e에서 확인)

### Task 3: content script — 뷰포트 캡처 경로
- **변경 대상**: `src/types/picker.ts`, `src/content/area-select.ts`, `src/content/picker.ts`
- **작업 내용**:
  1. `PickerMessage`에 `| { type: "picker.selectFullViewport" }` 추가(`picker.cancelAreaSelect` 아래).
  2. `area-select.ts`에 `selectFullViewport(handle)` export — `cancelAreaSelect`와 동일한 정리 3단계(`removeListeners` → `cleanupElements` → `onBlockerRequest("hide")`) 후 `deps.onSelected({x:0,y:0,width:innerWidth,height:innerHeight}, viewport)`. **정리가 `onSelected`보다 먼저**여야 오버레이가 캡처에 안 찍힌다.
  3. `picker.ts` switch(L253-258)에 case + `handleSelectFullViewport()` 추가. `areaHandle`이 null이면 no-op, 아니면 `selectFullViewport(areaHandle)` 호출만 한다(기존 `onSelected` 콜백이 `areaHandle=null`·`postToRuntime`·`mode="idle"`·`handleClear()`를 처리 — `restoreAfter` 분기가 있으나 이 경로는 비복원 분기. 중복 작성 금지).
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] `handleSelectFullViewport`가 `postToRuntime`/`handleClear`를 직접 부르지 않는다(코드 리뷰)

### Task 4: 타입 + 스크롤 계획 순수 함수 (테스트 우선)
- **변경 대상**: `src/types/picker.ts` (`PageMetrics`·`ScrollAck` — 스크롤 캡처 메시지 3종의 타입도 여기서 함께 추가), `src/sidepanel/lib/scroll-capture-plan.ts` (신규), `src/sidepanel/lib/__tests__/scroll-capture-plan.test.ts` (신규)
- **작업 내용**: `PageMetrics`/`ScrollAck` 타입을 먼저 정의한 뒤(이 태스크에 포함 — Task 5가 아니라 여기), 테스트 먼저(red) 후 구현.
  ```ts
  export const MAX_SCROLL_TILES = 20;
  export const MAX_CANVAS_HEIGHT_PX = 32000;
  export function planScrollCapture(metrics: PageMetrics, maxTiles?: number): ScrollPlan;   // { tiles, totalHeight, truncated }
  export function tileDrawRect(plan: ScrollPlan, index: number, actualY: number): TileDraw;  // { srcY, srcHeight, destY }
  ```
  - 타일 y = `0, vh, 2vh, …`, `scrollHeight`를 덮을 때까지. `maxTiles` 초과 시 잘라내고 `truncated: true`.
  - **캔버스 높이 한계**: `totalHeight × metrics.devicePixelRatio > MAX_CANVAS_HEIGHT_PX`면 타일 수를 추가로 줄이고 `truncated: true`.
  - `tileDrawRect`는 content script가 응답한 **실제 scrollY**를 받아 마지막 타일의 겹침(문서 끝 클램프)을 `srcY`로 보정한다.
  - **방어**: `vh ≤ 0` / `scrollHeight ≤ 0`이면 타일 1개 계획으로 강등(무한 루프 좌표 차단).
- **검증**:
  - [x] 페이지 높이 = 뷰포트 높이 → 타일 1개, `truncated: false`
  - [x] 페이지 높이가 뷰포트의 2.5배 → 타일 3개, 마지막 타일 겹침이 `tileDrawRect`에서 잘려 `destY` 합이 `totalHeight`와 일치
  - [x] 100 뷰포트 높이 → 타일 20개 + `truncated: true`
  - [x] vh 1000 × DPR 2 → 캔버스 한계로 20타일 미만 + `truncated: true`
  - [x] `vh = 0` / `scrollHeight = 0` → 타일 1개 방어
  - [x] DPR 소수점(줌 125% 등)에서 `destY × scale` 반올림이 누적 오차 없이 일관(타일별 `Math.round` 정책 고정)
  - [x] `pnpm test` 통과

### Task 5: content script — 스크롤 캡처 executor
- **변경 대상**: `src/content/scroll-capture.ts` (신규), `src/content/picker.ts`
- **작업 내용**:
  1. `scroll-capture.ts`: `beginScrollCapture()`(스크롤 저장 + 메트릭 측정 — `document.scrollingElement` null이면 `documentElement` 폴백, `devicePixelRatio` 포함), `scrollCaptureTo(session, y, hideFixed)`(첫 hideFixed에서 fixed/sticky **1회 수집·세션 캐시** — 이후 타일은 재사용(전수 순회 리플로우 비용), 숨김은 prev 값·priority 저장 + `setProperty("visibility","hidden","important")`(picker.ts L489-503 패턴 — 직접 대입은 페이지 `!important`에 지고 원값 유실) → `scrollTo({top:y, behavior:"instant"})` **옵션 객체 필수**(2-arg는 `scroll-behavior:smooth`에 밀림) → rAF×2 + 500ms 폴백 → 실제 `scrollY` 응답), `endScrollCapture(session)`(고정 요소 원복 + 원래 스크롤 복원).
  2. `picker.ts`: 핸들러 3개 + `scrollSession` 모듈 변수. `handleBeginScrollCapture`는 `cancelAreaSelect(areaHandle)`로 dim·rect·라벨을 걷은 뒤 **blocker를 기본 커서로 재표시**(`setBlockerVisible(overlay, true)` — crosshair 아님. 투명이라 캡처 무오염, 클릭 차단 유지).
  3. **async 응답 계약**: `scrollCaptureTo`는 비동기 sendResponse — `collectTokens`(picker.ts L199-210)의 IIFE + `return true` 패턴. switch 공통 `sendResponse({ok:true})` fallthrough(L278)와 이중 응답 안 나게 case return 정확히.
  4. **자가 복원 배선**: `handleClear()`(picker.ts:432-463)와 picker port disconnect 정리 경로에 `scrollSession` 존재 시 `endScrollCapture` + blocker hide + `scrollSession=null` 호출 추가(멱등). 사이드패널 사망 시 페이지 잔류(숨긴 고정 요소 + 엉뚱한 스크롤) 방지.
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [x] picker 오버레이 shadow host가 고정 요소 수집 대상에서 제외된다(코드 리뷰)
  - [x] 세션 없으면 `scrollCaptureTo`는 **무응답**(사이드패널이 중단) / `endScrollCapture`는 no-op
  - [ ] `handleClear` 경유 시 스크롤·고정 요소·blocker가 원복된다(수동 — 스크롤 캡처 중 패널 닫기)

### Task 6: 사이드패널 오케스트레이터
- **변경 대상**: `src/sidepanel/scroll-capture.ts` (신규), `src/sidepanel/picker-control.ts`, (테스트) `src/sidepanel/__tests__/scroll-capture.test.ts` (신규)
- **작업 내용**:
  1. `picker-control.ts`: `captureFullViewport(tabId)` — `send(tabId, { type: "picker.selectFullViewport" }, 0)`. store 직접 조작 없음.
  2. `scroll-capture.ts`: `runScrollCapture(tabId, { onProgress, signal })` — begin → `planScrollCapture` → 타일 루프(각 타일 전 `signal.aborted` 체크 + `chrome.tabs.get`으로 `tab.active` 체크(탭 전환 오염 방지) → `scrollCaptureTo` → `sendBg({type:"captureVisibleTab"})` → `onProgress`) → **`finally`로 `endScrollCapture` 보장**(성공·실패·abort 공통) → canvas 스티칭(DPR 스케일 = `naturalWidth / viewport.width`, `capture.ts:58-93` 패턴) → webp 0.92 → `{ dataUrl, viewport(실제 뷰포트), truncated }`.
  3. **`send` 응답 `undefined` 처리**: `send`는 실패 시 throw가 아니라 `undefined` 반환 — begin/scrollCaptureTo 응답이 `undefined`면(주입 소실·네비게이션) 즉시 중단하고 `finally` 경유.
  4. **테스트 가능 설계**: `send`/`sendBg`/`tabs.get`을 DI(인자 주입)로 열어 `capture-throttle.test.ts` 선례처럼 단위 테스트 — "중간 타일 throw에도 end 호출", "abort 시 루프 중단 + end 호출", "tab.active false면 중단", "응답 undefined면 중단"을 시퀀스로 판정.
- **검증**:
  - [x] `grep -rn "captureVisibleTab" src/` 결과에서 실제 API 호출은 여전히 `background/messages.ts` 1곳뿐 (POSTMORTEM 재발 방지)
  - [x] 단위 테스트: 중간 타일 실패·abort·tab 비활성·응답 undefined 각각에서 `endScrollCapture` 메시지가 나간다
  - [x] `frameId: 0`으로만 전송(broadcast 아님)
  - [x] `pnpm test` + `pnpm typecheck` 통과

### Task 7: i18n 라벨
- **변경 대상**: `src/i18n/namespaces/issue.ts`
- **작업 내용**: `issue.capturing.method.area` / `.viewport` / `.fullPage`, `issue.capturing.scrolling`, `issue.capturing.progress`, `issue.capturing.truncated` — ko/en 동시(문안은 design.md 표).
- **검증**:
  - [x] i18n PostToolUse 훅(`locales.test.ts`) 통과 — ko/en 키 대칭·placeholder 토큰 일치

### Task 8: UI — capturing 하단 캡처 방식 툴바
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**:
  1. `CapturingState`를 본문(`EmptyShell`) + 하단 footer 구조로 확장. footer는 녹화 footer의 **자리·컨테이너 클래스(`border-t border-border bg-background p-4`)만 공유**(기존 녹화 footer는 ButtonGroup이 아니라 그룹 3개 `justify-between` 나열 — 여기는 `justify-center` + `<ButtonGroup className="flex-nowrap">` 신규 채택, 세그먼트 융합 룩 의도).
  2. 아이콘 버튼 3개: `Crop`(영역, 활성 시작) / `Fullscreen`(뷰포트 — `Monitor`는 테마 옵션 기사용·`MonitorPlay` 오독 위험으로 기각) / `ScrollText`(스크롤). `ToolbarGroups.tsx`의 `ToolButton` **클래스 규칙만 복제**(`size="icon"` + `h-8 w-8 shrink-0` + `variant="outline"` + 활성 `bg-muted` + `title`/`aria-label`). **`aria-pressed`는 영역 선택 버튼에만**(뷰포트/스크롤은 즉시 실행 액션이라 pressed 시맨틱 부적합).
  3. [영역 선택] 클릭은 no-op. [뷰포트] → `captureFullViewport(tabId)`. [스크롤] → `AbortController` 생성 + `runScrollCapture(tabId, {onProgress, signal})` + 진행 state.
  4. 로딩: `scrollProgress` 진행 중 툴바 3개 `disabled`, 스크롤 버튼 아이콘 `Loader2 animate-spin`(`ReplayButton` L282-288 패턴), `EmptyShell` title을 `issue.capturing.scrolling`으로 교체. **`EmptyShell`에 `children` 슬롯 추가**(현재 `{icon,title,action?}`만 — 진행 노드 낄 자리가 없음) → `n / N` 텍스트 + 진행 바(녹화 진행 바 L390-395는 바 마크업만 — 텍스트는 별도 렌더) 배치.
  5. **[취소]는 진행 중에도 enabled** — 대기 중엔 `cancelAreaCapture`, 스크롤 진행 중엔 `abort()`(→ `finally` 원복 → `reset()`).
  6. 완료 시 **`phase === "capturing"` 재확인 후** `onAreaCaptured(dataUrl, viewport)` — 진행 중 reset 분기 3곳(`useEditorSessionSync.ts:210-218`·`:252-261`·`App.tsx:152-157`) 발화 시 결과 폐기(유령 drafting 차단). `truncated`면 **`toast.info`**(AiDraftDialog contextTrimmed 선례).
  7. `data-testid`: `capture-method-area` / `capture-method-viewport` / `capture-method-fullpage`, `capturing-cancel`(신규).
- **검증**:
  - [x] `pnpm typecheck` 통과
  - [ ] 다크모드·좁은 패널 폭(320px)에서 버튼 3개가 줄바꿈 없이 정렬(수동)
  - [ ] 진행 중 툴바가 비활성이고 스피너가 돌며 [취소]는 눌린다(수동)

### Task 9: e2e 시나리오 추가
- **변경 대상**: `e2e/capture.spec.ts` (+ 필요 시 스크롤용 fixture 페이지)
- **작업 내용**:
  1. "뷰포트 캡처 → drafting 진입" — `mode-screenshot` 클릭 → `capture-method-viewport` 클릭. 단일 캡처라 기존 `captureUntilDrafting` 헬퍼 재사용(rate-limit flake 흡수).
  2. "스크롤 캡처 → drafting 진입" — **뷰포트 1.5배 높이 극소 fixture로 타일 2개 고정**(GOTCHAS 6 '캡처 진입로 새 spec 금지' 정책과의 절충 — quota 소비 최소화. 타임아웃 증액으로 때우지 않는다: GOTCHAS 28). 판정: drafting 진입 후 `panel.locator('[data-testid="drafting-panel"] img')`의 `evaluate(el => el.naturalHeight)` > fixture의 `innerHeight × devicePixelRatio`. 재시도는 quota 회복 간격(1초+)을 지키고 전체 런 재실행 횟수를 최소로(라이브락 방지).
  3. 기존 드래그 영역 캡처 테스트가 계속 통과하는지 확인.
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e` green
  - [ ] 캡처 폴링 헬퍼는 버스트 금지 규약(`e2e/GOTCHAS.md:28`) 준수 + 스크롤 spec의 quota 소비가 타일 2개 수준으로 고정

## 테스트 계획

### 단위 테스트
- `src/sidepanel/lib/__tests__/crop-rect.test.ts` — `clampCropRect`: 경계 내부 항등성 / 우·하단 초과 클램프 / 음수 x·y 보정 / 완전 바깥 → 1×1 / 이미지 크기 0 방어.
- `src/sidepanel/lib/__tests__/scroll-capture-plan.test.ts` — `planScrollCapture`: 1타일 / 나머지 있는 다타일 / 20타일 상한 / 캔버스 높이 한계 축소 / vh·scrollHeight 0 방어. `tileDrawRect`: 중간 타일 항등(`srcY=0`) / 마지막 타일 겹침 보정 / destY 누적 = `totalHeight` / DPR 소수점 반올림 일관.
- `src/sidepanel/__tests__/scroll-capture.test.ts` — `runScrollCapture`(DI 주입): 정상 시퀀스 / 중간 타일 throw → end 호출 / abort → 중단+end / tab 비활성 → 중단 / 응답 undefined → 중단.

### e2e 시나리오 (`/e2e-write` 입력)
- screenshot 모드에서 사이드패널 [뷰포트 캡처]를 누르면 드래그 없이 drafting 패널이 뜬다.
- screenshot 모드에서 [스크롤 캡처]를 누르면(1.5뷰포트 fixture) 완료 후 drafting 패널 이미지의 naturalHeight가 뷰포트×DPR보다 크다.
- 기존: screenshot 모드에서 페이지를 드래그하면 drafting 패널이 뜬다 (회귀 확인 — 크롭 가드 영향 없음).

### 수동 테스트 (Chrome)
- [ ] 세 방식 모두 캡처 결과에 dim·선택 사각형·크기 라벨이 **없다**.
- [ ] 뷰포트 캡처가 화면 전체를 담는다(상하좌우 잘림 없음).
- [ ] 스크롤 캡처: `position:fixed` 헤더가 **1번만** 나오고, 타일 경계에 중복/누락 줄이 없다.
- [ ] 스크롤 캡처 중 페이지 클릭이 막힌다(blocker 유지). 휠 스크롤은 가능하나 결과가 크게 깨지지 않는다(허용 리스크 확인).
- [ ] 스크롤 캡처 진행 중 [취소] → 즉시 중단 + 페이지(스크롤·고정 요소·blocker) 원복 + idle 복귀.
- [ ] 스크롤 캡처 중 **사이드패널 닫기** → content 자가 복원으로 페이지가 정상(고정 요소 표시·스크롤 위치).
- [ ] 스크롤 캡처 중 **탭 전환** → 중단되고 다른 탭 화면이 결과에 섞이지 않는다.
- [ ] 스크롤 캡처 정상 완료 후 원래 스크롤 위치·고정 요소 복구.
- [ ] sticky 레이아웃을 쓰는 실제 사이트(GitHub·Notion·뉴스 사이트)에서 본문이 사라지지 않는다 — 사라지면 "fixed만 숨김"으로 축소(PRD 성공 기준도 조정).
- [ ] `transition: visibility`가 걸린 고정 요소에서 타일에 잔상이 남는지 확인.
- [ ] 거대 DOM 사이트 1개에서 첫 타일 지연(고정 요소 수집 비용)이 수용 가능한지 확인.
- [ ] 무한 스크롤 페이지(예: 타임라인)에서 20타일에서 멈추고 `toast.info` 안내가 뜬다.
- [ ] 30s Replay를 켠 상태로 스크롤 캡처 → 쿼터 에러 없이 완료(phase 게이트 자동 정지 검증).
- [ ] 브라우저 줌 80% / 100% / 150% 각각에서 가장자리에 빈(투명) 픽셀이 없다.
- [ ] 드래그로 영역 캡처하는 기존 흐름이 그대로 동작한다.
- [ ] **영역 선택 모드에서** Esc로 취소 → idle 복귀(기존 동작 유지 — 스크롤 캡처 중 Esc는 무반응이 정상).
- [ ] 다크모드·좁은 패널에서 툴바 정렬·대비 확인.

## 구현 순서 권장

1. **Task 1 → 2** (크롭 가드, 독립)
2. **Task 3** (뷰포트 캡처 — 가장 짧은 경로) ∥ **Task 4** (타입+계획 순수 함수 — `PageMetrics`를 이 태스크가 정의하므로 Task 5 없이 독립)
3. **Task 5 → 6** (content executor → 사이드패널 오케스트레이터, Task 4의 타입에 의존)
4. **Task 7 → 8** (i18n → UI 툴바 + 로딩 + 취소)
5. **Task 9** (e2e, 마지막)

Task 1-2 ∥ Task 3 ∥ Task 4는 서로 독립. Task 8은 3·6이 끝나야 하고, Task 9는 마지막.

## 가이드 영향

- `guide/ko/screenshot/capture.md` · `guide/en/screenshot/capture.md` — 영역 드래그만 설명하는 캡처 절차에 캡처 방식 3축(영역/뷰포트/스크롤)과 하단 툴바를 추가. 스크롤 캡처의 제약(세로만, 고정 요소 첫 타일만, 20타일 상한, 진행 중 취소 가능)도 한 줄씩.
- `guide/ko/quick-start.md` · `guide/en/quick-start.md` — 스크린샷 단계 설명에 선택지가 3개임을 한 줄 반영할지 확인.

작성 전 `guide/AUTHORING.md`를 먼저 읽고 그 규칙(IA·톤·UI 라벨·footer·검증)대로 한다. 구현 후 `/guide`로 처리.
