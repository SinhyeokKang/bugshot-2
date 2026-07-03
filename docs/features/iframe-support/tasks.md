# iframe 내부 요소 편집·캡처 — 구현 태스크

## 선행 조건

- 권한: 추가 없음. `<all_urls>` host_permissions + `scripting`이 all_frames 주입을 이미 커버. manifest permissions diff는 `all_frames: true` 한 줄뿐(호스트/권한 변경 없음).
- privacy.md 대조: **iframe 내부 DOM 접근·캡처는 새 수집 동작**. manifest 권한 diff가 실질 0이어도(30s Replay 심사 탈락 선례) `docs/privacy.md`를 대조·갱신(cross-origin iframe 내부 스타일·스크린샷 접근 명시, 시행일 포함).
- PERMISSION.md 대조: content script all_frames 주입 범위 변화 반영.
- 실제 cross-origin iframe 테스트 페이지 필요(e2e fixture). 기존 e2e fixture 구조 확인.

## 태스크

### Task 1: store 타입에 frameId 추가 (테스트 우선)
- **변경 대상**: `src/store/editor-store.ts`, `src/store/__tests__/*.test.ts`
- **작업 내용**: `EditorSelection`·`BufferedElement`·`ShotSelector`에 `frameId: number` 추가. `onElementSelected` 입력·`bufferCurrentElement`·`onElementShot`에 frameId 전파. 영속 복원 경로에 `frameId ?? 0` 폴백.
- **검증**:
  - [ ] `onElementSelected({..., frameId: 3 })` 후 `selection.frameId === 3`
  - [ ] `bufferCurrentElement` 시 buffered 항목이 selection.frameId 복사
  - [ ] 구버전 스냅샷(frameId 없음) 복원 시 `frameId === 0`
  - [ ] `pnpm typecheck` 통과 (frameId 누락 호출부 전수 표면화)

### Task 2: picker-control send/export에 frameId 라우팅
- **변경 대상**: `src/sidepanel/picker-control.ts`
- **작업 내용**: `send<R>(tabId, msg, frameId?)` 시그니처 추가 → 옵션 전달. frameId 라우팅 대상 export 함수(`applyStyles`·`applyClasses`·`applyText`·`resetAllEdits`·`collectTokens`·`previewHover`·`previewClear`·`selectByPath`·`applyEditsBySelector`·`prepareCapture`·`prepareCaptureBySelector`·`navigatePicker`·`describeChildren`)에 frameId 인자 추가. `ensureContentScript`를 `target: { tabId, allFrames: true }`로.
- **검증**:
  - [ ] `applyStyles(tabId, 5, {...})`가 `sendMessage(tabId, msg, { frameId: 5 })` 호출 (mock 단위 테스트)
  - [ ] `ensureContentScript`가 allFrames로 executeScript 호출
  - [ ] frameId 미전달 호출부가 타입 에러로 전부 잡힘

### Task 3: manifest all_frames + picker 주입 멱등 가드
- **변경 대상**: `manifest.config.ts`, `src/content/picker.ts`
- **작업 내용**: content_scripts[0]에 `all_frames: true`. picker.ts 최상단에 멱등 플래그(`__bugshotPicker__` 류, 레코더 `BRIDGE_FLAG` 선례) 추가해 정적+programmatic 이중 주입 시 리스너 중복 방지. `removeOrphanOverlay` 재확인.
- **검증**:
  - [ ] top frame에 picker 2회 주입해도 overlay 1개, onMessage 리스너 1개
  - [ ] iframe 프레임에도 picker 주입 확인(수동: iframe에서 `chrome.runtime` 응답)

### Task 4: blocker 핸드오프 (hover가 iframe 경계 넘기)
- **변경 대상**: `src/content/picker.ts`
- **작업 내용**: `onMouseMove`에서 `elementAtPoint`가 IFRAME이면 `blockerEl.style.pointerEvents = "none"`, 아니면 `"auto"`. IFRAME hover 시 outline은 iframe 박스에 그대로(시각 피드백). `onClickCommit`의 IFRAME 거부는 핸드오프 실패/중첩 폴백으로만 남김.
- **검증** (대부분 수동 — 실제 iframe 필요):
  - [ ] iframe 위로 마우스 이동 시 iframe **내부** 요소가 하이라이트
  - [ ] iframe 밖으로 나오면 top 요소 하이라이트로 복귀
  - [ ] iframe 인접 링크 클릭 시 원치 않는 네비게이션 없음

### Task 5: frame-geometry 좌표 변환 (테스트 우선 — 순수 계산부)
- **변경 대상**: 신규 `src/content/frame-geometry.ts` + `__tests__/frame-geometry.test.ts`
- **작업 내용**: `requestFrameOffset()`(자식→부모 postMessage, token 매칭, 타임아웃 폴백 null)·`installFrameOffsetResponder()`(부모: `contentWindow===event.source` 매칭 후 iframe rect+border offset+top viewport 응답, top 아니면 미지원). 순수 계산 헬퍼 `composeTopRect(innerRect, offset)` 분리해 단위 테스트.
- **검증**:
  - [ ] `composeTopRect({x:10,y:20,w:100,h:50}, {x:200,y:300})` → `{x:210,y:320,w:100,h:50}`
  - [ ] token 불일치 응답 무시
  - [ ] 타임아웃 시 null

### Task 6: picker.ts 캡처 좌표 변환 배선
- **변경 대상**: `src/content/picker.ts`
- **작업 내용**: `handlePrepareCapture`/`handlePrepareCaptureBySelector`가 `window !== window.top`이면 `requestFrameOffset()`로 offset·top viewport 획득해 rect 변환 + viewport를 top 크기로 세팅(async → sendResponse, return true). top frame은 기존 경로. `installFrameOffsetResponder()`를 picker 초기화 시 1회 호출.
- **검증**:
  - [ ] top frame 요소 캡처 rect·viewport 기존과 동일(회귀 없음)
  - [ ] iframe 요소 캡처 rect가 top 좌표로 변환됨(수동: 크롭 위치 정확도)

### Task 7: usePickerMessages frameId 수신·라우팅
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`
- **작업 내용**: `picker.selected`/`selectionUpdated`/`cancelled`에서 `sender.frameId` 사용. `onElementSelected({..., frameId})`. 후속 `collectTokens`·`captureElementSnapshot`·`captureElementShot`에 frameId 전달. 버퍼 매칭을 `selector+frameId` 복합으로. `captureAndCrop`/inline은 스코프 밖(area 모드, 비목표).
- **검증**:
  - [ ] iframe(frameId≠0) 선택 시 store selection.frameId 반영
  - [ ] 후속 token/before-image 캡처가 해당 frameId로 라우팅
  - [ ] 동일 selector가 top·iframe 양쪽에 있어도 올바른 프레임 매칭

### Task 8: capture.ts frameId 배선
- **변경 대상**: `src/sidepanel/capture.ts`
- **작업 내용**: `captureElementSnapshot(tabId, { frameId, margin })`·`captureElementSnapshotBySelector(tabId, selector, { frameId })` → `prepareCapture(tabId, frameId)` 라우팅. `cropImage`는 그대로(rect·viewport가 top 좌표).
- **검증**:
  - [ ] frameId 옵션이 prepareCapture로 전달 (단위)
  - [ ] top-frame 캡처(frameId 0 또는 미지정) 기존 동작 유지

### Task 9: rebind/resume 경로 frameId 라우팅
- **변경 대상**: `src/sidepanel/picker-control.ts` (`rebindStylingSession`·`resumeBufferedElement`)
- **작업 내용**: `selectByPath(tabId, selector)`·`applyEditsBySelector(...)`를 selection·buffered의 frameId로 라우팅. 버퍼 순회 시 각 항목의 frameId 사용.
- **검증**:
  - [ ] 패널 재오픈 후 iframe 요소 편집이 올바른 프레임에 재적용
  - [ ] repick 취소 시 iframe 버퍼 요소로 복귀

### Task 10: iframeUnsupported 문구 조정 (중첩/sandbox 한정)
- **변경 대상**: `src/i18n/namespaces/app.ts` (ko/en 동시)
- **작업 내용**: `app.iframeUnsupported.*`를 "중첩 프레임/보안 정책으로 선택 불가" 취지로. 1-depth 지원됨을 반영해 광범위 문구 제거.
- **검증**:
  - [ ] i18n locales 테스트(PostToolUse 훅) 통과 — ko/en 키 대칭
  - [ ] 중첩 iframe 내부 클릭 시 새 문구 다이얼로그

## 테스트 계획

### 단위 테스트 (Vitest)
- `frame-geometry.test.ts`: `composeTopRect` 좌표 합성, token 매칭 무시, 타임아웃 null.
- `editor-store` 테스트: frameId 저장·버퍼 복사·`?? 0` 마이그레이션 폴백.
- `picker-control` 테스트(mock chrome): `send`가 frameId를 `{ frameId }` 옵션으로 전달, `ensureContentScript` allFrames.

### e2e 시나리오 (`/e2e-write` 입력)
- same-origin iframe fixture 페이지에서: picker 시작 → iframe 내부 요소 hover 시 내부 요소 하이라이트 data-testid 노출 → 클릭하면 사이드패널 스타일 에디터에 해당 태그가 로드된다.
- iframe 내부 요소에 color 편집하면 iframe 내부 요소 style 속성에 반영된다(프레임 내 DOM 검증).
- iframe 내부 요소 선택 후 top 요소 재선택 → 두 편집이 버퍼에 각각 유지된다.
- 중첩 iframe 내부 클릭 시 iframe-unsupported 다이얼로그가 뜬다.
- **data-testid 추가만 허용**(src 수정 규칙).

### 수동 테스트 (Chrome — captureVisibleTab·실제 iframe 의존)
- [ ] cross-origin iframe(예: 외부 임베드) 내부 요소 hover·선택·스타일 편집 프리뷰
- [ ] iframe 내부 요소 캡처 이미지 크롭 위치가 실제 요소와 일치(±margin)
- [ ] blocker 핸드오프: iframe in/out 반복 + 인접 링크 클릭에 오네비게이션 없음
- [ ] sandbox iframe 클릭 → 거부 다이얼로그, 콘솔 에러 누적 없음
- [ ] top-frame 요소 편집·캡처·다중편집·area/freeform 회귀 없음
- [ ] 스크롤된 iframe·페이지에서 캡처 좌표 정확도

## 구현 순서 권장

1. **Task 1 → 2**(타입·라우팅 골격, typecheck로 호출부 전수 표면화) — 선행.
2. **Task 3 → 4**(주입·핸드오프, iframe 선택 가능해짐) — 핸드오프는 실기기 검증.
3. **Task 5 → 6 → 8**(좌표 변환·캡처 배선) — Task 5 순수부는 병렬 가능.
4. **Task 7 → 9**(수신·rebind 라우팅) — Task 2 이후.
5. **Task 10**(문구) — 독립, 아무 때나.

병렬 가능: Task 5(순수 계산)는 1-4와 독립. Task 10은 전 구간 독립.

## 가이드 영향

사용자 노출 UX(iframe 내부 요소 선택·편집·캡처가 새로 가능) → `/guide`로 ko·en 갱신 필요. `guide/AUTHORING.md` 규칙 선로드.
- `element/` 관련 페이지(요소 선택·스타일 편집 설명, ko·en) — "iframe 내부 요소도 선택·편집 가능(중첩 프레임 제외)" 추가.
- 기존 "iframe 미지원" 안내가 가이드에 있으면 1-depth 지원으로 수정.
- 정확한 페이지 slug는 `/guide` 세션에서 guide/ 구조 확인 후 확정.
