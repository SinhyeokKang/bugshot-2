# 녹화 중 어노테이션 (그리기) — 구현 태스크

## 선행 조건

- 새 권한·env·의존성·manifest 변경 **없음**. annotation은 picker 엔트리 내부 모듈이라 content_scripts 배열 무변경(index 0 = picker.ts 규칙에 영향 없음).
- action-recorder는 MAIN world라 `@/` import 불가 → host id 리터럴 동기 복제 규칙(action-recorder.ts:21-22) 숙지. 단 `action-recorder-helpers.ts`는 같은 청크로 번들되는 내부 모듈이라 import 가능(기존에 이미 import 중).
- 스토어 변경은 editor-store `annotationPenOn` 필드 1개뿐(비영속 — 세션 저장 대상 아님인지 editor-store 영속화 범위 확인).

## 태스크

### Task 1: 순수 함수 + 테스트 (`annotation-draw`, `matchesOwnHost`)
- **변경 대상**: `src/content/annotation-draw.ts` (신규), `src/content/__tests__/annotation-draw.test.ts` (신규), `src/content/action-recorder-helpers.ts`, `src/content/__tests__/action-recorder-helpers.test.ts`
- **작업 내용**:
  - `pointsToPath(points: Array<[number,number]>): string` — 좌표 배열 → SVG path `d`. 빈 배열·단일 포인트(점 하나) 처리 포함.
  - `matchesOwnHost(elementIds: readonly string[], hostIds: readonly string[]): boolean` — action-recorder `isOwnUi`의 id 매칭 로직을 순수 함수로 추출해 helpers에 추가 (Vitest node 환경에서 DOM 없이 테스트 가능한 형태).
- **검증**:
  - [x] `pnpm test` — pointsToPath: 다중 포인트 → `M...L...`, 단일 포인트 → 유효 최소 path, 빈 배열 → 빈 문자열, **대량 포인트(수천 개)** 케이스.
  - [x] `pnpm test` — matchesOwnHost: picker host만/annotation host만/둘 다/무매칭 케이스.
  - [x] `pnpm typecheck` 통과.

### Task 2: 어노테이션 모듈 (`annotation.ts`)
- **변경 대상**: `src/content/annotation.ts` (신규), `src/content/picker.ts` (메시지 분기 위임), `src/types/picker.ts` (union 멤버 추가)
- **작업 내용**:
  - `PickerMessage` union(src/types/picker.ts:68)에 `annotation.show`/`annotation.hide`/`annotation.setPen {on}`/`annotation.penOff`(업스트림) 추가. picker.ts 메시지 핸들러에서 `annotation.*`를 annotation.ts로 위임.
  - show: shadow host(`id=ANNOTATION_HOST_ID`) 생성 → **`attachShadow({mode:"open"})`**(e2e path 판정 의존) → `<style>`(`:host{all:initial}`, blocker·svg·fading) + SVG 레이어(`position:fixed;inset:0;pointer-events:none`, viewBox 미지정 — CSS px 좌표) + blocker div. 기본 펜 OFF(pass-through). 중복 show는 no-op(호스트 존재 검사).
  - `setPen`: on → blocker `pointer-events:auto; cursor:crosshair` + **yieldToScroll**(overlay.ts:208-215 패턴 재사용 — wheel 시 120ms 양보); off → `none` + **activeStroke 있으면 즉시 확정**.
  - 드래그: blocker `pointerdown` → 획 시작(`<g>` 안에 동일 `d` 공유 path 2겹 — 흰 `#fff` 6px 아래 + 빨강 `#ef4444` 3px 위) → `window` capture `pointermove`로 포인트 누적 + `pointsToPath`로 d 갱신 → `pointerup` 확정 후 window 리스너 제거.
  - **Esc**: 펜 ON 중 window capture `keydown` Esc → activeStroke 확정 + 펜 OFF + `postToRuntime({type:"annotation.penOff"})` (picker.ts:655-666 선례 패턴).
  - 획 페이드: 확정 시 `setTimeout(3000)` → `.fading`(opacity 0, 400ms transition) → `transitionend`에서 `<g>` remove. 타이머는 `fadeTimers` 보관.
  - hide: **activeStroke 즉시 확정** + window capture 리스너 제거 + `fadeTimers` 전부 clear + host remove.
  - 상수: `ANNOTATION_HOST_ID`, `STROKE_COLOR`, `STROKE_OUTLINE`, `STROKE_WIDTH`, `OUTLINE_WIDTH`, `FADE_DELAY_MS`, `FADE_DURATION_MS`.
- **검증**:
  - [x] `pnpm typecheck` 통과.
  - [ ] (수동) 콘솔에서 show/setPen/hide 수동 발신 → 오버레이 마운트·드래그 그리기·2겹 획·제거 확인 — 또는 Task 4 이후 실 녹화로 확인.
  - [ ] (수동) **그리는 도중(pointer down 상태) hide/setPen off/Esc** → 획 확정되고 리스너 잔존 없음.

### Task 3: 스토어 + 사이드패널 제어 (`annotation-control.ts`, editor-store)
- **변경 대상**: `src/store/editor-store.ts`, `src/store/__tests__/editor-store.test.ts`, `src/sidepanel/annotation-control.ts` (신규)
- **작업 내용**:
  - editor-store: `annotationPenOn: boolean`(초기 false) + `setAnnotationPen(on)` 액션. `startRecording`의 `...initial` 리셋에 자동 편승 확인.
  - `annotation-control.ts`: `showAnnotation`/`hideAnnotation`/`setAnnotationPen(tabId, on)` — recorder-control.ts:5의 send 패턴. 주입 보장은 `picker-control.ts:ensureContentScript` 재사용(비export면 export 추가).
- **검증**:
  - [x] `pnpm test` — editor-store: setAnnotationPen 토글, startRecording 시 false 리셋.
  - [x] `pnpm typecheck` 통과.

### Task 4: action-recorder 오염 방지
- **변경 대상**: `src/content/action-recorder.ts`
- **작업 내용**: `ANNOTATION_HOST_ID = "__bugshot_annotation_host"` 리터럴 추가(HOST_ID :21-22 인접, 동기 복제 주석). `isOwnUi`(:93)를 Task 1의 `matchesOwnHost` 사용으로 전환하고 picker host + annotation host 둘 다 제외.
- **검증**:
  - [x] `pnpm test` — matchesOwnHost 테스트 green (Task 1).
  - [ ] (수동, 실 탭) 펜 ON 드래그 → 로그 탭 액션 로그에 drag/click 안 잡힘. **펜 OFF 상태의 일반 클릭은 여전히 잡힘**(기존 동작 회귀 확인).

### Task 5: 녹화 라이프사이클 배선 (마운트/해제)
- **변경 대상**: `src/sidepanel/video-capture.ts`, `src/sidepanel/video-recorder.ts`
- **작업 내용**:
  - `video-capture.ts`: `beginTabRecording` 성공 직후(:60 부근)·`startScreenRecording` 성공 직후(:99 부근) `showAnnotation(tabId)`(실패 warn no-op). (editor-store 액션 `startRecording`과 혼동 주의.)
  - `video-recorder.ts` `onstop`(:47): **`localTabId`(:63 캡처본) 사용** — `state`는 :66에서 null. `hideAnnotation(localTabId)`를 **try/catch(또는 `.catch()`)로 격리**해 `onRecordingComplete` 흐름을 보호.
  - `cancelRecording`(:186): `state = null` **이전에** tabId 캡처 후 `hideAnnotation`.
- **검증**:
  - [ ] (수동, 실 탭) 탭 녹화 시작 → 오버레이 마운트(pass-through), 정지 → 제거. 화면 녹화 동일.
  - [ ] 60초 자동 종료·OS "공유 중지"·취소 각각에서 오버레이 제거 + **녹화 결과물 정상 저장**(onstop 흐름 무손상).

### Task 6: 사이드패널 펜 토글 버튼
- **변경 대상**: `src/sidepanel/tabs/IssueTab.tsx` (RecordingState — 정지 버튼 :361, 경과 폴링 :329-335), `src/i18n/`
- **작업 내용**:
  - RecordingState 버튼 행에 펜 토글: shadcn Button **`variant="outline"` 고정 + active 시 `bg-muted` + `data-active` + `aria-pressed`** (AnnotationToolbar 패턴), lucide `Pen`류 아이콘, `h-9 w-9`.
  - **`aria-label` + `title` 필수** → i18n ko/en 동시 추가(훅이 locales 테스트 자동 실행).
  - 상태는 `useEditorStore`의 `annotationPenOn` 구독. 클릭 → store `setAnnotationPen(next)` + 메시지 `setAnnotationPen(tabId, next)`. tabId는 `useBoundTabId()`(IssueTab.tsx:68).
  - `data-testid` 부착(e2e용).
- **검증**:
  - [x] `pnpm typecheck` + i18n locales 테스트 통과.
  - [ ] (수동, 실 탭) 펜 ON → crosshair·드래그 그리기·**휠 스크롤 통과(yieldToScroll)**; OFF → 페이지 정상 클릭.
  - [ ] (수동) **페이지에서 Esc** → 펜 꺼지고 사이드패널 버튼 active도 해제(업스트림 동기화 — Task 7의 usePickerMessages 배선 필요).
  - [ ] (수동) 펜 ON 상태로 사이드패널 다른 탭 갔다가 복귀 → 버튼 active 유지(store 승격 효과).

### Task 7: 업스트림 동기화 + 내비게이션 재표시
- **변경 대상**: `src/sidepanel/hooks/usePickerMessages.ts`, `src/sidepanel/hooks/useBackgroundRecorder.ts`
- **작업 내용**:
  - usePickerMessages: `annotation.penOff` 수신 → `useEditorStore.getState().setAnnotationPen(false)` (`picker.cancelled` 수신 패턴).
  - useBackgroundRecorder의 **`tabs.onUpdated` 핸들러(:70-94 — 로그 레코더 재주입 지점)**: 녹화 활성(`videoRecorder.isRecording()`)이면 `showAnnotation(tabId)` 재전송, `annotationPenOn === true`면 `setAnnotationPen(tabId, true)`도 재전송. (~~webNavigation.onCommitted sentinel 재발행 경로~~ — main-frame엔 발화하지 않음이 확인돼 폐기.)
- **검증**:
  - [ ] (수동, 실 탭) 펜 ON 상태로 녹화 중 페이지 이동(same-origin·cross-origin 각각) → 새 페이지에서 그리기 계속 가능(펜 ON 유지).
  - [ ] (수동) Esc 후 사이드패널 버튼 해제 확인(Task 6 검증과 교차).

## 테스트 계획

- **단위 테스트**: `annotation-draw.test.ts`(pointsToPath — 다중/단일/빈/대량), `action-recorder-helpers.test.ts`(matchesOwnHost), `editor-store.test.ts`(annotationPenOn 토글·리셋).
- **e2e 시나리오** (`/e2e-write` 입력 — **실 녹화 없이 메시지 직구동으로 우회**. 녹화 실행 e2e는 과거 flaky로 전부 삭제된 이력이 있고 fake-media 플래그 미도입이 확정 방침. "녹화 시작→펜 버튼 노출"류 실 녹화 전제 판정은 수동으로 이관):
  - "사이드패널 컨텍스트에서 annotation.show 메시지를 보내면 페이지에 오버레이 host가 마운트된다." — `page.evaluate`로 open shadow host 존재 판정.
  - "annotation.setPen(on) 후 페이지 위를 드래그하면 SVG `<g>`(획)가 추가된다." — 드래그 시뮬레이션 후 shadow 내 `<g>` count 증가.
  - "annotation.setPen(off) 상태에서는 드래그해도 획이 추가되지 않고 페이지 클릭이 동작한다."
  - "annotation.hide를 보내면 오버레이 host가 제거된다."
  - (펜 버튼 노출·실 녹화 연동·페이드 3초·시각 정합 → 수동)
- **수동 테스트** (Chrome, 실 탭):
  - [ ] 그린 획(흰 테두리+빨강)이 ~3초 뒤 페이드아웃.
  - [ ] 저장된 녹화 영상 재생 시 그린 선이 보임(tabCapture·화면 녹화 각각).
  - [ ] 펜 ON 중 휠 스크롤 통과 + 스크롤 후 획이 뷰포트에 남는 어긋남이 3초 내 소멸(알려진 제약 확인).
  - [ ] 펜 드래그가 액션 로그에 안 잡힘 + 일반 클릭 로깅은 회귀 없음.
  - [ ] 녹화 종료 4경로(수동·60초·공유 중지·취소)에서 오버레이 제거 + 결과물 정상.
  - [ ] Esc → 페이지 펜 해제 + 사이드패널 버튼 동기화.
  - [ ] 녹화 중 페이지 이동 후 펜 상태 복원.

## 구현 순서 권장

- Task 1(순수함수+테스트) → Task 2(어노테이션 모듈+union) → Task 3(스토어+제어) 순차.
- Task 4(action-recorder)·Task 5(마운트 배선)·Task 6(펜 버튼)은 Task 3 이후 병렬 가능. 단 Task 6의 실 동작 확인은 Task 5에 의존.
- Task 7(업스트림+재표시)은 Task 5·6 완료 후. **PRD가 내비게이션 복원을 요구하므로 유예 불가**(초안의 "MVP 유예 가능" 문구 폐기).

## 가이드 영향

사용자 노출 기능이므로 갱신 필요:
- `guide/ko/video/record.md` · `guide/en/video/record.md` — 녹화 중 그리기(펜) 사용법 섹션 추가: 사이드패널 펜 토글 위치, 펜 켠 뒤 페이지 드래그로 그림, Esc로 끄기, 획이 몇 초 뒤 사라짐, **화면 녹화 시 대상 탭 위에서만 그려짐**(인앱 안내는 없음 — 가이드에만 명시). 작성 규칙은 `guide/AUTHORING.md`. 구현 후 `/guide`로 처리.
