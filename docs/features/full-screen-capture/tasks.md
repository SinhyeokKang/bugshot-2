# 전체 화면 캡처 — 구현 태스크

## 선행 조건

- 새 권한·env·외부 API **없음**. manifest 변경 없음(`captureVisibleTab`은 이미 `<all_urls>`로 커버).
- 새 의존성 없음. lucide `Maximize` 아이콘은 기존 `lucide-react`에서 가져온다.
- 착수 전 `docs/POSTMORTEM.md`에서 `captureVisibleTab` 항목(2026-06-29) 확인 — 캡처 API 직접 호출 금지, background `capture-throttle` 경유 유지.

## 태스크

### Task 1: `clampCropRect` 순수 함수 (테스트 우선)
- **변경 대상**: `src/sidepanel/lib/crop-rect.ts` (신규), `src/sidepanel/lib/__tests__/crop-rect.test.ts` (신규)
- **작업 내용**: 크롭 rect를 캡처 이미지 경계 안으로 클램프하는 순수 함수. 테스트를 먼저 작성(red) 후 구현.
  ```ts
  export interface CropRect { x: number; y: number; width: number; height: number }
  export function clampCropRect(rect: CropRect, imgWidth: number, imgHeight: number): CropRect
  ```
  - x/y를 `[0, imgWidth/imgHeight]`로 클램프, width/height를 남은 영역으로 자르고 최소 1px 보장, 이미지 크기 0 이하면 rect 그대로 반환.
- **검증**:
  - [ ] 경계 내부 rect는 입력과 동일하게 반환(항등성 — 기존 드래그 크롭 무영향)
  - [ ] width가 이미지 우측을 넘으면 `imgWidth - x`로 잘림
  - [ ] x 음수면 0으로, 넘친 만큼 width 보정
  - [ ] rect가 이미지 완전 바깥이면 최소 1×1 반환(canvas 0 크기 방지)
  - [ ] `imgWidth <= 0`이면 rect 그대로
  - [ ] `pnpm test` 통과

### Task 2: 크롭 가드 적용
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts` (로컬 `cropImage`, L373-395)
- **작업 내용**: `loadImage` 직후 `clampCropRect(rect, img.naturalWidth, img.naturalHeight)` 결과로 canvas 크기·`drawImage` 인자를 대체. DPR 곱셈(L357)·webp 0.92 인코딩은 그대로.
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] 기존 드래그 영역 캡처가 동일하게 동작(Task 6 e2e에서 확인)

### Task 3: content script — 전체 뷰포트 선택 경로
- **변경 대상**: `src/types/picker.ts`, `src/content/area-select.ts`, `src/content/picker.ts`
- **작업 내용**:
  1. `PickerMessage`에 `| { type: "picker.selectFullViewport" }` 추가(`picker.cancelAreaSelect` 아래).
  2. `area-select.ts`에 `selectFullViewport(handle)` export — `cancelAreaSelect`와 동일한 정리 3단계(`removeListeners` → `cleanupElements` → `onBlockerRequest("hide")`) 후 `deps.onSelected({x:0,y:0,width:innerWidth,height:innerHeight}, {width:innerWidth,height:innerHeight})`. **정리가 `onSelected`보다 먼저**여야 오버레이가 캡처에 안 찍힌다.
  3. `picker.ts` switch(L253-258)에 `case "picker.selectFullViewport": handleSelectFullViewport(); break;` + 핸들러 추가. `areaHandle`이 null이면 no-op, 아니면 `selectFullViewport(areaHandle)` 호출만 한다(기존 `onSelected` 콜백이 `areaHandle=null`·`postToRuntime`·`mode="idle"`·`handleClear()`를 처리하므로 중복 작성 금지).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `handleSelectFullViewport`가 `postToRuntime`/`handleClear`를 직접 부르지 않는다(코드 리뷰)

### Task 4: 사이드패널 송신 함수
- **변경 대상**: `src/sidepanel/picker-control.ts`
- **작업 내용**: `cancelAreaCapture`(L622) 옆에 `captureFullViewport(tabId)` export — `send(tabId, { type: "picker.selectFullViewport" }, 0)`. store 직접 조작 없음(phase 전이는 `picker.areaSelected` 수신부 담당).
- **검증**:
  - [ ] `pnpm typecheck` 통과
  - [ ] `frameId: 0`으로만 전송(broadcast 아님)

### Task 5: i18n + UI 버튼
- **변경 대상**: `src/i18n/namespaces/issue.ts`, `src/sidepanel/tabs/IssueTab.tsx`
- **작업 내용**:
  1. `issue.capturing.fullScreen` — ko `"전체 화면 캡처"` / en `"Capture screen"` (ko/en 동시).
  2. `CapturingState`에 `onFullScreen` prop 추가. `EmptyShell`의 `action`에 `<div className="flex gap-2">`로 버튼 2개: **[취소]** `variant="outline"` + `data-testid="capturing-cancel"`, **[전체 화면 캡처]** `variant="default"` + lucide `Maximize` + `data-testid="capture-full-screen"`.
  3. 라우팅(L94-101)에서 `onFullScreen={() => void captureFullViewport(tabId)}` 연결.
- **검증**:
  - [ ] i18n PostToolUse 훅(`locales.test.ts`) 통과 — ko/en 키 대칭
  - [ ] `pnpm typecheck` 통과
  - [ ] 다크모드·좁은 패널 폭에서 버튼 2개가 줄바꿈 없이 정렬(수동)

### Task 6: e2e 시나리오 추가
- **변경 대상**: `e2e/capture.spec.ts`
- **작업 내용**: "screenshot 전체 화면 캡처 → drafting 진입" 테스트 추가. 기존 `captureUntilDrafting` 헬퍼를 재사용해 captureVisibleTab rate-limit flake를 흡수한다(trigger: `mode-screenshot` 클릭 → `capture-full-screen` 클릭).
- **검증**:
  - [ ] `pnpm build:e2e && pnpm test:e2e` green
  - [ ] 기존 "screenshot 영역 캡처 → drafting 진입" 테스트도 계속 통과

## 테스트 계획

### 단위 테스트
- `src/sidepanel/lib/__tests__/crop-rect.test.ts` — `clampCropRect`: 경계 내부 항등성 / 우·하단 초과 클램프 / 음수 x·y 보정 / 완전 바깥 → 1×1 / 이미지 크기 0 방어.

### e2e 시나리오 (`/e2e-write` 입력)
- screenshot 모드로 진입한 뒤 사이드패널의 [전체 화면 캡처]를 클릭하면 드래그 없이 drafting 패널이 뜬다.
- 기존: screenshot 모드에서 페이지를 드래그하면 drafting 패널이 뜬다 (회귀 확인 — 크롭 가드 영향 없음).

### 수동 테스트 (Chrome)
- [ ] 캡처 결과에 dim·선택 사각형·크기 라벨·크로스헤어가 **없다**.
- [ ] 캡처 이미지가 뷰포트 전체를 담는다(상하좌우 잘림 없음).
- [ ] 브라우저 줌 80% / 100% / 150% 각각에서 가장자리에 빈(투명) 픽셀이 없다.
- [ ] 스크롤바가 있는 페이지에서 캡처 우측 스크롤바 포함 여부 확인(드래그 전체 선택과 동일하면 허용).
- [ ] 드래그로 영역 캡처하는 기존 흐름이 그대로 동작한다.
- [ ] capturing 중 Esc로 취소 → idle 복귀(기존 동작 유지).
- [ ] 다크모드에서 버튼 2개 정렬·대비 확인.

## 구현 순서 권장

1. **Task 1 → Task 2** (크롭 가드, 독립)
2. **Task 3 → Task 4 → Task 5** (전체 화면 캡처 경로, content → 사이드패널 → UI 순서로 타입이 흐름)
3. **Task 6** (e2e, Task 5까지 끝난 뒤)

Task 1-2와 Task 3-5는 서로 독립이라 **병렬 가능**하다. Task 6은 마지막.

## 가이드 영향

- `guide/ko/screenshot/capture.md` · `guide/en/screenshot/capture.md` — 영역 드래그만 설명하는 캡처 절차에 "전체 화면 캡처" 버튼 경로를 추가.
- `guide/ko/quick-start.md` · `guide/en/quick-start.md` — 스크린샷 단계 설명에 영역 드래그 외 선택지가 있음을 한 줄 반영할지 확인.

작성 전 `guide/AUTHORING.md`를 먼저 읽고 그 규칙(IA·톤·UI 라벨·footer·검증)대로 한다. 구현 후 `/guide`로 처리.
