# 녹화 중 어노테이션 (그리기) — 구현 태스크

## 선행 조건

- 새 권한·env·의존성 **없음**. 기존 shadow DOM 오버레이 + `chrome.tabs.sendMessage`만 사용.
- content_scripts 배열에서 **index 0 = picker.ts 고정** 규칙 숙지(신규 엔트리는 끝에 append).
- action-recorder는 MAIN world라 `@/` import 불가 → host id 리터럴 동기 복제 규칙(action-recorder.ts:21-22) 숙지.

## 태스크

### Task 1: 순수 함수 + 테스트 (`annotation-draw`)
- **변경 대상**: `src/content/annotation-draw.ts` (신규), `src/content/__tests__/annotation-draw.test.ts` (신규)
- **작업 내용**: `pointsToPath(points: Array<[number,number]>): string` — 좌표 배열을 SVG path `d`(예: `M x0 y0 L x1 y1 ...`)로 변환. 빈 배열·단일 포인트(점 하나) 처리 포함.
- **검증**:
  - [ ] `pnpm test` — 다중 포인트 → `M...L...` 문자열, 단일 포인트 → 유효한 최소 path, 빈 배열 → 빈 문자열(또는 정의된 sentinel).
  - [ ] `pnpm typecheck` 통과.

### Task 2: 어노테이션 콘텐츠 스크립트 (`annotation.ts`)
- **변경 대상**: `src/content/annotation.ts` (신규)
- **작업 내용**:
  - `window.__bugshotAnnotation__` 멱등 가드. `chrome.runtime.onMessage`로 `annotation.show`/`annotation.hide`/`annotation.setPen`/`annotation.ping` 처리(ping → 즉시 응답). **온-페이지 툴바 없음.**
  - show: shadow host(`id=ANNOTATION_HOST_ID`) 생성 → `attachShadow` → `<style>`(`:host{all:initial}`, blocker·svg·fading 클래스) + SVG 레이어(`position:fixed;inset:0;pointer-events:none`) + blocker div. 기본 펜 OFF(blocker `pointer-events:none` → pass-through).
  - `setPen`: on → blocker `pointer-events:auto; cursor:crosshair`; off → `none`. (버튼 UI는 사이드패널에 있으므로 페이지엔 상태 표시 불필요.)
  - 드래그: blocker `pointerdown` → activeStroke 시작(`<path>` append, stroke=`#ef4444`, width 3, fill none) → `window` capture `pointermove`로 포인트 누적 + `pointsToPath`로 d 갱신 → `pointerup`으로 확정 후 `window` 리스너 제거.
  - 획 페이드: 확정 시 `setTimeout(FADE_DELAY_MS=3000)` → `.fading`(opacity 0, `transition: opacity 400ms`) → `transitionend`에서 path remove. 타이머는 `fadeTimers`에 보관.
  - hide: `window` capture 리스너 제거, `fadeTimers` 전부 clear, host remove, 가드 플래그 리셋.
  - 상수: `ANNOTATION_HOST_ID`, `STROKE_COLOR`, `STROKE_WIDTH`, `FADE_DELAY_MS`, `FADE_DURATION_MS`.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] (수동) 로컬 로드 후 콘솔에서 show/setPen/hide 수동 발신 시 오버레이 마운트·드래그 그리기·제거 확인 — 또는 Task 6 이후 실 녹화로 확인.

### Task 3: 매니페스트 등록 + 사이드패널 제어 (`annotation-control.ts`)
- **변경 대상**: `manifest.config.ts`, `src/sidepanel/annotation-control.ts` (신규)
- **작업 내용**:
  - `manifest.config.ts` content_scripts **끝에** `annotation.ts` 엔트리 append: `matches:["<all_urls>"]`, `exclude_matches:["https://bugshot.gitbook.io/*"]`, `run_at:"document_idle"`, top frame(=all_frames 미지정), ISOLATED.
  - `annotation-control.ts`: `ensureAnnotationScript(tabId)`(`picker-control.ts:ensureContentScript` 패턴 — `annotation.ping` 실패 시 `chrome.scripting.executeScript({target:{tabId}, files:[<annotation 엔트리 js 경로>]})`), `showAnnotation(tabId)`/`hideAnnotation(tabId)`/`setAnnotationPen(tabId, on)`(`chrome.tabs.sendMessage`).
  - `AnnotationMessage` 타입을 `PickerMessage` 정의 컨벤션에 맞춰 추가.
- **검증**:
  - [ ] `pnpm typecheck` 통과.
  - [ ] `index 0 === picker.ts` 유지 확인(매니페스트 순서).

### Task 4: action-recorder 오염 방지
- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**: `ANNOTATION_HOST_ID = "__bugshot_annotation_host"` 리터럴 추가(HOST_ID 인접, 동기 복제 주석). `isOwnUi`의 path 루프·`el.closest` 검사에 annotation host id 포함(picker HOST_ID와 OR).
- **검증**:
  - [ ] 관련 헬퍼 단위 테스트가 있으면 annotation host 케이스 추가(`isOwnUi` 상당 로직). 없으면 수동 회귀로 대체.
  - [ ] (수동, 실 탭) 펜 ON 드래그 → 로그 탭 액션 로그에 drag/click이 안 잡히는지 확인.

### Task 5: 녹화 라이프사이클 배선 (마운트/해제)
- **변경 대상**: `src/sidepanel/video-capture.ts`, `src/sidepanel/video-recorder.ts`
- **작업 내용**:
  - `video-capture.ts` `startVideoCapture`·`startScreenCapture`: `startRecording(...)` 성공 직후 `await ensureAnnotationScript(tabId)` → `showAnnotation(tabId)`(실패는 warn no-op).
  - `video-recorder.ts` `onstop`(:47)·`cancelRecording`(:186): 종료·취소 시 `hideAnnotation(state.tabId)`.
- **검증**:
  - [ ] (수동, 실 탭) 탭 녹화 시작 → 오버레이 마운트(펜 OFF·pass-through), 정지 → 제거. 화면 녹화도 동일.
  - [ ] 60초 자동 종료·OS "공유 중지"·취소 각각에서 오버레이 제거 확인.

### Task 6: 사이드패널 펜 토글 버튼
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx` (녹화 컨트롤 UI), 필요 시 `src/i18n/`
- **작업 내용**:
  - 녹화 중 정지 버튼·경과시간이 렌더되는 지점(IssueTab.tsx:100/327-332)에 펜 토글 버튼 추가(shadcn 버튼 + lucide `Pen`류 아이콘). active 시각 표시.
  - 로컬 `useState` `penOn`(기본 false). 클릭 → `setPenOn(next)` + `setAnnotationPen(recordingTabId, next)`.
  - 녹화 phase를 벗어나면 버튼 언마운트(별도 리셋 불필요). aria-label/툴팁 추가 시 i18n ko/en 동시.
- **검증**:
  - [ ] `pnpm typecheck` 통과. i18n 추가 시 `locales.test.ts` 통과(훅 자동 실행).
  - [ ] (수동, 실 탭) 사이드패널 펜 ON → 페이지 커서 crosshair·드래그로 그려짐; OFF → 페이지 정상 클릭.

### Task 7: 내비게이션 재표시 + 펜 복원
- **변경 대상**: 기존 sentinel 재발행 경로(`src/background/tab-bindings.ts` / `src/sidepanel/picker-control.ts` `tabSentinels` / `usePickerMessages.ts` 중 해당부)
- **작업 내용**: 녹화 활성 탭의 main-frame `webNavigation.onCommitted` 재발행 시점에 `ensureAnnotationScript(tabId)`+`showAnnotation(tabId)` 재전송. IssueTab의 `penOn`이 true면 `setAnnotationPen(tabId, true)`도 재전송(새 오버레이는 기본 OFF). "녹화 활성" 판정은 `videoRecorder.isRecording()`+`state.tabId`.
- **검증**:
  - [ ] (수동, 실 탭) 펜 ON 상태로 녹화 중 페이지 이동 → 새 페이지에서 그리기 계속 가능(펜 ON 유지).

## 테스트 계획

- **단위 테스트**: `src/content/__tests__/annotation-draw.test.ts` — `pointsToPath` (다중/단일/빈 포인트). action-recorder `isOwnUi` 헬퍼 테스트가 존재하면 annotation host 제외 케이스 추가.
- **e2e 시나리오** (`/e2e-write` 입력):
  - "탭 녹화를 시작하면 사이드패널 녹화 컨트롤에 펜 토글 버튼이 나타난다." — 펜 버튼(`data-testid`) 존재로 판정.
  - "탭 녹화를 시작하면 페이지에 어노테이션 오버레이 host가 마운트된다." — shadow host 존재로 판정.
  - "사이드패널 펜을 켜고 페이지 위를 드래그하면 SVG path가 추가된다." — 드래그 후 shadow 내 `<path>` count 증가로 판정.
  - "녹화를 정지하면 펜 버튼과 오버레이 host가 사라진다." — 펜 버튼·shadow host 부재로 판정.
  - (페이드 3초·시각 정합은 e2e 판정 어려움 → 수동)
- **수동 테스트** (Chrome, 실 탭):
  - [ ] 그린 획이 ~3초 뒤 페이드아웃.
  - [ ] 저장된 녹화 영상 재생 시 그린 선이 보임(tabCapture·화면 녹화 각각).
  - [ ] 펜 OFF에서 페이지 버튼·링크 정상 클릭(pass-through).
  - [ ] 펜 드래그가 액션 로그에 안 잡힘.
  - [ ] 녹화 종료 후 DOM/리스너/타이머 잔존 없음.

## 구현 순서 권장

- Task 1(순수함수+테스트) → Task 2(콘텐츠 스크립트) → Task 3(매니페스트+제어) 순차.
- Task 4(action-recorder)·Task 5(마운트 배선)·Task 6(사이드패널 펜 버튼)은 Task 3 이후 병렬 가능. 단 Task 6의 실 동작 확인은 Task 5(오버레이 마운트)에 의존.
- Task 7(내비게이션 재표시)은 Task 5·6 완료 후. MVP에서 미룰 경우 "내비게이션 후 그리기 불능"을 알려진 제약으로 두고 후속 처리 가능(단 녹화가 페이지 이동을 자주 넘으므로 우선 권장).

## 가이드 영향

사용자 노출 기능이므로 갱신 필요:
- `guide/ko/video/record.md` · `guide/en/video/record.md` — 녹화 중 그리기(펜) 사용법 섹션 추가: 사이드패널 펜 토글 위치, 펜 켠 뒤 페이지 드래그로 그림, 획이 몇 초 뒤 사라짐, 화면 녹화 시 대상 탭 위에서만 그려짐 안내. 작성 규칙은 `guide/AUTHORING.md`. 구현 후 `/guide`로 처리.
