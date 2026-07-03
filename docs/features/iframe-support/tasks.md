# iframe 내부 요소 편집·캡처 — 구현 태스크

## 선행 조건

- 권한: 추가 없음. `<all_urls>` + `scripting`이 all_frames 주입 커버. manifest diff는 `all_frames: true` 한 줄.
- **privacy.md 대조·갱신**(검증 체크로 승격 — 30s Replay 심사 탈락 선례): iframe 내부 DOM 접근·캡처는 새 수집 동작. manifest 권한 diff가 0이어도 cross-origin iframe 내부 스타일·스크린샷 접근을 명시(시행일 포함).
- **PERMISSION.md 대조·갱신**: content script all_frames 주입 범위(picker) 반영.
- cross-origin e2e fixture: 현 e2e 서버는 단일 origin뿐. cross-origin 시나리오용 **2번째 origin 서버(다른 포트)** 추가 필요(Task 12).

## 태스크

### Task 1: store 타입에 frameId·origin 추가 + 버퍼 술어 복합키 (테스트 우선)
- **변경 대상**: `src/store/editor-store.ts`, `src/store/__tests__/*.test.ts`
- **작업 내용**:
  - `EditorSelection`·`BufferedElement`·`ShotSelector`에 `frameId: number`·`origin: string`(ShotSelector는 frameId만) 추가. optional 선언 + 소비 시점 `frameId ?? 0` / `origin ?? ""` 폴백.
  - `onElementSelected` 입력·`bufferCurrentElement`·`onElementShot`에 frameId·origin 전파.
  - **버퍼 술어 복합키화**: `patchBufferedElement(selector, frameId, ...)`·`removeBufferedElement(selector, frameId)` 시그니처 변경. `bufferCurrentElement` dedup findIndex, `onElementSelected` buffered.find·승격 filter를 `selector && frameId`로.
  - **`updateSelectionStyles` stale 가드**를 `selector && frameId` 비교로.
  - 구버전·구 draft 복원 매핑(`resolveDraftStyleElements.ts`/`useDraftStyleElements.ts` 포함)에 `frameId ?? 0`·`origin ?? ""`.
- **검증**:
  - [x] `onElementSelected({..., frameId:3, origin:"https://x"})` → `selection.frameId===3`, `origin` 반영
  - [x] `bufferCurrentElement` 시 buffered가 frameId·origin 복사
  - [x] top·iframe 동일 selector 2개 버퍼 시 `patchBufferedElement(sel, 0)`가 iframe 항목(frameId≠0) 안 건드림
  - [x] 구버전 스냅샷(frameId 없음) 복원 → `frameId===0`
  - [x] `updateSelectionStyles`가 다른 frameId의 동일 selector 보강을 무시
  - [x] `pnpm typecheck` 통과

### Task 2: picker-control send/export frameId 라우팅 (required)
- **변경 대상**: `src/sidepanel/picker-control.ts`
- **작업 내용**: `send<R>(tabId, msg, frameId)` — **frameId required**. 라우팅 대상 export 함수 전부에 frameId 추가: `applyStyles`·`applyClasses`·`applyText`·`resetAllEdits`·`collectTokens`·`previewHover`·`previewClear`·`selectByPath`·`applyEditsBySelector`·`prepareCapture`·`prepareCaptureBySelector`·`navigatePicker`·`describeChildren`·`describeInitialTree`. 호출부의 `frameId ?? 0` 정규화는 소비 지점에서(undefined → broadcast 함정 방지). `ensureContentScript`를 `target:{tabId, allFrames:true}`로.
- **검증**:
  - [ ] `applyStyles(tabId, 5, {...})` → `sendMessage(tabId, msg, {frameId:5})` (mock)
  - [x] `ensureContentScript`가 allFrames로 executeScript
  - [x] frameId 미전달 호출부가 전부 타입 에러(required)
  - [x] `previewClear`·`describeInitialTree` 포함 확인

### Task 3: manifest all_frames + picker 주입 멱등 가드 (리스너 포함)
- **변경 대상**: `manifest.config.ts`, `src/content/picker.ts`
- **작업 내용**: content_scripts[0]에 `all_frames: true`. picker.ts 최상단에 멱등 플래그(`__bugshotPicker__`)로 **`onMessage`·`onConnect` 리스너 등록을 포함한 init 전체**를 감싼다(`BRIDGE_FLAG` 선례). `removeOrphanOverlay`만으론 리스너 중복 미방지.
- **검증**:
  - [ ] top frame에 picker 2회 주입 → onMessage/onConnect 리스너 각 1개, overlay 1개
  - [ ] 이중 주입 후 메시지 1회 전송에 sendResponse 1회만
  - [ ] iframe 프레임에도 picker 주입(수동: iframe `chrome.runtime` 응답)

### Task 4: frame-geometry — registry + 좌표 변환 (테스트 우선, 순수부)
- **변경 대상**: 신규 `src/content/frame-geometry.ts` + `__tests__/frame-geometry.test.ts`
- **작업 내용**:
  - `composeTopRect(inner, offset)` 순수 함수(단위 테스트).
  - `announceFrameToParent()`(자식→부모 `__bugshot_frame_present__`), `installFrameOffsetResponder()`(부모: `contentWindow===event.source` 매칭 → child registry 등록 + `__bugshot_frameOffset_req__`에 iframe rect+border offset+topViewport 응답, top 아니면 미지원).
  - `requestFrameOffset(timeoutMs?)`(자식: token 매칭, 타임아웃 null). **자식 측 방어**: `event.source===window.parent`+예상 origin 확인.
- **검증**:
  - [x] `composeTopRect({x:10,y:20,w:100,h:50},{x:200,y:300})` → `{x:210,y:320,w:100,h:50}`
  - [x] token 불일치·`event.source≠window.parent` 응답 무시(스푸핑 방어)
  - [x] 타임아웃 시 null

### Task 5: blocker 핸드오프 게이팅 (registry 기반)
- **변경 대상**: `src/content/picker.ts`
- **작업 내용**: iframe이면 `handleStart` 시 `announceFrameToParent()`. `onMouseMove`에서 `elementAtPoint`가 IFRAME이고 **child registry에 등록됨**이면 `blockerEl.pointerEvents="none"`(핸드오프), 미등록이면 `"auto"` 유지. 토글은 `elementAtPoint` 호출 **이후** + `target===lastHover` 가드 안(깜빡임 완화). `onClickCommit` IFRAME 거부(637-645)는 미등록 iframe 폴백으로 유지.
- **검증** (대부분 수동 — 실제 iframe):
  - [x] 등록 iframe hover → iframe **내부** 요소 하이라이트
  - [ ] iframe 밖 복귀 → top 요소 하이라이트
  - [ ] **sandbox/중첩 iframe 클릭 → iframe-unsupported 다이얼로그**(blocker 유지 확인 — 클릭이 iframe으로 통과하지 않음)
  - [ ] iframe 인접 링크 클릭 시 오네비게이션 없음

### Task 6: 캡처 좌표 변환 + top overlay 숨김
- **변경 대상**: `src/content/picker.ts`, `src/sidepanel/capture.ts`
- **작업 내용**: `handlePrepareCapture`/`handlePrepareCaptureBySelector`가 `window!==window.top`이면 `requestFrameOffset()`로 offset·topViewport 획득 → rect 변환 + viewport=top(async, return true). **iframe 캡처 시 top 프레임 overlay도 숨김**(`picker.hideOverlayForCapture` broadcast 또는 offset 요청 편승) → endCapture에서 top·iframe 양쪽 복원. `installFrameOffsetResponder()` 초기화 1회. `captureElementSnapshot(tabId, {frameId, margin})`·`...BySelector` 라우팅.
- **검증**:
  - [ ] top frame 요소 캡처 rect·viewport 기존과 동일(회귀 없음)
  - [ ] iframe 요소 캡처 rect가 top 좌표로 변환(수동: 크롭 정확도)
  - [ ] **iframe 캡처 이미지에 top overlay/blocker가 안 찍힘**(수동)

### Task 7: usePickerMessages frameId·origin 수신·라우팅 + cancel teardown
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`
- **작업 내용**: `picker.selected`/`selectionUpdated`/`cancelled`에서 `sender.frameId` 사용. `onElementSelected({..., frameId, origin: payload.origin})`. 후속 `collectTokens`·`captureElementSnapshot`·**`captureElementShot`(→`captureElementSnapshot`에 `shotSelector.frameId` 전달)** 라우팅. `wasBuffered` 매칭 `selector&&frameId`. **`picker.cancelled` 수신 시 `clearPicker(tabId)` broadcast**(전 프레임 teardown).
- **검증**:
  - [x] iframe(frameId≠0) 선택 시 selection.frameId·origin 반영
  - [ ] iframe 요소 **screenshot 모드** 크롭이 frameId로 라우팅(오크롭 없음)
  - [x] iframe에서 ESC → top 프레임 picker도 정리(유령 없음)
  - [x] 동일 selector top·iframe 양쪽 존재 시 올바른 프레임 매칭

### Task 8: picker.selected payload에 origin
- **변경 대상**: `src/content/picker.ts`(`emitSelected`/`collectSelection`), `src/types/picker.ts`
- **작업 내용**: `PickerSelectionPayload`에 `origin: string` 추가, `emitSelected`가 `location.origin` 실음. frameId는 페이로드 아님(sender.frameId).
- **검증**:
  - [x] iframe 선택 payload.origin === iframe origin
  - [x] top 선택 payload.origin === 페이지 origin

### Task 9: 다중 편집 리뷰 출처 배지 + 다이얼로그 복합키
- **변경 대상**: `src/sidepanel/tabs/styleEditor/styleChangeGroups.ts`, `StyleChangesDialog.tsx`
- **작업 내용**: `buildChangeGroups` 그룹화를 `selector+frameId`로, group에 frameId·origin. `StyleChangesDialog`의 `removeBufferedElement`·`patchBufferedElement`·`applyEditsBySelector` 호출을 `(selector, frameId)`로. GroupCard 헤더에 **origin 배지**(shadcn `Badge`, `OriginFilterBar` 팔레트) — iframe(origin≠페이지 origin)만 표시.
- **검증**:
  - [x] top·iframe 혼합 다중편집 시 각 카드에 올바른 출처(iframe만 배지)
  - [x] 행 초기화·패치가 올바른 프레임 항목에만 적용
  - [x] 기존 `style-changes-dialog.spec.ts`·`style-changes-stacked.spec.ts` 회귀 없음

### Task 10: rebind/resume 경로 frameId 라우팅
- **변경 대상**: `src/sidepanel/picker-control.ts`(`rebindStylingSession`·`resumeBufferedElement`)
- **작업 내용**: `selectByPath`·`applyEditsBySelector`를 selection·buffered의 frameId(폴백 `?? 0`)로 라우팅. 버퍼 순회 시 각 항목 frameId.
- **검증**:
  - [ ] 패널 재오픈 후 iframe 요소 편집이 올바른 프레임 재적용
  - [ ] repick 취소 시 iframe 버퍼 요소 복귀
  - [x] 기존 `draft-resume`·`buffered-reselect-edit` spec 회귀 없음

### Task 11: iframeUnsupported 문구 조정 (중첩/sandbox 한정, ko/en)
- **변경 대상**: `src/i18n/namespaces/app.ts`
- **작업 내용**: `app.iframeUnsupported.*`를 design.md 문구 초안대로(중첩/보안 정책 안내 + 다음 행동). ko/en 동시.
- **검증**:
  - [x] i18n locales 테스트(PostToolUse 훅) 통과 — ko/en 대칭
  - [x] 중첩 iframe 클릭 시 새 문구 다이얼로그

### Task 12: e2e fixture — 중첩/sandbox + cross-origin origin 서버
- **변경 대상**: `e2e/` fixture·helper(`extension.ts` 등)
- **작업 내용**: (1) 중첩 iframe fixture(`iframe-nested.html`, 2-depth) + sandbox iframe fixture. (2) **2번째 origin 서버(다른 포트)** 추가해 cross-origin iframe fixture. (3) **기존 `picker-guard.spec.ts` 갱신** — "1-depth iframe 박스 클릭 → 내부 선택"으로 역전, unsupported 단언은 중첩/sandbox로 이동.
- **검증**:
  - [x] `picker-guard.spec.ts`가 새 동작(1-depth 선택 / 중첩·sandbox 거부)으로 green
  - [x] cross-origin fixture 서버 기동·접근 확인

## 테스트 계획

### 단위 테스트 (Vitest)
- `frame-geometry.test.ts`: `composeTopRect`, token/`event.source` 매칭 무시, 타임아웃 null.
- `editor-store` 테스트: frameId·origin 저장·버퍼 복합키(patch/remove/dedup)·`updateSelectionStyles` frameId 가드·`?? 0` 마이그레이션.
- `picker-control` 테스트(mock chrome): `send` frameId `{frameId}` 전달(required), `ensureContentScript` allFrames.

### e2e 시나리오 (`/e2e-write` 입력)
- **same-origin**: picker 시작 → iframe 내부 요소 hover 시 내부 요소 하이라이트(data-testid) → 클릭하면 사이드패널 스타일 에디터에 해당 태그 로드.
- iframe 내부 요소 color 편집 → iframe 내부 요소 style 속성 반영(`fixture.frame().evaluate()`로 프레임 내 DOM 검증 — `logs-iframe.spec.ts` 선례).
- iframe 내부 요소 선택 후 top 요소 재선택 → 두 편집이 버퍼에 각각 유지, 리뷰 카드에 iframe 항목만 출처 배지.
- iframe에서 ESC → picker 전체 idle(top 유령 없음).
- **cross-origin**(Task 12 서버): cross-origin iframe 내부 요소 선택·color 편집이 해당 프레임 DOM에 반영.
- **중첩(2-depth) iframe 내부 클릭 → iframe-unsupported 다이얼로그**. **sandbox iframe 클릭 → 동일 다이얼로그**(클릭이 iframe으로 통과하지 않음).
- data-testid 추가만 허용(src 수정 규칙).

### 수동 테스트 (Chrome — captureVisibleTab·실기기 iframe 의존)
- [ ] iframe 내부 요소 캡처 크롭 위치가 실제 요소와 일치(±기존 margin), **top overlay 미포함**
- [ ] iframe **요소 스크린샷 모드** 크롭 정확도
- [ ] blocker 핸드오프: iframe in/out 반복 + 인접 링크 클릭 오네비게이션 없음, 경계 깜빡임 허용 범위
- [ ] 스크롤된 iframe·페이지 캡처 좌표 정확도
- [ ] top-frame 요소 편집·캡처·다중편집·area/freeform·30s replay 회귀 없음
- [ ] 다수 iframe(광고 등) 페이지에서 picking 진입 시 성능·메모리 체감

## 구현 순서 권장

1. **Task 1 → 2**(타입·라우팅 골격, typecheck 전수 표면화) — required frameId 전제.
2. **Task 3 → 4 → 5**(주입·registry·핸드오프, iframe 선택 가능) — 5는 실기기 검증. Task 4 순수부(composeTopRect)는 1-3과 병렬 가능.
3. **Task 6 → 8**(좌표 변환·top overlay·payload origin) — Task 4 이후.
4. **Task 7 → 9 → 10**(수신·배지·rebind) — Task 1·2 이후. 9는 8 이후(origin 필요).
5. **Task 11**(문구) — 독립.
6. **Task 12**(e2e fixture·spec) — 구현 태스크 이후, `/e2e-write` 전 선행. `picker-guard.spec` 갱신은 Task 5 완료가 전제.

병렬: Task 4 순수부·Task 11은 초반 독립. Task 12 fixture 서버 셋업은 코드와 병렬 준비 가능.

## 가이드 영향

사용자 노출 UX(iframe 내부 요소 선택·편집·캡처 신규) → `/guide` ko·en 갱신. `guide/AUTHORING.md` 선로드.
- `element/` 관련 페이지(요소 선택·스타일 편집): "iframe 내부 요소도 선택·편집 가능(중첩·sandbox 제외)" + 출처 배지 언급.
- 기존 "iframe 미지원" 안내가 가이드에 있으면 1-depth 지원으로 수정.
- 정확한 slug는 `/guide` 세션에서 guide/ 구조 확인 후 확정.
